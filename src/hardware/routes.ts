import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { SerialPort } from "serialport";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  antiTheftAlerts,
  hardwareDevices,
  items,
  organizationSettings,
  scannerAuditLogs,
  smartTrayItems,
  smartTraySessions
} from "../db/schema.js";
import { initializeScaleConnection } from "./scaleManager.js";
import { handleScannedCode, dispatchThermalPrintJob } from "./deviceManager.js";

export const hardwareRouter = Router();

const DEVICE_TYPES = new Set(["THERMAL_BARCODE_PRINTER", "BARCODE_SCANNER", "RFID_UHF_READER", "SMART_TRAY"]);
const CONNECTION_TYPES = new Set(["USB_SERIAL", "NETWORK", "KEYBOARD_WEDGE", "MANUAL"]);
const SCAN_EVENT_TYPES = new Set(["BARCODE_SCAN", "RFID_SCAN", "TRAY_SCAN", "UNKNOWN_SCAN", "PRINT_LABEL"]);
const ALERT_STATUSES = new Set(["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const);
type AntiTheftAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

hardwareRouter.get("/ports", requireAuth, async (_request, response) => {
  try {
    const ports = await SerialPort.list();

    return response.json({
      ports: ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer ?? null,
        serialNumber: port.serialNumber ?? null,
        vendorId: port.vendorId ?? null,
        productId: port.productId ?? null
      }))
    });
  } catch (error) {
    console.error("Failed to list serial ports", error);

    return response.status(500).json({ errors: ["Could not list serial ports."] });
  }
});

hardwareRouter.post("/scale/config", requireAuth, requireAdmin, (request, response) => {
  const validation = validateScaleConfig(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(409).json({ errors: ["Organization settings must be initialized first."] });
  }

  db.update(organizationSettings)
    .set({
      scale_port_name: validation.config.portName,
      scale_baud_rate: validation.config.baudRate,
      updated_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  const scale = initializeScaleConnection(validation.config.portName, validation.config.baudRate);

  return response.json({
    config: validation.config,
    scale
  });
});

hardwareRouter.get("/devices", requireAuth, (request, response) => {
  const type = typeof request.query.type === "string" ? request.query.type.toUpperCase() : "";
  const rows = db
    .select()
    .from(hardwareDevices)
    .where(type && DEVICE_TYPES.has(type) ? eq(hardwareDevices.device_type, type as typeof hardwareDevices.$inferSelect.device_type) : undefined)
    .all();

  return response.json({ devices: rows });
});

hardwareRouter.post("/devices", requireAuth, requireAdmin, (request, response) => {
  const validation = validateDevicePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const device = db.insert(hardwareDevices).values(validation.device).returning().get();

  return response.status(201).json({ device });
});

hardwareRouter.put("/devices/:id", requireAuth, requireAdmin, (request, response) => {
  const deviceId = parsePositiveInteger(request.params.id);
  if (!deviceId) return response.status(400).json({ errors: ["Device id must be a positive integer."] });

  const validation = validateDevicePayload(request.body);
  if (!validation.ok) return response.status(400).json({ errors: validation.errors });

  const device = db.update(hardwareDevices)
    .set({ ...validation.device, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(hardwareDevices.id, deviceId))
    .returning()
    .get();

  if (!device) {
    return response.status(404).json({ errors: ["Hardware device not found."] });
  }

  return response.json({ device });
});

hardwareRouter.post("/scans/audit", requireAuth, async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateScanAuditPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const lookupCode = validation.event.barcode ?? validation.event.rfid_epc ?? "";

  const device = validation.event.source_device_id
    ? db.query.hardwareDevices.findFirst({ where: eq(hardwareDevices.id, validation.event.source_device_id) }).sync()
    : null;

  const activeDevice = device ?? ({
    id: validation.event.source_device_id ?? 0,
    name: validation.event.context ?? "SECURITY_DESK",
    device_type: validation.event.event_type === "RFID_SCAN" ? "RFID_UHF_READER" : "BARCODE_SCANNER"
  } as typeof hardwareDevices.$inferSelect);

  const { log: audit, item } = await handleScannedCode(activeDevice, lookupCode, authUser.id, true);

  return response.status(201).json({ audit, item });
});

hardwareRouter.get("/scans/audit", requireAuth, (request, response) => {
  const limit = Math.min(parsePositiveInteger(String(request.query.limit ?? "100")) ?? 100, 500);
  const rows = db.select().from(scannerAuditLogs).orderBy(sql`${scannerAuditLogs.id} DESC`).limit(limit).all();

  return response.json({ logs: rows });
});

hardwareRouter.post("/printers/:id/label-job", requireAuth, async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const printerId = parsePositiveInteger(request.params.id);
  if (!printerId) return response.status(400).json({ errors: ["Printer id must be a positive integer."] });

  const printer = db.query.hardwareDevices.findFirst({ where: eq(hardwareDevices.id, printerId) }).sync();
  if (!printer || printer.device_type !== "THERMAL_BARCODE_PRINTER") {
    return response.status(404).json({ errors: ["Thermal barcode printer not found."] });
  }

  if (!isRecord(request.body) || typeof request.body.barcode !== "string" || !request.body.barcode.trim()) {
    return response.status(400).json({ errors: ["barcode is required."] });
  }

  const barcode = request.body.barcode.trim().toUpperCase();
  const item = db.query.items.findFirst({ where: orBarcodeOrHuid(barcode) }).sync();

  if (!item) {
    return response.status(404).json({ errors: ["Item not found for the provided barcode/HUID."] });
  }

  // Dispatch print job to physical serial / network devices
  let printError: string | null = null;
  if (printer.connection_type === "USB_SERIAL" || printer.connection_type === "NETWORK") {
    try {
      await dispatchThermalPrintJob(printer, item, barcode);
    } catch (e) {
      printError = e instanceof Error ? e.message : String(e);
      console.error("[Printer] Thermal print dispatch failed:", printError);
    }
  }

  const audit = db.insert(scannerAuditLogs)
    .values({
      event_type: "PRINT_LABEL",
      source_device_id: printer.id,
      barcode,
      item_id: item.id,
      result: printError ? "PRINT_FAILED" : "PRINTED",
      context: "THERMAL_BARCODE_PRINTER",
      raw_payload_json: JSON.stringify({
        command_language: printer.command_language ?? "PDF_BROWSER",
        label_page_size: printer.label_page_size,
        print_error: printError
      }),
      user_id: authUser.id
    })
    .returning()
    .get();

  if (printError) {
    return response.status(500).json({ errors: [`Failed to print label to hardware device: ${printError}`] });
  }

  return response.status(200).json({
    job: {
      id: audit.id,
      status: "PRINTED",
      printer,
      item,
      barcode,
      dispatch_mode: printer.connection_type === "USB_SERIAL" || printer.connection_type === "NETWORK" ? "CONFIGURED_DEVICE" : "BROWSER_PRINT"
    }
  });
});

hardwareRouter.post("/trays/sessions", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateTrayOpenPayload(request.body);
  if (!validation.ok) return response.status(400).json({ errors: validation.errors });

  const session = db.insert(smartTraySessions)
    .values({
      tray_code: validation.tray.trayCode,
      device_id: validation.tray.deviceId,
      customer_id: validation.tray.customerId,
      purpose: validation.tray.purpose,
      status: "OPEN",
      opened_by: authUser.id
    })
    .returning()
    .get();

  return response.status(201).json({ session });
});

hardwareRouter.post("/trays/sessions/:id/items", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const sessionId = parsePositiveInteger(request.params.id);
  if (!sessionId) return response.status(400).json({ errors: ["Tray session id must be a positive integer."] });

  const session = db.query.smartTraySessions.findFirst({ where: eq(smartTraySessions.id, sessionId) }).sync();
  if (!session || session.status !== "OPEN") return response.status(404).json({ errors: ["Open tray session not found."] });

  if (!isRecord(request.body) || typeof request.body.barcode !== "string" || !request.body.barcode.trim()) {
    return response.status(400).json({ errors: ["barcode is required."] });
  }

  const barcode = request.body.barcode.trim().toUpperCase();
  const item = db.query.items.findFirst({ where: orBarcodeOrHuid(barcode) }).sync();

  if (!item) {
    createAntiTheftAlert({
      alertType: "UNKNOWN_TRAY_ITEM",
      barcode,
      traySessionId: session.id,
      description: `Unknown item scanned into tray ${session.tray_code}: ${barcode}`,
      createdBy: authUser.id
    });
    return response.status(404).json({ errors: ["Item not found. Anti-theft alert opened."] });
  }

  const trayItem = db.insert(smartTrayItems)
    .values({ session_id: session.id, item_id: item.id, barcode: item.barcode })
    .returning()
    .get();

  db.insert(scannerAuditLogs).values({
    event_type: "TRAY_SCAN",
    source_device_id: session.device_id,
    barcode: item.barcode,
    item_id: item.id,
    result: "ADDED_TO_TRAY",
    context: `TRAY:${session.tray_code}`,
    user_id: authUser.id
  }).run();

  return response.status(201).json({ tray_item: trayItem, item });
});

hardwareRouter.post("/trays/sessions/:id/return", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const sessionId = parsePositiveInteger(request.params.id);
  if (!sessionId) return response.status(400).json({ errors: ["Tray session id must be a positive integer."] });

  if (!isRecord(request.body) || typeof request.body.barcode !== "string" || !request.body.barcode.trim()) {
    return response.status(400).json({ errors: ["barcode is required."] });
  }

  const barcode = request.body.barcode.trim().toUpperCase();
  const trayItem = db.query.smartTrayItems.findFirst({
    where: sql`${smartTrayItems.session_id} = ${sessionId} AND ${smartTrayItems.barcode} = ${barcode}`
  }).sync();

  if (!trayItem) {
    return response.status(404).json({ errors: ["Tray item not found."] });
  }

  const returned = db.update(smartTrayItems)
    .set({ returned_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(smartTrayItems.id, trayItem.id))
    .returning()
    .get();

  const session = db.query.smartTraySessions.findFirst({ where: eq(smartTraySessions.id, sessionId) }).sync();
  db.insert(scannerAuditLogs).values({
    event_type: "TRAY_SCAN",
    source_device_id: session?.device_id ?? null,
    barcode: returned.barcode,
    item_id: returned.item_id,
    result: "RETURNED_TO_TRAY",
    context: session ? `TRAY:${session.tray_code}` : null,
    user_id: authUser.id
  }).run();

  return response.json({ tray_item: returned });
});

hardwareRouter.post("/trays/sessions/:id/close", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const sessionId = parsePositiveInteger(request.params.id);
  if (!sessionId) return response.status(400).json({ errors: ["Tray session id must be a positive integer."] });

  const session = db.query.smartTraySessions.findFirst({ where: eq(smartTraySessions.id, sessionId) }).sync();
  if (!session) return response.status(404).json({ errors: ["Tray session not found."] });

  const outstanding = db.select().from(smartTrayItems)
    .where(sql`${smartTrayItems.session_id} = ${sessionId} AND ${smartTrayItems.expected_return} = 1 AND ${smartTrayItems.returned_at} IS NULL`)
    .all();

  for (const item of outstanding) {
    createAntiTheftAlert({
      alertType: "TRAY_ITEM_NOT_RETURNED",
      itemId: item.item_id ?? undefined,
      barcode: item.barcode,
      traySessionId: session.id,
      description: `Item ${item.barcode} was not returned before closing tray ${session.tray_code}.`,
      createdBy: authUser.id
    });
  }

  const closed = db.update(smartTraySessions)
    .set({ status: "CLOSED", closed_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(smartTraySessions.id, sessionId))
    .returning()
    .get();

  db.insert(scannerAuditLogs).values({
    event_type: "TRAY_SCAN",
    source_device_id: session.device_id,
    barcode: null,
    result: outstanding.length > 0 ? `TRAY_CLOSED_${outstanding.length}_OUTSTANDING` : "TRAY_CLOSED_CLEAN",
    context: `TRAY:${session.tray_code}`,
    user_id: authUser.id
  }).run();

  return response.json({ session: closed, outstanding_items: outstanding });
});

hardwareRouter.get("/trays/sessions/open", requireAuth, (_request, response) => {
  const sessions = db.select().from(smartTraySessions).where(eq(smartTraySessions.status, "OPEN")).all();
  return response.json({ sessions });
});

hardwareRouter.get("/anti-theft/alerts", requireAuth, (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status.toUpperCase() : "OPEN";
  const alerts = db.select().from(antiTheftAlerts)
    .where(ALERT_STATUSES.has(status as any) ? eq(antiTheftAlerts.status, status as typeof antiTheftAlerts.$inferSelect.status) : undefined)
    .orderBy(sql`${antiTheftAlerts.id} DESC`)
    .all();

  return response.json({ alerts });
});

hardwareRouter.post("/anti-theft/alerts", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateAlertPayload(request.body);
  if (!validation.ok) return response.status(400).json({ errors: validation.errors });

  const alert = createAntiTheftAlert({ ...validation.alert, createdBy: authUser.id });
  return response.status(201).json({ alert });
});

hardwareRouter.post("/anti-theft/alerts/:id/status", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const alertId = parsePositiveInteger(request.params.id);
  if (!alertId) return response.status(400).json({ errors: ["Alert id must be a positive integer."] });

  if (!isRecord(request.body) || typeof request.body.status !== "string") {
    return response.status(400).json({ errors: ["status is required."] });
  }

  const status = request.body.status.toUpperCase() as AntiTheftAlertStatus;
  if (!ALERT_STATUSES.has(status)) {
    return response.status(400).json({ errors: ["status must be OPEN, ACKNOWLEDGED, or RESOLVED."] });
  }

  const update = status === "ACKNOWLEDGED"
    ? { status, acknowledged_by: authUser.id, acknowledged_at: sql`CURRENT_TIMESTAMP` }
    : status === "RESOLVED"
      ? { status, resolved_by: authUser.id, resolved_at: sql`CURRENT_TIMESTAMP` }
      : { status };

  const alert = db.update(antiTheftAlerts)
    .set(update)
    .where(eq(antiTheftAlerts.id, alertId))
    .returning()
    .get();

  if (!alert) return response.status(404).json({ errors: ["Anti-theft alert not found."] });

  return response.json({ alert });
});

type ScaleConfigValidation =
  | { ok: true; config: { portName: string; baudRate: number } }
  | { ok: false; errors: string[] };

function validateScaleConfig(body: unknown): ScaleConfigValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const portName = typeof body.portName === "string" ? body.portName.trim() : "";
  const baudRate = body.baudRate;

  if (!portName) {
    errors.push("portName is required.");
  }

  if (typeof baudRate !== "number" || !Number.isInteger(baudRate) || baudRate <= 0) {
    errors.push("baudRate must be a positive integer.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      portName,
      baudRate: baudRate as number
    }
  };
}

type DeviceValidation =
  | { ok: true; device: typeof hardwareDevices.$inferInsert }
  | { ok: false; errors: string[] };

function validateDevicePayload(body: unknown): DeviceValidation {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ["Request body must be a JSON object."] };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const deviceType = typeof body.device_type === "string" ? body.device_type.toUpperCase() : "";
  const connectionType = typeof body.connection_type === "string" ? body.connection_type.toUpperCase() : "";
  const portName = optionalString(body.port_name);
  const ipAddress = optionalString(body.ip_address);
  const baudRate = typeof body.baud_rate === "number" && Number.isInteger(body.baud_rate) ? body.baud_rate : undefined;

  if (!name) errors.push("name is required.");
  if (!DEVICE_TYPES.has(deviceType)) errors.push("device_type is invalid.");
  if (!CONNECTION_TYPES.has(connectionType)) errors.push("connection_type is invalid.");
  if (connectionType === "USB_SERIAL" && !portName) errors.push("port_name is required for USB serial devices.");
  if (connectionType === "NETWORK" && !ipAddress) errors.push("ip_address is required for network devices.");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    device: {
      name,
      device_type: deviceType as typeof hardwareDevices.$inferInsert.device_type,
      connection_type: connectionType as typeof hardwareDevices.$inferInsert.connection_type,
      port_name: portName,
      ip_address: ipAddress,
      baud_rate: baudRate,
      command_language: optionalString(body.command_language) ?? (deviceType === "THERMAL_BARCODE_PRINTER" ? "PDF_BROWSER" : undefined),
      label_page_size: optionalString(body.label_page_size),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active)
    }
  };
}

type ScanAuditValidation =
  | { ok: true; event: typeof scannerAuditLogs.$inferInsert }
  | { ok: false; errors: string[] };

function validateScanAuditPayload(body: unknown): ScanAuditValidation {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ["Request body must be a JSON object."] };

  const eventType = typeof body.event_type === "string" ? body.event_type.toUpperCase() : "BARCODE_SCAN";
  const barcode = optionalString(body.barcode)?.toUpperCase();
  const rfidEpc = optionalString(body.rfid_epc)?.toUpperCase();

  if (!SCAN_EVENT_TYPES.has(eventType)) errors.push("event_type is invalid.");
  if (!barcode && !rfidEpc) errors.push("barcode or rfid_epc is required.");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    event: {
      event_type: eventType as typeof scannerAuditLogs.$inferInsert.event_type,
      source_device_id: optionalPositiveNumber(body.source_device_id),
      barcode,
      rfid_epc: rfidEpc,
      result: "PENDING",
      context: optionalString(body.context),
      raw_payload_json: JSON.stringify(body.raw_payload ?? {})
    }
  };
}

function validateTrayOpenPayload(body: unknown):
  | { ok: true; tray: { trayCode: string; deviceId?: number; customerId?: number; purpose: string } }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ["Request body must be a JSON object."] };

  const trayCode = typeof body.tray_code === "string" ? body.tray_code.trim().toUpperCase() : "";
  if (!trayCode) errors.push("tray_code is required.");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    tray: {
      trayCode,
      deviceId: optionalPositiveNumber(body.device_id),
      customerId: optionalPositiveNumber(body.customer_id),
      purpose: optionalString(body.purpose) ?? "SHOWROOM_VIEW"
    }
  };
}

function validateAlertPayload(body: unknown):
  | { ok: true; alert: Omit<CreateAlertInput, "createdBy"> }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ["Request body must be a JSON object."] };

  const alertType = typeof body.alert_type === "string" ? body.alert_type.trim().toUpperCase() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!alertType) errors.push("alert_type is required.");
  if (!description) errors.push("description is required.");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    alert: {
      alertType,
      severity: optionalString(body.severity)?.toUpperCase(),
      itemId: optionalPositiveNumber(body.item_id),
      barcode: optionalString(body.barcode)?.toUpperCase(),
      traySessionId: optionalPositiveNumber(body.tray_session_id),
      description
    }
  };
}

type CreateAlertInput = {
  alertType: string;
  severity?: string;
  itemId?: number;
  barcode?: string;
  traySessionId?: number;
  description: string;
  createdBy?: number;
};

function createAntiTheftAlert(input: CreateAlertInput) {
  return db.insert(antiTheftAlerts)
    .values({
      alert_type: input.alertType,
      severity: input.severity ?? "HIGH",
      status: "OPEN",
      item_id: input.itemId,
      barcode: input.barcode,
      tray_session_id: input.traySessionId,
      description: input.description,
      created_by: input.createdBy
    })
    .returning()
    .get();
}

function parsePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function orBarcodeOrHuid(code: string) {
  return sql`${items.barcode} = ${code} OR ${items.huid} = ${code}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

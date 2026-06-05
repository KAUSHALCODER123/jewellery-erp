import net from "node:net";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { eq, sql, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  hardwareDevices,
  scannerAuditLogs,
  smartTraySessions,
  smartTrayItems,
  antiTheftAlerts,
  items
} from "../db/schema.js";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

// Unified hardware WebSocket clients
const hardwareClients = new Set<WebSocket>();

// Keep track of active scanner/RFID serial ports and sockets to avoid duplicate connections
const activeScannerPorts = new Map<number, SerialPort>();
const activeScannerSockets = new Map<number, net.Socket>();

/**
 * Register a client WebSocket to receive unified hardware events.
 */
export function registerHardwareClient(ws: WebSocket) {
  hardwareClients.add(ws);
  ws.on("close", () => {
    hardwareClients.delete(ws);
  });
}

/**
 * Broadcast an event to all connected hardware WebSocket clients.
 */
export function broadcastHardwareEvent(data: Record<string, any>) {
  const payload = JSON.stringify(data);
  for (const client of hardwareClients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Initialize all active scanner/RFID reader background connections.
 */
export function initializeActiveDevices() {
  // Close any existing active connections
  closeAllActiveConnections();

  try {
    const devices = db.select().from(hardwareDevices).where(eq(hardwareDevices.is_active, true)).all();
    console.log(`[DeviceManager] Found ${devices.length} active devices to initialize.`);

    for (const device of devices) {
      if (device.device_type === "BARCODE_SCANNER" || device.device_type === "RFID_UHF_READER" || device.device_type === "SMART_TRAY") {
        if (device.connection_type === "USB_SERIAL" && device.port_name) {
          startSerialListener(device);
        } else if (device.connection_type === "NETWORK" && device.ip_address) {
          startNetworkListener(device);
        }
      }
    }
  } catch (error) {
    console.error("[DeviceManager] Failed to query hardware devices from DB on startup:", error);
  }
}

/**
 * Disconnect all serial ports and network sockets.
 */
function closeAllActiveConnections() {
  for (const [id, port] of activeScannerPorts.entries()) {
    try {
      if (port.isOpen) {
        port.close();
      }
    } catch (e) {
      console.error(`[DeviceManager] Failed to close serial port for device ${id}`, e);
    }
  }
  activeScannerPorts.clear();

  for (const [id, socket] of activeScannerSockets.entries()) {
    try {
      socket.destroy();
    } catch (e) {
      console.error(`[DeviceManager] Failed to destroy socket for device ${id}`, e);
    }
  }
  activeScannerSockets.clear();
}

/**
 * Start a USB Serial listener for barcode/RFID scanning.
 */
function startSerialListener(device: typeof hardwareDevices.$inferSelect) {
  const portName = device.port_name!;
  const baudRate = device.baud_rate ?? 9600;

  try {
    const port = new SerialPort({
      path: portName,
      baudRate,
      autoOpen: false
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));

    parser.on("data", (line: string) => {
      const code = line.trim().toUpperCase();
      if (code) {
        void handleScannedCode(device, code);
      }
    });

    port.open((error) => {
      if (error) {
        console.error(`[DeviceManager] Failed to open serial device ${device.name} on ${portName}:`, error.message);
        return;
      }
      console.log(`[DeviceManager] Connected to serial device ${device.name} on ${portName}`);
      activeScannerPorts.set(device.id, port);
      updateDeviceLastSeen(device.id);
    });

    port.on("error", (err) => {
      console.error(`[DeviceManager] Serial error on device ${device.name}:`, err.message);
    });
  } catch (error) {
    console.error(`[DeviceManager] Exception starting serial port for device ${device.name}:`, error);
  }
}

/**
 * Start a TCP raw socket listener for barcode/RFID scanning.
 */
function startNetworkListener(device: typeof hardwareDevices.$inferSelect) {
  const ipAddress = device.ip_address!;
  const port = 9100; // standard raw scanner port

  try {
    const socket = new net.Socket();

    socket.connect(port, ipAddress, () => {
      console.log(`[DeviceManager] Connected to network device ${device.name} at ${ipAddress}`);
      activeScannerSockets.set(device.id, socket);
      updateDeviceLastSeen(device.id);
    });

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let boundary = buffer.indexOf("\n");
      while (boundary !== -1) {
        const line = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + 1);
        const code = line.toUpperCase();
        if (code) {
          void handleScannedCode(device, code);
        }
        boundary = buffer.indexOf("\n");
      }
    });

    socket.on("error", (err) => {
      console.error(`[DeviceManager] Socket error on device ${device.name} at ${ipAddress}:`, err.message);
    });

    socket.on("close", () => {
      activeScannerSockets.delete(device.id);
    });
  } catch (error) {
    console.error(`[DeviceManager] Exception starting socket client for device ${device.name}:`, error);
  }
}

/**
 * Handle a scanned barcode or RFID EPC.
 */
export async function handleScannedCode(
  device: typeof hardwareDevices.$inferSelect,
  code: string,
  userId?: number,
  isSimulated = false
) {
  console.log(`[DeviceManager] Scanned code received from device ${device.name} (${device.device_type}): ${code}`);
  updateDeviceLastSeen(device.id);

  const isRfid = device.device_type === "RFID_UHF_READER";
  const event_type = isRfid ? "RFID_SCAN" : "BARCODE_SCAN";

  // Look up item in database (matching barcode or HUID or RFID tag if we had one)
  const item = db.query.items.findFirst({
    where: or(eq(items.barcode, code), eq(items.huid, code))
  }).sync();

  let result = item ? "MATCHED" : "NO_MATCH";
  let context = device.name;

  // 1. Process Smart Tray Session addition
  if (device.device_type === "SMART_TRAY") {
    const activeSession = db.query.smartTraySessions.findFirst({
      where: sql`${smartTraySessions.device_id} = ${device.id} AND ${smartTraySessions.status} = 'OPEN'`
    }).sync();

    if (activeSession) {
      context = `TRAY:${activeSession.tray_code}`;
      if (item) {
        result = "ADDED_TO_TRAY";
        try {
          db.insert(smartTrayItems)
            .values({
              session_id: activeSession.id,
              item_id: item.id,
              barcode: item.barcode,
              expected_return: true
            })
            .run();
        } catch (e) {
          // Item might already be in tray session
        }
      } else {
        // Unknown item scanned into tray triggers an anti-theft alert
        result = "UNKNOWN_TRAY_ITEM";
        createAntiTheftAlertRecord({
          alertType: "UNKNOWN_TRAY_ITEM",
          severity: "MEDIUM",
          barcode: code,
          traySessionId: activeSession.id,
          description: `Unknown item scanned into smart tray ${activeSession.tray_code}: ${code}`,
          createdBy: userId
        });
      }
    }
  }

  // 2. Process Exit Gate Theft prevention
  // If the device name contains exit/gate, or is explicitly named exit gate, handle it
  const isExitGate = device.name.toLowerCase().includes("exit") || device.name.toLowerCase().includes("gate");
  if (isExitGate) {
    context = "EXIT_GATE";
    if (!item) {
      result = "UNKNOWN_EXIT_SCAN";
      createAntiTheftAlertRecord({
        alertType: "UNKNOWN_EXIT_SCAN",
        severity: "HIGH",
        barcode: code,
        description: `Unknown tag exit event detected at ${device.name}: ${code}`,
        createdBy: userId
      });
    } else if (item.status === "IN_STOCK") {
      result = "THEFT_PREVENTION_EXIT";
      createAntiTheftAlertRecord({
        alertType: "THEFT_PREVENTION_EXIT",
        severity: "CRITICAL",
        itemId: item.id,
        barcode: item.barcode,
        description: `IN_STOCK item ${item.barcode} (${item.category}) left the showroom without POS checkout!`,
        createdBy: userId
      });
    } else {
      result = "ALLOWED_EXIT";
    }
  }

  // Log scan event to database
  const logEntry = db.insert(scannerAuditLogs)
    .values({
      event_type,
      source_device_id: device.id,
      barcode: isRfid ? undefined : code,
      rfid_epc: isRfid ? code : undefined,
      item_id: item?.id,
      result,
      context,
      user_id: userId,
      raw_payload_json: JSON.stringify({ isSimulated, device_name: device.name })
    })
    .returning()
    .get();

  // Broadcast WebSocket update
  broadcastHardwareEvent({
    type: "scan",
    log: logEntry,
    item: item ?? null
  });

  return { log: logEntry, item };
}

/**
 * Dispatch ZPL or TSPL print commands directly to the hardware printer.
 */
export async function dispatchThermalPrintJob(
  printer: typeof hardwareDevices.$inferSelect,
  item: typeof items.$inferSelect,
  barcode: string
) {
  console.log(`[DeviceManager] Compiling and dispatching label print for item: ${barcode} to ${printer.name}`);

  // Compile TSPL or ZPL raw commands
  const commands = compilePrintCommands(printer.command_language ?? "TSPL", item, barcode);
  const commandBytes = Buffer.from(commands, "utf-8");

  if (printer.connection_type === "USB_SERIAL" && printer.port_name) {
    return new Promise<void>((resolve, reject) => {
      try {
        const port = new SerialPort({
          path: printer.port_name!,
          baudRate: printer.baud_rate ?? 9600,
          autoOpen: false
        });

        port.open((error) => {
          if (error) {
            console.error(`[DeviceManager] Failed to open printer serial port ${printer.port_name}:`, error.message);
            reject(error);
            return;
          }

          port.write(commandBytes, (err) => {
            if (err) {
              console.error("[DeviceManager] Failed to write print bytes to serial:", err.message);
              port.close();
              reject(err);
              return;
            }

            port.drain(() => {
              port.close();
              updateDeviceLastSeen(printer.id);
              resolve();
            });
          });
        });
      } catch (ex) {
        reject(ex);
      }
    });
  } else if (printer.connection_type === "NETWORK" && printer.ip_address) {
    return new Promise<void>((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(3000);

      client.connect(9100, printer.ip_address!, () => {
        client.write(commandBytes, () => {
          client.end();
          updateDeviceLastSeen(printer.id);
          resolve();
        });
      });

      client.on("error", (err) => {
        console.error(`[DeviceManager] Printer TCP error on ${printer.ip_address}:`, err.message);
        client.destroy();
        reject(err);
      });

      client.on("timeout", () => {
        client.destroy();
        reject(new Error("Printer TCP socket connection timeout"));
      });
    });
  } else {
    // PDF_BROWSER or KEYBOARD_WEDGE or MANUAL - simulated or browser handles it
    console.log(`[DeviceManager] Print job queued in browser mode. Command payload: \n${commands}`);
    updateDeviceLastSeen(printer.id);
    return Promise.resolve();
  }
}

/**
 * Generate TSPL or ZPL commands from item data.
 */
function compilePrintCommands(language: string, item: typeof items.$inferSelect, barcode: string): string {
  const formattedWeight = ((item.gross_weight_mg ?? 0) / 1000).toFixed(3);
  const formattedNetWeight = ((item.net_weight_mg ?? 0) / 1000).toFixed(3);
  const formattedPrice = item.purchase_rate_paise
    ? `Rs ${(item.purchase_rate_paise / 100).toLocaleString("en-IN")}`
    : `Karat: ${item.purity_karat ?? 22}K`;

  if (language === "ZPL") {
    return `^XA
^FO50,20^A0N,22,22^FD${item.category ?? "Jewellery"}^FS
^FO50,45^A0N,18,18^FDGross Wt: ${formattedWeight}g | Net Wt: ${formattedNetWeight}g^FS
^FO50,65^A0N,18,18^FD${formattedPrice}^FS
^FO50,85^BY2^BCN,35,Y,N,N^FD${barcode}^FS
^XZ`;
  } else if (language === "TSPL") {
    return `SIZE 50 mm, 25 mm
GAP 3 mm, 0 mm
DIRECTION 1
CLS
TEXT 50,20,"ROMAN.TTF",0,1,1,"${item.category ?? "Jewellery"}"
TEXT 50,45,"ROMAN.TTF",0,1,1,"Gross Wt: ${formattedWeight}g | Net: ${formattedNetWeight}g"
TEXT 50,70,"ROMAN.TTF",0,1,1,"${formattedPrice}"
BARCODE 50,95,"128",40,1,0,2,2,"${barcode}"
PRINT 1,1
`;
  } else if (language === "ESC_POS") {
    // Basic ESC/POS text print
    return `\x1b\x40` + // Initialize
           `Category: ${item.category}\n` +
           `Weight: ${formattedWeight}g\n` +
           `Barcode: ${barcode}\n\n\n\n\x1d\x56\x01`; // Cut paper
  }

  // Fallback to ZPL
  return `^XA^FO50,50^A0N,20,20^FD${barcode}^FS^XZ`;
}

/**
 * Record a new anti-theft alert in the DB and broadcast it via WebSockets.
 */
function createAntiTheftAlertRecord(input: {
  alertType: string;
  severity: string;
  itemId?: number;
  barcode?: string;
  traySessionId?: number;
  description: string;
  createdBy?: number;
}) {
  try {
    const alert = db.insert(antiTheftAlerts)
      .values({
        alert_type: input.alertType,
        severity: input.severity,
        status: "OPEN",
        item_id: input.itemId,
        barcode: input.barcode,
        tray_session_id: input.traySessionId,
        description: input.description,
        created_by: input.createdBy
      })
      .returning()
      .get();

    // Broadcast to UI
    broadcastHardwareEvent({
      type: "anti_theft_alert",
      alert
    });

    console.log(`[DeviceManager] Anti-Theft Alert Opened: [${input.alertType}] ${input.description}`);
    return alert;
  } catch (error) {
    console.error("[DeviceManager] Failed to create anti-theft alert record:", error);
    return null;
  }
}

/**
 * Update the last_seen_at timestamp of a hardware device.
 */
function updateDeviceLastSeen(deviceId: number) {
  try {
    db.update(hardwareDevices)
      .set({
        last_seen_at: new Date().toISOString(),
        updated_at: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(hardwareDevices.id, deviceId))
      .run();
  } catch (e) {
    // fail silently
  }
}

/**
 * Attach the unified hardware WebSocket server to the HTTP server.
 */
export function attachHardwareWebSocketServer(server: HttpServer) {
  const websocketServer = new WebSocketServer({
    server,
    path: "/ws/hardware"
  });

  websocketServer.on("connection", (socket) => {
    registerHardwareClient(socket);
    socket.send(
      JSON.stringify({
        type: "connection_established",
        message: "Connected to unified hardware monitor"
      })
    );
  });

  return websocketServer;
}


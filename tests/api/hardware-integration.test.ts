import request from "supertest";
import { app } from "../../src/server.js";

describe("Hardware Integration and Security Workflows API", () => {
  let adminToken: string;
  let staffToken: string;

  beforeEach(async () => {
    // Authenticate admin
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Authenticate staff
    const loginStaffRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });
    expect(loginStaffRes.status).toBe(200);
    staffToken = loginStaffRes.body.token;
  });

  describe("GET /api/hardware/ports", () => {
    it("should list available serial ports", async () => {
      const res = await request(app)
        .get("/api/hardware/ports")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ports");
      expect(Array.isArray(res.body.ports)).toBe(true);
    });
  });

  describe("POST /api/hardware/scale/config", () => {
    it("should save scale config and attempt connection when valid", async () => {
      const res = await request(app)
        .post("/api/hardware/scale/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          portName: "COM3",
          baudRate: 9600
        });

      expect(res.status).toBe(200);
      expect(res.body.config).toEqual({
        portName: "COM3",
        baudRate: 9600
      });
    });

    it("should return 400 if baudRate or portName is invalid", async () => {
      const res = await request(app)
        .post("/api/hardware/scale/config")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          portName: "",
          baudRate: -100
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it("should return 403 for non-admin users", async () => {
      const res = await request(app)
        .post("/api/hardware/scale/config")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          portName: "COM3",
          baudRate: 9600
        });

      expect(res.status).toBe(403);
    });
  });

  describe("Device Profiles CRUD", () => {
    it("should create a new hardware device profile as admin", async () => {
      const res = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Test Barcode Reader",
          device_type: "BARCODE_SCANNER",
          connection_type: "USB_SERIAL",
          port_name: "COM1",
          baud_rate: 9600
        });

      expect(res.status).toBe(201);
      expect(res.body.device).toBeDefined();
      expect(res.body.device.name).toBe("Test Barcode Reader");
    });

    it("should return 400 if required fields are missing", async () => {
      const res = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "",
          device_type: "INVALID_TYPE",
          connection_type: "USB_SERIAL"
        });

      expect(res.status).toBe(400);
      expect(res.body.errors).toBeDefined();
    });

    it("should get the list of active device profiles", async () => {
      const res = await request(app)
        .get("/api/hardware/devices")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.devices).toBeDefined();
      expect(Array.isArray(res.body.devices)).toBe(true);
    });

    it("should update a hardware device profile as admin", async () => {
      // First ensure we have a device
      const setupRes = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Original Name",
          device_type: "RFID_UHF_READER",
          connection_type: "NETWORK",
          ip_address: "192.168.1.50"
        });
      const id = setupRes.body.device.id;

      const res = await request(app)
        .put(`/api/hardware/devices/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Updated Name",
          device_type: "RFID_UHF_READER",
          connection_type: "NETWORK",
          ip_address: "192.168.1.55"
        });

      expect(res.status).toBe(200);
      expect(res.body.device.name).toBe("Updated Name");
      expect(res.body.device.ip_address).toBe("192.168.1.55");
    });
  });

  describe("Scan Audit Logging & Matching rules", () => {
    let deviceId: number;

    beforeEach(async () => {
      const devRes = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Audit Scanner",
          device_type: "BARCODE_SCANNER",
          connection_type: "KEYBOARD_WEDGE"
        });
      deviceId = devRes.body.device.id;

      // Seed one scan log
      await request(app)
        .post("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          event_type: "BARCODE_SCAN",
          source_device_id: deviceId,
          barcode: "ITEM-001",
          context: "DESK"
        });
    });

    it("logs barcode scan and flags result as MATCHED for known items", async () => {
      const res = await request(app)
        .post("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          event_type: "BARCODE_SCAN",
          source_device_id: deviceId,
          barcode: "ITEM-001",
          context: "DESK"
        });

      expect(res.status).toBe(201);
      expect(res.body.audit.result).toBe("MATCHED");
      expect(res.body.item).toBeDefined();
      expect(res.body.item.barcode).toBe("ITEM-001");
    });

    it("logs barcode scan and flags result as NO_MATCH for unknown items", async () => {
      const res = await request(app)
        .post("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          event_type: "BARCODE_SCAN",
          source_device_id: deviceId,
          barcode: "UNKNOWN-CODE",
          context: "DESK"
        });

      expect(res.status).toBe(201);
      expect(res.body.audit.result).toBe("NO_MATCH");
      expect(res.body.item).toBeUndefined();
    });

    it("lists the audit logs", async () => {
      const res = await request(app)
        .get("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(res.body.logs.length).toBeGreaterThan(0);
    });
  });

  describe("Exit Gate Security Violations & Anti-Theft Alerts", () => {
    let exitGateDeviceId: number;

    beforeEach(async () => {
      // Exit gate is matched if the device name contains exit or gate
      const devRes = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Exit Gate 1",
          device_type: "BARCODE_SCANNER",
          connection_type: "KEYBOARD_WEDGE"
        });
      exitGateDeviceId = devRes.body.device.id;
    });

    it("triggers a CRITICAL anti-theft alert when an IN_STOCK item passes the gate", async () => {
      const res = await request(app)
        .post("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          event_type: "BARCODE_SCAN",
          source_device_id: exitGateDeviceId,
          barcode: "ITEM-001"
        });

      expect(res.status).toBe(201);
      expect(res.body.audit.result).toBe("THEFT_PREVENTION_EXIT");

      // Verify the alert was generated in the database
      const alertsRes = await request(app)
        .get("/api/hardware/anti-theft/alerts?status=OPEN")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.alerts).toBeDefined();
      const criticalAlert = alertsRes.body.alerts.find(
        (a: any) => a.barcode === "ITEM-001" && a.alert_type === "THEFT_PREVENTION_EXIT"
      );
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert.severity).toBe("CRITICAL");
    });

    it("triggers a HIGH anti-theft alert when an unknown code passes the gate", async () => {
      const res = await request(app)
        .post("/api/hardware/scans/audit")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          event_type: "BARCODE_SCAN",
          source_device_id: exitGateDeviceId,
          barcode: "UNKNOWN-TAG-999"
        });

      expect(res.status).toBe(201);
      expect(res.body.audit.result).toBe("UNKNOWN_EXIT_SCAN");

      // Verify the alert
      const alertsRes = await request(app)
        .get("/api/hardware/anti-theft/alerts?status=OPEN")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.alerts).toBeDefined();
      const highAlert = alertsRes.body.alerts.find(
        (a: any) => a.barcode === "UNKNOWN-TAG-999" && a.alert_type === "UNKNOWN_EXIT_SCAN"
      );
      expect(highAlert).toBeDefined();
      expect(highAlert.severity).toBe("HIGH");

      // Acknowledge the alert as admin
      const ackRes = await request(app)
        .post(`/api/hardware/anti-theft/alerts/${highAlert.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "ACKNOWLEDGED" });

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.alert.status).toBe("ACKNOWLEDGED");
      expect(ackRes.body.alert.acknowledged_by).toBeDefined();
    });
  });

  describe("Smart Tray Tracking Workspaces", () => {
    let smartTrayDeviceId: number;

    beforeEach(async () => {
      const devRes = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Smart Tray Panel 1",
          device_type: "SMART_TRAY",
          connection_type: "MANUAL"
        });
      smartTrayDeviceId = devRes.body.device.id;
    });

    it("manages the tray lifecycle: open session, add items, return, close with warnings", async () => {
      // 1. Open Tray Session
      const openRes = await request(app)
        .post("/api/hardware/trays/sessions")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({
          tray_code: "TRAY-01",
          device_id: smartTrayDeviceId,
          purpose: "CUSTOMER_VIEW"
        });

      expect(openRes.status).toBe(201);
      const sessionId = openRes.body.session.id;
      expect(openRes.body.session.status).toBe("OPEN");

      // 2. Add two items to tray
      const addRes1 = await request(app)
        .post(`/api/hardware/trays/sessions/${sessionId}/items`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ barcode: "ITEM-001" });
      expect(addRes1.status).toBe(201);

      const addRes2 = await request(app)
        .post(`/api/hardware/trays/sessions/${sessionId}/items`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ barcode: "ITEM-002" });
      expect(addRes2.status).toBe(201);

      // 3. Return ITEM-001
      const returnRes = await request(app)
        .post(`/api/hardware/trays/sessions/${sessionId}/return`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ barcode: "ITEM-001" });
      expect(returnRes.status).toBe(200);
      expect(returnRes.body.tray_item.returned_at).not.toBeNull();

      // 4. Close session - should flag ITEM-002 as not returned and trigger warning alert
      const closeRes = await request(app)
        .post(`/api/hardware/trays/sessions/${sessionId}/close`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(closeRes.status).toBe(200);
      expect(closeRes.body.session.status).toBe("CLOSED");
      expect(closeRes.body.outstanding_items).toHaveLength(1);
      expect(closeRes.body.outstanding_items[0].barcode).toBe("ITEM-002");

      // Verify warning alert was logged in DB
      const alertsRes = await request(app)
        .get("/api/hardware/anti-theft/alerts?status=OPEN")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(alertsRes.status).toBe(200);
      expect(alertsRes.body.alerts).toBeDefined();
      const trayAlert = alertsRes.body.alerts.find(
        (a: any) => a.tray_session_id === sessionId && a.alert_type === "TRAY_ITEM_NOT_RETURNED"
      );
      expect(trayAlert).toBeDefined();
      expect(trayAlert.barcode).toBe("ITEM-002");

      // Tray return + close are now written to the scan-audit history.
      const auditRes = await request(app)
        .get("/api/hardware/scans/audit?limit=200")
        .set("Authorization", `Bearer ${staffToken}`);
      expect(auditRes.status).toBe(200);
      const results = auditRes.body.logs.map((l: { result: string }) => l.result);
      expect(results).toContain("RETURNED_TO_TRAY");
      expect(results.some((r: string) => r.startsWith("TRAY_CLOSED"))).toBe(true);
    });
  });

  describe("Thermal Label Printing Dispatch Simulation", () => {
    let printerDeviceId: number;

    beforeEach(async () => {
      const devRes = await request(app)
        .post("/api/hardware/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Zebra ZD420",
          device_type: "THERMAL_BARCODE_PRINTER",
          connection_type: "MANUAL",
          command_language: "ZPL",
          label_page_size: "50x25mm"
        });
      printerDeviceId = devRes.body.device.id;
    });

    it("submits print job for item and writes successful label-job audit log", async () => {
      const res = await request(app)
        .post(`/api/hardware/printers/${printerDeviceId}/label-job`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ barcode: "ITEM-001" });

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe("PRINTED");
      expect(res.body.job.dispatch_mode).toBe("BROWSER_PRINT");

      // Verify scanner log was created for PRINT_LABEL
      const auditRes = await request(app)
        .get("/api/hardware/scans/audit?limit=5")
        .set("Authorization", `Bearer ${staffToken}`);

      const printLog = auditRes.body.logs.find(
        (l: any) => l.event_type === "PRINT_LABEL" && l.barcode === "ITEM-001"
      );
      expect(printLog).toBeDefined();
      expect(printLog.result).toBe("PRINTED");
    });

    it("returns 404 if item does not exist", async () => {
      const res = await request(app)
        .post(`/api/hardware/printers/${printerDeviceId}/label-job`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ barcode: "NONEXISTENT" });

      expect(res.status).toBe(404);
    });
  });
});

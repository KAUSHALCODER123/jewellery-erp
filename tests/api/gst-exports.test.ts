import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../../src/server.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("GST return exports (.xlsx / .pdf)", () => {
  let adminToken: string;
  let staffToken: string;

  beforeEach(async () => {
    const adminRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    const staffRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });
    expect(staffRes.status).toBe(200);
    staffToken = staffRes.body.token;
  });

  test("GSTR-1, B2B/B2C and GSTR-3B download as valid xlsx workbooks", async () => {
    for (const path of ["gstr1.xlsx", "b2b-b2c.xlsx", "gstr3b.xlsx"]) {
      const res = await request(app)
        .get(`/api/documents/gst/${path}?from=2026-06-01&to=2026-06-30`)
        .set("Authorization", `Bearer ${adminToken}`)
        .buffer()
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe(XLSX_MIME);

      // The buffer must parse as a real workbook with at least one sheet.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as Buffer);
      expect(workbook.worksheets.length).toBeGreaterThan(0);
    }
  });

  test("GSTR-1 and GSTR-3B export as PDFs", async () => {
    for (const path of ["gstr1.pdf", "gstr3b.pdf"]) {
      const res = await request(app)
        .get(`/api/documents/gst/${path}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
    }
  });

  test("exports stay admin-only and validate the date range", async () => {
    const staffRes = await request(app)
      .get("/api/documents/gst/gstr1.xlsx")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staffRes.status).toBe(403);

    const badRangeRes = await request(app)
      .get("/api/documents/gst/gstr1.xlsx?from=not-a-date")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badRangeRes.status).toBe(400);

    const noAuthRes = await request(app).get("/api/documents/gst/gstr1.xlsx");
    expect(noAuthRes.status).toBe(401);
  });
});

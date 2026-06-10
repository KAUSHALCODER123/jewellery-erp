import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, messageLogs, organizationSettings } from "../../src/db/schema.js";
import { runGreetingsDispatch } from "../../src/workers/greetingsWorker.js";

// Automated birthday/anniversary greetings: the daily worker auto-sends wishes,
// is idempotent (one send per occasion per day), and respects the on/off toggle.
describe("Automated customer greetings", () => {
  let adminToken: string;
  let staffToken: string;

  beforeEach(async () => {
    const adminRes = await request(app).post("/api/auth/login").send({ username: "test_admin", password: "admin_pass" });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    const staffRes = await request(app).post("/api/auth/login").send({ username: "test_staff", password: "staff_pass" });
    expect(staffRes.status).toBe(200);
    staffToken = staffRes.body.token;

    db.delete(messageLogs).run();
    db.delete(customers).run();
    // Disabled by default (migration default 0).
    db.update(organizationSettings).set({ auto_greetings_enabled: false }).run();
  });

  function seedCustomerWithOccasionToday(name: string, kind: "birthday" | "anniversary") {
    // Use a past year with today's month-day so the worker's MM-DD match fires.
    const today = new Date();
    const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dateValue = `1990-${mmdd}`;
    return db
      .insert(customers)
      .values({
        name,
        phone: `90000${Math.floor(10000 + Math.random() * 89999)}`,
        birthday_date: kind === "birthday" ? dateValue : null,
        anniversary_date: kind === "anniversary" ? dateValue : null
      })
      .returning()
      .get();
  }

  it("does nothing while the toggle is off", () => {
    seedCustomerWithOccasionToday("Birthday Person", "birthday");
    const result = runGreetingsDispatch();
    expect(result.enabled).toBe(false);
    expect(result.birthdays_sent).toBe(0);
    expect(db.select().from(messageLogs).all()).toHaveLength(0);
  });

  it("auto-sends birthday and anniversary greetings once, and is idempotent on a second run", () => {
    seedCustomerWithOccasionToday("Birthday Person", "birthday");
    seedCustomerWithOccasionToday("Anniversary Person", "anniversary");
    db.update(organizationSettings).set({ auto_greetings_enabled: true }).run();

    const first = runGreetingsDispatch();
    expect(first.enabled).toBe(true);
    expect(first.birthdays_sent).toBe(1);
    expect(first.anniversaries_sent).toBe(1);

    const logs = db.select().from(messageLogs).all();
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.template_name).sort()).toEqual(["ANNIVERSARY_WISHES", "BIRTHDAY_WISHES"]);

    // Second run the same day must not re-send (dedup via messageLogs).
    const second = runGreetingsDispatch();
    expect(second.birthdays_sent).toBe(0);
    expect(second.anniversaries_sent).toBe(0);
    expect(second.skipped_already_sent).toBe(2);
    expect(db.select().from(messageLogs).all()).toHaveLength(2);
  });

  it("exposes the toggle (admin-only) and a manual run endpoint", async () => {
    seedCustomerWithOccasionToday("Birthday Person", "birthday");

    // Staff cannot flip the toggle.
    const staffPut = await request(app)
      .put("/api/messenger/auto-greetings")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ auto_greetings_enabled: true });
    expect(staffPut.status).toBe(403);

    const adminPut = await request(app)
      .put("/api/messenger/auto-greetings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ auto_greetings_enabled: true });
    expect(adminPut.status).toBe(200);
    expect(adminPut.body.auto_greetings_enabled).toBe(true);

    const runRes = await request(app)
      .post("/api/messenger/auto-greetings/run")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(runRes.status).toBe(200);
    expect(runRes.body.result.birthdays_sent).toBe(1);

    // Persisted in settings.
    const settings = db.select().from(organizationSettings).where(eq(organizationSettings.id, 1)).get();
    expect(settings?.auto_greetings_enabled).toBe(true);
  });

  it("skips occasions for customers with no phone", () => {
    db.insert(customers)
      .values({ name: "No Phone", phone: "", birthday_date: `1990-${new Date().toISOString().slice(5, 10)}` })
      .run();
    db.update(organizationSettings).set({ auto_greetings_enabled: true }).run();

    const result = runGreetingsDispatch();
    // Either skipped for no phone, or simply not sent; never logged as SENT.
    expect(result.birthdays_sent).toBe(0);
    const sent = db.select().from(messageLogs).where(sql`status = 'SENT'`).all();
    expect(sent).toHaveLength(0);
  });
});

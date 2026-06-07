import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../../src/db/client.js";
import { customers, ledgers, journalEntries } from "../../src/db/schema.js";

// Phase 2: verify the 0048 data migration consolidates a customer's split udhari
// ledgers into the canonical (min-id) one, netting the balance and re-pointing entries.
describe("migration 0048: merge split udhari ledgers", () => {
  it("consolidates split udhari ledgers into the canonical ledger and nets the balance", () => {
    const customer = db.insert(customers).values({ name: "Merge Cust", phone: "9000001111" }).returning().get();
    const a = db.insert(ledgers).values({ account_name: "Customer Udhari Merge Cust", account_type: "CUSTOMER_UDHARI", entity_id: customer.id, balance_paise: 15000 }).returning().get();
    const b = db.insert(ledgers).values({ account_name: `Customer Udhari ${customer.id}`, account_type: "CUSTOMER_UDHARI", entity_id: customer.id, balance_paise: -5000 }).returning().get();
    db.insert(journalEntries).values({ ledger_id: a.id, transaction_type: "DEBIT", amount_paise: 15000, reference_type: "MANUAL", reference_id: 0 }).run();
    db.insert(journalEntries).values({ ledger_id: b.id, transaction_type: "CREDIT", amount_paise: 5000, reference_type: "MANUAL", reference_id: 0 }).run();

    const canonicalId = Math.min(a.id, b.id);
    const otherId = Math.max(a.id, b.id);

    // Re-run the data migration against the inserted split scenario.
    sqlite.exec(readFileSync("drizzle/0048_udhari_ledger_merge.sql", "utf8"));

    const udhariRows = db
      .select()
      .from(ledgers)
      .where(and(eq(ledgers.entity_id, customer.id), eq(ledgers.account_type, "CUSTOMER_UDHARI")))
      .all();
    expect(udhariRows).toHaveLength(1);
    expect(udhariRows[0].id).toBe(canonicalId);
    expect(udhariRows[0].balance_paise).toBe(10000); // 15000 due - 5000 advance

    // Entries from the removed ledger now point at the canonical ledger.
    expect(db.select().from(journalEntries).where(eq(journalEntries.ledger_id, otherId)).all()).toHaveLength(0);
    expect(db.select().from(journalEntries).where(eq(journalEntries.ledger_id, canonicalId)).all()).toHaveLength(2);
  });

  it("leaves a customer with a single udhari ledger untouched (idempotent)", () => {
    const customer = db.insert(customers).values({ name: "Single Cust", phone: "9000002222" }).returning().get();
    const only = db.insert(ledgers).values({ account_name: "Customer Udhari Single Cust", account_type: "CUSTOMER_UDHARI", entity_id: customer.id, balance_paise: 7000 }).returning().get();

    sqlite.exec(readFileSync("drizzle/0048_udhari_ledger_merge.sql", "utf8"));

    const row = db.select().from(ledgers).where(eq(ledgers.id, only.id)).get();
    expect(row?.balance_paise).toBe(7000);
  });
});

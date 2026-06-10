import { and, desc, eq, or, like, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { logAction } from "../audit/logAction.js";
import { getOrCreateLedger } from "../accounts/posting.js";
import { db } from "../db/client.js";
import {
  customers,
  customerMetalBalances,
  gssAccounts,
  gssTemplates,
  girviLoans,
  girviCollateral,
  invoices,
  journalEntries,
  kycVault,
  ledgers,
  loyaltyLedger
} from "../db/schema.js";
import { decimalStringToInteger } from "../utils/decimal.js";

export const crmRouter = Router();

// Protect all CRM endpoints
crmRouter.use(requireAuth);

/**
 * GET /api/crm/customers
 * Returns a paginated list of customers matching optional filters:
 * - search: query string for name or phone
 * - area: filter by exact area
 * - upcoming_events: filter birthdays/anniversaries in the next 30 days
 */
crmRouter.get("/customers", (request, response) => {
  const query = request.query;
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const offset = (page - 1) * limit;

  const filters = [];

  // Search filter
  if (typeof query.search === "string" && query.search.trim()) {
    const searchPattern = `%${query.search.trim()}%`;
    filters.push(
      or(
        like(customers.name, searchPattern),
        like(customers.phone, searchPattern)
      )
    );
  }

  // Area filter
  if (typeof query.area === "string" && query.area.trim()) {
    filters.push(eq(customers.area, query.area.trim()));
  }

  // Upcoming Birthdays/Anniversaries filter (next 30 days)
  if (query.upcoming_events === "true") {
    const upcomingEventsSql = sql`
      (
        (
          (strftime('%Y', 'now') || substr(${customers.birthday_date}, 5) BETWEEN date('now') AND date('now', '+30 days'))
          OR
          ((strftime('%Y', 'now') + 1) || substr(${customers.birthday_date}, 5) BETWEEN date('now') AND date('now', '+30 days'))
        )
        OR
        (
          (strftime('%Y', 'now') || substr(${customers.anniversary_date}, 5) BETWEEN date('now') AND date('now', '+30 days'))
          OR
          ((strftime('%Y', 'now') + 1) || substr(${customers.anniversary_date}, 5) BETWEEN date('now') AND date('now', '+30 days'))
        )
      )
    `;
    filters.push(upcomingEventsSql);
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  try {
    // 1. Fetch total count of matching customers
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(whereClause)
      .get();
    const total = countResult?.count ?? 0;

    // 2. Fetch paginated customers
    const customerList = db
      .select()
      .from(customers)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .all();

    // 3. Fetch unique areas for filters
    const areasResult = db
      .select({ area: customers.area })
      .from(customers)
      .where(sql`${customers.area} IS NOT NULL AND ${customers.area} != ''`)
      .groupBy(customers.area)
      .all();
    const areas = areasResult.map((row) => row.area).filter((a): a is string => typeof a === "string");

    const totalPages = Math.ceil(total / limit) || 1;

    return response.json({
      customers: customerList,
      areas,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    console.error("Failed to query customers", error);
    return response.status(500).json({ errors: ["Failed to fetch customer list."] });
  }
});

/**
 * GET /api/crm/customers/:id/360
 * Aggregates and returns customer 360 using Drizzle's relational query API
 */
crmRouter.get("/customers/:id/360", (request, response) => {
  const customerId = Number(request.params.id);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  try {
    const customerData = db.query.customers.findFirst({
      where: eq(customers.id, customerId),
      with: {
        gssAccounts: {
          where: or(eq(gssAccounts.status, "ACTIVE"), eq(gssAccounts.status, "MATURED")),
          with: {
            template: true
          }
        },
        girviLoans: {
          with: {
            collateral: true
          }
        },
        invoices: true,
        ledgers: {
          where: eq(ledgers.account_type, "CUSTOMER_UDHARI")
        }
      }
    }).sync();

    if (!customerData) {
      return response.status(404).json({ errors: ["Customer not found."] });
    }

    // Format active/matured GSS Accounts
    const activeMaturedGss = customerData.gssAccounts.map((acc) => ({
      id: acc.id,
      customer_id: acc.customer_id,
      template_id: acc.template_id,
      card_number: acc.card_number,
      enrollment_date: acc.enrollment_date,
      maturity_date: acc.maturity_date,
      status: acc.status,
      total_paid_paise: acc.total_paid_paise,
      installments_paid_count: acc.installments_paid_count,
      template_name: acc.template?.scheme_name ?? "Unknown Scheme",
      monthly_amount_paise: acc.template?.monthly_amount_paise ?? 0,
      duration_months: acc.template?.duration_months ?? 0
    }));

    // Aggregate lifetime invoice history
    const totalAmountSpent = customerData.invoices.reduce(
      (sum, inv) => sum + inv.total_amount_paise,
      0
    );
    const lifetimeInvoiceHistory = {
      count: customerData.invoices.length,
      total_value_paise: totalAmountSpent
    };

    // Aggregate current CUSTOMER_UDHARI ledger balance
    const udhariBalancePaise = customerData.ledgers[0]?.balance_paise ?? 0;

    // Separate customer profile from relations
    const loyaltyHistory = db
      .select()
      .from(loyaltyLedger)
      .where(eq(loyaltyLedger.customer_id, customerId))
      .orderBy(desc(loyaltyLedger.created_at), desc(loyaltyLedger.id))
      .limit(25)
      .all();

    const { gssAccounts: _g, girviLoans: _l, invoices: _i, ledgers: _led, ...profile } = customerData;

    const metalBalances = db
      .select()
      .from(customerMetalBalances)
      .where(eq(customerMetalBalances.customer_id, customerId))
      .all();

    return response.json({
      customer: profile,
      gss_accounts: activeMaturedGss,
      girvi_loans: customerData.girviLoans,
      invoice_history: lifetimeInvoiceHistory,
      loyalty_ledger: loyaltyHistory,
      udhari_balance_paise: udhariBalancePaise,
      metal_balances: metalBalances
    });
  } catch (error) {
    console.error(`Failed to fetch 360 view for customer ${customerId}`, error);
    return response.status(500).json({ errors: ["Failed to fetch customer 360 view."] });
  }
});

/**
 * POST /api/crm/customers
 * Create a customer (used standalone in CRM and inline from POS billing).
 * An optional opening balance seeds the customer's CUSTOMER_UDHARI ledger.
 */
crmRouter.post("/customers", (request, response) => {
  const validation = validateCustomerPayload(request.body, { requireName: true });

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const existing = db.query.customers.findFirst({ where: eq(customers.phone, validation.values.phone) }).sync();
  if (existing) {
    return response.status(409).json({ errors: ["A customer with this phone number already exists."] });
  }

  const authUser = (request as AuthenticatedRequest).user;

  try {
    const created = db.transaction((tx) => {
      const customer = tx.insert(customers).values(validation.values).returning().get();

      // Seed opening balance into the customer's udhari ledger (one-time).
      if (validation.values.opening_balance_paise > 0) {
        const ledger = getOrCreateLedger(tx, `Udhari - ${customer.name}`, "CUSTOMER_UDHARI", customer.id);
        const signedDelta = validation.values.opening_balance_type === "DEBIT"
          ? validation.values.opening_balance_paise
          : -validation.values.opening_balance_paise;

        tx.update(ledgers)
          .set({ balance_paise: ledger.balance_paise + signedDelta })
          .where(eq(ledgers.id, ledger.id))
          .run();

        tx.insert(journalEntries).values({
          ledger_id: ledger.id,
          transaction_type: validation.values.opening_balance_type,
          amount_paise: validation.values.opening_balance_paise,
          reference_type: "OPENING_BALANCE",
          reference_id: customer.id,
          description: `Opening balance for ${customer.name}`
        }).run();
      }

      return customer;
    });

    logAction(authUser.id, "CREATE_CUSTOMER", "customers", created.id, null, created);
    return response.status(201).json({ customer: created });
  } catch (error) {
    console.error("Failed to create customer", error);
    return response.status(500).json({ errors: ["Failed to create customer."] });
  }
});

/**
 * PUT /api/crm/customers/:id
 * Update an existing customer's profile fields (opening balance is create-only).
 */
crmRouter.put("/customers/:id", (request, response) => {
  const customerId = Number(request.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  const validation = validateCustomerPayload(request.body, { requireName: true });
  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const existing = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!existing) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  const phoneOwner = db.query.customers.findFirst({ where: eq(customers.phone, validation.values.phone) }).sync();
  if (phoneOwner && phoneOwner.id !== customerId) {
    return response.status(409).json({ errors: ["Another customer already uses this phone number."] });
  }

  const authUser = (request as unknown as AuthenticatedRequest).user;
  // Opening balance is only applied at creation; do not re-seed on edit.
  const { opening_balance_paise: _obp, opening_balance_type: _obt, ...editable } = validation.values;

  const updated = db.update(customers).set(editable).where(eq(customers.id, customerId)).returning().get();
  logAction(authUser.id, "UPDATE_CUSTOMER", "customers", customerId, existing, updated);
  return response.json({ customer: updated });
});

/**
 * Metal-wise opening balances: fine weight the shop owes the customer or vice versa,
 * carried separately from the monetary udhari ledger.
 */
crmRouter.get("/customers/:id/metal-balances", (request, response) => {
  const customerId = Number(request.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  const balances = db
    .select()
    .from(customerMetalBalances)
    .where(eq(customerMetalBalances.customer_id, customerId))
    .all();

  return response.json({ metal_balances: balances });
});

crmRouter.post("/customers/:id/metal-balances", requireAdmin, (request, response) => {
  const customerId = Number(request.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const errors: string[] = [];

  const metalType = typeof body.metal_type === "string" ? body.metal_type.trim() : "";
  if (!["Gold", "Silver", "Platinum"].includes(metalType)) {
    errors.push("metal_type must be Gold, Silver or Platinum.");
  }

  const fineWeightMg = Number(body.fine_weight_mg);
  if (!Number.isInteger(fineWeightMg) || fineWeightMg <= 0) {
    errors.push("fine_weight_mg must be a positive integer.");
  }

  const direction = body.direction === "TO_PAY" ? "TO_PAY" : body.direction === "TO_RECEIVE" || body.direction === undefined ? "TO_RECEIVE" : null;
  if (!direction) {
    errors.push("direction must be TO_RECEIVE or TO_PAY.");
  }

  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  const authUser = (request as AuthenticatedRequest).user;
  const created = db
    .insert(customerMetalBalances)
    .values({
      customer_id: customerId,
      metal_type: metalType,
      fine_weight_mg: fineWeightMg,
      direction: direction as "TO_RECEIVE" | "TO_PAY",
      notes: optionalText(body.notes)
    })
    .returning()
    .get();

  logAction(authUser.id, "CREATE_CUSTOMER_METAL_BALANCE", "customer_metal_balances", created.id, null, created);
  return response.status(201).json({ metal_balance: created });
});

crmRouter.delete("/customers/:id/metal-balances/:balanceId", requireAdmin, (request, response) => {
  const customerId = Number(request.params.id);
  const balanceId = Number(request.params.balanceId);
  if (!Number.isInteger(customerId) || customerId <= 0 || !Number.isInteger(balanceId) || balanceId <= 0) {
    return response.status(400).json({ errors: ["Customer ID and balance ID must be positive integers."] });
  }

  const existing = db.query.customerMetalBalances.findFirst({
    where: and(eq(customerMetalBalances.id, balanceId), eq(customerMetalBalances.customer_id, customerId))
  }).sync();

  if (!existing) {
    return response.status(404).json({ errors: ["Metal balance entry not found."] });
  }

  db.delete(customerMetalBalances).where(eq(customerMetalBalances.id, balanceId)).run();

  const authUser = (request as AuthenticatedRequest).user;
  logAction(authUser.id, "DELETE_CUSTOMER_METAL_BALANCE", "customer_metal_balances", balanceId, existing, null);
  return response.json({ deleted: true });
});

const KYC_DOCUMENT_TYPES = new Set(["PAN", "AADHAAR", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID"]);

/**
 * POST /api/crm/customers/:id/kyc
 * Store a KYC document record (number is masked at rest). Accepts PAN, Aadhaar,
 * passport, driving licence and voter ID.
 */
crmRouter.post("/customers/:id/kyc", (request, response) => {
  const customerId = Number(request.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const documentType = typeof body.document_type === "string" ? body.document_type.trim().toUpperCase() : "";
  const documentNumber = typeof body.document_number === "string" ? body.document_number.trim() : "";

  if (!KYC_DOCUMENT_TYPES.has(documentType)) {
    return response.status(400).json({ errors: ["document_type must be PAN, AADHAAR, PASSPORT, DRIVING_LICENSE or VOTER_ID."] });
  }
  if (documentNumber.length < 4) {
    return response.status(400).json({ errors: ["document_number must be at least 4 characters."] });
  }

  const masked = `${"*".repeat(Math.max(documentNumber.length - 4, 0))}${documentNumber.slice(-4)}`;
  const authUser = (request as unknown as AuthenticatedRequest).user;

  const record = db
    .insert(kycVault)
    .values({
      customer_id: customerId,
      document_type: documentType as typeof kycVault.$inferInsert.document_type,
      document_number_masked: masked,
      document_image_path: optionalText(body.document_image_path),
      verified_by: authUser.id
    })
    .returning()
    .get();

  logAction(authUser.id, "CREATE_KYC_RECORD", "kyc_vault", record.id, null, { document_type: documentType });
  return response.status(201).json({ kyc_record: record });
});

/**
 * PATCH /api/crm/customers/:id/blacklist
 * Admin-only credit-risk control: a blacklisted customer cannot take girvi loans
 * or buy on udhari (cash sales remain allowed).
 */
crmRouter.patch("/customers/:id/blacklist", requireAdmin, (request, response) => {
  const customerId = Number(request.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["Customer ID must be a positive integer."] });
  }

  const existing = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!existing) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  if (typeof body.is_blacklisted !== "boolean") {
    return response.status(400).json({ errors: ["is_blacklisted must be a boolean."] });
  }

  const reason = optionalText(body.reason);
  if (body.is_blacklisted && !reason) {
    return response.status(400).json({ errors: ["reason is required when blacklisting a customer."] });
  }

  const updated = db
    .update(customers)
    .set({
      is_blacklisted: body.is_blacklisted,
      blacklist_reason: body.is_blacklisted ? reason : null
    })
    .where(eq(customers.id, customerId))
    .returning()
    .get();

  const authUser = (request as AuthenticatedRequest).user;
  logAction(
    authUser.id,
    body.is_blacklisted ? "BLACKLIST_CUSTOMER" : "UNBLACKLIST_CUSTOMER",
    "customers",
    customerId,
    { is_blacklisted: existing.is_blacklisted, blacklist_reason: existing.blacklist_reason },
    { is_blacklisted: updated.is_blacklisted, blacklist_reason: updated.blacklist_reason }
  );
  return response.json({ customer: updated });
});

type CustomerValidation =
  | { ok: true; values: typeof customers.$inferInsert & { opening_balance_paise: number; opening_balance_type: "DEBIT" | "CREDIT" } }
  | { ok: false; errors: string[] };

function validateCustomerPayload(body: unknown, opts: { requireName: boolean }): CustomerValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.replace(/\s+/g, "") : "";

  if (opts.requireName && !name) {
    errors.push("name is required.");
  }
  if (!/^\d{10,15}$/.test(phone)) {
    errors.push("phone must be 10 to 15 digits.");
  }

  const pan = optionalUpper(body.pan_number);
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    errors.push("PAN must be a valid PAN (e.g. ABCDE1234F).");
  }
  const aadhaar = optionalText(body.aadhaar_number);
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) {
    errors.push("Aadhaar number must be 12 digits.");
  }
  const gstin = optionalUpper(body.gstin);
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    errors.push("GSTIN must be a valid 15-character GSTIN.");
  }
  const email = optionalText(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email must be a valid email address.");
  }
  const birthday = optionalText(body.birthday_date);
  if (birthday && !isNotFutureDate(birthday)) {
    errors.push("Birth date must be a valid date and cannot be in the future.");
  }
  const anniversary = optionalText(body.anniversary_date);
  if (anniversary && !isNotFutureDate(anniversary)) {
    errors.push("Anniversary must be a valid date and cannot be in the future.");
  }

  const openingType = body.opening_balance_type === "CREDIT" ? "CREDIT" : "DEBIT";
  let openingPaise = 0;
  if (body.opening_balance !== undefined && body.opening_balance !== null && body.opening_balance !== "") {
    const parsed = decimalStringToInteger(body.opening_balance, 100, 2);
    if (!parsed.ok) {
      errors.push(`opening_balance: ${parsed.error}`);
    } else {
      openingPaise = parsed.value;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name,
      phone,
      email,
      whatsapp_phone: optionalText(body.whatsapp_phone) || null,
      gstin: gstin || null,
      address: optionalText(body.address) || null,
      area: optionalText(body.area) || null,
      taluka: optionalText(body.taluka) || null,
      district: optionalText(body.district) || null,
      birthday_date: birthday || null,
      anniversary_date: anniversary || null,
      ring_size: optionalText(body.ring_size) || null,
      spouse_name: optionalText(body.spouse_name) || null,
      pan_number: pan || null,
      aadhaar_number: aadhaar || null,
      kyc_photo_path: optionalText(body.kyc_photo_path) || null,
      loyalty_enrolled: Boolean(body.loyalty_enrolled),
      opening_balance_paise: openingPaise,
      opening_balance_type: openingType
    }
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Accepts a YYYY-MM-DD string that is a real calendar date and not after today.
function isNotFutureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return parsed.getTime() <= endOfToday.getTime();
}

function optionalUpper(value: unknown): string | null {
  const text = optionalText(value);
  return text ? text.toUpperCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { supplierMetalBalances, suppliers } from "../db/schema.js";

export const supplierRouter = Router();
supplierRouter.use(requireAuth);

// List suppliers (active by default) for the purchase-invoice dropdown.
supplierRouter.get("/", (request, response) => {
  const includeInactive = request.query.all === "true" || request.query.all === "1";
  const rows = includeInactive
    ? db.select().from(suppliers).all()
    : db.select().from(suppliers).where(eq(suppliers.is_active, true)).all();

  return response.json({ suppliers: rows });
});

supplierRouter.post("/", (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
  const gstin = typeof body.gstin === "string" && body.gstin.trim() ? body.gstin.trim().toUpperCase() : null;
  const address = typeof body.address === "string" && body.address.trim() ? body.address.trim() : null;

  if (!name) {
    return response.status(400).json({ errors: ["name is required."] });
  }

  // Optional monetary opening balance carried over from the previous ledger.
  const openingBalancePaise = Number(body.opening_balance_paise ?? 0);
  if (!Number.isInteger(openingBalancePaise) || openingBalancePaise < 0) {
    return response.status(400).json({ errors: ["opening_balance_paise must be a non-negative integer."] });
  }
  const openingBalanceType = body.opening_balance_type === "DEBIT" ? "DEBIT" : "CREDIT";

  const duplicate = db.query.suppliers.findFirst({ where: eq(suppliers.name, name) }).sync();
  if (duplicate) {
    return response.status(409).json({ errors: ["A supplier with this name already exists."] });
  }

  const supplier = db
    .insert(suppliers)
    .values({ name, phone, gstin, address, opening_balance_paise: openingBalancePaise, opening_balance_type: openingBalanceType })
    .returning()
    .get();

  return response.status(201).json({ supplier });
});

// Metal-wise opening balances (fine weight owed to/by the supplier).
supplierRouter.get("/:id/metal-balances", (request, response) => {
  const supplierId = Number(request.params.id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return response.status(400).json({ errors: ["Supplier ID must be a positive integer."] });
  }

  const balances = db
    .select()
    .from(supplierMetalBalances)
    .where(eq(supplierMetalBalances.supplier_id, supplierId))
    .all();

  return response.json({ metal_balances: balances });
});

supplierRouter.post("/:id/metal-balances", requireAdmin, (request, response) => {
  const supplierId = Number(request.params.id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    return response.status(400).json({ errors: ["Supplier ID must be a positive integer."] });
  }

  const supplier = db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) }).sync();
  if (!supplier) {
    return response.status(404).json({ errors: ["Supplier not found."] });
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

  const created = db
    .insert(supplierMetalBalances)
    .values({
      supplier_id: supplierId,
      metal_type: metalType,
      fine_weight_mg: fineWeightMg,
      direction: direction as "TO_RECEIVE" | "TO_PAY",
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null
    })
    .returning()
    .get();

  return response.status(201).json({ metal_balance: created });
});

supplierRouter.delete("/:id/metal-balances/:balanceId", requireAdmin, (request, response) => {
  const supplierId = Number(request.params.id);
  const balanceId = Number(request.params.balanceId);
  if (!Number.isInteger(supplierId) || supplierId <= 0 || !Number.isInteger(balanceId) || balanceId <= 0) {
    return response.status(400).json({ errors: ["Supplier ID and balance ID must be positive integers."] });
  }

  const existing = db.query.supplierMetalBalances.findFirst({
    where: and(eq(supplierMetalBalances.id, balanceId), eq(supplierMetalBalances.supplier_id, supplierId))
  }).sync();

  if (!existing) {
    return response.status(404).json({ errors: ["Metal balance entry not found."] });
  }

  db.delete(supplierMetalBalances).where(eq(supplierMetalBalances.id, balanceId)).run();
  return response.json({ deleted: true });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

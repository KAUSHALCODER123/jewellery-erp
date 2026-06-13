import { desc, eq, like, or } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { customerOrders, customers } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { postBalancedVoucher } from "../accounts/posting.js";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

function nextOrderNumber(): string {
  const rows = db.select({ n: customerOrders.order_number }).from(customerOrders).all();
  let max = 0;
  for (const row of rows) {
    const match = /^ORD-(\d+)$/.exec(row.n ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `ORD-${String(max + 1).padStart(4, "0")}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

ordersRouter.get("/next-number", (_req, res) => {
  return res.json({ order_number: nextOrderNumber() });
});

ordersRouter.get("/customers", (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const pattern = `%${search}%`;
  const rows = search
    ? db.select({ id: customers.id, name: customers.name, phone: customers.phone })
        .from(customers)
        .where(or(like(customers.name, pattern), like(customers.phone, pattern)))
        .limit(20).all()
    : db.select({ id: customers.id, name: customers.name, phone: customers.phone })
        .from(customers).limit(20).all();
  return res.json({ customers: rows });
});

ordersRouter.get("/", (req, res) => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status.toUpperCase() : null;
  const validStatuses = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

  const rows = db
    .select({
      order: customerOrders,
      customer_name: customers.name,
      customer_phone: customers.phone
    })
    .from(customerOrders)
    .innerJoin(customers, eq(customerOrders.customer_id, customers.id))
    .where(
      statusFilter && validStatuses.includes(statusFilter)
        ? eq(customerOrders.status, statusFilter as "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED")
        : undefined
    )
    .orderBy(desc(customerOrders.created_at))
    .all();

  return res.json({
    orders: rows.map((r) => ({
      ...r.order,
      target_weight_grams: (r.order.target_weight_mg / 1000).toFixed(3),
      customer_gold_grams: (r.order.customer_gold_mg / 1000).toFixed(3),
      advance_rupees: paiseToRupees(r.order.advance_paise),
      customer_name: r.customer_name,
      customer_phone: r.customer_phone
    }))
  });
});

ordersRouter.post("/", requireAdmin, (req, res) => {
  if (!isRecord(req.body)) return res.status(400).json({ errors: ["Request body must be a JSON object."] });
  const body = req.body;
  const errors: string[] = [];

  const customerId = Number(body.customer_id);
  const itemDescription = typeof body.item_description === "string" ? body.item_description.trim() : "";
  const targetWeightMg = Math.round(Number(body.target_weight_grams ?? 0) * 1000);
  const targetPurity = Number(body.target_purity ?? 9167);
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const customerGoldMg = Math.round(Number(body.customer_gold_grams ?? 0) * 1000);
  const customerGoldPurityTunch = Number(body.customer_gold_purity_tunch ?? 10000);
  const expectedByDate = typeof body.expected_by_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_by_date)
    ? body.expected_by_date : null;
  const advancePaise = Number(body.advance_paise ?? 0);
  const orderNumber = typeof body.order_number === "string" && body.order_number.trim()
    ? body.order_number.trim().toUpperCase()
    : nextOrderNumber();

  if (!Number.isInteger(customerId) || customerId <= 0) errors.push("customer_id must be a positive integer.");
  if (!itemDescription) errors.push("item_description is required.");
  if (!Number.isInteger(targetPurity) || targetPurity <= 0 || targetPurity > 10000) errors.push("target_purity must be between 1 and 10000.");
  if (!Number.isInteger(advancePaise) || advancePaise < 0) errors.push("advance_paise must be a non-negative integer.");
  if (!/^[A-Z0-9-]{3,40}$/.test(orderNumber)) errors.push("order_number must be 3-40 alphanumeric characters or hyphens.");
  if (errors.length > 0) return res.status(400).json({ errors });

  const customer = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!customer) return res.status(404).json({ errors: ["Customer not found."] });

  const userId = (req as AuthenticatedRequest).user.id;
  const order = db.transaction((tx) => {
    const created = tx.insert(customerOrders).values({
      order_number: orderNumber,
      customer_id: customerId,
      item_description: itemDescription,
      target_weight_mg: targetWeightMg,
      target_purity: targetPurity,
      notes,
      customer_gold_mg: customerGoldMg,
      customer_gold_purity_tunch: customerGoldPurityTunch,
      expected_by_date: expectedByDate,
      advance_paise: advancePaise,
      status: "OPEN"
    }).returning().get();

    // An advance is cash received against an undelivered order: record it as a
    // customer credit (their udhari ledger goes negative — the shop owes them goods
    // or a refund). It is consumed when the order is converted to an invoice.
    if (advancePaise > 0) {
      postBalancedVoucher(tx, {
        voucherType: "CUSTOMER_ORDER_ADVANCE",
        referenceType: "CUSTOMER_ORDER_ADVANCE",
        referenceId: created.id,
        narration: `Advance received for order ${created.order_number}`,
        createdBy: userId,
        lines: [
          { ledgerName: "Cash", accountType: "CASH", transactionType: "DEBIT", amountPaise: advancePaise, description: `Advance received for ${created.order_number}` },
          { ledgerName: `Customer Udhari ${customerId}`, accountType: "CUSTOMER_UDHARI", entityId: customerId, transactionType: "CREDIT", amountPaise: advancePaise, description: `Advance credit for ${created.order_number}` }
        ]
      });
    }

    return created;
  });

  return res.status(201).json({
    order: {
      ...order,
      target_weight_grams: (order.target_weight_mg / 1000).toFixed(3),
      customer_gold_grams: (order.customer_gold_mg / 1000).toFixed(3),
      advance_rupees: paiseToRupees(order.advance_paise),
      customer_name: customer.name,
      customer_phone: customer.phone
    }
  });
});

ordersRouter.patch("/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ errors: ["Invalid order id."] });

  const validStatuses = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const newStatus = typeof req.body?.status === "string" ? req.body.status.toUpperCase() : "";
  if (!validStatuses.includes(newStatus)) return res.status(400).json({ errors: ["status must be OPEN, IN_PROGRESS, COMPLETED, or CANCELLED."] });

  const order = db.query.customerOrders.findFirst({ where: eq(customerOrders.id, id) }).sync();
  if (!order) return res.status(404).json({ errors: ["Order not found."] });

  const updated = db.update(customerOrders)
    .set({ status: newStatus as "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" })
    .where(eq(customerOrders.id, id))
    .returning().get();

  return res.json({ order: updated });
});

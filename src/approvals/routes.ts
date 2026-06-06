import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { approvalMemoLines, approvalMemos, customers, items } from "../db/schema.js";
import { milligramsToGrams, paiseToRupees } from "../utils/decimal.js";

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextMemoNumber(): string {
  const rows = db.select({ n: approvalMemos.memo_number }).from(approvalMemos).all();
  let max = 0;
  for (const row of rows) {
    const match = /^MEMO-(\d+)$/.exec(row.n ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `MEMO-${String(max + 1).padStart(4, "0")}`;
}

function formatLine(line: typeof approvalMemoLines.$inferSelect) {
  return {
    ...line,
    gross_weight_g: milligramsToGrams(line.gross_weight_mg),
    net_weight_g: milligramsToGrams(line.net_weight_mg),
    estimated_value_rupees: paiseToRupees(line.estimated_value_paise)
  };
}

function formatMemo(memo: typeof approvalMemos.$inferSelect, lines: (typeof approvalMemoLines.$inferSelect)[]) {
  const outCount = lines.filter((l) => l.line_status === "OUT").length;
  const totalValuePaise = lines.reduce((sum, l) => sum + (l.line_status === "OUT" ? l.estimated_value_paise : 0), 0);
  return {
    ...memo,
    lines: lines.map(formatLine),
    line_count: lines.length,
    out_count: outCount,
    out_value_rupees: paiseToRupees(totalValuePaise)
  };
}

// Recompute a memo's status from its line states.
function deriveStatus(lines: (typeof approvalMemoLines.$inferSelect)[]): "OPEN" | "PARTIAL" | "CLOSED" | "CONVERTED" {
  if (lines.length === 0) return "OPEN";
  const out = lines.filter((l) => l.line_status === "OUT").length;
  const sold = lines.filter((l) => l.line_status === "SOLD").length;
  if (out === 0) {
    return sold > 0 ? "CONVERTED" : "CLOSED";
  }
  if (out === lines.length) return "OPEN";
  return "PARTIAL";
}

approvalsRouter.get("/next-number", (_req, res) => {
  return res.json({ memo_number: nextMemoNumber() });
});

// Customer lookup for the issue form (mirrors orders router).
approvalsRouter.get("/customers", (req, res) => {
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

// In-stock items available to put on a memo (excludes sold/melted/already-out items).
approvalsRouter.get("/available-items", (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const base = db.select().from(items).where(eq(items.status, "IN_STOCK"));
  const rows = base.all().filter((it) => {
    if (!search) return true;
    const hay = `${it.barcode} ${it.category} ${it.design_name ?? ""} ${it.metal_type}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }).slice(0, 50);
  return res.json({
    items: rows.map((it) => ({
      id: it.id,
      barcode: it.barcode,
      category: it.category,
      metal_type: it.metal_type,
      purity_karat: it.purity_karat,
      gross_weight_mg: it.gross_weight_mg,
      net_weight_mg: it.net_weight_mg,
      gross_weight_g: milligramsToGrams(it.gross_weight_mg),
      net_weight_g: milligramsToGrams(it.net_weight_mg),
      design_name: it.design_name
    }))
  });
});

approvalsRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const validStatuses = new Set(["OPEN", "PARTIAL", "CLOSED", "CONVERTED"]);
  const memoRows = db
    .select()
    .from(approvalMemos)
    .where(validStatuses.has(status) ? eq(approvalMemos.status, status as "OPEN") : undefined)
    .orderBy(desc(approvalMemos.id))
    .all();

  const memoIds = memoRows.map((m) => m.id);
  const lineRows = memoIds.length
    ? db.select().from(approvalMemoLines).where(inArray(approvalMemoLines.memo_id, memoIds)).all()
    : [];
  const linesByMemo = new Map<number, (typeof approvalMemoLines.$inferSelect)[]>();
  for (const line of lineRows) {
    const list = linesByMemo.get(line.memo_id) ?? [];
    list.push(line);
    linesByMemo.set(line.memo_id, list);
  }

  return res.json({
    memos: memoRows.map((m) => formatMemo(m, linesByMemo.get(m.id) ?? []))
  });
});

approvalsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ errors: ["Memo id must be a positive integer."] });
  }
  const memo = db.query.approvalMemos.findFirst({ where: eq(approvalMemos.id, id) }).sync();
  if (!memo) {
    return res.status(404).json({ errors: ["Approval memo not found."] });
  }
  const lines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, id)).all();
  return res.json({ memo: formatMemo(memo, lines) });
});

// Issue items on approval. Moves each linked stock item to ON_APPROVAL so it cannot be billed twice.
approvalsRouter.post("/", (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const errors: string[] = [];

  const memoType = body.memo_type === "OUTWARD" ? "OUTWARD" : "CUSTOMER";
  const partyName = typeof body.party_name === "string" ? body.party_name.trim() : "";
  const partyPhone = typeof body.party_phone === "string" ? body.party_phone.trim() : null;
  const customerId = Number.isInteger(Number(body.customer_id)) && Number(body.customer_id) > 0 ? Number(body.customer_id) : null;
  const issueDate = typeof body.issue_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issue_date) ? body.issue_date : todayIso();
  const dueDate = typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];

  if (!partyName) errors.push("party_name is required.");
  if (rawLines.length === 0) errors.push("At least one item line is required.");

  // Resolve and validate item lines.
  type ResolvedLine = {
    item_id: number | null; description: string; barcode: string | null; metal_type: string | null;
    purity_karat: number | null; gross_weight_mg: number; net_weight_mg: number; estimated_value_paise: number;
  };
  const resolved: ResolvedLine[] = [];
  const itemIdsToReserve: number[] = [];

  for (const raw of rawLines) {
    if (!isRecord(raw)) continue;
    const itemId = Number.isInteger(Number(raw.item_id)) && Number(raw.item_id) > 0 ? Number(raw.item_id) : null;
    if (itemId) {
      const item = db.query.items.findFirst({ where: eq(items.id, itemId) }).sync();
      if (!item) {
        errors.push(`Item ${itemId} not found.`);
        continue;
      }
      if (item.status !== "IN_STOCK") {
        errors.push(`Item ${item.barcode} is not in stock (status ${item.status}).`);
        continue;
      }
      itemIdsToReserve.push(itemId);
      resolved.push({
        item_id: itemId,
        description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : `${item.metal_type} ${item.purity_karat}K ${item.category}`,
        barcode: item.barcode,
        metal_type: item.metal_type,
        purity_karat: item.purity_karat,
        gross_weight_mg: item.gross_weight_mg,
        net_weight_mg: item.net_weight_mg,
        estimated_value_paise: Number.isInteger(Number(raw.estimated_value_paise)) ? Number(raw.estimated_value_paise) : 0
      });
    } else {
      // Free-text line (e.g. an outward memo of loose stock not yet barcoded).
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      if (!description) {
        errors.push("Each non-barcoded line needs a description.");
        continue;
      }
      resolved.push({
        item_id: null,
        description,
        barcode: typeof raw.barcode === "string" ? raw.barcode.trim() || null : null,
        metal_type: typeof raw.metal_type === "string" ? raw.metal_type.trim() || null : null,
        purity_karat: Number.isInteger(Number(raw.purity_karat)) ? Number(raw.purity_karat) : null,
        gross_weight_mg: Number.isInteger(Number(raw.gross_weight_mg)) ? Number(raw.gross_weight_mg) : 0,
        net_weight_mg: Number.isInteger(Number(raw.net_weight_mg)) ? Number(raw.net_weight_mg) : 0,
        estimated_value_paise: Number.isInteger(Number(raw.estimated_value_paise)) ? Number(raw.estimated_value_paise) : 0
      });
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const memoNumber = nextMemoNumber();

  try {
    const created = db.transaction((tx) => {
      const memo = tx.insert(approvalMemos).values({
        memo_number: memoNumber,
        memo_type: memoType,
        customer_id: customerId,
        party_name: partyName,
        party_phone: partyPhone,
        issue_date: issueDate,
        due_date: dueDate,
        status: "OPEN",
        notes,
        created_by: userId
      }).returning().get();

      for (const line of resolved) {
        tx.insert(approvalMemoLines).values({
          memo_id: memo.id,
          item_id: line.item_id,
          description: line.description,
          barcode: line.barcode,
          metal_type: line.metal_type,
          purity_karat: line.purity_karat,
          gross_weight_mg: line.gross_weight_mg,
          net_weight_mg: line.net_weight_mg,
          estimated_value_paise: line.estimated_value_paise,
          line_status: "OUT"
        }).run();
      }

      // Reserve linked stock so it cannot be sold elsewhere while out on approval.
      if (itemIdsToReserve.length > 0) {
        tx.update(items)
          .set({ status: "ON_APPROVAL", location: "ON_APPROVAL" })
          .where(inArray(items.id, itemIdsToReserve))
          .run();
      }

      const lines = tx.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, memo.id)).all();
      return { memo, lines };
    });

    logAction(userId, "CREATE_APPROVAL_MEMO", "approval_memos", created.memo.id, null, { memo_number: memoNumber, lines: created.lines.length });
    return res.status(201).json({ memo: formatMemo(created.memo, created.lines) });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to create approval memo."] });
  }
});

// Return some or all lines to stock. Body: { line_ids: number[] } (omit to return all OUT lines).
approvalsRouter.post("/:id/return", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ errors: ["Memo id must be a positive integer."] });
  }
  const memo = db.query.approvalMemos.findFirst({ where: eq(approvalMemos.id, id) }).sync();
  if (!memo) {
    return res.status(404).json({ errors: ["Approval memo not found."] });
  }

  const body = isRecord(req.body) ? req.body : {};
  const requestedIds = Array.isArray(body.line_ids) ? body.line_ids.map(Number).filter((n) => Number.isInteger(n)) : null;

  const allLines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, id)).all();
  const targetLines = allLines.filter((l) => l.line_status === "OUT" && (requestedIds === null || requestedIds.includes(l.id)));

  if (targetLines.length === 0) {
    return res.status(400).json({ errors: ["No matching out-on-approval lines to return."] });
  }

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  try {
    const updated = db.transaction((tx) => {
      const now = new Date().toISOString();
      const lineIds = targetLines.map((l) => l.id);
      tx.update(approvalMemoLines)
        .set({ line_status: "RETURNED", returned_at: now })
        .where(inArray(approvalMemoLines.id, lineIds))
        .run();

      // Put reserved stock items back on the floor.
      const itemIds = targetLines.map((l) => l.item_id).filter((x): x is number => typeof x === "number");
      if (itemIds.length > 0) {
        tx.update(items).set({ status: "IN_STOCK", location: "VAULT" }).where(inArray(items.id, itemIds)).run();
      }

      const refreshed = tx.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, id)).all();
      const nextStatus = deriveStatus(refreshed);
      const memoRow = tx.update(approvalMemos).set({ status: nextStatus }).where(eq(approvalMemos.id, id)).returning().get();
      return { memo: memoRow, lines: refreshed };
    });

    logAction(userId, "RETURN_APPROVAL_LINES", "approval_memos", id, null, { returned: targetLines.length });
    return res.json({ memo: formatMemo(updated.memo, updated.lines) });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to return approval lines."] });
  }
});

// Mark lines as sold/converted (the actual GST bill is raised in POS; this just releases them from
// the memo register and records the link). Body: { line_ids: number[], invoice_id?: number }.
approvalsRouter.post("/:id/convert", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ errors: ["Memo id must be a positive integer."] });
  }
  const memo = db.query.approvalMemos.findFirst({ where: eq(approvalMemos.id, id) }).sync();
  if (!memo) {
    return res.status(404).json({ errors: ["Approval memo not found."] });
  }

  const body = isRecord(req.body) ? req.body : {};
  const requestedIds = Array.isArray(body.line_ids) ? body.line_ids.map(Number).filter((n) => Number.isInteger(n)) : null;
  const invoiceId = Number.isInteger(Number(body.invoice_id)) && Number(body.invoice_id) > 0 ? Number(body.invoice_id) : null;

  const allLines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, id)).all();
  const targetLines = allLines.filter((l) => l.line_status === "OUT" && (requestedIds === null || requestedIds.includes(l.id)));

  if (targetLines.length === 0) {
    return res.status(400).json({ errors: ["No matching out-on-approval lines to convert."] });
  }

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  try {
    const updated = db.transaction((tx) => {
      const lineIds = targetLines.map((l) => l.id);
      tx.update(approvalMemoLines)
        .set({ line_status: "SOLD", invoice_id: invoiceId })
        .where(inArray(approvalMemoLines.id, lineIds))
        .run();

      // Linked items become sold and leave the reserved state.
      const itemIds = targetLines.map((l) => l.item_id).filter((x): x is number => typeof x === "number");
      if (itemIds.length > 0) {
        tx.update(items).set({ status: "SOLD" }).where(inArray(items.id, itemIds)).run();
      }

      const refreshed = tx.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, id)).all();
      const nextStatus = deriveStatus(refreshed);
      const memoRow = tx.update(approvalMemos).set({ status: nextStatus }).where(eq(approvalMemos.id, id)).returning().get();
      return { memo: memoRow, lines: refreshed };
    });

    logAction(userId, "CONVERT_APPROVAL_LINES", "approval_memos", id, null, { converted: targetLines.length, invoice_id: invoiceId });
    return res.json({ memo: formatMemo(updated.memo, updated.lines) });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to convert approval lines."] });
  }
});

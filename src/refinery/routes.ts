import { desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAuth, requireRoles, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  items,
  refineries,
  refineryReceipts,
  refineryTransfers
} from "../db/schema.js";
import { paiseToRupees, milligramsToGrams } from "../utils/decimal.js";

export const refineryRouter = Router();

// Protect all refinery routes to ADMIN and MANAGER
refineryRouter.use(requireAuth);
refineryRouter.use(requireRoles("ADMIN", "MANAGER"));

// GET /api/refineries - List all refineries
refineryRouter.get("/", (_request, response) => {
  try {
    const rows = db.select().from(refineries).all();
    return response.json({
      refineries: rows.map((r) => ({
        ...r,
        fine_gold_balance_grams: milligramsToGrams(r.fine_gold_balance_mg),
        cash_balance_rupees: paiseToRupees(r.cash_balance_paise)
      }))
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to list refineries."] });
  }
});

// POST /api/refineries - Create a new refinery
refineryRouter.post("/", (request, response) => {
  const { name, phone } = request.body;

  if (typeof name !== "string" || !name.trim()) {
    return response.status(400).json({ errors: ["Refinery name is required."] });
  }

  try {
    const refinery = db
      .insert(refineries)
      .values({
        name: name.trim(),
        phone: typeof phone === "string" ? phone.trim() : null,
        fine_gold_balance_mg: 0,
        cash_balance_paise: 0
      })
      .returning()
      .get();

    return response.status(201).json({
      refinery: {
        ...refinery,
        fine_gold_balance_grams: milligramsToGrams(refinery.fine_gold_balance_mg),
        cash_balance_rupees: paiseToRupees(refinery.cash_balance_paise)
      }
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to create refinery."] });
  }
});

// POST /api/refineries/transfers - Issue scrap to refinery
refineryRouter.post("/transfers", (request, response) => {
  const body = request.body;
  const errors: string[] = [];

  const refineryId = Number(body.refinery_id);
  const transferDate = typeof body.transfer_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.transfer_date)
    ? body.transfer_date
    : new Date().toISOString().slice(0, 10);
  const metalType = typeof body.metal_type === "string" && body.metal_type.trim()
    ? body.metal_type.trim()
    : "Gold";
  const grossWeightMg = Number(body.gross_weight_mg);
  const purityTunch = Number(body.purity_tunch); // e.g. 99.90 or 92
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (!Number.isInteger(refineryId)) {
    errors.push("refinery_id is required and must be an integer.");
  }
  if (!Number.isInteger(grossWeightMg) || grossWeightMg <= 0) {
    errors.push("gross_weight_mg must be a positive integer.");
  }
  if (Number.isNaN(purityTunch) || purityTunch <= 0 || purityTunch > 100) {
    errors.push("purity_tunch must be a percentage between 0 and 100.");
  }

  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  const refinery = db.query.refineries.findFirst({
    where: eq(refineries.id, refineryId)
  }).sync();

  if (!refinery) {
    return response.status(404).json({ errors: ["Refinery not found."] });
  }

  const fineGoldMg = Math.round((grossWeightMg * purityTunch) / 100);
  const userId = (request as AuthenticatedRequest).user.id;

  try {
    const result = db.transaction((tx) => {
      const transfer = tx
        .insert(refineryTransfers)
        .values({
          refinery_id: refineryId,
          transfer_date: transferDate,
          metal_type: metalType,
          gross_weight_mg: grossWeightMg,
          purity_tunch: purityTunch,
          fine_gold_mg: fineGoldMg,
          description,
          created_by: userId
        })
        .returning()
        .get();

      tx.update(refineries)
        .set({
          fine_gold_balance_mg: refinery.fine_gold_balance_mg + fineGoldMg
        })
        .where(eq(refineries.id, refineryId))
        .run();

      return transfer;
    });

    return response.status(201).json({
      transfer: {
        ...result,
        gross_weight_grams: milligramsToGrams(result.gross_weight_mg),
        fine_gold_grams: milligramsToGrams(result.fine_gold_mg)
      }
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to process transfer."] });
  }
});

// POST /api/refineries/receipts - Receive fine gold and pay charges
refineryRouter.post("/receipts", (request, response) => {
  const body = request.body;
  const errors: string[] = [];

  const refineryId = Number(body.refinery_id);
  const receiveDate = typeof body.receive_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.receive_date)
    ? body.receive_date
    : new Date().toISOString().slice(0, 10);
  const fineGoldReceivedMg = Number(body.fine_gold_received_mg);
  const chargesPaise = Number(body.charges_paise);
  const paymentMode = typeof body.payment_mode === "string" && body.payment_mode.trim()
    ? body.payment_mode.trim().toUpperCase()
    : "CASH";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  // By default the returned fine gold is minted as a 24K bullion bar into master stock.
  const addToStock = body.add_to_stock === undefined ? true : Boolean(body.add_to_stock);
  const customBarcode = typeof body.barcode === "string" && body.barcode.trim() ? body.barcode.trim() : null;
  const stockLocation = typeof body.location === "string" && body.location.trim() ? body.location.trim() : "VAULT";

  if (!Number.isInteger(refineryId)) {
    errors.push("refinery_id is required and must be an integer.");
  }
  if (!Number.isInteger(fineGoldReceivedMg) || fineGoldReceivedMg < 0) {
    errors.push("fine_gold_received_mg must be a non-negative integer.");
  }
  if (!Number.isInteger(chargesPaise) || chargesPaise < 0) {
    errors.push("charges_paise must be a non-negative integer.");
  }

  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  const refinery = db.query.refineries.findFirst({
    where: eq(refineries.id, refineryId)
  }).sync();

  if (!refinery) {
    return response.status(404).json({ errors: ["Refinery not found."] });
  }

  // A custom barcode must be unique across the stock catalog.
  if (customBarcode) {
    const duplicate = db.query.items.findFirst({ where: eq(items.barcode, customBarcode) }).sync();
    if (duplicate) {
      return response.status(409).json({ errors: ["An item already exists with this bullion barcode."] });
    }
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const willMintBullion = addToStock && fineGoldReceivedMg > 0;

  try {
    const result = db.transaction((tx) => {
      const receipt = tx
        .insert(refineryReceipts)
        .values({
          refinery_id: refineryId,
          receive_date: receiveDate,
          fine_gold_received_mg: fineGoldReceivedMg,
          charges_paise: chargesPaise,
          payment_mode: paymentMode,
          description,
          created_by: userId
        })
        .returning()
        .get();

      tx.update(refineries)
        .set({
          fine_gold_balance_mg: refinery.fine_gold_balance_mg - fineGoldReceivedMg,
          cash_balance_paise: refinery.cash_balance_paise + chargesPaise
        })
        .where(eq(refineries.id, refineryId))
        .run();

      // Mint the pure 24K gold back into master stock as a fine bullion bar so the
      // shop's gram-to-gram metal balance closes the refining loop.
      let bullionItem = null;
      if (willMintBullion) {
        const barcode = customBarcode ?? `FINE-24K-R${receipt.id}`;
        bullionItem = tx
          .insert(items)
          .values({
            barcode,
            huid: null,
            category: "Bullion / Fine Gold",
            metal_type: "Gold",
            purity_karat: 24,
            gross_weight_mg: fineGoldReceivedMg,
            stone_weight_mg: 0,
            black_bead_weight_mg: 0,
            net_weight_mg: fineGoldReceivedMg,
            final_weight_mg: fineGoldReceivedMg,
            fine_weight_mg: fineGoldReceivedMg,
            making_charge_type: "FLAT",
            making_charge_value: 0,
            design_name: `Refined 24K Fine Gold (${refinery.name})`,
            tag_prefix: "FINE",
            location: stockLocation,
            purchase_date: receiveDate,
            status: "IN_STOCK",
            is_urd_recycled_gold: true
          })
          .returning()
          .get();
      }

      return { receipt, bullionItem };
    });

    return response.status(201).json({
      receipt: {
        ...result.receipt,
        fine_gold_received_grams: milligramsToGrams(result.receipt.fine_gold_received_mg),
        charges_rupees: paiseToRupees(result.receipt.charges_paise)
      },
      bullion_item: result.bullionItem
        ? {
            ...result.bullionItem,
            fine_weight_grams: milligramsToGrams(result.bullionItem.fine_weight_mg)
          }
        : null
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to process receipt."] });
  }
});

// GET /api/refineries/:id/ledger - Timeline and balances
refineryRouter.get("/:id/ledger", (request, response) => {
  const refineryId = Number(request.params.id);

  if (!Number.isInteger(refineryId)) {
    return response.status(400).json({ errors: ["Refinery id must be an integer."] });
  }

  const refinery = db.query.refineries.findFirst({
    where: eq(refineries.id, refineryId)
  }).sync();

  if (!refinery) {
    return response.status(404).json({ errors: ["Refinery not found."] });
  }

  try {
    const transfers = db
      .select()
      .from(refineryTransfers)
      .where(eq(refineryTransfers.refinery_id, refineryId))
      .all();

    const receipts = db
      .select()
      .from(refineryReceipts)
      .where(eq(refineryReceipts.refinery_id, refineryId))
      .all();

    // Map to a common timeline entry format
    const timelineEvents = [
      ...transfers.map((t) => ({
        id: `t_${t.id}`,
        date: t.transfer_date,
        type: "TRANSFER" as const,
        description: t.description || `Issued scrap (${t.metal_type})`,
        gross_weight_mg: t.gross_weight_mg,
        purity_tunch: t.purity_tunch,
        fine_gold_delta_mg: t.fine_gold_mg, // Transfer increases what we are owed
        cash_delta_paise: 0,
        ref_id: t.id
      })),
      ...receipts.map((r) => ({
        id: `r_${r.id}`,
        date: r.receive_date,
        type: "RECEIPT" as const,
        description: r.description || `Received fine gold / charges paid`,
        gross_weight_mg: 0,
        purity_tunch: 100,
        fine_gold_delta_mg: -r.fine_gold_received_mg, // Receipt decreases what we are owed
        cash_delta_paise: r.charges_paise, // Receipt charges increase cash balance
        ref_id: r.id
      }))
    ];

    // Sort chronologically ascending to calculate running balances
    timelineEvents.sort((a, b) => a.date.localeCompare(b.date));

    let runningFineGoldMg = 0;
    let runningCashPaise = 0;

    const enrichedTimeline = timelineEvents.map((event) => {
      runningFineGoldMg += event.fine_gold_delta_mg;
      runningCashPaise += event.cash_delta_paise;

      return {
        ...event,
        fine_gold_delta_grams: milligramsToGrams(event.fine_gold_delta_mg),
        cash_delta_rupees: paiseToRupees(event.cash_delta_paise),
        running_fine_gold_grams: milligramsToGrams(runningFineGoldMg),
        running_cash_rupees: paiseToRupees(runningCashPaise),
        running_fine_gold_mg: runningFineGoldMg,
        running_cash_paise: runningCashPaise
      };
    });

    // Reverse for displaying newest first
    enrichedTimeline.reverse();

    return response.json({
      refinery: {
        ...refinery,
        fine_gold_balance_grams: milligramsToGrams(refinery.fine_gold_balance_mg),
        cash_balance_rupees: paiseToRupees(refinery.cash_balance_paise)
      },
      timeline: enrichedTimeline
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to retrieve ledger."] });
  }
});

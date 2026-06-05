import { and, eq, like, or, sql, type SQL } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { barcodeSequences, items, stockVerificationScans, stockVerificationSessions, scannerAuditLogs, itemGroups, itemDefinitions } from "../db/schema.js";
import { milligramsToGrams, paiseToRupees } from "../utils/decimal.js";

export const inventoryRouter = Router();
const ITEM_STATUSES = new Set(["IN_STOCK", "IN_MEMO", "SOLD", "MELTED"]);
const MAKING_CHARGE_TYPES = new Set(["PER_GRAM", "FLAT"]);
const HUID_PATTERN = /^[A-Z0-9]{6}$/;
const BARCODE_PREFIX_PATTERN = /^[A-Z]{2,5}$/;

// ── Item group / category master (configurable catalog) ────────────────
inventoryRouter.get("/item-groups", requireAuth, (request, response) => {
  const activeOnly = request.query.active === "true";
  const rows = db.select().from(itemGroups).where(activeOnly ? eq(itemGroups.is_active, true) : undefined).all();
  return response.json({ item_groups: rows });
});

inventoryRouter.post("/item-groups", requireAuth, requireAdmin, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return response.status(400).json({ errors: ["name is required."] });
  }

  const existing = db.query.itemGroups.findFirst({ where: eq(itemGroups.name, name) }).sync();
  if (existing) {
    return response.status(409).json({ errors: ["An item group with this name already exists."] });
  }

  const metalType = typeof body.metal_type === "string" && body.metal_type.trim() ? body.metal_type.trim() : null;
  const hsnCode = typeof body.hsn_code === "string" && body.hsn_code.trim() ? body.hsn_code.trim() : null;
  const defaultUomRaw = typeof body.default_uom === "string" ? body.default_uom.toUpperCase() : "GRAM";
  const defaultUom: "GRAM" | "CARAT" | "PIECE" = defaultUomRaw === "CARAT" ? "CARAT" : defaultUomRaw === "PIECE" ? "PIECE" : "GRAM";

  const group = db.insert(itemGroups)
    .values({ name, metal_type: metalType, hsn_code: hsnCode, default_uom: defaultUom, is_active: true })
    .returning()
    .get();
  return response.status(201).json({ item_group: group });
});

// ── Item Master: reusable item templates (define once → tag many) ──────
inventoryRouter.get("/item-definitions", requireAuth, (request, response) => {
  const activeOnly = request.query.active === "true";
  const rows = db.select().from(itemDefinitions).where(activeOnly ? eq(itemDefinitions.is_active, true) : undefined).all();
  return response.json({ item_definitions: rows });
});

inventoryRouter.post("/item-definitions", requireAuth, requireAdmin, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const metalType = typeof body.metal_type === "string" && body.metal_type.trim() ? body.metal_type.trim() : "Gold";

  if (!name) {
    return response.status(400).json({ errors: ["name is required."] });
  }
  if (!category) {
    return response.status(400).json({ errors: ["category is required."] });
  }

  const existing = db.query.itemDefinitions.findFirst({ where: eq(itemDefinitions.name, name) }).sync();
  if (existing) {
    return response.status(409).json({ errors: ["An item template with this name already exists."] });
  }

  const purityKarat = Number.isInteger(body.purity_karat) && (body.purity_karat as number) > 0 ? (body.purity_karat as number) : 22;
  const saleMode = body.sale_mode === "QUANTITY_WISE" ? "QUANTITY_WISE" : "WEIGHT_WISE";
  const uomRaw = typeof body.uom === "string" ? body.uom.toUpperCase() : "GRAM";
  const uom: "GRAM" | "CARAT" | "PIECE" = uomRaw === "CARAT" ? "CARAT" : uomRaw === "PIECE" ? "PIECE" : "GRAM";
  const makingChargeType = body.making_charge_type === "FLAT" ? "FLAT" : "PER_GRAM";
  const makingChargeValue = Number.isInteger(body.making_charge_value) && (body.making_charge_value as number) >= 0 ? (body.making_charge_value as number) : 0;
  const prefixSource = typeof body.tag_prefix === "string" && body.tag_prefix.trim() ? body.tag_prefix : category;
  const tagPrefix = prefixSource.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "ITM";
  const hsnCode = typeof body.hsn_code === "string" && body.hsn_code.trim() ? body.hsn_code.trim() : null;

  const definition = db.insert(itemDefinitions)
    .values({
      name,
      category,
      metal_type: metalType,
      purity_karat: purityKarat,
      sale_mode: saleMode,
      uom,
      making_charge_type: makingChargeType,
      making_charge_value: makingChargeValue,
      tag_prefix: tagPrefix,
      hsn_code: hsnCode,
      is_active: true
    })
    .returning()
    .get();

  return response.status(201).json({ item_definition: definition });
});

inventoryRouter.get("/", requireAuth, (request, response) => {
  const filters = buildInventoryFilters(request.query);
  const rows = db
    .select()
    .from(items)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .all();

  return response.json({
    items: rows.map(formatInventoryItem)
  });
});

inventoryRouter.post("/add", requireAuth, (request, response) => {
  const validation = validateInventoryAddPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const duplicate = db.query.items.findFirst({
    where: validation.item.huid
      ? or(eq(items.barcode, validation.item.barcode), eq(items.huid, validation.item.huid))
      : eq(items.barcode, validation.item.barcode)
  }).sync();

  if (duplicate) {
    return response.status(409).json({ errors: ["An item already exists with this barcode or HUID."] });
  }

  const item = db
    .insert(items)
    .values({
      ...validation.item,
      status: "IN_STOCK"
    })
    .returning()
    .get();

  return response.status(201).json({ item: formatInventoryItem(item) });
});

inventoryRouter.get("/barcode/next", requireAuth, (request, response) => {
  const prefix = normalizeBarcodePrefix(request.query.prefix, request.query.category);

  if (!prefix) {
    return response.status(400).json({ errors: ["prefix or category is required."] });
  }

  const sequence = db.query.barcodeSequences.findFirst({
    where: eq(barcodeSequences.prefix, prefix)
  }).sync();
  const nextNumber = sequence?.next_number ?? 1;

  return response.json({
    prefix,
    next_number: nextNumber,
    barcode: formatBarcode(prefix, nextNumber)
  });
});

inventoryRouter.post("/barcode/create", requireAuth, (request, response) => {
  const validation = validateBarcodeCreatePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const createdItems = db.transaction((tx) => {
    const sequence = tx.query.barcodeSequences.findFirst({
      where: eq(barcodeSequences.prefix, validation.payload.prefix)
    }).sync();
    const firstNumber = sequence?.next_number ?? 1;
    const rows: (typeof items.$inferSelect)[] = [];

    for (let index = 0; index < validation.payload.quantity; index += 1) {
      const tagNumber = firstNumber + index;
      const barcode = formatBarcode(validation.payload.prefix, tagNumber);
      const huid = validation.payload.quantity === 1 ? validation.payload.huid : undefined;
      const duplicate = tx.query.items.findFirst({
        where: huid ? or(eq(items.barcode, barcode), eq(items.huid, huid)) : eq(items.barcode, barcode)
      }).sync();

      if (duplicate) {
        throw new Error(`Barcode or HUID already exists: ${barcode}`);
      }

      rows.push(
        tx.insert(items)
          .values({
            barcode,
            huid,
            category: validation.payload.category,
            metal_type: validation.payload.metalType,
            purity_karat: validation.payload.purityKarat,
            gross_weight_mg: validation.payload.grossWeightMg,
            stone_weight_mg: validation.payload.stoneWeightMg,
            black_bead_weight_mg: validation.payload.blackBeadWeightMg,
            net_weight_mg: validation.payload.netWeightMg,
            final_weight_mg: validation.payload.finalWeightMg,
            fine_weight_mg: validation.payload.fineWeightMg,
            making_charge_type: validation.payload.makingChargeType,
            making_charge_value: validation.payload.makingChargeValue,
            hallmark_charge_paise: validation.payload.hallmarkChargePaise,
            design_name: validation.payload.designName,
            tag_prefix: validation.payload.prefix,
            tag_number: tagNumber,
            location: validation.payload.location,
            status: "IN_STOCK",
            sale_mode: validation.payload.saleMode,
            uom: validation.payload.uom,
            unit_price_paise: validation.payload.unitPricePaise
          })
          .returning()
          .get()
      );
    }

    if (sequence) {
      tx.update(barcodeSequences)
        .set({
          next_number: firstNumber + validation.payload.quantity,
          updated_at: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(barcodeSequences.id, sequence.id))
        .run();
    } else {
      tx.insert(barcodeSequences)
        .values({
          prefix: validation.payload.prefix,
          next_number: firstNumber + validation.payload.quantity
        })
        .run();
    }

    return rows;
  });

  return response.status(201).json({
    items: createdItems.map(formatInventoryItem)
  });
});

inventoryRouter.post("/stock-verification/start", requireAuth, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const body = isRecord(request.body) ? request.body : {};
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim()
    : `Stock Verification ${new Date().toLocaleDateString("en-IN")}`;
  const location = optionalText(body.location, "location", []);

  const session = db.insert(stockVerificationSessions)
    .values({
      name,
      location,
      expected_status: "IN_STOCK",
      status: "OPEN",
      created_by: authUser.id
    })
    .returning()
    .get();

  return response.status(201).json({ session: formatVerificationSession(session) });
});

inventoryRouter.post("/stock-verification/:id/scan", requireAuth, (request, response) => {
  const sessionId = Number(request.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ errors: ["Session id must be a positive integer."] });
  }

  const session = db.query.stockVerificationSessions.findFirst({
    where: eq(stockVerificationSessions.id, sessionId)
  }).sync();

  if (!session) {
    return response.status(404).json({ errors: ["Stock verification session not found."] });
  }

  if (session.status !== "OPEN") {
    return response.status(409).json({ errors: ["This stock verification session is already completed."] });
  }

  if (!isRecord(request.body) || typeof request.body.barcode !== "string" || !request.body.barcode.trim()) {
    return response.status(400).json({ errors: ["barcode is required."] });
  }

  const barcode = request.body.barcode.trim().toUpperCase();
  const item = db.query.items.findFirst({
    where: or(eq(items.barcode, barcode), eq(items.huid, barcode))
  }).sync();

  const existingScan = db.query.stockVerificationScans.findFirst({
    where: and(eq(stockVerificationScans.session_id, sessionId), eq(stockVerificationScans.barcode, barcode))
  }).sync();

  const scanPayload = {
    session_id: sessionId,
    barcode,
    item_id: item?.id,
    result: item ? "FOUND" as const : "UNKNOWN" as const
  };
  const scan = existingScan
    ? db.update(stockVerificationScans)
        .set(scanPayload)
        .where(eq(stockVerificationScans.id, existingScan.id))
        .returning()
        .get()
    : db.insert(stockVerificationScans).values(scanPayload).returning().get();

  // Log to scanner audit logs
  db.insert(scannerAuditLogs).values({
    event_type: "BARCODE_SCAN",
    barcode,
    item_id: item?.id,
    result: item ? "STOCK_VERIFIED" : "UNKNOWN_STOCK_SCAN",
    context: `VERIFICATION:${session.name}`,
    user_id: (request as AuthenticatedRequest).user.id
  }).run();

  return response.status(item ? 201 : 404).json({
    scan: formatVerificationScan(scan),
    item: item ? formatInventoryItem(item) : null,
    errors: item ? undefined : ["Scanned barcode was not found in inventory."]
  });
});

inventoryRouter.get("/stock-verification/:id", requireAuth, (request, response) => {
  const sessionId = Number(request.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ errors: ["Session id must be a positive integer."] });
  }

  const session = db.query.stockVerificationSessions.findFirst({
    where: eq(stockVerificationSessions.id, sessionId)
  }).sync();

  if (!session) {
    return response.status(404).json({ errors: ["Stock verification session not found."] });
  }

  return response.json(buildVerificationSummary(session));
});

inventoryRouter.post("/stock-verification/:id/complete", requireAuth, requireAdmin, (request, response) => {
  const sessionId = Number(request.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return response.status(400).json({ errors: ["Session id must be a positive integer."] });
  }

  const session = db.update(stockVerificationSessions)
    .set({
      status: "COMPLETED",
      completed_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(stockVerificationSessions.id, sessionId))
    .returning()
    .get();

  if (!session) {
    return response.status(404).json({ errors: ["Stock verification session not found."] });
  }

  return response.json(buildVerificationSummary(session));
});

inventoryRouter.patch("/:id/status", requireAuth, requireAdmin, (request, response) => {
  const itemId = Number(request.params.id);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["Item id must be a positive integer."] });
  }

  if (!isRecord(request.body) || typeof request.body.status !== "string") {
    return response.status(400).json({ errors: ["status is required."] });
  }

  const nextStatus = request.body.status.trim().toUpperCase();

  if (!ITEM_STATUSES.has(nextStatus)) {
    return response.status(400).json({ errors: ["status must be IN_STOCK, IN_MEMO, SOLD, or MELTED."] });
  }

  const updatedItem = db
    .update(items)
    .set({ status: nextStatus })
    .where(eq(items.id, itemId))
    .returning()
    .get();

  if (!updatedItem) {
    return response.status(404).json({ errors: ["Item not found."] });
  }

  return response.json({ item: formatInventoryItem(updatedItem) });
});

function buildInventoryFilters(query: Record<string, unknown>) {
  const filters: SQL[] = [];

  if (typeof query.category === "string" && query.category.trim()) {
    filters.push(eq(items.category, query.category.trim()));
  }

  if (typeof query.metal_type === "string" && query.metal_type.trim()) {
    filters.push(eq(items.metal_type, query.metal_type.trim()));
  }

  if (typeof query.purity_karat === "string" && query.purity_karat.trim()) {
    const purityKarat = Number(query.purity_karat);

    if (Number.isInteger(purityKarat)) {
      filters.push(eq(items.purity_karat, purityKarat));
    }
  }

  if (typeof query.status === "string" && query.status.trim()) {
    filters.push(eq(items.status, query.status.trim()));
  }

  if (typeof query.search === "string" && query.search.trim()) {
    const search = `%${query.search.trim()}%`;
    filters.push(or(like(items.barcode, search), like(items.huid, search)) as SQL);
  }

  return filters;
}

function formatInventoryItem(item: typeof items.$inferSelect) {
  return {
    ...item,
    gross_weight_g: milligramsToGrams(item.gross_weight_mg),
    stone_weight_g: milligramsToGrams(item.stone_weight_mg ?? 0),
    black_bead_weight_g: milligramsToGrams(item.black_bead_weight_mg ?? 0),
    net_weight_g: milligramsToGrams(item.net_weight_mg),
    final_weight_g: milligramsToGrams(item.final_weight_mg || item.net_weight_mg),
    fine_weight_g: milligramsToGrams(item.fine_weight_mg || calculateFineWeightMg(item.net_weight_mg, item.purity_karat)),
    making_charge_rupees: paiseToRupees(item.making_charge_value)
  };
}

type InventoryAddValidation =
  | { ok: true; item: typeof items.$inferInsert }
  | { ok: false; errors: string[] };

function validateInventoryAddPayload(payload: unknown): InventoryAddValidation {
  const errors: string[] = [];

  if (!isRecord(payload)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const saleMode = typeof payload.sale_mode === "string" && payload.sale_mode.toUpperCase() === "QUANTITY_WISE"
    ? "QUANTITY_WISE"
    : "WEIGHT_WISE";
  const uomRaw = typeof payload.uom === "string" ? payload.uom.toUpperCase() : (saleMode === "QUANTITY_WISE" ? "PIECE" : "GRAM");
  const uom: "GRAM" | "CARAT" | "PIECE" = uomRaw === "CARAT" ? "CARAT" : uomRaw === "PIECE" ? "PIECE" : "GRAM";

  const barcode = requiredText(payload.barcode, "barcode", errors);
  const huid = optionalText(payload.huid, "huid", errors);
  const category = requiredText(payload.category, "category", errors);
  const metalType = requiredText(payload.metal_type, "metal_type", errors);
  const designName = optionalText(payload.design_name, "design_name", errors);
  const location = optionalText(payload.location, "location", errors) ?? "VAULT";
  const vendorId = optionalPositiveInteger(payload.vendor_id, "vendor_id", errors);
  const purchaseRatePaise = optionalNonNegativeInteger(payload.purchase_rate_paise, "purchase_rate_paise", errors);
  const purchaseDate = optionalText(payload.purchase_date, "purchase_date", errors);
  const imagePath = optionalText(payload.image_path, "image_path", errors);

  if (huid && !HUID_PATTERN.test(huid)) {
    errors.push("huid must be exactly 6 uppercase alphanumeric characters.");
  }

  // Quantity-wise (per-piece, fixed price) items: coins / fixed-rate articles.
  if (saleMode === "QUANTITY_WISE") {
    const unitPricePaise = requiredPositiveInteger(payload.unit_price_paise, "unit_price_paise", errors);
    const grossWeightMg = optionalNonNegativeInteger(payload.gross_weight_mg, "gross_weight_mg", errors) ?? 0;
    const stoneWeightMg = optionalNonNegativeInteger(payload.stone_weight_mg, "stone_weight_mg", errors) ?? 0;
    const blackBeadWeightMg = optionalNonNegativeInteger(payload.black_bead_weight_mg, "black_bead_weight_mg", errors) ?? 0;
    const netWeightMg = optionalNonNegativeInteger(payload.net_weight_mg, "net_weight_mg", errors) ?? grossWeightMg;
    const purityKarat = optionalNonNegativeInteger(payload.purity_karat, "purity_karat", errors) ?? 0;

    if (errors.length > 0 || unitPricePaise === undefined) {
      return { ok: false, errors: errors.length > 0 ? errors : ["unit_price_paise is required for quantity-wise items."] };
    }

    return {
      ok: true,
      item: {
        barcode,
        huid,
        category,
        metal_type: metalType,
        purity_karat: purityKarat,
        gross_weight_mg: grossWeightMg,
        stone_weight_mg: stoneWeightMg,
        black_bead_weight_mg: blackBeadWeightMg,
        net_weight_mg: netWeightMg,
        final_weight_mg: netWeightMg,
        fine_weight_mg: 0,
        wastage_percentage: 0,
        making_charge_type: "FLAT",
        making_charge_value: 0,
        design_name: designName,
        location,
        vendor_id: vendorId,
        purchase_rate_paise: purchaseRatePaise,
        purchase_date: purchaseDate,
        image_path: imagePath,
        status: "IN_STOCK",
        sale_mode: "QUANTITY_WISE",
        uom,
        unit_price_paise: unitPricePaise
      }
    };
  }

  // Weight-wise jewellery (default).
  const purityKarat = requiredPositiveInteger(payload.purity_karat, "purity_karat", errors);
  const grossWeightMg = requiredPositiveInteger(payload.gross_weight_mg, "gross_weight_mg", errors);
  const stoneWeightMg = optionalNonNegativeInteger(payload.stone_weight_mg, "stone_weight_mg", errors) ?? 0;
  const blackBeadWeightMg = optionalNonNegativeInteger(payload.black_bead_weight_mg, "black_bead_weight_mg", errors) ?? 0;
  const netWeightMg = requiredPositiveInteger(payload.net_weight_mg, "net_weight_mg", errors);
  const makingChargeType = requiredText(payload.making_charge_type, "making_charge_type", errors);
  const makingChargeValue = requiredNonNegativeInteger(payload.making_charge_value, "making_charge_value", errors);
  const wastagePercentage = optionalNonNegativeNumber(payload.wastage_percentage, "wastage_percentage", errors) ?? 0;

  if (makingChargeType && !MAKING_CHARGE_TYPES.has(makingChargeType)) {
    errors.push("making_charge_type must be PER_GRAM or FLAT.");
  }

  if (
    grossWeightMg !== undefined &&
    netWeightMg !== undefined &&
    grossWeightMg - stoneWeightMg - blackBeadWeightMg !== netWeightMg
  ) {
    errors.push("net_weight_mg must equal gross_weight_mg minus stone_weight_mg minus black_bead_weight_mg.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (
    purityKarat === undefined ||
    grossWeightMg === undefined ||
    netWeightMg === undefined ||
    makingChargeValue === undefined
  ) {
    return { ok: false, errors: ["Required integer fields are missing."] };
  }

  return {
    ok: true,
    item: {
      barcode,
      huid,
      category,
      metal_type: metalType,
      purity_karat: purityKarat,
      gross_weight_mg: grossWeightMg,
      stone_weight_mg: stoneWeightMg,
      black_bead_weight_mg: blackBeadWeightMg,
      net_weight_mg: netWeightMg,
      final_weight_mg: netWeightMg,
      fine_weight_mg: calculateFineWeightMg(netWeightMg, purityKarat),
      wastage_percentage: wastagePercentage,
      making_charge_type: makingChargeType,
      making_charge_value: makingChargeValue,
      design_name: designName,
      location,
      vendor_id: vendorId,
      purchase_rate_paise: purchaseRatePaise,
      purchase_date: purchaseDate,
      image_path: imagePath,
      status: "IN_STOCK",
      sale_mode: "WEIGHT_WISE",
      uom,
      unit_price_paise: 0
    }
  };
}

type BarcodeCreateValidation =
  | {
      ok: true;
      payload: {
        prefix: string;
        quantity: number;
        category: string;
        metalType: string;
        purityKarat: number;
        grossWeightMg: number;
        stoneWeightMg: number;
        blackBeadWeightMg: number;
        netWeightMg: number;
        finalWeightMg: number;
        fineWeightMg: number;
        makingChargeType: string;
        makingChargeValue: number;
        hallmarkChargePaise: number;
        huid?: string;
        designName?: string;
        location: string;
        saleMode: "WEIGHT_WISE" | "QUANTITY_WISE";
        uom: "GRAM" | "CARAT" | "PIECE";
        unitPricePaise: number;
      };
    }
  | { ok: false; errors: string[] };

function validateBarcodeCreatePayload(payload: unknown): BarcodeCreateValidation {
  const errors: string[] = [];

  if (!isRecord(payload)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const saleMode = typeof payload.sale_mode === "string" && payload.sale_mode.toUpperCase() === "QUANTITY_WISE"
    ? "QUANTITY_WISE"
    : "WEIGHT_WISE";
  const uomRaw = typeof payload.uom === "string" ? payload.uom.toUpperCase() : (saleMode === "QUANTITY_WISE" ? "PIECE" : "GRAM");
  const uom: "GRAM" | "CARAT" | "PIECE" = uomRaw === "CARAT" ? "CARAT" : uomRaw === "PIECE" ? "PIECE" : "GRAM";

  const prefix = normalizeBarcodePrefix(payload.prefix, payload.category);
  const quantity = optionalPositiveInteger(payload.quantity, "quantity", errors) ?? 1;
  const category = requiredText(payload.category, "category", errors);
  const metalType = requiredText(payload.metal_type, "metal_type", errors);
  const hallmarkChargePaise = optionalNonNegativeInteger(payload.hallmark_charge_paise, "hallmark_charge_paise", errors) ?? 0;
  const huid = optionalText(payload.huid, "huid", errors);
  const designName = optionalText(payload.design_name, "design_name", errors);
  const location = optionalText(payload.location, "location", errors) ?? "VAULT";

  if (!prefix || !BARCODE_PREFIX_PATTERN.test(prefix)) {
    errors.push("prefix must be 2 to 5 uppercase letters.");
  }
  if (quantity > 100) {
    errors.push("quantity cannot exceed 100 tags per batch.");
  }
  if (huid && quantity > 1) {
    errors.push("HUID can only be used when creating a single barcode.");
  }
  if (huid && !HUID_PATTERN.test(huid)) {
    errors.push("huid must be exactly 6 uppercase alphanumeric characters.");
  }

  // Quantity-wise (per-piece) tags: weights optional, unit price required.
  if (saleMode === "QUANTITY_WISE") {
    const unitPricePaise = requiredPositiveInteger(payload.unit_price_paise, "unit_price_paise", errors);
    const purityKarat = optionalNonNegativeInteger(payload.purity_karat, "purity_karat", errors) ?? 0;
    const grossWeightMg = optionalNonNegativeInteger(payload.gross_weight_mg, "gross_weight_mg", errors) ?? 0;
    const stoneWeightMg = optionalNonNegativeInteger(payload.stone_weight_mg, "stone_weight_mg", errors) ?? 0;
    const blackBeadWeightMg = optionalNonNegativeInteger(payload.black_bead_weight_mg, "black_bead_weight_mg", errors) ?? 0;

    if (errors.length > 0 || !prefix || unitPricePaise === undefined) {
      return { ok: false, errors: errors.length > 0 ? errors : ["unit_price_paise is required for quantity-wise tags."] };
    }

    return {
      ok: true,
      payload: {
        prefix,
        quantity,
        category,
        metalType,
        purityKarat,
        grossWeightMg,
        stoneWeightMg,
        blackBeadWeightMg,
        netWeightMg: grossWeightMg,
        finalWeightMg: grossWeightMg,
        fineWeightMg: 0,
        makingChargeType: "FLAT",
        makingChargeValue: 0,
        hallmarkChargePaise,
        huid,
        designName,
        location,
        saleMode,
        uom,
        unitPricePaise
      }
    };
  }

  // Weight-wise tags (default).
  const purityKarat = requiredPositiveInteger(payload.purity_karat, "purity_karat", errors);
  const grossWeightMg = requiredPositiveInteger(payload.gross_weight_mg, "gross_weight_mg", errors);
  const stoneWeightMg = optionalNonNegativeInteger(payload.stone_weight_mg, "stone_weight_mg", errors) ?? 0;
  const blackBeadWeightMg = optionalNonNegativeInteger(payload.black_bead_weight_mg, "black_bead_weight_mg", errors) ?? 0;
  const makingChargeType = requiredText(payload.making_charge_type, "making_charge_type", errors);
  const makingChargeValue = requiredNonNegativeInteger(payload.making_charge_value, "making_charge_value", errors);

  if (makingChargeType && !MAKING_CHARGE_TYPES.has(makingChargeType)) {
    errors.push("making_charge_type must be PER_GRAM or FLAT.");
  }

  const netWeightMg = grossWeightMg === undefined ? undefined : grossWeightMg - stoneWeightMg - blackBeadWeightMg;

  if (netWeightMg === undefined || netWeightMg <= 0) {
    errors.push("Net weight must be greater than zero after stone and black bead deductions.");
  }

  if (errors.length > 0 || !prefix || purityKarat === undefined || grossWeightMg === undefined || makingChargeValue === undefined || netWeightMg === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      prefix,
      quantity,
      category,
      metalType,
      purityKarat,
      grossWeightMg,
      stoneWeightMg,
      blackBeadWeightMg,
      netWeightMg,
      finalWeightMg: netWeightMg,
      fineWeightMg: calculateFineWeightMg(netWeightMg, purityKarat),
      makingChargeType,
      makingChargeValue,
      hallmarkChargePaise,
      huid,
      designName,
      location,
      saleMode,
      uom,
      unitPricePaise: 0
    }
  };
}

function buildVerificationSummary(session: typeof stockVerificationSessions.$inferSelect) {
  const expectedItems = db.select().from(items).where(eq(items.status, session.expected_status)).all();
  const scans = db.select().from(stockVerificationScans).where(eq(stockVerificationScans.session_id, session.id)).all();
  const foundItemIds = new Set(scans.filter((scan) => scan.item_id).map((scan) => scan.item_id as number));
  const missingItems = expectedItems.filter((item) => !foundItemIds.has(item.id));
  const foundItems = expectedItems.filter((item) => foundItemIds.has(item.id));
  const unknownScans = scans.filter((scan) => scan.result === "UNKNOWN");

  return {
    session: formatVerificationSession(session),
    counts: {
      expected: expectedItems.length,
      found: foundItems.length,
      missing: missingItems.length,
      unknown: unknownScans.length,
      scanned: scans.length
    },
    found_items: foundItems.map(formatInventoryItem),
    missing_items: missingItems.map(formatInventoryItem),
    scans: scans.map(formatVerificationScan)
  };
}

function formatVerificationSession(session: typeof stockVerificationSessions.$inferSelect) {
  return {
    id: session.id,
    name: session.name,
    location: session.location,
    expected_status: session.expected_status,
    status: session.status,
    created_at: session.created_at,
    completed_at: session.completed_at
  };
}

function formatVerificationScan(scan: typeof stockVerificationScans.$inferSelect) {
  return {
    id: scan.id,
    session_id: scan.session_id,
    barcode: scan.barcode,
    item_id: scan.item_id,
    result: scan.result,
    scanned_at: scan.scanned_at
  };
}

function normalizeBarcodePrefix(prefix: unknown, category: unknown) {
  const source = typeof prefix === "string" && prefix.trim()
    ? prefix
    : typeof category === "string" && category.trim()
      ? category
      : "";
  const letters = source.toUpperCase().replace(/[^A-Z]/g, "");

  return letters.slice(0, 3);
}

function formatBarcode(prefix: string, number: number) {
  return `${prefix}${String(number).padStart(4, "0")}`;
}

function calculateFineWeightMg(netWeightMg: number, purityKarat: number) {
  return Math.round((netWeightMg * purityKarat) / 24);
}

function requiredText(value: unknown, field: string, errors: string[]) {
  const text = optionalText(value, field, errors);

  if (!text) {
    errors.push(`${field} is required.`);
    return "";
  }

  return text;
}

function optionalText(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return field === "huid" ? trimmed.toUpperCase() : trimmed;
}

function requiredPositiveInteger(value: unknown, field: string, errors: string[]) {
  const integer = requiredNonNegativeInteger(value, field, errors);

  if (integer !== undefined && integer <= 0) {
    errors.push(`${field} must be greater than zero.`);
    return undefined;
  }

  return integer;
}

function optionalPositiveInteger(value: unknown, field: string, errors: string[]) {
  const integer = optionalNonNegativeInteger(value, field, errors);

  if (integer !== undefined && integer <= 0) {
    errors.push(`${field} must be greater than zero.`);
    return undefined;
  }

  return integer;
}

function requiredNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  if (!Number.isInteger(value)) {
    errors.push(`${field} must be an integer. Send paise or milligrams, not rupees, grams, or decimals.`);
    return undefined;
  }

  if ((value as number) < 0) {
    errors.push(`${field} cannot be negative.`);
    return undefined;
  }

  return value as number;
}

function optionalNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requiredNonNegativeInteger(value, field, errors);
}

function optionalNonNegativeNumber(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a number.`);
    return undefined;
  }

  if (value < 0) {
    errors.push(`${field} cannot be negative.`);
    return undefined;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

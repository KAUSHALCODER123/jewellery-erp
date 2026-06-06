import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { firms, organizationSettings, printTemplates } from "../db/schema.js";
import { decimalStringToInteger, paiseToRupees } from "../utils/decimal.js";
import { fetchLiveMetalRates } from "../utils/marketRateFetcher.js";

export const settingsRouter = Router();

const DOCUMENT_TYPES = new Set(["INVOICE", "RECEIPT", "LABEL"]);
const PAGE_SIZES = new Set(["A4", "A5", "THERMAL_80", "LABEL_50X25", "LABEL_65X35"]);
const LOYALTY_EARN_MODES = new Set(["PER_HUNDRED_RUPEES", "PER_GRAM_GOLD"]);
const PRINT_LANGUAGES = new Set(["english", "marathi", "hindi", "gujarati"]);

settingsRouter.get("/rates", requireAuth, (_request, response) => {
  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  return response.json({ rates: formatRates(settings) });
});

settingsRouter.put("/rates", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateRatesPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  const oldRates = formatRates(settings);
  const newRates = {
    gold_24k_rate_per_gram_paise: validation.rates.gold24kRatePaise,
    gold_22k_rate_per_gram_paise: validation.rates.gold22kRatePaise,
    gold_18k_rate_per_gram_paise: validation.rates.gold18kRatePaise,
    silver_rate_per_gram_paise: validation.rates.silverRatePaise,
    gold_24k_rate_per_gram_rupees: paiseToRupees(validation.rates.gold24kRatePaise),
    gold_22k_rate_per_gram_rupees: paiseToRupees(validation.rates.gold22kRatePaise),
    gold_18k_rate_per_gram_rupees: paiseToRupees(validation.rates.gold18kRatePaise),
    silver_rate_per_gram_rupees: paiseToRupees(validation.rates.silverRatePaise)
  };

  logAction(authUser.id, "UPDATE_RATE", "organization_settings", settings.id, oldRates, newRates);

  db.update(organizationSettings)
    .set({
      gold_24k_rate_per_gram: validation.rates.gold24kRatePaise,
      gold_22k_rate_per_gram: validation.rates.gold22kRatePaise,
      gold_18k_rate_per_gram: validation.rates.gold18kRatePaise,
      silver_rate_per_gram: validation.rates.silverRatePaise,
      updated_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  return response.json({ rates: newRates });
});

settingsRouter.post("/rates/sync", requireAuth, requireAdmin, async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  try {
    const oldRates = formatRates(settings);
    const liveRates = await fetchLiveMetalRates();

    db.update(organizationSettings)
      .set({
        gold_24k_rate_per_gram: liveRates.gold24kRatePaise,
        gold_22k_rate_per_gram: liveRates.gold22kRatePaise,
        gold_18k_rate_per_gram: liveRates.gold18kRatePaise,
        silver_rate_per_gram: liveRates.silverRatePaise,
        updated_at: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(organizationSettings.id, settings.id))
      .run();

    const updatedSettings = db.query.organizationSettings.findFirst({
      where: eq(organizationSettings.id, settings.id)
    }).sync();
    const newRates = formatRates(updatedSettings ?? {
      ...settings,
      gold_24k_rate_per_gram: liveRates.gold24kRatePaise,
      gold_22k_rate_per_gram: liveRates.gold22kRatePaise,
      gold_18k_rate_per_gram: liveRates.gold18kRatePaise,
      silver_rate_per_gram: liveRates.silverRatePaise,
      updated_at: liveRates.syncedAt
    });

    logAction(authUser.id, "SYNC_LIVE_RATE", "organization_settings", settings.id, oldRates, {
      ...newRates,
      source: liveRates.source,
      provider_synced_at: liveRates.syncedAt
    });

    return response.json({ rates: newRates });
  } catch (caught) {
    return response.status(502).json({
      errors: [caught instanceof Error ? caught.message : "Could not sync live metal rates."]
    });
  }
});

settingsRouter.get("/loyalty", requireAuth, (_request, response) => {
  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  return response.json({ loyalty: formatLoyaltySettings(settings) });
});

settingsRouter.put("/loyalty", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateLoyaltyPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  const oldSettings = formatLoyaltySettings(settings);
  db.update(organizationSettings)
    .set({
      loyalty_earn_mode: validation.loyalty.earnMode,
      loyalty_points_per_hundred: validation.loyalty.pointsPerHundred,
      loyalty_points_per_gram_gold: validation.loyalty.pointsPerGramGold,
      updated_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  const refreshed = db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.id, settings.id)
  }).sync();
  const nextSettings = formatLoyaltySettings(refreshed ?? {
    ...settings,
    loyalty_earn_mode: validation.loyalty.earnMode,
    loyalty_points_per_hundred: validation.loyalty.pointsPerHundred,
    loyalty_points_per_gram_gold: validation.loyalty.pointsPerGramGold
  });

  logAction(authUser.id, "UPDATE_LOYALTY_SETTINGS", "organization_settings", settings.id, oldSettings, nextSettings);
  return response.json({ loyalty: nextSettings });
});

type RatesValidation =
  | {
      ok: true;
      rates: {
        gold24kRatePaise: number;
        gold22kRatePaise: number;
        gold18kRatePaise: number;
        silverRatePaise: number;
      };
    }
  | { ok: false; errors: string[] };

type LoyaltyValidation =
  | {
      ok: true;
      loyalty: {
        earnMode: "PER_HUNDRED_RUPEES" | "PER_GRAM_GOLD";
        pointsPerHundred: number;
        pointsPerGramGold: number;
      };
    }
  | { ok: false; errors: string[] };

function validateLoyaltyPayload(body: unknown): LoyaltyValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const earnMode = typeof body.loyalty_earn_mode === "string" ? body.loyalty_earn_mode.toUpperCase() : "";
  if (!LOYALTY_EARN_MODES.has(earnMode)) {
    errors.push("loyalty_earn_mode must be PER_HUNDRED_RUPEES or PER_GRAM_GOLD.");
  }

  const pointsPerHundred = parseNonNegativeInteger(body.loyalty_points_per_hundred, "loyalty_points_per_hundred", errors);
  const pointsPerGramGold = parseNonNegativeInteger(body.loyalty_points_per_gram_gold, "loyalty_points_per_gram_gold", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    loyalty: {
      earnMode: earnMode as "PER_HUNDRED_RUPEES" | "PER_GRAM_GOLD",
      pointsPerHundred,
      pointsPerGramGold
    }
  };
}

function validateRatesPayload(body: unknown): RatesValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const gold24k = parseRate(body.gold_24k_rate, "gold_24k_rate", errors);
  const gold22k = parseRate(body.gold_22k_rate, "gold_22k_rate", errors);
  const gold18k = parseRate(body.gold_18k_rate, "gold_18k_rate", errors);
  const silver = parseRate(body.silver_rate, "silver_rate", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rates: {
      gold24kRatePaise: gold24k,
      gold22kRatePaise: gold22k,
      gold18kRatePaise: gold18k,
      silverRatePaise: silver
    }
  };
}

function parseRate(value: unknown, field: string, errors: string[]) {
  const parsed = decimalStringToInteger(value, 100, 2);

  if (!parsed.ok) {
    errors.push(`${field}: ${parsed.error}`);
    return 0;
  }

  return parsed.value;
}

function formatRates(settings: typeof organizationSettings.$inferSelect) {
  return {
    gold_24k_rate_per_gram_paise: settings.gold_24k_rate_per_gram,
    gold_22k_rate_per_gram_paise: settings.gold_22k_rate_per_gram,
    gold_18k_rate_per_gram_paise: settings.gold_18k_rate_per_gram,
    silver_rate_per_gram_paise: settings.silver_rate_per_gram,
    gold_24k_rate_per_gram_rupees: paiseToRupees(settings.gold_24k_rate_per_gram),
    gold_22k_rate_per_gram_rupees: paiseToRupees(settings.gold_22k_rate_per_gram),
    gold_18k_rate_per_gram_rupees: paiseToRupees(settings.gold_18k_rate_per_gram),
    silver_rate_per_gram_rupees: paiseToRupees(settings.silver_rate_per_gram),
    updated_at: settings.updated_at
  };
}

function formatLoyaltySettings(settings: typeof organizationSettings.$inferSelect) {
  return {
    loyalty_earn_mode: settings.loyalty_earn_mode,
    loyalty_points_per_hundred: settings.loyalty_points_per_hundred,
    loyalty_points_per_gram_gold: settings.loyalty_points_per_gram_gold,
    updated_at: settings.updated_at
  };
}

function parseNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(`${field} must be a non-negative integer.`);
    return 0;
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

settingsRouter.get("/print-language", requireAuth, (_request, response) => {
  const settings = db.query.organizationSettings.findFirst().sync();
  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }
  return response.json({ print_language: settings.print_language ?? "english" });
});

settingsRouter.put("/print-language", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const lang = request.body?.print_language;

  if (typeof lang !== "string" || !PRINT_LANGUAGES.has(lang)) {
    return response.status(400).json({ errors: ["print_language must be english, marathi, hindi, or gujarati."] });
  }

  const settings = db.query.organizationSettings.findFirst().sync();
  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  const oldLang = settings.print_language ?? "english";
  db.update(organizationSettings)
    .set({ print_language: lang, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  logAction(authUser.id, "UPDATE_PRINT_LANGUAGE", "organization_settings", settings.id, { print_language: oldLang }, { print_language: lang });
  return response.json({ print_language: lang });
});

settingsRouter.get("/ecommerce", requireAuth, requireAdmin, (_request, response) => {
  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  // Never return the raw webhook secret. Report only whether one is configured so
  // the UI can show "configured / not configured" without leaking the value.
  return response.json({
    webhook_secret_set: Boolean(settings.webhook_secret),
    ecommerce_sync_url: settings.ecommerce_sync_url ?? ""
  });
});

settingsRouter.put("/ecommerce", requireAuth, requireAdmin, (request, response) => {
  const { webhook_secret, ecommerce_sync_url } = request.body;

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  db.update(organizationSettings)
    .set({
      webhook_secret: typeof webhook_secret === "string" ? webhook_secret.trim() : settings.webhook_secret,
      ecommerce_sync_url: typeof ecommerce_sync_url === "string" ? ecommerce_sync_url.trim() : settings.ecommerce_sync_url
    })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  // Echo only non-secret state back to the caller.
  return response.json({
    webhook_secret_set: typeof webhook_secret === "string" ? Boolean(webhook_secret.trim()) : Boolean(settings.webhook_secret),
    ecommerce_sync_url: typeof ecommerce_sync_url === "string" ? ecommerce_sync_url.trim() : (settings.ecommerce_sync_url ?? "")
  });
});

settingsRouter.get("/tally", requireAuth, (_request, response) => {
  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  return response.json({
    tally_sync_enabled: settings.tally_sync_enabled,
    tally_gateway_url: settings.tally_gateway_url,
    tally_company_name: settings.tally_company_name
  });
});

settingsRouter.put("/tally", requireAuth, requireAdmin, (request, response) => {
  const body = request.body as {
    tally_sync_enabled?: boolean;
    tally_gateway_url?: string;
    tally_company_name?: string;
  };

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  const updates: Partial<typeof organizationSettings.$inferInsert> = {};
  if (typeof body.tally_sync_enabled === "boolean") {
    updates.tally_sync_enabled = body.tally_sync_enabled;
  }
  if (typeof body.tally_gateway_url === "string") {
    updates.tally_gateway_url = body.tally_gateway_url.trim();
  }
  if (typeof body.tally_company_name === "string") {
    updates.tally_company_name = body.tally_company_name.trim();
  }

  db.update(organizationSettings)
    .set({
      ...updates,
      updated_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(organizationSettings.id, settings.id))
    .run();

  const refreshed = db.query.organizationSettings.findFirst().sync();

  return response.json({
    tally_sync_enabled: refreshed?.tally_sync_enabled ?? false,
    tally_gateway_url: refreshed?.tally_gateway_url ?? "",
    tally_company_name: refreshed?.tally_company_name ?? ""
  });
});

// --- Firms / Company Entities (multi-firm) ---

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function formatFirm(firm: typeof firms.$inferSelect) {
  return {
    id: firm.id,
    key: firm.key,
    display_name: firm.display_name,
    gstin: firm.gstin,
    address: firm.address,
    contact_number: firm.contact_number,
    is_active: firm.is_active,
    created_at: firm.created_at
  };
}

function slugifyFirmKey(displayName: string) {
  const base = displayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "firm";
}

function uniqueFirmKey(displayName: string, excludeId?: number) {
  const base = slugifyFirmKey(displayName);
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = db.select({ id: firms.id }).from(firms).where(eq(firms.key, candidate)).get();
    if (!existing || existing.id === excludeId) {
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

type FirmPayload = {
  display_name: string;
  gstin: string | null;
  address: string | null;
  contact_number: string | null;
  is_active: boolean;
};

function validateFirmPayload(body: unknown): { ok: true; firm: FirmPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!displayName) {
    errors.push("display_name is required.");
  }

  const gstinRaw = typeof body.gstin === "string" ? body.gstin.trim().toUpperCase() : "";
  if (gstinRaw && !GSTIN_PATTERN.test(gstinRaw)) {
    errors.push("gstin must be a valid 15-character GSTIN.");
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";
  const contactNumber = typeof body.contact_number === "string" ? body.contact_number.trim() : "";
  const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    firm: {
      display_name: displayName,
      gstin: gstinRaw || null,
      address: address || null,
      contact_number: contactNumber || null,
      is_active: isActive
    }
  };
}

settingsRouter.get("/firms", requireAuth, (_request, response) => {
  const rows = db.select().from(firms).all();
  return response.json({ firms: rows.map(formatFirm) });
});

settingsRouter.post("/firms", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateFirmPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const key = uniqueFirmKey(validation.firm.display_name);
  const created = db.insert(firms).values({
    key,
    display_name: validation.firm.display_name,
    gstin: validation.firm.gstin,
    address: validation.firm.address,
    contact_number: validation.firm.contact_number,
    is_active: validation.firm.is_active
  }).returning().get();

  logAction(authUser.id, "CREATE_FIRM", "firms", created.id, null, formatFirm(created));
  return response.status(201).json({ firm: formatFirm(created) });
});

settingsRouter.put("/firms/:id", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const firmId = Number(request.params.id);

  if (!Number.isInteger(firmId) || firmId <= 0) {
    return response.status(400).json({ errors: ["Firm id must be a positive integer."] });
  }

  const existing = db.select().from(firms).where(eq(firms.id, firmId)).get();
  if (!existing) {
    return response.status(404).json({ errors: ["Firm not found."] });
  }

  const validation = validateFirmPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Regenerate the key only when the display name changes, keeping it unique.
  const key = validation.firm.display_name === existing.display_name
    ? existing.key
    : uniqueFirmKey(validation.firm.display_name, firmId);

  const oldFirm = formatFirm(existing);
  const updated = db.update(firms).set({
    key,
    display_name: validation.firm.display_name,
    gstin: validation.firm.gstin,
    address: validation.firm.address,
    contact_number: validation.firm.contact_number,
    is_active: validation.firm.is_active
  }).where(eq(firms.id, firmId)).returning().get();

  logAction(authUser.id, "UPDATE_FIRM", "firms", firmId, oldFirm, formatFirm(updated));
  return response.json({ firm: formatFirm(updated) });
});

settingsRouter.delete("/firms/:id", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const firmId = Number(request.params.id);

  if (!Number.isInteger(firmId) || firmId <= 0) {
    return response.status(400).json({ errors: ["Firm id must be a positive integer."] });
  }

  const existing = db.select().from(firms).where(eq(firms.id, firmId)).get();
  if (!existing) {
    return response.status(404).json({ errors: ["Firm not found."] });
  }

  // Refuse to deactivate the last active firm — login needs at least one to resolve against.
  const activeCount = db.select({ id: firms.id }).from(firms).where(eq(firms.is_active, true)).all().length;
  if (existing.is_active && activeCount <= 1) {
    return response.status(409).json({ errors: ["Cannot deactivate the only active firm. Create another firm first."] });
  }

  // Soft delete: deactivate so historical invoices keep their firm_id reference.
  const updated = db.update(firms).set({ is_active: false }).where(eq(firms.id, firmId)).returning().get();
  logAction(authUser.id, "DEACTIVATE_FIRM", "firms", firmId, formatFirm(existing), formatFirm(updated));
  return response.json({ firm: formatFirm(updated) });
});

settingsRouter.get("/print-templates/tokens", requireAuth, (_request, response) => {
  return response.json({
    invoice: [
      "shop.name", "shop.address", "shop.gstin", "shop.phone",
      "invoice.number", "invoice.date", "invoice.hsn", "invoice.gst", "invoice.discount", "invoice.urd", "invoice.total",
      "customer.name", "customer.phone",
      "payment.cash", "payment.upi", "payment.card", "payment.udhari"
    ],
    label: [
      "shop.name", "item.barcode", "item.huid", "item.category", "item.metal", "item.purity", "item.grossWeight", "item.netWeight", "item.fineWeight", "item.location"
    ],
    columns: ["item", "purity", "grossWeight", "netWeight", "rate", "making", "gst", "amount"]
  });
});

settingsRouter.get("/print-templates", requireAuth, (request, response) => {
  const documentType = typeof request.query.document_type === "string" ? request.query.document_type.toUpperCase() : "";
  const rows = db
    .select()
    .from(printTemplates)
    .where(documentType && DOCUMENT_TYPES.has(documentType) ? eq(printTemplates.document_type, documentType as typeof printTemplates.$inferSelect.document_type) : undefined)
    .all();

  return response.json({ templates: rows.map(formatPrintTemplate) });
});

settingsRouter.post("/print-templates", requireAuth, requireAdmin, (request, response) => {
  const validation = validatePrintTemplatePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const template = db.transaction((tx) => {
    if (validation.template.is_default) {
      tx.update(printTemplates)
        .set({ is_default: false })
        .where(eq(printTemplates.document_type, validation.template.document_type))
        .run();
    }

    return tx.insert(printTemplates).values(validation.template).returning().get();
  });

  return response.status(201).json({ template: formatPrintTemplate(template) });
});

settingsRouter.put("/print-templates/:id", requireAuth, requireAdmin, (request, response) => {
  const templateId = Number(request.params.id);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    return response.status(400).json({ errors: ["Template id must be a positive integer."] });
  }

  const validation = validatePrintTemplatePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const template = db.transaction((tx) => {
    if (validation.template.is_default) {
      tx.update(printTemplates)
        .set({ is_default: false })
        .where(eq(printTemplates.document_type, validation.template.document_type))
        .run();
    }

    return tx.update(printTemplates)
      .set({ ...validation.template, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(printTemplates.id, templateId))
      .returning()
      .get();
  });

  if (!template) {
    return response.status(404).json({ errors: ["Print template not found."] });
  }

  return response.json({ template: formatPrintTemplate(template) });
});

function validatePrintTemplatePayload(body: unknown):
  | { ok: true; template: typeof printTemplates.$inferInsert }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const documentType = typeof body.document_type === "string" ? body.document_type.toUpperCase() : "";
  const pageSize = typeof body.page_size === "string" ? body.page_size.toUpperCase() : "";
  const content = isRecord(body.content) ? body.content : undefined;

  if (!name) errors.push("name is required.");
  if (!DOCUMENT_TYPES.has(documentType)) errors.push("document_type must be INVOICE, RECEIPT, or LABEL.");
  if (!PAGE_SIZES.has(pageSize)) errors.push("page_size must be A4, A5, THERMAL_80, LABEL_50X25, or LABEL_65X35.");
  if (!content) errors.push("content must be an object.");

  if (errors.length > 0 || !content) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    template: {
      name,
      document_type: documentType as typeof printTemplates.$inferInsert.document_type,
      page_size: pageSize as typeof printTemplates.$inferInsert.page_size,
      content_json: JSON.stringify(normalizeTemplateContent(content)),
      is_default: Boolean(body.is_default),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active)
    }
  };
}

function normalizeTemplateContent(content: Record<string, unknown>) {
  return {
    showLogo: Boolean(content.showLogo),
    showHeader: content.showHeader !== false,
    showFooter: content.showFooter !== false,
    headerLines: toStringArray(content.headerLines).slice(0, 5),
    footerText: typeof content.footerText === "string" ? content.footerText.slice(0, 240) : "",
    fields: toStringArray(content.fields).slice(0, 40),
    columns: toStringArray(content.columns).slice(0, 12)
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function formatPrintTemplate(template: typeof printTemplates.$inferSelect) {
  return {
    ...template,
    content: parseTemplateContent(template.content_json)
  };
}

function parseTemplateContent(contentJson: string) {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    return isRecord(parsed) ? normalizeTemplateContent(parsed) : normalizeTemplateContent({});
  } catch {
    return normalizeTemplateContent({});
  }
}

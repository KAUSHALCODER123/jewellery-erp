import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { organizationSettings, printTemplates } from "../db/schema.js";
import { decimalStringToInteger, paiseToRupees } from "../utils/decimal.js";
import { fetchLiveMetalRates } from "../utils/marketRateFetcher.js";

export const settingsRouter = Router();

const DOCUMENT_TYPES = new Set(["INVOICE", "RECEIPT", "LABEL"]);
const PAGE_SIZES = new Set(["A4", "A5", "THERMAL_80", "LABEL_50X25", "LABEL_65X35"]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

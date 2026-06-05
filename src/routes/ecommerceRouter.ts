import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { items, organizationSettings } from "../db/schema.js";

export const ecommerceRouter = Router();

/**
 * GET /api/ecommerce/catalog/export
 * Secures access via x-api-key matching settings.webhook_secret.
 * Returns online-published, in-stock items with dynamic live pricing.
 */
ecommerceRouter.get("/catalog/export", (request, response) => {
  const apiKey = request.headers["x-api-key"];

  try {
    const settings = db.select().from(organizationSettings).get();

    if (!settings) {
      return response.status(500).json({ errors: ["Store settings not configured."] });
    }

    // Secure the endpoint via webhook secret
    if (!settings.webhook_secret || apiKey !== settings.webhook_secret) {
      return response.status(401).json({ errors: ["Unauthorized. Invalid or missing API key."] });
    }

    // Fetch items IN_STOCK and published online
    const onlineItems = db
      .select()
      .from(items)
      .where(and(eq(items.status, "IN_STOCK"), eq(items.is_published_online, true)))
      .all();

    const catalog = onlineItems.map((item) => {
      // a) Determine today's live rate per gram
      let liveRatePerGram = 0;
      const metalType = item.metal_type.trim().toLowerCase();

      if (metalType === "gold") {
        if (item.purity_karat === 24) {
          liveRatePerGram = settings.gold_24k_rate_per_gram;
        } else if (item.purity_karat === 22) {
          liveRatePerGram = settings.gold_22k_rate_per_gram;
        } else if (item.purity_karat === 18) {
          liveRatePerGram = settings.gold_18k_rate_per_gram;
        } else {
          // Proportional rate fallback
          liveRatePerGram = Math.round((settings.gold_24k_rate_per_gram * item.purity_karat) / 24);
        }
      } else if (metalType === "silver") {
        liveRatePerGram = settings.silver_rate_per_gram;
      }

      // b) Base Metal Value = (Gross Weight mg * Live Rate per gram) / 1000
      const baseMetalValue = (item.gross_weight_mg * liveRatePerGram) / 1000;

      // c) Making Charge
      let makingChargePaise = item.making_charge_value;
      if (item.making_charge_type === "PER_GRAM") {
        makingChargePaise = (item.making_charge_value * item.gross_weight_mg) / 1000;
      }

      // d) Add 3% GST
      const subtotal = baseMetalValue + makingChargePaise;
      const gstAmount = subtotal * 0.03;
      const finalSellingPricePaise = Math.round(subtotal + gstAmount);

      // Extract image urls (safely parse JSON list)
      let images: string[] = [];
      if (item.image_urls) {
        try {
          images = JSON.parse(item.image_urls);
        } catch {
          images = [];
        }
      }
      if (images.length === 0 && item.image_path) {
        images = [item.image_path];
      }

      return {
        id: item.id,
        barcode: item.barcode,
        huid: item.huid,
        category: item.category,
        metal_type: item.metal_type,
        purity_karat: item.purity_karat,
        gross_weight_mg: item.gross_weight_mg,
        net_weight_mg: item.net_weight_mg,
        title: item.online_title || item.design_name || `${item.purity_karat}K ${item.metal_type} ${item.category}`,
        description: item.online_description || item.design_name || `High purity hallmarked ${item.category}`,
        images: images,
        final_selling_price_paise: finalSellingPricePaise
      };
    });

    return response.json({
      shop_name: settings.shop_name,
      catalog
    });
  } catch (error) {
    console.error("Failed to export e-commerce catalog", error);
    return response.status(500).json({ errors: ["Failed to export e-commerce catalog."] });
  }
});

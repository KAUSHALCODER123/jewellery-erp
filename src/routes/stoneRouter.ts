import { and, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { items, itemStones } from "../db/schema.js";

export const stoneRouter = Router();

// Require auth for all stone inventory endpoints
stoneRouter.use(requireAuth);

/**
 * POST /api/inventory/items/:id/stones
 * Attaches an array of stone details to a specific jewelry item.
 * Recalculates total stone weight in mg (1 carat = 200 mg) and updates the parent item.
 */
stoneRouter.post("/items/:id/stones", (request, response) => {
  const itemId = Number(request.params.id);
  const stones = request.body.stones;

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["Item ID must be a positive integer."] });
  }

  if (!Array.isArray(stones)) {
    return response.status(400).json({ errors: ["stones must be a JSON array of stone objects."] });
  }

  // Validate stones structure
  const errors: string[] = [];
  const validatedStones: {
    item_id: number;
    stone_type: "DIAMOND" | "RUBY" | "SAPPHIRE" | "EMERALD" | "OTHER";
    shape: string | null;
    carat_weight: number;
    color_grade: string | null;
    clarity_grade: string | null;
    cut_grade: string | null;
    certificate_number: string | null;
    certificate_lab: "GIA" | "IGI" | "HRD" | "NONE";
    stone_rate_paise: number;
  }[] = [];

  for (let idx = 0; idx < stones.length; idx++) {
    const stone = stones[idx];
    if (typeof stone !== "object" || stone === null) {
      errors.push(`Stone record at index ${idx} must be a valid JSON object.`);
      continue;
    }

    const {
      stone_type,
      shape,
      carat_weight,
      color_grade,
      clarity_grade,
      cut_grade,
      certificate_number,
      certificate_lab,
      stone_rate_paise
    } = stone;

    if (!stone_type || !["DIAMOND", "RUBY", "SAPPHIRE", "EMERALD", "OTHER"].includes(stone_type.toUpperCase())) {
      errors.push(`Stone at index ${idx}: stone_type must be DIAMOND, RUBY, SAPPHIRE, EMERALD, or OTHER.`);
    }

    if (typeof carat_weight !== "number" || carat_weight <= 0) {
      errors.push(`Stone at index ${idx}: carat_weight must be a positive number.`);
    }

    if (typeof stone_rate_paise !== "number" || stone_rate_paise < 0 || !Number.isInteger(stone_rate_paise)) {
      errors.push(`Stone at index ${idx}: stone_rate_paise must be a non-negative integer.`);
    }

    if (errors.length === 0) {
      validatedStones.push({
        item_id: itemId,
        stone_type: stone_type.toUpperCase() as "DIAMOND" | "RUBY" | "SAPPHIRE" | "EMERALD" | "OTHER",
        shape: typeof shape === "string" ? shape.trim().toUpperCase() : null,
        carat_weight: carat_weight,
        color_grade: typeof color_grade === "string" ? color_grade.trim().toUpperCase() : null,
        clarity_grade: typeof clarity_grade === "string" ? clarity_grade.trim().toUpperCase() : null,
        cut_grade: typeof cut_grade === "string" ? cut_grade.trim().toUpperCase() : null,
        certificate_number: typeof certificate_number === "string" && certificate_number.trim() ? certificate_number.trim().toUpperCase() : null,
        certificate_lab: (typeof certificate_lab === "string" && ["GIA", "IGI", "HRD", "NONE"].includes(certificate_lab.toUpperCase()) ? certificate_lab.toUpperCase() : "NONE") as "GIA" | "IGI" | "HRD" | "NONE",
        stone_rate_paise: stone_rate_paise
      });
    }
  }

  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  try {
    const parentItem = db.query.items.findFirst({
      where: eq(items.id, itemId)
    }).sync();

    if (!parentItem) {
      return response.status(404).json({ errors: ["Parent item not found."] });
    }

    // 1 carat = 200 mg
    const totalCarats = validatedStones.reduce((sum, s) => sum + s.carat_weight, 0);
    const totalStoneWeightMg = Math.round(totalCarats * 200);
    const totalStonesValuePaise = validatedStones.reduce((sum, s) => sum + Math.round(s.carat_weight * s.stone_rate_paise), 0);

    if (totalStoneWeightMg > parentItem.gross_weight_mg) {
      return response.status(400).json({ errors: ["Total stone weight exceeds parent item's gross weight."] });
    }

    db.transaction((tx) => {
      // 1. Clear existing stones for this item
      tx.delete(itemStones)
        .where(eq(itemStones.item_id, itemId))
        .run();

      // 2. Insert new stones
      if (validatedStones.length > 0) {
        tx.insert(itemStones)
          .values(validatedStones)
          .run();
      }

      // 3. Update parent item stone weight and net weight
      const nextNetWeight = parentItem.gross_weight_mg - totalStoneWeightMg;
      tx.update(items)
        .set({
          stone_weight_mg: totalStoneWeightMg,
          net_weight_mg: nextNetWeight
        })
        .where(eq(items.id, itemId))
        .run();
    });

    return response.json({
      success: true,
      message: "Stones successfully attached to item.",
      total_carats: totalCarats,
      stone_weight_mg: totalStoneWeightMg,
      total_stone_value_paise: totalStonesValuePaise
    });
  } catch (error) {
    console.error(`Failed to attach stones to item ${itemId}`, error);
    return response.status(500).json({ errors: ["Failed to save item stone details."] });
  }
});

/**
 * GET /api/inventory/items/:id/stones
 * Retrieves stones attached to a specific jewelry item.
 */
stoneRouter.get("/items/:id/stones", (request, response) => {
  const itemId = Number(request.params.id);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["Item ID must be a positive integer."] });
  }

  try {
    const stones = db.select().from(itemStones).where(eq(itemStones.item_id, itemId)).all();
    return response.json({ stones });
  } catch (error) {
    console.error(`Failed to get stones for item ${itemId}`, error);
    return response.status(500).json({ errors: ["Failed to retrieve item stone details."] });
  }
});

/**
 * GET /api/inventory/stones/certificates
 * Strictly searches for matching items based on their certificate number.
 */
stoneRouter.get("/stones/certificates", (request, response) => {
  const certificateNumber = request.query.certificate_number;

  if (typeof certificateNumber !== "string" || !certificateNumber.trim()) {
    return response.status(400).json({ errors: ["certificate_number query parameter is required."] });
  }

  const normalizedCert = certificateNumber.trim().toUpperCase();

  try {
    const rows = db
      .select({
        item: items,
        stone: itemStones
      })
      .from(itemStones)
      .innerJoin(items, eq(itemStones.item_id, items.id))
      .where(eq(itemStones.certificate_number, normalizedCert))
      .all();

    return response.json({
      certificate_number: normalizedCert,
      results: rows
    });
  } catch (error) {
    console.error("Failed to query stone certificate audit", error);
    return response.status(500).json({ errors: ["Failed to query certificate numbers."] });
  }
});

import { eq, or } from "drizzle-orm";
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { items } from "../db/schema.js";
import { validateNewItemPayload } from "./validation.js";

export const itemRouter = Router();

itemRouter.post("/", requireAuth, (request, response) => {
  const validation = validateNewItemPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const item = validation.item;

  const duplicate = db.query.items.findFirst({
    where: item.huid
      ? or(eq(items.barcode, item.barcode), eq(items.huid, item.huid))
      : eq(items.barcode, item.barcode)
  }).sync();

  if (duplicate) {
    return response.status(409).json({
      errors: ["An item already exists with this barcode or HUID."]
    });
  }

  const createdItem = db.insert(items).values(item).returning().get();

  return response.status(201).json({ item: createdItem });
});

itemRouter.patch("/:id", requireAuth, (request, response) => {
  const itemId = Number(request.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["Item ID must be a positive integer."] });
  }

  const { is_published_online, online_title, online_description, image_urls } = request.body;

  const existingItem = db.query.items.findFirst({
    where: eq(items.id, itemId)
  }).sync();

  if (!existingItem) {
    return response.status(404).json({ errors: ["Item not found."] });
  }

  const updatedItem = db
    .update(items)
    .set({
      is_published_online: typeof is_published_online === "boolean" ? is_published_online : existingItem.is_published_online,
      online_title: typeof online_title === "string" ? online_title : existingItem.online_title,
      online_description: typeof online_description === "string" ? online_description : existingItem.online_description,
      image_urls: typeof image_urls === "string" ? image_urls : existingItem.image_urls
    })
    .where(eq(items.id, itemId))
    .returning()
    .get();

  return response.json({ item: updatedItem });
});

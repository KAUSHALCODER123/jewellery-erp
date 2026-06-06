import { eq } from "drizzle-orm";
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { suppliers } from "../db/schema.js";

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

  const duplicate = db.query.suppliers.findFirst({ where: eq(suppliers.name, name) }).sync();
  if (duplicate) {
    return response.status(409).json({ errors: ["A supplier with this name already exists."] });
  }

  const supplier = db.insert(suppliers).values({ name, phone, gstin, address }).returning().get();

  return response.status(201).json({ supplier });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

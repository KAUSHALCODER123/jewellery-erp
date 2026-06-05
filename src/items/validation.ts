import type { NewItem } from "../db/schema.js";

const MAKING_CHARGE_TYPES = new Set(["PER_GRAM", "FLAT"]);
const ITEM_STATUSES = new Set(["IN_STOCK", "SOLD", "IN_MEMO"]);
const HUID_PATTERN = /^[A-Z0-9]{6}$/;

type ItemPayload = {
  barcode?: unknown;
  huid?: unknown;
  category?: unknown;
  metal_type?: unknown;
  purity_karat?: unknown;
  gross_weight_mg?: unknown;
  stone_weight_mg?: unknown;
  net_weight_mg?: unknown;
  making_charge_type?: unknown;
  making_charge_value?: unknown;
  image_path?: unknown;
  status?: unknown;
};

export type ItemValidationResult =
  | { ok: true; item: NewItem }
  | { ok: false; errors: string[] };

export function validateNewItemPayload(payload: unknown): ItemValidationResult {
  if (!isRecord(payload)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const data = payload as ItemPayload;
  const errors: string[] = [];

  const barcode = requiredText(data.barcode, "barcode", errors);
  const category = requiredText(data.category, "category", errors);
  const metalType = requiredText(data.metal_type, "metal_type", errors);
  const makingChargeType = requiredText(data.making_charge_type, "making_charge_type", errors);

  const purityKarat = requiredInteger(data.purity_karat, "purity_karat", errors);
  const grossWeightMg = requiredInteger(data.gross_weight_mg, "gross_weight_mg", errors);
  const stoneWeightMg = optionalInteger(data.stone_weight_mg, "stone_weight_mg", errors) ?? 0;
  const netWeightMg = requiredInteger(data.net_weight_mg, "net_weight_mg", errors);
  const makingChargeValue = requiredInteger(data.making_charge_value, "making_charge_value", errors);

  const huid = optionalText(data.huid, "huid", errors);
  const imagePath = optionalText(data.image_path, "image_path", errors);
  const status = optionalText(data.status, "status", errors) ?? "IN_STOCK";

  if (makingChargeType && !MAKING_CHARGE_TYPES.has(makingChargeType)) {
    errors.push("making_charge_type must be PER_GRAM or FLAT.");
  }

  if (status && !ITEM_STATUSES.has(status)) {
    errors.push("status must be IN_STOCK, SOLD, or IN_MEMO.");
  }

  if (huid && !HUID_PATTERN.test(huid)) {
    errors.push("huid must be exactly 6 uppercase alphanumeric characters.");
  }

  if (grossWeightMg !== undefined && grossWeightMg <= 0) {
    errors.push("gross_weight_mg must be greater than zero.");
  }

  if (stoneWeightMg < 0) {
    errors.push("stone_weight_mg cannot be negative.");
  }

  if (netWeightMg !== undefined && netWeightMg <= 0) {
    errors.push("net_weight_mg must be greater than zero.");
  }

  if (
    grossWeightMg !== undefined &&
    netWeightMg !== undefined &&
    grossWeightMg - stoneWeightMg !== netWeightMg
  ) {
    errors.push("net_weight_mg must equal gross_weight_mg minus stone_weight_mg.");
  }

  if (makingChargeValue !== undefined && makingChargeValue < 0) {
    errors.push("making_charge_value must be zero or greater.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
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
      net_weight_mg: netWeightMg,
      making_charge_type: makingChargeType,
      making_charge_value: makingChargeValue,
      image_path: imagePath,
      status
    }
  };
}

function requiredText(value: unknown, field: string, errors: string[]): string {
  const text = optionalText(value, field, errors);
  if (!text) {
    errors.push(`${field} is required.`);
    return "";
  }

  return text;
}

function optionalText(value: unknown, field: string, errors: string[]): string | undefined {
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

function requiredInteger(value: unknown, field: string, errors: string[]): number {
  const integer = optionalInteger(value, field, errors);
  if (integer === undefined) {
    errors.push(`${field} is required as an integer.`);
    return 0;
  }

  return integer;
}

function optionalInteger(value: unknown, field: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push(`${field} must be an integer. Send paise or milligrams, never rupees, grams, or decimals.`);
    return undefined;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

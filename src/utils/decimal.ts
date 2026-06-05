export type DecimalToIntegerResult = { ok: true; value: number } | { ok: false; error: string };

export function decimalStringToInteger(value: unknown, scale: 100 | 1000, maxDecimalPlaces: 2 | 3): DecimalToIntegerResult {
  if (typeof value !== "string" && typeof value !== "number") {
    return { ok: false, error: "Value must be a string or number." };
  }

  const normalized = String(value).trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return { ok: false, error: "Value must be a positive decimal number." };
  }

  const decimal = match[2] ?? "";

  if (decimal.length > maxDecimalPlaces) {
    return { ok: false, error: `Value cannot have more than ${maxDecimalPlaces} decimal places.` };
  }

  const whole = Number(match[1]);
  const scaled = whole * scale + Number(decimal.padEnd(maxDecimalPlaces, "0") || "0");

  if (!Number.isSafeInteger(scaled)) {
    return { ok: false, error: "Value is too large." };
  }

  return { ok: true, value: scaled };
}

export function paiseToRupees(paise: number) {
  return (paise / 100).toFixed(2);
}

export function milligramsToGrams(milligrams: number) {
  return (milligrams / 1000).toFixed(3);
}

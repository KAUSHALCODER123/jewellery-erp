import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Scale, Coins, CheckCircle2, Printer } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";
import ScaleCaptureButton from "./ScaleCaptureButton.js";

type MakingChargeType = "PER_GRAM" | "FLAT";
type SaleMode = "WEIGHT_WISE" | "QUANTITY_WISE";
type Uom = "GRAM" | "CARAT" | "PIECE";

type FormState = {
  saleMode: SaleMode;
  barcode: string;
  category: string;
  metalType: string;
  purityKarat: string;
  grossWeightG: string;
  stoneWeightG: string;
  makingChargeType: MakingChargeType;
  makingChargeValueRs: string;
  huid: string;
  uom: Uom;
  unitPriceRs: string;
  imageFile: File | null;
};

type SubmitState =
  | { status: "idle"; message: "" }
  | { status: "saving"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type ItemMasterInventoryProps = { apiBaseUrl?: string };

const initialForm: FormState = {
  saleMode: "WEIGHT_WISE",
  barcode: "",
  category: "Ring",
  metalType: "Gold",
  purityKarat: "22",
  grossWeightG: "",
  stoneWeightG: "0",
  makingChargeType: "PER_GRAM",
  makingChargeValueRs: "",
  huid: "",
  uom: "GRAM",
  unitPriceRs: "",
  imageFile: null
};

const staticCategories = ["Ring", "Chain", "Bangle", "Bracelet", "Earring", "Pendant", "Coin", "Other"];
const metals = ["Gold", "Silver", "Platinum"];
const purityOptions = ["14", "18", "20", "22", "24"];
const huidPattern = /^[A-Z0-9]{6}$/;

export default function ItemMasterInventory({ apiBaseUrl = "" }: ItemMasterInventoryProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle", message: "" });
  const [groups, setGroups] = useState<string[]>([]);
  const [labelTemplates, setLabelTemplates] = useState<Array<{ id: number; is_default: boolean }>>([]);
  const [lastSavedItem, setLastSavedItem] = useState<{ id: number; barcode: string } | null>(null);
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);
  const liveWeights = getLiveWeights(form.grossWeightG, form.stoneWeightG);
  const isQty = form.saleMode === "QUANTITY_WISE";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/inventory/item-groups?active=true`, { headers: authHeaders });
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.item_groups)) {
          setGroups(data.item_groups.map((g: { name: string }) => g.name));
        }
      } catch { /* fall back to static categories */ }
      try {
        const res = await fetch(`${apiBaseUrl}/api/settings/print-templates?document_type=LABEL`, { headers: authHeaders });
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.templates)) {
          setLabelTemplates(data.templates.map((t: { id: number; is_default: boolean }) => ({ id: t.id, is_default: t.is_default })));
        }
      } catch { /* no label templates available */ }
    })();
  }, [apiBaseUrl, authHeaders]);

  function printTag() {
    if (!lastSavedItem) return;
    const template = labelTemplates.find((t) => t.is_default) ?? labelTemplates[0];
    if (!template) return;
    window.open(
      withDocumentToken(`${apiBaseUrl}/api/documents/label/item/${lastSavedItem.id}/${template.id}`),
      "_blank",
      "noopener,noreferrer"
    );
  }

  const categories = useMemo(() => Array.from(new Set([...groups, ...staticCategories])), [groups]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSubmitState({ status: "idle", message: "" });
  };

  const setSaleMode = (mode: SaleMode) => {
    setForm((current) => ({ ...current, saleMode: mode, uom: mode === "QUANTITY_WISE" ? "PIECE" : "GRAM" }));
    setFieldErrors([]);
    setSubmitState({ status: "idle", message: "" });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedHuid = form.huid.trim().toUpperCase();
    const barcode = (form.barcode.trim() || normalizedHuid).toUpperCase();
    const errors: string[] = [];

    if (!barcode) errors.push("Barcode (or HUID) is required.");
    if (normalizedHuid && !huidPattern.test(normalizedHuid)) errors.push("HUID must be 6 alphanumeric characters.");

    const payloadBase: Record<string, unknown> = {
      barcode,
      huid: normalizedHuid || undefined,
      category: form.category,
      metal_type: form.metalType,
      sale_mode: form.saleMode,
      uom: form.uom
    };

    if (isQty) {
      const unitPricePaise = decimalToScaledInteger(form.unitPriceRs, 100, 2);
      if (!unitPricePaise.ok || unitPricePaise.value <= 0) errors.push("Unit price must be a positive rupee amount.");
      setFieldErrors(errors);
      if (errors.length > 0) return;
      payloadBase.unit_price_paise = unitPricePaise.value;
      payloadBase.purity_karat = Number(form.purityKarat) || 0;
    } else {
      const grossWeightMg = decimalToScaledInteger(form.grossWeightG, 1000, 3);
      const stoneWeightMg = decimalToScaledInteger(form.stoneWeightG, 1000, 3);
      const makingChargePaise = decimalToScaledInteger(form.makingChargeValueRs, 100, 2);
      const netWeightMg = grossWeightMg.ok && stoneWeightMg.ok ? grossWeightMg.value - stoneWeightMg.value : undefined;

      if (!grossWeightMg.ok) errors.push("Gross weight must be grams with up to 3 decimals.");
      if (!stoneWeightMg.ok) errors.push("Stone weight must be grams with up to 3 decimals.");
      if (!makingChargePaise.ok) errors.push("Making charge must be rupees with up to 2 decimals.");
      if (netWeightMg === undefined || netWeightMg <= 0) errors.push("Net weight must be greater than 0.");
      setFieldErrors(errors);
      if (errors.length > 0 || !grossWeightMg.ok || !stoneWeightMg.ok || !makingChargePaise.ok || netWeightMg === undefined) return;

      payloadBase.purity_karat = Number(form.purityKarat);
      payloadBase.gross_weight_mg = grossWeightMg.value;
      payloadBase.stone_weight_mg = stoneWeightMg.value;
      payloadBase.net_weight_mg = netWeightMg;
      payloadBase.making_charge_type = form.makingChargeType;
      payloadBase.making_charge_value = makingChargePaise.value;
    }

    setFieldErrors([]);
    setSubmitState({ status: "saving", message: "Saving item…" });

    try {
      const imagePath = form.imageFile ? await uploadItemImage(apiBaseUrl, form.imageFile, authHeaders) : undefined;
      const response = await fetch(`${apiBaseUrl}/api/inventory/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ ...payloadBase, image_path: imagePath })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[]; item?: { id: number; barcode: string } } | null;
      if (!response.ok) throw new Error(result?.errors?.join(" ") || "Item could not be saved.");

      setForm((current) => ({ ...initialForm, saleMode: current.saleMode, uom: current.uom, category: current.category, metalType: current.metalType, purityKarat: current.purityKarat, makingChargeType: current.makingChargeType }));
      setSubmitState({ status: "success", message: `Saved ${result?.item?.barcode ?? "item"}.` });
      setLastSavedItem(result?.item ? { id: result.item.id, barcode: result.item.barcode } : null);
    } catch (error) {
      setSubmitState({ status: "error", message: error instanceof Error ? error.message : "Item could not be saved." });
    }
  };

  return (
    <section className="w-full bg-slate-950 p-3 text-slate-100">
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-50">Item Master / Inventory</h1>
            {/* Sale-mode segmented toggle */}
            <div className="relative flex rounded-md border border-slate-700 bg-slate-900 p-0.5 text-xs">
              <SegButton active={!isQty} onClick={() => setSaleMode("WEIGHT_WISE")} icon={Scale}>Weight-wise</SegButton>
              <SegButton active={isQty} onClick={() => setSaleMode("QUANTITY_WISE")} icon={Coins}>Quantity-wise</SegButton>
            </div>
          </div>
          {!isQty && (
            <div className="grid grid-cols-3 overflow-hidden rounded border border-slate-700 text-right text-xs animate-fade-in">
              <Metric label="Gross" value={formatGrams(liveWeights.grossWeightG)} />
              <Metric label="Stone" value={formatGrams(liveWeights.stoneWeightG)} />
              <Metric label="Net" value={formatGrams(liveWeights.netWeightG)} tone={liveWeights.netWeightG === undefined ? "neutral" : liveWeights.netWeightG <= 0 ? "bad" : "good"} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Field label="Barcode">
            <input value={form.barcode} onChange={(e) => setField("barcode", e.target.value.toUpperCase())} placeholder={isQty ? "COIN-0001" : "auto / HUID"} className={controlClassName} />
          </Field>

          <Field label="Item Group / Category">
            <select value={form.category} onChange={(e) => setField("category", e.target.value)} className={controlClassName}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Metal">
            <select value={form.metalType} onChange={(e) => setField("metalType", e.target.value)} className={controlClassName}>
              {metals.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>

          <Field label="Purity">
            <select value={form.purityKarat} onChange={(e) => setField("purityKarat", e.target.value)} className={controlClassName}>
              {purityOptions.map((p) => <option key={p} value={p}>{p}K</option>)}
            </select>
          </Field>

          {isQty ? (
            <>
              <Field label="UOM">
                <select value={form.uom} onChange={(e) => setField("uom", e.target.value as Uom)} className={controlClassName}>
                  <option value="PIECE">Piece</option>
                  <option value="GRAM">Gram</option>
                  <option value="CARAT">Carat</option>
                </select>
              </Field>
              <Field label="Unit Price (₹)">
                <input value={form.unitPriceRs} onChange={(e) => setField("unitPriceRs", e.target.value)} inputMode="decimal" placeholder="5000.00" className={`${controlClassName} border-amber-700/60`} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Gross Weight (g)">
                <div className="flex gap-1">
                  <input value={form.grossWeightG} onChange={(e) => setField("grossWeightG", e.target.value)} inputMode="decimal" placeholder="10.550" className={controlClassName} />
                  <ScaleCaptureButton apiBaseUrl={apiBaseUrl} onCapture={(grams) => setField("grossWeightG", grams)} />
                </div>
              </Field>
              <Field label="Stone Weight (g)">
                <input value={form.stoneWeightG} onChange={(e) => setField("stoneWeightG", e.target.value)} inputMode="decimal" placeholder="0.000" className={controlClassName} />
              </Field>
              <Field label="Charge Type">
                <select value={form.makingChargeType} onChange={(e) => setField("makingChargeType", e.target.value as MakingChargeType)} className={controlClassName}>
                  <option value="PER_GRAM">Per Gram</option>
                  <option value="FLAT">Flat</option>
                </select>
              </Field>
              <Field label="Making Charge (₹)">
                <input value={form.makingChargeValueRs} onChange={(e) => setField("makingChargeValueRs", e.target.value)} inputMode="decimal" placeholder="1500.50" className={controlClassName} />
              </Field>
            </>
          )}

          <Field label="HUID">
            <input value={form.huid} onChange={(e) => setField("huid", e.target.value.toUpperCase())} maxLength={6} placeholder={isQty ? "optional" : "A1B2C3"} className={controlClassName} />
          </Field>

          <Field label="Item Image">
            <input type="file" accept="image/*" onChange={(e) => setField("imageFile", e.target.files?.[0] ?? null)} className="h-8 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-50 file:mr-2 file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-50" />
          </Field>
        </div>

        <div className="flex min-h-8 items-center justify-between gap-2 border-t border-slate-800 pt-2">
          <div className="min-w-0 text-xs">
            {fieldErrors.length > 0 ? (
              <p className="truncate text-red-300 animate-fade-in">{fieldErrors.join(" ")}</p>
            ) : submitState.status === "success" ? (
              <p className="inline-flex items-center gap-1 truncate text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5 animate-pop" /> {submitState.message}</p>
            ) : submitState.message ? (
              <p className={submitState.status === "error" ? "truncate text-red-300 animate-fade-in" : "truncate text-emerald-300"}>{submitState.message}</p>
            ) : (
              <p className="text-slate-500">{isQty ? "Per-piece fixed-price article (coins, etc.)" : "Weight-priced jewellery"}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {submitState.status === "success" && lastSavedItem && labelTemplates.length > 0 && (
              <button
                type="button"
                onClick={printTag}
                className="animate-fade-in inline-flex h-8 items-center gap-1.5 rounded border border-emerald-500 px-3 text-xs font-semibold uppercase text-emerald-300 transition hover:bg-emerald-500/10 active:scale-95"
              >
                <Printer className="h-3.5 w-3.5" /> Print Tag
              </button>
            )}
            <button
              type="submit"
              disabled={submitState.status === "saving"}
              className="h-8 rounded bg-emerald-500 px-4 text-xs font-semibold uppercase text-slate-50 transition active:scale-95 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {submitState.status === "saving" ? "Saving…" : "Add Item"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function SegButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1 font-semibold transition active:scale-95 ${active ? "bg-emerald-500 text-slate-50 shadow" : "text-slate-400 hover:text-slate-200"}`}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-medium uppercase text-slate-400">
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClassName = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-slate-100";
  return (
    <div className="min-w-20 border-l border-slate-700 px-2 py-1 first:border-l-0">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-xs font-semibold ${toneClassName}`}>{value}</div>
    </div>
  );
}

async function uploadItemImage(apiBaseUrl: string, imageFile: File, authHeaders: { Authorization: string }) {
  const formData = new FormData();
  formData.append("image", imageFile);
  const response = await fetch(`${apiBaseUrl}/api/upload/image`, { method: "POST", headers: authHeaders, body: formData });
  const result = (await response.json().catch(() => null)) as { image_path?: string; errors?: string[] } | null;
  if (!response.ok || !result?.image_path) throw new Error(result?.errors?.join(" ") || "Image upload failed.");
  return result.image_path;
}

type ScaledIntegerResult = { ok: true; value: number } | { ok: false; value: 0 };

function getLiveWeights(grossWeightG: string, stoneWeightG: string) {
  const grossWeight = parseDisplayDecimal(grossWeightG);
  const stoneWeight = parseDisplayDecimal(stoneWeightG);
  return {
    grossWeightG: grossWeight,
    stoneWeightG: stoneWeight,
    netWeightG: grossWeight === undefined || stoneWeight === undefined ? undefined : grossWeight - stoneWeight
  };
}

function parseDisplayDecimal(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(?:\.\d*)?$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3): ScaledIntegerResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, value: 0 };
  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return { ok: false, value: 0 };
  const whole = match[1];
  const decimal = match[2] ?? "";
  if (decimal.length > maxDecimalPlaces) return { ok: false, value: 0 };
  const paddedDecimal = decimal.padEnd(maxDecimalPlaces, "0");
  const scaled = Number(whole) * scale + Number(paddedDecimal || "0");
  if (!Number.isSafeInteger(scaled)) return { ok: false, value: 0 };
  return { ok: true, value: scaled };
}

function formatGrams(value: number | undefined) {
  return value === undefined ? "0.000 g" : `${value.toFixed(3)} g`;
}

const controlClassName =
  "h-8 w-full rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400";

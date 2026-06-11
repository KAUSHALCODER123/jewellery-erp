import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";
import ScaleCaptureButton from "./ScaleCaptureButton.js";

type BarcodeStockDeskProps = {
  apiBaseUrl?: string;
};

type CreateForm = {
  prefix: string;
  quantity: string;
  category: string;
  designName: string;
  metalType: string;
  purityKarat: string;
  grossWeightG: string;
  stoneWeightG: string;
  blackBeadWeightG: string;
  makingChargeType: "PER_GRAM" | "FLAT";
  makingChargeRs: string;
  hallmarkChargeRs: string;
  huid: string;
  location: string;
  saleMode: "WEIGHT_WISE" | "QUANTITY_WISE";
  uom: "GRAM" | "CARAT" | "PIECE";
  unitPriceRs: string;
};

type InventoryItem = {
  id: number;
  barcode: string;
  huid: string | null;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_g: string;
  stone_weight_g: string;
  black_bead_weight_g: string;
  net_weight_g: string;
  final_weight_g: string;
  fine_weight_g: string;
  status: string | null;
};

type ItemDefinition = {
  id: number;
  name: string;
  category: string;
  metal_type: string;
  purity_karat: number;
  sale_mode: string;
  uom: string;
  making_charge_type: "PER_GRAM" | "FLAT";
  making_charge_value: number;
  tag_prefix: string;
};

type VerificationSummary = {
  session: {
    id: number;
    name: string;
    status: "OPEN" | "COMPLETED";
    created_at: string | null;
  };
  counts: {
    expected: number;
    found: number;
    missing: number;
    unknown: number;
    scanned: number;
  };
  found_items: InventoryItem[];
  missing_items: InventoryItem[];
  scans: Array<{
    id: number;
    barcode: string;
    result: "FOUND" | "UNKNOWN";
    scanned_at: string | null;
  }>;
};

const initialCreateForm: CreateForm = {
  prefix: "RIN",
  quantity: "1",
  category: "Ring",
  designName: "",
  metalType: "Gold",
  purityKarat: "22",
  grossWeightG: "",
  stoneWeightG: "0",
  blackBeadWeightG: "0",
  makingChargeType: "PER_GRAM",
  makingChargeRs: "",
  hallmarkChargeRs: "0",
  huid: "",
  location: "VAULT",
  saleMode: "WEIGHT_WISE",
  uom: "GRAM",
  unitPriceRs: ""
};

const categories = ["Ring", "Chain", "Bangle", "Bracelet", "Earring", "Pendant", "Coin", "Other"];
const metals = ["Gold", "Silver", "Platinum"];
const purities = ["14", "18", "20", "22", "24"];

export default function BarcodeStockDesk({ apiBaseUrl = "" }: BarcodeStockDeskProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);
  const [activeTab, setActiveTab] = useState<"create" | "verify">("create");
  const [form, setForm] = useState<CreateForm>(initialCreateForm);
  const [previewBarcode, setPreviewBarcode] = useState("");
  const [createdItems, setCreatedItems] = useState<InventoryItem[]>([]);
  const [labelTemplates, setLabelTemplates] = useState<Array<{ id: number; name: string; page_size: string; is_default: boolean }>>([]);
  const [definitions, setDefinitions] = useState<ItemDefinition[]>([]);
  const [selectedDefId, setSelectedDefId] = useState("");
  const [showDefModal, setShowDefModal] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [scanValue, setScanValue] = useState("");
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const liveWeights = useMemo(() => {
    const gross = parseDisplayNumber(form.grossWeightG);
    const stone = parseDisplayNumber(form.stoneWeightG) ?? 0;
    const blackBead = parseDisplayNumber(form.blackBeadWeightG) ?? 0;
    const net = gross === undefined ? undefined : gross - stone - blackBead;
    const fine = net === undefined ? undefined : (net * Number(form.purityKarat)) / 24;

    return { gross, stone, blackBead, net, fine };
  }, [form.blackBeadWeightG, form.grossWeightG, form.purityKarat, form.stoneWeightG]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadNextBarcode(form.prefix || form.category);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [form.category, form.prefix]);

  useEffect(() => {
    void loadLabelTemplates();
    void loadDefinitions();
  }, []);

  async function loadDefinitions() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/item-definitions?active=true`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { item_definitions?: ItemDefinition[] } | null;
      if (response.ok && result?.item_definitions) {
        setDefinitions(result.item_definitions);
      }
    } catch {
      setDefinitions([]);
    }
  }

  function applyTemplate(def: ItemDefinition) {
    setSelectedDefId(String(def.id));
    setForm((current) => ({
      ...current,
      prefix: def.tag_prefix || current.prefix,
      category: def.category || current.category,
      metalType: def.metal_type || current.metalType,
      purityKarat: String(def.purity_karat || current.purityKarat),
      designName: def.name,
      makingChargeType: def.making_charge_type,
      makingChargeRs: (def.making_charge_value / 100).toFixed(2),
      saleMode: def.sale_mode === "QUANTITY_WISE" ? "QUANTITY_WISE" : "WEIGHT_WISE",
      uom: def.uom === "CARAT" ? "CARAT" : def.uom === "PIECE" ? "PIECE" : "GRAM"
    }));
  }

  useEffect(() => {
    if (activeTab === "verify") {
      scanInputRef.current?.focus();
    }
  }, [activeTab, summary?.session.id]);

  async function loadNextBarcode(prefixOrCategory: string) {
    try {
      const params = new URLSearchParams({ prefix: prefixOrCategory });
      const response = await fetch(`${apiBaseUrl}/api/inventory/barcode/next?${params}`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { barcode?: string } | null;

      if (response.ok && result?.barcode) {
        setPreviewBarcode(result.barcode);
      }
    } catch {
      setPreviewBarcode("");
    }
  }

  async function loadLabelTemplates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/print-templates?document_type=LABEL`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { templates?: Array<{ id: number; name: string; page_size: string; is_default: boolean }> } | null;

      if (response.ok && result?.templates) {
        setLabelTemplates(result.templates);
      }
    } catch {
      setLabelTemplates([]);
    }
  }

  function printLabel(itemId: number, templateId?: number) {
    const targetTemplateId = templateId ?? labelTemplates.find((template) => template.is_default)?.id ?? labelTemplates[0]?.id;
    if (targetTemplateId) {
      window.open(withDocumentToken(`${apiBaseUrl}/api/documents/label/item/${itemId}/${targetTemplateId}`), "_blank", "noopener,noreferrer");
    }
  }

  function printAllLabels() {
    const targetTemplateId = labelTemplates.find((template) => template.is_default)?.id ?? labelTemplates[0]?.id;
    if (targetTemplateId && createdItems.length > 0) {
      const ids = createdItems.map((item) => item.id).join(",");
      window.open(withDocumentToken(`${apiBaseUrl}/api/documents/labels/batch/${targetTemplateId}?ids=${ids}`), "_blank", "noopener,noreferrer");
    }
  }

  async function createBarcodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setCreatedItems([]);

    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    const hallmarkChargePaise = decimalToScaledInteger(form.hallmarkChargeRs, 100, 2);
    const huid = form.huid.trim().toUpperCase() || undefined;
    const base = {
      prefix: form.prefix,
      quantity,
      category: form.category,
      design_name: form.designName,
      metal_type: form.metalType,
      purity_karat: Number(form.purityKarat),
      hallmark_charge_paise: hallmarkChargePaise.ok ? hallmarkChargePaise.value : 0,
      huid,
      location: form.location,
      sale_mode: form.saleMode,
      uom: form.uom
    };

    let body: Record<string, unknown>;
    if (form.saleMode === "QUANTITY_WISE") {
      const unitPricePaise = decimalToScaledInteger(form.unitPriceRs, 100, 2);
      if (!unitPricePaise.ok || unitPricePaise.value <= 0) {
        setError("Enter a valid unit price for quantity-wise tags.");
        return;
      }
      body = { ...base, unit_price_paise: unitPricePaise.value };
    } else {
      const grossWeightMg = decimalToScaledInteger(form.grossWeightG, 1000, 3);
      const stoneWeightMg = decimalToScaledInteger(form.stoneWeightG, 1000, 3);
      const blackBeadWeightMg = decimalToScaledInteger(form.blackBeadWeightG, 1000, 3);
      const makingChargePaise = decimalToScaledInteger(form.makingChargeRs, 100, 2);
      if (!grossWeightMg.ok || !stoneWeightMg.ok || !blackBeadWeightMg.ok || !makingChargePaise.ok || !hallmarkChargePaise.ok) {
        setError("Enter valid weights and charges.");
        return;
      }
      body = {
        ...base,
        gross_weight_mg: grossWeightMg.value,
        stone_weight_mg: stoneWeightMg.value,
        black_bead_weight_mg: blackBeadWeightMg.value,
        making_charge_type: form.makingChargeType,
        making_charge_value: makingChargePaise.value
      };
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/barcode/create`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json().catch(() => null)) as { items?: InventoryItem[]; errors?: string[] } | null;

      if (!response.ok || !result?.items) {
        throw new Error(result?.errors?.join(" ") || "Could not create barcodes.");
      }

      setCreatedItems(result.items);
      setMessage(`${result.items.length} barcode tag${result.items.length === 1 ? "" : "s"} created.`);
      setForm((current) => ({ ...current, huid: "" }));
      await loadNextBarcode(form.prefix || form.category);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create barcodes.");
    }
  }

  async function startVerification() {
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/stock-verification/start`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ location: "VAULT" })
      });
      const result = (await response.json().catch(() => null)) as { session?: { id: number }; errors?: string[] } | null;

      if (!response.ok || !result?.session) {
        throw new Error(result?.errors?.join(" ") || "Could not start stock verification.");
      }

      await loadVerification(result.session.id);
      setMessage("Stock verification session started.");
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start stock verification.");
    }
  }

  async function loadVerification(sessionId: number) {
    const response = await fetch(`${apiBaseUrl}/api/inventory/stock-verification/${sessionId}`, { headers: authHeaders });
    const result = (await response.json().catch(() => null)) as VerificationSummary | { errors?: string[] } | null;

    if (!response.ok || !isVerificationSummary(result)) {
      throw new Error(result && "errors" in result ? result.errors?.join(" ") : "Could not load stock verification.");
    }

    setSummary(result);
  }

  async function scanBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!summary || !scanValue.trim()) {
      return;
    }

    const barcode = scanValue.trim().toUpperCase();
    setScanValue("");
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/stock-verification/${summary.session.id}/scan`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ barcode })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;

      if (!response.ok && response.status !== 404) {
        throw new Error(result?.errors?.join(" ") || "Could not save scan.");
      }

      if (response.status === 404) {
        setMessage(`Unknown tag scanned: ${barcode}`);
      } else {
        setMessage(`Found tag: ${barcode}`);
      }

      await loadVerification(summary.session.id);
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save scan.");
    }
  }

  async function completeVerification() {
    if (!summary) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/stock-verification/${summary.session.id}/complete`, {
        method: "POST",
        headers: authHeaders
      });
      const result = (await response.json().catch(() => null)) as VerificationSummary | { errors?: string[] } | null;

      if (!response.ok || !isVerificationSummary(result)) {
        throw new Error(result && "errors" in result ? result.errors?.join(" ") : "Could not complete verification.");
      }

      setSummary(result);
      setMessage("Stock verification completed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete verification.");
    }
  }

  return (
    <section className="grid min-h-full grid-rows-[auto_1fr] bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-sm font-semibold uppercase text-slate-50">Barcode Desk</h1>
            <p className="text-xs text-slate-400">Tag creation, label data, and stock verification</p>
          </div>
          <TabButton active={activeTab === "create"} onClick={() => setActiveTab("create")}>Create Tags</TabButton>
          <TabButton active={activeTab === "verify"} onClick={() => setActiveTab("verify")}>Verify Stock</TabButton>
        </div>
        {(message || error) && (
          <p className={`mt-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>
        )}
      </div>

      {activeTab === "create" ? (
        <main className="grid min-h-0 grid-cols-[minmax(360px,480px)_1fr] gap-3 overflow-auto p-3">
          <form onSubmit={createBarcodes} className="grid content-start gap-3 border border-slate-800 bg-slate-900 p-3">
            <div className="grid grid-cols-[1fr_auto] items-end gap-2 border-b border-slate-800 pb-3">
              <Field label="Item Template (pick to pre-fill)">
                <select
                  value={selectedDefId}
                  onChange={(event) => {
                    const def = definitions.find((d) => String(d.id) === event.target.value);
                    if (def) applyTemplate(def);
                    else setSelectedDefId("");
                  }}
                  className={controlClassName}
                >
                  <option value="">— Select item template —</option>
                  {definitions.map((def) => (
                    <option key={def.id} value={def.id}>
                      {def.name} ({def.category} · {def.purity_karat}K {def.metal_type})
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                onClick={() => setShowDefModal(true)}
                className="h-9 rounded border border-amber-600 bg-amber-600/20 px-3 text-xs font-semibold uppercase text-amber-300 transition hover:bg-amber-600/40 active:scale-95"
              >
                + New Template
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Prefix">
                <input value={form.prefix} maxLength={5} onChange={(event) => setFormValue("prefix", event.target.value.toUpperCase())} className={controlClassName} />
              </Field>
              <Field label="Next Tag">
                <input value={previewBarcode || "-"} readOnly className={`${controlClassName} font-mono text-emerald-300`} />
              </Field>
              <Field label="Qty">
                <input value={form.quantity} inputMode="numeric" onChange={(event) => setFormValue("quantity", event.target.value)} className={controlClassName} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Sale Mode">
                <select value={form.saleMode} onChange={(event) => setFormValue("saleMode", event.target.value as CreateForm["saleMode"])} className={controlClassName}>
                  <option value="WEIGHT_WISE">Weight-wise</option>
                  <option value="QUANTITY_WISE">Quantity-wise</option>
                </select>
              </Field>
              <Field label="UOM">
                <select value={form.uom} onChange={(event) => setFormValue("uom", event.target.value as CreateForm["uom"])} className={controlClassName}>
                  <option value="GRAM">Gram</option>
                  <option value="CARAT">Carat</option>
                  <option value="PIECE">Piece</option>
                </select>
              </Field>
              {form.saleMode === "QUANTITY_WISE" && (
                <Field label="Unit Price (₹)">
                  <input value={form.unitPriceRs} inputMode="decimal" onChange={(event) => setFormValue("unitPriceRs", event.target.value)} className={`${controlClassName} border-amber-700/60`} />
                </Field>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Category">
                <select value={form.category} onChange={(event) => setFormValue("category", event.target.value)} className={controlClassName}>
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </Field>
              <Field label="Design">
                <input value={form.designName} onChange={(event) => setFormValue("designName", event.target.value)} className={controlClassName} />
              </Field>
              <Field label="Metal">
                <select value={form.metalType} onChange={(event) => setFormValue("metalType", event.target.value)} className={controlClassName}>
                  {metals.map((metal) => <option key={metal}>{metal}</option>)}
                </select>
              </Field>
              <Field label="Purity">
                <select value={form.purityKarat} onChange={(event) => setFormValue("purityKarat", event.target.value)} className={controlClassName}>
                  {purities.map((purity) => <option key={purity} value={purity}>{purity}K</option>)}
                </select>
              </Field>
              <Field label="Gross Wt (g)">
                <div className="flex gap-1">
                  <input value={form.grossWeightG} inputMode="decimal" onChange={(event) => setFormValue("grossWeightG", event.target.value)} className={controlClassName} />
                  <ScaleCaptureButton apiBaseUrl={apiBaseUrl} onCapture={(grams) => setFormValue("grossWeightG", grams)} />
                </div>
              </Field>
              <Field label="Stone Wt (g)">
                <input value={form.stoneWeightG} inputMode="decimal" onChange={(event) => setFormValue("stoneWeightG", event.target.value)} className={controlClassName} />
              </Field>
              <Field label="Black Bead Wt (g)">
                <input value={form.blackBeadWeightG} inputMode="decimal" onChange={(event) => setFormValue("blackBeadWeightG", event.target.value)} className={controlClassName} />
              </Field>
              <Field label="Net/Fine Wt">
                <input value={`${formatGram(liveWeights.net)} / ${formatGram(liveWeights.fine)}`} readOnly className={`${controlClassName} font-mono text-emerald-300`} />
              </Field>
              <Field label="Making Type">
                <select value={form.makingChargeType} onChange={(event) => setFormValue("makingChargeType", event.target.value as CreateForm["makingChargeType"])} className={controlClassName}>
                  <option value="PER_GRAM">Per Gram</option>
                  <option value="FLAT">Flat</option>
                </select>
              </Field>
              <Field label="Making Rs">
                <input value={form.makingChargeRs} inputMode="decimal" onChange={(event) => setFormValue("makingChargeRs", event.target.value)} className={controlClassName} />
              </Field>
              <Field label="Hallmark Rs">
                <input value={form.hallmarkChargeRs} inputMode="decimal" onChange={(event) => setFormValue("hallmarkChargeRs", event.target.value)} className={controlClassName} />
              </Field>
              <Field label="HUID single item">
                <input value={form.huid} maxLength={6} onChange={(event) => setFormValue("huid", event.target.value.toUpperCase())} className={controlClassName} />
              </Field>
              <Field label="Location">
                <input value={form.location} onChange={(event) => setFormValue("location", event.target.value.toUpperCase())} className={controlClassName} />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <button type="submit" className="h-9 bg-emerald-500 px-4 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-400">
                Create Barcode Tags
              </button>
              {createdItems.length > 0 ? (
                <button
                  type="button"
                  onClick={printAllLabels}
                  className="h-9 border border-emerald-500 px-4 text-xs font-bold uppercase text-emerald-300 hover:bg-emerald-500/10"
                >
                  Print All Labels ({createdItems.length})
                </button>
              ) : null}
            </div>
          </form>

          <div className="min-h-0 overflow-auto border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr>
                  {["Tag", "HUID", "Item", "Gross", "Stone", "Black.B", "Net", "Fine", "Status", "Print"].map((heading) => (
                    <th key={heading} className="border-b border-slate-800 px-2 py-2 uppercase">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {createdItems.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">Created tags will appear here.</td></tr>
                ) : createdItems.map((item) => (
                  <tr key={item.id} className="border-b border-slate-900">
                    <td className="px-2 py-2 font-mono text-emerald-300">{item.barcode}</td>
                    <td className="px-2 py-2 font-mono">{item.huid ?? "-"}</td>
                    <td className="px-2 py-2">{item.category} {item.purity_karat}K {item.metal_type}</td>
                    <td className="px-2 py-2 font-mono">{item.gross_weight_g}</td>
                    <td className="px-2 py-2 font-mono">{item.stone_weight_g}</td>
                    <td className="px-2 py-2 font-mono">{item.black_bead_weight_g}</td>
                    <td className="px-2 py-2 font-mono">{item.net_weight_g}</td>
                    <td className="px-2 py-2 font-mono">{item.fine_weight_g}</td>
                    <td className="px-2 py-2">{item.status}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => printLabel(item.id)} className="text-emerald-300">Label</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-3 overflow-auto p-3">
          <div className="flex flex-wrap items-end gap-2 border border-slate-800 bg-slate-900 p-3">
            <button type="button" onClick={startVerification} className="h-9 bg-emerald-500 px-4 text-xs font-bold uppercase text-slate-50">
              Start Verification
            </button>
            <form onSubmit={scanBarcode} className="flex flex-1 gap-2">
              <input
                ref={scanInputRef}
                value={scanValue}
                disabled={!summary || summary.session.status !== "OPEN"}
                onChange={(event) => setScanValue(event.target.value)}
                placeholder="Scan barcode or HUID"
                className="h-9 min-w-64 flex-1 border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-50 outline-none focus:border-emerald-400 disabled:text-slate-600"
              />
              <button type="submit" disabled={!summary || summary.session.status !== "OPEN"} className="h-9 border border-slate-700 px-4 text-xs font-bold uppercase text-slate-200 disabled:text-slate-600">
                Scan
              </button>
            </form>
            <button type="button" disabled={!summary || summary.session.status !== "OPEN"} onClick={completeVerification} className="h-9 border border-amber-500 px-4 text-xs font-bold uppercase text-amber-200 disabled:border-slate-700 disabled:text-slate-600">
              Complete
            </button>
            <button
              type="button"
              disabled={!summary}
              onClick={() => summary && window.open(withDocumentToken(`${apiBaseUrl}/api/documents/stock-verification/${summary.session.id}/report`), "_blank", "noopener,noreferrer")}
              className="h-9 border border-blue-500 px-4 text-xs font-bold uppercase text-blue-200 disabled:border-slate-700 disabled:text-slate-600"
            >
              Print Report
            </button>
          </div>

          <div className="grid grid-cols-5 border border-slate-800 bg-slate-900 text-xs">
            <Metric label="Expected" value={String(summary?.counts.expected ?? 0)} />
            <Metric label="Scanned" value={String(summary?.counts.scanned ?? 0)} />
            <Metric label="Found" value={String(summary?.counts.found ?? 0)} tone="good" />
            <Metric label="Missing" value={String(summary?.counts.missing ?? 0)} tone="bad" />
            <Metric label="Unknown" value={String(summary?.counts.unknown ?? 0)} tone="warn" />
          </div>

          <div className="grid min-h-0 grid-cols-2 gap-3">
            <VerificationBoard
              foundItems={summary?.found_items ?? []}
              missingItems={summary?.missing_items ?? []}
            />
            <div className="min-h-0 overflow-auto border border-slate-800">
              <div className="sticky top-0 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase text-slate-50">Scan Log</div>
              <table className="w-full text-left text-xs">
                <tbody>
                  {(summary?.scans ?? []).map((scan) => (
                    <tr key={scan.id} className="border-b border-slate-900">
                      <td className={`px-2 py-2 font-mono ${scan.result === "FOUND" ? "text-emerald-300" : "text-red-300"}`}>{scan.barcode}</td>
                      <td className="px-2 py-2">{scan.result}</td>
                      <td className="px-2 py-2 text-slate-500">{scan.scanned_at ?? "-"}</td>
                    </tr>
                  ))}
                  {!summary && <tr><td className="px-3 py-8 text-center text-slate-500">Start a verification session.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      )}

      {showDefModal && (
        <ItemTemplateModal
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          onClose={() => setShowDefModal(false)}
          onCreated={(def) => {
            setDefinitions((current) => [def, ...current.filter((d) => d.id !== def.id)]);
            applyTemplate(def);
            setShowDefModal(false);
            setMessage(`Item template "${def.name}" created.`);
          }}
        />
      )}
    </section>
  );

  function setFormValue<K extends keyof CreateForm>(field: K, value: CreateForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setMessage("");
  }
}

function ItemTemplateModal({
  apiBaseUrl,
  authHeaders,
  onClose,
  onCreated
}: {
  apiBaseUrl: string;
  authHeaders: { Authorization: string };
  onClose: () => void;
  onCreated: (def: ItemDefinition) => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [category, setCategory] = useState("Ring");
  const [metalType, setMetalType] = useState("Gold");
  const [purity, setPurity] = useState("22");
  const [saleMode, setSaleMode] = useState<"WEIGHT_WISE" | "QUANTITY_WISE">("WEIGHT_WISE");
  const [uom, setUom] = useState<"GRAM" | "CARAT" | "PIECE">("GRAM");
  const [makingType, setMakingType] = useState<"PER_GRAM" | "FLAT">("PER_GRAM");
  const [makingRs, setMakingRs] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/item-definitions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          metal_type: metalType,
          purity_karat: Number(purity) || 22,
          sale_mode: saleMode,
          uom,
          making_charge_type: makingType,
          making_charge_value: Math.round((Number(makingRs) || 0) * 100),
          tag_prefix: prefix.trim()
        })
      });
      const result = (await response.json().catch(() => null)) as { item_definition?: ItemDefinition; errors?: string[] } | null;
      if (!response.ok || !result?.item_definition) {
        throw new Error(result?.errors?.join(" ") || "Could not save template.");
      }
      onCreated(result.item_definition);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <form onClick={(event) => event.stopPropagation()} onSubmit={submit} className="animate-scale-in w-full max-w-lg rounded-lg border border-slate-700 bg-slate-950 p-4 shadow-xl">
        <h2 className="mb-3 text-base font-bold text-amber-300">New Item Template</h2>
        {error && <p className="mb-2 rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-slate-300">Name*
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Gents Ring 22K" className={controlClassName} />
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Tag Prefix
            <input value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} maxLength={5} placeholder="RIN" className={controlClassName} />
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={controlClassName}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Metal
            <select value={metalType} onChange={(event) => setMetalType(event.target.value)} className={controlClassName}>{metals.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Purity
            <select value={purity} onChange={(event) => setPurity(event.target.value)} className={controlClassName}>{purities.map((p) => <option key={p} value={p}>{p}K</option>)}</select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Sale Mode
            <select value={saleMode} onChange={(event) => setSaleMode(event.target.value as "WEIGHT_WISE" | "QUANTITY_WISE")} className={controlClassName}>
              <option value="WEIGHT_WISE">Weight-wise</option>
              <option value="QUANTITY_WISE">Quantity-wise</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">UOM
            <select value={uom} onChange={(event) => setUom(event.target.value as "GRAM" | "CARAT" | "PIECE")} className={controlClassName}>
              <option value="GRAM">Gram</option>
              <option value="CARAT">Carat</option>
              <option value="PIECE">Piece</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Making Type
            <select value={makingType} onChange={(event) => setMakingType(event.target.value as "PER_GRAM" | "FLAT")} className={controlClassName}>
              <option value="PER_GRAM">Per Gram</option>
              <option value="FLAT">Flat</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Default Making (₹)
            <input value={makingRs} onChange={(event) => setMakingRs(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" className={controlClassName} />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded bg-amber-500 px-4 py-2 text-xs font-bold uppercase text-slate-50 transition hover:bg-amber-400 active:scale-95 disabled:opacity-50">
            {saving ? "Saving…" : "Save Template"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border px-3 text-xs font-semibold uppercase ${active ? "border-emerald-500 bg-emerald-500 text-slate-50" : "border-slate-700 text-slate-300"}`}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const toneClassName = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-slate-50";

  return (
    <div className="border-r border-slate-800 px-3 py-2 last:border-r-0">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-sm font-bold ${toneClassName}`}>{value}</div>
    </div>
  );
}

function VerificationBoard({ foundItems, missingItems }: { foundItems: InventoryItem[]; missingItems: InventoryItem[] }) {
  const rows = [
    ...foundItems.map((item) => ({ item, auditStatus: "FOUND" as const })),
    ...missingItems.map((item) => ({ item, auditStatus: "MISSING" as const }))
  ].sort((left, right) => left.item.barcode.localeCompare(right.item.barcode));

  return (
    <div className="min-h-0 overflow-auto border border-slate-800">
      <div className="sticky top-0 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase text-slate-50">Expected Stock Status</div>
      <table className="w-full text-left text-xs">
        <thead className="sticky top-8 bg-slate-950 text-[10px] uppercase text-slate-500">
          <tr>
            <th className="px-2 py-1.5">Tag</th>
            <th className="px-2 py-1.5">Item</th>
            <th className="px-2 py-1.5">Net</th>
            <th className="px-2 py-1.5">Audit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, auditStatus }) => (
            <tr
              key={`${auditStatus}-${item.id}`}
              className={`border-b border-slate-900 ${auditStatus === "FOUND" ? "bg-emerald-950/20" : "bg-red-950/25"}`}
            >
              <td className={`px-2 py-2 font-mono font-semibold ${auditStatus === "FOUND" ? "text-emerald-300" : "text-red-300"}`}>{item.barcode}</td>
              <td className="px-2 py-2">{item.category} {item.purity_karat}K {item.metal_type}</td>
              <td className="px-2 py-2 font-mono">{item.net_weight_g}</td>
              <td className={`px-2 py-2 font-semibold ${auditStatus === "FOUND" ? "text-emerald-300" : "text-red-300"}`}>{auditStatus}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Start a session to load expected stock.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

type ScaledIntegerResult = { ok: true; value: number } | { ok: false; value: 0 };

function parseDisplayNumber(value: string) {
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
  const decimal = match[2] ?? "";
  if (decimal.length > maxDecimalPlaces) return { ok: false, value: 0 };
  const scaled = Number(match[1]) * scale + Number(decimal.padEnd(maxDecimalPlaces, "0") || "0");
  return Number.isSafeInteger(scaled) ? { ok: true, value: scaled } : { ok: false, value: 0 };
}

function formatGram(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? "0.000g" : `${value.toFixed(3)}g`;
}

function isVerificationSummary(value: unknown): value is VerificationSummary {
  return typeof value === "object" && value !== null && "session" in value && "counts" in value;
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-sm text-slate-50 outline-none transition focus:border-emerald-400 disabled:text-slate-600";

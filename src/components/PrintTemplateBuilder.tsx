import { GripVertical, X } from "lucide-react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type PrintTemplateBuilderProps = {
  apiBaseUrl?: string;
};

type PrintTemplate = {
  id: number;
  name: string;
  document_type: "INVOICE" | "RECEIPT" | "LABEL";
  page_size: "A4" | "A5" | "THERMAL_80" | "LABEL_50X25" | "LABEL_65X35";
  is_default: boolean;
  is_active: boolean;
  content: TemplateContent;
};

type TemplateContent = {
  showLogo: boolean;
  showHeader: boolean;
  showFooter: boolean;
  headerLines: string[];
  footerText: string;
  fields: string[];
  columns: string[];
  accentColor: string;
  headerTextColor: string;
  fontSizeBase: "small" | "medium" | "large";
};

const ALL_INVOICE_FIELDS = [
  "invoice.number", "invoice.date", "customer.name", "customer.phone",
  "invoice.hsn", "invoice.gst", "invoice.discount", "invoice.urd",
  "invoice.total", "payment.cash", "payment.upi", "payment.card", "payment.udhari"
];
const ALL_LABEL_FIELDS = [
  "item.barcode", "item.huid", "item.category", "item.metal",
  "item.purity", "item.grossWeight", "item.netWeight", "item.fineWeight", "item.location"
];
const ALL_INVOICE_COLUMNS = ["item", "purity", "grossWeight", "netWeight", "rate", "making", "gst", "amount"];

const blankTemplate: Omit<PrintTemplate, "id"> = {
  name: "New Retail Template",
  document_type: "INVOICE",
  page_size: "A4",
  is_default: false,
  is_active: true,
  content: {
    showLogo: true,
    showHeader: true,
    showFooter: true,
    headerLines: ["{{shop.name}}", "{{shop.address}}", "GSTIN: {{shop.gstin}} | Phone: {{shop.phone}}"],
    footerText: "Thank you for shopping with us.",
    fields: ["invoice.number", "invoice.date", "customer.name", "customer.phone", "invoice.total"],
    columns: ["item", "purity", "netWeight", "rate", "making", "amount"],
    accentColor: "#e2e8f0",
    headerTextColor: "#0f172a",
    fontSizeBase: "medium"
  }
};

export default function PrintTemplateBuilder({ apiBaseUrl = "" }: PrintTemplateBuilderProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | "new">("new");
  const [draft, setDraft] = useState<Omit<PrintTemplate, "id">>(blankTemplate);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadTemplates(); }, []);

  const selectedTemplate = selectedId === "new" ? null : templates.find((t) => t.id === selectedId) ?? null;
  const availableFields = draft.document_type === "LABEL" ? ALL_LABEL_FIELDS : ALL_INVOICE_FIELDS;

  async function loadTemplates() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/settings/print-templates`, { headers: authHeaders });
      const result = (await res.json().catch(() => null)) as { templates?: PrintTemplate[] } | null;
      if (res.ok && result?.templates) {
        setTemplates(result.templates);
        const first = result.templates[0];
        if (first) { setSelectedId(first.id); setDraft(stripId(first)); }
      }
    } catch {
      setError("Could not load print templates.");
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const url = selectedTemplate
      ? `${apiBaseUrl}/api/settings/print-templates/${selectedTemplate.id}`
      : `${apiBaseUrl}/api/settings/print-templates`;
    try {
      const res = await fetch(url, {
        method: selectedTemplate ? "PUT" : "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const result = (await res.json().catch(() => null)) as { template?: PrintTemplate; errors?: string[] } | null;
      if (!res.ok || !result?.template) throw new Error(result?.errors?.join(" ") || "Could not save template.");
      setMessage("Template saved.");
      await loadTemplates();
      setSelectedId(result.template.id);
      setDraft(stripId(result.template));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save template.");
    }
  }

  function selectTemplate(value: string) {
    if (value === "new") { setSelectedId("new"); setDraft(blankTemplate); return; }
    const t = templates.find((c) => c.id === Number(value));
    if (t) { setSelectedId(t.id); setDraft(stripId(t)); }
  }

  function setContent<K extends keyof TemplateContent>(key: K, value: TemplateContent[K]) {
    setDraft((d) => ({ ...d, content: { ...d.content, [key]: value } }));
  }

  function setFieldOrder(newFields: string[]) { setContent("fields", newFields); }
  function setColumnOrder(newColumns: string[]) { setContent("columns", newColumns); }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-sm font-semibold uppercase text-white">Print Template Builder</h1>
            <p className="text-xs text-slate-400">A4, A5, thermal, and label layouts — drag to reorder, pick colors, generate real PDFs</p>
          </div>
          <select value={String(selectedId)} onChange={(e) => selectTemplate(e.target.value)} className={ctrl}>
            <option value="new">New Template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {(message || error) && (
          <p className={`mt-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>
        )}
      </header>

      <main className="grid min-h-0 grid-cols-[400px_1fr] overflow-hidden">
        {/* Left: settings form */}
        <form onSubmit={saveTemplate} className="grid content-start gap-3 overflow-auto border-r border-slate-800 p-4">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Template Name">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={ctrl} />
            </Field>
            <Field label="Document">
              <select
                value={draft.document_type}
                onChange={(e) => setDraft({
                  ...draft,
                  document_type: e.target.value as PrintTemplate["document_type"],
                  page_size: e.target.value === "LABEL" ? "LABEL_50X25" : "A4"
                })}
                className={ctrl}
              >
                <option value="INVOICE">Invoice</option>
                <option value="RECEIPT">Receipt</option>
                <option value="LABEL">Label</option>
              </select>
            </Field>
            <Field label="Paper Size">
              <select
                value={draft.page_size}
                onChange={(e) => setDraft({ ...draft, page_size: e.target.value as PrintTemplate["page_size"] })}
                className={ctrl}
              >
                {(draft.document_type === "LABEL" ? ["LABEL_50X25", "LABEL_65X35"] : ["A4", "A5", "THERMAL_80"]).map(
                  (s) => <option key={s} value={s}>{s}</option>
                )}
              </select>
            </Field>
            <Field label="Font Size">
              <select
                value={draft.content.fontSizeBase}
                onChange={(e) => setContent("fontSizeBase", e.target.value as TemplateContent["fontSizeBase"])}
                className={ctrl}
              >
                <option value="small">Small (8pt)</option>
                <option value="medium">Medium (9pt)</option>
                <option value="large">Large (10pt)</option>
              </select>
            </Field>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-3 gap-2">
            <Toggle label="Logo" checked={draft.content.showLogo} onChange={(v) => setContent("showLogo", v)} />
            <Toggle label="Header" checked={draft.content.showHeader} onChange={(v) => setContent("showHeader", v)} />
            <Toggle label="Footer" checked={draft.content.showFooter} onChange={(v) => setContent("showFooter", v)} />
          </div>

          {/* Colors */}
          <div className="grid gap-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">Branding Colors</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                Header Background
                <div className="flex h-8 items-center gap-2 border border-slate-700 bg-slate-950 px-2">
                  <input
                    type="color"
                    value={draft.content.accentColor}
                    onChange={(e) => setContent("accentColor", e.target.value)}
                    className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-slate-300">{draft.content.accentColor}</span>
                </div>
              </label>
              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                Header Text
                <div className="flex h-8 items-center gap-2 border border-slate-700 bg-slate-950 px-2">
                  <input
                    type="color"
                    value={draft.content.headerTextColor}
                    onChange={(e) => setContent("headerTextColor", e.target.value)}
                    className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="font-mono text-xs text-slate-300">{draft.content.headerTextColor}</span>
                </div>
              </label>
            </div>
          </div>

          {/* Header lines */}
          <Field label="Header Lines">
            <textarea
              value={draft.content.headerLines.join("\n")}
              onChange={(e) => setContent("headerLines", e.target.value.split("\n"))}
              className={`${ctrl} h-24 py-2`}
            />
          </Field>

          {/* Footer */}
          <Field label="Footer Text">
            <input value={draft.content.footerText} onChange={(e) => setContent("footerText", e.target.value)} className={ctrl} />
          </Field>

          {/* Draggable field list */}
          <SortableTokenList
            title="Invoice Fields (drag to reorder)"
            all={availableFields}
            active={draft.content.fields}
            onChange={setFieldOrder}
          />

          {/* Draggable column list */}
          {draft.document_type !== "LABEL" && (
            <SortableTokenList
              title="Line Columns (drag to reorder)"
              all={ALL_INVOICE_COLUMNS}
              active={draft.content.columns}
              onChange={setColumnOrder}
            />
          )}

          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={draft.is_default}
                onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
              />
              Set as default
            </label>
            <button type="submit" className="ml-auto h-9 bg-emerald-500 px-5 text-xs font-bold uppercase text-slate-950 hover:bg-emerald-600">
              Save Template
            </button>
          </div>
        </form>

        {/* Right: live preview */}
        <div className="min-h-0 overflow-auto bg-slate-200 p-6">
          <Preview draft={draft} />
        </div>
      </main>
    </section>
  );
}

// ── Sortable token list with HTML5 drag-and-drop ───────────────────────────

type SortableTokenListProps = {
  title: string;
  all: string[];
  active: string[];
  onChange: (next: string[]) => void;
};

function SortableTokenList({ title, all, active, onChange }: SortableTokenListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const inactive = all.filter((f) => !active.includes(f));

  function onDragStart(idx: number) { setDragIdx(idx); }
  function onDragOver(e: DragEvent, idx: number) { e.preventDefault(); setOverIdx(idx); }
  function onDragEnd() { setDragIdx(null); setOverIdx(null); }

  function onDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...active];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onChange(next);
    setDragIdx(null);
    setOverIdx(null);
  }

  function remove(field: string) { onChange(active.filter((f) => f !== field)); }
  function add(field: string) { onChange([...active, field]); }

  return (
    <div className="grid gap-2">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{title}</div>

      {active.length === 0 ? (
        <p className="text-[11px] text-slate-600">None active — click a token below to add it.</p>
      ) : (
        <div className="grid gap-1">
          {active.map((field, idx) => (
            <div
              key={field}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDrop={() => onDrop(idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 border px-2 py-1.5 text-[11px] transition ${
                dragIdx === idx
                  ? "border-slate-600 opacity-40"
                  : overIdx === idx && dragIdx !== idx
                    ? "border-emerald-400 bg-emerald-950/20"
                    : "border-slate-700 bg-slate-900"
              }`}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-600" />
              <span className="flex-1 font-mono text-slate-300">{field}</span>
              <button
                type="button"
                onClick={() => remove(field)}
                className="text-slate-600 hover:text-red-400"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
          {inactive.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => add(field)}
              className="border border-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-500 hover:border-emerald-500 hover:text-emerald-300"
            >
              + {field}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live preview ──────────────────────────────────────────────────────────

function Preview({ draft }: { draft: Omit<PrintTemplate, "id"> }) {
  const { content, page_size, document_type } = draft;
  const narrow = page_size === "THERMAL_80" || document_type === "LABEL";
  const isA5 = page_size === "A5";
  const fontSize = content.fontSizeBase === "small" ? "text-[8px]" : content.fontSizeBase === "large" ? "text-[10px]" : "text-[9px]";

  const headerStyle = {
    backgroundColor: content.accentColor,
    color: content.headerTextColor
  };

  return (
    <div
      className={`mx-auto bg-white shadow ${fontSize} ${narrow ? "w-64" : isA5 ? "w-[640px]" : "w-[560px]"}`}
      style={{ padding: narrow ? "10px" : "28px" }}
    >
      {content.showHeader && content.headerLines.map((line, i) => (
        <div
          key={`${line}-${i}`}
          className={i === 0 ? "text-center font-bold" : "text-center"}
          style={i === 0 ? { fontSize: "1.3em" } : undefined}
        >
          {sample(line)}
        </div>
      ))}

      <div
        className="my-2 py-1 text-center font-bold uppercase"
        style={{ ...headerStyle, fontSize: "1.1em" }}
      >
        {document_type}
      </div>

      {document_type !== "LABEL" && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-1">
            {content.fields.map((field) => (
              <div key={field} className="text-slate-700">
                {fieldLabel(field)}: <b>{sample(`{{${field}}}`)}</b>
              </div>
            ))}
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                {content.columns.map((col) => (
                  <th key={col} className="border px-1 py-1 text-left" style={headerStyle}>
                    {colLabel(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {content.columns.map((col) => (
                  <td key={col} className="border px-1 py-1 text-slate-800">
                    {col === "amount" ? "Rs 12,500.00" : col === "item" ? "Gold Necklace 22K" : "Sample"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <div className="mt-2 grid gap-0.5 text-right text-slate-700">
            <div>Gross: <b>Rs 12,500.00</b></div>
            <div style={{ ...headerStyle, display: "inline-block", padding: "1px 6px" }}>
              Net Payable: <b>Rs 12,500.00</b>
            </div>
          </div>
        </>
      )}

      {document_type === "LABEL" && (
        <div className="mt-2 grid place-items-center gap-1 text-center">
          <div className="h-8 w-40 bg-[repeating-linear-gradient(90deg,#111_0_2px,#fff_2px_4px,#111_4px_5px,#fff_5px_8px)]" />
          <div className="font-mono font-bold">RIN0001</div>
          {content.fields.filter((f) => f !== "item.barcode").map((f) => (
            <div key={f} className="text-slate-700">{sample(`{{${f}}}`)}</div>
          ))}
        </div>
      )}

      {content.showFooter && content.footerText && (
        <div className="mt-3 text-center text-slate-500">{sample(content.footerText)}</div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 border border-slate-800 px-2 py-2 text-xs text-slate-400 hover:text-white">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function stripId(t: PrintTemplate): Omit<PrintTemplate, "id"> {
  const { id: _id, ...rest } = t;
  return {
    ...rest,
    content: {
      ...rest.content,
      accentColor: rest.content.accentColor ?? "#e2e8f0",
      headerTextColor: rest.content.headerTextColor ?? "#0f172a",
      fontSizeBase: rest.content.fontSizeBase ?? "medium"
    }
  };
}

function sample(value: string) {
  return value
    .replaceAll("{{shop.name}}", "Shree Jewellers")
    .replaceAll("{{shop.address}}", "Main Road, Pune")
    .replaceAll("{{shop.gstin}}", "27ABCDE1234F1Z5")
    .replaceAll("{{shop.phone}}", "9876543210")
    .replaceAll("{{invoice.number}}", "GST-1024")
    .replaceAll("{{invoice.date}}", "2026-06-04")
    .replaceAll("{{customer.name}}", "Walk-in Customer")
    .replaceAll("{{customer.phone}}", "-")
    .replaceAll("{{invoice.total}}", "Rs 12,500.00")
    .replaceAll("{{item.barcode}}", "RIN0001")
    .replaceAll("{{item.purity}}", "22K")
    .replaceAll("{{item.netWeight}}", "8.420g");
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    "invoice.number": "Invoice No.", "invoice.date": "Date", "customer.name": "Customer",
    "customer.phone": "Phone", "invoice.total": "Total", "invoice.gst": "GST",
    "invoice.discount": "Discount", "invoice.urd": "URD", "invoice.hsn": "HSN",
    "payment.cash": "Cash", "payment.upi": "UPI", "payment.card": "Card", "payment.udhari": "Udhari"
  };
  return map[field] ?? field;
}

function colLabel(col: string): string {
  const map: Record<string, string> = {
    item: "Item", purity: "Purity", grossWeight: "Gross Wt", netWeight: "Net Wt",
    rate: "Rate", making: "Making", gst: "GST", amount: "Amount"
  };
  return map[col] ?? col;
}

const ctrl = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400";

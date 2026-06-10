import { Copy, GripVertical, Palette, Settings2, Type, X } from "lucide-react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type PrintTemplateBuilderProps = { apiBaseUrl?: string };

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
  // ── existing fields (backward-compatible) ──
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
  // ── new optional fields ──
  fontFamily?: "sans" | "serif" | "mono";
  tableStyle?: "lined" | "clean" | "zebra";
  logoPosition?: "left" | "center" | "right";
  showSignature?: boolean;
  signatureLabel?: string;
  showTerms?: boolean;
  termsText?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const THEMES = [
  { name: "Classic",    accent: "#e2e8f0", text: "#0f172a" },
  { name: "Gold",       accent: "#92400e", text: "#fef3c7" },
  { name: "Emerald",    accent: "#065f46", text: "#ecfdf5" },
  { name: "Navy",       accent: "#1e3a5f", text: "#e0eaff" },
  { name: "Maroon",     accent: "#7f1d1d", text: "#fff1f2" },
  { name: "Minimal",    accent: "#111827", text: "#f9fafb" },
];

const ALL_INVOICE_FIELDS = [
  "invoice.number", "invoice.date", "customer.name", "customer.phone",
  "customer.address", "invoice.hsn", "invoice.gst", "invoice.discount",
  "invoice.urd", "invoice.total", "payment.cash", "payment.upi",
  "payment.card", "payment.cheque", "payment.neft", "payment.udhari",
];
const ALL_LABEL_FIELDS = [
  "item.barcode", "item.huid", "item.category", "item.metal",
  "item.purity", "item.grossWeight", "item.netWeight", "item.fineWeight", "item.location",
];
const ALL_INVOICE_COLUMNS = ["item", "purity", "grossWeight", "netWeight", "rate", "making", "gst", "amount"];

const TOKENS = [
  "{{shop.name}}", "{{shop.address}}", "{{shop.gstin}}",
  "{{shop.phone}}", "{{invoice.number}}", "{{invoice.date}}",
  "{{customer.name}}", "{{customer.phone}}",
];

const PRESETS: Record<string, Omit<PrintTemplate, "id">> = {
  "Retail Invoice (A4)": {
    name: "Retail Invoice (A4)",
    document_type: "INVOICE",
    page_size: "A4",
    is_default: true,
    is_active: true,
    content: {
      showLogo: true, showHeader: true, showFooter: true,
      headerLines: ["{{shop.name}}", "{{shop.address}}", "GSTIN: {{shop.gstin}} | Ph: {{shop.phone}}"],
      footerText: "Thank you for your purchase!",
      fields: ["invoice.number", "invoice.date", "customer.name", "customer.phone", "invoice.total"],
      columns: ["item", "purity", "netWeight", "rate", "making", "amount"],
      accentColor: "#1e3a5f", headerTextColor: "#e0eaff",
      fontSizeBase: "medium", fontFamily: "sans",
      tableStyle: "lined", logoPosition: "left",
      showSignature: true, signatureLabel: "Authorised Signatory",
      showTerms: true, termsText: "Goods once sold will not be taken back or exchanged.",
    },
  },
  "Thermal Bill": {
    name: "Thermal Bill",
    document_type: "RECEIPT",
    page_size: "THERMAL_80",
    is_default: false,
    is_active: true,
    content: {
      showLogo: false, showHeader: true, showFooter: true,
      headerLines: ["{{shop.name}}", "{{shop.phone}}"],
      footerText: "Visit again!",
      fields: ["invoice.number", "invoice.date", "customer.name"],
      columns: ["item", "amount"],
      accentColor: "#111827", headerTextColor: "#f9fafb",
      fontSizeBase: "small", fontFamily: "mono",
      tableStyle: "clean", logoPosition: "center",
      showSignature: false, signatureLabel: "",
      showTerms: false, termsText: "",
    },
  },
  "GSS Receipt (A5)": {
    name: "GSS Receipt (A5)",
    document_type: "RECEIPT",
    page_size: "A5",
    is_default: false,
    is_active: true,
    content: {
      showLogo: true, showHeader: true, showFooter: true,
      headerLines: ["{{shop.name}}", "{{shop.address}}", "Gold Saving Scheme — Instalment Receipt"],
      footerText: "Keep this receipt safe. Valid only with shop stamp.",
      fields: ["invoice.number", "invoice.date", "customer.name", "customer.phone"],
      columns: ["item", "amount"],
      accentColor: "#92400e", headerTextColor: "#fef3c7",
      fontSizeBase: "medium", fontFamily: "serif",
      tableStyle: "zebra", logoPosition: "right",
      showSignature: true, signatureLabel: "Scheme Manager",
      showTerms: true, termsText: "This receipt acknowledges instalment payment only and does not constitute a purchase agreement.",
    },
  },
  "Barcode Label 50×25": {
    name: "Barcode Label 50×25",
    document_type: "LABEL",
    page_size: "LABEL_50X25",
    is_default: false,
    is_active: true,
    content: {
      showLogo: false, showHeader: false, showFooter: false,
      headerLines: ["{{shop.name}}"],
      footerText: "",
      fields: ["item.barcode", "item.purity", "item.netWeight", "item.category"],
      columns: [],
      accentColor: "#111827", headerTextColor: "#f9fafb",
      fontSizeBase: "small", fontFamily: "mono",
      tableStyle: "clean", logoPosition: "center",
      showSignature: false, signatureLabel: "",
      showTerms: false, termsText: "",
    },
  },
};

const blankTemplate = PRESETS["Retail Invoice (A4)"];

// ── Main component ─────────────────────────────────────────────────────────────

export default function PrintTemplateBuilder({ apiBaseUrl = "" }: PrintTemplateBuilderProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | "new">("new");
  const [draft, setDraft] = useState<Omit<PrintTemplate, "id">>(blankTemplate);
  const [activeTab, setActiveTab] = useState<"branding" | "content" | "advanced">("branding");
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
        if (first) { setSelectedId(first.id); setDraft(normalizeContent(stripId(first))); }
      }
    } catch { setError("Could not load print templates."); }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const url = selectedTemplate
      ? `${apiBaseUrl}/api/settings/print-templates/${selectedTemplate.id}`
      : `${apiBaseUrl}/api/settings/print-templates`;
    try {
      const res = await fetch(url, {
        method: selectedTemplate ? "PUT" : "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = (await res.json().catch(() => null)) as { template?: PrintTemplate; errors?: string[] } | null;
      if (!res.ok || !result?.template) throw new Error(result?.errors?.join(" ") || "Could not save template.");
      setMessage("Template saved.");
      await loadTemplates();
      setSelectedId(result.template.id);
      setDraft(normalizeContent(stripId(result.template)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save template.");
    }
  }

  async function duplicateTemplate() {
    if (!selectedTemplate) return;
    const copy = { ...draft, name: `${draft.name} (Copy)`, is_default: false };
    try {
      const res = await fetch(`${apiBaseUrl}/api/settings/print-templates`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(copy),
      });
      const result = (await res.json().catch(() => null)) as { template?: PrintTemplate } | null;
      if (res.ok && result?.template) {
        setMessage("Template duplicated.");
        await loadTemplates();
        setSelectedId(result.template.id);
        setDraft(normalizeContent(stripId(result.template)));
      }
    } catch { setError("Could not duplicate template."); }
  }

  function selectTemplate(value: string) {
    if (value === "new") { setSelectedId("new"); setDraft(blankTemplate); return; }
    const t = templates.find((c) => c.id === Number(value));
    if (t) { setSelectedId(t.id); setDraft(normalizeContent(stripId(t))); }
  }

  function setContent<K extends keyof TemplateContent>(key: K, value: TemplateContent[K]) {
    setDraft((d) => ({ ...d, content: { ...d.content, [key]: value } }));
  }

  function updateHeaderLine(i: number, value: string) {
    const next = [...draft.content.headerLines];
    next[i] = value;
    setContent("headerLines", next);
  }

  function removeHeaderLine(i: number) {
    setContent("headerLines", draft.content.headerLines.filter((_, j) => j !== i));
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      {/* ── Header bar ── */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-sm font-semibold uppercase text-slate-50">Print Template Builder</h1>
            <p className="text-xs text-slate-400">A4 · A5 · Thermal · Label — themes, drag-and-drop, live preview</p>
          </div>

          {/* Preset loader */}
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) { setDraft(PRESETS[e.target.value]); setSelectedId("new"); } e.target.value = ""; }}
            className={`${ctrl} w-44`}
          >
            <option value="" disabled>Start from preset…</option>
            {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>

          {/* Template selector */}
          <select value={String(selectedId)} onChange={(e) => selectTemplate(e.target.value)} className={`${ctrl} w-52`}>
            <option value="new">— New Template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.is_default ? " ★" : ""}</option>
            ))}
          </select>

          {/* Duplicate */}
          {selectedTemplate && (
            <button
              type="button"
              onClick={duplicateTemplate}
              className="flex h-8 items-center gap-1.5 border border-slate-700 px-3 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
          )}
        </div>

        {(message || error) && (
          <p className={`mt-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>
        )}
      </header>

      <main className="grid min-h-0 grid-cols-[380px_1fr] overflow-hidden">
        {/* ── Left: tabbed settings ── */}
        <form onSubmit={saveTemplate} className="grid grid-rows-[auto_1fr_auto] overflow-hidden border-r border-slate-800">
          {/* Tab bar */}
          <div className="flex border-b border-slate-800">
            {(
              [
                { id: "branding" as const, icon: <Palette className="h-3.5 w-3.5" />, label: "Branding" },
                { id: "content"  as const, icon: <Type      className="h-3.5 w-3.5" />, label: "Content"  },
                { id: "advanced" as const, icon: <Settings2 className="h-3.5 w-3.5" />, label: "Advanced" },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition ${
                  activeTab === tab.id
                    ? "border-b-2 border-emerald-400 text-emerald-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="overflow-auto p-4">

            {/* ══ BRANDING TAB ══ */}
            {activeTab === "branding" && (
              <div className="grid gap-5">

                {/* Color themes */}
                <div className="grid gap-2">
                  <div className={secLabel}>Color Theme</div>
                  <div className="flex flex-wrap gap-2">
                    {THEMES.map((theme) => (
                      <button
                        key={theme.name}
                        type="button"
                        title={theme.name}
                        onClick={() => { setContent("accentColor", theme.accent); setContent("headerTextColor", theme.text); }}
                        className={`h-9 w-16 text-[10px] font-bold transition hover:scale-105 ${
                          draft.content.accentColor === theme.accent
                            ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950"
                            : "opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: theme.accent, color: theme.text }}
                      >
                        {theme.name}
                      </button>
                    ))}
                  </div>
                  {/* Custom pickers */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <ColorPicker label="Header BG" value={draft.content.accentColor} onChange={(v) => setContent("accentColor", v)} />
                    <ColorPicker label="Header Text" value={draft.content.headerTextColor} onChange={(v) => setContent("headerTextColor", v)} />
                  </div>
                </div>

                {/* Table style */}
                <div className="grid gap-2">
                  <div className={secLabel}>Table Style</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["lined", "clean", "zebra"] as const).map((style) => (
                      <TableStyleBtn
                        key={style}
                        style={style}
                        active={(draft.content.tableStyle ?? "lined") === style}
                        onClick={() => setContent("tableStyle", style)}
                        accent={draft.content.accentColor}
                      />
                    ))}
                  </div>
                </div>

                {/* Font */}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Font Family">
                    <select value={draft.content.fontFamily ?? "sans"} onChange={(e) => setContent("fontFamily", e.target.value as TemplateContent["fontFamily"])} className={ctrl}>
                      <option value="sans">Sans-Serif (modern)</option>
                      <option value="serif">Serif (traditional)</option>
                      <option value="mono">Monospace (thermal)</option>
                    </select>
                  </Field>
                  <Field label="Font Size">
                    <select value={draft.content.fontSizeBase} onChange={(e) => setContent("fontSizeBase", e.target.value as TemplateContent["fontSizeBase"])} className={ctrl}>
                      <option value="small">Small (8pt)</option>
                      <option value="medium">Medium (9pt)</option>
                      <option value="large">Large (10pt)</option>
                    </select>
                  </Field>
                </div>

                {/* Logo */}
                <div className="grid gap-2">
                  <div className={secLabel}>Logo</div>
                  <div className="flex items-center gap-3">
                    <Toggle label="Show Logo" checked={draft.content.showLogo} onChange={(v) => setContent("showLogo", v)} />
                    {draft.content.showLogo && (
                      <select value={draft.content.logoPosition ?? "left"} onChange={(e) => setContent("logoPosition", e.target.value as TemplateContent["logoPosition"])} className={`${ctrl} flex-1`}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ══ CONTENT TAB ══ */}
            {activeTab === "content" && (
              <div className="grid gap-4">

                {/* Identity */}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Template Name">
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={ctrl} />
                  </Field>
                  <Field label="Document Type">
                    <select
                      value={draft.document_type}
                      onChange={(e) => setDraft({
                        ...draft,
                        document_type: e.target.value as PrintTemplate["document_type"],
                        page_size: e.target.value === "LABEL" ? "LABEL_50X25" : "A4",
                      })}
                      className={ctrl}
                    >
                      <option value="INVOICE">Invoice</option>
                      <option value="RECEIPT">Receipt</option>
                      <option value="LABEL">Label</option>
                    </select>
                  </Field>
                  <Field label="Paper Size">
                    <select value={draft.page_size} onChange={(e) => setDraft({ ...draft, page_size: e.target.value as PrintTemplate["page_size"] })} className={ctrl}>
                      {(draft.document_type === "LABEL" ? ["LABEL_50X25", "LABEL_65X35"] : ["A4", "A5", "THERMAL_80"]).map(
                        (s) => <option key={s} value={s}>{s}</option>
                      )}
                    </select>
                  </Field>
                </div>

                {/* Section toggles */}
                <div className="grid gap-2">
                  <div className={secLabel}>Sections</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Toggle label="Header"  checked={draft.content.showHeader} onChange={(v) => setContent("showHeader", v)} />
                    <Toggle label="Logo"    checked={draft.content.showLogo}   onChange={(v) => setContent("showLogo", v)} />
                    <Toggle label="Footer"  checked={draft.content.showFooter} onChange={(v) => setContent("showFooter", v)} />
                  </div>
                </div>

                {/* Header lines */}
                <div className="grid gap-2">
                  <div className={secLabel}>
                    Header Lines
                    <span className="ml-1 normal-case font-normal text-slate-600">(use <code className="text-[9px]">{"{{shop.name}}"}</code> tokens)</span>
                  </div>
                  {draft.content.headerLines.map((line, i) => (
                    <div key={i} className="flex gap-1">
                      <input
                        value={line}
                        onChange={(e) => updateHeaderLine(i, e.target.value)}
                        className={`${ctrl} flex-1`}
                        placeholder={i === 0 ? "{{shop.name}}" : `Line ${i + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeHeaderLine(i)}
                        className="flex h-8 w-8 items-center justify-center border border-slate-700 text-slate-600 hover:border-red-500 hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setContent("headerLines", [...draft.content.headerLines, ""])}
                    className="h-7 w-full border border-dashed border-slate-700 text-[11px] text-slate-600 hover:border-slate-500 hover:text-slate-400"
                  >
                    + Add line
                  </button>
                </div>

                {/* Footer text */}
                <Field label="Footer Text">
                  <input value={draft.content.footerText} onChange={(e) => setContent("footerText", e.target.value)} className={ctrl} />
                </Field>

                {/* Fields */}
                <SortableTokenList
                  title="Invoice Fields (drag to reorder)"
                  all={availableFields}
                  active={draft.content.fields}
                  onChange={(v) => setContent("fields", v)}
                />

                {/* Columns */}
                {draft.document_type !== "LABEL" && (
                  <SortableTokenList
                    title="Table Columns (drag to reorder)"
                    all={ALL_INVOICE_COLUMNS}
                    active={draft.content.columns}
                    onChange={(v) => setContent("columns", v)}
                  />
                )}
              </div>
            )}

            {/* ══ ADVANCED TAB ══ */}
            {activeTab === "advanced" && (
              <div className="grid gap-5">

                {/* Signature */}
                <div className="grid gap-2">
                  <div className={secLabel}>Signature Line</div>
                  <Toggle label="Show Signature" checked={draft.content.showSignature ?? false} onChange={(v) => setContent("showSignature", v)} />
                  {draft.content.showSignature && (
                    <Field label="Label">
                      <input
                        value={draft.content.signatureLabel ?? "Authorised Signatory"}
                        onChange={(e) => setContent("signatureLabel", e.target.value)}
                        className={ctrl}
                        placeholder="Authorised Signatory"
                      />
                    </Field>
                  )}
                </div>

                {/* Terms */}
                <div className="grid gap-2">
                  <div className={secLabel}>Terms &amp; Conditions</div>
                  <Toggle label="Show Terms" checked={draft.content.showTerms ?? false} onChange={(v) => setContent("showTerms", v)} />
                  {draft.content.showTerms && (
                    <Field label="Terms Text">
                      <textarea
                        value={draft.content.termsText ?? ""}
                        onChange={(e) => setContent("termsText", e.target.value)}
                        className={`${ctrl} h-20 py-2`}
                        placeholder="Goods once sold will not be taken back…"
                      />
                    </Field>
                  )}
                </div>

                {/* Availability */}
                <div className="grid gap-2">
                  <div className={secLabel}>Availability</div>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={draft.is_default} onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })} />
                    Set as default for this document type
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                    Active (appears in all print menus)
                  </label>
                </div>

                {/* Token reference */}
                <div className="grid gap-2">
                  <div className={secLabel}>Available Tokens</div>
                  <div className="grid grid-cols-2 gap-y-1 gap-x-2">
                    {TOKENS.map((token) => (
                      <div key={token} className="select-all font-mono text-[10px] text-slate-500 hover:text-slate-300 cursor-copy">
                        {token}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save button */}
          <div className="border-t border-slate-800 p-3">
            <button type="submit" className="h-9 w-full bg-emerald-500 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-600 active:bg-emerald-700">
              Save Template
            </button>
          </div>
        </form>

        {/* ── Right: live preview ── */}
        <div className="min-h-0 overflow-auto bg-slate-800 p-6">
          <Preview draft={draft} />
        </div>
      </main>
    </section>
  );
}

// ── Table style mini-preview buttons ─────────────────────────────────────────

function TableStyleBtn({
  style, active, onClick, accent,
}: {
  style: "lined" | "clean" | "zebra";
  active: boolean;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border p-2 transition ${
        active
          ? "border-emerald-400 bg-emerald-950/20 text-emerald-300"
          : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"
      }`}
    >
      {/* Mini table preview */}
      <div className="mb-1 w-full text-[9px]">
        <div className="px-1 py-0.5 text-[8px] font-bold" style={{ backgroundColor: accent, color: "#fff" }}>HDR</div>
        <div className={`px-1 py-0.5 text-[8px] ${style === "lined" ? "border border-t-0 border-slate-400" : style === "zebra" ? "bg-slate-200/10" : ""}`}>Row 1</div>
        <div className={`px-1 py-0.5 text-[8px] ${style === "lined" ? "border border-t-0 border-slate-400" : style === "clean" ? "border-b border-slate-700" : ""}`}>Row 2</div>
      </div>
      <div className="text-center text-[10px] capitalize font-semibold">{style}</div>
    </button>
  );
}

// ── Sortable token list ────────────────────────────────────────────────────────

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

  return (
    <div className="grid gap-2">
      <div className={secLabel}>{title}</div>

      {active.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic">None active — click a token below to add.</p>
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
                onClick={() => onChange(active.filter((f) => f !== field))}
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
              onClick={() => onChange([...active, field])}
              className="border border-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-500 hover:border-emerald-500 hover:text-emerald-300 transition"
            >
              + {field}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live preview ───────────────────────────────────────────────────────────────

function Preview({ draft }: { draft: Omit<PrintTemplate, "id"> }) {
  const { content, page_size, document_type } = draft;
  const narrow = page_size === "THERMAL_80" || document_type === "LABEL";
  const isA5 = page_size === "A5";

  const fontClass =
    content.fontFamily === "serif" ? "font-serif" :
    content.fontFamily === "mono"  ? "font-mono"  : "";
  const fontSize =
    content.fontSizeBase === "small" ? "text-[8px]" :
    content.fontSizeBase === "large" ? "text-[10px]" : "text-[9px]";

  const headerStyle = { backgroundColor: content.accentColor, color: content.headerTextColor };
  const tableStyle  = content.tableStyle ?? "lined";
  const logoPos     = content.logoPosition ?? "left";

  const cellCls = (row: number) =>
    tableStyle === "lined"  ? "border px-1 py-1" :
    tableStyle === "zebra"  ? `px-1 py-1 border-b border-slate-200 ${row % 2 === 1 ? "bg-slate-50" : ""}` :
    "px-1 py-1 border-b border-slate-200";

  return (
    <div>
      <div className="mb-2 text-center text-[10px] uppercase tracking-widest text-slate-500">{page_size}</div>

      <div
        className={`mx-auto bg-white shadow-lg ${fontClass} ${fontSize} ${
          narrow ? "w-64" : isA5 ? "w-[480px]" : "w-[560px]"
        }`}
        style={{ padding: narrow ? "10px" : "28px" }}
      >
        {/* Header block */}
        {content.showHeader && (
          <div className={`mb-2 flex items-start gap-3 ${
            logoPos === "center" ? "flex-col items-center" :
            logoPos === "right"  ? "flex-row-reverse" : ""
          }`}>
            {content.showLogo && (
              <div className="h-8 w-14 shrink-0 rounded bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-400">
                LOGO
              </div>
            )}
            <div className={logoPos === "center" ? "text-center" : ""}>
              {content.headerLines.map((line, i) => (
                <div key={i} className={i === 0 ? "font-bold" : ""} style={i === 0 ? { fontSize: "1.25em" } : undefined}>
                  {sampleText(line)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document type banner */}
        <div className="my-2 py-1 text-center font-bold uppercase" style={{ ...headerStyle, fontSize: "1.05em" }}>
          {document_type === "INVOICE" ? "TAX INVOICE" : document_type === "RECEIPT" ? "RECEIPT" : "LABEL"}
        </div>

        {/* Invoice / Receipt body */}
        {document_type !== "LABEL" && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {content.fields.map((field) => (
                <div key={field} className="text-slate-700">
                  <span className="text-slate-500">{fieldLabel(field)}:</span>{" "}
                  <b>{sampleText(`{{${field}}}`)}</b>
                </div>
              ))}
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {content.columns.map((col) => (
                    <th key={col} className={`px-1 py-1 text-left ${tableStyle === "lined" ? "border" : "border-b-2"}`} style={headerStyle}>
                      {colLabel(col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1].map((row) => (
                  <tr key={row}>
                    {content.columns.map((col) => (
                      <td key={col} className={`text-slate-800 ${cellCls(row)}`}>
                        {col === "amount" ? (row === 0 ? "₹12,500" : "₹4,200") :
                         col === "item"   ? (row === 0 ? "Gold Necklace 22K" : "Silver Earring") :
                         col === "purity" ? (row === 0 ? "22K" : "92.5") :
                         col === "rate"   ? (row === 0 ? "7,000" : "85") :
                         "–"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 space-y-0.5 text-right text-slate-700">
              <div>Sub-total: <b>₹16,700.00</b></div>
              <div>CGST 1.5%: <b>₹250.50</b></div>
              <div>SGST 1.5%: <b>₹250.50</b></div>
              <div className="inline-block px-2 py-0.5 font-bold" style={headerStyle}>
                Net Payable: ₹17,201.00
              </div>
            </div>

            {content.showSignature && (
              <div className="mt-6 ml-auto w-36 border-t border-slate-400 pt-1 text-center text-slate-600">
                <div>{content.signatureLabel ?? "Authorised Signatory"}</div>
              </div>
            )}

            {content.showTerms && content.termsText && (
              <div className="mt-3 border-t border-slate-200 pt-1 text-[8px] text-slate-500">
                {content.termsText}
              </div>
            )}
          </>
        )}

        {/* Label body */}
        {document_type === "LABEL" && (
          <div className="mt-2 grid place-items-center gap-1 text-center">
            <div className="h-8 w-40 bg-[repeating-linear-gradient(90deg,#111_0_2px,#fff_2px_4px,#111_4px_5px,#fff_5px_8px)]" />
            <div className="font-mono font-bold">RIN0001</div>
            {content.fields.filter((f) => f !== "item.barcode").map((f) => (
              <div key={f} className="text-slate-700">{sampleText(`{{${f}}}`)}</div>
            ))}
          </div>
        )}

        {/* Footer */}
        {content.showFooter && content.footerText && (
          <div className="mt-3 border-t border-slate-100 pt-2 text-center text-slate-500">
            {sampleText(content.footerText)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
      {label}
      <div className="flex h-8 items-center gap-2 border border-slate-700 bg-slate-950 px-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0" />
        <span className="font-mono text-xs text-slate-300">{value}</span>
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 border border-slate-800 px-2 py-2 text-xs text-slate-400 hover:text-slate-50 transition">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeContent(t: Omit<PrintTemplate, "id">): Omit<PrintTemplate, "id"> {
  return {
    ...t,
    content: {
      fontFamily: "sans",
      tableStyle: "lined",
      logoPosition: "left",
      showSignature: false,
      signatureLabel: "Authorised Signatory",
      showTerms: false,
      termsText: "",
      ...t.content,
      accentColor: t.content.accentColor ?? "#e2e8f0",
      headerTextColor: t.content.headerTextColor ?? "#0f172a",
      fontSizeBase: t.content.fontSizeBase ?? "medium",
    },
  };
}

function stripId(t: PrintTemplate): Omit<PrintTemplate, "id"> {
  const { id: _id, ...rest } = t;
  return rest;
}

function sampleText(value: string) {
  return value
    .replaceAll("{{shop.name}}",     "Shree Jewellers")
    .replaceAll("{{shop.address}}",  "Main Road, Pune 411001")
    .replaceAll("{{shop.gstin}}",    "27ABCDE1234F1Z5")
    .replaceAll("{{shop.phone}}",    "9876543210")
    .replaceAll("{{invoice.number}}","GST-1024")
    .replaceAll("{{invoice.date}}",  "2026-06-10")
    .replaceAll("{{invoice.total}}", "₹17,201.00")
    .replaceAll("{{customer.name}}", "Priya Sharma")
    .replaceAll("{{customer.phone}}","9988776655")
    .replaceAll("{{customer.address}}","12, MG Road, Pune")
    .replaceAll("{{item.barcode}}",  "RIN0001")
    .replaceAll("{{item.purity}}",   "22K")
    .replaceAll("{{item.netWeight}}","8.420g");
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    "invoice.number":   "Invoice No.",
    "invoice.date":     "Date",
    "invoice.total":    "Total",
    "invoice.gst":      "GST",
    "invoice.discount": "Discount",
    "invoice.urd":      "URD",
    "invoice.hsn":      "HSN",
    "customer.name":    "Customer",
    "customer.phone":   "Phone",
    "customer.address": "Address",
    "payment.cash":     "Cash",
    "payment.upi":      "UPI",
    "payment.card":     "Card",
    "payment.cheque":   "Cheque",
    "payment.neft":     "NEFT",
    "payment.udhari":   "Udhari",
  };
  return map[field] ?? field;
}

function colLabel(col: string): string {
  const map: Record<string, string> = {
    item: "Item", purity: "Purity", grossWeight: "Gross Wt",
    netWeight: "Net Wt", rate: "Rate/g", making: "Making",
    gst: "GST", amount: "Amount",
  };
  return map[col] ?? col;
}

const ctrl     = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400";
const secLabel = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";

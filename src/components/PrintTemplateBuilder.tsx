import type { FormEvent } from "react";
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
};

const invoiceFields = [
  "invoice.number", "invoice.date", "customer.name", "customer.phone", "invoice.hsn", "invoice.gst",
  "invoice.discount", "invoice.urd", "invoice.total", "payment.cash", "payment.upi", "payment.card", "payment.udhari"
];
const labelFields = ["item.barcode", "item.huid", "item.category", "item.metal", "item.purity", "item.grossWeight", "item.netWeight", "item.fineWeight", "item.location"];
const invoiceColumns = ["item", "purity", "grossWeight", "netWeight", "rate", "making", "gst", "amount"];

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
    columns: ["item", "purity", "netWeight", "rate", "making", "amount"]
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

  useEffect(() => {
    void loadTemplates();
  }, []);

  const selectedTemplate = selectedId === "new" ? null : templates.find((template) => template.id === selectedId) ?? null;
  const fields = draft.document_type === "LABEL" ? labelFields : invoiceFields;

  async function loadTemplates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/print-templates`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { templates?: PrintTemplate[] } | null;

      if (response.ok && result?.templates) {
        setTemplates(result.templates);
        const first = result.templates[0];
        if (first) {
          setSelectedId(first.id);
          setDraft(stripId(first));
        }
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
      const response = await fetch(url, {
        method: selectedTemplate ? "PUT" : "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const result = (await response.json().catch(() => null)) as { template?: PrintTemplate; errors?: string[] } | null;

      if (!response.ok || !result?.template) {
        throw new Error(result?.errors?.join(" ") || "Could not save template.");
      }

      setMessage("Print template saved.");
      await loadTemplates();
      setSelectedId(result.template.id);
      setDraft(stripId(result.template));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save template.");
    }
  }

  function selectTemplate(value: string) {
    if (value === "new") {
      setSelectedId("new");
      setDraft(blankTemplate);
      return;
    }

    const template = templates.find((candidate) => candidate.id === Number(value));
    if (template) {
      setSelectedId(template.id);
      setDraft(stripId(template));
    }
  }

  function toggleField(field: string, target: "fields" | "columns") {
    setDraft((current) => {
      const values = current.content[target];
      const nextValues = values.includes(field) ? values.filter((value) => value !== field) : [...values, field];
      return { ...current, content: { ...current.content, [target]: nextValues } };
    });
  }

  return (
    <section className="grid min-h-full grid-rows-[auto_1fr] bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-sm font-semibold uppercase text-white">Print Template Builder</h1>
            <p className="text-xs text-slate-400">A4, A5, thermal, and barcode label layouts</p>
          </div>
          <select value={String(selectedId)} onChange={(event) => selectTemplate(event.target.value)} className={controlClassName}>
            <option value="new">New Template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </div>
        {(message || error) && <p className={`mt-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>}
      </header>

      <main className="grid min-h-0 grid-cols-[430px_1fr] gap-3 overflow-auto p-3">
        <form onSubmit={saveTemplate} className="grid content-start gap-3 border border-slate-800 bg-slate-900 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Template Name">
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={controlClassName} />
            </Field>
            <Field label="Document">
              <select value={draft.document_type} onChange={(event) => setDraft({ ...draft, document_type: event.target.value as PrintTemplate["document_type"], page_size: event.target.value === "LABEL" ? "LABEL_50X25" : "A4" })} className={controlClassName}>
                <option value="INVOICE">Invoice</option>
                <option value="RECEIPT">Receipt</option>
                <option value="LABEL">Label</option>
              </select>
            </Field>
            <Field label="Paper">
              <select value={draft.page_size} onChange={(event) => setDraft({ ...draft, page_size: event.target.value as PrintTemplate["page_size"] })} className={controlClassName}>
                {(draft.document_type === "LABEL" ? ["LABEL_50X25", "LABEL_65X35"] : ["A4", "A5", "THERMAL_80"]).map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-xs font-semibold uppercase text-slate-400">
              <input type="checkbox" checked={draft.is_default} onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })} />
              Default
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <Toggle label="Logo" checked={draft.content.showLogo} onChange={(checked) => setContent("showLogo", checked)} />
            <Toggle label="Header" checked={draft.content.showHeader} onChange={(checked) => setContent("showHeader", checked)} />
            <Toggle label="Footer" checked={draft.content.showFooter} onChange={(checked) => setContent("showFooter", checked)} />
          </div>

          <Field label="Header Lines">
            <textarea value={draft.content.headerLines.join("\n")} onChange={(event) => setContent("headerLines", event.target.value.split("\n"))} className={`${controlClassName} h-24 py-2`} />
          </Field>
          <Field label="Footer Text">
            <input value={draft.content.footerText} onChange={(event) => setContent("footerText", event.target.value)} className={controlClassName} />
          </Field>

          <TokenGroup title="Field Tokens" values={fields} selected={draft.content.fields} onToggle={(field) => toggleField(field, "fields")} />
          {draft.document_type !== "LABEL" && <TokenGroup title="Line Columns" values={invoiceColumns} selected={draft.content.columns} onToggle={(field) => toggleField(field, "columns")} />}

          <button type="submit" className="h-9 bg-emerald-500 px-4 text-xs font-bold uppercase text-slate-950">Save Template</button>
        </form>

        <section className="min-h-0 overflow-auto border border-slate-800 bg-slate-100 p-6 text-slate-950">
          <Preview draft={draft} />
        </section>
      </main>
    </section>
  );

  function setContent<K extends keyof TemplateContent>(field: K, value: TemplateContent[K]) {
    setDraft((current) => ({ ...current, content: { ...current.content, [field]: value } }));
  }
}

function Preview({ draft }: { draft: Omit<PrintTemplate, "id"> }) {
  const narrow = draft.page_size === "THERMAL_80" || draft.document_type === "LABEL";
  return (
    <div className={`mx-auto bg-white p-5 shadow text-xs ${narrow ? "w-64" : draft.page_size === "A5" ? "w-[720px]" : "w-[620px]"}`}>
      {draft.content.showHeader && draft.content.headerLines.map((line, index) => (
        <div key={`${line}-${index}`} className={index === 0 ? "text-center text-base font-bold" : "text-center"}>{sample(line)}</div>
      ))}
      <div className="my-3 border-y border-slate-300 py-2 text-center font-bold uppercase">{draft.document_type}</div>
      <div className="grid grid-cols-2 gap-1">
        {draft.content.fields.map((field) => <div key={field}>{field}: <b>{sample(`{{${field}}}`)}</b></div>)}
      </div>
      {draft.document_type === "LABEL" ? (
        <div className="mt-3 grid place-items-center">
          <div className="h-10 w-44 bg-[repeating-linear-gradient(90deg,#111_0_2px,#fff_2px_4px,#111_4px_5px,#fff_5px_8px)]" />
          <div className="mt-1 font-mono font-bold">RIN0001</div>
        </div>
      ) : (
        <table className="mt-3 w-full border-collapse">
          <thead><tr>{draft.content.columns.map((column) => <th key={column} className="border bg-slate-200 px-1 py-1 text-left">{column}</th>)}</tr></thead>
          <tbody><tr>{draft.content.columns.map((column) => <td key={column} className="border px-1 py-1">{column === "amount" ? "Rs 12,500.00" : "Sample"}</td>)}</tr></tbody>
        </table>
      )}
      {draft.content.showFooter && <div className="mt-4 text-center">{sample(draft.content.footerText)}</div>}
    </div>
  );
}

function TokenGroup({ title, values, selected, onToggle }: { title: string; values: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <button key={value} type="button" onClick={() => onToggle(value)} className={`border px-2 py-1 text-[11px] ${selected.includes(value) ? "border-emerald-500 bg-emerald-500 text-slate-950" : "border-slate-700 text-slate-300"}`}>
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 border border-slate-800 px-2 py-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">{label}{children}</label>;
}

function stripId(template: PrintTemplate): Omit<PrintTemplate, "id"> {
  const { id: _id, ...rest } = template;
  return rest;
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

const controlClassName = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400";

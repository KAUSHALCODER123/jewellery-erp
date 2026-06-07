import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type ReturnsModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "sales" | "purchase";

type CustomerOption = {
  id: number;
  name: string;
  phone?: string | null;
};

type ReturnLine = {
  description: string;
  metalType: string;
  purityKarat: string;
  grossWeightGrams: string;
  netWeightGrams: string;
  amountRupees: string;
  gstRupees: string;
};

const REFUND_MODES = ["CASH", "UPI", "CARD", "BANK", "ADJUSTMENT"] as const;

function emptyLine(): ReturnLine {
  return {
    description: "",
    metalType: "Gold",
    purityKarat: "22",
    grossWeightGrams: "",
    netWeightGrams: "",
    amountRupees: "",
    gstRupees: ""
  };
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function gramsToMg(grams: string): number {
  const value = Number(grams);
  return Number.isFinite(value) ? Math.round(value * 1000) : 0;
}

function rupeesToPaise(rupees: string): number {
  const value = Number(rupees);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReturnsModule({ apiBaseUrl = "" }: ReturnsModuleProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("sales");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  // Shared header fields
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [returnDate, setReturnDate] = useState(getToday());
  const [refundMode, setRefundMode] = useState<(typeof REFUND_MODES)[number]>("CASH");
  const [refundReference, setRefundReference] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([emptyLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/crm/customers?limit=200`, { headers: authHeaders });
        const data = (await response.json().catch(() => null)) as { customers?: CustomerOption[] } | null;
        if (response.ok) setCustomers(data?.customers ?? []);
      } catch {
        setCustomers([]);
      }
    })();
  }, [apiBaseUrl, authHeaders]);

  function resetForm() {
    setSourceDocumentId("");
    setCustomerId("");
    setSupplierName("");
    setReturnDate(getToday());
    setRefundMode("CASH");
    setRefundReference("");
    setReason("");
    setLines([emptyLine()]);
  }

  function switchTab(tab: ActiveTab) {
    setActiveTab(tab);
    setMessage("");
    setError("");
    resetForm();
  }

  function updateLine(index: number, patch: Partial<ReturnLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const computedLines = lines.map((line) => ({
    description: line.description.trim(),
    metalType: line.metalType.trim() || "Gold",
    purityKarat: Number(line.purityKarat),
    grossWeightMg: gramsToMg(line.grossWeightGrams),
    netWeightMg: gramsToMg(line.netWeightGrams),
    amountPaise: rupeesToPaise(line.amountRupees),
    gstPaise: rupeesToPaise(line.gstRupees)
  }));

  const grossTotalPaise = computedLines.reduce((total, line) => total + line.amountPaise, 0);
  const gstReversalPaise = computedLines.reduce((total, line) => total + line.gstPaise, 0);

  function validate(): string | null {
    if (activeTab === "purchase" && !supplierName.trim()) {
      return "Supplier name is required for purchase returns.";
    }
    if (computedLines.length === 0) {
      return "Add at least one return line.";
    }
    for (const [i, line] of computedLines.entries()) {
      if (!line.description) return `Line ${i + 1}: description is required.`;
      if (!Number.isInteger(line.purityKarat) || line.purityKarat <= 0) return `Line ${i + 1}: purity (karat) must be a positive whole number.`;
      if (line.grossWeightMg <= 0) return `Line ${i + 1}: gross weight must be greater than 0.`;
      if (line.netWeightMg <= 0) return `Line ${i + 1}: net weight must be greater than 0.`;
      if (line.netWeightMg > line.grossWeightMg) return `Line ${i + 1}: net weight cannot exceed gross weight.`;
      if (line.amountPaise < 0) return `Line ${i + 1}: refund amount cannot be negative.`;
    }
    if (grossTotalPaise <= 0) return "Total refund must be greater than 0.";
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const endpoint = activeTab === "sales" ? "/api/pos/sales-returns" : "/api/pos/purchase-returns";
    const payload = {
      source_document_id: sourceDocumentId.trim() ? Number(sourceDocumentId.trim()) : null,
      customer_id: activeTab === "sales" && customerId ? Number(customerId) : null,
      supplier_name: activeTab === "purchase" ? supplierName.trim() : undefined,
      document_date: returnDate,
      refund_mode: refundMode,
      refund_reference: refundReference.trim() || null,
      reason: reason.trim() || null,
      lines: computedLines.map((line) => ({
        item_id: null,
        description: line.description,
        metal_type: line.metalType,
        purity_karat: line.purityKarat,
        gross_weight_mg: line.grossWeightMg,
        net_weight_mg: line.netWeightMg,
        amount_paise: line.amountPaise,
        gst_paise: line.gstPaise
      })),
      gross_total_paise: grossTotalPaise,
      gst_reversal_paise: gstReversalPaise,
      total_refund_paise: grossTotalPaise
    };

    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as
        | { sales_return?: { return_number?: string }; purchase_return?: { return_number?: string }; errors?: string[] }
        | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not save the return.");
      }

      const number = result?.sales_return?.return_number ?? result?.purchase_return?.return_number ?? "";
      setMessage(`${activeTab === "sales" ? "Sales" : "Purchase"} return saved${number ? ` (${number})` : ""}.`);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the return.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "h-9 w-full border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded";
  const labelClass = "grid gap-1 text-[10px] font-semibold uppercase text-slate-400";

  return (
    <section className="grid min-h-full content-start gap-3 bg-slate-950 p-4 text-slate-100">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => switchTab("sales")}
          className={`h-9 px-4 text-xs font-bold uppercase rounded ${activeTab === "sales" ? "bg-emerald-500 text-slate-50" : "border border-slate-700 text-slate-300 hover:border-slate-500"}`}
        >
          Sales Return
        </button>
        <button
          type="button"
          onClick={() => switchTab("purchase")}
          className={`h-9 px-4 text-xs font-bold uppercase rounded ${activeTab === "purchase" ? "bg-emerald-500 text-slate-50" : "border border-slate-700 text-slate-300 hover:border-slate-500"}`}
        >
          Purchase Return
        </button>
      </div>

      {error && <p className="rounded bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}
      {message && <p className="rounded bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">{message}</p>}

      <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className={labelClass}>
            {activeTab === "sales" ? "Original Invoice ID" : "Original Purchase ID"} (optional)
            <input className={inputClass} inputMode="numeric" value={sourceDocumentId} onChange={(e) => setSourceDocumentId(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 1024" />
          </label>

          {activeTab === "sales" ? (
            <label className={labelClass}>
              Customer (optional)
              <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— None —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className={labelClass}>
              Supplier Name *
              <input className={inputClass} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier / vendor" />
            </label>
          )}

          <label className={labelClass}>
            Return Date
            <input type="date" className={inputClass} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </label>

          <label className={labelClass}>
            Refund Mode
            <select className={inputClass} value={refundMode} onChange={(e) => setRefundMode(e.target.value as (typeof REFUND_MODES)[number])}>
              {REFUND_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>

          <label className={labelClass}>
            Refund Reference (optional)
            <input className={inputClass} value={refundReference} onChange={(e) => setRefundReference(e.target.value)} placeholder="UTR / cheque no." />
          </label>

          <label className={`${labelClass} sm:col-span-3`}>
            Reason (optional)
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for return" />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-2 py-1">Description</th>
                <th className="px-2 py-1">Metal</th>
                <th className="px-2 py-1">Karat</th>
                <th className="px-2 py-1">Gross (g)</th>
                <th className="px-2 py-1">Net (g)</th>
                <th className="px-2 py-1">Refund ₹</th>
                <th className="px-2 py-1">GST ₹</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="border-t border-slate-800">
                  <td className="px-1 py-1"><input className={inputClass} value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} placeholder="Item description" /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-20`} value={line.metalType} onChange={(e) => updateLine(index, { metalType: e.target.value })} /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-16`} inputMode="numeric" value={line.purityKarat} onChange={(e) => updateLine(index, { purityKarat: e.target.value.replace(/[^\d]/g, "") })} /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-24`} inputMode="decimal" value={line.grossWeightGrams} onChange={(e) => updateLine(index, { grossWeightGrams: e.target.value })} /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-24`} inputMode="decimal" value={line.netWeightGrams} onChange={(e) => updateLine(index, { netWeightGrams: e.target.value })} /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-28`} inputMode="decimal" value={line.amountRupees} onChange={(e) => updateLine(index, { amountRupees: e.target.value })} /></td>
                  <td className="px-1 py-1"><input className={`${inputClass} w-24`} inputMode="decimal" value={line.gstRupees} onChange={(e) => updateLine(index, { gstRupees: e.target.value })} /></td>
                  <td className="px-1 py-1">
                    <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-red-300 hover:text-red-200 disabled:text-slate-600 text-sm">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])} className="h-8 border border-slate-700 px-3 text-[11px] font-semibold uppercase text-slate-200 hover:border-emerald-400 rounded">
            + Add Line
          </button>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-400">GST reversal: <span className="font-mono text-slate-200">{formatPaise(gstReversalPaise)}</span></span>
            <span className="text-slate-300 font-semibold">Total refund: <span className="font-mono text-emerald-300">{formatPaise(grossTotalPaise)}</span></span>
            <button type="submit" disabled={submitting} className="h-9 bg-emerald-500 px-5 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 rounded">
              {submitting ? "Saving…" : `Save ${activeTab === "sales" ? "Sales" : "Purchase"} Return`}
            </button>
          </div>
        </div>
      </form>

      <p className="text-[10px] text-slate-500">
        Sales returns mark any linked stock items back to IN_STOCK and post a refund voucher. Purchase returns record vendor refunds. Totals are auto-summed from the lines to match accounting validation.
      </p>
    </section>
  );
}

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, PackageCheck, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type ApprovalMemoModuleProps = { apiBaseUrl?: string };

type ActiveTab = "issue" | "register";

type AvailableItem = {
  id: number;
  barcode: string;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_mg: number;
  net_weight_mg: number;
  gross_weight_g: string;
  net_weight_g: string;
  design_name: string | null;
};

type MemoLine = {
  id: number;
  item_id: number | null;
  description: string;
  barcode: string | null;
  metal_type: string | null;
  purity_karat: number | null;
  gross_weight_g: string;
  net_weight_g: string;
  estimated_value_rupees: string;
  line_status: "OUT" | "RETURNED" | "SOLD";
  returned_at: string | null;
};

type Memo = {
  id: number;
  memo_number: string;
  memo_type: "CUSTOMER" | "OUTWARD";
  party_name: string;
  party_phone: string | null;
  issue_date: string;
  due_date: string | null;
  status: "OPEN" | "PARTIAL" | "CLOSED" | "CONVERTED";
  notes: string | null;
  lines: MemoLine[];
  line_count: number;
  out_count: number;
  out_value_rupees: string;
};

type DraftLine = {
  item: AvailableItem;
  estimatedValueRupees: string;
};

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 transition-colors rounded-sm";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function rupeesToPaise(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0;
  const frac = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(frac);
}

export default function ApprovalMemoModule({ apiBaseUrl = "" }: ApprovalMemoModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("register");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Issue form state
  const [memoType, setMemoType] = useState<"CUSTOMER" | "OUTWARD">("CUSTOMER");
  const [partyName, setPartyName] = useState("");
  const [partyPhone, setPartyPhone] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [available, setAvailable] = useState<AvailableItem[]>([]);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Register state
  const [statusFilter, setStatusFilter] = useState<"" | "OPEN" | "PARTIAL" | "CLOSED" | "CONVERTED">("OPEN");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyMemo, setBusyMemo] = useState<number | null>(null);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${session?.token ?? ""}` }),
    [session?.token]
  );

  const loadMemos = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`${apiBaseUrl}/api/approvals${qs}`, { headers: authHeaders });
      const data = await res.json();
      setMemos(res.ok && Array.isArray(data.memos) ? data.memos : []);
    } catch {
      setMemos([]);
    }
  }, [apiBaseUrl, authHeaders, statusFilter]);

  useEffect(() => {
    if (activeTab === "register") void loadMemos();
  }, [activeTab, loadMemos]);

  // Debounced available-item search
  useEffect(() => {
    if (activeTab !== "issue") return;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/approvals/available-items?search=${encodeURIComponent(itemSearch)}`, { headers: authHeaders });
        const data = await res.json();
        setAvailable(res.ok && Array.isArray(data.items) ? data.items : []);
      } catch {
        setAvailable([]);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [activeTab, itemSearch, apiBaseUrl, authHeaders]);

  const addDraftLine = (item: AvailableItem) => {
    if (draftLines.some((d) => d.item.id === item.id)) return;
    setDraftLines((prev) => [...prev, { item, estimatedValueRupees: "" }]);
  };

  const removeDraftLine = (itemId: number) => {
    setDraftLines((prev) => prev.filter((d) => d.item.id !== itemId));
  };

  const resetIssueForm = () => {
    setPartyName("");
    setPartyPhone("");
    setIssueDate(todayIso());
    setDueDate("");
    setNotes("");
    setDraftLines([]);
    setItemSearch("");
  };

  const submitMemo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!partyName.trim()) {
      setError(memoType === "CUSTOMER" ? "Customer name is required." : "Party / firm name is required.");
      return;
    }
    if (draftLines.length === 0) {
      setError("Add at least one item to the memo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/approvals`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          memo_type: memoType,
          party_name: partyName.trim(),
          party_phone: partyPhone.trim() || null,
          issue_date: issueDate,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          lines: draftLines.map((d) => ({
            item_id: d.item.id,
            estimated_value_paise: rupeesToPaise(d.estimatedValueRupees)
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to create memo.");
      setMessage(`Memo ${data.memo.memo_number} issued with ${data.memo.line_count} item(s).`);
      resetIssueForm();
      setActiveTab("register");
      setStatusFilter("OPEN");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create memo.");
    } finally {
      setSubmitting(false);
    }
  };

  const returnLines = async (memo: Memo, lineIds: number[] | null) => {
    setBusyMemo(memo.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/approvals/${memo.id}/return`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(lineIds ? { line_ids: lineIds } : {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to return items.");
      setMessage(`Items from ${memo.memo_number} returned to stock.`);
      await loadMemos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to return items.");
    } finally {
      setBusyMemo(null);
    }
  };

  const convertLines = async (memo: Memo, lineIds: number[] | null) => {
    setBusyMemo(memo.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/approvals/${memo.id}/convert`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(lineIds ? { line_ids: lineIds } : {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to mark sold.");
      setMessage(`Items from ${memo.memo_number} marked sold — raise the GST bill in POS Billing.`);
      await loadMemos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark sold.");
    } finally {
      setBusyMemo(null);
    }
  };

  const draftGrossG = draftLines.reduce((sum, d) => sum + d.item.gross_weight_mg, 0) / 1000;

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-semibold uppercase text-white tracking-wide">
            <ClipboardList size={16} className="text-emerald-400" /> Approval / Jangad Memo
          </h1>
          <p className="text-xs text-slate-400">Issue stock on sale-or-return and track it until returned or billed</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <button type="button" onClick={() => setActiveTab("register")} className={tabClass(activeTab === "register")}>Memo Register</button>
          <button type="button" onClick={() => setActiveTab("issue")} className={tabClass(activeTab === "issue")}>Issue New Memo</button>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1.5 text-xs font-semibold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "issue" ? (
          <form onSubmit={submitMemo} className="grid h-full grid-cols-[320px_1fr_360px] overflow-hidden">
            <aside className="grid content-start gap-3 overflow-auto border-r border-slate-800 bg-slate-900 p-4">
              <h2 className="text-xs font-bold uppercase text-white tracking-wide">Memo Header</h2>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Memo Type
                <select value={memoType} onChange={(e) => setMemoType(e.target.value as "CUSTOMER" | "OUTWARD")} className={controlClassName}>
                  <option value="CUSTOMER">Customer Approval (in-shop)</option>
                  <option value="OUTWARD">Outward / Other Jeweller / Exhibition</option>
                </select>
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                {memoType === "CUSTOMER" ? "Customer Name" : "Party / Firm Name"}
                <input value={partyName} onChange={(e) => setPartyName(e.target.value)} className={controlClassName} required />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Phone
                <input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} className={controlClassName} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                  Issue Date
                  <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={controlClassName} />
                </label>
                <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                  Expected Return
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={controlClassName} />
                </label>
              </div>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16 w-full border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-emerald-400" />
              </label>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_auto_1fr]">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2">
                <h2 className="text-xs font-semibold uppercase text-white tracking-wide">Available In-Stock Items</h2>
                <span className="text-[10px] text-slate-500">Click to add to memo</span>
              </div>
              <div className="border-b border-slate-800 p-2">
                <div className="flex items-center gap-2 border border-slate-700 bg-slate-950 px-2">
                  <Search size={14} className="text-slate-500" />
                  <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search barcode, design, metal..." className="h-8 flex-1 bg-transparent text-xs text-white outline-none" />
                </div>
              </div>
              <div className="min-h-0 overflow-auto p-2">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                      <th className="px-2 py-1">Barcode</th>
                      <th className="px-2 py-1">Item</th>
                      <th className="px-2 py-1 text-right">Gross</th>
                      <th className="px-2 py-1 text-right">Net</th>
                      <th className="px-2 py-1 text-center">Add</th>
                    </tr>
                  </thead>
                  <tbody>
                    {available.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-8 text-center text-slate-500 uppercase font-semibold">No in-stock items found.</td></tr>
                    ) : available.map((it) => {
                      const added = draftLines.some((d) => d.item.id === it.id);
                      return (
                        <tr key={it.id} className="border-b border-slate-900 hover:bg-slate-900/40">
                          <td className="px-2 py-2 font-mono text-slate-300">{it.barcode}</td>
                          <td className="px-2 py-2 text-slate-300">{it.metal_type} {it.purity_karat}K · {it.design_name || it.category}</td>
                          <td className="px-2 py-2 text-right font-mono text-slate-400">{it.gross_weight_g} g</td>
                          <td className="px-2 py-2 text-right font-mono text-slate-400">{it.net_weight_g} g</td>
                          <td className="px-2 py-2 text-center">
                            <button type="button" disabled={added} onClick={() => addDraftLine(it)} className="grid h-6 w-6 place-items-center rounded border border-emerald-800 text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-30">
                              <Plus size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="grid min-h-0 grid-rows-[auto_1fr_auto] border-l border-slate-800 bg-slate-900">
              <div className="border-b border-slate-800 px-4 py-2">
                <h2 className="text-xs font-bold uppercase text-white tracking-wide">Memo Items ({draftLines.length})</h2>
                <p className="text-[10px] text-slate-500">Total gross {draftGrossG.toFixed(3)} g</p>
              </div>
              <div className="min-h-0 overflow-auto p-3">
                {draftLines.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-8 uppercase">No items added yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {draftLines.map((d) => (
                      <div key={d.item.id} className="rounded border border-slate-700 bg-slate-950 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-[11px] text-emerald-300">{d.item.barcode}</div>
                            <div className="truncate text-[11px] text-slate-300">{d.item.metal_type} {d.item.purity_karat}K · {d.item.gross_weight_g} g</div>
                          </div>
                          <button type="button" onClick={() => removeDraftLine(d.item.id)} className="text-red-400 hover:text-red-300"><Trash2 size={13} /></button>
                        </div>
                        <label className="mt-1.5 grid gap-1 text-[9px] font-bold uppercase text-slate-500">
                          Est. value (Rs, optional)
                          <input
                            value={d.estimatedValueRupees}
                            onChange={(e) => setDraftLines((prev) => prev.map((x) => x.item.id === d.item.id ? { ...x, estimatedValueRupees: e.target.value.replace(/[^\d.]/g, "") } : x))}
                            className="h-7 border border-slate-700 bg-slate-900 px-2 text-xs text-white outline-none focus:border-emerald-400 rounded-sm"
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-800 p-3">
                <button type="submit" disabled={submitting || draftLines.length === 0} className="h-10 w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-bold uppercase text-slate-950 transition-colors">
                  {submitting ? "Issuing..." : "Issue Memo & Reserve Stock"}
                </button>
              </div>
            </aside>
          </form>
        ) : (
          <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Filter</span>
              {(["OPEN", "PARTIAL", "CONVERTED", "CLOSED", ""] as const).map((s) => (
                <button key={s || "ALL"} type="button" onClick={() => setStatusFilter(s)} className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${statusFilter === s ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-400 hover:text-white"}`}>
                  {s || "All"}
                </button>
              ))}
            </div>
            <div className="min-h-0 overflow-auto p-4">
              {memos.length === 0 ? (
                <p className="text-center text-slate-500 py-16 uppercase text-xs font-semibold">No memos in this view.</p>
              ) : (
                <div className="grid gap-3">
                  {memos.map((memo) => {
                    const expanded = expandedId === memo.id;
                    const busy = busyMemo === memo.id;
                    const outLines = memo.lines.filter((l) => l.line_status === "OUT");
                    return (
                      <div key={memo.id} className="rounded-lg border border-slate-800 bg-slate-900">
                        <button type="button" onClick={() => setExpandedId(expanded ? null : memo.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-semibold text-white">{memo.memo_number}</span>
                              <StatusBadge status={memo.status} />
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">{memo.memo_type === "CUSTOMER" ? "Customer" : "Outward"}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              {memo.party_name}{memo.party_phone ? ` · ${memo.party_phone}` : ""} · Issued {memo.issue_date}{memo.due_date ? ` · Due ${memo.due_date}` : ""}
                            </div>
                          </div>
                          <div className="text-right text-[11px]">
                            <div className="text-slate-300">{memo.out_count}/{memo.line_count} out</div>
                            <div className="text-amber-400 font-mono">Rs {memo.out_value_rupees}</div>
                          </div>
                        </button>

                        {expanded && (
                          <div className="border-t border-slate-800 p-3">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                                  <th className="px-2 py-1">Barcode</th>
                                  <th className="px-2 py-1">Description</th>
                                  <th className="px-2 py-1 text-right">Gross</th>
                                  <th className="px-2 py-1 text-right">Est. Value</th>
                                  <th className="px-2 py-1 text-center">Status</th>
                                  <th className="px-2 py-1 text-center">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {memo.lines.map((line) => (
                                  <tr key={line.id} className="border-b border-slate-900">
                                    <td className="px-2 py-1.5 font-mono text-slate-300">{line.barcode || "—"}</td>
                                    <td className="px-2 py-1.5 text-slate-300">{line.description}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">{line.gross_weight_g} g</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">Rs {line.estimated_value_rupees}</td>
                                    <td className="px-2 py-1.5 text-center">
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${line.line_status === "OUT" ? "bg-amber-950/60 text-amber-300" : line.line_status === "SOLD" ? "bg-emerald-950/60 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                                        {line.line_status}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      {line.line_status === "OUT" ? (
                                        <div className="flex justify-center gap-1">
                                          <button type="button" disabled={busy} onClick={() => returnLines(memo, [line.id])} title="Return this item to stock" className="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-200 hover:bg-slate-800 disabled:opacity-50">Return</button>
                                          <button type="button" disabled={busy} onClick={() => convertLines(memo, [line.id])} title="Mark this item sold" className="rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-950 hover:bg-emerald-400 disabled:opacity-50">Sold</button>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {outLines.length > 0 && (
                              <div className="mt-3 flex justify-end gap-2">
                                <button type="button" disabled={busy} onClick={() => returnLines(memo, null)} className="flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                                  <RotateCcw size={13} /> Return All to Stock
                                </button>
                                <button type="button" disabled={busy} onClick={() => convertLines(memo, null)} className="flex items-center gap-1 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                                  <PackageCheck size={13} /> Mark All Sold
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function tabClass(active: boolean) {
  return `h-8 border-r border-slate-700 px-3 font-semibold uppercase text-[10px] tracking-wide last:border-r-0 cursor-pointer transition-colors ${active ? "bg-emerald-500 text-slate-950 font-bold" : "bg-slate-950 text-slate-400 hover:text-white"}`;
}

function StatusBadge({ status }: { status: Memo["status"] }) {
  const map: Record<Memo["status"], string> = {
    OPEN: "bg-amber-950/60 text-amber-300",
    PARTIAL: "bg-blue-950/60 text-blue-300",
    CLOSED: "bg-slate-800 text-slate-400",
    CONVERTED: "bg-emerald-950/60 text-emerald-300"
  };
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${map[status]}`}>{status}</span>;
}

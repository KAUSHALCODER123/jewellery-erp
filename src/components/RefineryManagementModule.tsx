import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";

type RefineryManagementModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "refineries" | "issue" | "receive" | "ledger";

type Refinery = {
  id: number;
  name: string;
  phone: string | null;
  fine_gold_balance_mg: number;
  cash_balance_paise: number;
  fine_gold_balance_grams?: string;
  cash_balance_rupees?: string;
};

type TimelineEvent = {
  id: string;
  date: string;
  type: "TRANSFER" | "RECEIPT";
  description: string;
  gross_weight_mg: number;
  purity_tunch: number;
  fine_gold_delta_mg: number;
  cash_delta_paise: number;
  ref_id: number;
  fine_gold_delta_grams: string;
  cash_delta_rupees: string;
  running_fine_gold_grams: string;
  running_cash_rupees: string;
  running_fine_gold_mg: number;
  running_cash_paise: number;
};

type LedgerResponse = {
  refinery: Refinery;
  timeline: TimelineEvent[];
};

type NewRefineryForm = {
  name: string;
  phone: string;
};

type IssueForm = {
  refineryId: string;
  metalType: string;
  grossWeightGrams: string;
  purityTunch: string; // e.g. "99.90"
  description: string;
};

type ReceiveForm = {
  refineryId: string;
  fineGoldReceivedGrams: string;
  chargesRupees: string;
  paymentMode: string;
  description: string;
  addToStock: boolean;
  barcode: string;
  location: string;
};

const initialNewRefineryForm: NewRefineryForm = {
  name: "",
  phone: ""
};

const initialIssueForm: IssueForm = {
  refineryId: "",
  metalType: "Gold",
  grossWeightGrams: "",
  purityTunch: "99.90",
  description: ""
};

const initialReceiveForm: ReceiveForm = {
  refineryId: "",
  fineGoldReceivedGrams: "",
  chargesRupees: "",
  paymentMode: "CASH",
  description: "",
  addToStock: true,
  barcode: "",
  location: "VAULT"
};

export default function RefineryManagementModule({ apiBaseUrl = "" }: RefineryManagementModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("refineries");
  const [refineriesList, setRefineriesList] = useState<Refinery[]>([]);
  const [newRefineryForm, setNewRefineryForm] = useState<NewRefineryForm>(initialNewRefineryForm);
  const [issueForm, setIssueForm] = useState<IssueForm>(initialIssueForm);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>(initialReceiveForm);
  const [ledgerRefineryId, setLedgerRefineryId] = useState("");
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [message, setMessage] = useState("");
  const [lastChallanTransferId, setLastChallanTransferId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // URD Melting Integration State
  const [issueMode, setIssueMode] = useState<"manual" | "urd">("manual");
  const [selectedUrdId, setSelectedUrdId] = useState<string>("");
  const [ingestedVouchers, setIngestedVouchers] = useState<any[]>([]);
  const [ingestedPurchases, setIngestedPurchases] = useState<any[]>([]);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  async function loadIngestedURD() {
    try {
      // Vouchers
      const vResponse = await fetch(`${apiBaseUrl}/api/pos/urd-vouchers`, { headers: authHeaders });
      const vResult = await vResponse.json();
      if (vResponse.ok && vResult?.vouchers) {
        setIngestedVouchers(vResult.vouchers.filter((v: any) => v.stock_status === "INGESTED"));
      }

      // Purchases
      const pResponse = await fetch(`${apiBaseUrl}/api/pos/urd-purchases`, { headers: authHeaders });
      const pResult = await pResponse.json();
      if (pResponse.ok && pResult?.purchases) {
        setIngestedPurchases(pResult.purchases.filter((p: any) => p.stock_status === "INGESTED"));
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadRefineries();
  }, []);

  useEffect(() => {
    if (activeTab === "ledger" && ledgerRefineryId) {
      void loadLedger(ledgerRefineryId);
    } else if (activeTab === "issue") {
      void loadIngestedURD();
    }
  }, [activeTab, ledgerRefineryId]);

  async function loadRefineries() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/refineries`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { refineries?: Refinery[] } | null;
      setRefineriesList(response.ok && result?.refineries ? result.refineries : []);
    } catch {
      setRefineriesList([]);
    }
  }

  async function loadLedger(refineryId: string) {
    try {
      setError("");
      const response = await fetch(`${apiBaseUrl}/api/refineries/${encodeURIComponent(refineryId)}/ledger`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as LedgerResponse | { errors?: string[] } | null;

      if (!response.ok || !result || !("refinery" in result)) {
        throw new Error(getErrorMessage(result, "Could not load refinery ledger."));
      }

      setLedger(result as LedgerResponse);
    } catch (caught) {
      setLedger(null);
      setError(caught instanceof Error ? caught.message : "Could not load refinery ledger.");
    }
  }

  async function createRefinery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!newRefineryForm.name.trim()) {
      setError("Refinery name is required.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/refineries`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: newRefineryForm.name.trim(),
          phone: newRefineryForm.phone.trim() || null
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to create refinery.");
      }

      setMessage(`Refinery "${newRefineryForm.name}" created successfully.`);
      setNewRefineryForm(initialNewRefineryForm);
      void loadRefineries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create refinery.");
    }
  }

  async function issueScrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!issueForm.refineryId) {
      setError("Refinery destination is required.");
      return;
    }

    if (issueMode === "urd") {
      if (!selectedUrdId) {
        setError("Please select an ingested old-gold item to melt.");
        return;
      }

      const [type, idStr] = selectedUrdId.split("_");
      const id = Number(idStr);
      const url = type === "voucher"
        ? `${apiBaseUrl}/api/pos/urd-vouchers/${id}/transfer-refinery`
        : `${apiBaseUrl}/api/pos/urd-purchases/${id}/transfer-refinery`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            refinery_id: Number(issueForm.refineryId),
            transfer_date: getToday(),
            description: issueForm.description.trim() || `Smelting old-gold ${type} #${id}`
          })
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.errors?.join(" ") || "Failed to melt old gold.");
        }

        setMessage(`Ingested URD ${type} sent to refinery for melting.`);
        setSelectedUrdId("");
        void loadRefineries();
        void loadIngestedURD();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not process melting.");
      }
      return;
    }

    // Manual mode
    const grossWeightMg = gramsToMg(issueForm.grossWeightGrams);
    const purityTunch = Number(issueForm.purityTunch);

    if (grossWeightMg <= 0 || Number.isNaN(purityTunch) || purityTunch <= 0 || purityTunch > 100) {
      setError("Valid gross weight and tunch (0-100%) are required.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/refineries/transfers`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          refinery_id: Number(issueForm.refineryId),
          metal_type: issueForm.metalType.trim(),
          gross_weight_mg: grossWeightMg,
          purity_tunch: purityTunch,
          description: issueForm.description.trim() || null,
          transfer_date: getToday()
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to issue scrap.");
      }

      setMessage("Scrap metal issued to refinery successfully.");
      setLastChallanTransferId(typeof result.transfer?.id === "number" ? result.transfer.id : null);
      setIssueForm(initialIssueForm);
      void loadRefineries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not issue scrap.");
    }
  }

  async function receiveFine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const fineGoldReceivedMg = gramsToMg(receiveForm.fineGoldReceivedGrams);
    const chargesPaise = rupeesToPaise(receiveForm.chargesRupees);

    if (!receiveForm.refineryId || fineGoldReceivedMg < 0 || chargesPaise < 0) {
      setError("Refinery, valid received weight, and charges are required.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/refineries/receipts`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          refinery_id: Number(receiveForm.refineryId),
          fine_gold_received_mg: fineGoldReceivedMg,
          charges_paise: chargesPaise,
          payment_mode: receiveForm.paymentMode,
          description: receiveForm.description.trim() || null,
          receive_date: getToday(),
          add_to_stock: receiveForm.addToStock,
          barcode: receiveForm.barcode.trim() || null,
          location: receiveForm.location.trim() || "VAULT"
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to process refinery receipt.");
      }

      if (result.bullion_item) {
        setMessage(`Fine metal received. 24K bullion bar ${result.bullion_item.barcode} (${result.bullion_item.fine_weight_grams} g) added to master stock.`);
      } else {
        setMessage("Fine metal received and charges recorded successfully.");
      }
      setReceiveForm(initialReceiveForm);
      void loadRefineries();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not process receipt.");
    }
  }

  const issueFinePreview = useMemo(() => {
    if (issueMode === "urd" && selectedUrdId) {
      const [type, idStr] = selectedUrdId.split("_");
      const id = Number(idStr);
      if (type === "voucher") {
        const v = ingestedVouchers.find(x => x.id === id);
        return v ? v.fine_weight_mg : 0;
      } else {
        const p = ingestedPurchases.find(x => x.id === id);
        if (p) {
          return Math.round((p.weight_mg * Number(p.purity_tunch)) / 100);
        }
      }
      return 0;
    }
    const w = gramsToMg(issueForm.grossWeightGrams);
    const p = Number(issueForm.purityTunch);
    if (w <= 0 || Number.isNaN(p) || p <= 0 || p > 100) return 0;
    return Math.round((w * p) / 100);
  }, [issueMode, selectedUrdId, ingestedVouchers, ingestedPurchases, issueForm.grossWeightGrams, issueForm.purityTunch]);

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-white tracking-wide">Refinery Management</h1>
          <p className="text-xs text-slate-400">Manage scrap smelting, fine receipt balances, and ledgers</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <TabButton active={activeTab === "refineries"} onClick={() => setActiveTab("refineries")}>Refineries & Balance</TabButton>
          <TabButton active={activeTab === "issue"} onClick={() => setActiveTab("issue")}>Issue Scrap (Outward)</TabButton>
          <TabButton active={activeTab === "receive"} onClick={() => setActiveTab("receive")}>Receive Fine (Inward)</TabButton>
          <TabButton active={activeTab === "ledger"} onClick={() => setActiveTab("ledger")}>Refinery Ledgers</TabButton>
        </nav>
      </header>

      {(message || error) && (
        <div className={`flex items-center gap-3 border-b border-slate-800 px-3 py-1.5 text-xs font-semibold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          <span>{error || message}</span>
          {!error && lastChallanTransferId !== null && (
            <button
              type="button"
              onClick={() => window.open(withDocumentToken(`${apiBaseUrl}/api/documents/refinery/transfer/${lastChallanTransferId}/challan`), "_blank", "noopener,noreferrer")}
              className="rounded border border-blue-400 px-2 py-0.5 text-[11px] font-bold uppercase text-blue-200 hover:bg-blue-950/40"
            >
              Print Challan
            </button>
          )}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "refineries" && (
          <div className="grid h-full grid-cols-[330px_1fr] overflow-hidden">
            {/* Create Refinery Form */}
            <aside className="grid content-start gap-4 border-r border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Add New Refinery" />
              <form onSubmit={createRefinery} className="grid gap-3">
                <Field label="Refinery Name">
                  <input
                    value={newRefineryForm.name}
                    onChange={(e) => setNewRefineryForm(prev => ({ ...prev, name: e.target.value }))}
                    className={controlClassName}
                    placeholder="E.g. Apex Refining Lab"
                    required
                  />
                </Field>
                <Field label="Phone / Contact">
                  <input
                    value={newRefineryForm.phone}
                    onChange={(e) => setNewRefineryForm(prev => ({ ...prev, phone: e.target.value }))}
                    className={controlClassName}
                    placeholder="E.g. +91 98765 43210"
                  />
                </Field>
                <button type="submit" className="mt-2 h-9 bg-emerald-500 hover:bg-emerald-600 text-xs font-bold uppercase text-slate-950 transition-colors cursor-pointer shadow-sm">
                  Add Refinery
                </button>
              </form>
            </aside>

            {/* List and Balances */}
            <section className="grid min-h-0 grid-rows-[auto_1fr] bg-slate-950">
              <PanelHeader title="Refinery Directory" note="Summary of metal liabilities and labor accounts" />
              <div className="min-h-0 overflow-auto p-4">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-3 py-2">Refinery Name</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2 text-right">Fine Gold Balance</th>
                      <th className="px-3 py-2 text-right">Cash Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refineriesList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-500 font-medium">No refineries found. Register one to issue scrap.</td>
                      </tr>
                    ) : (
                      refineriesList.map((r) => (
                        <tr key={r.id} className="border-b border-slate-900 hover:bg-slate-900/40 transition-colors">
                          <td className="px-3 py-3 font-semibold text-slate-200">{r.name}</td>
                          <td className="px-3 py-3 text-slate-400">{r.phone || "—"}</td>
                          <td className="px-3 py-3 text-right font-mono text-emerald-400 font-semibold">{formatMg(r.fine_gold_balance_mg)}</td>
                          <td className="px-3 py-3 text-right font-mono text-amber-400 font-semibold">{formatPaise(r.cash_balance_paise)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === "issue" && (
          <form onSubmit={issueScrap} className="grid h-full grid-cols-[330px_1fr_320px] overflow-hidden">
            <aside className="grid content-start gap-4 border-r border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Select Lab & Mode" />
              <Field label="Refinery Destination">
                <select
                  value={issueForm.refineryId}
                  onChange={(e) => setIssueForm(prev => ({ ...prev, refineryId: e.target.value }))}
                  className={controlClassName}
                  required
                >
                  <option value="">Select Refinery</option>
                  {refineriesList.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Issue Mode">
                <select
                  value={issueMode}
                  onChange={(e) => setIssueMode(e.target.value as "manual" | "urd")}
                  className={controlClassName}
                >
                  <option value="manual">Manual Scrap Entry</option>
                  <option value="urd">Melt Ingested Old Gold</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <MetricBox label="Refineries" value={String(refineriesList.length)} />
                <MetricBox label="Ingested Items" value={String(ingestedVouchers.length + ingestedPurchases.length)} />
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader 
                title={issueMode === "urd" ? "Melt Ingested Old Gold" : "Smelting Outward Form"} 
                note={issueMode === "urd" ? "Select ingested item to transfer to refinery" : "Enter gross scrap weights and average purity"} 
              />
              {issueMode === "urd" ? (
                <div className="grid content-start gap-4 p-4 min-h-0 overflow-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                        <th className="px-2 py-1">Type</th>
                        <th className="px-2 py-1">Barcode / Invoice</th>
                        <th className="px-2 py-1">Customer</th>
                        <th className="px-2 py-1 text-right">Net Wt</th>
                        <th className="px-2 py-1 text-right">Purity %</th>
                        <th className="px-2 py-1 text-center">Select</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingestedVouchers.length === 0 && ingestedPurchases.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-8 text-center text-slate-500 font-semibold uppercase">
                            No ingested old-gold stock items found. Ingest vouchers first in URD Workspace.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {ingestedVouchers.map((v) => (
                            <tr key={`v_${v.id}`} className="border-b border-slate-900 hover:bg-slate-900/30 transition-colors">
                              <td className="px-2 py-2 text-blue-400 font-bold uppercase">Voucher</td>
                              <td className="px-2 py-2 font-mono text-slate-300">{v.voucher_number}</td>
                              <td className="px-2 py-2 text-slate-400">{v.customer_name}</td>
                              <td className="px-2 py-2 text-right font-mono text-slate-200">{v.net_weight_g} g</td>
                              <td className="px-2 py-2 text-right font-mono text-emerald-400">{v.purity_tunch}%</td>
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="radio"
                                  name="urd-select"
                                  checked={selectedUrdId === `voucher_${v.id}`}
                                  onChange={() => setSelectedUrdId(`voucher_${v.id}`)}
                                  className="cursor-pointer"
                                />
                              </td>
                            </tr>
                          ))}
                          {ingestedPurchases.map((p) => (
                            <tr key={`p_${p.id}`} className="border-b border-slate-900 hover:bg-slate-900/30 transition-colors">
                              <td className="px-2 py-2 text-purple-400 font-bold uppercase">POS Exchange</td>
                              <td className="px-2 py-2 font-mono text-slate-300">Invoice #{p.invoice_number}</td>
                              <td className="px-2 py-2 text-slate-400">{p.customer_name}</td>
                              <td className="px-2 py-2 text-right font-mono text-slate-200">{(p.weight_mg / 1000).toFixed(3)} g</td>
                              <td className="px-2 py-2 text-right font-mono text-emerald-400">{p.purity_tunch}%</td>
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="radio"
                                  name="urd-select"
                                  checked={selectedUrdId === `purchase_${p.id}`}
                                  onChange={() => setSelectedUrdId(`purchase_${p.id}`)}
                                  className="cursor-pointer"
                                />
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                  {selectedUrdId && (
                    <div className="mt-3">
                      <Field label="Melting & Smelting Notes">
                        <textarea
                          value={issueForm.description}
                          onChange={(e) => setIssueForm(prev => ({ ...prev, description: e.target.value }))}
                          className="w-full h-16 border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-emerald-400 font-sans"
                          placeholder="Smelting crucible reference, temperature, assay notes..."
                        />
                      </Field>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid content-start gap-4 p-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Metal Type">
                      <input
                        value={issueForm.metalType}
                        onChange={(e) => setIssueForm(prev => ({ ...prev, metalType: e.target.value }))}
                        className={controlClassName}
                        required
                      />
                    </Field>
                    <Field label="Gross Weight (Grams)">
                      <input
                        value={issueForm.grossWeightGrams}
                        onChange={(e) => setIssueForm(prev => ({ ...prev, grossWeightGrams: e.target.value }))}
                        className={controlClassName}
                        inputMode="decimal"
                        placeholder="0.000"
                        required
                      />
                    </Field>
                    <Field label="Average Purity / Tunch (%)">
                      <input
                        value={issueForm.purityTunch}
                        onChange={(e) => setIssueForm(prev => ({ ...prev, purityTunch: e.target.value }))}
                        className={controlClassName}
                        inputMode="decimal"
                        placeholder="99.90"
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Notes / Description">
                    <textarea
                      value={issueForm.description}
                      onChange={(e) => setIssueForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full h-24 border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-emerald-400 font-sans"
                      placeholder="Enter scrap details, batch info, reference receipts..."
                    />
                  </Field>
                </div>
              )}
            </section>

            <aside className="grid content-start gap-4 border-l border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Valuation Engine" />
              <MetricBox label="Valuation Formula" value={issueMode === "urd" ? "Ingested Fine Wt (mg)" : "round(Gross Wt x Purity / 100)"} />
              <MetricBox label="Fine Weight Preview" value={formatMg(issueFinePreview)} tone="ok" />
              <button 
                type="submit" 
                disabled={!issueForm.refineryId || (issueMode === "urd" && !selectedUrdId)} 
                className="h-10 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-xs font-bold uppercase text-slate-950 transition-colors cursor-pointer shadow-sm"
              >
                {issueMode === "urd" ? "Melt & Send to Refinery" : "Issue Scrap Metal"}
              </button>
            </aside>
          </form>
        )}

        {activeTab === "receive" && (
          <form onSubmit={receiveFine} className="grid h-full grid-cols-[330px_1fr_320px] overflow-hidden">
            <aside className="grid content-start gap-4 border-r border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Select Lab" />
              <Field label="Refinery Source">
                <select
                  value={receiveForm.refineryId}
                  onChange={(e) => setReceiveForm(prev => ({ ...prev, refineryId: e.target.value }))}
                  className={controlClassName}
                  required
                >
                  <option value="">Select Refinery</option>
                  {refineriesList.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader title="Fine Metal Inward Form" note="Record received fine metal and pay refining costs" />
              <div className="grid content-start gap-4 p-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Fine Gold Received (Grams)">
                    <input
                      value={receiveForm.fineGoldReceivedGrams}
                      onChange={(e) => setReceiveForm(prev => ({ ...prev, fineGoldReceivedGrams: e.target.value }))}
                      className={controlClassName}
                      inputMode="decimal"
                      placeholder="0.000"
                      required
                    />
                  </Field>
                  <Field label="Refining Charges (Rs)">
                    <input
                      value={receiveForm.chargesRupees}
                      onChange={(e) => setReceiveForm(prev => ({ ...prev, chargesRupees: e.target.value }))}
                      className={controlClassName}
                      inputMode="decimal"
                      placeholder="0"
                      required
                    />
                  </Field>
                  <Field label="Payment Mode">
                    <select
                      value={receiveForm.paymentMode}
                      onChange={(e) => setReceiveForm(prev => ({ ...prev, paymentMode: e.target.value }))}
                      className={controlClassName}
                      required
                    >
                      <option value="CASH">CASH</option>
                      <option value="BANK_NEFT">NEFT / BANK</option>
                      <option value="UPI">UPI</option>
                      <option value="JOURNAL_DEBIT">JOURNAL ACCOUNT</option>
                    </select>
                  </Field>
                </div>
                <Field label="Notes / Description">
                  <textarea
                    value={receiveForm.description}
                    onChange={(e) => setReceiveForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full h-24 border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-emerald-400 font-sans"
                    placeholder="Refined bar numbers, pure assays, testing records..."
                  />
                </Field>

                <div className="rounded-sm border border-emerald-900/50 bg-emerald-950/10 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                    <input
                      type="checkbox"
                      checked={receiveForm.addToStock}
                      onChange={(e) => setReceiveForm(prev => ({ ...prev, addToStock: e.target.checked }))}
                      className="h-4 w-4 accent-emerald-500 cursor-pointer"
                    />
                    Add returned fine gold to master stock as a 24K bullion bar
                  </label>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Mints a pure 24K stock item so your gram-to-gram metal balance closes the refining loop. Uncheck only if the refiner kept the metal against your account.
                  </p>
                  {receiveForm.addToStock && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <Field label="Bullion Barcode (optional)">
                        <input
                          value={receiveForm.barcode}
                          onChange={(e) => setReceiveForm(prev => ({ ...prev, barcode: e.target.value }))}
                          className={controlClassName}
                          placeholder="Auto: FINE-24K-R##"
                        />
                      </Field>
                      <Field label="Stock Location">
                        <input
                          value={receiveForm.location}
                          onChange={(e) => setReceiveForm(prev => ({ ...prev, location: e.target.value }))}
                          className={controlClassName}
                          placeholder="VAULT"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-4 border-l border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Receipt Overview" />
              <MetricBox label="Fine Metal Received" value={formatMg(gramsToMg(receiveForm.fineGoldReceivedGrams))} tone="ok" />
              <MetricBox label="Charges Recorded" value={formatPaise(rupeesToPaise(receiveForm.chargesRupees))} tone="warn" />
              <MetricBox
                label="Master Stock Impact"
                value={receiveForm.addToStock && gramsToMg(receiveForm.fineGoldReceivedGrams) > 0 ? `+ ${formatMg(gramsToMg(receiveForm.fineGoldReceivedGrams))} 24K bar` : "No stock entry"}
                tone={receiveForm.addToStock ? "ok" : "neutral"}
              />
              <button type="submit" disabled={!receiveForm.refineryId} className="h-10 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-xs font-bold uppercase text-slate-950 transition-colors cursor-pointer shadow-sm">
                Receive Fine Metal
              </button>
            </aside>
          </form>
        )}

        {activeTab === "ledger" && (
          <div className="grid h-full grid-cols-[280px_1fr] overflow-hidden">
            <aside className="grid content-start gap-4 border-r border-slate-800 bg-slate-900 p-4">
              <PanelTitle title="Refinery Account" />
              <select
                value={ledgerRefineryId}
                onChange={(e) => setLedgerRefineryId(e.target.value)}
                className={controlClassName}
              >
                <option value="">Select Refinery</option>
                {refineriesList.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>

              {ledger && (
                <div className="grid gap-2 mt-4">
                  <MetricBox label="Fine Gold Balance" value={formatMg(ledger.refinery.fine_gold_balance_mg)} tone={ledger.refinery.fine_gold_balance_mg > 0 ? "danger" : "ok"} />
                  <MetricBox label="Cash Account Balance" value={formatPaise(ledger.refinery.cash_balance_paise)} tone="warn" />
                </div>
              )}
            </aside>

            {/* Timeline Events Ledger */}
            <section className="grid min-h-0 grid-rows-[auto_1fr] bg-slate-950">
              <PanelHeader title="Transaction Ledger" note="Chronological timeline of scrap sent and fine received" />
              <div className="min-h-0 overflow-auto p-4">
                {!ledger ? (
                  <div className="text-center text-slate-500 py-16 font-semibold uppercase text-xs">Select a refinery to load statement.</div>
                ) : ledger.timeline.length === 0 ? (
                  <div className="text-center text-slate-500 py-16 font-semibold uppercase text-xs">No transactions recorded for this refinery.</div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Description</th>
                        <th className="px-2 py-2 text-right">Fine Weight Delta</th>
                        <th className="px-2 py-2 text-right">Cash Delta</th>
                        <th className="px-2 py-2 text-right">Fine Gold Balance</th>
                        <th className="px-2 py-2 text-right">Cash Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.timeline.map((event) => (
                        <tr key={event.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition-colors font-mono">
                          <td className="px-2 py-2.5 text-slate-400 font-sans">{event.date}</td>
                          <td className="px-2 py-2.5 font-sans">
                            <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${event.type === "TRANSFER" ? "bg-blue-950/60 text-blue-400 border border-blue-900" : "bg-emerald-950/60 text-emerald-400 border border-emerald-900"}`}>
                              {event.type}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 text-slate-200 font-sans truncate max-w-[200px]" title={event.description}>{event.description}</td>
                          <td className={`px-2 py-2.5 text-right font-semibold ${event.fine_gold_delta_mg > 0 ? "text-red-400" : event.fine_gold_delta_mg < 0 ? "text-emerald-400" : "text-slate-400"}`}>
                            {event.fine_gold_delta_mg > 0 ? "+" : ""}{event.fine_gold_delta_grams} g
                          </td>
                          <td className={`px-2 py-2.5 text-right font-semibold ${event.cash_delta_paise > 0 ? "text-amber-400" : "text-slate-400"}`}>
                            {event.cash_delta_paise > 0 ? "+" : ""}{event.cash_delta_rupees}
                          </td>
                          <td className="px-2 py-2.5 text-right text-slate-300 font-bold">{event.running_fine_gold_grams} g</td>
                          <td className="px-2 py-2.5 text-right text-slate-300 font-bold">{event.running_cash_rupees}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </section>
  );
}

function gramsToMg(value: string) {
  return decimalToScaledInteger(value, 1000, 3);
}

function rupeesToPaise(value: string) {
  return decimalToScaledInteger(value, 100, 2);
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3) {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return 0;

  const fractional = (match[2] ?? "").slice(0, maxDecimalPlaces).padEnd(maxDecimalPlaces, "0");
  return Number(match[1]) * scale + Number(fractional || "0");
}

function formatMg(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const grams = Math.trunc(absolute / 1000);
  const milligrams = String(absolute % 1000).padStart(3, "0");

  return `${sign}${grams}.${milligrams} g`;
}

function formatPaise(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const rupees = Math.trunc(absolute / 100);
  const paise = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees.toLocaleString("en-IN")}.${paise}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "errors" in value && Array.isArray(value.errors)) {
    return value.errors.join(" ") || fallback;
  }
  return fallback;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400 tracking-wide">
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
      className={`h-8 border-r border-slate-700 px-3 font-semibold uppercase text-[10px] tracking-wide last:border-r-0 cursor-pointer transition-colors ${active ? "bg-emerald-500 text-slate-950 font-bold" : "bg-slate-950 text-slate-400 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function PanelHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2">
      <h2 className="text-xs font-semibold uppercase text-white tracking-wide">{title}</h2>
      <span className="text-[10px] text-slate-500 font-medium">{note}</span>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return <h2 className="text-xs font-bold uppercase text-white tracking-wide">{title}</h2>;
}

function MetricBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const toneClassName =
    tone === "ok" ? "text-emerald-400 font-bold" : tone === "warn" ? "text-amber-400 font-bold" : tone === "danger" ? "text-red-400 font-bold" : "text-white";

  return (
    <div className="border border-slate-800 bg-slate-950 px-3 py-2 rounded-sm shadow-inner">
      <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wide">{label}</div>
      <div className={`truncate font-mono text-xs font-semibold mt-0.5 ${toneClassName}`}>{value}</div>
    </div>
  );
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 transition-colors rounded-sm";

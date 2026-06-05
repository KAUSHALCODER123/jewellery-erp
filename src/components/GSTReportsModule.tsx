import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";

type GSTReportsModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "gstr1" | "gstr2" | "gstr3b" | "audit_locks" | "bis_workflow";

type GstLineItem = {
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  gross_weight_mg: number;
  net_weight_mg: number;
  rt: number;
  txval: string;
  iamt: string;
  camt: string;
  samt: string;
  csamt: string;
  taxable_value_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
};

type Gst3bSummaryItem = {
  taxable_value_paise: number;
  taxable_value_rupees: string;
  gst_paise: number;
  gst_rupees: string;
  cgst_paise: number;
  cgst_rupees: string;
  sgst_paise: number;
  sgst_rupees: string;
  igst_paise: number;
  igst_rupees: string;
};

type Gst3bResponse = {
  date_range: {
    from: string | null;
    to: string | null;
  };
  outward_supplies: Gst3bSummaryItem;
  inward_supplies: Gst3bSummaryItem;
  net_payable: {
    cgst_paise: number;
    cgst_rupees: string;
    sgst_paise: number;
    sgst_rupees: string;
    igst_paise: number;
    igst_rupees: string;
  };
};



// Sub-component: GST Audit Locks View
function AuditLocksView({
  locks,
  lockFrom,
  lockTo,
  lockReason,
  setLockFrom,
  setLockTo,
  setLockReason,
  createLock,
  unlockPeriod
}: {
  locks: any[];
  lockFrom: string;
  lockTo: string;
  lockReason: string;
  setLockFrom: (val: string) => void;
  setLockTo: (val: string) => void;
  setLockReason: (val: string) => void;
  createLock: (e: React.FormEvent) => void;
  unlockPeriod: (id: number) => void;
}) {
  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[300px_1fr] gap-4 p-4 overflow-auto bg-slate-950 min-h-0">
      {/* Create Lock Column */}
      <form onSubmit={createLock} className="border border-slate-800 bg-slate-900/40 p-4 rounded-lg flex flex-col gap-3 h-fit">
        <h2 className="text-xs font-semibold uppercase text-white border-b border-slate-850 pb-2">Lock New Period</h2>
        
        <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
          Period From:
          <input
            type="date"
            required
            value={lockFrom}
            onChange={(e) => setLockFrom(e.target.value)}
            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
          />
        </label>

        <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
          Period To:
          <input
            type="date"
            required
            value={lockTo}
            onChange={(e) => setLockTo(e.target.value)}
            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
          />
        </label>

        <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
          Lock Reason / Description:
          <input
            type="text"
            required
            placeholder="e.g. May 2026 Audit Complete"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
          />
        </label>

        <button
          type="submit"
          className="h-9 bg-red-600 hover:bg-red-700 text-white font-bold uppercase text-[10px] rounded tracking-wider mt-1 transition"
        >
          Enforce Audit Lock
        </button>
      </form>

      {/* Audit Locks List Grid */}
      <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-lg flex flex-col gap-2 min-h-0 overflow-auto">
        <h2 className="text-xs font-semibold uppercase text-white border-b border-slate-800 pb-2">Active & Archive Locks</h2>
        {locks.length === 0 ? (
          <p className="text-xs text-slate-500 py-8 text-center uppercase tracking-wider">No GST audit period locks created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-900 text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2 font-semibold uppercase">From</th>
                  <th className="px-3 py-2 font-semibold uppercase">To</th>
                  <th className="px-3 py-2 font-semibold uppercase">Lock Reason</th>
                  <th className="px-3 py-2 font-semibold uppercase">Status</th>
                  <th className="px-3 py-2 font-semibold uppercase">Locked At</th>
                  <th className="px-3 py-2 text-right font-semibold uppercase">Action</th>
                </tr>
              </thead>
              <tbody>
                {locks.map((lock) => (
                  <tr key={lock.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition">
                    <td className="px-3 py-2.5 font-mono text-slate-200">{lock.period_from}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-200">{lock.period_to}</td>
                    <td className="px-3 py-2.5 text-slate-300">{lock.reason || "N/A"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${lock.status === "LOCKED" ? "bg-red-950/40 text-red-400 border border-red-900/30" : "bg-slate-900 text-slate-400"}`}>
                        {lock.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-[10px]">{lock.locked_at || lock.created_at}</td>
                    <td className="px-3 py-2.5 text-right">
                      {lock.status === "LOCKED" ? (
                        <button
                          type="button"
                          onClick={() => unlockPeriod(lock.id)}
                          className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-[9px] tracking-wide rounded"
                        >
                          Unlock
                        </button>
                      ) : (
                        <span className="text-slate-600 text-[10px] italic">Unlocked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-component: BIS Workflow View
function BisWorkflowView({
  subTab,
  setSubTab,
  submissions,
  itemsToHallmark,
  selectedItemIds,
  setSelectedItemIds,
  hallmarkCenter,
  setHallmarkCenter,
  expectedReturnDate,
  setExpectedReturnDate,
  bisSubmittedDate,
  setBisSubmittedDate,
  bisRemarks,
  setBisRemarks,
  submitToBis,
  expandedSubmissionId,
  setExpandedSubmissionId,
  returnItemsState,
  setReturnItemsState,
  submitReturn,
  huidSearch,
  setHuidSearch,
  showHistory,
  apiBaseUrl,
  authHeaders
}: {
  subTab: "ready" | "active" | "huid_inventory";
  setSubTab: (tab: "ready" | "active" | "huid_inventory") => void;
  submissions: any[];
  itemsToHallmark: any[];
  selectedItemIds: Record<number, boolean>;
  setSelectedItemIds: (val: Record<number, boolean>) => void;
  hallmarkCenter: string;
  setHallmarkCenter: (val: string) => void;
  expectedReturnDate: string;
  setExpectedReturnDate: (val: string) => void;
  bisSubmittedDate: string;
  setBisSubmittedDate: (val: string) => void;
  bisRemarks: string;
  setBisRemarks: (val: string) => void;
  submitToBis: (e: React.FormEvent) => void;
  expandedSubmissionId: number | null;
  setExpandedSubmissionId: (id: number | null) => void;
  returnItemsState: any;
  setReturnItemsState: (val: any) => void;
  submitReturn: (subId: number) => void;
  huidSearch: string;
  setHuidSearch: (val: string) => void;
  showHistory: (id: number, barcode: string) => void;
  apiBaseUrl: string;
  authHeaders: any;
}) {
  // Load HUID items for printed inventory tab
  const [huidInventory, setHuidInventory] = useState<any[]>([]);

  useEffect(() => {
    if (subTab === "huid_inventory") {
      void loadHuidInventory();
    }
  }, [subTab]);

  async function loadHuidInventory() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory?limit=500`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result.items) {
        // Filter items that have received HUID
        const hallmarked = result.items.filter((item: any) =>
          item.huid &&
          (item.huid_status === "HUID_RECEIVED" || item.huid_status === "CERT_PRINTED" || item.huid_status === "SOLD")
        );
        setHuidInventory(hallmarked);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const filteredHuidInventory = useMemo(() => {
    const query = huidSearch.trim().toLowerCase();
    if (!query) return huidInventory;
    return huidInventory.filter(item =>
      item.barcode.toLowerCase().includes(query) ||
      (item.huid && item.huid.toLowerCase().includes(query))
    );
  }, [huidInventory, huidSearch]);

  const toggleSelect = (id: number) => {
    setSelectedItemIds({
      ...selectedItemIds,
      [id]: !selectedItemIds[id]
    });
  };

  const toggleSelectAll = () => {
    const anyUnselected = itemsToHallmark.some(item => !selectedItemIds[item.id]);
    const updated: Record<number, boolean> = {};
    if (anyUnselected) {
      itemsToHallmark.forEach(item => {
        updated[item.id] = true;
      });
    }
    setSelectedItemIds(updated);
  };

  const handleReturnItemField = (itemId: number, field: string, value: string) => {
    const current = returnItemsState[itemId] ?? { status: "HUID_RECEIVED", huid: "", certificate_number: "", remarks: "" };
    setReturnItemsState({
      ...returnItemsState,
      [itemId]: {
        ...current,
        [field]: value
      }
    });
  };

  const triggerCardPrint = (itemId: number) => {
    window.open(withDocumentToken(`${apiBaseUrl}/api/documents/huid-card/${itemId}`), "_blank", "noopener,noreferrer");
    // Reload database items after a delay
    setTimeout(() => {
      void loadHuidInventory();
    }, 2000);
  };

  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden min-h-0 bg-slate-950 p-4 gap-3">
      {/* Workflow Navigation Sub-tabs */}
      <div className="flex border-b border-slate-800 pb-2 gap-3 text-xs">
        <button
          type="button"
          onClick={() => setSubTab("ready")}
          className={`px-3 py-1 font-semibold uppercase tracking-wider rounded ${subTab === "ready" ? "bg-slate-800 text-emerald-400 border border-emerald-900/30" : "text-slate-400 hover:text-white"}`}
        >
          1. Ready for Hallmarking ({itemsToHallmark.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("active")}
          className={`px-3 py-1 font-semibold uppercase tracking-wider rounded ${subTab === "active" ? "bg-slate-800 text-emerald-400 border border-emerald-900/30" : "text-slate-400 hover:text-white"}`}
        >
          2. Active Submissions ({submissions.filter(s => s.status !== "COMPLETED").length} Pending)
        </button>
        <button
          type="button"
          onClick={() => setSubTab("huid_inventory")}
          className={`px-3 py-1 font-semibold uppercase tracking-wider rounded ${subTab === "huid_inventory" ? "bg-slate-800 text-emerald-400 border border-emerald-900/30" : "text-slate-400 hover:text-white"}`}
        >
          3. HUID Card Printing & History
        </button>
      </div>

      <div className="min-h-0 overflow-auto">
        {/* TAB 1: Eligible Items & Submit Form */}
        {subTab === "ready" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 h-full min-h-0">
            {/* Table */}
            <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-lg flex flex-col min-h-0 overflow-auto">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
                <h3 className="text-xs font-semibold uppercase text-slate-200">Eligible Gold Items</h3>
                {itemsToHallmark.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-[10px] text-emerald-400 font-bold uppercase hover:text-emerald-300"
                  >
                    Toggle All
                  </button>
                )}
              </div>

              {itemsToHallmark.length === 0 ? (
                <p className="text-xs text-slate-500 py-12 text-center uppercase tracking-wider">No gold items in stock requiring hallmarking.</p>
              ) : (
                <div className="overflow-auto min-h-0">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400">
                      <tr className="border-b border-slate-800">
                        <th className="px-2 py-2 w-8"></th>
                        <th className="px-3 py-2 font-semibold uppercase">Barcode</th>
                        <th className="px-3 py-2 font-semibold uppercase">Category</th>
                        <th className="px-3 py-2 font-semibold uppercase">Karat</th>
                        <th className="px-3 py-2 font-semibold uppercase">Net Weight</th>
                        <th className="px-3 py-2 font-semibold uppercase">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsToHallmark.map((item) => (
                        <tr key={item.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedItemIds[item.id])}
                              onChange={() => toggleSelect(item.id)}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-200">{item.barcode}</td>
                          <td className="px-3 py-2 text-slate-300">{item.category}</td>
                          <td className="px-3 py-2 text-slate-300">{item.purity_karat}K</td>
                          <td className="px-3 py-2 font-mono text-slate-200">{(item.net_weight_mg / 1000).toFixed(3)}g</td>
                          <td className="px-3 py-2 text-slate-400">{item.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Submission Form */}
            <form onSubmit={submitToBis} className="border border-slate-800 bg-slate-900/40 p-4 rounded-lg flex flex-col gap-3 h-fit">
              <h3 className="text-xs font-semibold uppercase text-white border-b border-slate-800 pb-2">Generate BIS Submission</h3>
              
              <div className="bg-slate-950 p-2 rounded text-[10px] text-slate-400 border border-slate-900 flex justify-between items-center">
                <span>Selected Items Count</span>
                <span className="font-mono text-sm font-bold text-white">
                  {Object.keys(selectedItemIds).filter(id => selectedItemIds[Number(id)]).length}
                </span>
              </div>

              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                Hallmark Center Name:
                <input
                  type="text"
                  required
                  placeholder="e.g. Mumbai Assay & Hallmarking Center"
                  value={hallmarkCenter}
                  onChange={(e) => setHallmarkCenter(e.target.value)}
                  className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                />
              </label>

              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                Submission Date:
                <input
                  type="date"
                  required
                  value={bisSubmittedDate}
                  onChange={(e) => setBisSubmittedDate(e.target.value)}
                  className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                />
              </label>

              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                Expected Return Date:
                <input
                  type="date"
                  value={expectedReturnDate}
                  onChange={(e) => setExpectedReturnDate(e.target.value)}
                  className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                />
              </label>

              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                Remarks / Job Info:
                <input
                  type="text"
                  placeholder="Challan details or notes"
                  value={bisRemarks}
                  onChange={(e) => setBisRemarks(e.target.value)}
                  className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                />
              </label>

              <button
                type="submit"
                className="h-9 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-[10px] rounded tracking-wider mt-1 transition"
              >
                Submit Job to BIS
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: Submissions Return workflow */}
        {subTab === "active" && (
          <div className="flex flex-col gap-4 bg-slate-950 rounded min-h-0 overflow-auto">
            {submissions.length === 0 ? (
              <p className="text-xs text-slate-500 py-12 text-center uppercase tracking-wider">No active hallmarking submissions found.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {submissions.map((sub) => {
                  const isExpanded = expandedSubmissionId === sub.id;
                  return (
                    <div key={sub.id} className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden transition">
                      <div
                        onClick={() => setExpandedSubmissionId(isExpanded ? null : sub.id)}
                        className="flex items-center justify-between p-3 bg-slate-900/60 cursor-pointer hover:bg-slate-900 transition text-xs font-semibold"
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-grow pr-4">
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase">Submission Job #</span>
                            <span className="font-mono text-slate-200">{sub.submission_number}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase">Assaying Center</span>
                            <span className="text-slate-300 truncate max-w-xs">{sub.hallmark_center_name}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase">Submitted Date</span>
                            <span className="font-mono text-slate-300">{sub.submitted_date}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase">Status</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold inline-block uppercase ${sub.status === "COMPLETED" ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" : sub.status === "PARTIAL_RETURN" ? "bg-amber-950/40 text-amber-400 border border-amber-900/30" : "bg-slate-800 text-slate-300"}`}>
                              {sub.status}
                            </span>
                          </div>
                        </div>
                        <div className="text-slate-400">
                          {isExpanded ? "Collapse" : "Manage"}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-4 border-t border-slate-850 bg-slate-950/40 flex flex-col gap-4">
                          <h4 className="text-xs font-semibold text-slate-300 uppercase border-b border-slate-800 pb-1">Submission Piece Verification & HUID Return</h4>
                          
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-slate-900 text-slate-400">
                                <tr className="border-b border-slate-800">
                                  <th className="px-3 py-2 font-semibold uppercase">Barcode</th>
                                  <th className="px-3 py-2 font-semibold uppercase">Item Details</th>
                                  <th className="px-3 py-2 font-semibold uppercase">Status</th>
                                  <th className="px-3 py-2 font-semibold uppercase">Returned Details</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sub.items.map((item: any) => {
                                  const itemState = returnItemsState[item.item_id] ?? { status: "HUID_RECEIVED", huid: item.huid || "", certificate_number: item.certificate_number || "", remarks: "" };
                                  const isProcessed = item.status === "HUID_RECEIVED" || item.status === "REJECTED";

                                  return (
                                    <tr key={item.id} className="border-b border-slate-900 hover:bg-slate-900/20 transition">
                                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">{item.barcode}</td>
                                      <td className="px-3 py-2.5 text-slate-300">
                                        {item.category} - {item.metal_type} - {item.purity_karat}K
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {isProcessed ? (
                                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${item.status === "HUID_RECEIVED" ? "bg-emerald-950/30 text-emerald-400 border border-emerald-900/20" : "bg-red-950/30 text-red-400 border border-red-900/20"}`}>
                                            {item.status}
                                          </span>
                                        ) : (
                                          <select
                                            value={itemState.status}
                                            onChange={(e) => handleReturnItemField(item.item_id, "status", e.target.value)}
                                            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                                          >
                                            <option value="HUID_RECEIVED">HUID Received</option>
                                            <option value="REJECTED">Rejected / Melted</option>
                                          </select>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {isProcessed ? (
                                          <div className="text-[11px] grid gap-0.5">
                                            {item.huid && <div>HUID: <span className="font-mono font-bold text-white">{item.huid}</span></div>}
                                            {item.certificate_number && <div>Cert #: <span className="font-mono text-slate-400">{item.certificate_number}</span></div>}
                                            {item.remarks && <div className="italic text-slate-500">Remarks: {item.remarks}</div>}
                                          </div>
                                        ) : (
                                          <div className="flex flex-wrap gap-2">
                                            {itemState.status === "HUID_RECEIVED" ? (
                                              <>
                                                <input
                                                  type="text"
                                                  maxLength={6}
                                                  placeholder="HUID (e.g. A1B2C3)"
                                                  value={itemState.huid}
                                                  onChange={(e) => handleReturnItemField(item.item_id, "huid", e.target.value.toUpperCase())}
                                                  className="h-8 w-36 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500 font-mono font-bold"
                                                />
                                                <input
                                                  type="text"
                                                  placeholder="Cert No. (Optional)"
                                                  value={itemState.certificate_number}
                                                  onChange={(e) => handleReturnItemField(item.item_id, "certificate_number", e.target.value)}
                                                  className="h-8 w-36 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                                                />
                                              </>
                                            ) : (
                                              <input
                                                type="text"
                                                placeholder="Rejection remarks / Reason"
                                                value={itemState.remarks}
                                                onChange={(e) => handleReturnItemField(item.item_id, "remarks", e.target.value)}
                                                className="h-8 w-72 border border-slate-700 bg-slate-950 px-2 text-xs text-white rounded outline-none focus:border-emerald-500"
                                              />
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {sub.status !== "COMPLETED" && (
                            <div className="flex justify-end gap-3 pt-2">
                              <button
                                type="button"
                                onClick={() => setExpandedSubmissionId(null)}
                                className="h-8 border border-slate-750 px-4 text-[10px] font-bold uppercase text-slate-300 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => submitReturn(sub.id)}
                                className="h-8 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-[10px] rounded px-4"
                              >
                                Process return verification
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
        )}

        {/* TAB 3: HUID Inventory, log trace, card printing */}
        {subTab === "huid_inventory" && (
          <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-lg flex flex-col min-h-0 h-full overflow-auto">
            {/* Search filter */}
            <div className="flex border-b border-slate-850 pb-2.5 mb-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-400 w-full max-w-md">
                Search item / HUID:
                <input
                  type="text"
                  placeholder="Enter barcode or HUID number..."
                  value={huidSearch}
                  onChange={(e) => setHuidSearch(e.target.value)}
                  className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 text-xs text-white rounded outline-none focus:border-emerald-500 transition"
                />
              </label>
            </div>

            {filteredHuidInventory.length === 0 ? (
              <p className="text-xs text-slate-500 py-12 text-center uppercase tracking-wider">No matching hallmarked gold inventory found.</p>
            ) : (
              <div className="overflow-auto min-h-0">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-900 text-slate-400">
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-2 font-semibold uppercase">Barcode</th>
                      <th className="px-3 py-2 font-semibold uppercase">HUID</th>
                      <th className="px-3 py-2 font-semibold uppercase">Category / Specs</th>
                      <th className="px-3 py-2 font-semibold uppercase">Weight</th>
                      <th className="px-3 py-2 font-semibold uppercase">Cert Number</th>
                      <th className="px-3 py-2 font-semibold uppercase">HUID Status</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHuidInventory.map((item) => (
                      <tr key={item.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition">
                        <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">{item.barcode}</td>
                        <td className="px-3 py-2.5 font-mono font-bold text-amber-400">{item.huid}</td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {item.category} - {item.purity_karat}K Gold
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-200">{(item.net_weight_mg / 1000).toFixed(3)}g</td>
                        <td className="px-3 py-2.5 font-mono text-slate-400">{item.huid_certificate_number || "N/A"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${item.huid_status === "CERT_PRINTED" ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" : item.huid_status === "SOLD" ? "bg-blue-950/40 text-blue-400 border border-blue-900/30" : "bg-amber-950/40 text-amber-400 border border-amber-900/30"}`}>
                            {item.huid_status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => showHistory(item.id, item.barcode)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 font-bold uppercase text-[9px] tracking-wide rounded"
                          >
                            Trace Log
                          </button>
                          <button
                            type="button"
                            onClick={() => triggerCardPrint(item.id)}
                            className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-[9px] tracking-wide rounded"
                          >
                            Print Card
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "errors" in value && Array.isArray(value.errors)) {
    return value.errors.join(" ") || fallback;
  }
  return fallback;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border-r border-slate-750 px-3 font-semibold uppercase last:border-r-0 text-[10px] tracking-wider transition ${
        active ? "bg-emerald-500 text-slate-950 font-bold" : "bg-slate-900 text-slate-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-slate-500 py-16">
      <p className="text-xs uppercase tracking-widest font-semibold">{message}</p>
    </div>
  );
}

function Gstr3bView({ data }: { data: Gst3bResponse }) {
  return (
    <div className="p-4 flex flex-col gap-5 overflow-auto h-full bg-slate-950 min-h-0">
      {/* Outward supplies grid */}
      <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
        <h2 className="text-xs font-semibold uppercase text-emerald-400 border-b border-slate-800 pb-2 mb-3">
          1. Outward Taxable Supplies (Liabilities)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MiniMetricBox label="Taxable Value" value={`Rs ${data.outward_supplies.taxable_value_rupees}`} />
          <MiniMetricBox label="CGST" value={`Rs ${data.outward_supplies.cgst_rupees}`} />
          <MiniMetricBox label="SGST" value={`Rs ${data.outward_supplies.sgst_rupees}`} />
          <MiniMetricBox label="IGST" value={`Rs ${data.outward_supplies.igst_rupees}`} />
          <MiniMetricBox label="Total Tax Liability" value={`Rs ${data.outward_supplies.gst_rupees}`} highlight />
        </div>
      </div>

      {/* Inward supplies grid */}
      <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
        <h2 className="text-xs font-semibold uppercase text-amber-400 border-b border-slate-800 pb-2 mb-3">
          2. Inward Taxable Supplies (Eligible ITC)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MiniMetricBox label="Taxable Value" value={`Rs ${data.inward_supplies.taxable_value_rupees}`} />
          <MiniMetricBox label="CGST Credit" value={`Rs ${data.inward_supplies.cgst_rupees}`} />
          <MiniMetricBox label="SGST Credit" value={`Rs ${data.inward_supplies.sgst_rupees}`} />
          <MiniMetricBox label="IGST Credit" value={`Rs ${data.inward_supplies.igst_rupees}`} />
          <MiniMetricBox label="Total ITC Credit" value={`Rs ${data.inward_supplies.gst_rupees}`} highlight />
        </div>
      </div>

      {/* Net GST Payable grid */}
      <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
        <h2 className="text-xs font-semibold uppercase text-red-400 border-b border-slate-800 pb-2 mb-3">
          3. Net GST Payable (Liabilities - ITC)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MiniMetricBox label="Net CGST Payable" value={`Rs ${data.net_payable.cgst_rupees}`} highlight tone="payment" />
          <MiniMetricBox label="Net SGST Payable" value={`Rs ${data.net_payable.sgst_rupees}`} highlight tone="payment" />
          <MiniMetricBox label="Net IGST Payable" value={`Rs ${data.net_payable.igst_rupees}`} highlight tone="payment" />
        </div>
      </div>
    </div>
  );
}

function MiniMetricBox({ label, value, highlight = false, tone = "neutral" }: { label: string; value: string; highlight?: boolean; tone?: "neutral" | "receipt" | "payment" }) {
  const toneClass = highlight 
    ? (tone === "payment" ? "text-red-400 font-bold" : "text-emerald-400 font-bold") 
    : "text-white font-semibold";
  return (
    <div className="bg-slate-950/80 border border-slate-800/60 rounded p-2 flex flex-col gap-0.5 shadow-sm">
      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      <span className={`font-mono text-xs ${toneClass}`}>{value}</span>
    </div>
  );
}

function GstrLinesView({
  gstLines,
  aggregates,
  title
}: {
  gstLines: GstLineItem[];
  aggregates: {
    taxableRupees: string;
    cgstRupees: string;
    sgstRupees: string;
    gstRupees: string;
    grossWeightG: string;
    netWeightG: string;
  };
  title: string;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden min-h-0 bg-slate-950 p-4 gap-4">
      {/* Aggregates row */}
      <div className="grid grid-cols-2 sm:grid-cols-6 border border-slate-800 rounded-lg overflow-hidden bg-slate-900/30">
        <MetricItem label="Gross Weight" value={`${aggregates.grossWeightG} g`} />
        <MetricItem label="Net Weight" value={`${aggregates.netWeightG} g`} />
        <MetricItem label="Taxable Value" value={`Rs ${aggregates.taxableRupees}`} />
        <MetricItem label="Total CGST" value={`Rs ${aggregates.cgstRupees}`} />
        <MetricItem label="Total SGST" value={`Rs ${aggregates.sgstRupees}`} />
        <MetricItem label="Total GST" value={`Rs ${aggregates.gstRupees}`} highlight />
      </div>

      {/* Detail Table */}
      <div className="border border-slate-800 bg-slate-900/20 p-4 rounded-lg flex flex-col min-h-0 overflow-auto">
        <h2 className="text-xs font-semibold uppercase text-slate-200 border-b border-slate-800 pb-2 mb-2">
          {title} HSN / SAC Summary
        </h2>
        <div className="overflow-auto min-h-0">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="px-3 py-2 font-semibold uppercase">HSN/SAC</th>
                <th className="px-3 py-2 font-semibold uppercase">Description</th>
                <th className="px-3 py-2 font-semibold uppercase">UQC</th>
                <th className="px-3 py-2 font-semibold uppercase">Qty</th>
                <th className="px-3 py-2 font-semibold uppercase">Gross Wt (g)</th>
                <th className="px-3 py-2 font-semibold uppercase">Net Wt (g)</th>
                <th className="px-3 py-2 font-semibold uppercase">Tax Rate (%)</th>
                <th className="px-3 py-2 font-semibold uppercase">Taxable Value</th>
                <th className="px-3 py-2 font-semibold uppercase">CGST</th>
                <th className="px-3 py-2 font-semibold uppercase">SGST</th>
                <th className="px-3 py-2 font-semibold uppercase">IGST</th>
              </tr>
            </thead>
            <tbody>
              {gstLines.map((line, index) => (
                <tr key={index} className="border-b border-slate-900 hover:bg-slate-900/30 transition">
                  <td className="px-3 py-2 font-mono text-slate-200">{line.hsn_sc}</td>
                  <td className="px-3 py-2 text-slate-300">{line.desc}</td>
                  <td className="px-3 py-2 text-slate-400">{line.uqc}</td>
                  <td className="px-3 py-2 font-mono text-slate-250">{line.qty}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{(line.gross_weight_mg / 1000).toFixed(3)}g</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{(line.net_weight_mg / 1000).toFixed(3)}g</td>
                  <td className="px-3 py-2 font-mono text-slate-200">{line.rt}%</td>
                  <td className="px-3 py-2 font-mono font-semibold text-white">Rs {line.txval}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">Rs {line.camt}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">Rs {line.samt}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">Rs {line.iamt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border-r border-slate-800 bg-slate-950/80 px-3 py-2.5 last:border-r-0 flex flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase text-slate-500">{label}</span>
      <span className={`font-mono text-xs font-bold ${highlight ? "text-emerald-400" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}



export default function GSTReportsModule({ apiBaseUrl = "" }: GSTReportsModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("gstr1");
  const [fromDate, setFromDate] = useState(getMonthStart());
  const [toDate, setToDate] = useState(getToday());
  
  // GSTR-1 and GSTR-2 Data
  const [gstLines, setGstLines] = useState<GstLineItem[]>([]);
  // GSTR-3B Data
  const [gstr3bData, setGstr3bData] = useState<Gst3bResponse | null>(null);

  // Audit Locks State
  const [locks, setLocks] = useState<any[]>([]);
  const [lockFrom, setLockFrom] = useState(getToday());
  const [lockTo, setLockTo] = useState(getToday());
  const [lockReason, setLockReason] = useState("");

  // BIS Workflow State
  const [subTab, setSubTab] = useState<"ready" | "active" | "huid_inventory">("ready");
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [itemsToHallmark, setItemsToHallmark] = useState<any[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Record<number, boolean>>({});
  const [hallmarkCenter, setHallmarkCenter] = useState("");
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [bisSubmittedDate, setBisSubmittedDate] = useState(getToday());
  const [bisRemarks, setBisRemarks] = useState("");

  // Submissions Process Return Form state
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);
  const [returnItemsState, setReturnItemsState] = useState<Record<number, { status: "HUID_RECEIVED" | "REJECTED"; huid: string; certificate_number: string; remarks: string }>>({});

  // HUID History Modal State
  const [showHistoryItemId, setShowHistoryItemId] = useState<number | null>(null);
  const [huidHistory, setHuidHistory] = useState<any[]>([]);
  const [historyItemBarcode, setHistoryItemBarcode] = useState("");

  // Search input for HUID Printing
  const [huidSearch, setHuidSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    if (activeTab === "audit_locks") {
      void loadLocks();
    } else if (activeTab === "bis_workflow") {
      void loadBisData();
    } else {
      void loadReportData();
    }
  }, [activeTab, fromDate, toDate]);

  async function loadLocks() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/audit-locks`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result.locks) {
        setLocks(result.locks);
      } else {
        throw new Error(result.errors?.join(" ") || "Failed to load audit locks.");
      }
    } catch (caught: any) {
      setError(caught.message || "Failed to load audit locks.");
    } finally {
      setLoading(false);
    }
  }

  async function createLock(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/audit-locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          period_from: lockFrom,
          period_to: lockTo,
          reason: lockReason
        })
      });
      const result = await response.json();
      if (response.ok) {
        setLockReason("");
        await loadLocks();
      } else {
        throw new Error(result.errors?.join(" ") || "Failed to create audit lock.");
      }
    } catch (caught: any) {
      setError(caught.message);
    }
  }

  async function unlockPeriod(lockId: number) {
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/audit-locks/${lockId}/unlock`, {
        method: "PATCH",
        headers: authHeaders
      });
      const result = await response.json();
      if (response.ok) {
        await loadLocks();
      } else {
        throw new Error(result.errors?.join(" ") || "Failed to unlock period.");
      }
    } catch (caught: any) {
      setError(caught.message);
    }
  }

  async function loadBisData() {
    setLoading(true);
    setError("");
    try {
      const subResponse = await fetch(`${apiBaseUrl}/api/compliance/bis-submissions`, { headers: authHeaders });
      const subResult = await subResponse.json();
      if (subResponse.ok && subResult.submissions) {
        setSubmissions(subResult.submissions);
      }

      const itemsResponse = await fetch(`${apiBaseUrl}/api/inventory?limit=500`, { headers: authHeaders });
      const itemsResult = await itemsResponse.json();
      if (itemsResponse.ok && itemsResult.items) {
        const eligible = itemsResult.items.filter((item: any) => 
          item.metal_type.toLowerCase() === "gold" && 
          item.status === "IN_STOCK" && 
          (item.huid_status === "NOT_APPLIED" || !item.huid_status)
        );
        setItemsToHallmark(eligible);
      }
    } catch (caught: any) {
      setError(caught.message || "Failed to load BIS workflow data.");
    } finally {
      setLoading(false);
    }
  }

  async function submitToBis(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const ids = Object.keys(selectedItemIds).filter(id => selectedItemIds[Number(id)]).map(Number);
    if (ids.length === 0) {
      setError("Please select at least one item to hallmark.");
      return;
    }
    if (!hallmarkCenter.trim()) {
      setError("Hallmark center name is required.");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/bis-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          hallmark_center_name: hallmarkCenter,
          submitted_date: bisSubmittedDate,
          expected_return_date: expectedReturnDate || null,
          remarks: bisRemarks || null,
          item_ids: ids
        })
      });
      const result = await response.json();
      if (response.ok) {
        setHallmarkCenter("");
        setExpectedReturnDate("");
        setBisRemarks("");
        setSelectedItemIds({});
        await loadBisData();
      } else {
        throw new Error(result.errors?.join(" ") || "Failed to submit items to BIS.");
      }
    } catch (caught: any) {
      setError(caught.message);
    }
  }

  async function submitReturn(subId: number) {
    setError("");
    const itemsData = Object.keys(returnItemsState)
      .map(Number)
      .map(itemId => ({
        item_id: itemId,
        ...returnItemsState[itemId]
      }));

    if (itemsData.length === 0) {
      setError("Please fill return details for at least one item.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/bis-submissions/${subId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ items: itemsData })
      });
      const result = await response.json();
      if (response.ok) {
        setReturnItemsState({});
        setExpandedSubmissionId(null);
        await loadBisData();
      } else {
        throw new Error(result.errors?.join(" ") || "Failed to process return.");
      }
    } catch (caught: any) {
      setError(caught.message);
    }
  }

  async function showHistory(itemId: number, barcode: string) {
    setHistoryItemBarcode(barcode);
    setShowHistoryItemId(itemId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/compliance/huid/history/${itemId}`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result.history) {
        setHuidHistory(result.history);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadReportData() {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "gstr1" || activeTab === "gstr2") {
        const endpoint = activeTab === "gstr1" ? "gstr1" : "gstr2";
        const response = await fetch(
          `${apiBaseUrl}/api/compliance/gst-export/${endpoint}?from=${fromDate}&to=${toDate}`,
          { headers: authHeaders }
        );
        const result = (await response.json().catch(() => null)) as GstLineItem[] | { errors?: string[] } | null;

        if (!response.ok || !Array.isArray(result)) {
          throw new Error(getErrorMessage(result, "Failed to load GST report details."));
        }

        setGstLines(result);
        setGstr3bData(null);
      } else if (activeTab === "gstr3b") {
        const response = await fetch(
          `${apiBaseUrl}/api/compliance/gst-export/gstr3b?from=${fromDate}&to=${toDate}`,
          { headers: authHeaders }
        );
        const result = (await response.json().catch(() => null)) as Gst3bResponse | { errors?: string[] } | null;

        if (!response.ok || !result || "errors" in result) {
          throw new Error(getErrorMessage(result, "Failed to load GSTR-3B summary."));
        }

        setGstr3bData(result as Gst3bResponse);
        setGstLines([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to generate report.");
      setGstLines([]);
      setGstr3bData(null);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate stats for GSTR-1 / GSTR-2 view
  const aggregates = useMemo(() => {
    let totalTaxablePaise = 0;
    let totalCgstPaise = 0;
    let totalSgstPaise = 0;
    let totalGstPaise = 0;
    let totalGrossMg = 0;
    let totalNetMg = 0;

    for (const line of gstLines) {
      totalTaxablePaise += line.taxable_value_paise;
      totalCgstPaise += line.cgst_paise;
      totalSgstPaise += line.sgst_paise;
      totalGstPaise += line.cgst_paise + line.sgst_paise + line.igst_paise;
      totalGrossMg += line.gross_weight_mg;
      totalNetMg += line.net_weight_mg;
    }

    return {
      taxableRupees: (totalTaxablePaise / 100).toFixed(2),
      cgstRupees: (totalCgstPaise / 100).toFixed(2),
      sgstRupees: (totalSgstPaise / 100).toFixed(2),
      gstRupees: (totalGstPaise / 100).toFixed(2),
      grossWeightG: (totalGrossMg / 1000).toFixed(3),
      netWeightG: (totalNetMg / 1000).toFixed(3)
    };
  }, [gstLines]);

  function exportCSV() {
    if (activeTab === "gstr1" || activeTab === "gstr2") {
      if (gstLines.length === 0) return;
      const headers = ["HSN/SAC", "Description", "UQC", "Quantity", "Gross Wt (g)", "Net Wt (g)", "Tax Rate (%)", "Taxable Value (Rs)", "CGST (Rs)", "SGST (Rs)", "IGST (Rs)"];
      const rows = gstLines.map((line) => [
        line.hsn_sc,
        line.desc,
        line.uqc,
        line.qty,
        (line.gross_weight_mg / 1000).toFixed(3),
        (line.net_weight_mg / 1000).toFixed(3),
        line.rt,
        line.txval,
        line.camt,
        line.samt,
        line.iamt
      ]);

      const title = activeTab === "gstr1" ? "GSTR-1 Outward Sales Report" : "GSTR-2 Inward Purchases Report";
      const csvContent = [
        [title],
        [`Period: ${fromDate} to ${toDate}`],
        [],
        headers,
        ...rows
      ]
        .map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      downloadCSVFile(csvContent, `${activeTab}_report_${fromDate}_to_${toDate}.csv`);
    } else {
      if (!gstr3bData) return;
      const csvRows = [
        ["GSTR-3B Monthly GST Summary Report"],
        [`Period: ${fromDate} to ${toDate}`],
        [],
        ["1. Outward Taxable Supplies (Sales)"],
        ["Taxable Value (Rs)", gstr3bData.outward_supplies.taxable_value_rupees],
        ["Central Tax CGST (Rs)", gstr3bData.outward_supplies.cgst_rupees],
        ["State Tax SGST (Rs)", gstr3bData.outward_supplies.sgst_rupees],
        ["Integrated Tax IGST (Rs)", gstr3bData.outward_supplies.igst_rupees],
        ["Total GST (Rs)", gstr3bData.outward_supplies.gst_rupees],
        [],
        ["2. Inward Taxable Supplies (Purchases / Eligible ITC)"],
        ["Taxable Value (Rs)", gstr3bData.inward_supplies.taxable_value_rupees],
        ["Central ITC CGST (Rs)", gstr3bData.inward_supplies.cgst_rupees],
        ["State ITC SGST (Rs)", gstr3bData.inward_supplies.sgst_rupees],
        ["Integrated ITC IGST (Rs)", gstr3bData.inward_supplies.igst_rupees],
        ["Total ITC GST (Rs)", gstr3bData.inward_supplies.gst_rupees],
        [],
        ["3. Net GST Payable / Settled"],
        ["Net CGST Payable (Rs)", gstr3bData.net_payable.cgst_rupees],
        ["Net SGST Payable (Rs)", gstr3bData.net_payable.sgst_rupees],
        ["Net IGST Payable (Rs)", gstr3bData.net_payable.igst_rupees]
      ];

      const csvContent = csvRows
        .map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      downloadCSVFile(csvContent, `GSTR3B_summary_${fromDate}_to_${toDate}.csv`);
    }
  }

  function downloadCSVFile(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-white">GST Compliance & HUID Dashboard</h1>
          <p className="text-xs text-slate-400">Taxes, GSTR exports, audit period locks, and BIS hallmarking workflows</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <TabButton active={activeTab === "gstr1"} onClick={() => setActiveTab("gstr1")}>GSTR-1 (Sales)</TabButton>
          <TabButton active={activeTab === "gstr2"} onClick={() => setActiveTab("gstr2")}>GSTR-2 (Purchases)</TabButton>
          <TabButton active={activeTab === "gstr3b"} onClick={() => setActiveTab("gstr3b")}>GSTR-3B (Summary)</TabButton>
          <TabButton active={activeTab === "audit_locks"} onClick={() => setActiveTab("audit_locks")}>Audit Locks</TabButton>
          <TabButton active={activeTab === "bis_workflow"} onClick={() => setActiveTab("bis_workflow")}>HUID & BIS Workflow</TabButton>
        </nav>
      </header>

      <main className="min-h-0 overflow-hidden grid grid-rows-[auto_1fr]">
        {/* Date Filters Header (only for report tabs) */}
        {(activeTab === "gstr1" || activeTab === "gstr2" || activeTab === "gstr3b") && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs">
            <label className="flex items-center gap-2 font-semibold uppercase text-slate-400">
              From Date:
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 rounded"
              />
            </label>

            <label className="flex items-center gap-2 font-semibold uppercase text-slate-400">
              To Date:
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 rounded"
              />
            </label>

            <button
              type="button"
              onClick={exportCSV}
              disabled={loading || (activeTab === "gstr3b" ? !gstr3bData : gstLines.length === 0)}
              className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold px-4 rounded uppercase text-[10px] tracking-wide ml-auto disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Export GST CSV
            </button>
          </div>
        )}

        {/* Content container */}
        <div className="min-h-0 overflow-hidden">
          {error && (
            <div className="bg-red-950/40 text-red-200 border-b border-slate-800 px-4 py-1.5 text-xs font-semibold">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500">
              <p className="text-xs uppercase tracking-widest animate-pulse">Calculating tax registry...</p>
            </div>
          ) : activeTab === "gstr3b" ? (
            gstr3bData ? (
              <Gstr3bView data={gstr3bData} />
            ) : (
              <EmptyState message="No GSTR-3B summary matches this period." />
            )
          ) : activeTab === "audit_locks" ? (
            <AuditLocksView
              locks={locks}
              lockFrom={lockFrom}
              lockTo={lockTo}
              lockReason={lockReason}
              setLockFrom={setLockFrom}
              setLockTo={setLockTo}
              setLockReason={setLockReason}
              createLock={createLock}
              unlockPeriod={unlockPeriod}
            />
          ) : activeTab === "bis_workflow" ? (
            <BisWorkflowView
              subTab={subTab}
              setSubTab={setSubTab}
              submissions={submissions}
              itemsToHallmark={itemsToHallmark}
              selectedItemIds={selectedItemIds}
              setSelectedItemIds={setSelectedItemIds}
              hallmarkCenter={hallmarkCenter}
              setHallmarkCenter={setHallmarkCenter}
              expectedReturnDate={expectedReturnDate}
              setExpectedReturnDate={setExpectedReturnDate}
              bisSubmittedDate={bisSubmittedDate}
              setBisSubmittedDate={setBisSubmittedDate}
              bisRemarks={bisRemarks}
              setBisRemarks={setBisRemarks}
              submitToBis={submitToBis}
              expandedSubmissionId={expandedSubmissionId}
              setExpandedSubmissionId={setExpandedSubmissionId}
              returnItemsState={returnItemsState}
              setReturnItemsState={setReturnItemsState}
              submitReturn={submitReturn}
              huidSearch={huidSearch}
              setHuidSearch={setHuidSearch}
              showHistory={showHistory}
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
            />
          ) : gstLines.length > 0 ? (
            <GstrLinesView
              gstLines={gstLines}
              aggregates={aggregates}
              title={activeTab === "gstr1" ? "Outward Supplies" : "Inward Purchases"}
            />
          ) : (
            <EmptyState message="No matching GST data for this date range." />
          )}
        </div>
      </main>

      {/* History Log Dialog Modal */}
      {showHistoryItemId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
          <div className="w-full max-w-lg border border-slate-700 bg-slate-950 p-4 rounded-lg flex flex-col gap-3 shadow-xl">
            <div className="border-b border-slate-800 pb-2 flex justify-between items-center">
              <div>
                <h2 className="text-sm font-semibold uppercase text-white">HUID History Log</h2>
                <p className="text-[11px] text-slate-400">Lifecycle trace for item: <strong>{historyItemBarcode}</strong></p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowHistoryItemId(null);
                  setHuidHistory([]);
                }}
                className="text-slate-400 hover:text-white text-xs font-semibold uppercase"
              >
                Close
              </button>
            </div>
            
            <div className="max-h-60 overflow-y-auto pr-1">
              {huidHistory.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center uppercase tracking-wide">No lifecycle events recorded for this item.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {huidHistory.map((ev, index) => (
                    <div key={ev.id || index} className="border border-slate-900 bg-slate-900/30 p-2.5 rounded text-xs">
                      <div className="flex justify-between font-semibold">
                        <span className="text-emerald-400 uppercase tracking-wider text-[10px]">{ev.event_type}</span>
                        <span className="text-slate-500 font-mono text-[10px]">{ev.created_at || ev.timestamp}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1.5 text-[11px]">
                        <div>Status: <span className="text-slate-200 font-semibold">{ev.from_status} → {ev.to_status}</span></div>
                        {ev.huid && <div>HUID: <span className="text-white font-mono font-bold">{ev.huid}</span></div>}
                        {ev.certificate_number && <div className="col-span-2">Cert #: <span className="text-slate-300 font-mono">{ev.certificate_number}</span></div>}
                        {ev.remarks && <div className="col-span-2 text-slate-400 italic">Remarks: {ev.remarks}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

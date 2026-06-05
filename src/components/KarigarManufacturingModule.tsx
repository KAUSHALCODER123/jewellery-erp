import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type KarigarManufacturingModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "issue" | "receive" | "ledger";

type Karigar = {
  id: number;
  name: string;
  phone: string;
  specialty: "CASTING" | "HANDMADE" | "POLISH" | "SETTING";
  fine_gold_balance_mg: number;
  cash_balance_paise: number;
};

type JobOrder = {
  id: number;
  order_number: string;
  karigar_id: number;
  design_image_path?: string | null;
  target_purity: number;
  target_weight_mg: number;
  status: "PENDING" | "WIP" | "COMPLETED" | "CANCELLED";
};

type LedgerResponse = {
  karigar: Karigar;
  jobs: JobOrder[];
  timeline: Array<{
    type: "MATERIAL_ISSUE" | "JOB_RECEIPT";
    date: string;
    job_id: number;
    fine_gold_delta_mg: number;
    cash_delta_paise: number;
    details: Record<string, number | string | boolean | null>;
  }>;
};

type IssueForm = {
  karigarId: string;
  jobName: string;
  targetPurity: string;
  targetWeightGrams: string;
  designImagePath: string;
  grossWeightIssuedGrams: string;
  purityTunch: string;
};

type ReceiveForm = {
  jobId: string;
  finalGrossWeightGrams: string;
  finalNetWeightGrams: string;
  scrapReturnedGrams: string;
  scrapPurityTunch: string;
  laborChargeRupees: string;
};

const ACCEPTABLE_WASTAGE_PERCENTAGE = "2.50";

const initialIssueForm: IssueForm = {
  karigarId: "",
  jobName: "",
  targetPurity: "91.60",
  targetWeightGrams: "",
  designImagePath: "",
  grossWeightIssuedGrams: "",
  purityTunch: "91.60"
};

const initialReceiveForm: ReceiveForm = {
  jobId: "",
  finalGrossWeightGrams: "",
  finalNetWeightGrams: "",
  scrapReturnedGrams: "",
  scrapPurityTunch: "100.00",
  laborChargeRupees: ""
};

export default function KarigarManufacturingModule({ apiBaseUrl = "" }: KarigarManufacturingModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("issue");
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [wipJobs, setWipJobs] = useState<JobOrder[]>([]);
  const [issueForm, setIssueForm] = useState<IssueForm>(initialIssueForm);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>(initialReceiveForm);
  const [ledgerKarigarId, setLedgerKarigarId] = useState("");
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [transferModal, setTransferModal] = useState<{
    isOpen: boolean;
    jobId: number;
    grossWeightGrams: string;
    netWeightGrams: string;
    barcode: string;
    huid: string;
    category: string;
    makingChargeType: "PER_GRAM" | "FLAT";
    makingChargeValueRupees: string;
    designName: string;
  }>({
    isOpen: false,
    jobId: 0,
    grossWeightGrams: "",
    netWeightGrams: "",
    barcode: "",
    huid: "",
    category: "RING",
    makingChargeType: "PER_GRAM",
    makingChargeValueRupees: "",
    designName: ""
  });

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    void loadKarigars();
    void loadWipJobs();
  }, []);

  useEffect(() => {
    if (activeTab === "receive") {
      void loadWipJobs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (ledgerKarigarId) {
      void loadLedger(ledgerKarigarId);
    } else {
      setLedger(null);
    }
  }, [ledgerKarigarId]);

  const issuePreview = useMemo(
    () => calculateFineGoldMg(gramsToMg(issueForm.grossWeightIssuedGrams), tunchToBasisPoints(issueForm.purityTunch)),
    [issueForm.grossWeightIssuedGrams, issueForm.purityTunch]
  );
  const selectedReceiveJob = wipJobs.find((job) => String(job.id) === receiveForm.jobId) ?? null;
  const receivePreview = useMemo(() => calculateReconciliationPreview(receiveForm, selectedReceiveJob), [receiveForm, selectedReceiveJob]);

  async function loadKarigars() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/karigar/karigars`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { karigars?: Karigar[] } | null;
      setKarigars(response.ok && result?.karigars ? result.karigars : []);
    } catch {
      setKarigars([]);
    }
  }

  async function loadWipJobs() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/karigar/jobs?status=WIP`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { jobs?: JobOrder[] } | null;
      setWipJobs(response.ok && result?.jobs ? result.jobs : []);
    } catch {
      setWipJobs([]);
    }
  }

  async function loadLedger(karigarId: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/karigar/ledger/${encodeURIComponent(karigarId)}`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as LedgerResponse | { errors?: string[] } | null;

      if (!response.ok || !isLedgerResponse(result)) {
        throw new Error(getErrorMessage(result, "Could not load Karigar ledger."));
      }

      setLedger(result);
    } catch (caught) {
      setLedger(null);
      setError(caught instanceof Error ? caught.message : "Could not load Karigar ledger.");
    }
  }

  async function uploadDesignImage(file: File | null) {
    if (!file) return;

    const upload = new FormData();
    upload.append("image", file);

    try {
      const response = await fetch(`${apiBaseUrl}/api/upload/image`, {
        method: "POST",
        headers: authHeaders,
        body: upload
      });
      const result = (await response.json().catch(() => null)) as { image_path?: string; url?: string; errors?: string[] } | null;

      if (!response.ok || !result) {
        throw new Error(result?.errors?.join(" ") || "Design image upload failed.");
      }

      setIssueForm((current) => ({ ...current, designImagePath: result.image_path ?? result.url ?? "" }));
      setMessage("Design image uploaded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Design image upload failed.");
    }
  }

  async function issueMetal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const targetWeightMg = gramsToMg(issueForm.targetWeightGrams);
    const grossWeightMg = gramsToMg(issueForm.grossWeightIssuedGrams);

    if (!issueForm.karigarId || !issueForm.jobName.trim() || targetWeightMg <= 0 || grossWeightMg <= 0) {
      setError("Karigar, job name, target weight, and issue weight are required.");
      return;
    }

    try {
      const jobResponse = await fetch(`${apiBaseUrl}/api/karigar/jobs`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          order_number: issueForm.jobName.trim().toUpperCase().replace(/\s+/g, "-"),
          karigar_id: Number(issueForm.karigarId),
          target_purity: issueForm.targetPurity,
          target_weight_mg: targetWeightMg,
          design_image_path: issueForm.designImagePath || null
        })
      });
      const jobResult = (await jobResponse.json().catch(() => null)) as { job?: JobOrder; errors?: string[] } | null;

      if (!jobResponse.ok || !jobResult?.job) {
        throw new Error(jobResult?.errors?.join(" ") || "Could not create job order.");
      }

      const issueResponse = await fetch(`${apiBaseUrl}/api/karigar/issue-metal`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          job_id: jobResult.job.id,
          gross_weight_mg: grossWeightMg,
          purity_tunch: issueForm.purityTunch,
          metal_type: "GOLD",
          issue_date: getToday()
        })
      });
      const issueResult = (await issueResponse.json().catch(() => null)) as { errors?: string[] } | null;

      if (!issueResponse.ok) {
        throw new Error(issueResult?.errors?.join(" ") || "Could not issue metal.");
      }

      setMessage("Raw metal issued and Karigar ledger updated.");
      setIssueForm(initialIssueForm);
      void loadWipJobs();
      void loadKarigars();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not issue metal.");
    }
  }

  async function receiveJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedReceiveJob) {
      setError("Select an active WIP job.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/karigar/receive-job`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          job_id: selectedReceiveJob.id,
          final_gross_weight_mg: gramsToMg(receiveForm.finalGrossWeightGrams),
          final_net_weight_mg: gramsToMg(receiveForm.finalNetWeightGrams),
          scrap_returned_mg: gramsToMg(receiveForm.scrapReturnedGrams),
          scrap_purity_tunch: receiveForm.scrapPurityTunch,
          acceptable_wastage_percentage: ACCEPTABLE_WASTAGE_PERCENTAGE,
          labor_charge_paise: rupeesToPaise(receiveForm.laborChargeRupees),
          receive_date: getToday()
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not receive job.");
      }

      setMessage("Finished job received and ledger reconciled.");
      setReceiveForm(initialReceiveForm);
      void loadWipJobs();
      void loadKarigars();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not receive job.");
    }
  }

  function openTransferModal(jobId: number, grossWeightGrams: number, netWeightGrams: number, jobName: string) {
    setTransferModal({
      isOpen: true,
      jobId,
      grossWeightGrams: String(grossWeightGrams),
      netWeightGrams: String(netWeightGrams),
      barcode: "",
      huid: "",
      category: "RING",
      makingChargeType: "PER_GRAM",
      makingChargeValueRupees: "0",
      designName: jobName || ""
    });
    void fetchNextBarcode("RING");
  }

  async function fetchNextBarcode(cat: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/barcode/next?category=${encodeURIComponent(cat)}`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result.barcode) {
        setTransferModal((prev) => ({ ...prev, barcode: result.barcode }));
      }
    } catch {
      // Ignored, user can enter manually
    }
  }

  function handleCategoryChange(cat: string) {
    setTransferModal((prev) => ({ ...prev, category: cat }));
    void fetchNextBarcode(cat);
  }

  async function handleTransferSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/karigar/jobs/${transferModal.jobId}/transfer-to-barcode`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          barcode: transferModal.barcode,
          huid: transferModal.huid || null,
          category: transferModal.category,
          making_charge_type: transferModal.makingChargeType,
          making_charge_value: rupeesToPaise(transferModal.makingChargeValueRupees),
          design_name: transferModal.designName || null
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to transfer to barcode stock.");
      }

      setMessage("Item transferred to barcode stock successfully!");
      setTransferModal((prev) => ({ ...prev, isOpen: false }));
      if (ledgerKarigarId) {
        void loadLedger(ledgerKarigarId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to transfer to barcode stock.");
    }
  }

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-white">Karigar Manufacturing</h1>
          <p className="text-xs text-slate-400">Metal accountability, wastage, labor balances</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <TabButton active={activeTab === "issue"} onClick={() => setActiveTab("issue")}>Issue Raw Metal</TabButton>
          <TabButton active={activeTab === "receive"} onClick={() => setActiveTab("receive")}>Receive Finished Job</TabButton>
          <TabButton active={activeTab === "ledger"} onClick={() => setActiveTab("ledger")}>Karigar Ledgers</TabButton>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "issue" && (
          <form onSubmit={issueMetal} className="grid h-full grid-cols-[310px_1fr_300px] overflow-hidden">
            <aside className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Karigar Selection" />
              <Field label="Artisan">
                <select value={issueForm.karigarId} onChange={(event) => setIssueForm({ ...issueForm, karigarId: event.target.value })} className={controlClassName}>
                  <option value="">Select Karigar</option>
                  {karigars.map((karigar) => (
                    <option key={karigar.id} value={karigar.id}>{karigar.name} - {karigar.specialty}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <MetricBox label="Artisans" value={String(karigars.length)} />
                <MetricBox label="WIP Jobs" value={String(wipJobs.length)} />
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader title="Job Details & Material" note="Submit converts grams to integer mg" />
              <div className="grid content-start gap-3 p-3">
                <div className="grid grid-cols-4 gap-2">
                  <Field label="Job Name">
                    <input value={issueForm.jobName} onChange={(event) => setIssueForm({ ...issueForm, jobName: event.target.value })} className={controlClassName} />
                  </Field>
                  <Field label="Target Purity (%)">
                    <input value={issueForm.targetPurity} onChange={(event) => setIssueForm({ ...issueForm, targetPurity: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Target Weight (g)">
                    <input value={issueForm.targetWeightGrams} onChange={(event) => setIssueForm({ ...issueForm, targetWeightGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Design Reference Image">
                    <input type="file" accept="image/*" onChange={(event) => void uploadDesignImage(event.target.files?.[0] ?? null)} className={fileControlClassName} />
                  </Field>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Field label="Gross Weight Issued (g)">
                    <input value={issueForm.grossWeightIssuedGrams} onChange={(event) => setIssueForm({ ...issueForm, grossWeightIssuedGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Purity / Tunch (%)">
                    <input value={issueForm.purityTunch} onChange={(event) => setIssueForm({ ...issueForm, purityTunch: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <MetricBox label="Gross Payload" value={`${gramsToMg(issueForm.grossWeightIssuedGrams)} mg`} />
                  <MetricBox label="Fine Gold Equivalent" value={formatMg(issuePreview)} tone="ok" />
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-3 border-l border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Live Math Preview" />
              <MetricBox label="Formula" value="floor(W x P / 100)" />
              <MetricBox label="Fine Gold Mg" value={`${issuePreview} mg`} tone="ok" />
              <MetricBox label="Design Image" value={issueForm.designImagePath ? "Uploaded" : "Pending"} />
              <button type="submit" className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                Issue Raw Metal
              </button>
            </aside>
          </form>
        )}

        {activeTab === "receive" && (
          <form onSubmit={receiveJob} className="grid h-full grid-cols-[330px_1fr_330px] overflow-hidden">
            <aside className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Job Selection" />
              <Field label="Active WIP Job">
                <select value={receiveForm.jobId} onChange={(event) => setReceiveForm({ ...receiveForm, jobId: event.target.value })} className={controlClassName}>
                  <option value="">Select WIP job</option>
                  {wipJobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.order_number} - {formatMg(job.target_weight_mg)}</option>
                  ))}
                </select>
              </Field>
              <MetricBox label="Target Purity" value={selectedReceiveJob ? formatTunch(selectedReceiveJob.target_purity) : "-"} />
              <MetricBox label="Target Weight" value={selectedReceiveJob ? formatMg(selectedReceiveJob.target_weight_mg) : "-"} />
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader title="Receipt Form" note="Reconciliation runs from integer mg preview" />
              <div className="grid content-start gap-3 p-3">
                <div className="grid grid-cols-5 gap-2">
                  <Field label="Final Gross (g)">
                    <input value={receiveForm.finalGrossWeightGrams} onChange={(event) => setReceiveForm({ ...receiveForm, finalGrossWeightGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Final Net (g)">
                    <input value={receiveForm.finalNetWeightGrams} onChange={(event) => setReceiveForm({ ...receiveForm, finalNetWeightGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Scrap/Dust (g)">
                    <input value={receiveForm.scrapReturnedGrams} onChange={(event) => setReceiveForm({ ...receiveForm, scrapReturnedGrams: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Scrap Purity (%)">
                    <input value={receiveForm.scrapPurityTunch} onChange={(event) => setReceiveForm({ ...receiveForm, scrapPurityTunch: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                  <Field label="Labor Charge">
                    <input value={receiveForm.laborChargeRupees} onChange={(event) => setReceiveForm({ ...receiveForm, laborChargeRupees: event.target.value })} className={controlClassName} inputMode="decimal" />
                  </Field>
                </div>

                {receivePreview.excessLossMg > 0 && (
                  <div className="border-2 border-red-500 bg-red-950 p-3 text-sm font-semibold uppercase text-red-100">
                    EXCESS METAL LOSS DETECTED: {formatMg(receivePreview.excessLossMg)}. This will be deducted from the Karigar's Fine Gold Ledger.
                  </div>
                )}
              </div>
            </section>

            <aside className="grid content-start gap-3 border-l border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Accountability Engine" />
              <MetricBox label="Fine Gold Recovered" value={formatMg(receivePreview.totalFineGoldRecoveredMg)} tone="ok" />
              <MetricBox label="Actual Loss" value={formatMg(receivePreview.actualLossMg)} tone={receivePreview.excessLossMg > 0 ? "danger" : "neutral"} />
              <MetricBox label="Acceptable Allowance" value={formatMg(receivePreview.acceptableLossMg)} />
              <MetricBox label="Labor Payload" value={`${rupeesToPaise(receiveForm.laborChargeRupees)} paise`} />
              <button type="submit" disabled={!selectedReceiveJob} className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                Receive Finished Job
              </button>
            </aside>
          </form>
        )}

        {activeTab === "ledger" && (
          <section className="grid h-full grid-cols-[280px_1fr_1fr] overflow-hidden">
            <aside className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Select Karigar" />
              <select value={ledgerKarigarId} onChange={(event) => setLedgerKarigarId(event.target.value)} className={controlClassName}>
                <option value="">Select Karigar</option>
                {karigars.map((karigar) => (
                  <option key={karigar.id} value={karigar.id}>{karigar.name}</option>
                ))}
              </select>
            </aside>

            <LedgerPane
              title="Metal Ledger"
              metricLabel="Fine Gold Liability"
              metricValue={ledger ? formatMg(ledger.karigar.fine_gold_balance_mg) : "-"}
              tone={ledger && ledger.karigar.fine_gold_balance_mg > 0 ? "danger" : "ok"}
              onTransferClick={(jobId, grossWeightGrams, netWeightGrams) => {
                const job = ledger?.jobs.find((j) => j.id === jobId);
                openTransferModal(jobId, grossWeightGrams, netWeightGrams, job?.order_number || "");
              }}
              rows={ledger?.timeline.filter((entry) => entry.fine_gold_delta_mg !== 0).map((entry) => {
                const isReceipt = entry.type === "JOB_RECEIPT";
                const isTransferred = isReceipt ? !!entry.details.is_transferred : undefined;
                return {
                  id: `${entry.type}-${entry.date}-${entry.job_id}`,
                  date: entry.date,
                  label: entry.type,
                  amount: formatMg(entry.fine_gold_delta_mg),
                  jobId: entry.job_id,
                  isTransferred,
                  grossWeightGrams: isReceipt ? Number(entry.details.final_gross_weight_grams) : 0,
                  netWeightGrams: isReceipt ? Number(entry.details.final_net_weight_grams) : 0
                };
              }) ?? []}
            />

            <LedgerPane
              title="Cash Ledger"
              metricLabel="Pending Labor Payout"
              metricValue={ledger ? formatPaise(ledger.karigar.cash_balance_paise) : "-"}
              tone="warn"
              rows={ledger?.timeline.filter((entry) => entry.cash_delta_paise !== 0).map((entry) => ({
                id: `${entry.type}-${entry.date}-${entry.job_id}`,
                date: entry.date,
                label: entry.type,
                amount: formatPaise(entry.cash_delta_paise)
              })) ?? []}
            />
          </section>
        )}
      </main>

      {transferModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md border border-slate-800 bg-slate-900 p-4 text-slate-100 shadow-2xl rounded-sm">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-semibold uppercase text-white">Transfer to Barcode Stock</h3>
              <button
                type="button"
                onClick={() => setTransferModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleTransferSubmit} className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricBox label="Gross Weight" value={`${transferModal.grossWeightGrams} g`} />
                <MetricBox label="Net Weight" value={`${transferModal.netWeightGrams} g`} />
              </div>
              <Field label="Category">
                <select
                  value={transferModal.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className={controlClassName}
                >
                  <option value="RING">RING</option>
                  <option value="NECKLACE">NECKLACE</option>
                  <option value="BANGLES">BANGLES</option>
                  <option value="EARRINGS">EARRINGS</option>
                  <option value="CHAIN">CHAIN</option>
                  <option value="BRACELET">BRACELET</option>
                  <option value="PENDANT">PENDANT</option>
                  <option value="COIN">COIN</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Barcode">
                  <input
                    value={transferModal.barcode}
                    onChange={(e) => setTransferModal((prev) => ({ ...prev, barcode: e.target.value }))}
                    className={controlClassName}
                    required
                  />
                </Field>
                <Field label="HUID (Optional)">
                  <input
                    value={transferModal.huid}
                    onChange={(e) => setTransferModal((prev) => ({ ...prev, huid: e.target.value }))}
                    className={controlClassName}
                    placeholder="E.g. ABC123"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Making Charge Type">
                  <select
                    value={transferModal.makingChargeType}
                    onChange={(e) => setTransferModal((prev) => ({ ...prev, makingChargeType: e.target.value as any }))}
                    className={controlClassName}
                  >
                    <option value="PER_GRAM">Per Gram</option>
                    <option value="FLAT">Flat</option>
                  </select>
                </Field>
                <Field label="Making Charge (Rs)">
                  <input
                    value={transferModal.makingChargeValueRupees}
                    onChange={(e) => setTransferModal((prev) => ({ ...prev, makingChargeValueRupees: e.target.value }))}
                    className={controlClassName}
                    inputMode="decimal"
                    required
                  />
                </Field>
              </div>
              <Field label="Design Name / Reference">
                <input
                  value={transferModal.designName}
                  onChange={(e) => setTransferModal((prev) => ({ ...prev, designName: e.target.value }))}
                  className={controlClassName}
                />
              </Field>
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setTransferModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-3 py-1.5 border border-slate-700 bg-slate-800 text-xs font-semibold uppercase hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-semibold uppercase cursor-pointer"
                >
                  Confirm Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function calculateReconciliationPreview(form: ReceiveForm, job: JobOrder | null) {
  const issuedFineMg = job?.target_weight_mg ?? 0;
  const finalFineMg = calculateFineGoldMg(gramsToMg(form.finalNetWeightGrams), job?.target_purity ?? 0);
  const scrapFineMg = calculateFineGoldMg(gramsToMg(form.scrapReturnedGrams), tunchToBasisPoints(form.scrapPurityTunch));
  const totalFineGoldRecoveredMg = finalFineMg + scrapFineMg;
  const actualLossMg = Math.max(issuedFineMg - totalFineGoldRecoveredMg, 0);
  const acceptableLossMg = Math.floor((issuedFineMg * tunchToBasisPoints(ACCEPTABLE_WASTAGE_PERCENTAGE)) / 10000);
  const excessLossMg = Math.max(0, actualLossMg - acceptableLossMg);

  return { totalFineGoldRecoveredMg, actualLossMg, acceptableLossMg, excessLossMg };
}

function calculateFineGoldMg(weightMg: number, purityBasisPoints: number) {
  return Math.floor((weightMg * purityBasisPoints) / 10000);
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

function tunchToBasisPoints(value: string) {
  const match = value.trim().match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!match) return 0;

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
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

function formatTunch(value: number) {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function isLedgerResponse(value: LedgerResponse | { errors?: string[] } | null): value is LedgerResponse {
  return Boolean(value && "karigar" in value && "timeline" in value);
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "errors" in value && Array.isArray(value.errors)) {
    return value.errors.join(" ") || fallback;
  }

  return fallback;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
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
      className={`h-8 border-r border-slate-700 px-3 font-semibold uppercase last:border-r-0 ${active ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}
    >
      {children}
    </button>
  );
}

function PanelHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
      <h2 className="text-xs font-semibold uppercase text-white">{title}</h2>
      <span className="text-[11px] text-slate-500">{note}</span>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return <h2 className="text-xs font-semibold uppercase text-white">{title}</h2>;
}

function MetricBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const toneClassName =
    tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "danger" ? "text-red-300" : "text-white";

  return (
    <div className="border border-slate-800 bg-slate-950 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={`truncate font-mono text-sm font-semibold ${toneClassName}`}>{value}</div>
    </div>
  );
}

function LedgerPane({
  title,
  metricLabel,
  metricValue,
  tone,
  rows,
  onTransferClick
}: {
  title: string;
  metricLabel: string;
  metricValue: string;
  tone: "ok" | "warn" | "danger";
  rows: Array<{
    id: string;
    date: string;
    label: string;
    amount: string;
    jobId?: number;
    isTransferred?: boolean;
    grossWeightGrams?: number;
    netWeightGrams?: number;
  }>;
  onTransferClick?: (jobId: number, grossWeightGrams: number, netWeightGrams: number) => void;
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_auto_1fr] border-r border-slate-800 last:border-r-0">
      <PanelHeader title={title} note="Current balance and timeline" />
      <MetricBox label={metricLabel} value={metricValue} tone={tone} />
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-left text-xs font-sans">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-900 hover:bg-slate-900/45 transition-colors">
                <td className="px-2 py-2 font-mono text-slate-400 align-top">{row.date}</td>
                <td className="px-2 py-2 align-top">
                  <div className="font-semibold text-slate-200">{row.label}</div>
                  {row.jobId && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Job #{row.jobId}
                      {row.isTransferred !== undefined && (
                        <span className={`ml-2 px-1 py-0.2 rounded text-[9px] font-bold ${row.isTransferred ? "bg-emerald-950/60 text-emerald-400 border border-emerald-900" : "bg-amber-950/60 text-amber-400 border border-amber-900"}`}>
                          {row.isTransferred ? "Transferred" : "Pending Stock"}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono align-top">
                  <div className="font-semibold">{row.amount}</div>
                  {row.jobId && row.isTransferred === false && onTransferClick && (
                    <button
                      type="button"
                      onClick={() => onTransferClick(row.jobId!, row.grossWeightGrams!, row.netWeightGrams!)}
                      className="mt-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer transition-colors shadow-sm"
                    >
                      Transfer to Barcode
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400";
const fileControlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white file:mr-2 file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white";

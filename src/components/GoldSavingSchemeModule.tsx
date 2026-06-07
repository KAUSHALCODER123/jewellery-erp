import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { usePOSCredit } from "../pos/POSCreditContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";

type GoldSavingSchemeModuleProps = {
  apiBaseUrl?: string;
  onRouteToPos?: () => void;
};

type ActiveTab = "enroll" | "collect" | "ledger" | "reports";

type GssTemplate = {
  id: number;
  scheme_code: string;
  scheme_name: string;
  duration_months: number;
  monthly_amount_paise: number;
  bonus_rule_type: "FIXED_AMOUNT" | "PERCENTAGE_OF_INSTALLMENT";
  bonus_value_paise: number;
  is_active: boolean;
};

type CustomerOption = {
  id: number;
  name: string;
  phone: string;
  pan_number?: string | null;
  aadhaar_number?: string | null;
};

type GssAccount = {
  id: number;
  customer_id: number;
  template_id: number;
  card_number: string;
  customer_name?: string | null;
  phone?: string | null;
  enrollment_date: string;
  maturity_date: string;
  status: "ACTIVE" | "MATURED" | "CONVERTED_TO_SALE" | "DEFAULTER" | "MERGED";
  total_paid_paise: number;
  installments_paid_count: number;
  gold_weight_accumulated_mg?: number;
  template?: GssTemplate;
  duration_months?: number;
  monthly_amount_paise?: number;
  bonus_rule_type?: GssTemplate["bonus_rule_type"];
  bonus_value_paise?: number;
  scheme_code?: string;
  scheme_name?: string;
  scheme_type?: string;
  is_variable?: boolean;
};

type ReportsSubTab = "statement" | "overdue" | "received" | "maturity" | "defaulters" | "merge";

type StatementData = {
  account: GssAccount;
  receipts: Array<{
    id: number;
    installment_number: number;
    payment_date: string;
    amount_paid_paise: number;
    payment_mode: string;
    gold_rate_per_gram_paise?: number | null;
    gold_weight_credited_mg?: number;
  }>;
  summary: {
    calculated_bonus_paise: number;
    expected_maturity_value_paise: number;
    accrued_value_paise: number;
    projected_bonus_paise: number;
    projected_maturity_value_paise: number;
    current_gold_value_paise: number;
    current_gold_rate_paise: number;
  };
};

type PendingReport = GssAccount & {
  expected_installments: number;
  pending_installments_count: number;
  pending_amount_paise: number;
};

type ReceivedReceipt = {
  id: number;
  gss_account_id: number;
  installment_number: number;
  payment_date: string;
  amount_paid_paise: number;
  payment_mode: string;
  card_number: string;
  customer_name: string;
  phone: string;
};

type ReceivedSummary = {
  total_collected_paise: number;
  cash_paise: number;
  upi_paise: number;
  card_paise: number;
};

type MaturityAccount = GssAccount & {
  bonus_paise: number;
  maturity_value_paise: number;
  is_matured: boolean;
};

type EnrollmentForm = {
  templateId: string;
  customerId: string;
  customerSearch: string;
  cardNumber: string;
};

type CollectionForm = {
  search: string;
  selectedAccountId: string;
  amountReceivedRupees: string;
  paymentMode: "CASH" | "UPI" | "CARD";
};

type ReceiptModal = {
  account: GssAccount;
  amountPaise: number;
  paymentMode: CollectionForm["paymentMode"];
  receiptNumber: string;
  receiptId?: number;
};

type ScheduleRow = {
  installment_number: number;
  due_date: string;
  amount_paise: number;
  paid: boolean;
};

const initialEnrollment: EnrollmentForm = {
  templateId: "",
  customerId: "",
  customerSearch: "",
  cardNumber: ""
};

const initialCollection: CollectionForm = {
  search: "",
  selectedAccountId: "",
  amountReceivedRupees: "",
  paymentMode: "CASH"
};

export default function GoldSavingSchemeModule({ apiBaseUrl = "", onRouteToPos }: GoldSavingSchemeModuleProps) {
  const { session } = useAuthSession();
  const { setPosCreditBalance } = usePOSCredit();
  const [activeTab, setActiveTab] = useState<ActiveTab>("enroll");
  const [templates, setTemplates] = useState<GssTemplate[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [accounts, setAccounts] = useState<GssAccount[]>([]);
  const [enrollment, setEnrollment] = useState<EnrollmentForm>(initialEnrollment);
  const [collection, setCollection] = useState<CollectionForm>(initialCollection);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [selectedInstallment, setSelectedInstallment] = useState<number | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState("");
  const [receiptModal, setReceiptModal] = useState<ReceiptModal | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Merge state
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  // Reports state
  const [reportsSubTab, setReportsSubTab] = useState<ReportsSubTab>("statement");
  const [statementAccountId, setStatementAccountId] = useState("");
  const [statementData, setStatementData] = useState<StatementData | null>(null);
  const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);
  const [receivedReceipts, setReceivedReceipts] = useState<ReceivedReceipt[]>([]);
  const [receivedSummary, setReceivedSummary] = useState<ReceivedSummary | null>(null);
  const [receivedStartDate, setReceivedStartDate] = useState(getFirstOfMonth());
  const [receivedEndDate, setReceivedEndDate] = useState(getToday());
  const [maturityDays, setMaturityDays] = useState("30");
  const [maturityAccounts, setMaturityAccounts] = useState<MaturityAccount[]>([]);
  const [defaulterAccounts, setDefaulterAccounts] = useState<GssAccount[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    void loadTemplates();
    void loadCustomers();
    void loadAccounts();
  }, []);

  useEffect(() => {
    if (activeTab === "collect" || activeTab === "ledger") {
      void loadAccounts();
    }
  }, [activeTab]);

  // Load the 12-row installment schedule whenever a collection account is selected.
  useEffect(() => {
    if (!collection.selectedAccountId) {
      setSchedule([]);
      setSelectedInstallment(null);
      return;
    }
    void loadSchedule(collection.selectedAccountId);
  }, [collection.selectedAccountId]);

  const selectedTemplate = templates.find((template) => String(template.id) === enrollment.templateId) ?? null;
  const enrollmentCardValid = /^[A-Za-z0-9]{4,32}$/.test(enrollment.cardNumber.trim());
  const enrollmentDisabled = !enrollment.templateId || !enrollment.customerId || !enrollmentCardValid;

  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");
  const searchedAccounts = activeAccounts.filter((account) => matchesAccountSearch(account, collection.search));
  const selectedCollectionAccount = accounts.find((account) => String(account.id) === collection.selectedAccountId) ?? null;
  const selectedCollectionTemplate = getAccountTemplate(selectedCollectionAccount, templates);
  const collectionAmountPaise = rupeesInputToPaise(collection.amountReceivedRupees);
  const collectionDisabled = !selectedCollectionAccount || collectionAmountPaise <= 0;

  const ledgerRows = accounts
    .filter((account) => account.status === "ACTIVE" || account.status === "MATURED")
    .filter((account) => matchesAccountSearch(account, ledgerFilter));

  async function loadTemplates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/templates?active=true`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { templates?: GssTemplate[] } | null;
      setTemplates(response.ok && result?.templates ? result.templates : []);
    } catch {
      setTemplates([]);
    }
  }

  async function loadCustomers() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers?limit=100`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { customers?: CustomerOption[] } | null;
      setCustomers(response.ok && result?.customers ? result.customers : []);
    } catch {
      setCustomers([]);
    }
  }

  async function loadAccounts() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/accounts?status=ACTIVE,MATURED`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { accounts?: GssAccount[] } | null;
      setAccounts(response.ok && result?.accounts ? result.accounts : []);
    } catch {
      setAccounts([]);
    }
  }

  async function enrollAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (enrollmentDisabled) {
      setError("Select scheme, customer, and a valid alphanumeric card number.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/enroll`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customer_id: Number(enrollment.customerId),
          template_id: Number(enrollment.templateId),
          card_number: enrollment.cardNumber.trim().toUpperCase(),
          enrollment_date: getToday()
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not enroll GSS account.");
      }

      setMessage("GSS account enrolled.");
      setEnrollment(initialEnrollment);
      void loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enroll GSS account.");
    }
  }

  function selectCollectionAccount(account: GssAccount) {
    const template = getAccountTemplate(account, templates);

    setCollection({
      ...collection,
      selectedAccountId: String(account.id),
      amountReceivedRupees: formatPaiseInput(template?.monthly_amount_paise ?? account.monthly_amount_paise ?? 0)
    });
  }

  async function loadSchedule(accountId: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/accounts/${encodeURIComponent(accountId)}/schedule`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { schedule?: ScheduleRow[] } | null;
      const rows = response.ok && result?.schedule ? result.schedule : [];
      setSchedule(rows);
      // Pre-select the current month's due (first unpaid) row, mirroring the receipt grid flow.
      const nextDue = rows.find((row) => !row.paid) ?? null;
      setSelectedInstallment(nextDue ? nextDue.installment_number : null);
      if (nextDue) {
        setCollection((current) => ({ ...current, amountReceivedRupees: formatPaiseInput(nextDue.amount_paise) }));
      }
    } catch {
      setSchedule([]);
      setSelectedInstallment(null);
    }
  }

  // Checking the current-due row populates Total Payable; unchecking clears it.
  function toggleInstallment(row: ScheduleRow) {
    if (selectedInstallment === row.installment_number) {
      setSelectedInstallment(null);
      setCollection((current) => ({ ...current, amountReceivedRupees: "" }));
    } else {
      setSelectedInstallment(row.installment_number);
      setCollection((current) => ({ ...current, amountReceivedRupees: formatPaiseInput(row.amount_paise) }));
    }
  }

  async function collectPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedCollectionAccount || collectionAmountPaise <= 0) {
      setError("Select an active GSS account and enter a positive amount.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/collect-payment`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          gss_account_id: selectedCollectionAccount.id,
          amount_paid_paise: collectionAmountPaise,
          payment_mode: collection.paymentMode,
          payment_date: getToday()
        })
      });
      const result = (await response.json().catch(() => null)) as { receipt?: { id?: number }; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not collect installment.");
      }

      setReceiptModal({
        account: selectedCollectionAccount,
        amountPaise: collectionAmountPaise,
        paymentMode: collection.paymentMode,
        receiptNumber: result?.receipt?.id ? `GSS-${result.receipt.id}` : `GSS-${Date.now()}`,
        receiptId: result?.receipt?.id
      });
      setCollection(initialCollection);
      void loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not collect installment.");
    }
  }

  async function mergeAccounts() {
    setMessage("");
    setError("");
    if (!mergeSourceId || !mergeTargetId) {
      setError("Select both a source and a target account to merge.");
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      setError("Source and target accounts must be different.");
      return;
    }
    setMerging(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/merge`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ source_account_id: Number(mergeSourceId), target_account_id: Number(mergeTargetId) })
      });
      const result = (await response.json().catch(() => null)) as { account?: { card_number?: string }; errors?: string[] } | null;
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not merge accounts.");
      }
      setMessage(`Accounts merged into ${result?.account?.card_number ?? "target account"}. Source account marked MERGED.`);
      setMergeSourceId("");
      setMergeTargetId("");
      void loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not merge accounts.");
    } finally {
      setMerging(false);
    }
  }

  function convertToPosCredit(account: GssAccount | MaturityAccount) {
    const template = getAccountTemplate(account, templates);
    const bonusPaise = 'bonus_paise' in account ? (account as MaturityAccount).bonus_paise : calculateBonusPaise(account, template);
    const creditPayload = {
      source: "GSS",
      gss_account_id: account.id,
      card_number: account.card_number,
      customer_id: account.customer_id,
      customer_name: account.customer_name ?? "Masked Customer",
      principal_paise: account.total_paid_paise,
      bonus_paise: bonusPaise,
      total_credit_paise: account.total_paid_paise + bonusPaise
    } as const;

    setPosCreditBalance(creditPayload);
    localStorage.setItem("pos:gssCredit", JSON.stringify(creditPayload));
    window.dispatchEvent(new CustomEvent("pos:gss-credit", { detail: creditPayload }));
    onRouteToPos?.();
    setMessage(`POS credit prepared for ${account.card_number}: ${formatIndianCurrency(creditPayload.total_credit_paise)}.`);
  }

  // ── Reports Data Fetchers ──────────────────────────────────────────

  async function loadStatement() {
    const accountId = Number(statementAccountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      setError("Enter a valid account ID.");
      return;
    }
    setReportsLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/reports/statements?account_id=${accountId}`, { headers: authHeaders });
      const result = await response.json().catch(() => null) as StatementData | { errors?: string[] } | null;
      if (!response.ok) {
        throw new Error((result as { errors?: string[] })?.errors?.join(" ") || "Failed to fetch statement.");
      }
      setStatementData(result as StatementData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch statement.");
      setStatementData(null);
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadPendingReports() {
    setReportsLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/reports/pending`, { headers: authHeaders });
      const result = await response.json().catch(() => null) as { reports?: PendingReport[] } | null;
      if (!response.ok) throw new Error("Failed to fetch pending reports.");
      setPendingReports(result?.reports ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch pending reports.");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadReceivedReports() {
    if (!receivedStartDate || !receivedEndDate) {
      setError("Select both start and end date.");
      return;
    }
    setReportsLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/reports/received?start_date=${receivedStartDate}&end_date=${receivedEndDate}`, { headers: authHeaders });
      const result = await response.json().catch(() => null) as { receipts?: ReceivedReceipt[]; summary?: ReceivedSummary } | null;
      if (!response.ok) throw new Error("Failed to fetch received reports.");
      setReceivedReceipts(result?.receipts ?? []);
      setReceivedSummary(result?.summary ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch received reports.");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadMaturityReport() {
    setReportsLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/reports/maturity?days=${maturityDays}`, { headers: authHeaders });
      const result = await response.json().catch(() => null) as { accounts?: MaturityAccount[] } | null;
      if (!response.ok) throw new Error("Failed to fetch maturity report.");
      setMaturityAccounts(result?.accounts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch maturity report.");
    } finally {
      setReportsLoading(false);
    }
  }

  async function loadDefaulters() {
    setReportsLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/defaulters`, { headers: authHeaders });
      const result = await response.json().catch(() => null) as { accounts?: GssAccount[] } | null;
      if (!response.ok) throw new Error("Failed to fetch defaulters.");
      setDefaulterAccounts(result?.accounts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to fetch defaulters.");
    } finally {
      setReportsLoading(false);
    }
  }

  async function runDefaulterScan() {
    setReportsLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/gss/defaulter/run`, {
        method: "POST",
        headers: authHeaders
      });
      const result = await response.json().catch(() => null) as { message?: string; updated_count?: number } | null;
      if (!response.ok) throw new Error("Failed to run defaulter scan.");
      setMessage(`Defaulter scan: ${result?.updated_count ?? 0} accounts flagged.`);
      void loadDefaulters();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to run defaulter scan.");
    } finally {
      setReportsLoading(false);
    }
  }

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-white">Gold Saving Scheme</h1>
          <p className="text-xs text-slate-400">Enrollment, installment collection, maturity credit</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <TabButton active={activeTab === "enroll"} onClick={() => setActiveTab("enroll")}>Enrollment</TabButton>
          <TabButton active={activeTab === "collect"} onClick={() => setActiveTab("collect")}>Collection</TabButton>
          <TabButton active={activeTab === "ledger"} onClick={() => setActiveTab("ledger")}>Ledger</TabButton>
          <TabButton active={activeTab === "reports"} onClick={() => setActiveTab("reports")}>Reports & Controls</TabButton>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "enroll" && (
          <form onSubmit={enrollAccount} className="grid h-full grid-cols-[360px_1fr_320px] overflow-hidden">
            <aside className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Scheme Template" />
              <Field label="Active Scheme">
                <select value={enrollment.templateId} onChange={(event) => setEnrollment({ ...enrollment, templateId: event.target.value })} className={controlClassName}>
                  <option value="">Select scheme</option>
                  {templates.filter((template) => template.is_active).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.scheme_name} - {template.duration_months} mo - {formatIndianCurrency(template.monthly_amount_paise)}/mo
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <MetricBox label="Duration" value={selectedTemplate ? `${selectedTemplate.duration_months} months` : "-"} />
                <MetricBox label="Monthly Amount" value={selectedTemplate ? formatIndianCurrency(selectedTemplate.monthly_amount_paise) : "-"} />
                <MetricBox label="Bonus Rule" value={selectedTemplate ? selectedTemplate.bonus_rule_type.replaceAll("_", " ") : "-"} />
                <MetricBox label="Owner Bonus" value={selectedTemplate ? formatBonus(selectedTemplate) : "-"} tone="ok" />
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_1fr]">
              <PanelHeader title="Customer Mapping" note="Identity fields remain redacted" />
              <div className="grid content-start gap-3 overflow-hidden p-3">
                <Field label="Search Customer">
                  <input value={enrollment.customerSearch} onChange={(event) => setEnrollment({ ...enrollment, customerSearch: event.target.value })} className={controlClassName} placeholder="Name or phone" />
                </Field>
                <div className="min-h-0 overflow-auto border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-slate-400">
                      <tr>
                        {["Select", "Customer", "Phone", "KYC Boundary"].map((heading) => (
                          <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customers.filter((customer) => matchesCustomerSearch(customer, enrollment.customerSearch)).map((customer) => (
                        <tr key={customer.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                          <td className="px-2 py-2">
                            <input type="radio" checked={enrollment.customerId === String(customer.id)} onChange={() => setEnrollment({ ...enrollment, customerId: String(customer.id) })} />
                          </td>
                          <td className="px-2 py-2">{customer.name}</td>
                          <td className="px-2 py-2 font-mono">{maskPhone(customer.phone)}</td>
                          <td className="px-2 py-2 text-slate-500">[PAN Redacted] [Aadhaar Redacted]</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-3 border-l border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Profile / Card" />
              <Field label="Physical Card Number">
                <input
                  value={enrollment.cardNumber}
                  onChange={(event) => setEnrollment({ ...enrollment, cardNumber: event.target.value.toUpperCase() })}
                  className={enrollment.cardNumber && !enrollmentCardValid ? dangerControlClassName : controlClassName}
                  placeholder="GSS20260001"
                />
              </Field>
              <MetricBox label="Validation" value={enrollmentCardValid ? "Alphanumeric OK" : "4-32 alphanumeric"} tone={enrollmentCardValid ? "ok" : "warn"} />
              <button type="submit" disabled={enrollmentDisabled} className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                Enroll Account
              </button>
            </aside>
          </form>
        )}

        {activeTab === "collect" && (
          <form onSubmit={collectPayment} className="grid h-full grid-cols-[380px_1fr_310px] overflow-hidden">
            <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-800 bg-slate-900 p-3">
              <div className="grid gap-2 border-b border-slate-800 pb-2">
                <PanelTitle title="Quick Search" />
                <input value={collection.search} onChange={(event) => setCollection({ ...collection, search: event.target.value })} className={controlClassName} placeholder="Card, phone, customer" />
              </div>
              <div className="min-h-0 overflow-auto py-2">
                {searchedAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => selectCollectionAccount(account)}
                    className={`mb-2 grid w-full gap-1 border p-2 text-left text-xs ${collection.selectedAccountId === String(account.id) ? "border-emerald-400 bg-emerald-950/30" : "border-slate-800 bg-slate-950"}`}
                  >
                    <span className="font-mono font-semibold text-white">{account.card_number}</span>
                    <span className="text-slate-300">{account.customer_name ?? "Masked Customer"} | {maskPhone(account.phone)}</span>
                    <span className="font-mono text-slate-400">{formatIndianCurrency(account.total_paid_paise)} saved</span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="grid min-h-0 grid-rows-[auto_auto_1fr]">
              <PanelHeader title="Account Snapshot" note="Installment tracker and overdue view" />
              <div className="grid grid-cols-4 border-b border-slate-800">
                <MetricBox label="Member" value={selectedCollectionAccount?.customer_name ?? "-"} />
                <MetricBox label="Phone" value={maskPhone(selectedCollectionAccount?.phone)} />
                <MetricBox label="Total Saved" value={formatIndianCurrency(selectedCollectionAccount?.total_paid_paise ?? 0)} tone="ok" />
                <MetricBox label="Overdue Days" value={String(calculateOverdueDays(selectedCollectionAccount))} tone={calculateOverdueDays(selectedCollectionAccount) > 0 ? "danger" : "neutral"} />
              </div>
              <div className="grid content-start gap-3 p-3">
                <DurationTracker account={selectedCollectionAccount} template={selectedCollectionTemplate} />

                {selectedCollectionAccount && schedule.length > 0 && (
                  <div className="border border-slate-800">
                    <div className="grid grid-cols-[44px_60px_1fr_1fr] border-b border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">
                      <span>Pay</span>
                      <span>Inst #</span>
                      <span>Due Date</span>
                      <span>Installment</span>
                    </div>
                    <div className="max-h-44 overflow-auto">
                      {schedule.map((row) => {
                        const isNextDue = !row.paid && row.installment_number === (schedule.find((entry) => !entry.paid)?.installment_number ?? -1);
                        const checked = row.paid || selectedInstallment === row.installment_number;
                        return (
                          <label
                            key={row.installment_number}
                            className={`grid grid-cols-[44px_60px_1fr_1fr] items-center px-2 py-1 text-xs ${row.paid ? "text-emerald-300" : isNextDue ? "bg-slate-900/60 text-white" : "text-slate-500"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={row.paid || !isNextDue}
                              onChange={() => toggleInstallment(row)}
                              className="h-3.5 w-3.5 accent-emerald-500"
                            />
                            <span className="font-mono">{row.installment_number}</span>
                            <span>{row.due_date}</span>
                            <span className="font-mono">{formatIndianCurrency(row.amount_paise)}{row.paid ? " ✓" : ""}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Field label="Total Payable">
                    <input value={collection.amountReceivedRupees} onChange={(event) => setCollection({ ...collection, amountReceivedRupees: event.target.value })} className={controlClassName} inputMode="decimal" />
                    <span className="font-mono text-[10px] text-slate-500">payload: {collectionAmountPaise} paise</span>
                  </Field>
                  <Field label="Payment Mode">
                    <select value={collection.paymentMode} onChange={(event) => setCollection({ ...collection, paymentMode: event.target.value as CollectionForm["paymentMode"] })} className={controlClassName}>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                  </Field>
                  <div className="grid content-end">
                    <button type="submit" disabled={collectionDisabled} className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Save Installment
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <aside className="grid content-start gap-2 border-l border-slate-800 bg-slate-900 p-3">
              <PanelTitle title="Collection Notes" />
              <MetricBox label="Default Amount" value={formatIndianCurrency(selectedCollectionTemplate?.monthly_amount_paise ?? selectedCollectionAccount?.monthly_amount_paise ?? 0)} />
              <MetricBox label="Next Installment" value={selectedCollectionAccount ? `${selectedCollectionAccount.installments_paid_count + 1}` : "-"} />
              <p className="border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">Confirmation uses masked customer data only. Government identifiers are never rendered in this panel.</p>
            </aside>
          </form>
        )}

        {activeTab === "ledger" && (
          <section className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 p-2">
              <input value={ledgerFilter} onChange={(event) => setLedgerFilter(event.target.value)} className="h-8 w-80 border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400" placeholder="Filter card, customer, phone" />
              <MetricBox label="Rows" value={String(ledgerRows.length)} />
            </div>
            <div className="min-h-0 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    {["Card #", "Customer Name", "Phone", "Target Months", "Total Deposited", "Status", "Actions"].map((heading) => (
                      <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((account) => {
                    const template = getAccountTemplate(account, templates);
                    const bonusPaise = calculateBonusPaise(account, template);

                    return (
                      <tr key={account.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                        <td className="px-2 py-2 font-mono">{account.card_number}</td>
                        <td className="px-2 py-2">{account.customer_name ?? "Masked Customer"}</td>
                        <td className="px-2 py-2 font-mono">{maskPhone(account.phone)}</td>
                        <td className="px-2 py-2 font-mono">{template?.duration_months ?? account.duration_months ?? "-"}</td>
                        <td className="px-2 py-2 font-mono">{formatIndianCurrency(account.total_paid_paise)}</td>
                        <td className={`px-2 py-2 font-semibold ${account.status === "MATURED" ? "text-emerald-300" : "text-slate-300"}`}>{account.status}</td>
                        <td className="px-2 py-2">
                          {account.status === "MATURED" ? (
                            <button type="button" onClick={() => convertToPosCredit(account)} className="h-8 bg-emerald-500 px-2 text-[11px] font-semibold uppercase text-slate-950">
                              Convert to POS Credit ({formatIndianCurrency(account.total_paid_paise + bonusPaise)})
                            </button>
                          ) : (
                            <span className="text-slate-500">Collect installments</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "reports" && (
          <section className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
            <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900 px-2 py-1.5">
              {(["statement", "overdue", "received", "maturity", "defaulters", "merge"] as ReportsSubTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setReportsSubTab(tab)}
                  className={`h-7 px-3 text-[11px] font-semibold uppercase ${
                    reportsSubTab === tab
                      ? "bg-cyan-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {tab === "statement" ? "Account Statement" : tab === "overdue" ? "Pending / Overdue" : tab === "received" ? "Received Summary" : tab === "maturity" ? "Maturity Tracker" : tab === "defaulters" ? "Defaulter Control" : "Merge Accounts"}
                </button>
              ))}
              {reportsLoading && <span className="ml-auto animate-pulse text-[10px] text-cyan-300">Loading…</span>}
            </div>

            <div className="min-h-0 overflow-auto p-3">
              {/* ── Statement Sub-Tab ── */}
              {reportsSubTab === "statement" && (
                <div className="grid gap-3">
                  <div className="flex items-end gap-2">
                    <Field label="Account ID">
                      <input
                        value={statementAccountId}
                        onChange={(e) => setStatementAccountId(e.target.value)}
                        className={controlClassName}
                        placeholder="e.g. 1"
                        inputMode="numeric"
                      />
                    </Field>
                    <button type="button" onClick={() => void loadStatement()} disabled={reportsLoading} className="h-8 bg-cyan-500 px-4 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Fetch Statement
                    </button>
                  </div>
                  {statementData && (
                    <div className="grid gap-3">
                      <div className="grid grid-cols-6 gap-2">
                        <MetricBox label="Card Number" value={statementData.account.card_number} />
                        <MetricBox label="Member" value={statementData.account.customer_name ?? "Masked"} />
                        <MetricBox label="Status" value={statementData.account.status} tone={statementData.account.status === "MATURED" ? "ok" : statementData.account.status === "DEFAULTER" ? "danger" : "neutral"} />
                        <MetricBox label="Total Paid" value={formatIndianCurrency(statementData.account.total_paid_paise)} tone="ok" />
                        <MetricBox label="Accrued Value" value={formatIndianCurrency(statementData.summary.accrued_value_paise)} tone="neutral" />
                        <MetricBox label="Maturity Value" value={formatIndianCurrency(statementData.summary.projected_maturity_value_paise)} tone="ok" />
                      </div>
                      {statementData.account.gold_weight_accumulated_mg != null && statementData.account.gold_weight_accumulated_mg > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          <MetricBox label="Gold Accumulated" value={`${(statementData.account.gold_weight_accumulated_mg / 1000).toFixed(3)} g`} tone="ok" />
                          <MetricBox label="Current Gold Value" value={formatIndianCurrency(statementData.summary.current_gold_value_paise)} />
                          <MetricBox label="Gold Rate (22K)" value={formatIndianCurrency(statementData.summary.current_gold_rate_paise) + "/g"} />
                        </div>
                      )}
                      <div className="border border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-900 text-slate-400">
                            <tr>
                              {["#", "Date", "Amount", "Mode", "Gold Rate", "Gold Credit"].map((h) => (
                                <th key={h} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {statementData.receipts.map((r) => (
                              <tr key={r.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                                <td className="px-2 py-1.5 font-mono">{r.installment_number}</td>
                                <td className="px-2 py-1.5 font-mono">{r.payment_date}</td>
                                <td className="px-2 py-1.5 font-mono">{formatIndianCurrency(r.amount_paid_paise)}</td>
                                <td className="px-2 py-1.5">{r.payment_mode}</td>
                                <td className="px-2 py-1.5 font-mono text-slate-400">{r.gold_rate_per_gram_paise ? formatIndianCurrency(r.gold_rate_per_gram_paise) + "/g" : "-"}</td>
                                <td className="px-2 py-1.5 font-mono text-slate-400">{r.gold_weight_credited_mg ? `${(r.gold_weight_credited_mg / 1000).toFixed(3)} g` : "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Pending / Overdue Sub-Tab ── */}
              {reportsSubTab === "overdue" && (
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void loadPendingReports()} disabled={reportsLoading} className="h-8 bg-cyan-500 px-4 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Refresh Overdue Ledger
                    </button>
                    <MetricBox label="Overdue Accounts" value={String(pendingReports.length)} tone={pendingReports.length > 0 ? "danger" : "ok"} />
                  </div>
                  {pendingReports.length > 0 && (
                    <div className="border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400">
                          <tr>
                            {["Card #", "Customer", "Phone", "Expected", "Paid", "Pending", "Pending Amount"].map((h) => (
                              <th key={h} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pendingReports.map((r) => (
                            <tr key={r.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                              <td className="px-2 py-1.5 font-mono">{r.card_number}</td>
                              <td className="px-2 py-1.5">{r.customer_name ?? "Masked"}</td>
                              <td className="px-2 py-1.5 font-mono">{maskPhone(r.phone)}</td>
                              <td className="px-2 py-1.5 font-mono">{r.expected_installments}</td>
                              <td className="px-2 py-1.5 font-mono">{r.installments_paid_count}</td>
                              <td className="px-2 py-1.5 font-mono text-red-300">{r.pending_installments_count}</td>
                              <td className="px-2 py-1.5 font-mono text-red-300">{formatIndianCurrency(r.pending_amount_paise)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Received Summary Sub-Tab ── */}
              {reportsSubTab === "received" && (
                <div className="grid gap-3">
                  <div className="flex items-end gap-2">
                    <Field label="Start Date">
                      <input type="date" value={receivedStartDate} onChange={(e) => setReceivedStartDate(e.target.value)} className={controlClassName} />
                    </Field>
                    <Field label="End Date">
                      <input type="date" value={receivedEndDate} onChange={(e) => setReceivedEndDate(e.target.value)} className={controlClassName} />
                    </Field>
                    <button type="button" onClick={() => void loadReceivedReports()} disabled={reportsLoading} className="h-8 bg-cyan-500 px-4 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Generate Report
                    </button>
                  </div>
                  {receivedSummary && (
                    <div className="grid grid-cols-4 gap-2">
                      <MetricBox label="Total Collected" value={formatIndianCurrency(receivedSummary.total_collected_paise)} tone="ok" />
                      <MetricBox label="Cash" value={formatIndianCurrency(receivedSummary.cash_paise)} />
                      <MetricBox label="UPI" value={formatIndianCurrency(receivedSummary.upi_paise)} />
                      <MetricBox label="Card" value={formatIndianCurrency(receivedSummary.card_paise)} />
                    </div>
                  )}
                  {receivedReceipts.length > 0 && (
                    <div className="border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400">
                          <tr>
                            {["Date", "Card #", "Customer", "Installment", "Amount", "Mode"].map((h) => (
                              <th key={h} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {receivedReceipts.map((r) => (
                            <tr key={r.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                              <td className="px-2 py-1.5 font-mono">{r.payment_date}</td>
                              <td className="px-2 py-1.5 font-mono">{r.card_number}</td>
                              <td className="px-2 py-1.5">{r.customer_name}</td>
                              <td className="px-2 py-1.5 font-mono">{r.installment_number}</td>
                              <td className="px-2 py-1.5 font-mono">{formatIndianCurrency(r.amount_paid_paise)}</td>
                              <td className="px-2 py-1.5">{r.payment_mode}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Maturity Tracker Sub-Tab ── */}
              {reportsSubTab === "maturity" && (
                <div className="grid gap-3">
                  <div className="flex items-end gap-2">
                    <Field label="Horizon (days)">
                      <input value={maturityDays} onChange={(e) => setMaturityDays(e.target.value)} className={controlClassName} inputMode="numeric" placeholder="30" />
                    </Field>
                    <button type="button" onClick={() => void loadMaturityReport()} disabled={reportsLoading} className="h-8 bg-cyan-500 px-4 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Scan Maturity
                    </button>
                    <MetricBox label="Results" value={String(maturityAccounts.length)} />
                  </div>
                  {maturityAccounts.length > 0 && (
                    <div className="border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400">
                          <tr>
                            {["Card #", "Customer", "Scheme", "Maturity Date", "Status", "Total Paid", "Bonus", "Maturity Value", "Action"].map((h) => (
                              <th key={h} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {maturityAccounts.map((acc) => (
                            <tr key={acc.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                              <td className="px-2 py-1.5 font-mono">{acc.card_number}</td>
                              <td className="px-2 py-1.5">{acc.customer_name ?? "Masked"}</td>
                              <td className="px-2 py-1.5">{acc.scheme_name ?? "-"}</td>
                              <td className="px-2 py-1.5 font-mono">{acc.maturity_date}</td>
                              <td className={`px-2 py-1.5 font-semibold ${acc.is_matured ? "text-emerald-300" : "text-amber-300"}`}>{acc.is_matured ? "MATURED" : "MATURING"}</td>
                              <td className="px-2 py-1.5 font-mono">{formatIndianCurrency(acc.total_paid_paise)}</td>
                              <td className="px-2 py-1.5 font-mono text-emerald-300">{formatIndianCurrency(acc.bonus_paise)}</td>
                              <td className="px-2 py-1.5 font-mono font-semibold text-emerald-300">{formatIndianCurrency(acc.maturity_value_paise)}</td>
                              <td className="px-2 py-1.5">
                                {acc.is_matured ? (
                                  <button type="button" onClick={() => convertToPosCredit(acc)} className="h-7 bg-emerald-500 px-2 text-[10px] font-semibold uppercase text-slate-950">
                                    POS Credit
                                  </button>
                                ) : (
                                  <span className="text-slate-500">Pending</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Defaulter Control Sub-Tab ── */}
              {reportsSubTab === "defaulters" && (
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void runDefaulterScan()} disabled={reportsLoading} className="h-8 bg-red-500 px-4 text-xs font-semibold uppercase text-white disabled:bg-slate-700 disabled:text-slate-500">
                      Run Defaulter Scan
                    </button>
                    <button type="button" onClick={() => void loadDefaulters()} disabled={reportsLoading} className="h-8 bg-cyan-500 px-4 text-xs font-semibold uppercase text-slate-950 disabled:bg-slate-700 disabled:text-slate-500">
                      Refresh List
                    </button>
                    <MetricBox label="Defaulters" value={String(defaulterAccounts.length)} tone={defaulterAccounts.length > 0 ? "danger" : "ok"} />
                  </div>
                  <p className="border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                    Accounts with 2+ months of unpaid installments are automatically flagged as DEFAULTER. This action is irreversible through this panel.
                  </p>
                  {defaulterAccounts.length > 0 && (
                    <div className="border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400">
                          <tr>
                            {["Card #", "Customer", "Phone", "Scheme", "Total Paid", "Installments Paid", "Monthly Due"].map((h) => (
                              <th key={h} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {defaulterAccounts.map((acc) => (
                            <tr key={acc.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                              <td className="px-2 py-1.5 font-mono">{acc.card_number}</td>
                              <td className="px-2 py-1.5">{acc.customer_name ?? "Masked"}</td>
                              <td className="px-2 py-1.5 font-mono">{maskPhone(acc.phone)}</td>
                              <td className="px-2 py-1.5">{acc.scheme_name ?? "-"}</td>
                              <td className="px-2 py-1.5 font-mono">{formatIndianCurrency(acc.total_paid_paise)}</td>
                              <td className="px-2 py-1.5 font-mono">{acc.installments_paid_count}</td>
                              <td className="px-2 py-1.5 font-mono">{formatIndianCurrency(acc.monthly_amount_paise ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {reportsSubTab === "merge" && (
                <div className="grid max-w-2xl gap-3">
                  <p className="border border-cyan-800/50 bg-cyan-950/30 px-3 py-2 text-[11px] text-cyan-200">
                    Merge two Gold Saving Scheme accounts that belong to the <strong>same customer</strong>. The source account's
                    payments and receipts move into the target; the source is marked MERGED. This cannot be undone.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                      Source account (will be merged away)
                      <select
                        value={mergeSourceId}
                        onChange={(e) => { setMergeSourceId(e.target.value); setMergeTargetId(""); }}
                        className="h-9 border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none focus:border-cyan-400 rounded"
                      >
                        <option value="">— Select source —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.card_number} · {a.customer_name ?? "Masked"}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                      Target account (keeps the balance)
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        disabled={!mergeSourceId}
                        className="h-9 border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none focus:border-cyan-400 rounded disabled:text-slate-600"
                      >
                        <option value="">— Select target —</option>
                        {accounts
                          .filter((a) => {
                            const source = accounts.find((s) => String(s.id) === mergeSourceId);
                            return source ? a.customer_id === source.customer_id && a.id !== source.id : false;
                          })
                          .map((a) => (
                            <option key={a.id} value={a.id}>{a.card_number} · {a.customer_name ?? "Masked"}</option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void mergeAccounts()}
                      disabled={merging || !mergeSourceId || !mergeTargetId}
                      className="h-9 bg-cyan-500 px-5 text-xs font-bold uppercase text-slate-950 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 rounded"
                    >
                      {merging ? "Merging…" : "Merge Accounts"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {receiptModal && (
        <div className="fixed inset-0 grid place-items-center bg-slate-950/80 p-4">
          <div className="w-[320px] border border-slate-700 bg-white p-3 text-slate-950">
            <div className="border-b border-slate-300 pb-2 text-center text-xs font-bold uppercase">GSS Thermal Receipt</div>
            <div className="grid gap-1 py-3 text-xs">
              <ReceiptLine label="Receipt" value={receiptModal.receiptNumber} />
              <ReceiptLine label="Card" value={receiptModal.account.card_number} />
              <ReceiptLine label="Member" value={receiptModal.account.customer_name ?? "Masked Customer"} />
              <ReceiptLine label="Phone" value={maskPhone(receiptModal.account.phone)} />
              <ReceiptLine label="Amount" value={formatIndianCurrency(receiptModal.amountPaise)} />
              <ReceiptLine label="Mode" value={receiptModal.paymentMode} />
              <ReceiptLine label="Date" value={getToday()} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => window.print()} className="h-8 border border-slate-500 text-xs font-semibold uppercase">Print</button>
              <button
                type="button"
                disabled={!receiptModal.receiptId}
                onClick={() => receiptModal.receiptId && window.open(withDocumentToken(`${apiBaseUrl}/api/documents/gss/receipt/${receiptModal.receiptId}`), "_blank", "noopener,noreferrer")}
                className="h-8 border border-blue-500 text-xs font-semibold uppercase text-blue-600 disabled:border-slate-300 disabled:text-slate-400"
              >
                PDF
              </button>
              <button type="button" onClick={() => setMessage(`WhatsApp confirmation queued for ${maskPhone(receiptModal.account.phone)}.`)} className="h-8 bg-emerald-500 text-xs font-semibold uppercase text-white">WhatsApp</button>
            </div>
            <button type="button" onClick={() => setReceiptModal(null)} className="mt-2 h-8 w-full border border-slate-300 text-xs font-semibold uppercase">Close</button>
          </div>
        </div>
      )}
    </section>
  );
}

function DurationTracker({ account, template }: { account: GssAccount | null; template: GssTemplate | null }) {
  const duration = template?.duration_months ?? account?.duration_months ?? 0;
  const paid = account?.installments_paid_count ?? 0;
  const percent = duration > 0 ? Math.min(100, Math.round((paid * 100) / duration)) : 0;

  return (
    <div className="border border-slate-800 bg-slate-900 p-3">
      <div className="mb-2 flex justify-between text-xs">
        <span className="font-semibold uppercase text-slate-400">Duration Tracker</span>
        <span className="font-mono text-white">Installment {paid} of {duration} Paid</span>
      </div>
      <div className="h-3 bg-slate-800">
        <div className="h-3 bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function calculateBonusPaise(account: GssAccount, template: GssTemplate | null) {
  const bonusRuleType = template?.bonus_rule_type ?? account.bonus_rule_type;
  const bonusValuePaise = template?.bonus_value_paise ?? account.bonus_value_paise ?? 0;

  if (bonusRuleType === "PERCENTAGE_OF_INSTALLMENT") {
    return Math.round((account.total_paid_paise * bonusValuePaise) / 10000);
  }

  return bonusValuePaise;
}

function getAccountTemplate(account: GssAccount | null, templates: GssTemplate[]) {
  if (!account) return null;
  return account.template ?? templates.find((template) => template.id === account.template_id) ?? null;
}

function matchesCustomerSearch(customer: CustomerOption, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return `${customer.name} ${customer.phone}`.toLowerCase().includes(needle);
}

function matchesAccountSearch(account: GssAccount, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return `${account.card_number} ${account.customer_name ?? ""} ${account.phone ?? ""}`.toLowerCase().includes(needle);
}

function calculateOverdueDays(account: GssAccount | null) {
  if (!account || account.status !== "ACTIVE") return 0;

  const expectedDue = new Date(`${account.enrollment_date}T00:00:00.000Z`);
  expectedDue.setUTCMonth(expectedDue.getUTCMonth() + account.installments_paid_count + 1);
  const today = new Date(`${getToday()}T00:00:00.000Z`);
  const deltaDays = Math.floor((today.getTime() - expectedDue.getTime()) / 86400000);

  return Math.max(deltaDays, 0);
}

function rupeesInputToPaise(value: string) {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);

  if (!match) return 0;

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

function formatPaiseInput(paise: number) {
  const rupees = Math.trunc(paise / 100);
  const coins = String(Math.abs(paise % 100)).padStart(2, "0");

  return `${rupees}.${coins}`;
}

function formatIndianCurrency(paise: number) {
  const sign = paise < 0 ? "-" : "";
  const absolute = Math.abs(paise);
  const rupees = Math.trunc(absolute / 100);
  const coins = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees.toLocaleString("en-IN")}.${coins}`;
}

function formatBonus(template: GssTemplate) {
  if (template.bonus_rule_type === "PERCENTAGE_OF_INSTALLMENT") {
    return `${formatPaiseInput(template.bonus_value_paise)}%`;
  }

  return formatIndianCurrency(template.bonus_value_paise);
}

function maskPhone(phone: string | null | undefined) {
  if (!phone || phone.length < 4) return "XXXX";
  return `${"X".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getFirstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400";
const dangerControlClassName =
  "h-8 w-full border border-red-500 bg-red-950/40 px-2 text-xs text-white outline-none focus:border-red-300";

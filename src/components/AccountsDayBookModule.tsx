import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";

type AccountsDayBookModuleProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "daybook" | "expenses" | "udhari" | "vouchers" | "ledger_reports" | "financials";

type FinancialsResponse = {
  from: string;
  to: string;
  pnl: {
    income_lines: { name: string; paise: number }[];
    expense_lines: { name: string; paise: number }[];
    income_paise: number;
    expense_paise: number;
    net_profit_paise: number;
  };
  balance_sheet: {
    assets: { name: string; paise: number }[];
    liabilities: { name: string; paise: number }[];
    total_assets_paise: number;
    total_liabilities_paise: number;
    retained_earnings_paise: number;
    opening_capital_paise: number;
    equity_paise: number;
    balanced_difference_paise: number;
  };
  trial_balance: {
    rows: { name: string; account_type: string; debit_paise: number; credit_paise: number }[];
    total_debit_paise: number;
    total_credit_paise: number;
    balanced: boolean;
  };
};

type DaybookEntry = {
  id: number;
  created_at: string | null;
  ledger_name: string | null;
  transaction_type: "DEBIT" | "CREDIT";
  amount_paise: number;
  reference_type: string;
  reference_id: number | null;
  reference_label?: string | null;
  description: string | null;
};

type DaybookResponse = {
  date: string;
  opening_balance_paise: number;
  total_receipts_paise: number;
  total_payments_paise: number;
  closing_balance_paise: number;
  entries: DaybookEntry[];
};

type ExpenseRow = {
  id: number;
  expense_date: string;
  category: string;
  description: string | null;
  amount_paise: number;
  amount_rupees?: string;
  payment_mode: "CASH" | "BANK";
};

type ExpensesResponse = {
  date: string;
  expenses: ExpenseRow[];
  total_paise: number;
  cash_total_paise: number;
  bank_total_paise: number;
};

type UdhariRow = {
  ledger_id: number;
  customer_id: number | null;
  customer_name: string | null;
  phone: string | null;
  balance_paise: number;
  last_transaction_date?: string | null;
  last_payment_date?: string | null;
};

type LedgerOption = {
  id: number;
  account_name: string;
  account_type: "CASH" | "BANK" | "CUSTOMER_UDHARI" | "VENDOR" | "TAX" | "GSS_LIABILITY";
};

type VoucherForm = {
  voucherType: "PAYMENT" | "RECEIPT" | "CONTRA" | "JOURNAL";
  ledgerId: string;
  counterLedgerId: string;
  amountRupees: string;
  amountPaise: number;
  narration: string;
  voucherDate: string;
};

type ExpenseForm = {
  expenseDate: string;
  category: string;
  description: string;
  amountRupees: string;
  paymentMode: "CASH" | "BANK";
};

type LedgerReportEntry = {
  id: number;
  created_at: string | null;
  transaction_type: "DEBIT" | "CREDIT";
  amount_paise: number;
  amount_rupees: string;
  reference_type: string;
  reference_id: number | null;
  reference_label?: string | null;
  description: string | null;
  running_balance_paise: number;
  running_balance_rupees: string;
  particulars: string;
};

type LedgerReportResponse = {
  ledger: {
    id: number;
    account_name: string;
    account_type: string;
    balance_paise: number;
    balance_rupees: string;
  };
  date_range: {
    from: string;
    to: string;
  };
  opening_balance_paise: number;
  opening_balance_rupees: string;
  total_debits_paise: number;
  total_debits_rupees: string;
  total_credits_paise: number;
  total_credits_rupees: string;
  closing_balance_paise: number;
  closing_balance_rupees: string;
  entries: LedgerReportEntry[];
  statement_share?: {
    customer_id: number;
    customer_name: string;
    phone: string;
    message_body: string;
    whatsapp_link: string;
  } | null;
};

const initialDaybook: DaybookResponse = {
  date: getToday(),
  opening_balance_paise: 0,
  total_receipts_paise: 0,
  total_payments_paise: 0,
  closing_balance_paise: 0,
  entries: []
};

const initialVoucher = (): VoucherForm => ({
  voucherType: "PAYMENT",
  ledgerId: "",
  counterLedgerId: "",
  amountRupees: "",
  amountPaise: 0,
  narration: "",
  voucherDate: getToday()
});

const initialExpense = (): ExpenseForm => ({
  expenseDate: getToday(),
  category: "Shop Maintenance",
  description: "",
  amountRupees: "",
  paymentMode: "CASH"
});

export default function AccountsDayBookModule({ apiBaseUrl = "" }: AccountsDayBookModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("daybook");
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [daybook, setDaybook] = useState<DaybookResponse>(initialDaybook);
  const [expenseDate, setExpenseDate] = useState(getToday());
  const [expenses, setExpenses] = useState<ExpensesResponse | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(initialExpense());
  const [udhari, setUdhari] = useState<UdhariRow[]>([]);
  const [ledgers, setLedgers] = useState<LedgerOption[]>([]);
  const [voucher, setVoucher] = useState<VoucherForm>(initialVoucher());
  const [message, setMessage] = useState("");
  const [lastVoucherPdfId, setLastVoucherPdfId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Ledger Report States
  const [reportLedgerId, setReportLedgerId] = useState("");
  const [reportFromDate, setReportFromDate] = useState(getFinancialYearStart());
  const [reportToDate, setReportToDate] = useState(getToday());
  const [reportData, setReportData] = useState<LedgerReportResponse | null>(null);
  // Customer quick-search inside the Ledger Statements tab
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState<{ customer_id: number; customer_name: string; phone: string; ledger_id: number | null; balance_rupees: string }[]>([]);
  const [customerDropOpen, setCustomerDropOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Financials (P&L / Balance Sheet / Trial Balance)
  const [finFromDate, setFinFromDate] = useState(getFinancialYearStart());
  const [finToDate, setFinToDate] = useState(getToday());
  const [financials, setFinancials] = useState<FinancialsResponse | null>(null);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    void loadDaybook(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (activeTab === "udhari") {
      void loadUdhari();
    }

    if (activeTab === "expenses") {
      void loadExpenses(expenseDate);
    }

    if (activeTab === "vouchers" || activeTab === "ledger_reports") {
      void loadLedgerOptions();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "expenses") {
      void loadExpenses(expenseDate);
    }
  }, [activeTab, expenseDate]);

  useEffect(() => {
    if (activeTab === "ledger_reports" && ledgers.length > 0 && !reportLedgerId) {
      setReportLedgerId(String(ledgers[0].id));
    }
  }, [activeTab, ledgers, reportLedgerId]);

  useEffect(() => {
    if (activeTab === "ledger_reports" && reportLedgerId) {
      void loadLedgerReport(reportLedgerId, reportFromDate, reportToDate);
    }
  }, [activeTab, reportLedgerId, reportFromDate, reportToDate]);

  useEffect(() => {
    if (activeTab === "financials") {
      void loadFinancials(finFromDate, finToDate);
    }
  }, [activeTab, finFromDate, finToDate]);

  // Debounced customer search for the Ledger tab quick-select
  useEffect(() => {
    if (!customerQuery.trim()) { setCustomerSuggestions([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/accounts/receipts/customers?search=${encodeURIComponent(customerQuery)}`, { headers: authHeaders });
        const result = (await res.json().catch(() => null)) as { customers?: typeof customerSuggestions } | null;
        setCustomerSuggestions(res.ok && result?.customers ? result.customers : []);
      } catch { setCustomerSuggestions([]); }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [customerQuery, apiBaseUrl, authHeaders]);

  const totalUdhariPaise = useMemo(
    () => udhari.reduce((total, row) => total + row.balance_paise, 0),
    [udhari]
  );

  async function loadDaybook(date: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/daybook?date=${encodeURIComponent(date)}`, {
        headers: authHeaders
      });
      const result = (await response.json().catch(() => null)) as DaybookResponse | { errors?: string[] } | null;

      if (!response.ok || !isDaybookResponse(result)) {
        throw new Error(getErrorMessage(result, "Could not load day book."));
      }

      setDaybook(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load day book.");
    }
  }

  async function loadUdhari() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/udhari`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { udhari?: UdhariRow[]; errors?: string[] } | null;

      if (!response.ok || !result?.udhari) {
        throw new Error(result?.errors?.join(" ") || "Could not load Udhari ledger.");
      }

      setUdhari(result.udhari);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Udhari ledger.");
    }
  }

  async function loadExpenses(date: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/expenses?date=${encodeURIComponent(date)}`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as ExpensesResponse | { errors?: string[] } | null;

      if (!response.ok || !result || "errors" in result) {
        throw new Error(getErrorMessage(result, "Could not load expenses."));
      }

      setExpenses(result as ExpensesResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load expenses.");
      setExpenses(null);
    }
  }

  async function loadLedgerOptions() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/ledgers`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { ledgers?: LedgerOption[] } | null;

      setLedgers(response.ok && result?.ledgers ? result.ledgers : []);
    } catch {
      setLedgers([]);
    }
  }

  async function loadLedgerReport(ledgerId: string, fromDate: string, toDate: string) {
    if (!ledgerId) return;
    setError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/accounts/ledger-report?ledger_id=${ledgerId}&from_date=${fromDate}&to_date=${toDate}`,
        { headers: authHeaders }
      );
      const result = (await response.json().catch(() => null)) as LedgerReportResponse | { errors?: string[] } | null;

      if (!response.ok || !result || "errors" in result) {
        throw new Error(getErrorMessage(result, "Could not load ledger report."));
      }

      setReportData(result as LedgerReportResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load ledger report.");
      setReportData(null);
    }
  }

  async function loadFinancials(fromDate: string, toDate: string) {
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/financials?from=${fromDate}&to=${toDate}`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as FinancialsResponse | { errors?: string[] } | null;
      if (!response.ok || !result || "errors" in result) {
        throw new Error(getErrorMessage(result, "Could not load financials."));
      }
      setFinancials(result as FinancialsResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load financials.");
      setFinancials(null);
    }
  }

  function viewCustomerStatement(ledgerId: number) {
    setReportLedgerId(String(ledgerId));
    setActiveTab("ledger_reports");
    void loadLedgerOptions();
  }

  async function downloadStatementPDF() {
    if (!reportLedgerId) return;
    setDownloadingPdf(true);
    setError("");
    try {
      const url = `${apiBaseUrl}/api/accounts/ledger-report/pdf?ledger_id=${reportLedgerId}&from_date=${reportFromDate}&to_date=${reportToDate}`;
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) throw new Error("Could not generate PDF.");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "statement.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not download PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function saveVoucher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!voucher.ledgerId || !voucher.counterLedgerId || voucher.amountPaise <= 0) {
      setError("Ledger, counter ledger, and positive amount are required.");
      return;
    }

    if (voucher.ledgerId === voucher.counterLedgerId) {
      setError("Debit and Credit ledgers must be different.");
      return;
    }

    let debitLedgerId: number;
    let creditLedgerId: number;

    if (voucher.voucherType === "RECEIPT") {
      debitLedgerId = Number(voucher.ledgerId);
      creditLedgerId = Number(voucher.counterLedgerId);
    } else if (voucher.voucherType === "PAYMENT") {
      debitLedgerId = Number(voucher.counterLedgerId);
      creditLedgerId = Number(voucher.ledgerId);
    } else { // CONTRA or JOURNAL
      debitLedgerId = Number(voucher.ledgerId);
      creditLedgerId = Number(voucher.counterLedgerId);
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/vouchers`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          debit_ledger_id: debitLedgerId,
          credit_ledger_id: creditLedgerId,
          amount_paise: voucher.amountPaise,
          reference_type: "MANUAL",
          description: voucher.narration.trim() || null,
          created_at: voucher.voucherDate
        })
      });
      const result = (await response.json().catch(() => null)) as { voucher?: { id?: number }; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not save voucher.");
      }

      setMessage("Voucher saved successfully.");
      setLastVoucherPdfId(typeof result?.voucher?.id === "number" ? result.voucher.id : null);
      setVoucher(initialVoucher());
      void loadDaybook(selectedDate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save voucher.");
    }
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const amountPaise = rupeesInputToPaise(expenseForm.amountRupees);
    if (!expenseForm.category.trim() || amountPaise <= 0) {
      setError("Expense category and positive amount are required.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/expenses`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_date: expenseForm.expenseDate,
          category: expenseForm.category.trim(),
          description: expenseForm.description.trim() || null,
          amount_paise: amountPaise,
          payment_mode: expenseForm.paymentMode
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(getErrorMessage(result, "Could not save expense."));
      }

      setMessage("Expense saved and posted to the day book.");
      setExpenseDate(expenseForm.expenseDate);
      setExpenseForm((current) => ({ ...initialExpense(), expenseDate: current.expenseDate }));
      void loadExpenses(expenseForm.expenseDate);
      void loadDaybook(selectedDate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save expense.");
    }
  }

  async function sendReminder(row: UdhariRow) {
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/udhari/${row.ledger_id}/remind`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" }
      });
      const result = (await response.json().catch(() => null)) as { status?: string; whatsapp_link?: string; errors?: string[] } | null;
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not send reminder.");
      }
      // Open WhatsApp with the prefilled dues message so it actually sends.
      if (result?.whatsapp_link) {
        window.open(result.whatsapp_link, "_blank", "noopener");
      }
      setMessage(result?.status === "SENT"
        ? `Dues reminder ready for ${row.customer_name ?? "customer"} (${maskPhone(row.phone)}) — WhatsApp opened.`
        : `Reminder logged but phone invalid (status: ${result?.status ?? "FAILED"}).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send reminder.");
    }
  }

  function exportToCSV() {
    if (!reportData) return;

    const headers = ["Date", "Particulars", "Reference Type", "Reference No", "Debit (Rs)", "Credit (Rs)", "Running Balance (Rs)", "Narration"];
    const rows = reportData.entries.map((entry) => [
      entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "-",
      entry.particulars,
      entry.reference_type,
      entry.reference_label ?? entry.reference_id ?? "-",
      entry.transaction_type === "DEBIT" ? (entry.amount_paise / 100).toFixed(2) : "0.00",
      entry.transaction_type === "CREDIT" ? (entry.amount_paise / 100).toFixed(2) : "0.00",
      (entry.running_balance_paise / 100).toFixed(2),
      entry.description ?? "-"
    ]);

    const csvContent = [
      [`Ledger Statement: ${reportData.ledger.account_name}`],
      [`Period: ${reportData.date_range.from} to ${reportData.date_range.to}`],
      [],
      ["Opening Balance", "", "", "", "", "", (reportData.opening_balance_paise / 100).toFixed(2), ""],
      headers,
      ...rows,
      ["Closing Balance", "", "", "", "", "", (reportData.closing_balance_paise / 100).toFixed(2), ""]
    ]
      .map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Ledger_Report_${reportData.ledger.account_name}_${reportData.date_range.from}_to_${reportData.date_range.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function exportTally() {
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/accounts/export/tally`, { headers: authHeaders });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((data && data.errors?.join(" ")) || "Tally export failed.");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tally-export-${getToday()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("Tally voucher export downloaded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tally export failed.");
    }
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Accounts & Bookkeeping</h1>
          <p className="text-xs text-slate-400">Cash, bank, debtors, double-entry vouchers, ledger statements</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void exportTally()}
            title="Download accounting vouchers as Tally JSON"
            className="h-7 border border-slate-600 px-2.5 text-[11px] font-semibold uppercase text-slate-200 hover:border-emerald-400 hover:text-emerald-300 rounded"
          >
            Export Tally
          </button>
          <nav className="flex border border-slate-700 text-xs">
            <TabButton active={activeTab === "daybook"} onClick={() => setActiveTab("daybook")}>Daily Day Book (Rokad / रोकड)</TabButton>
            <TabButton active={activeTab === "expenses"} onClick={() => setActiveTab("expenses")}>Expenses (Kharch / खर्च)</TabButton>
            <TabButton active={activeTab === "udhari"} onClick={() => setActiveTab("udhari")}>Udhari (Debtors) Ledger</TabButton>
            <TabButton active={activeTab === "vouchers"} onClick={() => setActiveTab("vouchers")}>Manual Vouchers</TabButton>
            <TabButton active={activeTab === "ledger_reports"} onClick={() => setActiveTab("ledger_reports")}>Ledger Statements (Khatauni / खतावणी)</TabButton>
            <TabButton active={activeTab === "financials"} onClick={() => setActiveTab("financials")}>Financials (P&amp;L / Balance Sheet)</TabButton>
          </nav>
        </div>
      </header>

      <main className="min-h-0 overflow-hidden">
        {(message || error) && (
          <div className={`flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/40 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
            <span>{error || message}</span>
            {!error && lastVoucherPdfId !== null && (
              <button
                type="button"
                onClick={() => window.open(withDocumentToken(`${apiBaseUrl}/api/documents/voucher/${lastVoucherPdfId}`), "_blank", "noopener,noreferrer")}
                className="rounded border border-blue-400 px-2 py-0.5 text-[11px] font-bold uppercase text-blue-200 hover:bg-blue-950/40"
              >
                Print Voucher
              </button>
            )}
          </div>
        )}

        {activeTab === "daybook" && (
          <DaybookView
            date={selectedDate}
            setDate={setSelectedDate}
            daybook={daybook}
          />
        )}

        {activeTab === "udhari" && (
          <UdhariView
            rows={udhari}
            totalOutstandingPaise={totalUdhariPaise}
            onSendReminder={sendReminder}
            onViewStatement={(row) => { if (row.ledger_id) viewCustomerStatement(row.ledger_id); }}
          />
        )}

        {activeTab === "expenses" && (
          <ExpensesView
            date={expenseDate}
            setDate={setExpenseDate}
            expenses={expenses}
            form={expenseForm}
            setForm={setExpenseForm}
            onSubmit={saveExpense}
          />
        )}

        {activeTab === "vouchers" && (
          <VoucherView
            voucher={voucher}
            setVoucher={setVoucher}
            ledgers={ledgers}
            onSubmit={saveVoucher}
          />
        )}

        {activeTab === "ledger_reports" && (
          <LedgerReportView
            reportLedgerId={reportLedgerId}
            setReportLedgerId={(id) => { setReportLedgerId(id); setCustomerQuery(""); }}
            reportFromDate={reportFromDate}
            setReportFromDate={setReportFromDate}
            reportToDate={reportToDate}
            setReportToDate={setReportToDate}
            reportData={reportData}
            ledgers={ledgers}
            customerQuery={customerQuery}
            setCustomerQuery={setCustomerQuery}
            customerSuggestions={customerSuggestions}
            customerDropOpen={customerDropOpen}
            setCustomerDropOpen={setCustomerDropOpen}
            onSelectCustomer={(suggestion) => {
              if (suggestion.ledger_id) {
                setReportLedgerId(String(suggestion.ledger_id));
                setCustomerQuery(suggestion.customer_name);
                setCustomerDropOpen(false);
              }
            }}
            onExportCSV={exportToCSV}
            onPrint={() => window.print()}
            onDownloadPDF={downloadStatementPDF}
            downloadingPdf={downloadingPdf}
            onSendStatement={() => {
              if (reportData?.statement_share?.whatsapp_link) {
                window.open(reportData.statement_share.whatsapp_link, "_blank", "noopener");
                setMessage(`Statement ready for ${reportData.statement_share.customer_name} (${maskPhone(reportData.statement_share.phone)}) — WhatsApp opened.`);
              }
            }}
          />
        )}

        {activeTab === "financials" && (
          <FinancialsView
            fromDate={finFromDate}
            setFromDate={setFinFromDate}
            toDate={finToDate}
            setToDate={setFinToDate}
            data={financials}
            onPrint={() => window.print()}
          />
        )}
      </main>
    </section>
  );
}

function DaybookView({
  date,
  setDate,
  daybook
}: {
  date: string;
  setDate: (date: string) => void;
  daybook: DaybookResponse;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr]">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <label className="text-xs font-semibold uppercase text-slate-400">Date</label>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={controlClassName} />
      </div>
      <div className="grid grid-cols-4 border-b border-slate-800">
        <MetricBox label="Opening Balance" value={formatPaise(daybook.opening_balance_paise)} />
        <MetricBox label="Total Receipts" value={`+${formatPaise(daybook.total_receipts_paise)}`} tone="receipt" />
        <MetricBox label="Total Payments" value={`-${formatPaise(daybook.total_payments_paise)}`} tone="payment" />
        <MetricBox label="Closing Balance" value={formatPaise(daybook.closing_balance_paise)} />
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-900 text-slate-400">
            <tr>
              {["Timestamp", "Account Name", "Type", "Amount", "Reference", "Narration"].map((heading) => (
                <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {daybook.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                <td className="px-2 py-2 font-mono text-slate-400">{formatTimestamp(entry.created_at)}</td>
                <td className="px-2 py-2">{entry.ledger_name ?? "Unknown Ledger"}</td>
                <td className={`px-2 py-2 font-semibold ${entry.transaction_type === "DEBIT" ? "text-emerald-300" : "text-red-300"}`}>{entry.transaction_type}</td>
                <td className="px-2 py-2 font-mono">{formatPaise(entry.amount_paise)}</td>
                <td className="px-2 py-2 font-mono">{entry.reference_label ?? `${entry.reference_type}${entry.reference_id ? ` #${entry.reference_id}` : ""}`}</td>
                <td className="px-2 py-2 text-slate-300">{entry.description ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UdhariView({
  rows,
  totalOutstandingPaise,
  onSendReminder,
  onViewStatement
}: {
  rows: UdhariRow[];
  totalOutstandingPaise: number;
  onSendReminder: (row: UdhariRow) => void;
  onViewStatement: (row: UdhariRow) => void;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <div className="grid grid-cols-3 border-b border-slate-800">
        <MetricBox label="Total Outstanding Credit" value={formatPaise(totalOutstandingPaise)} tone="payment" />
        <MetricBox label="Debtor Count" value={String(rows.length)} />
        <MetricBox label="Contact" value="Visible (Admin)" />
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-900 text-slate-400">
            <tr>
              {["Customer Name", "Phone", "Total Dues", "Last Payment Date", "Aging Bracket", "Actions"].map((heading) => (
                <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ledger_id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                <td className="px-2 py-2 font-medium text-slate-100">{row.customer_name ?? "Masked Customer"}</td>
                <td className="px-2 py-2 font-mono">
                  {row.phone ? (
                    <a href={`tel:${row.phone}`} className="text-sky-300 underline-offset-2 hover:underline" title="Call customer">{row.phone}</a>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 font-mono font-semibold text-red-300">{formatPaise(row.balance_paise)}</td>
                <td className="px-2 py-2 font-mono text-slate-400">{row.last_transaction_date ?? row.last_payment_date ?? "Not recorded"}</td>
                <td className="px-2 py-2">{getAgingBracket(row.last_transaction_date ?? row.last_payment_date)}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewStatement(row)}
                      disabled={!row.ledger_id}
                      className="h-7 border border-sky-700/60 bg-sky-950/30 px-2 text-[11px] font-semibold uppercase text-sky-300 hover:border-sky-400 hover:bg-sky-950/60 disabled:opacity-40"
                    >
                      View Statement
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendReminder(row)}
                      className="h-7 border border-slate-700 px-2 text-[11px] font-semibold uppercase hover:border-emerald-400"
                    >
                      Send Reminder
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpensesView({
  date,
  setDate,
  expenses,
  form,
  setForm,
  onSubmit
}: {
  date: string;
  setDate: (date: string) => void;
  expenses: ExpensesResponse | null;
  form: ExpenseForm;
  setForm: (form: ExpenseForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid h-full grid-cols-[360px_1fr] overflow-hidden">
      <form onSubmit={onSubmit} className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-50">Kharch Master</h2>
          <p className="text-xs text-slate-400">Daily cash and bank outflows for final till matching</p>
        </div>
        <Field label="Expense Date">
          <input
            type="date"
            value={form.expenseDate}
            onChange={(event) => setForm({ ...form, expenseDate: event.target.value })}
            className={wideControlClassName}
          />
        </Field>
        <Field label="Category">
          <select
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            className={wideControlClassName}
          >
            <option>Shop Maintenance</option>
            <option>Electricity Bill</option>
            <option>Staff Refreshments</option>
            <option>Courier</option>
            <option>Rent</option>
            <option>Miscellaneous</option>
          </select>
        </Field>
        <Field label="Amount (Rs)">
          <input
            value={form.amountRupees}
            onChange={(event) => setForm({ ...form, amountRupees: event.target.value.replace(/[^\d.]/g, "") })}
            inputMode="decimal"
            className={wideControlClassName}
          />
        </Field>
        <Field label="Paid From">
          <select
            value={form.paymentMode}
            onChange={(event) => setForm({ ...form, paymentMode: event.target.value as ExpenseForm["paymentMode"] })}
            className={wideControlClassName}
          >
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
          </select>
        </Field>
        <Field label="Narration">
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            className={`${wideControlClassName} min-h-20 py-2`}
          />
        </Field>
        <button type="submit" className="h-9 bg-emerald-500 px-4 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-400">
          Save Expense
        </button>
      </form>

      <div className="grid min-h-0 grid-rows-[auto_auto_1fr] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
          <label className="text-xs font-semibold uppercase text-slate-400">View Date</label>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={controlClassName} />
        </div>
        <div className="grid grid-cols-3 border-b border-slate-800">
          <MetricBox label="Total Kharch" value={formatPaise(expenses?.total_paise ?? 0)} tone="payment" />
          <MetricBox label="Cash Outflow" value={formatPaise(expenses?.cash_total_paise ?? 0)} tone="payment" />
          <MetricBox label="Bank Outflow" value={formatPaise(expenses?.bank_total_paise ?? 0)} />
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                {["Category", "Narration", "Mode", "Amount"].map((heading) => (
                  <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(expenses?.expenses ?? []).map((expense) => (
                <tr key={expense.id} className="border-b border-slate-900 transition-colors hover:bg-slate-900/50">
                  <td className="px-2 py-2 font-semibold text-slate-100">{expense.category}</td>
                  <td className="px-2 py-2 text-slate-300">{expense.description ?? "-"}</td>
                  <td className="px-2 py-2 font-mono text-slate-300">{expense.payment_mode}</td>
                  <td className="px-2 py-2 font-mono font-semibold text-red-300">{formatPaise(expense.amount_paise)}</td>
                </tr>
              ))}
              {(expenses?.expenses ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No expenses recorded for this date.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VoucherView({
  voucher,
  setVoucher,
  ledgers,
  onSubmit
}: {
  voucher: VoucherForm;
  setVoucher: (voucher: VoucherForm) => void;
  ledgers: LedgerOption[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const cashBankLedgers = ledgers.filter((ledger) => ledger.account_type === "CASH" || ledger.account_type === "BANK");
  const counterLedgers = ledgers.filter((ledger) => ledger.account_type !== "CASH" && ledger.account_type !== "BANK");

  const { firstLedgerOptions, secondLedgerOptions, firstLabel, secondLabel } = useMemo(() => {
    switch (voucher.voucherType) {
      case "RECEIPT":
        return {
          firstLedgerOptions: cashBankLedgers,
          secondLedgerOptions: counterLedgers,
          firstLabel: "Debit (Cash/Bank) Ledger",
          secondLabel: "Credit (Counter) Ledger"
        };
      case "PAYMENT":
        return {
          firstLedgerOptions: cashBankLedgers,
          secondLedgerOptions: counterLedgers,
          firstLabel: "Credit (Cash/Bank) Ledger",
          secondLabel: "Debit (Counter) Ledger"
        };
      case "CONTRA":
        return {
          firstLedgerOptions: cashBankLedgers,
          secondLedgerOptions: cashBankLedgers,
          firstLabel: "Debit (Destination Bank/Cash)",
          secondLabel: "Credit (Source Bank/Cash)"
        };
      case "JOURNAL":
        return {
          firstLedgerOptions: counterLedgers,
          secondLedgerOptions: counterLedgers,
          firstLabel: "Debit Ledger",
          secondLabel: "Credit Ledger"
        };
    }
  }, [voucher.voucherType, cashBankLedgers, counterLedgers]);

  return (
    <div className="grid h-full place-items-start p-3">
      <form onSubmit={onSubmit} className="grid w-full max-w-4xl gap-3 border border-slate-800 bg-slate-900 p-4 rounded-lg">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-50">Manual Voucher Entry</h2>
          <p className="text-xs text-slate-400 font-medium">Double-entry bookkeeping journal, payment, receipt, and contra options</p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          <Field label="Voucher Type">
            <select
              value={voucher.voucherType}
              onChange={(event) => setVoucher({
                ...voucher,
                voucherType: event.target.value as VoucherForm["voucherType"],
                ledgerId: "",
                counterLedgerId: ""
              })}
              className={wideControlClassName}
            >
              <option value="PAYMENT">Payment</option>
              <option value="RECEIPT">Receipt</option>
              <option value="CONTRA">Contra</option>
              <option value="JOURNAL">Journal</option>
            </select>
          </Field>
          <Field label={firstLabel}>
            <select value={voucher.ledgerId} onChange={(event) => setVoucher({ ...voucher, ledgerId: event.target.value })} className={wideControlClassName}>
              <option value="">Select</option>
              {firstLedgerOptions.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>
              ))}
            </select>
          </Field>
          <Field label={secondLabel}>
            <select value={voucher.counterLedgerId} onChange={(event) => setVoucher({ ...voucher, counterLedgerId: event.target.value })} className={wideControlClassName}>
              <option value="">Select</option>
              {secondLedgerOptions.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>{ledger.account_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Voucher Date">
            <input
              type="date"
              value={voucher.voucherDate}
              onChange={(event) => setVoucher({ ...voucher, voucherDate: event.target.value })}
              className={wideControlClassName}
            />
          </Field>
          <Field label="Amount (Rs)">
            <input
              value={voucher.amountRupees}
              onChange={(event) => {
                const amountRupees = event.target.value;
                setVoucher({
                  ...voucher,
                  amountRupees,
                  amountPaise: rupeesInputToPaise(amountRupees)
                });
              }}
              className={wideControlClassName}
              inputMode="decimal"
              placeholder="e.g. 1500.00"
            />
            <span className="font-mono text-[9px] text-slate-500">payload: {voucher.amountPaise} paise</span>
          </Field>
        </div>
        <Field label="Narration">
          <textarea value={voucher.narration} onChange={(event) => setVoucher({ ...voucher, narration: event.target.value })} className={`${wideControlClassName} min-h-20 py-2`} placeholder="Describe this transaction..." />
        </Field>
        <div className="flex justify-end pt-1">
          <button type="submit" className="h-9 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-50 font-bold px-4 rounded uppercase text-xs transition">
            Save Voucher
          </button>
        </div>
      </form>
    </div>
  );
}

function LedgerReportView({
  reportLedgerId,
  setReportLedgerId,
  reportFromDate,
  setReportFromDate,
  reportToDate,
  setReportToDate,
  reportData,
  ledgers,
  customerQuery,
  setCustomerQuery,
  customerSuggestions,
  customerDropOpen,
  setCustomerDropOpen,
  onSelectCustomer,
  onExportCSV,
  onPrint,
  onDownloadPDF,
  downloadingPdf,
  onSendStatement
}: {
  reportLedgerId: string;
  setReportLedgerId: (id: string) => void;
  reportFromDate: string;
  setReportFromDate: (date: string) => void;
  reportToDate: string;
  setReportToDate: (date: string) => void;
  reportData: LedgerReportResponse | null;
  ledgers: LedgerOption[];
  customerQuery: string;
  setCustomerQuery: (q: string) => void;
  customerSuggestions: { customer_id: number; customer_name: string; phone: string; ledger_id: number | null; balance_rupees: string }[];
  customerDropOpen: boolean;
  setCustomerDropOpen: (open: boolean) => void;
  onSelectCustomer: (s: { customer_id: number; customer_name: string; phone: string; ledger_id: number | null; balance_rupees: string }) => void;
  onExportCSV: () => void;
  onPrint: () => void;
  onDownloadPDF: () => void;
  downloadingPdf: boolean;
  onSendStatement: () => void;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr] min-h-0 overflow-hidden">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs">
        {/* Customer quick-search */}
        <div className="relative">
          <label className="mr-1 font-semibold uppercase text-slate-400">Customer:</label>
          <input
            value={customerQuery}
            onChange={(e) => { setCustomerQuery(e.target.value); setCustomerDropOpen(true); }}
            onFocus={() => setCustomerDropOpen(true)}
            onBlur={() => window.setTimeout(() => setCustomerDropOpen(false), 150)}
            placeholder="Search name or phone…"
            className="h-8 w-44 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-sky-400"
          />
          {customerDropOpen && customerSuggestions.length > 0 && (
            <ul className="absolute z-30 mt-0.5 max-h-52 w-64 overflow-auto border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
              {customerSuggestions.map((s) => (
                <li key={s.customer_id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onSelectCustomer(s); }}
                    disabled={!s.ledger_id}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs transition hover:bg-slate-800 disabled:opacity-40"
                  >
                    <span>
                      <span className="font-medium text-slate-100">{s.customer_name}</span>
                      <span className="text-slate-500"> · {s.phone || "—"}</span>
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-red-300">Rs {s.balance_rupees}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="text-slate-700">|</span>

        <label className="flex items-center gap-2 font-semibold uppercase text-slate-400">
          Ledger:
          <select
            value={reportLedgerId}
            onChange={(e) => setReportLedgerId(e.target.value)}
            className="h-8 max-w-[180px] border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400"
          >
            <option value="">— all ledgers —</option>
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.account_name} ({l.account_type})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 font-semibold uppercase text-slate-400">
          From:
          <input
            type="date"
            value={reportFromDate}
            onChange={(e) => setReportFromDate(e.target.value)}
            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400"
          />
        </label>

        <label className="flex items-center gap-2 font-semibold uppercase text-slate-400">
          To:
          <input
            type="date"
            value={reportToDate}
            onChange={(e) => setReportToDate(e.target.value)}
            className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400"
          />
        </label>

        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onExportCSV} disabled={!reportData}
            className="h-8 border border-slate-700 bg-slate-800 px-3 text-[10px] font-bold uppercase text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
            Export CSV
          </button>
          <button type="button" onClick={onPrint} disabled={!reportData}
            className="h-8 border border-slate-700 bg-slate-800 px-3 text-[10px] font-bold uppercase text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
            Print
          </button>
          <button type="button" onClick={onDownloadPDF} disabled={!reportData || downloadingPdf}
            className="h-8 bg-emerald-600 px-3 text-[10px] font-bold uppercase text-slate-50 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            {downloadingPdf ? "Generating…" : "Download PDF"}
          </button>
          <button type="button" onClick={onSendStatement} disabled={!reportData?.statement_share?.whatsapp_link}
            className="h-8 bg-sky-600 px-3 text-[10px] font-bold uppercase text-slate-50 hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50">
            WhatsApp Statement
          </button>
        </div>
      </div>

      {reportData ? (
        <>
          <div className="grid grid-cols-4 border-b border-slate-800">
            <MetricBox label="Opening Balance" value={formatPaise(reportData.opening_balance_paise)} />
            <MetricBox label="Total Debits" value={`+${formatPaise(reportData.total_debits_paise)}`} tone="receipt" />
            <MetricBox label="Total Credits" value={`-${formatPaise(reportData.total_credits_paise)}`} tone="payment" />
            <MetricBox label="Closing Balance" value={formatPaise(reportData.closing_balance_paise)} />
          </div>

          <div id="printable-ledger-report" className="min-h-0 overflow-auto bg-slate-950 p-4">
            <style dangerouslySetInnerHTML={{ __html: printStyles }} />
            <div className="hidden print:block mb-4 border-b border-slate-800 pb-3">
              <h2 className="text-xl font-bold uppercase text-slate-50">Ledger Statement</h2>
              <p className="text-sm text-slate-400 font-semibold">{reportData.ledger.account_name} ({reportData.ledger.account_type})</p>
              <p className="text-xs text-slate-500">Period: {reportData.date_range.from} to {reportData.date_range.to}</p>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2.5 font-semibold uppercase">Date</th>
                  <th className="px-3 py-2.5 font-semibold uppercase">Particulars</th>
                  <th className="px-3 py-2.5 font-semibold uppercase">Reference</th>
                  <th className="px-3 py-2.5 font-semibold uppercase text-right">Debit</th>
                  <th className="px-3 py-2.5 font-semibold uppercase text-right">Credit</th>
                  <th className="px-3 py-2.5 font-semibold uppercase text-right">Running Balance</th>
                  <th className="px-3 py-2.5 font-semibold uppercase">Narration</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-900/50 bg-slate-900/10 font-medium">
                  <td className="px-3 py-2 text-slate-500">-</td>
                  <td className="px-3 py-2 text-slate-300">Opening Balance</td>
                  <td className="px-3 py-2 text-slate-500">-</td>
                  <td className="px-3 py-2 text-right text-slate-500">-</td>
                  <td className="px-3 py-2 text-right text-slate-500">-</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${reportData.opening_balance_paise >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {formatPaise(reportData.opening_balance_paise)}
                  </td>
                  <td className="px-3 py-2 text-slate-500">-</td>
                </tr>

                {reportData.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-900 hover:bg-slate-900/20 transition">
                    <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                      {entry.created_at ? new Date(entry.created_at).toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" }) : "-"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-200">{entry.particulars}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">
                      {entry.reference_label ?? `${entry.reference_type} #${entry.reference_id}`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-400">
                      {entry.transaction_type === "DEBIT" ? formatPaise(entry.amount_paise) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-red-400">
                      {entry.transaction_type === "CREDIT" ? formatPaise(entry.amount_paise) : "-"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${entry.running_balance_paise >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {formatPaise(entry.running_balance_paise)}
                    </td>
                    <td className="px-3 py-2 text-slate-300 max-w-xs truncate font-medium" title={entry.description ?? ""}>
                      {entry.description ?? "-"}
                    </td>
                  </tr>
                ))}

                <tr className="border-t border-slate-800 bg-slate-900/20 font-bold">
                  <td className="px-3 py-2.5 text-slate-400">-</td>
                  <td className="px-3 py-2.5 text-slate-100">Totals / Closing Balance</td>
                  <td className="px-3 py-2.5 text-slate-400">-</td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-400">
                    {formatPaise(reportData.total_debits_paise)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-400">
                    {formatPaise(reportData.total_credits_paise)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${reportData.closing_balance_paise >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {formatPaise(reportData.closing_balance_paise)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center text-slate-500">
          <p className="text-sm uppercase tracking-wider font-semibold">Please select a ledger</p>
          <p className="text-xs text-slate-600 mt-1 font-medium">Select a ledger and choose date filters above to load statement details.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border-r border-slate-700 px-3 font-semibold uppercase last:border-r-0 ${active ? "bg-emerald-500 text-slate-50" : "bg-slate-950 text-slate-300"}`}
    >
      {children}
    </button>
  );
}

function MetricBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "receipt" | "payment" }) {
  const toneClassName = tone === "receipt" ? "text-emerald-300" : tone === "payment" ? "text-red-300" : "text-slate-50";

  return (
    <div className="border-r border-slate-800 bg-slate-950 px-3 py-2 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-lg font-semibold ${toneClassName}`}>{value}</div>
    </div>
  );
}

function formatPaise(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const rupees = Math.trunc(absolute / 100);
  const paise = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees}.${paise}`;
}

// Check if a returned object is a valid DaybookResponse structure
function isDaybookResponse(value: DaybookResponse | { errors?: string[] } | null): value is DaybookResponse {
  return Boolean(value && "opening_balance_paise" in value && "total_receipts_paise" in value && "entries" in value);
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "errors" in value && Array.isArray(value.errors)) {
    return value.errors.join(" ") || fallback;
  }

  return fallback;
}

function rupeesInputToPaise(value: string) {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

function getAgingBracket(lastPaymentDate: string | null | undefined) {
  if (!lastPaymentDate) {
    return "90+ days";
  }

  const days = Math.floor((Date.now() - new Date(lastPaymentDate).getTime()) / 86400000);

  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";

  return "90+ days";
}

function maskPhone(phone: string | null | undefined) {
  if (!phone || phone.length < 4) {
    return "XXXX";
  }

  return `${"X".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Indian financial year starts 1 April.
function getFinancialYearStart() {
  const d = new Date();
  const year = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-04-01`;
}

function FinancialsView({
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  data,
  onPrint
}: {
  fromDate: string;
  setFromDate: (value: string) => void;
  toDate: string;
  setToDate: (value: string) => void;
  data: FinancialsResponse | null;
  onPrint: () => void;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-800 bg-slate-900 p-2">
        <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400" />
        </label>
        <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400" />
        </label>
        <button type="button" onClick={onPrint} className="h-8 border border-slate-700 bg-slate-800 px-3 text-[11px] font-semibold uppercase hover:border-emerald-400">Print</button>
      </div>

      {!data ? (
        <div className="grid place-items-center text-xs text-slate-500">Loading financials…</div>
      ) : (
        <div className="min-h-0 overflow-auto p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Profit & Loss */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-300">Profit &amp; Loss ({data.from} → {data.to})</h3>
              <FinLine label="Income (Sales)" value={formatPaise(data.pnl.income_paise)} tone="pos" bold />
              {data.pnl.expense_lines.map((line) => (
                <FinLine key={line.name} label={`  ${line.name}`} value={formatPaise(line.paise)} tone="neg" muted />
              ))}
              <FinLine label="Total Expenses" value={formatPaise(data.pnl.expense_paise)} tone="neg" bold />
              <div className="my-1 border-t border-slate-700" />
              <FinLine label="Net Profit" value={formatPaise(data.pnl.net_profit_paise)} tone={data.pnl.net_profit_paise >= 0 ? "pos" : "neg"} bold />
            </div>

            {/* Trial Balance */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-300">Trial Balance (as of {data.to})</h3>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Ledger</span>
                <span className="text-right text-[10px] font-semibold uppercase text-slate-500">Debit</span>
                <span className="text-right text-[10px] font-semibold uppercase text-slate-500">Credit</span>
                {data.trial_balance.rows.map((row) => (
                  <FinTbRow key={row.name} name={row.name} debit={row.debit_paise} credit={row.credit_paise} />
                ))}
                <span className="mt-1 border-t border-slate-700 pt-1 font-bold text-slate-50">Total</span>
                <span className="mt-1 border-t border-slate-700 pt-1 text-right font-mono font-bold text-slate-50">{formatPaise(data.trial_balance.total_debit_paise)}</span>
                <span className="mt-1 border-t border-slate-700 pt-1 text-right font-mono font-bold text-slate-50">{formatPaise(data.trial_balance.total_credit_paise)}</span>
              </div>
              <p className={`mt-2 text-[11px] font-semibold ${data.trial_balance.balanced ? "text-emerald-300" : "text-red-300"}`}>
                {data.trial_balance.balanced ? "✓ Balanced" : "✗ Out of balance — check postings"}
              </p>
            </div>

            {/* Balance Sheet */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 lg:col-span-2">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-300">Balance Sheet (as of {data.to})</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Assets</p>
                  {data.balance_sheet.assets.map((line) => <FinLine key={line.name} label={line.name} value={formatPaise(line.paise)} />)}
                  <div className="my-1 border-t border-slate-700" />
                  <FinLine label="Total Assets" value={formatPaise(data.balance_sheet.total_assets_paise)} bold />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Liabilities &amp; Equity</p>
                  {data.balance_sheet.liabilities.map((line) => <FinLine key={line.name} label={line.name} value={formatPaise(line.paise)} tone="neg" />)}
                  <FinLine label="Opening Capital / Owner's Funds" value={formatPaise(data.balance_sheet.opening_capital_paise)} />
                  <FinLine label="Retained Earnings (P&L)" value={formatPaise(data.balance_sheet.retained_earnings_paise)} tone="pos" />
                  <div className="my-1 border-t border-slate-700" />
                  <FinLine label="Total Liabilities + Equity" value={formatPaise(data.balance_sheet.total_liabilities_paise + data.balance_sheet.equity_paise)} bold />
                </div>
              </div>
              <p className="mt-2 text-[11px] font-semibold text-emerald-300">✓ Balanced (Assets = Liabilities + Capital + Retained Earnings)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FinLine({ label, value, tone, bold, muted }: { label: string; value: string; tone?: "pos" | "neg"; bold?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className={`${bold ? "font-bold text-slate-50" : muted ? "text-slate-500" : "text-slate-300"} whitespace-pre`}>{label}</span>
      <span className={`font-mono ${bold ? "font-bold text-slate-50" : tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-slate-200"}`}>{value}</span>
    </div>
  );
}

function FinTbRow({ name, debit, credit }: { name: string; debit: number; credit: number }) {
  return (
    <>
      <span className="truncate text-slate-300">{name}</span>
      <span className="text-right font-mono text-slate-200">{debit ? formatPaise(debit) : "—"}</span>
      <span className="text-right font-mono text-slate-200">{credit ? formatPaise(credit) : "—"}</span>
    </>
  );
}

const printStyles = `
@media print {
  body * {
    visibility: hidden;
  }
  #printable-ledger-report, #printable-ledger-report * {
    visibility: visible;
  }
  #printable-ledger-report {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    background: white !important;
    color: black !important;
    padding: 0 !important;
  }
  #printable-ledger-report table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 15px;
  }
  #printable-ledger-report th, #printable-ledger-report td {
    border: 1px solid #ccc !important;
    padding: 8px !important;
    color: black !important;
    font-family: monospace;
    font-size: 11px;
  }
  #printable-ledger-report tr.font-bold td {
    font-weight: bold;
    background-color: #eee !important;
  }
  #printable-ledger-report h2 {
    color: black !important;
    font-size: 18px;
    margin-bottom: 2px;
  }
  #printable-ledger-report p {
    color: #444 !important;
    font-size: 12px;
    margin: 2px 0;
  }
}
`;

const controlClassName =
  "h-8 w-40 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded";
const wideControlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded";

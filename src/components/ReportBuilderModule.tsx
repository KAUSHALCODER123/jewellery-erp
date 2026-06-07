import { useEffect, useState, useMemo } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type ReportBuilderModuleProps = {
  apiBaseUrl?: string;
};

type DataSourceType = "invoices" | "items" | "girvi_loans" | "gss_accounts" | "journal_entries";

type ColumnDefinition = {
  key: string;
  label: string;
  type: "text" | "currency" | "weight" | "date" | "number" | "percentage";
};

const columnMap: Record<DataSourceType, ColumnDefinition[]> = {
  invoices: [
    { key: "invoice_number", label: "Invoice Number", type: "text" },
    { key: "customer_name", label: "Customer Name", type: "text" },
    { key: "customer_phone", label: "Customer Phone", type: "text" },
    { key: "total_amount_paise", label: "Total Amount", type: "currency" },
    { key: "gst_amount_paise", label: "GST Amount", type: "currency" },
    { key: "discount_paise", label: "Discount", type: "currency" },
    { key: "urd_deduction_paise", label: "URD Deduct", type: "currency" },
    { key: "payment_mode", label: "Payment Mode", type: "text" },
    { key: "invoice_type", label: "Type", type: "text" },
    { key: "created_at", label: "Date", type: "date" }
  ],
  items: [
    { key: "barcode", label: "Barcode", type: "text" },
    { key: "name", label: "Item Name", type: "text" },
    { key: "metal_type", label: "Metal", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "purity_karat", label: "Karat", type: "number" },
    { key: "gross_weight_mg", label: "Gross Weight", type: "weight" },
    { key: "net_weight_mg", label: "Net Weight", type: "weight" },
    { key: "stone_weight_mg", label: "Stone Weight", type: "weight" },
    { key: "purchase_rate_paise", label: "Purchase Rate", type: "currency" },
    { key: "selling_price_paise", label: "Selling Price", type: "currency" },
    { key: "status", label: "Status", type: "text" },
    { key: "created_at", label: "Created At", type: "date" }
  ],
  girvi_loans: [
    { key: "loan_number", label: "Loan Number", type: "text" },
    { key: "customer_name", label: "Borrower", type: "text" },
    { key: "customer_phone", label: "Phone", type: "text" },
    { key: "principal_amount_paise", label: "Principal", type: "currency" },
    { key: "interest_rate_percentage", label: "Interest Rate", type: "percentage" },
    { key: "interest_type", label: "Interest Type", type: "text" },
    { key: "rate_period", label: "Rate Period", type: "text" },
    { key: "issue_date", label: "Issue Date", type: "date" },
    { key: "next_due_date", label: "Due Date", type: "date" },
    { key: "status", label: "Status", type: "text" },
    { key: "total_repaid_paise", label: "Total Repaid", type: "currency" }
  ],
  gss_accounts: [
    { key: "card_number", label: "Card Number", type: "text" },
    { key: "customer_name", label: "Customer Name", type: "text" },
    { key: "customer_phone", label: "Phone", type: "text" },
    { key: "scheme_name", label: "Scheme Name", type: "text" },
    { key: "enrollment_date", label: "Enrollment Date", type: "date" },
    { key: "maturity_date", label: "Maturity Date", type: "date" },
    { key: "monthly_amount_paise", label: "Monthly installment", type: "currency" },
    { key: "total_paid_paise", label: "Total Paid", type: "currency" },
    { key: "installments_paid_count", label: "Paid Count", type: "number" },
    { key: "status", label: "Status", type: "text" }
  ],
  journal_entries: [
    { key: "created_at", label: "Transaction Date", type: "date" },
    { key: "ledger_name", label: "Ledger Account", type: "text" },
    { key: "account_type", label: "Ledger Type", type: "text" },
    { key: "transaction_type", label: "Type (Dr/Cr)", type: "text" },
    { key: "amount_paise", label: "Amount", type: "currency" },
    { key: "reference_type", label: "Reference Type", type: "text" },
    { key: "reference_id", label: "Reference ID", type: "number" },
    { key: "description", label: "Particulars", type: "text" }
  ]
};

export default function ReportBuilderModule({ apiBaseUrl = "" }: ReportBuilderModuleProps) {
  const { session } = useAuthSession();
  const [dataSource, setDataSource] = useState<DataSourceType>("invoices");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  
  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [metalType, setMetalType] = useState("ALL");
  const [category, setCategory] = useState("ALL");

  // Group By controls
  const [groupBy, setGroupBy] = useState("");
  const [aggregateField, setAggregateField] = useState("");

  // Results
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    totalCount: 0,
    sumAmountPaise: 0,
    sumWeightMg: 0,
    sumPrincipalPaise: 0,
    sumPaidPaise: 0
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${session?.token ?? ""}`,
    "Content-Type": "application/json"
  }), [session?.token]);

  // Set default columns when datasource changes
  useEffect(() => {
    const cols = columnMap[dataSource].map((c) => c.key);
    // Keep first 6 columns by default to avoid huge tables initially
    setSelectedColumns(cols.slice(0, 7));
    setGroupBy("");
    setAggregateField("");
    setStatus("ALL");
    setStartDate("");
    setEndDate("");
    setSearchQuery("");
  }, [dataSource]);

  // Available numeric columns for grouping aggregation
  const numericColumns = useMemo(() => {
    return columnMap[dataSource].filter(
      (c) => c.type === "currency" || c.type === "weight" || c.type === "number"
    );
  }, [dataSource]);

  async function executeQuery() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        dataSource,
        columns: groupBy ? [] : selectedColumns, // Let server filter columns if no group by
        filters: {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          searchQuery: searchQuery || undefined,
          status: status || undefined,
          metalType: dataSource === "items" ? metalType : undefined,
          category: dataSource === "items" ? category : undefined
        },
        groupBy: groupBy || undefined,
        aggregate: groupBy && aggregateField ? { field: aggregateField, type: "SUM" } : undefined
      };

      // Guard against a build that never returns: abort after 20s so the button can
      // never lock the page in "Calculating…" forever, and surface a clear message.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      let res: Response;
      try {
        res = await fetch(`${apiBaseUrl}/api/reports/builder/query`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeout);
      }
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.errors?.join(" ") || "Failed to execute builder query.");
      }

      setRows(data.rows || []);
      setSummary(data.summary || {
        totalCount: 0,
        sumAmountPaise: 0,
        sumWeightMg: 0,
        sumPrincipalPaise: 0,
        sumPaidPaise: 0
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setError(aborted ? "Report timed out — try narrowing the date range or filters." : (err instanceof Error ? err.message : "Error executing custom query."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function handleColumnToggle(colKey: string) {
    if (selectedColumns.includes(colKey)) {
      if (selectedColumns.length > 1) {
        setSelectedColumns(selectedColumns.filter((k) => k !== colKey));
      }
    } else {
      setSelectedColumns([...selectedColumns, colKey]);
    }
  }

  // Format Helper Functions
  function formatCell(val: any, colKey: string) {
    if (val === null || val === undefined) return "-";
    const def = columnMap[dataSource].find((c) => c.key === colKey);
    if (!def) return String(val);

    switch (def.type) {
      case "currency":
        return `₹${(Number(val) / 100).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;
      case "weight":
        return `${(Number(val) / 1000).toLocaleString("en-IN", {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3
        })} g`;
      case "date":
        return String(val).slice(0, 10);
      case "percentage":
        return `${val}%`;
      case "number":
      default:
        return String(val);
    }
  }

  // CSV-friendly value: currency in rupees, weight in grams (plain numbers, no symbols),
  // so Excel users see ₹/g amounts rather than raw paise/mg integers.
  function formatCsvValue(val: any, colKey: string) {
    if (val === null || val === undefined) return "";
    const def = columnMap[dataSource].find((c) => c.key === colKey);
    if (def?.type === "currency") return (Number(val) / 100).toFixed(2);
    if (def?.type === "weight") return (Number(val) / 1000).toFixed(3);
    if (def?.type === "date") return String(val).slice(0, 10);
    return String(val);
  }

  function exportCSV() {
    if (rows.length === 0) return;

    const quote = (v: any) => `"${String(v).replace(/"/g, '""')}"`;
    let csvContent = "";
    // If grouped
    if (groupBy) {
      const headers = ["Grouped By Value", "Record Count"];
      if (aggregateField) {
        headers.push(`Sum of ${aggregateField}`);
      }
      csvContent += headers.join(",") + "\n";

      for (const row of rows) {
        const line = [
          quote(row.group_value || ""),
          row.count
        ];
        if (aggregateField) {
          line.push(quote(formatCsvValue(row[aggregateField], aggregateField)));
        }
        csvContent += line.join(",") + "\n";
      }
    } else {
      // Headers
      const headers = selectedColumns.map((colKey) => {
        return columnMap[dataSource].find((c) => c.key === colKey)?.label || colKey;
      });
      csvContent += headers.join(",") + "\n";

      // Rows
      for (const row of rows) {
        const line = selectedColumns.map((colKey) => quote(formatCsvValue(row[colKey], colKey)));
        csvContent += line.join(",") + "\n";
      }
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `custom_${dataSource}_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100 print:bg-white print:text-black print:h-auto">
      {/* Header Panel */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 print:hidden">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Dynamic Report Builder & Pivot Studio</h1>
          <p className="text-xs text-slate-400">Extract custom transactions audits, inventory lists, and ledgers running sheets</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            disabled={rows.length === 0}
            className="h-8 px-3 bg-slate-800 text-[10px] uppercase font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            📥 Export CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={rows.length === 0}
            className="h-8 px-3 bg-slate-800 text-[10px] uppercase font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            🖨️ Print View
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="grid grid-cols-[300px_1fr] min-h-0 overflow-hidden print:grid-cols-1 print:overflow-visible">
        
        {/* Left config side panel */}
        <aside className="border-r border-slate-800 bg-slate-900/50 p-4 overflow-y-auto flex flex-col gap-4 print:hidden">
          
          {/* DataSource selection */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-slate-400">Data Source</label>
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value as DataSourceType)}
              className="h-9 border border-slate-800 bg-slate-950 px-2.5 text-xs text-slate-50 rounded outline-none focus:border-emerald-500"
            >
              <option value="invoices">Sales Invoices</option>
              <option value="items">Inventory Catalog</option>
              <option value="girvi_loans">Girvi Pawn Register</option>
              <option value="gss_accounts">Gold Schemes (GSS)</option>
              <option value="journal_entries">Double-Entry Journal</option>
            </select>
          </div>

          {/* Column selector (only if not grouping) */}
          {!groupBy && (
            <div className="flex flex-col gap-1.5 border-t border-slate-850 pt-3">
              <label className="text-[10px] uppercase font-bold text-slate-400">Select Columns</label>
              <div className="grid gap-1.5 max-h-36 overflow-y-auto border border-slate-800 bg-slate-950 p-2 rounded">
                {columnMap[dataSource].map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-xs cursor-pointer text-slate-300 hover:text-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(col.key)}
                      onChange={() => handleColumnToggle(col.key)}
                      className="accent-emerald-500 rounded border-slate-700"
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Grouping / Aggregation (Pivot controls) */}
          <div className="flex flex-col gap-2.5 border-t border-slate-850 pt-3 bg-emerald-950/5 p-2 rounded border border-emerald-950/20">
            <label className="text-[10px] uppercase font-bold text-emerald-400">Pivot & Summarize</label>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-slate-500 uppercase">Group Rows By</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
              >
                <option value="">-- No Grouping (Raw Rows) --</option>
                {columnMap[dataSource]
                  .filter((c) => c.key !== "id" && c.key !== "created_at" && c.key !== "invoice_number" && c.key !== "loan_number" && c.key !== "card_number")
                  .map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))
                }
              </select>
            </div>

            {groupBy && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-500 uppercase">Aggregate Sum Of</span>
                <select
                  value={aggregateField}
                  onChange={(e) => setAggregateField(e.target.value)}
                  className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
                >
                  <option value="">-- Count Only --</option>
                  {numericColumns.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Filters Form */}
          <div className="flex flex-col gap-2.5 border-t border-slate-850 pt-3">
            <label className="text-[10px] uppercase font-bold text-slate-400">Filters</label>
            
            {/* Start Date */}
            <div className="grid gap-1">
              <span className="text-[9px] text-slate-500 uppercase">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
              />
            </div>

            {/* End Date */}
            <div className="grid gap-1">
              <span className="text-[9px] text-slate-500 uppercase">End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
              />
            </div>

            {/* Text Search */}
            <div className="grid gap-1">
              <span className="text-[9px] text-slate-500 uppercase">Generic Keyword Search</span>
              <input
                type="text"
                placeholder="Search ID, customer, etc..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none placeholder:text-slate-600"
              />
            </div>

            {/* Status Dropdowns */}
            <div className="grid gap-1">
              <span className="text-[9px] text-slate-500 uppercase">Record Status / Type</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
              >
                <option value="ALL">All Statuses / Types</option>
                {dataSource === "invoices" && (
                  <>
                    <option value="SALE">Sales (SALE)</option>
                    <option value="PURCHASE">Purchases (PURCHASE)</option>
                  </>
                )}
                {dataSource === "items" && (
                  <>
                    <option value="IN_STOCK">In Stock</option>
                    <option value="SOLD">Sold</option>
                  </>
                )}
                {dataSource === "girvi_loans" && (
                  <>
                    <option value="ACTIVE">Active</option>
                    <option value="SETTLED">Settled</option>
                    <option value="DEFAULTED">Defaulted</option>
                  </>
                )}
                {dataSource === "gss_accounts" && (
                  <>
                    <option value="ACTIVE">Active</option>
                    <option value="MATURED">Matured</option>
                    <option value="CLOSED">Closed</option>
                  </>
                )}
                {dataSource === "journal_entries" && (
                  <>
                    <option value="DEBIT">Debit Leg (Dr)</option>
                    <option value="CREDIT">Credit Leg (Cr)</option>
                  </>
                )}
              </select>
            </div>

            {/* Items-specific Metal/Category */}
            {dataSource === "items" && (
              <>
                <div className="grid gap-1">
                  <span className="text-[9px] text-slate-500 uppercase">Metal Purity</span>
                  <select
                    value={metalType}
                    onChange={(e) => setMetalType(e.target.value)}
                    className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none"
                  >
                    <option value="ALL">All Metals</option>
                    <option value="Gold">Gold</option>
                    <option value="Silver">Silver</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <span className="text-[9px] text-slate-500 uppercase">Inventory Category</span>
                  <input
                    type="text"
                    placeholder="e.g. Ring, Chain..."
                    value={category === "ALL" ? "" : category}
                    onChange={(e) => setCategory(e.target.value || "ALL")}
                    className="h-8 border border-slate-800 bg-slate-950 px-2 text-xs text-slate-50 rounded outline-none placeholder:text-slate-600"
                  />
                </div>
              </>
            )}
          </div>

          {/* Query submission trigger */}
          <button
            onClick={executeQuery}
            disabled={loading}
            className="w-full h-10 bg-emerald-500 text-slate-50 text-xs font-bold uppercase hover:bg-emerald-600 active:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            {loading ? "Calculating..." : "🚀 Build Report"}
          </button>
        </aside>

        {/* Right Preview Panel */}
        <section className="grid grid-rows-[auto_1fr] overflow-hidden p-4 gap-4 print:p-0 print:overflow-visible print:block">
          
          {error && (
            <div className="px-3 py-2 bg-red-950/30 border border-red-900 rounded text-xs text-red-300 print:hidden">
              {error}
            </div>
          )}

          {/* KPI Dashboard Row calculated from the results */}
          {!groupBy && rows.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
              <div className="border border-slate-800 bg-slate-900/60 p-3 rounded">
                <div className="text-[9px] uppercase font-bold text-slate-500">Record Count</div>
                <div className="text-base font-bold text-slate-50 font-mono mt-1">{summary.totalCount}</div>
              </div>
              {summary.sumAmountPaise > 0 && (
                <div className="border border-slate-800 bg-slate-900/60 p-3 rounded">
                  <div className="text-[9px] uppercase font-bold text-slate-500">Total Money Valuation</div>
                  <div className="text-base font-bold text-emerald-400 font-mono mt-1">
                    ₹{(summary.sumAmountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}
                  </div>
                </div>
              )}
              {summary.sumWeightMg > 0 && (
                <div className="border border-slate-800 bg-slate-900/60 p-3 rounded">
                  <div className="text-[9px] uppercase font-bold text-slate-500">Aggregated Metal Weight</div>
                  <div className="text-base font-bold text-blue-400 font-mono mt-1">
                    {(summary.sumWeightMg / 1000).toLocaleString("en-IN", { minimumFractionDigits: 2 })} g
                  </div>
                </div>
              )}
              {summary.sumPrincipalPaise > 0 && (
                <div className="border border-slate-800 bg-slate-900/60 p-3 rounded">
                  <div className="text-[9px] uppercase font-bold text-slate-500">Total Principal Outstanding</div>
                  <div className="text-base font-bold text-amber-400 font-mono mt-1">
                    ₹{(summary.sumPrincipalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grid Preview Table */}
          <div className="min-h-0 overflow-auto border border-slate-800 bg-slate-950 rounded print:overflow-visible print:border-0 print:bg-white">
            {rows.length === 0 ? (
              <div className="h-64 grid place-items-center text-xs text-slate-500 italic print:hidden">
                No report data built. Adjust configuration in left panel and click "Build Report".
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse print:text-black">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[9px] sticky top-0 print:bg-slate-800 print:text-black">
                    {groupBy ? (
                      <>
                        <th className="p-3">Group Dimension ({groupBy.replace(/_/g, " ")})</th>
                        <th className="p-3 text-center">Row Count</th>
                        {aggregateField && (
                          <th className="p-3 text-right">Sum of {aggregateField.replace(/_/g, " ")}</th>
                        )}
                      </>
                    ) : (
                      selectedColumns.map((colKey) => {
                        const colDef = columnMap[dataSource].find((c) => c.key === colKey);
                        const isRightAligned = colDef?.type === "currency" || colDef?.type === "weight" || colDef?.type === "number";
                        return (
                          <th
                            key={colKey}
                            className={`p-3 ${isRightAligned ? "text-right" : ""}`}
                          >
                            {colDef?.label || colKey}
                          </th>
                        );
                      })
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 print:divide-slate-200">
                  {rows.map((row, idx) => (
                    <tr key={row.id || idx} className="hover:bg-slate-900/40 transition print:hover:bg-transparent">
                      {groupBy ? (
                        <>
                          <td className="p-3 font-semibold text-slate-50 print:text-black">
                            {row.group_value || "N/A"}
                          </td>
                          <td className="p-3 text-center font-mono text-slate-300 print:text-black">
                            {row.count}
                          </td>
                          {aggregateField && (
                            <td className="p-3 text-right font-mono font-bold text-emerald-400 print:text-black">
                              {formatCell(row[aggregateField], aggregateField)}
                            </td>
                          )}
                        </>
                      ) : (
                        selectedColumns.map((colKey) => {
                          const colDef = columnMap[dataSource].find((c) => c.key === colKey);
                          const isRightAligned = colDef?.type === "currency" || colDef?.type === "weight" || colDef?.type === "number";
                          return (
                            <td
                              key={colKey}
                              className={`p-3 font-sans ${isRightAligned ? "text-right font-mono" : "text-slate-300 print:text-black"} ${
                                colDef?.type === "currency" ? "text-emerald-400 print:text-black font-semibold" : ""
                              }`}
                            >
                              {formatCell(row[colKey], colKey)}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </section>
  );
}

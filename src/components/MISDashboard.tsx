import type { ComponentType } from "react";
import { useEffect, useState, useMemo } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { CountUp } from "./ui.js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import {
  TrendingUp,
  AlertTriangle,
  BadgeIndianRupee,
  Boxes,
  CircleDollarSign,
  Hammer,
  ShieldCheck,
  TrendingDown
} from "lucide-react";

type KPISummary = {
  total_gold_mg: number;
  total_market_value_paise: number;
  total_outstanding_udhari_paise: number;
  total_karigar_liability_mg: number;
  today_sales_paise: number;
};

type SalesTrendItem = {
  date: string;
  total_sales_paise: number;
  total_old_gold_received_paise: number;
};

type MarginItem = {
  category: string;
  total_sales_paise: number;
  total_purchase_cost_paise: number;
  realized_profit_paise: number;
  margin_percentage: number;
};

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444"];

export default function MISDashboard({ apiBaseUrl = "" }: { apiBaseUrl?: string }) {
  const { session } = useAuthSession();
  const [kpis, setKpis] = useState<KPISummary | null>(null);
  const [salesTrend, setSalesTrend] = useState<SalesTrendItem[]>([]);
  const [margins, setMargins] = useState<MarginItem[]>([]);
  
  const [dateRange, setDateRange] = useState<"last_30_days" | "this_year">("last_30_days");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${session?.token ?? ""}`
  }), [session?.token]);

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      setError("");
      try {
        const [kpiRes, trendRes, marginRes] = await Promise.all([
          fetch(`${apiBaseUrl}/api/reports/mis/kpi-summary`, { headers: authHeaders }),
          fetch(`${apiBaseUrl}/api/reports/mis/sales-trend?date_range=${dateRange}`, { headers: authHeaders }),
          fetch(`${apiBaseUrl}/api/reports/mis/true-margin`, { headers: authHeaders })
        ]);

        if (!kpiRes.ok || !trendRes.ok || !marginRes.ok) {
          throw new Error("One or more reports failed to load.");
        }

        const kpiData = await kpiRes.json();
        const trendData = await trendRes.json();
        const marginData = await marginRes.json();

        setKpis(kpiData);
        setSalesTrend(trendData.sales_trend || []);
        setMargins(marginData.margin_by_category || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to retrieve reporting metrics.");
      } finally {
        setLoading(false);
      }
    }

    if (session?.token) {
      void loadDashboardData();
    }
  }, [apiBaseUrl, authHeaders, dateRange, session?.token]);

  // Convert Paise to Rupees string formatted with commas
  const formatRupees = (paise: number) => {
    return `₹${(paise / 100).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0
    })}`;
  };

  // Convert Milligrams to Grams formatted string
  const formatGrams = (mg: number) => {
    return `${(mg / 1000).toLocaleString("en-IN", {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0
    })} g`;
  };

  // Prepares data for sales distribution pie chart using true margins category sales
  const pieChartData = useMemo(() => {
    return margins.map((m) => ({
      name: m.category,
      value: Math.round((m.total_sales_paise || 0) / 100)
    })).filter((d) => d.value > 0);
  }, [margins]);

  // Chart data for trend mapping
  const lineChartData = useMemo(() => {
    return salesTrend.map((t) => ({
      date: t.date,
      Sales: Math.round(t.total_sales_paise / 100),
      "Old Gold": Math.round(t.total_old_gold_received_paise / 100)
    }));
  }, [salesTrend]);

  if (loading) {
    return (
      <section className="grid min-h-full content-start gap-4 bg-slate-950 p-4">
        <div className="erp-skeleton h-10 w-72 rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="erp-skeleton h-24 rounded-lg" style={{ animationDelay: `${i * 80}ms` }} />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="erp-skeleton h-72 rounded-lg lg:col-span-8" />
          <div className="erp-skeleton h-72 rounded-lg lg:col-span-4" />
        </div>
        <div className="erp-skeleton h-48 rounded-lg" />
      </section>
    );
  }

  return (
    <section className="grid min-h-full content-start gap-4 bg-slate-950 p-4 text-slate-100">
      
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-base font-bold uppercase text-slate-50 tracking-wide">Executive Intelligence Center</h1>
          <p className="text-xs text-slate-500 mt-0.5">Real-time valuation, margins audit, and business diagnostics</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-semibold uppercase">Date range:</span>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            className="h-8 border border-slate-700 bg-slate-900 px-3 text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
          >
            <option value="last_30_days">Last 30 Days</option>
            <option value="this_year">This Year</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="animate-fade-in flex items-center gap-2.5 border border-red-900 bg-red-950/20 px-3 py-2.5 rounded text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Top Row: 4 KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Vault Value */}
          <KPICard
            title="Total Vault Value"
            value={kpis.total_market_value_paise}
            format={formatRupees}
            subtitle={`Weight: ${formatGrams(kpis.total_gold_mg)}`}
            icon={Boxes}
            tone="emerald"
            delayMs={0}
          />

          {/* Card 2: Today's Sales */}
          <KPICard
            title="Today's Sales"
            value={kpis.today_sales_paise}
            format={formatRupees}
            subtitle="Closed invoice checkouts"
            icon={BadgeIndianRupee}
            tone="blue"
            delayMs={60}
          />

          {/* Card 3: Outstanding Credit (Red Alert coding if > Rs. 50,000 / 5000000 paise) */}
          <KPICard
            title="Outstanding Credit (Udhari)"
            value={kpis.total_outstanding_udhari_paise}
            format={formatRupees}
            subtitle="Awaiting customer recovery"
            icon={CircleDollarSign}
            tone={kpis.total_outstanding_udhari_paise > 5000000 ? "red" : "amber"}
            alert={kpis.total_outstanding_udhari_paise > 5000000}
            delayMs={120}
          />

          {/* Card 4: Total Karigar Gold Pending */}
          <KPICard
            title="Karigar Gold Pending"
            value={kpis.total_karigar_liability_mg}
            format={formatGrams}
            subtitle="Job work liability in manufacturing"
            icon={Hammer}
            tone="violet"
            delayMs={180}
          />
        </div>
      )}

      {/* Middle Row: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left: 30-Day Sales Trend Line Chart */}
        <div className="animate-slide-up lg:col-span-8 border border-slate-800 bg-slate-900/60 p-4 rounded-lg flex flex-col gap-3" style={{ animationDelay: "220ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Sales Trend vs URD Old Gold Intake</h2>
          <div className="h-64 min-w-0">
            {lineChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 italic">
                No checkout sales recorded in this interval.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineChartData} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={9} />
                  <YAxis stroke="#64748b" fontSize={9} tickFormatter={(val) => `₹${val}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc", fontSize: 11 }}
                    formatter={(value) => [`₹${Number(value).toLocaleString()}`, ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
                  <Line type="monotone" dataKey="Sales" stroke="#10b981" strokeWidth={2} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="Old Gold" stroke="#3b82f6" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right: Pie Chart Category Share */}
        <div className="animate-slide-up lg:col-span-4 border border-slate-800 bg-slate-900/60 p-4 rounded-lg flex flex-col gap-3" style={{ animationDelay: "280ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Sales share by category</h2>
          <div className="h-64 flex items-center justify-center">
            {pieChartData.length === 0 ? (
              <div className="text-xs text-slate-500 italic">No category sales metrics available.</div>
            ) : (
              <div className="relative w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      cx="50%"
                      cy="48%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc", fontSize: 11 }}
                      formatter={(value) => [`₹${Number(value).toLocaleString()}`, "Amount"]}
                    />
                    <Legend wrapperStyle={{ fontSize: 9 }} align="center" verticalAlign="bottom" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: True Margin Table */}
      <div className="animate-slide-up border border-slate-800 bg-slate-900/60 p-4 rounded-lg flex flex-col gap-3" style={{ animationDelay: "340ms" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Profitable Inventory Categories (True Margin)</h2>
          <span className="text-[10px] uppercase font-bold text-slate-500 font-mono">Groups Invoice Lines joined with Item Purchases</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-950/60 text-slate-400 font-semibold uppercase text-[9px] sticky top-0">
              <tr>
                <th className="p-3 border-b border-slate-800">Category Name</th>
                <th className="p-3 border-b border-slate-800 text-right">Total Revenue</th>
                <th className="p-3 border-b border-slate-800 text-right">Total Cost</th>
                <th className="p-3 border-b border-slate-800 text-right">Realized Profit</th>
                <th className="p-3 border-b border-slate-800 text-center">Net Margin (%)</th>
              </tr>
            </thead>
            <tbody>
              {margins.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500 italic">No transaction records found matching items catalog costs.</td>
                </tr>
              ) : (
                margins
                  .sort((a, b) => b.margin_percentage - a.margin_percentage)
                  .map((m, idx) => (
                    <tr key={idx} className="animate-fade-in border-b border-slate-850 last:border-0 hover:bg-slate-900/40 transition" style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}>
                      <td className="p-3 font-semibold text-slate-200">{m.category}</td>
                      <td className="p-3 font-mono text-right text-slate-300">{formatRupees(m.total_sales_paise)}</td>
                      <td className="p-3 font-mono text-right text-slate-400">{formatRupees(m.total_purchase_cost_paise)}</td>
                      <td className="p-3 font-mono text-right text-emerald-400 font-semibold">{formatRupees(m.realized_profit_paise)}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                          m.margin_percentage >= 20
                            ? "bg-emerald-950/50 text-emerald-300 border border-emerald-900"
                            : m.margin_percentage >= 10
                              ? "bg-blue-950/50 text-blue-300 border border-blue-900"
                              : "bg-amber-950/50 text-amber-300 border border-amber-900"
                        }`}>
                          {m.margin_percentage >= 15 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-amber-400" />
                          )}
                          {m.margin_percentage.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function KPICard({
  title,
  value,
  format,
  subtitle,
  icon: Icon,
  tone,
  alert = false,
  delayMs = 0
}: {
  title: string;
  value: number;
  format: (n: number) => string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  tone: "emerald" | "blue" | "amber" | "violet" | "red";
  alert?: boolean;
  delayMs?: number;
}) {
  const toneClasses = {
    emerald: "border-emerald-800 bg-emerald-950/20 text-emerald-400 hover:border-emerald-700",
    blue: "border-blue-800 bg-blue-950/20 text-blue-400 hover:border-blue-700",
    amber: "border-amber-800 bg-amber-950/20 text-amber-400 hover:border-amber-700",
    violet: "border-violet-850 bg-violet-950/20 text-violet-400 hover:border-violet-750",
    red: "border-red-900 bg-red-950/30 text-red-400 hover:border-red-800 animate-pulse border-2"
  };

  return (
    <div
      className={`animate-slide-up flex items-start gap-4 rounded-lg border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 ${toneClasses[tone]}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded transition-transform duration-200 hover:scale-110 ${
        alert ? "bg-red-500 text-slate-50" : "bg-slate-950 border border-slate-800 text-slate-300"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 truncate">{title}</p>
        <CountUp value={value} format={format} className="mt-1 block truncate font-mono text-lg font-bold leading-none text-slate-50" />
        <p className="text-[11px] text-slate-400 mt-1 truncate">{subtitle}</p>
      </div>
    </div>
  );
}

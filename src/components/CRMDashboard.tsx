import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  X,
  Sparkles,
  TrendingUp,
  AlertCircle,
  Coins,
  History,
  CheckCircle,
  User,
  MapPin,
  Award,
  Phone,
  MessageSquare,
  Loader2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Pencil
} from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import CustomerMaster from "./CustomerMaster.js";
import { CountUp } from "./ui.js";

type CRMDashboardProps = {
  apiBaseUrl?: string;
};

type Customer = {
  id: number;
  name: string;
  phone: string;
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  area: string | null;
  taluka: string | null;
  district: string | null;
  birthday_date: string | null;
  anniversary_date: string | null;
  loyalty_enrolled: boolean;
  loyalty_points_balance: number;
  ring_size: string | null;
  spouse_name: string | null;
  pan_number: string | null;
  aadhaar_number: string | null;
  gstin: string | null;
};

type GssAccount = {
  id: number;
  card_number: string;
  enrollment_date: string;
  maturity_date: string;
  status: "ACTIVE" | "MATURED" | "CONVERTED_TO_SALE" | "DEFAULTER" | "MERGED";
  total_paid_paise: number;
  installments_paid_count: number;
  template_name: string;
  monthly_amount_paise: number;
  duration_months: number;
};

type GirviCollateral = {
  id: number;
  item_description: string;
  metal_type: string;
  purity_karat: number;
  weight_mg: number;
};

type GirviLoan = {
  id: number;
  loan_number: string;
  principal_amount_paise: number;
  interest_rate_percentage: number;
  interest_type: "SIMPLE" | "COMPOUND";
  rate_period: "MONTHLY" | "ANNUALLY";
  issue_date: string;
  status: "ACTIVE" | "SETTLED" | "DEFAULTED";
  total_repaid_paise: number;
  next_due_date: string | null;
  collateral: GirviCollateral[];
};

type Customer360 = {
  customer: Customer;
  gss_accounts: GssAccount[];
  girvi_loans: GirviLoan[];
  invoice_history: {
    count: number;
    total_value_paise: number;
  };
  udhari_balance_paise: number;
  loyalty_ledger: Array<{
    id: number;
    invoice_id: number | null;
    transaction_type: "EARN" | "REDEEM";
    points: number;
    balance_after: number;
    description: string | null;
    created_at: string | null;
  }>;
};

type Toast = {
  id: string;
  message: string;
  type: "success" | "info" | "error";
};

export default function CRMDashboard({ apiBaseUrl = "" }: CRMDashboardProps) {
  const { session } = useAuthSession();

  // State for Customer List & Filters
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [upcomingEvents, setUpcomingEvents] = useState(false);

  // Pagination State
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);

  // Selected Customer 360 View State
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customer360, setCustomer360] = useState<Customer360 | null>(null);
  const [loading360, setLoading360] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  // Bumped after an edit to force the 360 panel to re-fetch even when the selected id is unchanged.
  const [refresh360, setRefresh360] = useState(0);

  // Toast Messages
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Customer create/edit modal
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);

  // Auth Headers
  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  // Fetch Customer List
  const fetchCustomers = async () => {
    setLoadingList(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        search: search.trim(),
        area: selectedArea,
        upcoming_events: upcomingEvents.toString()
      });

      const response = await fetch(`${apiBaseUrl}/api/crm/customers?${queryParams}`, {
        headers: authHeaders
      });

      if (!response.ok) {
        throw new Error("Failed to load customer list.");
      }

      const data = await response.json();
      setCustomersList(data.customers);
      setAreas(data.areas);
      setTotalPages(data.pagination.totalPages);
      setTotalCustomers(data.pagination.total);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error loading customers", "error");
    } finally {
      setLoadingList(false);
    }
  };

  // Trigger list fetch when filters or page change
  useEffect(() => {
    fetchCustomers();
  }, [search, selectedArea, upcomingEvents, page]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, selectedArea, upcomingEvents]);

  // Fetch Customer 360 aggregated details
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomer360(null);
      return;
    }

    const fetch360 = async () => {
      setLoading360(true);
      try {
        const response = await fetch(`${apiBaseUrl}/api/crm/customers/${selectedCustomerId}/360`, {
          headers: authHeaders
        });

        if (!response.ok) {
          throw new Error("Failed to load customer details.");
        }

        const data = await response.json();
        setCustomer360(data);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Error loading 360 profile", "error");
        setSelectedCustomerId(null);
      } finally {
        setLoading360(false);
      }
    };

    fetch360();
  }, [selectedCustomerId, refresh360]);

  const showToast = (message: string, type: Toast["type"] = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleSendWhatsAppReminder = (type: "udhari" | "gss", amountOrInstallment: string) => {
    if (!customer360) return;
    const name = customer360.customer.name;
    const phone = customer360.customer.phone;

    let text = "";
    if (type === "udhari") {
      text = `Dear ${name}, this is a gentle reminder from Shree Jewelers regarding your outstanding balance of ${amountOrInstallment}. Please visit us to settle your account. Thank you.`;
    } else {
      text = `Dear ${name}, your GSS installment of ${amountOrInstallment} is due for this month. Kindly deposit your payment to keep your savings scheme active. Thank you, Shree Jewelers.`;
    }

    showToast(`WhatsApp reminder simulated for ${name} (${phone}): "${text.slice(0, 70)}..."`, "success");
  };

  // Convert weight in milligrams to grams (1g = 1000mg)
  const formatWeight = (mg: number) => {
    return `${(mg / 1000).toFixed(3)}g`;
  };

  // Format currency (paise -> Rupees ₹)
  const formatRupees = (paise: number) => {
    const absolute = Math.abs(paise);
    const rupees = Math.trunc(absolute / 100);
    const cents = String(absolute % 100).padStart(2, "0");
    const sign = paise < 0 ? "-" : "";
    return `${sign}₹ ${rupees.toLocaleString("en-IN")}.${cents}`;
  };

  return (
    <div className="relative flex h-full flex-col bg-slate-950 p-4 font-sans text-slate-200">
      
      {/* Toast Manager */}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2 max-w-md">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 border px-4 py-3 shadow-lg rounded-md transition-all duration-300 ${
              t.type === "success"
                ? "border-emerald-800 bg-emerald-950/90 text-emerald-200"
                : t.type === "error"
                ? "border-red-900 bg-red-950/90 text-red-200"
                : "border-slate-800 bg-slate-900/90 text-slate-200"
            }`}
          >
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span className="text-xs font-medium">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
              className="ml-auto text-slate-400 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {showAddCustomer && (
        <CustomerMaster
          apiBaseUrl={apiBaseUrl}
          initial={editCustomer}
          onClose={() => setShowAddCustomer(false)}
          onSaved={(saved) => {
            setShowAddCustomer(false);
            setEditCustomer(null);
            void fetchCustomers();
            setSelectedCustomerId(saved.id);
            setRefresh360((n) => n + 1);
          }}
        />
      )}

      {/* Main Container */}
      <div className="flex flex-col h-full bg-slate-900 border border-slate-800 shadow-xl overflow-hidden rounded-xl">
        
        {/* Top Header & Search Bar */}
        <header className="flex flex-col gap-3 border-b border-slate-800 bg-slate-900 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              Customer Relationship Management
            </h2>
            <p className="text-[11px] text-slate-400">View customer profile history, udhari balances, active schemes, and moneylending statistics.</p>
          </div>

          <button
            type="button"
            onClick={() => { setEditCustomer(null); setShowAddCustomer(true); }}
            className="group inline-flex items-center gap-1 self-start rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 active:scale-95"
          >
            <User className="h-3.5 w-3.5 transition-transform group-hover:scale-110" /> Add Customer
          </button>

          {/* Quick Stats Header */}
          <div className="flex gap-4 text-xs">
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-1.5 transition hover:border-slate-700">
              <span className="text-slate-500 uppercase text-[9px] font-bold block">Total Customers</span>
              <CountUp value={totalCustomers} className="text-white font-mono text-sm font-semibold" />
            </div>
            <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-1.5 transition hover:border-slate-700">
              <span className="text-slate-500 uppercase text-[9px] font-bold block">Active Area Codes</span>
              <CountUp value={areas.length} className="text-white font-mono text-sm font-semibold" />
            </div>
          </div>
        </header>

        {/* Filter Controls Bar */}
        <section className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-900/50 px-5 py-3 text-xs">
          
          {/* Search Box */}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by Name or Phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Area Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400 font-semibold uppercase text-[10px]">Area:</span>
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="h-9 border border-slate-800 bg-slate-950 px-2 text-xs rounded text-white outline-none focus:border-emerald-500 transition min-w-[120px]"
            >
              <option value="">All Areas</option>
              {areas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>

          {/* Birthday/Anniversary toggle */}
          <div className="flex items-center gap-2 border-l border-slate-800 pl-4 h-9">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={upcomingEvents}
                onChange={(e) => setUpcomingEvents(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-950 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-slate-900 peer-checked:after:border-emerald-500"></div>
              <span className="ml-2 text-xs text-slate-300 font-medium select-none">
                Upcoming Celebrations (30 Days)
              </span>
            </label>
          </div>
        </section>

        {/* Data Table Grid */}
        <main className="flex-1 overflow-auto min-h-0 relative">
          {loadingList && customersList.length > 0 ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px]">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : null}

          {loadingList && customersList.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="erp-skeleton h-9 rounded" style={{ animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
          ) : customersList.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-slate-950/10 animate-fade-in">
              <User className="h-10 w-10 text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-400">No Customers Found</p>
              <p className="text-xs text-slate-500 mt-0.5">Try widening your search queries or clearing the filters.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-slate-900 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">ID</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">Customer Name</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">Phone</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">Area Code</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">Birthday</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500">Anniversary</th>
                  <th className="px-4 py-3 font-semibold uppercase text-slate-500 text-right">Loyalty Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {customersList.map((cust, i) => (
                  <tr
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                    className={`animate-fade-in cursor-pointer transition-colors hover:bg-slate-800/40 ${
                      selectedCustomerId === cust.id ? "bg-emerald-500/10 shadow-[inset_3px_0_0_0_rgb(16,185,129)] hover:bg-emerald-500/15" : ""
                    }`}
                  >
                    <td className="px-4 py-3.5 font-mono text-slate-500">{cust.id}</td>
                    <td className="px-4 py-3.5 font-semibold text-white">{cust.name}</td>
                    <td className="px-4 py-3.5 font-mono text-slate-300">{cust.phone}</td>
                    <td className="px-4 py-3.5 text-slate-300">{cust.area || <span className="text-slate-600">-</span>}</td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {cust.birthday_date ? (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-emerald-400" />
                          {cust.birthday_date}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {cust.anniversary_date ? (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-teal-400" />
                          {cust.anniversary_date}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-emerald-400">
                      {cust.loyalty_points_balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>

        {/* Table Footer / Pagination */}
        <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-5 py-3 text-xs">
          <span className="text-slate-400">
            Showing <span className="font-semibold text-white">{(page - 1) * limit + 1}</span> to{" "}
            <span className="font-semibold text-white">
              {Math.min(page * limit, totalCustomers)}
            </span>{" "}
            of <span className="font-semibold text-white">{totalCustomers}</span> customers
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="flex h-8 w-8 items-center justify-center border border-slate-800 bg-slate-950 rounded text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-30 disabled:hover:border-slate-800 disabled:hover:text-slate-400 transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-slate-400 text-xs">
              Page <span className="text-white font-semibold">{page}</span> of{" "}
              <span className="text-white font-semibold">{totalPages}</span>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
              className="flex h-8 w-8 items-center justify-center border border-slate-800 bg-slate-950 rounded text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-30 disabled:hover:border-slate-800 disabled:hover:text-slate-400 transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </div>

      {/* Customer 360 Slide-out Panel Overlay & Panel */}
      {selectedCustomerId && (
        <>
          {/* Backdrop Blur */}
          <div
            onClick={() => setSelectedCustomerId(null)}
            className="animate-fade-in fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm"
          />

          {/* Right Slide-out Panel */}
          <aside className="animate-slide-in-right fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
            {loading360 ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              </div>
            ) : customer360 ? (
              <div className="flex h-full flex-col">
                
                {/* Panel Header */}
                <header className="flex items-start justify-between border-b border-slate-800 px-5 py-4 bg-slate-950/40">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center bg-emerald-500/10 rounded-full border border-emerald-500/20 text-emerald-400">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase">{customer360.customer.name}</h3>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1 font-mono mt-0.5">
                        <Phone className="h-3 w-3 text-slate-500" />
                        {customer360.customer.phone}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditCustomer(customer360.customer); setShowAddCustomer(true); }}
                      className="flex h-8 items-center gap-1.5 border border-slate-800 hover:border-emerald-500/60 bg-slate-950/60 rounded px-2.5 text-[11px] font-semibold uppercase text-slate-300 hover:text-emerald-300 transition"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => setSelectedCustomerId(null)}
                      className="flex h-8 w-8 items-center justify-center border border-slate-800 hover:border-slate-700 bg-slate-950/60 rounded text-slate-400 hover:text-white transition"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                {/* Panel Body Scrollable */}
                <main className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-xs">
                  
                  {/* Address & Profile Details Card */}
                  <section className="border border-slate-800 bg-slate-950/20 p-3.5 rounded-lg space-y-2.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Contact & KYC Details</h4>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Address</span>
                        <span className="text-slate-300 font-medium flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          {customer360.customer.address || "Not Provided"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Area / City</span>
                        <span className="text-slate-300 font-medium block mt-0.5">{customer360.customer.area || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Ring Size</span>
                        <span className="text-slate-300 font-mono font-semibold block mt-0.5">{customer360.customer.ring_size || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Spouse Name</span>
                        <span className="text-slate-300 font-medium block mt-0.5">{customer360.customer.spouse_name || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">PAN</span>
                        <span className="text-slate-300 font-mono font-semibold block mt-0.5">{customer360.customer.pan_number || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Aadhaar</span>
                        <span className="text-slate-300 font-mono font-semibold block mt-0.5">{customer360.customer.aadhaar_number || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">GSTIN</span>
                        <span className="text-slate-300 font-mono font-semibold block mt-0.5">{customer360.customer.gstin || "-"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-semibold">Loyalty</span>
                        {(() => {
                          const enrolled = customer360.customer.loyalty_enrolled;
                          const bal = customer360.customer.loyalty_points_balance;
                          const label = enrolled ? "Enrolled" : bal > 0 ? `Not enrolled (${bal} pts)` : "Not enrolled";
                          return (
                            <span className={enrolled || bal > 0 ? "text-emerald-300 font-semibold block mt-0.5" : "text-slate-500 font-medium block mt-0.5"}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </section>

                  {/* Primary Metrics Grid (LTV and Udhari) */}
                  <section className="grid grid-cols-2 gap-3.5">
                    
                    {/* Lifetime Value Metric Card */}
                    <div className="flex flex-col justify-between rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-4 shadow-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-[9px] font-bold uppercase tracking-wider">Lifetime Value</span>
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div className="mt-2.5">
                        <CountUp
                          value={customer360.invoice_history.total_value_paise}
                          format={(n) => formatRupees(n)}
                          className="font-mono text-base font-bold text-white block"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          Total {customer360.invoice_history.count} Invoices
                        </span>
                      </div>
                    </div>

                    {/* Udhari Balance Metric Card */}
                    <div
                      className={`flex flex-col justify-between rounded-lg border p-4 shadow-sm ${
                        customer360.udhari_balance_paise > 0
                          ? "border-rose-500/20 bg-gradient-to-br from-rose-500/5 to-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.04)]"
                          : "border-slate-800 bg-slate-950/20 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider">Udhari Dues</span>
                        <AlertCircle
                          className={`h-4 w-4 ${
                            customer360.udhari_balance_paise > 0 ? "text-rose-400" : "text-slate-500"
                          }`}
                        />
                      </div>
                      <div className="mt-2.5">
                        <CountUp
                          value={customer360.udhari_balance_paise}
                          format={(n) => formatRupees(n)}
                          className={`font-mono text-base font-bold block ${
                            customer360.udhari_balance_paise > 0 ? "text-rose-400" : "text-slate-300"
                          }`}
                        />
                        {customer360.udhari_balance_paise > 0 ? (
                          <span className="text-[10px] text-rose-500/70 font-semibold block mt-1">
                            Action required
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 block mt-1">
                            Settle/Paid up
                          </span>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5 text-slate-400" />
                      Loyalty History
                    </h4>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase text-slate-500">Current Balance</span>
                        <span className="font-mono text-sm font-bold text-emerald-300">{customer360.customer.loyalty_points_balance} pts</span>
                      </div>
                      {customer360.loyalty_ledger.length === 0 ? (
                        <div className="border border-dashed border-slate-800 py-3 text-center text-[11px] text-slate-500 rounded">
                          No loyalty point movements
                        </div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto">
                          <table className="w-full text-left text-[10px]">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="py-1 font-semibold uppercase">Date</th>
                                <th className="py-1 font-semibold uppercase">Type</th>
                                <th className="py-1 text-right font-semibold uppercase">Pts</th>
                                <th className="py-1 text-right font-semibold uppercase">Bal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                              {customer360.loyalty_ledger.map((row) => (
                                <tr key={row.id}>
                                  <td className="py-1.5 text-slate-400">{row.created_at?.slice(0, 10) ?? "-"}</td>
                                  <td className={row.transaction_type === "EARN" ? "py-1.5 font-semibold text-emerald-300" : "py-1.5 font-semibold text-amber-300"}>
                                    {row.transaction_type}
                                  </td>
                                  <td className="py-1.5 text-right font-mono text-slate-200">{row.points > 0 ? "+" : ""}{row.points}</td>
                                  <td className="py-1.5 text-right font-mono text-slate-400">{row.balance_after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Active Girvi Loans Mini-Cards */}
                  <section className="space-y-2.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5 text-slate-400" />
                      Active Girvi Loans ({customer360.girvi_loans.length})
                    </h4>

                    {customer360.girvi_loans.length === 0 ? (
                      <div className="border border-dashed border-slate-800 bg-slate-950/10 py-4 text-center text-[11px] text-slate-500 rounded-lg">
                        No Pledged Loans / Girvi history
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {customer360.girvi_loans.map((loan) => (
                          <div key={loan.id} className="border border-slate-800 bg-slate-950/40 p-3 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-white text-[11px]">{loan.loan_number}</span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider rounded ${
                                  loan.status === "ACTIVE"
                                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                    : loan.status === "DEFAULTED"
                                    ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {loan.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[10px] text-slate-400">
                              <div>
                                Principal:{" "}
                                <span className="font-mono font-semibold text-slate-200">
                                  {formatRupees(loan.principal_amount_paise)}
                                </span>
                              </div>
                              <div>
                                Rate:{" "}
                                <span className="font-mono font-semibold text-slate-200">
                                  {loan.interest_rate_percentage}% ({loan.rate_period.toLowerCase()})
                                </span>
                              </div>
                              <div>
                                Issue Date: <span className="text-slate-200 font-medium">{loan.issue_date}</span>
                              </div>
                              <div>
                                Next Due:{" "}
                                <span className="text-slate-200 font-medium font-mono">{loan.next_due_date || "-"}</span>
                              </div>
                            </div>

                            {/* Collateral Pledged list */}
                            {loan.collateral.length > 0 && (
                              <div className="border-t border-slate-800 pt-1.5 mt-1.5 space-y-1">
                                <span className="text-[9px] text-slate-500 font-bold uppercase block tracking-wider">Collateral Pledged</span>
                                <div className="space-y-1">
                                  {loan.collateral.map((col) => (
                                    <div key={col.id} className="flex justify-between items-center text-[10px] text-slate-300">
                                      <span className="font-medium">{col.item_description}</span>
                                      <span className="font-mono text-slate-400">
                                        {col.metal_type} {col.purity_karat}K @ {formatWeight(col.weight_mg)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Active GSS Passbooks Mini-Cards */}
                  <section className="space-y-2.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Award className="h-3.5 w-3.5 text-slate-400" />
                      Active GSS Accounts ({customer360.gss_accounts.length})
                    </h4>

                    {customer360.gss_accounts.length === 0 ? (
                      <div className="border border-dashed border-slate-800 bg-slate-950/10 py-4 text-center text-[11px] text-slate-500 rounded-lg">
                        No Gold Scheme enrolments
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {customer360.gss_accounts.map((gss) => {
                          const progressPercent = Math.min(
                            (gss.installments_paid_count / gss.duration_months) * 100,
                            100
                          );

                          return (
                            <div key={gss.id} className="border border-slate-800 bg-slate-950/40 p-3 rounded-lg space-y-2.5">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-bold text-white block">{gss.template_name}</span>
                                  <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">Card: {gss.card_number}</span>
                                </div>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-wider rounded ${
                                    gss.status === "ACTIVE"
                                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                      : gss.status === "MATURED"
                                      ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                                      : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {gss.status}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 text-[10px] text-slate-400 gap-y-0.5">
                                <div>
                                  Monthly Amount:{" "}
                                  <span className="font-mono font-semibold text-slate-200">
                                    {formatRupees(gss.monthly_amount_paise)}
                                  </span>
                                </div>
                                <div>
                                  Total Paid:{" "}
                                  <span className="font-mono font-semibold text-slate-200">
                                    {formatRupees(gss.total_paid_paise)}
                                  </span>
                                </div>
                                <div>
                                  Enrollment Date: <span className="text-slate-200">{gss.enrollment_date}</span>
                                </div>
                                <div>
                                  Maturity Date: <span className="text-slate-200">{gss.maturity_date}</span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="space-y-1 pt-0.5">
                                <div className="flex justify-between text-[9px] font-mono text-slate-400">
                                  <span>Installments Progress</span>
                                  <span className="font-bold text-white">
                                    {gss.installments_paid_count} / {gss.duration_months} Months
                                  </span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-950 rounded overflow-hidden">
                                  <div
                                    style={{ width: `${progressPercent}%` }}
                                    className={`h-full rounded transition-[width] duration-700 ease-out ${
                                      gss.status === "MATURED" ? "bg-indigo-500" : "bg-emerald-500"
                                    }`}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </main>

                {/* Panel Footer / Action Buttons */}
                <footer className="border-t border-slate-800 bg-slate-950/40 p-4 space-y-2 flex flex-col">
                  {customer360.udhari_balance_paise > 0 && (
                    <button
                      onClick={() =>
                        handleSendWhatsAppReminder(
                          "udhari",
                          formatRupees(customer360.udhari_balance_paise)
                        )
                      }
                      className="flex items-center justify-center gap-2 h-9 w-full bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-slate-950 font-bold uppercase rounded text-xs transition"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      Send WhatsApp Udhari Reminder
                    </button>
                  )}

                  {customer360.gss_accounts.some((gss) => gss.status === "ACTIVE") && (
                    <button
                      onClick={() => {
                        const activeGss = customer360.gss_accounts.find((gss) => gss.status === "ACTIVE");
                        if (activeGss) {
                          handleSendWhatsAppReminder(
                            "gss",
                            formatRupees(activeGss.monthly_amount_paise)
                          );
                        }
                      }}
                      className="flex items-center justify-center gap-2 h-9 w-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold uppercase rounded text-xs transition"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      Send WhatsApp GSS Reminder
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedCustomerId(null)}
                    className="h-9 w-full border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-300 font-semibold uppercase rounded text-xs transition"
                  >
                    Close Profile Panel
                  </button>
                </footer>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-slate-400 text-xs">
                No Customer 360 Information Available
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

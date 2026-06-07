import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner.js";
import { usePOSCredit } from "../pos/POSCreditContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";
import CustomerMaster, { type SavedCustomer } from "./CustomerMaster.js";
import { CountUp } from "./ui.js";
import { Trash2, CheckCircle2, Plus, Loader2, MessageSquare } from "lucide-react";

type POSBillingScreenProps = {
  apiBaseUrl?: string;
};

type Customer = {
  id: number;
  name: string;
  phone: string;
  area?: string | null;
  pan_number?: string | null;
  aadhaar_number?: string | null;
  loyalty_enrolled?: boolean;
};

type InventoryItem = {
  id: number;
  barcode: string;
  huid: string | null;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_mg: number;
  net_weight_mg: number;
  making_charge_type: "PER_GRAM" | "FLAT";
  making_charge_value: number;
  status: string | null;
};

type CartLine = InventoryItem & {
  metalRateRupees: string;
  makingRupees: string;
};

type UrdLine = {
  id: string;
  description: string;
  purityTunch: string;
  weightG: string;
  appliedRateRupees: string;
};

type PaymentState = {
  cash: string;
  upi: string;
  card: string;
  udhari: string;
};

type PaymentReferenceState = {
  bankName: string;
  upiReference: string;
  cardReference: string;
  chequeReference: string;
  ddReference: string;
  neftReference: string;
};

type InvoiceMetaState = {
  billPrefix: string;
  manualNumber: string;
  dueDate: string;
  salesmanName: string;
  gstNotRequired: boolean;
};

type RatesState = {
  gold24k: string;
  gold22k: string;
  gold18k: string;
  silver: string;
};

const CASH_PAN_AADHAAR_THRESHOLD_PAISE = 20000000;

const emptyPayments: PaymentState = {
  cash: "",
  upi: "",
  card: "",
  udhari: ""
};

const emptyPaymentReferences: PaymentReferenceState = {
  bankName: "",
  upiReference: "",
  cardReference: "",
  chequeReference: "",
  ddReference: "",
  neftReference: ""
};

const emptyInvoiceMeta: InvoiceMetaState = {
  billPrefix: "GST",
  manualNumber: "",
  dueDate: "",
  salesmanName: "",
  gstNotRequired: false
};

const emptyRates: RatesState = {
  gold24k: "0.00",
  gold22k: "0.00",
  gold18k: "0.00",
  silver: "0.00"
};

export default function POSBillingScreen({ apiBaseUrl = "" }: POSBillingScreenProps) {
  const { session } = useAuthSession();
  const { posCreditBalance, clearPosCreditBalance } = usePOSCredit();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [urdLines, setUrdLines] = useState<UrdLine[]>([]);
  const [urdDraft, setUrdDraft] = useState<UrdLine>(createEmptyUrdLine());
  const [payments, setPayments] = useState<PaymentState>(emptyPayments);
  const [paymentReferences, setPaymentReferences] = useState<PaymentReferenceState>(emptyPaymentReferences);
  const [invoiceMeta, setInvoiceMeta] = useState<InvoiceMetaState>(emptyInvoiceMeta);
  const [gssCreditAppliedPaise, setGssCreditAppliedPaise] = useState(0);
  const [discountRupees, setDiscountRupees] = useState("");
  const [rates, setRates] = useState<RatesState>(emptyRates);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [printInvoiceId, setPrintInvoiceId] = useState<number | null>(null);
  const [documentImagePath, setDocumentImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oldDuesRupees, setOldDuesRupees] = useState("");
  const [customerUdhariPaise, setCustomerUdhariPaise] = useState(0);
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState("");
  const [customerLoyaltyPoints, setCustomerLoyaltyPoints] = useState(0);
  const [customerLoyaltyEnrolled, setCustomerLoyaltyEnrolled] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerListOpen, setCustomerListOpen] = useState(false);
  const [walkInName, setWalkInName] = useState("");
  const [showCreditConfirm, setShowCreditConfirm] = useState(false);
  const [printContext, setPrintContext] = useState<{ phone: string | null; invoiceNumber: string } | null>(null);

  function selectCustomer(customer: Customer | null) {
    if (!customer) {
      setCustomerId("");
      setCustomerQuery("");
    } else {
      setCustomerId(String(customer.id));
      setCustomerQuery(customer.name);
    }
    setWalkInName("");
    setCustomerListOpen(false);
  }

  function confirmWalkIn(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWalkInName(trimmed);
    setCustomerId("");
    setCustomerQuery(trimmed);
    setCustomerListOpen(false);
  }

  function handleCustomerSaved(saved: SavedCustomer) {
    const next: Customer = {
      id: saved.id,
      name: saved.name,
      phone: saved.phone,
      area: typeof saved.area === "string" ? saved.area : null,
      loyalty_enrolled: Boolean(saved.loyalty_enrolled)
    };
    setCustomers((current) => [next, ...current.filter((c) => c.id !== saved.id)]);
    setCustomerId(String(saved.id));
    setCustomerQuery(saved.name);
    setShowCustomerModal(false);
    setMessage(`Customer ${saved.name} added.`);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setUploading(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch(`${apiBaseUrl}/api/upload/image`, {
        method: "POST",
        headers: authHeaders,
        body: formData
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to upload image.");
      }

      setDocumentImagePath(result.image_path);
      setMessage("KYC document uploaded successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  }

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    void loadCustomers();
    void loadRates();
  }, []);

  // Load the selected customer's outstanding udhari so it can be collected in this bill.
  useEffect(() => {
    if (!customerId) {
      setCustomerUdhariPaise(0);
      setOldDuesRupees("");
      setCustomerLoyaltyPoints(0);
      setCustomerLoyaltyEnrolled(false);
      setLoyaltyRedeemPoints("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/crm/customers/${customerId}/360`, { headers: authHeaders });
        const data = (await res.json().catch(() => null)) as { udhari_balance_paise?: number; customer?: { loyalty_enrolled?: boolean; loyalty_points_balance?: number } } | null;
        if (!cancelled && res.ok && data) {
          setCustomerUdhariPaise(Number(data.udhari_balance_paise) || 0);
          setCustomerLoyaltyEnrolled(Boolean(data.customer?.loyalty_enrolled));
          setCustomerLoyaltyPoints(Number(data.customer?.loyalty_points_balance) || 0);
        }
      } catch {
        if (!cancelled) {
          setCustomerUdhariPaise(0);
          setCustomerLoyaltyEnrolled(false);
          setCustomerLoyaltyPoints(0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [customerId, apiBaseUrl, authHeaders]);

  const appendScannedItem = useCallback(
    async (barcode: string) => {
      setError("");

      try {
        const response = await fetch(`${apiBaseUrl}/api/inventory?search=${encodeURIComponent(barcode)}`, {
          headers: authHeaders
        });
        const result = (await response.json().catch(() => null)) as { items?: InventoryItem[]; errors?: string[] } | null;

        if (!response.ok || !result?.items?.length) {
          throw new Error(result?.errors?.join(" ") || `No item found for ${barcode}.`);
        }

        const item = result.items.find((candidate) => candidate.barcode === barcode || candidate.huid === barcode) ?? result.items[0];

        if (item.status && item.status !== "IN_STOCK") {
          setError(`${item.barcode} is ${String(item.status).toLowerCase()} and cannot be added to the cart.`);
          return;
        }

        if (cart.some((line) => line.id === item.id)) {
          setMessage(`${item.barcode} is already in cart.`);
          return;
        }

        setCart((current) => [
          ...current,
          {
            ...item,
            metalRateRupees: getDefaultRateForItem(item, rates),
            makingRupees: (item.making_charge_value / 100).toFixed(2)
          }
        ]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not scan item.");
      }
    },
    [apiBaseUrl, authHeaders, cart, rates]
  );

  useBarcodeScanner(appendScannedItem);

  const loyaltyRedeemPaiseInput = Math.max(0, Math.trunc(Number(loyaltyRedeemPoints) || 0)) * 100;
  const totals = useMemo(
    () => calculateTotals(cart, urdLines, discountRupees, payments, gssCreditAppliedPaise, loyaltyRedeemPaiseInput),
    [cart, discountRupees, gssCreditAppliedPaise, payments, urdLines, loyaltyRedeemPaiseInput]
  );
  const cashComplianceRequired = totals.cashPaidPaise >= CASH_PAN_AADHAAR_THRESHOLD_PAISE;
  const kycRequired = cashComplianceRequired || urdLines.length > 0;
  const complianceMissing = kycRequired && (!panNumber.trim() || !aadhaarNumber.trim() || !customerId);
  const checkoutDisabled = cart.length === 0 || totals.balanceRemainingPaise !== 0 || complianceMissing;

  async function loadCustomers() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers?limit=100`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { customers?: Customer[] } | null;

      if (response.ok && result?.customers) {
        setCustomers(result.customers);
      }
    } catch {
      setCustomers([]);
    }
  }

  async function loadRates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/rates`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { rates?: Record<string, string> } | null;

      if (response.ok && result?.rates) {
        setRates({
          gold24k: result.rates.gold_24k_rate_per_gram_rupees ?? "0.00",
          gold22k: result.rates.gold_22k_rate_per_gram_rupees ?? "0.00",
          gold18k: result.rates.gold_18k_rate_per_gram_rupees ?? "0.00",
          silver: result.rates.silver_rate_per_gram_rupees ?? "0.00"
        });
      }
    } catch {
      setRates(emptyRates);
    }
  }

  function addUrdLine() {
    if (!urdDraft.description.trim()) {
      return;
    }

    setUrdLines((current) => [...current, urdDraft]);
    setUrdDraft(createEmptyUrdLine());
  }

  // Gate: validate, and for credit (udhari) sales ask for confirmation before saving.
  function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (checkoutDisabled) {
      return;
    }

    if (kycRequired) {
      if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNumber)) {
        setError("PAN must be a valid 10-character alphanumeric format (e.g. ABCDE1234F).");
        return;
      }
      if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) {
        setError("Aadhaar number must be exactly 12 digits.");
        return;
      }
    }

    if (rupeesToPaise(payments.udhari) > 0) {
      setShowCreditConfirm(true);
      return;
    }

    void submitCheckout();
  }

  async function submitCheckout() {
    setShowCreditConfirm(false);
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const payload = buildCheckoutPayload({
        customerId,
        walkInName,
        panNumber,
        aadhaarNumber,
        documentImagePath,
        cart,
        urdLines,
        discountRupees,
        payments,
        paymentReferences,
        invoiceMeta,
        posCreditBalance,
        gssCreditAppliedPaise,
        oldDuesRupees,
        loyaltyRedeemPoints,
        totals
      });

      const response = await fetch(`${apiBaseUrl}/api/pos/checkout`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as { invoice_id?: number; invoice?: { id?: number; invoice_number?: string }; errors?: string[]; message?: string; error?: string } | null;

      if (!response.ok) {
        // The server reports the specific reason under errors[]/message/error
        // (e.g. item already sold, not hallmarked) — surface it instead of a generic failure.
        throw new Error(result?.errors?.join(" ") || result?.message || result?.error || "Checkout failed.");
      }

      const invoiceId = result?.invoice_id ?? result?.invoice?.id ?? null;
      const phone = customers.find((c) => String(c.id) === customerId)?.phone ?? null;

      setMessage(customerId ? "Invoice saved. Digital receipt is ready to send." : "Invoice saved.");
      setPrintContext({ phone, invoiceNumber: result?.invoice?.invoice_number ?? "" });
      setPrintInvoiceId(invoiceId);
      setCart([]);
      setUrdLines([]);
      setPayments(emptyPayments);
      setPaymentReferences(emptyPaymentReferences);
      setInvoiceMeta(emptyInvoiceMeta);
      setGssCreditAppliedPaise(0);
      clearPosCreditBalance();
      setDiscountRupees("");
      setOldDuesRupees("");
      setCustomerUdhariPaise(0);
      setLoyaltyRedeemPoints("");
      setCustomerLoyaltyPoints(0);
      setCustomerLoyaltyEnrolled(false);
      setCustomerId("");
      setCustomerQuery("");
      setWalkInName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAsQuotation() {
    setError("");
    setMessage("");

    if (cart.length === 0) {
      setError("Add at least one item to the cart before saving a quotation.");
      return;
    }

    const quotationLines = cart.map((line) => ({
      item_id: line.id,
      description: `${line.category}${line.barcode ? ` (${line.barcode})` : ""}`,
      metal_type: line.metal_type,
      purity_karat: line.purity_karat,
      quantity: 1,
      gross_weight_mg: line.gross_weight_mg,
      stone_weight_mg: Math.max(line.gross_weight_mg - line.net_weight_mg, 0),
      net_weight_mg: line.net_weight_mg,
      metal_rate_paise_per_gram: rupeesToPaise(line.metalRateRupees),
      making_charge_paise: calculateMakingChargePaise(line),
      gst_paise: 0,
      line_total_paise: calculateCartLineTotalPaise(line)
    }));

    const grossTotalPaise = quotationLines.reduce((total, line) => total + line.line_total_paise, 0);
    const discountPaise = rupeesToPaise(discountRupees);
    const totalAmountPaise = Math.max(grossTotalPaise - discountPaise, 0);

    const payload = {
      customer_id: customerId ? Number(customerId) : null,
      document_date: new Date().toISOString().slice(0, 10),
      salesman_name: invoiceMeta.salesmanName.trim() || null,
      lines: quotationLines,
      gross_total_paise: grossTotalPaise,
      discount_paise: discountPaise,
      gst_amount_paise: 0,
      total_amount_paise: totalAmountPaise
    };

    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/quotations`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json().catch(() => null)) as { quotation?: { quotation_number?: string }; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not save quotation.");
      }

      setMessage(`Quotation saved${result?.quotation?.quotation_number ? ` (${result.quotation.quotation_number})` : ""}. No stock was reduced.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save quotation.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCustomer = customers.find((c) => String(c.id) === customerId) ?? null;
  const filteredCustomers = (
    customerQuery.trim()
      ? customers.filter((c) => c.name.toLowerCase().includes(customerQuery.trim().toLowerCase()) || c.phone.includes(customerQuery.trim()))
      : customers
  ).slice(0, 8);

  return (
    <form onSubmit={checkout} className="grid h-screen grid-cols-[260px_1fr_310px] overflow-hidden bg-slate-950 text-slate-100">
      <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-800 bg-slate-900 p-3">
        <header className="border-b border-slate-800 pb-2">
          <h1 className="text-sm font-semibold uppercase text-slate-50">POS Billing</h1>
          <p className="text-xs text-slate-400">Barcode scan enabled</p>
        </header>

        <section className="grid content-start gap-3 pt-3">
          <Field label="Customer">
            <div className="relative">
              <div className="flex gap-1">
                <input
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value);
                    setCustomerId("");
                    setWalkInName("");
                    setCustomerListOpen(true);
                  }}
                  onFocus={() => setCustomerListOpen(true)}
                  onBlur={() => window.setTimeout(() => setCustomerListOpen(false), 150)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && customerQuery.trim() && !customerId) {
                      event.preventDefault();
                      confirmWalkIn(customerQuery);
                    }
                  }}
                  placeholder="Search name or phone… (Enter = walk-in)"
                  className={controlClassName}
                />
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(true)}
                  title="Add new customer (full KYC)"
                  className="grid shrink-0 place-items-center rounded-sm border border-amber-600 bg-amber-600/20 px-2 text-amber-300 transition hover:bg-amber-600/40 active:scale-90"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {customerListOpen && (
                <ul className="animate-fade-in absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-sm border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
                  {/* Walk-in quick-confirm option — only shown when user has typed something */}
                  {customerQuery.trim() && !customerId ? (
                    <li>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); confirmWalkIn(customerQuery); }}
                        className="flex w-full items-center gap-2 border-b border-slate-700 bg-emerald-950/30 px-2 py-2 text-left text-xs text-emerald-300 transition hover:bg-emerald-950/60"
                      >
                        <span className="rounded bg-emerald-700/40 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide">Walk-in</span>
                        <span>Use &ldquo;{customerQuery.trim()}&rdquo; for this bill</span>
                      </button>
                    </li>
                  ) : (
                    <li>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); selectCustomer(null); }} className="block w-full px-2 py-1.5 text-left text-xs text-slate-400 transition hover:bg-slate-800">
                        Anonymous walk-in (no name)
                      </button>
                    </li>
                  )}
                  {filteredCustomers.map((customer) => (
                    <li key={customer.id}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); selectCustomer(customer); }} className="block w-full px-2 py-1.5 text-left text-xs transition hover:bg-slate-800">
                        <span className="font-medium text-slate-100">{customer.name}</span>
                        <span className="text-slate-500"> — {customer.phone}{customer.area ? ` · ${customer.area}` : ""}</span>
                      </button>
                    </li>
                  ))}
                  {filteredCustomers.length === 0 && customerQuery.trim() && (
                    <li className="px-2 py-1.5 text-[11px] text-slate-500">
                      No existing match — press Enter or click above to bill as walk-in.
                    </li>
                  )}
                </ul>
              )}
            </div>
            {/* Walk-in name badge */}
            {walkInName && !customerId && (
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded bg-emerald-700/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                  Walk-in: {walkInName}
                </span>
                <button
                  type="button"
                  onClick={() => { setWalkInName(""); setCustomerQuery(""); }}
                  className="text-[11px] text-slate-500 hover:text-red-400"
                >
                  ✕ clear
                </button>
              </div>
            )}
            {selectedCustomer && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                <span className="font-mono">📱 {selectedCustomer.phone}</span>
                {selectedCustomer.area && <span>📍 {selectedCustomer.area}</span>}
              </div>
            )}
          </Field>

          {customerId && customerUdhariPaise > 0 && (
            <div className="grid gap-1 rounded-sm border border-amber-700/60 bg-amber-950/20 p-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">
                Old Dues Outstanding: ₹{(customerUdhariPaise / 100).toFixed(2)}
              </p>
              <Field label="Collect toward old dues (₹)">
                <input
                  value={oldDuesRupees}
                  onChange={(event) => setOldDuesRupees(event.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0.00"
                  className={controlClassName}
                />
              </Field>
            </div>
          )}

          {customerId && customerLoyaltyEnrolled && customerLoyaltyPoints > 0 && (
            <div className="grid gap-1 rounded-sm border border-emerald-700/60 bg-emerald-950/20 p-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                Loyalty Points: {customerLoyaltyPoints} (₹1 each)
              </p>
              <Field label="Redeem points">
                <input
                  value={loyaltyRedeemPoints}
                  onChange={(event) => {
                    const next = Math.min(Number(event.target.value.replace(/[^\d]/g, "")) || 0, customerLoyaltyPoints);
                    setLoyaltyRedeemPoints(next > 0 ? String(next) : "");
                  }}
                  placeholder="0"
                  className={controlClassName}
                />
              </Field>
            </div>
          )}

          {customerId && !customerLoyaltyEnrolled && (
            <div className="rounded-sm border border-slate-800 bg-slate-950/40 p-2 text-[11px] text-slate-500">
              Loyalty earning is off for this customer.
            </div>
          )}

          {kycRequired && (
            <div className="grid gap-2 border border-red-500 bg-red-950/30 p-2 rounded-sm">
              <p className="text-xs font-bold uppercase text-red-200 tracking-wide">
                {cashComplianceRequired ? "Compliance: Cash >= Rs 2,00,000" : "Compliance: URD Exchange"}
              </p>
              <Field label="PAN Number">
                <input placeholder="ABCDE1234F" value={panNumber} onChange={(event) => setPanNumber(event.target.value.toUpperCase())} className={dangerControlClassName} />
              </Field>
              <Field label="Aadhaar Number">
                <input placeholder="12 Digits" value={aadhaarNumber} onChange={(event) => setAadhaarNumber(event.target.value.replace(/\D/g, ""))} className={dangerControlClassName} maxLength={12} />
              </Field>
              <Field label="Identity Document scan">
                <div className="flex gap-1.5 items-center mt-1">
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="text-[10px] text-slate-400 file:mr-2 file:py-0.5 file:px-1.5 file:border-0 file:text-[10px] file:font-semibold file:bg-slate-800 file:text-slate-200 file:cursor-pointer" />
                  {uploading && <span className="text-[9px] text-amber-400 uppercase animate-pulse">Uploading</span>}
                  {documentImagePath && <span className="text-[9px] text-emerald-400 uppercase font-bold">✓ Uploaded</span>}
                </div>
              </Field>
            </div>
          )}

          <div className="grid gap-2 border-t border-slate-800 pt-3 text-xs">
            <StatusLine label="Selected" value={customerId ? "Customer" : walkInName ? walkInName : "Anonymous"} />
            <StatusLine label="Cart Items" value={String(cart.length)} />
            <StatusLine label="Cash Compliance" value={kycRequired ? "Required" : "Clear"} />
          </div>

          <div className="grid gap-2 border-t border-slate-800 pt-3">
            <div className="text-[10px] font-semibold uppercase text-slate-500">Invoice Details</div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Prefix" value={invoiceMeta.billPrefix} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, billPrefix: event.target.value.toUpperCase() })} className={controlClassName} />
              <input placeholder="Manual No." value={invoiceMeta.manualNumber} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, manualNumber: event.target.value })} className={controlClassName} />
              <input type="date" value={invoiceMeta.dueDate} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, dueDate: event.target.value })} className={controlClassName} />
              <input placeholder="Salesman" value={invoiceMeta.salesmanName} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, salesmanName: event.target.value })} className={controlClassName} />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <input type="checkbox" checked={invoiceMeta.gstNotRequired} onChange={(event) => setInvoiceMeta({ ...invoiceMeta, gstNotRequired: event.target.checked })} />
              GST Not Required
            </label>
          </div>
        </section>
      </aside>

      <main className="grid min-h-0 grid-rows-[1fr_230px]">
        <section className="grid min-h-0 grid-rows-[auto_1fr] border-b border-slate-800">
          <PanelHeader title="Sales Cart" note="Scanned items append here" />
          <div className="min-h-0 overflow-hidden">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  {["Barcode", "Category", "Purity", "Net Wt (g)", "Metal Rate", "Making", "Item Total", ""].map((heading) => (
                    <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-10 text-center text-slate-600">
                      Scan a barcode or search to add items to the bill.
                    </td>
                  </tr>
                ) : cart.map((line, i) => {
                  const lineTotalPaise = calculateCartLineTotalPaise(line);

                  return (
                    <tr key={line.id} className="animate-fade-in border-b border-slate-900 transition-colors hover:bg-slate-900/50" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                      <td className="truncate px-2 py-2 font-mono">{line.barcode}</td>
                      <td className="truncate px-2 py-2">{line.category}</td>
                      <td className="px-2 py-2">{line.purity_karat}K</td>
                      <td className="px-2 py-2 font-mono">{formatMg(line.net_weight_mg)}</td>
                      <td className="px-2 py-2">
                        <input
                          value={line.metalRateRupees}
                          onChange={(event) => setCart((current) => current.map((item) => item.id === line.id ? { ...item, metalRateRupees: event.target.value } : item))}
                          className={tableInputClassName}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={line.makingRupees}
                          onChange={(event) => setCart((current) => current.map((item) => item.id === line.id ? { ...item, makingRupees: event.target.value } : item))}
                          className={tableInputClassName}
                          inputMode="decimal"
                          title={line.making_charge_type === "PER_GRAM" ? "Making per gram (₹)" : "Flat making (₹)"}
                        />
                      </td>
                      <td className="px-2 py-2 font-mono">{formatPaise(lineTotalPaise)}</td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}
                          title="Remove item"
                          className="inline-grid h-7 w-7 place-items-center rounded text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300 active:scale-90"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid min-h-0 grid-rows-[auto_auto_1fr]">
          <PanelHeader title="URD / Old Gold Exchange" note="Buy-back deduction" />
          <div className="grid grid-cols-[1fr_90px_90px_110px_70px] gap-2 border-b border-slate-800 bg-slate-900 p-2">
            <input placeholder="Description" value={urdDraft.description} onChange={(event) => setUrdDraft({ ...urdDraft, description: event.target.value })} className={controlClassName} />
            <input placeholder="Tunch" value={urdDraft.purityTunch} onChange={(event) => setUrdDraft({ ...urdDraft, purityTunch: event.target.value })} className={controlClassName} />
            <input placeholder="Wt g" value={urdDraft.weightG} onChange={(event) => setUrdDraft({ ...urdDraft, weightG: event.target.value })} className={controlClassName} />
            <input placeholder="Rate" value={urdDraft.appliedRateRupees} onChange={(event) => setUrdDraft({ ...urdDraft, appliedRateRupees: event.target.value })} className={controlClassName} />
            <button type="button" onClick={addUrdLine} className="rounded bg-slate-700 text-xs font-semibold uppercase text-slate-100 transition hover:bg-slate-600 active:scale-95">Add</button>
          </div>
          <div className="min-h-0 overflow-hidden">
            <table className="w-full text-left text-xs">
              <tbody>
                {urdLines.map((line) => (
                  <tr key={line.id} className="border-b border-slate-900">
                    <td className="px-2 py-1">{line.description}</td>
                    <td className="px-2 py-1">{line.purityTunch}</td>
                    <td className="px-2 py-1 font-mono">{line.weightG} g</td>
                    <td className="px-2 py-1 font-mono">Rs {line.appliedRateRupees}</td>
                    <td className="px-2 py-1 font-mono">{formatPaise(calculateUrdLinePaise(line))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <aside className="grid min-h-0 grid-rows-[auto_auto_1fr_auto] border-l border-slate-800 bg-slate-900 p-3">
        <section className="grid gap-2 border-b border-slate-800 pb-3">
          <SummaryLine label="Total Gross" value={formatPaise(totals.grossTotalPaise)} />
          <label className="grid grid-cols-[1fr_120px] items-center gap-2 text-xs">
            <span className="text-slate-400">Total Discount</span>
            <input value={discountRupees} onChange={(event) => setDiscountRupees(event.target.value)} className={tableInputClassName} inputMode="decimal" />
          </label>
          <SummaryLine label="URD Deduction" value={formatPaise(totals.urdDeductionPaise)} />
          <SummaryLine label="GSS Credit Applied" value={formatPaise(totals.gssCreditAppliedPaise)} />
          <SummaryLine label="Net Payable" strong testId="net-payable" dataPaise={totals.netPayablePaise} value={<CountUp value={totals.netPayablePaise} format={(n) => formatPaise(Math.round(n))} />} />
        </section>

        <section className="grid gap-2 border-b border-slate-800 py-3">
          {posCreditBalance && (
            <div className="grid gap-2 border border-emerald-700 bg-emerald-950/30 p-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-semibold uppercase text-emerald-200">GSS POS Credit</span>
                <span className="font-mono text-emerald-100">{formatPaise(posCreditBalance.total_credit_paise)}</span>
              </div>
              <div className="flex justify-between gap-2 text-[11px] text-slate-300">
                <span>{posCreditBalance.card_number}</span>
                <span>{posCreditBalance.customer_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGssCreditAppliedPaise(Math.min(posCreditBalance.total_credit_paise, totals.netPayableBeforeGssPaise))}
                  className="h-7 rounded bg-emerald-500 text-[11px] font-semibold uppercase text-slate-50 transition hover:bg-emerald-400 active:scale-95"
                >
                  Apply Credit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGssCreditAppliedPaise(0);
                    clearPosCreditBalance();
                  }}
                  className="h-7 border border-slate-700 text-[11px] font-semibold uppercase text-slate-300"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <PaymentInput label="Cash" value={payments.cash} onChange={(cash) => setPayments({ ...payments, cash })} />
          <PaymentInput label="UPI" value={payments.upi} onChange={(upi) => setPayments({ ...payments, upi })} />
          <PaymentInput label="Card" value={payments.card} onChange={(card) => setPayments({ ...payments, card })} />
          <PaymentInput label="Udhari" value={payments.udhari} onChange={(udhari) => setPayments({ ...payments, udhari })} />
          <input placeholder="Bank name" value={paymentReferences.bankName} onChange={(event) => setPaymentReferences({ ...paymentReferences, bankName: event.target.value })} className={controlClassName} />
          <input placeholder="UPI Ref" value={paymentReferences.upiReference} onChange={(event) => setPaymentReferences({ ...paymentReferences, upiReference: event.target.value })} className={controlClassName} />
          <input placeholder="Card / Cheque / NEFT Ref" value={paymentReferences.cardReference || paymentReferences.chequeReference || paymentReferences.neftReference} onChange={(event) => setPaymentReferences({ ...paymentReferences, cardReference: event.target.value, chequeReference: event.target.value, neftReference: event.target.value })} className={controlClassName} />
        </section>

        <section className="grid content-start gap-2 py-3">
          <div data-testid="balance-remaining" data-paise={totals.balanceRemainingPaise} className={`rounded-md border p-3 text-center transition-colors duration-300 ${totals.balanceRemainingPaise === 0 ? "border-emerald-600 bg-emerald-950/30" : "border-amber-600 bg-amber-950/30"}`}>
            <div className="flex items-center justify-center gap-1 text-[10px] uppercase text-slate-400">
              Balance Remaining
              {totals.balanceRemainingPaise === 0 && cart.length > 0 && <CheckCircle2 className="h-3 w-3 animate-pop text-emerald-400" />}
            </div>
            <CountUp
              value={totals.balanceRemainingPaise}
              format={(n) => formatPaise(Math.round(n))}
              className={`font-mono text-2xl font-semibold ${totals.balanceRemainingPaise === 0 ? "text-emerald-300" : "text-amber-200"}`}
            />
          </div>
          {(message || error) && <p className={`animate-fade-in text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>}
        </section>

        <button
          type="submit"
          disabled={checkoutDisabled || submitting}
          className="flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-500 text-sm font-semibold uppercase text-slate-50 transition active:scale-[0.98] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : "Checkout"}
        </button>
        <button
          type="button"
          onClick={() => void saveAsQuotation()}
          disabled={cart.length === 0 || submitting}
          title="Save the current cart as a quotation without billing or reducing stock"
          className="mt-2 flex h-9 items-center justify-center gap-2 rounded-md border border-slate-600 text-xs font-semibold uppercase text-slate-200 transition hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
        >
          Save as Quotation
        </button>
      </aside>

      {printInvoiceId && (
        <PrintModal
          invoiceId={printInvoiceId}
          apiBaseUrl={apiBaseUrl}
          onClose={() => setPrintInvoiceId(null)}
          customerPhone={printContext?.phone ?? null}
          invoiceNumber={printContext?.invoiceNumber ?? ""}
        />
      )}

      {showCreditConfirm && (
        <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="animate-scale-in w-full max-w-sm rounded-lg border border-amber-700 bg-slate-950 p-4 text-center shadow-xl">
            <h2 className="text-sm font-bold uppercase text-amber-300">Save on Credit?</h2>
            <p className="mt-2 text-xs text-slate-300">
              This bill puts ₹{(rupeesToPaise(payments.udhari) / 100).toFixed(2)} on customer credit (udhari). Continue?
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" onClick={() => setShowCreditConfirm(false)} className="rounded border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 active:scale-95">
                Cancel
              </button>
              <button type="button" onClick={() => void submitCheckout()} className="rounded bg-amber-500 px-4 py-2 text-xs font-bold uppercase text-slate-50 transition hover:bg-amber-400 active:scale-95">
                Yes, Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomerModal && (
        <CustomerMaster
          apiBaseUrl={apiBaseUrl}
          onClose={() => setShowCustomerModal(false)}
          onSaved={handleCustomerSaved}
        />
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
      {label}
      {children}
    </label>
  );
}

function PanelHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
      <h2 className="text-xs font-semibold uppercase text-slate-50">{title}</h2>
      <span className="text-[11px] text-slate-500">{note}</span>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  );
}

function SummaryLine({ label, value, strong = false, testId, dataPaise }: { label: string; value: React.ReactNode; strong?: boolean; testId?: string; dataPaise?: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span data-testid={testId} data-paise={dataPaise} className={`font-mono ${strong ? "text-lg font-semibold text-slate-50" : "text-slate-200"}`}>{value}</span>
    </div>
  );
}

function PaymentInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[1fr_120px] items-center gap-2 text-xs">
      <span className="font-semibold uppercase text-slate-400">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className={tableInputClassName} inputMode="decimal" />
    </label>
  );
}

function PrintModal({
  invoiceId,
  apiBaseUrl,
  onClose,
  customerPhone,
  invoiceNumber
}: {
  invoiceId: number;
  apiBaseUrl: string;
  onClose: () => void;
  customerPhone?: string | null;
  invoiceNumber?: string;
}) {
  const { session } = useAuthSession();

  function sendWhatsApp() {
    if (!customerPhone) return;
    const digits = customerPhone.replace(/\D/g, "");
    const phone = digits.length === 10 ? `91${digits}` : digits;
    const text = encodeURIComponent(`Thank you for your purchase. Your invoice ${invoiceNumber || `#${invoiceId}`} is ready.`);
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
  }
  const [templates, setTemplates] = useState<Array<{ id: number; name: string; page_size: string; document_type: string; is_default: boolean }>>([]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/settings/print-templates`, {
          headers: { Authorization: `Bearer ${session?.token ?? ""}` }
        });
        const result = (await response.json().catch(() => null)) as { templates?: Array<{ id: number; name: string; page_size: string; document_type: string; is_default: boolean }> } | null;
        if (response.ok && result?.templates) {
          setTemplates(result.templates.filter((template) => template.document_type !== "LABEL"));
        }
      } catch {
        setTemplates([]);
      }
    }

    void loadTemplates();
  }, [apiBaseUrl, session?.token]);

  function openDocument(kind: "a4" | "a5" | "thermal") {
    window.open(withDocumentToken(`${apiBaseUrl}/api/documents/invoice/${invoiceId}/${kind}`), "_blank", "noopener,noreferrer");
  }

  function openTemplate(templateId: number) {
    window.open(withDocumentToken(`${apiBaseUrl}/api/documents/invoice/${invoiceId}/template/${templateId}`), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="animate-scale-in grid w-full max-w-sm gap-3 border border-slate-700 bg-slate-950 p-4 shadow-xl rounded-lg">
        <div className="border-b border-slate-800 pb-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase text-slate-50">
            <CheckCircle2 className="h-4 w-4 animate-pop text-emerald-400" /> Invoice Saved
          </h2>
          <p className="mt-1 text-xs text-slate-400">Invoice #{invoiceId} saved successfully.</p>
          {customerPhone && <p className="mt-1 text-xs font-semibold text-emerald-300">Send digital receipt to customer?</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => openDocument("a4")}
            className="h-12 bg-emerald-500 text-[10px] font-bold uppercase text-slate-50 hover:bg-emerald-400 rounded transition flex flex-col justify-center items-center px-1"
          >
            <span>Print A4</span>
            <span className="text-[8px] opacity-75">(GST)</span>
          </button>
          <button
            type="button"
            onClick={() => openDocument("a5")}
            className="h-12 bg-slate-800 text-[10px] font-bold uppercase text-slate-200 border border-slate-700 hover:bg-slate-700 rounded transition flex flex-col justify-center items-center px-1"
          >
            <span>Print A5</span>
            <span className="text-[8px] opacity-75">(A5 Land)</span>
          </button>
          <button
            type="button"
            onClick={() => openDocument("thermal")}
            className="h-12 border border-slate-700 text-[10px] font-bold uppercase text-slate-300 hover:border-emerald-400 rounded transition flex flex-col justify-center items-center px-1"
          >
            <span>Thermal</span>
            <span className="text-[8px] opacity-75">(80mm)</span>
          </button>
        </div>
        {templates.length > 0 && (
          <div className="grid gap-2 border-t border-slate-800 pt-3">
            <div className="text-[10px] font-semibold uppercase text-slate-500">Saved Templates</div>
            <div className="grid gap-1.5">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => openTemplate(template.id)}
                  className="flex h-8 items-center justify-between border border-slate-700 px-2 text-left text-[11px] font-semibold uppercase text-slate-200 hover:border-emerald-400"
                >
                  <span>{template.name}</span>
                  <span className="font-mono text-slate-500">{template.page_size}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {customerPhone && (
          <button
            type="button"
            onClick={sendWhatsApp}
            className="flex h-9 items-center justify-center gap-2 rounded bg-emerald-600 text-xs font-bold uppercase text-slate-50 transition hover:bg-emerald-500 active:scale-95"
          >
            <MessageSquare className="h-4 w-4" /> Send WhatsApp
          </button>
        )}
        <button type="button" onClick={onClose} className="h-8 text-xs font-semibold uppercase text-slate-400 hover:text-slate-50">
          Close
        </button>
      </div>
    </div>
  );
}

function calculateTotals(
  cart: CartLine[],
  urdLines: UrdLine[],
  discountRupees: string,
  payments: PaymentState,
  gssCreditAppliedPaise: number,
  loyaltyRedeemPaise = 0
) {
  const grossTotalPaise = cart.reduce((total, line) => total + calculateCartLineTotalPaise(line), 0);
  const discountPaise = rupeesToPaise(discountRupees);
  const urdDeductionPaise = urdLines.reduce((total, line) => total + calculateUrdLinePaise(line), 0);
  const netPayableBeforeGssPaise = Math.max(grossTotalPaise - discountPaise - urdDeductionPaise, 0);
  const boundedGssCreditAppliedPaise = Math.min(Math.max(gssCreditAppliedPaise, 0), netPayableBeforeGssPaise);
  const netAfterGssPaise = Math.max(netPayableBeforeGssPaise - boundedGssCreditAppliedPaise, 0);
  const boundedLoyaltyRedeemPaise = Math.min(Math.max(loyaltyRedeemPaise, 0), netAfterGssPaise);
  const netPayablePaise = Math.max(netAfterGssPaise - boundedLoyaltyRedeemPaise, 0);
  const cashPaidPaise = rupeesToPaise(payments.cash);
  const paidPaise = cashPaidPaise + rupeesToPaise(payments.upi) + rupeesToPaise(payments.card) + rupeesToPaise(payments.udhari);

  return {
    grossTotalPaise,
    discountPaise,
    urdDeductionPaise,
    netPayableBeforeGssPaise,
    gssCreditAppliedPaise: boundedGssCreditAppliedPaise,
    loyaltyRedeemPaise: boundedLoyaltyRedeemPaise,
    netPayablePaise,
    cashPaidPaise,
    paidPaise,
    balanceRemainingPaise: netPayablePaise - paidPaise
  };
}

function calculateCartLineTotalPaise(line: CartLine) {
  const metalValuePaise = paisePerGramToLinePaise(rupeesToPaise(line.metalRateRupees), line.net_weight_mg);
  const makingChargePaise = calculateMakingChargePaise(line);

  return metalValuePaise + makingChargePaise;
}

function calculateMakingChargePaise(line: CartLine) {
  const makingValuePaise = rupeesToPaise(line.makingRupees);
  return line.making_charge_type === "PER_GRAM"
    ? paisePerGramToLinePaise(makingValuePaise, line.net_weight_mg)
    : makingValuePaise;
}

function calculateUrdLinePaise(line: UrdLine) {
  return paisePerGramToLinePaise(rupeesToPaise(line.appliedRateRupees), gramsToMg(line.weightG));
}

function paisePerGramToLinePaise(ratePaisePerGram: number, weightMg: number) {
  return Math.round((ratePaisePerGram * weightMg) / 1000);
}

function buildCheckoutPayload({
  customerId,
  walkInName,
  panNumber,
  aadhaarNumber,
  documentImagePath,
  cart,
  urdLines,
  discountRupees,
  payments,
  paymentReferences,
  invoiceMeta,
  posCreditBalance,
  gssCreditAppliedPaise,
  oldDuesRupees,
  loyaltyRedeemPoints,
  totals
}: {
  customerId: string;
  walkInName: string;
  panNumber: string;
  aadhaarNumber: string;
  documentImagePath: string | null;
  cart: CartLine[];
  urdLines: UrdLine[];
  discountRupees: string;
  payments: PaymentState;
  paymentReferences: PaymentReferenceState;
  invoiceMeta: InvoiceMetaState;
  posCreditBalance: ReturnType<typeof usePOSCredit>["posCreditBalance"];
  gssCreditAppliedPaise: number;
  oldDuesRupees: string;
  loyaltyRedeemPoints: string;
  totals: ReturnType<typeof calculateTotals>;
}) {
  return {
    customer_id: customerId ? Number(customerId) : null,
    walk_in_name: walkInName.trim() || null,
    pan_number: panNumber.trim() || null,
    aadhaar_number: aadhaarNumber.trim() || null,
    document_image_path: documentImagePath,
    sales_items: cart.map((line) => ({
      item_id: line.id,
      barcode: line.barcode,
      net_weight_mg: line.net_weight_mg,
      metal_rate_paise_per_gram: rupeesToPaise(line.metalRateRupees),
      making_charge_paise: calculateMakingChargePaise(line),
      item_total_paise: calculateCartLineTotalPaise(line)
    })),
    urd_items: urdLines.map((line) => ({
      description: line.description.trim(),
      purity_tunch: line.purityTunch.trim(),
      weight_mg: gramsToMg(line.weightG),
      applied_rate_paise_per_gram: rupeesToPaise(line.appliedRateRupees),
      total_value_paise: calculateUrdLinePaise(line)
    })),
    totals_paise: {
      gross_total: totals.grossTotalPaise,
      discount: rupeesToPaise(discountRupees),
      urd_deduction: totals.urdDeductionPaise,
      net_payable: totals.netPayablePaise
    },
    payments_paise: {
      cash: rupeesToPaise(payments.cash),
      upi: rupeesToPaise(payments.upi),
      card: rupeesToPaise(payments.card),
      udhari: rupeesToPaise(payments.udhari),
      gss_credit: totals.gssCreditAppliedPaise
    },
    payment_references: {
      bank_name: paymentReferences.bankName.trim() || null,
      upi_reference: paymentReferences.upiReference.trim() || null,
      card_reference: paymentReferences.cardReference.trim() || null,
      cheque_reference: paymentReferences.chequeReference.trim() || null,
      dd_reference: paymentReferences.ddReference.trim() || null,
      neft_reference: paymentReferences.neftReference.trim() || null
    },
    invoice: {
      bill_prefix: invoiceMeta.billPrefix.trim() || null,
      manual_number: invoiceMeta.manualNumber.trim() || null,
      due_date: invoiceMeta.dueDate || null,
      salesman_name: invoiceMeta.salesmanName.trim() || null,
      gst_not_required: invoiceMeta.gstNotRequired
    },
    gss_credit:
      posCreditBalance && gssCreditAppliedPaise > 0
        ? {
            gss_account_id: posCreditBalance.gss_account_id,
            card_number: posCreditBalance.card_number,
            principal_paise: posCreditBalance.principal_paise,
            bonus_paise: posCreditBalance.bonus_paise,
            available_credit_paise: posCreditBalance.total_credit_paise,
            applied_credit_paise: totals.gssCreditAppliedPaise
          }
        : null,
    old_dues_payment_paise: rupeesToPaise(oldDuesRupees),
    old_dues_payment_mode: "CASH",
    loyalty_points_redeemed: Math.max(0, Math.trunc(Number(loyaltyRedeemPoints) || 0))
  };
}

function getDefaultRateForItem(item: InventoryItem, rates: RatesState) {
  if (item.metal_type.toLowerCase() === "silver") {
    return rates.silver;
  }

  if (item.purity_karat >= 24) return rates.gold24k;
  if (item.purity_karat >= 22) return rates.gold22k;

  return rates.gold18k;
}

function createEmptyUrdLine(): UrdLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    purityTunch: "",
    weightG: "",
    appliedRateRupees: ""
  };
}

function rupeesToPaise(value: string) {
  return decimalToScaledInteger(value, 100, 2);
}

function gramsToMg(value: string) {
  return decimalToScaledInteger(value, 1000, 3);
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3) {
  const trimmed = value.trim();

  if (!trimmed) return 0;

  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) return 0;

  const decimal = (match[2] ?? "").slice(0, maxDecimalPlaces).padEnd(maxDecimalPlaces, "0");

  return Number(match[1]) * scale + Number(decimal || "0");
}

function formatPaise(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const rupees = Math.trunc(absolute / 100);
  const paise = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees}.${paise}`;
}

function formatMg(value: number) {
  const grams = Math.trunc(value / 1000);
  const milligrams = String(value % 1000).padStart(3, "0");

  return `${grams}.${milligrams}`;
}

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400";
const dangerControlClassName =
  "h-8 w-full border border-red-500 bg-red-950/40 px-2 text-xs text-slate-50 outline-none focus:border-red-300";
const tableInputClassName =
  "h-7 w-full border border-slate-700 bg-slate-950 px-2 text-right font-mono text-xs text-slate-50 outline-none focus:border-emerald-400";

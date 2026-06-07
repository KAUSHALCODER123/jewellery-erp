import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { withDocumentToken } from "../utils/documentAuth.js";

type StandaloneUrdVoucherProps = {
  apiBaseUrl?: string;
};

type ActiveTab = "create" | "vouchers" | "pos-purchases";

type FormState = {
  customerName: string;
  customerPhone: string;
  voucherDate: string;
  description: string;
  metalType: string;
  purityTunch: string;
  grossWeightG: string;
  stoneWeightG: string;
  blackBeadWeightG: string;
  appliedRateRs: string;
  paymentMode: string;
  paymentReference: string;
  panNumber: string;
  aadhaarNumber: string;
};

type UrdVoucher = {
  id: number;
  voucher_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  voucher_date: string;
  description: string;
  metal_type: string;
  purity_tunch: string;
  gross_weight_mg: number;
  stone_weight_mg: number;
  black_bead_weight_mg: number;
  net_weight_mg: number;
  fine_weight_mg: number;
  applied_rate_paise_per_gram: number;
  total_value_paise: number;
  payment_mode: string;
  payment_reference: string | null;
  pan_number: string | null;
  aadhaar_number: string | null;
  stock_item_id: number | null;
  refinery_transfer_id: number | null;
  stock_status: string;
  kyc_verified: boolean;
  gross_weight_g: string;
  stone_weight_g: string;
  black_bead_weight_g: string;
  net_weight_g: string;
  fine_weight_g: string;
  total_value_rupees: string;
  legal_receipt_url: string;
  can_ingest_stock: boolean;
  can_transfer_refinery: boolean;
};

type UrdPurchase = {
  id: number;
  invoice_id: number;
  invoice_number: string;
  customer_name: string;
  customer_phone: string | null;
  description: string;
  metal_type: string;
  purity_tunch: string;
  weight_mg: number;
  applied_rate_paise_per_gram: number;
  deduction_amount_paise: number;
  stock_item_id: number | null;
  refinery_transfer_id: number | null;
  stock_status: string;
  pan_number: string | null;
  aadhaar_number: string | null;
  kyc_verified: boolean;
  total_value_rupees: string;
};

type Refinery = {
  id: number;
  name: string;
};

const initialForm: FormState = {
  customerName: "",
  customerPhone: "",
  voucherDate: new Date().toISOString().slice(0, 10),
  description: "Old Gold Purchase",
  metalType: "Gold",
  purityTunch: "91.6",
  grossWeightG: "",
  stoneWeightG: "0",
  blackBeadWeightG: "0",
  appliedRateRs: "",
  paymentMode: "CASH",
  paymentReference: "",
  panNumber: "",
  aadhaarNumber: ""
};

export default function StandaloneUrdVoucher({ apiBaseUrl = "" }: StandaloneUrdVoucherProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("create");
  const [form, setForm] = useState<FormState>(initialForm);
  const [documentImagePath, setDocumentImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  
  // Registries
  const [vouchersList, setVouchersList] = useState<UrdVoucher[]>([]);
  const [purchasesList, setPurchasesList] = useState<UrdPurchase[]>([]);
  const [refineriesList, setRefineriesList] = useState<Refinery[]>([]);

  // Modals state
  const [activeModal, setActiveModal] = useState<"ingest" | "transfer" | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<number | null>(null);
  const [ingestBarcode, setIngestBarcode] = useState("");
  const [ingestLocation, setIngestLocation] = useState("OLD_GOLD_VAULT");
  const [transferRefineryId, setTransferRefineryId] = useState("");
  const [transferDescription, setTransferDescription] = useState("");

  const weights = useMemo(() => {
    const gross = parseNumber(form.grossWeightG);
    const stone = parseNumber(form.stoneWeightG) ?? 0;
    const blackBead = parseNumber(form.blackBeadWeightG) ?? 0;
    const purity = parseNumber(form.purityTunch);
    const rate = parseNumber(form.appliedRateRs);
    const net = gross === undefined ? undefined : gross - stone - blackBead;
    const fine = net === undefined || purity === undefined ? undefined : (net * purity) / 100;
    const total = net === undefined || rate === undefined ? undefined : net * rate;

    return { gross, net, fine, total };
  }, [form.appliedRateRs, form.blackBeadWeightG, form.grossWeightG, form.purityTunch, form.stoneWeightG]);

  useEffect(() => {
    if (activeTab === "vouchers") {
      void loadVouchers();
    } else if (activeTab === "pos-purchases") {
      void loadPurchases();
    }
  }, [activeTab]);

  useEffect(() => {
    void loadRefineries();
  }, []);

  async function loadVouchers() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/urd-vouchers`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result?.vouchers) {
        setVouchersList(result.vouchers);
      }
    } catch {
      setVouchersList([]);
    }
  }

  async function loadPurchases() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/urd-purchases`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result?.purchases) {
        setPurchasesList(result.purchases);
      }
    } catch {
      setPurchasesList([]);
    }
  }

  async function loadRefineries() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/refineries`, { headers: authHeaders });
      const result = await response.json();
      if (response.ok && result?.refineries) {
        setRefineriesList(result.refineries);
      }
    } catch {
      setRefineriesList([]);
    }
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

  async function saveVoucher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    // Regex checks
    if (form.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(form.panNumber)) {
      setError("PAN must be a valid 10-character alphanumeric format (e.g. ABCDE1234F).");
      return;
    }
    if (form.aadhaarNumber && !/^\d{12}$/.test(form.aadhaarNumber)) {
      setError("Aadhaar must be exactly 12 digits.");
      return;
    }

    const grossWeightMg = decimalToScaledInteger(form.grossWeightG, 1000, 3);
    const stoneWeightMg = decimalToScaledInteger(form.stoneWeightG, 1000, 3);
    const blackBeadWeightMg = decimalToScaledInteger(form.blackBeadWeightG, 1000, 3);
    const appliedRatePaise = decimalToScaledInteger(form.appliedRateRs, 100, 2);
    const totalValuePaise = weights.total === undefined ? { ok: false as const, value: 0 } : { ok: true as const, value: Math.round(weights.total * 100) };

    if (!grossWeightMg.ok || !stoneWeightMg.ok || !blackBeadWeightMg.ok || !appliedRatePaise.ok || !totalValuePaise.ok || !form.customerName.trim()) {
      setError("Enter customer name, valid weights, purity, and rate.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/urd-vouchers`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.customerName,
          customer_phone: form.customerPhone || null,
          voucher_date: form.voucherDate,
          description: form.description,
          metal_type: form.metalType,
          purity_tunch: form.purityTunch,
          gross_weight_mg: grossWeightMg.value,
          stone_weight_mg: stoneWeightMg.value,
          black_bead_weight_mg: blackBeadWeightMg.value,
          applied_rate_paise_per_gram: appliedRatePaise.value,
          total_value_paise: totalValuePaise.value,
          payment_mode: form.paymentMode,
          payment_reference: form.paymentReference || null,
          pan_number: form.panNumber || null,
          aadhaar_number: form.aadhaarNumber || null,
          document_image_path: documentImagePath
        })
      });
      const result = await response.json();

      if (!response.ok || !result?.voucher) {
        throw new Error(result?.errors?.join(" ") || "Could not save URD voucher.");
      }

      setMessage(`URD voucher ${result.voucher.voucher_number} saved successfully.`);
      setForm(initialForm);
      setDocumentImagePath(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save URD voucher.");
    }
  }

  async function verifyKyc(id: number) {
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/urd-vouchers/${id}/verify-kyc`, {
        method: "PATCH",
        headers: authHeaders
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to verify KYC.");
      }
      setMessage("KYC verified successfully.");
      void loadVouchers();
    } catch (err: any) {
      setError(err.message || "Failed to verify KYC.");
    }
  }

  async function printReceipt(voucher: UrdVoucher) {
    window.open(withDocumentToken(`${apiBaseUrl}${voucher.legal_receipt_url}`), "_blank", "noopener,noreferrer");
  }

  function openIngest(id: number, type: "voucher" | "purchase") {
    if (type === "voucher") {
      setSelectedVoucherId(id);
      setSelectedPurchaseId(null);
      const v = vouchersList.find(x => x.id === id);
      // voucher_number already carries the "URD-" prefix; don't double it.
      setIngestBarcode(v ? v.voucher_number : "");
    } else {
      setSelectedPurchaseId(id);
      setSelectedVoucherId(null);
      setIngestBarcode(`URD-PUR-${id}`);
    }
    setActiveModal("ingest");
  }

  async function submitIngest() {
    setError("");
    setMessage("");
    const isVoucher = selectedVoucherId !== null;
    const id = isVoucher ? selectedVoucherId : selectedPurchaseId;
    const url = isVoucher 
      ? `${apiBaseUrl}/api/pos/urd-vouchers/${id}/ingest-stock`
      : `${apiBaseUrl}/api/pos/urd-purchases/${id}/ingest-stock`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: ingestBarcode.trim() || undefined,
          location: ingestLocation.trim() || undefined
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to ingest stock.");
      }
      setMessage("Stock ingested successfully under barcode " + result.item.barcode);
      setActiveModal(null);
      if (isVoucher) void loadVouchers(); else void loadPurchases();
    } catch (err: any) {
      setError(err.message || "Failed to ingest stock.");
    }
  }

  function openTransfer(id: number, type: "voucher" | "purchase") {
    if (type === "voucher") {
      setSelectedVoucherId(id);
      setSelectedPurchaseId(null);
      const v = vouchersList.find(x => x.id === id);
      setTransferDescription(v ? `Melting URD Voucher ${v.voucher_number}` : "");
    } else {
      setSelectedPurchaseId(id);
      setSelectedVoucherId(null);
      setTransferDescription(`Melting POS Purchase ID ${id}`);
    }
    setActiveModal("transfer");
  }

  async function submitTransfer() {
    setError("");
    setMessage("");
    const isVoucher = selectedVoucherId !== null;
    const id = isVoucher ? selectedVoucherId : selectedPurchaseId;
    const url = isVoucher 
      ? `${apiBaseUrl}/api/pos/urd-vouchers/${id}/transfer-refinery`
      : `${apiBaseUrl}/api/pos/urd-purchases/${id}/transfer-refinery`;

    if (!transferRefineryId) {
      setError("Please select a refinery.");
      return;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          refinery_id: Number(transferRefineryId),
          transfer_date: new Date().toISOString().slice(0, 10),
          description: transferDescription.trim() || undefined
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to transfer to refinery.");
      }
      setMessage("Transferred and scrap issued to refinery liability.");
      setActiveModal(null);
      if (isVoucher) void loadVouchers(); else void loadPurchases();
    } catch (err: any) {
      setError(err.message || "Failed to transfer to refinery.");
    }
  }

  return (
    <section className="grid min-h-screen grid-rows-[auto_1fr] bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold uppercase tracking-wider text-slate-50">URD Old-Gold Workspace</h1>
          <p className="text-xs text-slate-400">Manage customer old-gold purchases, stock ingestion, melting, and KYC</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <TabButton active={activeTab === "create"} onClick={() => setActiveTab("create")}>New Standalone Voucher</TabButton>
          <TabButton active={activeTab === "vouchers"} onClick={() => setActiveTab("vouchers")}>Standalone Registry</TabButton>
          <TabButton active={activeTab === "pos-purchases"} onClick={() => setActiveTab("pos-purchases")}>POS Exchange Registry</TabButton>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-4 py-2 text-xs font-semibold ${error ? "bg-red-950/40 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="p-4 overflow-auto">
        {activeTab === "create" && (
          <div className="grid grid-cols-[520px_1fr] gap-4 items-start">
            <form onSubmit={saveVoucher} className="grid content-start gap-4 border border-slate-800 bg-slate-900 p-4 rounded shadow-md">
              <header className="border-b border-slate-800 pb-2">
                <h2 className="text-xs font-bold uppercase text-slate-50 tracking-wide">Purchase Details</h2>
              </header>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Customer Name"><input value={form.customerName} onChange={(event) => setField("customerName", event.target.value)} className={controlClassName} required /></Field>
                <Field label="Mobile"><input value={form.customerPhone} onChange={(event) => setField("customerPhone", event.target.value)} className={controlClassName} /></Field>
                <Field label="Date"><input type="date" value={form.voucherDate} onChange={(event) => setField("voucherDate", event.target.value)} className={controlClassName} /></Field>
                <Field label="Metal"><select value={form.metalType} onChange={(event) => setField("metalType", event.target.value)} className={controlClassName}><option>Gold</option><option>Silver</option></select></Field>
                <Field label="Description"><input value={form.description} onChange={(event) => setField("description", event.target.value)} className={controlClassName} /></Field>
                <Field label="Tunch (Purity %)"><input value={form.purityTunch} onChange={(event) => setField("purityTunch", event.target.value)} className={controlClassName} inputMode="decimal" /></Field>
                <Field label="Gross Wt (g)"><input value={form.grossWeightG} onChange={(event) => setField("grossWeightG", event.target.value)} className={controlClassName} inputMode="decimal" required /></Field>
                <Field label="Stone Wt (g)"><input value={form.stoneWeightG} onChange={(event) => setField("stoneWeightG", event.target.value)} className={controlClassName} inputMode="decimal" /></Field>
                <Field label="Black Bead Wt (g)"><input value={form.blackBeadWeightG} onChange={(event) => setField("blackBeadWeightG", event.target.value)} className={controlClassName} inputMode="decimal" /></Field>
                <Field label="Purchase Rate / g (Rs)"><input value={form.appliedRateRs} onChange={(event) => setField("appliedRateRs", event.target.value)} className={controlClassName} inputMode="decimal" required /></Field>
                <Field label="Payment Mode"><select value={form.paymentMode} onChange={(event) => setField("paymentMode", event.target.value)} className={controlClassName}><option>CASH</option><option>UPI</option><option>NEFT</option><option>CHEQUE</option></select></Field>
                <Field label="Payment Ref"><input value={form.paymentReference} onChange={(event) => setField("paymentReference", event.target.value)} className={controlClassName} /></Field>
              </div>

              <header className="border-b border-slate-800 pb-2 pt-2">
                <h2 className="text-xs font-bold uppercase text-slate-50 tracking-wide">Stronger KYC Details</h2>
              </header>
              <div className="grid grid-cols-2 gap-3">
                <Field label="PAN Number (10-char Alphanumeric)"><input placeholder="ABCDE1234F" value={form.panNumber} onChange={(event) => setField("panNumber", event.target.value.toUpperCase())} className={controlClassName} /></Field>
                <Field label="Aadhaar Number (12 Digits)"><input placeholder="12-digit UID" value={form.aadhaarNumber} onChange={(event) => setField("aadhaarNumber", event.target.value.replace(/\D/g, ""))} className={controlClassName} maxLength={12} /></Field>
                <div className="col-span-2">
                  <Field label="Identity Document Scan Image">
                    <div className="flex gap-2 items-center mt-1">
                      <input type="file" accept="image/*" onChange={handleFileUpload} className="text-xs text-slate-400 file:mr-3 file:py-1 file:px-2 file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 file:cursor-pointer" />
                      {uploading && <span className="text-[10px] text-amber-400 uppercase animate-pulse">Uploading...</span>}
                      {documentImagePath && <span className="text-[10px] text-emerald-400 uppercase font-bold">✓ Uploaded</span>}
                    </div>
                  </Field>
                </div>
              </div>

              <div className="grid grid-cols-3 border border-slate-800 bg-slate-950 text-xs mt-2 rounded">
                <Metric label="Net Wt" value={formatNumber(weights.net, "g")} />
                <Metric label="Fine Wt" value={formatNumber(weights.fine, "g")} />
                <Metric label="Purchase Value" value={formatNumber(weights.total, "Rs")} />
              </div>

              <button type="submit" className="h-10 bg-emerald-500 hover:bg-emerald-400 text-xs font-bold uppercase text-slate-50 transition-colors shadow">
                Save URD Voucher
              </button>
            </form>

            <div className="border border-slate-800 bg-slate-900 p-4 rounded shadow-md h-full">
              <h2 className="text-xs font-semibold uppercase text-slate-50 border-b border-slate-800 pb-2 tracking-wide">KYC & Compliance Guidance</h2>
              <p className="mt-3 text-xs text-slate-300 leading-relaxed">
                Under GST Section 31(3)(f) and RCM rules, unregistered purchase of gold requires the jeweler to print a purchase voucher.
              </p>
              <ul className="mt-4 space-y-2 text-xs text-slate-400 list-disc pl-4 leading-relaxed">
                <li>PAN and Aadhaar number are mandatory for all transactions above Rs 2,00,000.</li>
                <li>Document scan upload verifies physical identity presence to comply with PMLA norms.</li>
                <li>Ensure weights exclude stones and beads to compute the exact pure gold liability.</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "vouchers" && (
          <div className="border border-slate-800 bg-slate-900 rounded shadow-md overflow-hidden">
            <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-50">Standalone Purchases Registry</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px] tracking-wider bg-slate-950/40">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Voucher No</th>
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5 text-right">Net Wt</th>
                    <th className="px-3 py-2.5 text-right">Fine Wt</th>
                    <th className="px-3 py-2.5 text-right">Deduction Value</th>
                    <th className="px-3 py-2.5 text-center">KYC Verified</th>
                    <th className="px-3 py-2.5 text-center">Stock Ingestion</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchersList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-slate-500 font-semibold">No standalone vouchers found.</td>
                    </tr>
                  ) : (
                    vouchersList.map((v) => (
                      <tr key={v.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition-colors">
                        <td className="px-3 py-3 text-slate-400">{v.voucher_date}</td>
                        <td className="px-3 py-3 font-mono font-semibold text-slate-300">{v.voucher_number}</td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-200">{v.customer_name}</div>
                          <div className="text-[10px] text-slate-400">{v.customer_phone || "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-300">{v.net_weight_g} g</td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-400">{v.fine_weight_g} g</td>
                        <td className="px-3 py-3 text-right font-mono text-amber-400">Rs {v.total_value_rupees}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.kyc_verified ? "bg-emerald-950/60 text-emerald-400 border border-emerald-900" : "bg-red-950/60 text-red-400 border border-red-900"}`}>
                            {v.kyc_verified ? "VERIFIED" : "UNVERIFIED"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            v.stock_status === "PENDING" ? "bg-amber-950/50 text-amber-400 border border-amber-900" :
                            v.stock_status === "INGESTED" ? "bg-blue-950/50 text-blue-400 border border-blue-900" :
                            "bg-purple-950/50 text-purple-400 border border-purple-900"
                          }`}>
                            {v.stock_status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <ActionButton onClick={() => printReceipt(v)} title="Print Legal Receipt">Print</ActionButton>
                            {!v.kyc_verified && (
                              <ActionButton onClick={() => verifyKyc(v.id)} tone="emerald">Verify KYC</ActionButton>
                            )}
                            {v.stock_status === "PENDING" && (
                              <ActionButton onClick={() => openIngest(v.id, "voucher")} tone="blue" disabled={!v.kyc_verified}>Ingest Stock</ActionButton>
                            )}
                            {v.stock_status === "INGESTED" && (
                              <ActionButton onClick={() => openTransfer(v.id, "voucher")} tone="purple">Melt / Refinery</ActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "pos-purchases" && (
          <div className="border border-slate-800 bg-slate-900 rounded shadow-md overflow-hidden">
            <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-50">POS Old-Gold Exchanges Registry</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px] tracking-wider bg-slate-950/40">
                    <th className="px-3 py-2.5">Invoice Ref</th>
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5">Description</th>
                    <th className="px-3 py-2.5 text-right">Gross Wt</th>
                    <th className="px-3 py-2.5 text-right">Deduction Value</th>
                    <th className="px-3 py-2.5 text-center">Stock Ingestion</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasesList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-slate-500 font-semibold">No POS exchanges found.</td>
                    </tr>
                  ) : (
                    purchasesList.map((p) => (
                      <tr key={p.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition-colors">
                        <td className="px-3 py-3 font-mono font-semibold text-slate-300">#{p.invoice_number}</td>
                        <td className="px-3 py-3 text-slate-200 font-medium">{p.customer_name}</td>
                        <td className="px-3 py-3 text-slate-400">{p.description}</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-300">{(p.weight_mg / 1000).toFixed(3)} g</td>
                        <td className="px-3 py-3 text-right font-mono text-amber-400">Rs {p.total_value_rupees}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.stock_status === "PENDING" ? "bg-amber-950/50 text-amber-400 border border-amber-900" :
                            p.stock_status === "INGESTED" ? "bg-blue-950/50 text-blue-400 border border-blue-900" :
                            "bg-purple-950/50 text-purple-400 border border-purple-900"
                          }`}>
                            {p.stock_status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {p.stock_status === "PENDING" && (
                              <ActionButton onClick={() => openIngest(p.id, "purchase")} tone="blue">Ingest Stock</ActionButton>
                            )}
                            {p.stock_status === "INGESTED" && (
                              <ActionButton onClick={() => openTransfer(p.id, "purchase")} tone="purple">Melt / Refinery</ActionButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Ingestion Modal */}
      {activeModal === "ingest" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="grid w-full max-w-sm gap-3 border border-slate-700 bg-slate-950 p-4 shadow-xl rounded">
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-sm font-semibold uppercase text-slate-50">Ingest Old Gold into Stock</h3>
              <p className="mt-1 text-xs text-slate-400">This creates an active stock item in inventory from this unregistered purchase.</p>
            </div>
            <div className="grid gap-3">
              <Field label="Assign Barcode / Tag">
                <input value={ingestBarcode} onChange={(e) => setIngestBarcode(e.target.value)} className={controlClassName} />
              </Field>
              <Field label="Storage Location">
                <input value={ingestLocation} onChange={(e) => setIngestLocation(e.target.value)} className={controlClassName} />
              </Field>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setActiveModal(null)} className="h-8 text-xs font-semibold px-3 border border-slate-750 text-slate-400 hover:text-slate-50 rounded">Cancel</button>
              <button type="button" onClick={submitIngest} className="h-8 text-xs font-semibold px-4 bg-blue-500 hover:bg-blue-600 text-slate-50 rounded">Confirm Ingest</button>
            </div>
          </div>
        </div>
      )}

      {/* Refinery Transfer Modal */}
      {activeModal === "transfer" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="grid w-full max-w-sm gap-3 border border-slate-700 bg-slate-950 p-4 shadow-xl rounded">
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-sm font-semibold uppercase text-slate-50">Send to Refinery / Melting</h3>
              <p className="mt-1 text-xs text-slate-400">Records outward smelting transfer and increases refinery metal liability.</p>
            </div>
            <div className="grid gap-3">
              <Field label="Refinery Destination">
                <select value={transferRefineryId} onChange={(e) => setTransferRefineryId(e.target.value)} className={controlClassName}>
                  <option value="">Select Refinery</option>
                  {refineriesList.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Melting Notes">
                <input value={transferDescription} onChange={(e) => setTransferDescription(e.target.value)} className={controlClassName} />
              </Field>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setActiveModal(null)} className="h-8 text-xs font-semibold px-3 border border-slate-750 text-slate-400 hover:text-slate-50 rounded">Cancel</button>
              <button type="button" onClick={submitTransfer} className="h-8 text-xs font-semibold px-4 bg-purple-500 hover:bg-purple-650 text-slate-50 rounded">Send to Refinery</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setMessage("");
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">{label}{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-slate-800 px-3 py-2 last:border-r-0"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="font-mono text-sm font-bold text-slate-50">{value}</div></div>;
}

function ActionButton({ onClick, tone = "slate", disabled = false, children, title }: { onClick: () => void; tone?: "slate" | "emerald" | "blue" | "purple"; disabled?: boolean; children: ReactNode; title?: string }) {
  const bg = 
    tone === "emerald" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-500/20" :
    tone === "blue" ? "bg-blue-500/10 text-blue-400 border border-blue-800/40 hover:bg-blue-500/20" :
    tone === "purple" ? "bg-purple-500/10 text-purple-400 border border-purple-800/40 hover:bg-purple-500/20" :
    "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-7 px-2.5 text-[11px] font-semibold uppercase rounded transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${bg}`}
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 border-r border-slate-700 px-3 font-semibold uppercase text-[10px] tracking-wide last:border-r-0 cursor-pointer transition-colors ${active ? "bg-emerald-500 text-slate-50 font-bold" : "bg-slate-950 text-slate-400 hover:text-slate-50"}`}
    >
      {children}
    </button>
  );
}

type ScaledIntegerResult = { ok: true; value: number } | { ok: false; value: 0 };

function parseNumber(value: string) {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3): ScaledIntegerResult {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2] ?? "").length > maxDecimalPlaces) return { ok: false, value: 0 };
  return { ok: true, value: Number(match[1]) * scale + Number((match[2] ?? "").padEnd(maxDecimalPlaces, "0") || "0") };
}

function formatNumber(value: number | undefined, suffix: string) {
  if (value === undefined || !Number.isFinite(value)) return suffix === "Rs" ? "Rs 0.00" : `0.000 ${suffix}`;
  return suffix === "Rs" ? `Rs ${value.toFixed(2)}` : `${value.toFixed(3)} ${suffix}`;
}

const controlClassName = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded-sm";

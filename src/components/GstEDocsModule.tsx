import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, QrCode, Search, Truck, X } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type Props = { apiBaseUrl?: string };

type InvoiceRow = {
  id: number;
  invoice_number: string;
  created_at: string | null;
  total_rupees: string;
  customer_name: string;
  customer_gstin: string | null;
  gst_not_required: boolean;
  einvoice_status: string | null;
  ewaybill_status: string | null;
};

type Einvoice = {
  id: number;
  invoice_id: number;
  supply_category: string;
  irn: string | null;
  ack_no: string | null;
  ack_date: string | null;
  signed_qr_code: string | null;
  qr_content: string | null;
  gateway: string;
  irp_registered: boolean;
  status: string;
  payload: unknown;
};

type Ewaybill = {
  id: number;
  invoice_id: number;
  eway_bill_number: string | null;
  valid_until: string | null;
  transport_mode: string;
  vehicle_number: string | null;
  distance_km: number;
  status: string;
  payload: unknown;
};

type EwayInfo = {
  required: boolean;
  threshold_rupees: string;
  invoice_value_rupees: string;
  ewaybill: Ewaybill | null;
};

const ctl = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded-sm";

export default function GstEDocsModule({ apiBaseUrl = "" }: Props) {
  const { session } = useAuthSession();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [list, setList] = useState<InvoiceRow[]>([]);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);

  const [einvoice, setEinvoice] = useState<Einvoice | null>(null);
  const [ewayInfo, setEwayInfo] = useState<EwayInfo | null>(null);
  const [busy, setBusy] = useState(false);

  // record-IRN form
  const [recordIrn, setRecordIrn] = useState("");
  const [recordAck, setRecordAck] = useState("");
  const [recordQr, setRecordQr] = useState("");

  // e-way form
  const [vehicleNo, setVehicleNo] = useState("");
  const [transMode, setTransMode] = useState("ROAD");
  const [distance, setDistance] = useState("");
  const [ewbNumber, setEwbNumber] = useState("");

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/einvoice/invoices/search?q=${encodeURIComponent(search)}`, { headers: authHeaders });
      const data = await res.json();
      setList(res.ok && Array.isArray(data.invoices) ? data.invoices : []);
    } catch {
      setList([]);
    }
  }, [apiBaseUrl, authHeaders, search]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), 200);
    return () => clearTimeout(t);
  }, [loadList]);

  const loadDocs = useCallback(async (invoiceId: number) => {
    try {
      const [eiRes, ewRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/einvoice/${invoiceId}`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/api/eway-bills/${invoiceId}`, { headers: authHeaders })
      ]);
      setEinvoice(eiRes.ok ? (await eiRes.json()).einvoice : null);
      setEwayInfo(ewRes.ok ? await ewRes.json() : null);
    } catch {
      setEinvoice(null);
      setEwayInfo(null);
    }
  }, [apiBaseUrl, authHeaders]);

  const selectInvoice = (inv: InvoiceRow) => {
    setSelected(inv);
    setMessage("");
    setError("");
    setRecordIrn(""); setRecordAck(""); setRecordQr("");
    setVehicleNo(""); setDistance(""); setEwbNumber("");
    void loadDocs(inv.id);
  };

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(`${apiBaseUrl}${url}`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.errors?.join(" ") || "Request failed.");
    return data;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : "Failed."); } finally { setBusy(false); }
  };

  const prepareEinvoice = () => selected && run(async () => {
    const data = await post(`/api/einvoice/${selected.id}/generate`);
    setEinvoice(data.einvoice);
    setMessage(data.note || "E-invoice prepared.");
    await loadList();
  });

  const recordEinvoice = () => selected && run(async () => {
    const data = await post(`/api/einvoice/${selected.id}/record`, { irn: recordIrn, ack_no: recordAck, signed_qr_code: recordQr });
    setEinvoice(data.einvoice);
    setMessage("IRP response recorded — e-invoice registered.");
    await loadList();
  });

  const cancelEinvoice = () => {
    if (!selected) return;
    const reason = window.prompt("Reason for cancelling this e-invoice?", "");
    if (reason === null) return; // dismissed
    void run(async () => {
      const data = await post(`/api/einvoice/${selected.id}/cancel`, { cancel_reason: reason.trim() || "Cancelled from GST e-Docs" });
      setEinvoice(data.einvoice);
      setMessage("E-invoice cancelled.");
      await loadList();
    });
  };

  const prepareEway = () => selected && run(async () => {
    const data = await post(`/api/eway-bills/${selected.id}/generate`, {
      transport_mode: transMode,
      vehicle_number: vehicleNo,
      distance_km: Number(distance) || 0
    });
    setMessage(data.note || "E-way bill prepared.");
    await loadDocs(selected.id);
    await loadList();
  });

  const recordEway = () => selected && run(async () => {
    await post(`/api/eway-bills/${selected.id}/record`, { eway_bill_number: ewbNumber });
    setMessage("E-way bill number recorded.");
    await loadDocs(selected.id);
    await loadList();
  });

  const cancelEway = () => {
    if (!selected) return;
    const reason = window.prompt("Reason for cancelling this e-way bill?", "");
    if (reason === null) return; // dismissed
    void run(async () => {
      await post(`/api/eway-bills/${selected.id}/cancel`, { cancel_reason: reason.trim() || "Cancelled from GST e-Docs" });
      setMessage("E-way bill cancelled.");
      await loadDocs(selected.id);
      await loadList();
    });
  };

  return (
    <section className="grid h-screen grid-cols-[360px_1fr] overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Invoice list */}
      <aside className="grid min-h-0 grid-rows-[auto_auto_1fr] border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-3 py-2">
          <h1 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-50 tracking-wide">
            <FileCheck2 size={16} className="text-emerald-400" /> GST e-Documents
          </h1>
          <p className="text-[11px] text-slate-400">e-Invoice (IRN/QR) & e-Way Bill</p>
        </div>
        <div className="border-b border-slate-800 p-2">
          <div className="flex items-center gap-2 border border-slate-700 bg-slate-950 px-2">
            <Search size={14} className="text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice number..." className="h-8 flex-1 bg-transparent text-xs text-slate-50 outline-none" />
          </div>
        </div>
        <div className="min-h-0 overflow-auto p-2">
          {list.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 uppercase">No invoices.</p>
          ) : list.map((inv) => (
            <button key={inv.id} type="button" onClick={() => selectInvoice(inv)} className={`mb-1 w-full rounded border p-2 text-left transition ${selected?.id === inv.id ? "border-emerald-500 bg-emerald-950/20" : "border-slate-800 bg-slate-950 hover:border-slate-600"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-slate-50">{inv.invoice_number}</span>
                <span className="font-mono text-[11px] text-slate-300">Rs {inv.total_rupees}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-slate-400">{inv.customer_name}{inv.customer_gstin ? " · B2B" : " · B2C"}</div>
              <div className="mt-1 flex gap-1">
                {inv.einvoice_status && <Tag label={`IRN ${inv.einvoice_status}`} tone={inv.einvoice_status === "REGISTERED" ? "emerald" : inv.einvoice_status === "CANCELLED" ? "red" : "amber"} />}
                {inv.ewaybill_status && <Tag label={`EWB ${inv.ewaybill_status}`} tone={inv.ewaybill_status === "GENERATED" ? "emerald" : inv.ewaybill_status === "CANCELLED" ? "red" : "amber"} />}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Detail */}
      <main className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden">
        {(message || error) && (
          <div className={`border-b border-slate-800 px-3 py-1.5 text-xs font-semibold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
            {error || message}
          </div>
        )}
        {!selected ? (
          <div className="grid place-items-center text-slate-500 uppercase text-xs font-semibold">Select an invoice to manage its GST documents.</div>
        ) : (
          <div className="min-h-0 overflow-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-mono text-lg font-semibold text-slate-50">{selected.invoice_number}</h2>
                <p className="text-[11px] text-slate-400">{selected.customer_name} · Rs {selected.total_rupees} · {selected.customer_gstin ? `GSTIN ${selected.customer_gstin}` : "B2C (no buyer GSTIN)"}</p>
              </div>
            </div>

            {selected.gst_not_required && (
              <div className="mb-4 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">
                This invoice is marked GST-not-required — e-invoice does not apply.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* E-INVOICE PANEL */}
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-slate-50"><QrCode size={15} className="text-emerald-400" /> e-Invoice (IRN)</h3>
                {!einvoice || einvoice.status === "CANCELLED" ? (
                  <div className="grid gap-2">
                    {einvoice?.status === "CANCELLED" && <p className="text-[11px] text-red-300">Previously cancelled. You can re-prepare.</p>}
                    <p className="text-[11px] text-slate-400">No active e-invoice. Prepare the IRP payload, IRN hash and QR content offline.</p>
                    <button type="button" disabled={busy || selected.gst_not_required} onClick={prepareEinvoice} className="h-9 rounded bg-emerald-500 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500">
                      Prepare e-Invoice
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2 text-[11px]">
                    <Row label="Status" value={<Tag label={einvoice.status} tone={einvoice.status === "REGISTERED" ? "emerald" : "amber"} />} />
                    <Row label="Category" value={einvoice.supply_category} />
                    <Row label="Gateway" value={einvoice.irp_registered ? `${einvoice.gateway} · registered` : `${einvoice.gateway} · offline`} />
                    <div>
                      <div className="text-[9px] font-bold uppercase text-slate-500">IRN (document hash)</div>
                      <div className="break-all rounded bg-slate-950 p-1.5 font-mono text-[10px] text-emerald-300">{einvoice.irn}</div>
                    </div>
                    {einvoice.qr_content && (
                      <details>
                        <summary className="cursor-pointer text-[10px] uppercase text-slate-400">QR content (data)</summary>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950 p-1.5 text-[9px] text-slate-300">{einvoice.qr_content}</pre>
                      </details>
                    )}
                    <details>
                      <summary className="cursor-pointer text-[10px] uppercase text-slate-400">IRP upload payload</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-950 p-1.5 text-[9px] text-slate-300">{JSON.stringify(einvoice.payload, null, 2)}</pre>
                    </details>

                    {!einvoice.irp_registered && (
                      <div className="mt-2 rounded border border-slate-700 bg-slate-950 p-2">
                        <div className="mb-1 text-[9px] font-bold uppercase text-slate-400">Record official IRP response</div>
                        <input value={recordIrn} onChange={(e) => setRecordIrn(e.target.value)} className={ctl} placeholder="Registered IRN (defaults to computed)" />
                        <input value={recordAck} onChange={(e) => setRecordAck(e.target.value)} className={`${ctl} mt-1`} placeholder="Ack No" />
                        <input value={recordQr} onChange={(e) => setRecordQr(e.target.value)} className={`${ctl} mt-1`} placeholder="Signed QR (base64)" />
                        <button type="button" disabled={busy} onClick={recordEinvoice} className="mt-2 h-8 w-full rounded bg-blue-600 text-[11px] font-bold uppercase text-slate-50 hover:bg-blue-500 disabled:opacity-50">Record & Register</button>
                      </div>
                    )}
                    <div className="mt-1 flex gap-2">
                      <button type="button" disabled={busy} onClick={prepareEinvoice} className="h-8 flex-1 rounded border border-slate-700 text-[11px] font-semibold uppercase text-slate-200 hover:bg-slate-800 disabled:opacity-50">Re-prepare</button>
                      <button type="button" disabled={busy} onClick={cancelEinvoice} className="flex h-8 flex-1 items-center justify-center gap-1 rounded border border-red-900/60 text-[11px] font-semibold uppercase text-red-300 hover:bg-red-950/40 disabled:opacity-50"><X size={12} /> Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* E-WAY PANEL */}
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-slate-50"><Truck size={15} className="text-blue-400" /> e-Way Bill</h3>
                {ewayInfo && (
                  <div className={`mb-3 rounded px-2 py-1.5 text-[10px] ${ewayInfo.required ? "bg-blue-950/40 text-blue-300" : "bg-slate-950 text-slate-500"}`}>
                    {ewayInfo.required
                      ? `Required — invoice value Rs ${ewayInfo.invoice_value_rupees} exceeds Rs ${ewayInfo.threshold_rupees}.`
                      : `Not mandatory below Rs ${ewayInfo.threshold_rupees} (value Rs ${ewayInfo.invoice_value_rupees}). You may still prepare one.`}
                  </div>
                )}
                {ewayInfo?.ewaybill && ewayInfo.ewaybill.status !== "CANCELLED" ? (
                  <div className="grid gap-2 text-[11px]">
                    <Row label="Status" value={<Tag label={ewayInfo.ewaybill.status} tone={ewayInfo.ewaybill.status === "GENERATED" ? "emerald" : "amber"} />} />
                    <Row label="Vehicle" value={ewayInfo.ewaybill.vehicle_number ?? "—"} />
                    <Row label="Mode" value={ewayInfo.ewaybill.transport_mode} />
                    {ewayInfo.ewaybill.eway_bill_number && <Row label="EWB No" value={<span className="font-mono text-emerald-300">{ewayInfo.ewaybill.eway_bill_number}</span>} />}
                    <details>
                      <summary className="cursor-pointer text-[10px] uppercase text-slate-400">EWB payload</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950 p-1.5 text-[9px] text-slate-300">{JSON.stringify(ewayInfo.ewaybill.payload, null, 2)}</pre>
                    </details>
                    {ewayInfo.ewaybill.status === "PREPARED" && (
                      <div className="mt-1 rounded border border-slate-700 bg-slate-950 p-2">
                        <input value={ewbNumber} onChange={(e) => setEwbNumber(e.target.value)} className={ctl} placeholder="Portal EWB number" />
                        <button type="button" disabled={busy} onClick={recordEway} className="mt-2 h-8 w-full rounded bg-blue-600 text-[11px] font-bold uppercase text-slate-50 hover:bg-blue-500 disabled:opacity-50">Record EWB Number</button>
                      </div>
                    )}
                    <button type="button" disabled={busy} onClick={cancelEway} className="mt-1 flex h-8 items-center justify-center gap-1 rounded border border-red-900/60 text-[11px] font-semibold uppercase text-red-300 hover:bg-red-950/40 disabled:opacity-50"><X size={12} /> Cancel e-Way Bill</button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <label className="grid gap-1 text-[9px] font-bold uppercase text-slate-400">Transport Mode
                      <select value={transMode} onChange={(e) => setTransMode(e.target.value)} className={ctl}>
                        <option value="ROAD">Road</option><option value="RAIL">Rail</option><option value="AIR">Air</option><option value="SHIP">Ship</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-[9px] font-bold uppercase text-slate-400">Vehicle Number
                      <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} className={ctl} placeholder="MH12AB1234" />
                    </label>
                    <label className="grid gap-1 text-[9px] font-bold uppercase text-slate-400">Distance (km)
                      <input value={distance} onChange={(e) => setDistance(e.target.value.replace(/[^\d]/g, ""))} className={ctl} inputMode="numeric" />
                    </label>
                    <button type="button" disabled={busy} onClick={prepareEway} className="h-9 rounded bg-blue-600 text-xs font-bold uppercase text-slate-50 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500">Prepare e-Way Bill</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] font-bold uppercase text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function Tag({ label, tone }: { label: string; tone: "emerald" | "amber" | "red" }) {
  const map = { emerald: "bg-emerald-950/60 text-emerald-300", amber: "bg-amber-950/60 text-amber-300", red: "bg-red-950/60 text-red-300" };
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${map[tone]}`}>{label}</span>;
}

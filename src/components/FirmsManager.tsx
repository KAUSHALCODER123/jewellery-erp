import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Pencil, Plus, Power, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";

type Firm = {
  id: number;
  key: string;
  display_name: string;
  gstin: string | null;
  address: string | null;
  contact_number: string | null;
  is_active: boolean;
  created_at: string | null;
};

type FormState = {
  display_name: string;
  gstin: string;
  address: string;
  contact_number: string;
};

const EMPTY_FORM: FormState = { display_name: "", gstin: "", address: "", contact_number: "" };

export default function FirmsManager() {
  const { authFetch, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const loadFirms = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await authFetch("/api/settings/firms");
      const data = await response.json();
      if (response.ok) {
        setFirms(Array.isArray(data.firms) ? data.firms : []);
      } else {
        setError(data.errors?.join(" ") || "Failed to load firms.");
      }
    } catch {
      setError("Error loading firms.");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void loadFirms();
  }, [loadFirms]);

  const handleCreate = async () => {
    if (!createForm.display_name.trim()) {
      setError("Firm name is required.");
      return;
    }
    setBusyId("new");
    setError("");
    setMessage("");
    try {
      const response = await authFetch("/api/settings/firms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: createForm.display_name.trim(),
          gstin: createForm.gstin.trim() || null,
          address: createForm.address.trim() || null,
          contact_number: createForm.contact_number.trim() || null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errors?.join(" ") || "Failed to create firm.");
      setMessage(`Firm "${data.firm.display_name}" created.`);
      setCreateForm(EMPTY_FORM);
      setCreating(false);
      await loadFirms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating firm.");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (firm: Firm) => {
    setEditingId(firm.id);
    setEditForm({
      display_name: firm.display_name,
      gstin: firm.gstin ?? "",
      address: firm.address ?? "",
      contact_number: firm.contact_number ?? ""
    });
    setError("");
    setMessage("");
  };

  const handleUpdate = async (firm: Firm) => {
    if (!editForm.display_name.trim()) {
      setError("Firm name is required.");
      return;
    }
    setBusyId(firm.id);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`/api/settings/firms/${firm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editForm.display_name.trim(),
          gstin: editForm.gstin.trim() || null,
          address: editForm.address.trim() || null,
          contact_number: editForm.contact_number.trim() || null,
          is_active: firm.is_active
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errors?.join(" ") || "Failed to update firm.");
      setMessage(`Firm "${data.firm.display_name}" updated.`);
      setEditingId(null);
      await loadFirms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating firm.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (firm: Firm) => {
    setBusyId(firm.id);
    setError("");
    setMessage("");
    try {
      if (firm.is_active) {
        const response = await authFetch(`/api/settings/firms/${firm.id}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.join(" ") || "Failed to deactivate firm.");
        setMessage(`Firm "${firm.display_name}" deactivated.`);
      } else {
        // Reactivate via PUT with is_active = true.
        const response = await authFetch(`/api/settings/firms/${firm.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: firm.display_name,
            gstin: firm.gstin,
            address: firm.address,
            contact_number: firm.contact_number,
            is_active: true
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.join(" ") || "Failed to reactivate firm.");
        setMessage(`Firm "${firm.display_name}" reactivated.`);
      }
      await loadFirms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating firm status.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-50">
            <Building2 size={16} className="text-emerald-400" />
            Firms & Company Entities
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Manage the legal entities / branches available at login. Each firm carries its own name, GSTIN and contact for invoices. Deactivated firms keep their historical records but no longer appear on the login screen.
          </p>
        </div>
        {isAdmin && !creating && (
          <button
            type="button"
            onClick={() => { setCreating(true); setCreateForm(EMPTY_FORM); setError(""); setMessage(""); }}
            className="flex shrink-0 items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-400 transition"
          >
            <Plus size={14} /> Add Firm
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-300 bg-red-950/30 px-2.5 py-1.5 rounded">{error}</p>}
      {message && <p className="text-xs text-emerald-300 bg-emerald-950/30 px-2.5 py-1.5 rounded">{message}</p>}

      {creating && isAdmin && (
        <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/10 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <FirmField label="Firm / Entity Name *" value={createForm.display_name} onChange={(v) => setCreateForm((f) => ({ ...f, display_name: v }))} placeholder="e.g. Shree Jewellers — MG Road" />
            <FirmField label="GSTIN" value={createForm.gstin} onChange={(v) => setCreateForm((f) => ({ ...f, gstin: v.toUpperCase() }))} placeholder="27AAAAA0000A1Z5" />
            <FirmField label="Contact Number" value={createForm.contact_number} onChange={(v) => setCreateForm((f) => ({ ...f, contact_number: v }))} placeholder="9876543210" />
            <FirmField label="Address" value={createForm.address} onChange={(v) => setCreateForm((f) => ({ ...f, address: v }))} placeholder="Shop address" />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setCreating(false); setError(""); }}
              className="flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-300 hover:bg-slate-800 transition"
            >
              <X size={13} /> Cancel
            </button>
            <button
              type="button"
              disabled={busyId === "new"}
              onClick={() => void handleCreate()}
              className="flex items-center gap-1 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 transition"
            >
              <Check size={13} /> {busyId === "new" ? "Saving..." : "Create Firm"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Loading firms...</p>
      ) : firms.length === 0 ? (
        <p className="text-xs text-slate-500">No firms configured yet.</p>
      ) : (
        <div className="grid gap-2">
          {firms.map((firm) => {
            const isEditing = editingId === firm.id;
            const busy = busyId === firm.id;
            return (
              <div
                key={firm.id}
                className={[
                  "rounded-lg border p-3 transition",
                  firm.is_active ? "border-slate-700 bg-slate-950" : "border-slate-800 bg-slate-950/40 opacity-70"
                ].join(" ")}
              >
                {isEditing ? (
                  <div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <FirmField label="Firm / Entity Name *" value={editForm.display_name} onChange={(v) => setEditForm((f) => ({ ...f, display_name: v }))} />
                      <FirmField label="GSTIN" value={editForm.gstin} onChange={(v) => setEditForm((f) => ({ ...f, gstin: v.toUpperCase() }))} />
                      <FirmField label="Contact Number" value={editForm.contact_number} onChange={(v) => setEditForm((f) => ({ ...f, contact_number: v }))} />
                      <FirmField label="Address" value={editForm.address} onChange={(v) => setEditForm((f) => ({ ...f, address: v }))} />
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setError(""); }}
                        className="flex items-center gap-1 rounded border border-slate-700 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-300 hover:bg-slate-800 transition"
                      >
                        <X size={13} /> Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleUpdate(firm)}
                        className="flex items-center gap-1 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 transition"
                      >
                        <Check size={13} /> {busy ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-50">{firm.display_name}</span>
                        <span
                          className={[
                            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                            firm.is_active ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-800 text-slate-500"
                          ].join(" ")}
                        >
                          {firm.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="mt-1 grid gap-0.5 text-[11px] text-slate-400">
                        <span>GSTIN: <span className="font-mono text-slate-300">{firm.gstin || "—"}</span></span>
                        {firm.contact_number && <span>Contact: {firm.contact_number}</span>}
                        {firm.address && <span className="truncate">{firm.address}</span>}
                        <span className="text-[9px] uppercase tracking-wide text-slate-600">key: {firm.key}</span>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(firm)}
                          title="Edit firm"
                          className="grid h-7 w-7 place-items-center rounded border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-50 transition"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleActive(firm)}
                          title={firm.is_active ? "Deactivate firm" : "Reactivate firm"}
                          className={[
                            "grid h-7 w-7 place-items-center rounded border transition disabled:opacity-50",
                            firm.is_active
                              ? "border-red-900/60 text-red-300 hover:bg-red-950/40"
                              : "border-emerald-900/60 text-emerald-300 hover:bg-emerald-950/40"
                          ].join(" ")}
                        >
                          <Power size={13} />
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

      {!isAdmin && (
        <p className="text-[10px] text-slate-500">Only administrators can add or edit firms.</p>
      )}
    </div>
  );
}

function FirmField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal text-slate-50 outline-none focus:border-emerald-500 transition"
      />
    </label>
  );
}

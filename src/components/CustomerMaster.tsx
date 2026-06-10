import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

export type SavedCustomer = { id: number; name: string; phone: string } & Record<string, unknown>;

type CustomerMasterProps = {
  apiBaseUrl?: string;
  initial?: (Partial<SavedCustomer> & { id?: number }) | null;
  onClose: () => void;
  onSaved: (customer: SavedCustomer) => void;
};

type FormState = {
  name: string;
  phone: string;
  whatsapp_phone: string;
  email: string;
  gstin: string;
  address: string;
  area: string;
  taluka: string;
  district: string;
  birthday_date: string;
  anniversary_date: string;
  pan_number: string;
  aadhaar_number: string;
  ring_size: string;
  spouse_name: string;
  loyalty_enrolled: boolean;
  opening_balance: string;
  opening_balance_type: "DEBIT" | "CREDIT";
};

function toFormState(initial: CustomerMasterProps["initial"]): FormState {
  const v = (key: string) => {
    const raw = initial ? (initial as Record<string, unknown>)[key] : undefined;
    return typeof raw === "string" ? raw : "";
  };
  return {
    name: v("name"),
    phone: v("phone"),
    whatsapp_phone: v("whatsapp_phone"),
    email: v("email"),
    gstin: v("gstin"),
    address: v("address"),
    area: v("area"),
    taluka: v("taluka"),
    district: v("district"),
    birthday_date: v("birthday_date"),
    anniversary_date: v("anniversary_date"),
    pan_number: v("pan_number"),
    aadhaar_number: v("aadhaar_number"),
    ring_size: v("ring_size"),
    spouse_name: v("spouse_name"),
    loyalty_enrolled: Boolean(initial ? (initial as Record<string, unknown>).loyalty_enrolled : false),
    opening_balance: "",
    opening_balance_type: "DEBIT"
  };
}

const control = "w-full rounded-sm border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-amber-500";

type MetalBalance = {
  id: number;
  metal_type: string;
  fine_weight_mg: number;
  direction: "TO_RECEIVE" | "TO_PAY";
  notes: string | null;
};

export default function CustomerMaster({ apiBaseUrl = "", initial = null, onClose, onSaved }: CustomerMasterProps) {
  const { session } = useAuthSession();
  const isEdit = Boolean(initial?.id);
  const isAdmin = session?.user?.role === "ADMIN";
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Blacklist + metal-wise opening balances apply immediately (separate endpoints),
  // so they only show when editing an existing customer.
  const [isBlacklisted, setIsBlacklisted] = useState(Boolean(initial ? (initial as Record<string, unknown>).is_blacklisted : false));
  const [blacklistReason, setBlacklistReason] = useState(
    typeof (initial as Record<string, unknown> | null)?.blacklist_reason === "string" ? String((initial as Record<string, unknown>).blacklist_reason) : ""
  );
  const [metalBalances, setMetalBalances] = useState<MetalBalance[]>([]);
  const [newBalance, setNewBalance] = useState({ metal_type: "Gold", fine_weight_g: "", direction: "TO_RECEIVE" as "TO_RECEIVE" | "TO_PAY" });

  const authHeader = { Authorization: `Bearer ${session?.token ?? ""}` };

  useEffect(() => {
    if (!isEdit || !initial?.id) return;
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/crm/customers/${initial.id}/metal-balances`, { headers: authHeader });
        const result = (await response.json().catch(() => null)) as { metal_balances?: MetalBalance[] } | null;
        if (response.ok && result?.metal_balances) setMetalBalances(result.metal_balances);
      } catch {
        // Section stays empty; not fatal for the editor.
      }
    })();
  }, [isEdit, initial?.id]);

  async function toggleBlacklist() {
    if (!initial?.id) return;
    setError("");
    const next = !isBlacklisted;
    if (next && !blacklistReason.trim()) {
      setError("A reason is required to blacklist a customer.");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers/${initial.id}/blacklist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ is_blacklisted: next, reason: blacklistReason.trim() || null })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;
      if (!response.ok) throw new Error(result?.errors?.join(" ") || "Failed to update blacklist status.");
      setIsBlacklisted(next);
      if (!next) setBlacklistReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update blacklist status.");
    }
  }

  async function addMetalBalance() {
    if (!initial?.id) return;
    setError("");
    const fineWeightMg = Math.round((Number(newBalance.fine_weight_g) || 0) * 1000);
    if (fineWeightMg <= 0) {
      setError("Enter a positive fine weight in grams.");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers/${initial.id}/metal-balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ metal_type: newBalance.metal_type, fine_weight_mg: fineWeightMg, direction: newBalance.direction })
      });
      const result = (await response.json().catch(() => null)) as { metal_balance?: MetalBalance; errors?: string[] } | null;
      if (!response.ok || !result?.metal_balance) throw new Error(result?.errors?.join(" ") || "Failed to add metal balance.");
      setMetalBalances((current) => [...current, result.metal_balance as MetalBalance]);
      setNewBalance({ metal_type: "Gold", fine_weight_g: "", direction: "TO_RECEIVE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add metal balance.");
    }
  }

  async function removeMetalBalance(balanceId: number) {
    if (!initial?.id) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/crm/customers/${initial.id}/metal-balances/${balanceId}`, {
        method: "DELETE",
        headers: authHeader
      });
      if (response.ok) setMetalBalances((current) => current.filter((balance) => balance.id !== balanceId));
    } catch {
      // Leave the row; user can retry.
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!/^\d{10,15}$/.test(form.phone.replace(/\s+/g, ""))) {
      setError("Phone must be 10 to 15 digits.");
      return;
    }

    setSaving(true);
    try {
      const url = isEdit ? `${apiBaseUrl}/api/crm/customers/${initial?.id}` : `${apiBaseUrl}/api/crm/customers`;
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token ?? ""}` },
        body: JSON.stringify(form)
      });
      const result = (await response.json().catch(() => null)) as { customer?: SavedCustomer; errors?: string[] } | null;

      if (!response.ok || !result?.customer) {
        throw new Error(result?.errors?.join(" ") || "Failed to save customer.");
      }

      onSaved(result.customer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="animate-scale-in w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-amber-300">{isEdit ? "Edit Customer" : "New Customer"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        {error && <p className="mb-2 rounded-sm bg-red-950/40 px-2 py-1 text-xs text-red-300">{error}</p>}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-300">Name*
            <input className={control} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Mobile No*
            <input className={control} value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/[^\d]/g, ""))} maxLength={15} />
          </label>
          <label className="text-xs text-slate-300">WhatsApp No
            <input className={control} value={form.whatsapp_phone} onChange={(e) => set("whatsapp_phone", e.target.value.replace(/[^\d]/g, ""))} maxLength={15} />
          </label>
          <label className="text-xs text-slate-300">Email
            <input className={control} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Address
            <input className={control} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Area
            <input className={control} value={form.area} onChange={(e) => set("area", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Taluka
            <input className={control} value={form.taluka} onChange={(e) => set("taluka", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">City / District
            <input className={control} value={form.district} onChange={(e) => set("district", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Birth Date
            <input type="date" className={control} value={form.birthday_date} onChange={(e) => set("birthday_date", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Anniversary
            <input type="date" className={control} value={form.anniversary_date} onChange={(e) => set("anniversary_date", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">PAN
            <input className={control} value={form.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} maxLength={10} />
          </label>
          <label className="text-xs text-slate-300">Aadhaar No
            <input className={control} value={form.aadhaar_number} onChange={(e) => set("aadhaar_number", e.target.value.replace(/[^\d]/g, ""))} maxLength={12} />
          </label>
          <label className="text-xs text-slate-300">GST No
            <input className={control} value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} />
          </label>
          <label className="text-xs text-slate-300">Ring Size
            <input className={control} value={form.ring_size} onChange={(e) => set("ring_size", e.target.value)} />
          </label>
          <label className="text-xs text-slate-300">Spouse Name
            <input className={control} value={form.spouse_name} onChange={(e) => set("spouse_name", e.target.value)} />
          </label>
          <label className="col-span-2 flex items-center gap-2 rounded-sm border border-slate-800 bg-slate-900/70 px-2 py-2 text-xs font-semibold text-slate-300">
            <input
              type="checkbox"
              checked={form.loyalty_enrolled}
              onChange={(e) => set("loyalty_enrolled", e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-amber-500"
            />
            Enroll in loyalty points program
          </label>

          {!isEdit && (
            <>
              <label className="text-xs text-slate-300">Opening Balance (₹)
                <input className={control} value={form.opening_balance} onChange={(e) => set("opening_balance", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" />
              </label>
              <label className="text-xs text-slate-300">Balance Type
                <select className={control} value={form.opening_balance_type} onChange={(e) => set("opening_balance_type", e.target.value === "CREDIT" ? "CREDIT" : "DEBIT")}>
                  <option value="DEBIT">Debit (customer owes shop)</option>
                  <option value="CREDIT">Credit (advance / shop owes)</option>
                </select>
              </label>
            </>
          )}
        </div>

        {isEdit && (
          <div className="mt-4 rounded-sm border border-slate-800 bg-slate-900/50 p-3">
            <h3 className="text-xs font-bold uppercase text-slate-400">Metal-wise Opening Balances (fine weight)</h3>
            {metalBalances.length > 0 ? (
              <table className="mt-2 w-full text-left text-xs">
                <tbody>
                  {metalBalances.map((balance) => (
                    <tr key={balance.id} className="border-b border-slate-800">
                      <td className="py-1 text-slate-200">{balance.metal_type}</td>
                      <td className="py-1 font-mono text-slate-200">{(balance.fine_weight_mg / 1000).toFixed(3)} g</td>
                      <td className="py-1 text-slate-400">{balance.direction === "TO_RECEIVE" ? "Customer owes shop" : "Shop owes customer"}</td>
                      <td className="py-1 text-right">
                        {isAdmin && (
                          <button type="button" onClick={() => removeMetalBalance(balance.id)} className="text-red-400 hover:text-red-300">Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No metal balances recorded.</p>
            )}
            {isAdmin && (
              <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <label className="text-xs text-slate-300">Metal
                  <select className={control} value={newBalance.metal_type} onChange={(e) => setNewBalance({ ...newBalance, metal_type: e.target.value })}>
                    <option>Gold</option>
                    <option>Silver</option>
                    <option>Platinum</option>
                  </select>
                </label>
                <label className="text-xs text-slate-300">Fine Wt (g)
                  <input className={control} value={newBalance.fine_weight_g} onChange={(e) => setNewBalance({ ...newBalance, fine_weight_g: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0.000" />
                </label>
                <label className="text-xs text-slate-300">Direction
                  <select className={control} value={newBalance.direction} onChange={(e) => setNewBalance({ ...newBalance, direction: e.target.value === "TO_PAY" ? "TO_PAY" : "TO_RECEIVE" })}>
                    <option value="TO_RECEIVE">Customer owes shop</option>
                    <option value="TO_PAY">Shop owes customer</option>
                  </select>
                </label>
                <button type="button" onClick={addMetalBalance} className="rounded-sm bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-600">Add</button>
              </div>
            )}
          </div>
        )}

        {isEdit && isAdmin && (
          <div className={`mt-3 rounded-sm border p-3 ${isBlacklisted ? "border-red-700 bg-red-950/30" : "border-slate-800 bg-slate-900/50"}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-400">Blacklist (credit control)</h3>
                <p className="text-[11px] text-slate-500">Blacklisted customers cannot take girvi loans or buy on udhari. Cash sales stay allowed.</p>
                {isBlacklisted && blacklistReason && <p className="mt-1 text-[11px] text-red-300">Reason: {blacklistReason}</p>}
              </div>
              <button
                type="button"
                onClick={toggleBlacklist}
                className={`rounded-sm px-3 py-1 text-xs font-semibold ${isBlacklisted ? "bg-emerald-700 text-slate-50 hover:bg-emerald-600" : "bg-red-700 text-slate-50 hover:bg-red-600"}`}
              >
                {isBlacklisted ? "Remove from blacklist" : "Blacklist customer"}
              </button>
            </div>
            {!isBlacklisted && (
              <label className="mt-2 block text-xs text-slate-300">Reason (required to blacklist)
                <input className={control} value={blacklistReason} onChange={(e) => setBlacklistReason(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-sm bg-amber-600 px-4 py-1 text-sm font-semibold text-slate-50 hover:bg-amber-500 disabled:opacity-50">
            {saving ? "Saving…" : isEdit ? "Update" : "Save Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}

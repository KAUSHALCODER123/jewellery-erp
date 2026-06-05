import type { FormEvent } from "react";
import { useState } from "react";
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
    opening_balance: "",
    opening_balance_type: "DEBIT"
  };
}

const control = "w-full rounded-sm border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-amber-500";

export default function CustomerMaster({ apiBaseUrl = "", initial = null, onClose, onSaved }: CustomerMasterProps) {
  const { session } = useAuthSession();
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-sm bg-amber-600 px-4 py-1 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
            {saving ? "Saving…" : isEdit ? "Update" : "Save Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}

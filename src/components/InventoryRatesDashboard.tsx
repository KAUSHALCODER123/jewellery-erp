import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Save, Tag, Pencil, Boxes, Coins } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { MetricCard, CountUp, StatusBadge, type BadgeTone } from "./ui.js";

const statusTone = (status: string | null): BadgeTone =>
  status === "IN_STOCK" ? "good" : status === "SOLD" ? "neutral" : status === "IN_MEMO" ? "warn" : "info";

type InventoryRatesDashboardProps = {
  apiBaseUrl?: string;
};

type RateForm = {
  gold24k: string;
  gold22k: string;
  gold18k: string;
  silver: string;
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
  making_charge_type: string;
  making_charge_rupees: string;
  status: string | null;
  gross_weight_g: string;
  net_weight_g: string;
  is_published_online?: boolean;
  online_title?: string | null;
  online_description?: string | null;
  image_urls?: string | null;
};

type InventoryFilters = {
  category: string;
  metalType: string;
  purityKarat: string;
  status: string;
  search: string;
};

const emptyRates: RateForm = {
  gold24k: "0.00",
  gold22k: "0.00",
  gold18k: "0.00",
  silver: "0.00"
};

const initialFilters: InventoryFilters = {
  category: "",
  metalType: "",
  purityKarat: "",
  status: "IN_STOCK",
  search: ""
};

export default function InventoryRatesDashboard({ apiBaseUrl = "" }: InventoryRatesDashboardProps) {
  const { session } = useAuthSession();
  const [rates, setRates] = useState<RateForm>(emptyRates);
  const [filters, setFilters] = useState<InventoryFilters>(initialFilters);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedTagItem, setSelectedTagItem] = useState<InventoryItem | null>(null);
  const [selectedEditItem, setSelectedEditItem] = useState<InventoryItem | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncingRates, setSyncingRates] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const isAdmin = session?.user.role === "ADMIN";

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`
    }),
    [session?.token]
  );

  useEffect(() => {
    void loadRates();
    void loadInventory();
  }, []);

  const metrics = useMemo(() => {
    const inStockItems = items.filter((item) => item.status === "IN_STOCK");
    const totalGoldMg = inStockItems
      .filter((item) => item.metal_type.toLowerCase() === "gold")
      .reduce((total, item) => total + item.net_weight_mg, 0);
    const totalSilverMg = inStockItems
      .filter((item) => item.metal_type.toLowerCase() === "silver")
      .reduce((total, item) => total + item.net_weight_mg, 0);

    return {
      inStockCount: inStockItems.length,
      totalGoldWeightG: totalGoldMg / 1000,
      totalSilverWeightG: totalSilverMg / 1000
    };
  }, [items]);

  async function loadRates() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/rates`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { rates?: Record<string, string>; errors?: string[] } | null;

      if (!response.ok || !result?.rates) {
        throw new Error(result?.errors?.join(" ") || "Could not load rates.");
      }

      setRates({
        gold24k: result.rates.gold_24k_rate_per_gram_rupees ?? "0.00",
        gold22k: result.rates.gold_22k_rate_per_gram_rupees ?? "0.00",
        gold18k: result.rates.gold_18k_rate_per_gram_rupees ?? "0.00",
        silver: result.rates.silver_rate_per_gram_rupees ?? "0.00"
      });
      setLastSyncedAt(result.rates.updated_at ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load rates.");
    }
  }

  async function loadInventory(nextFilters = filters) {
    try {
      const params = new URLSearchParams();
      if (nextFilters.category) params.set("category", nextFilters.category);
      if (nextFilters.metalType) params.set("metal_type", nextFilters.metalType);
      if (nextFilters.purityKarat) params.set("purity_karat", nextFilters.purityKarat);
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.search) params.set("search", nextFilters.search);

      const query = params.toString();
      const response = await fetch(`${apiBaseUrl}/api/inventory${query ? `?${query}` : ""}`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { items?: InventoryItem[]; errors?: string[] } | null;

      if (!response.ok || !result?.items) {
        throw new Error(result?.errors?.join(" ") || "Could not load inventory.");
      }

      setItems(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load inventory.");
    }
  }

  async function saveRates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isAdmin) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/rates`, {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          gold_24k_rate: rates.gold24k,
          gold_22k_rate: rates.gold22k,
          gold_18k_rate: rates.gold18k,
          silver_rate: rates.silver
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not update rates.");
      }

      setMessage("Rates updated.");
      await loadRates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update rates.");
    }
  }

  async function syncLiveRates() {
    if (!isAdmin || syncingRates) {
      return;
    }

    setError("");
    setMessage("");
    setSyncingRates(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/settings/rates/sync`, {
        method: "POST",
        headers: authHeaders
      });
      const result = (await response.json().catch(() => null)) as { rates?: Record<string, string>; errors?: string[] } | null;

      if (!response.ok || !result?.rates) {
        throw new Error(result?.errors?.join(" ") || "Could not sync live rates.");
      }

      setRates({
        gold24k: result.rates.gold_24k_rate_per_gram_rupees ?? "0.00",
        gold22k: result.rates.gold_22k_rate_per_gram_rupees ?? "0.00",
        gold18k: result.rates.gold_18k_rate_per_gram_rupees ?? "0.00",
        silver: result.rates.silver_rate_per_gram_rupees ?? "0.00"
      });
      setLastSyncedAt(result.rates.updated_at ?? new Date().toISOString());
      setMessage("Live MCX rates synced.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sync live rates.");
    } finally {
      setSyncingRates(false);
    }
  }

  function updateFilters(nextFilters: InventoryFilters) {
    setFilters(nextFilters);
    void loadInventory(nextFilters);
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] bg-slate-950 text-slate-100">
      <form onSubmit={saveRates} className="border-b border-slate-800 bg-slate-900 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <h1 className="text-sm font-semibold uppercase text-white">Daily Rates Control</h1>
            <p className="text-xs text-slate-400">{isAdmin ? "Admin edit mode" : "Staff read-only mode"}</p>
          </div>
          <RateInput label="Gold 24K" value={rates.gold24k} disabled={!isAdmin} onChange={(value) => setRates({ ...rates, gold24k: value })} />
          <RateInput label="Gold 22K" value={rates.gold22k} disabled={!isAdmin} onChange={(value) => setRates({ ...rates, gold22k: value })} />
          <RateInput label="Gold 18K" value={rates.gold18k} disabled={!isAdmin} onChange={(value) => setRates({ ...rates, gold18k: value })} />
          <RateInput label="Silver" value={rates.silver} disabled={!isAdmin} onChange={(value) => setRates({ ...rates, silver: value })} />
          <button
            type="button"
            disabled={!isAdmin || syncingRates}
            onClick={syncLiveRates}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-amber-400 bg-amber-400 px-3 text-xs font-semibold uppercase text-slate-950 transition hover:bg-amber-300 active:scale-95 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingRates ? "animate-spin" : ""}`} />
            {syncingRates ? "Syncing…" : "Sync Live MCX Rates"}
          </button>
          <button
            type="submit"
            disabled={!isAdmin}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500 px-3 text-xs font-semibold uppercase text-slate-950 transition hover:bg-emerald-400 active:scale-95 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Save className="h-3.5 w-3.5" /> Save &amp; Update Rates
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Last Synced: {lastSyncedAt ? formatTimestamp(lastSyncedAt) : "Never"}</p>
        {(message || error) && (
          <p className={`animate-fade-in mt-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>
        )}
      </form>

      <main className="grid min-h-0 grid-rows-[auto_auto_1fr]">
        <div className="grid grid-cols-3 gap-3 border-b border-slate-800 bg-slate-950 p-3">
          <MetricCard label="Items In-Stock" icon={Boxes} accent="sky">
            <CountUp value={metrics.inStockCount} />
          </MetricCard>
          <MetricCard label="Gold Weight" icon={Coins} accent="amber">
            <CountUp value={metrics.totalGoldWeightG} format={(n) => `${n.toFixed(3)} g`} />
          </MetricCard>
          <MetricCard label="Silver Weight" icon={Coins} accent="slate">
            <CountUp value={metrics.totalSilverWeightG} format={(n) => `${n.toFixed(3)} g`} />
          </MetricCard>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-800 bg-slate-900 p-2">
          <FilterInput placeholder="Search barcode/HUID" value={filters.search} onChange={(search) => updateFilters({ ...filters, search })} />
          <FilterInput placeholder="Category" value={filters.category} onChange={(category) => updateFilters({ ...filters, category })} />
          <FilterInput placeholder="Metal" value={filters.metalType} onChange={(metalType) => updateFilters({ ...filters, metalType })} />
          <FilterInput placeholder="Purity" value={filters.purityKarat} onChange={(purityKarat) => updateFilters({ ...filters, purityKarat })} />
          <select
            value={filters.status}
            onChange={(event) => updateFilters({ ...filters, status: event.target.value })}
            className={filterControlClassName}
          >
            <option value="">All Status</option>
            <option value="IN_STOCK">IN_STOCK</option>
            <option value="SOLD">SOLD</option>
            <option value="IN_MEMO">IN_MEMO</option>
          </select>
        </div>

        <div className="min-h-0 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                {["Barcode", "HUID", "Category", "Metal", "Purity", "Gross Wt (g)", "Net Wt (g)", "Making Charge", "Status", "Action"].map((heading) => (
                  <th key={heading} className="border-b border-slate-800 px-2 py-2 font-semibold uppercase">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-12 text-center text-slate-600">No items match these filters.</td>
                </tr>
              ) : items.map((item, i) => (
                <tr
                  key={item.id}
                  className="animate-fade-in border-b border-slate-900 transition-colors hover:bg-slate-900/70"
                  style={{ animationDelay: `${Math.min(i, 14) * 20}ms` }}
                >
                  <td className="px-2 py-2 font-mono text-slate-200">{item.barcode}</td>
                  <td className="px-2 py-2 font-mono">{item.huid ?? "-"}</td>
                  <td className="px-2 py-2">{item.category}</td>
                  <td className="px-2 py-2">{item.metal_type}</td>
                  <td className="px-2 py-2">{item.purity_karat}K</td>
                  <td className="px-2 py-2 font-mono">{item.gross_weight_g}</td>
                  <td className="px-2 py-2 font-mono">{item.net_weight_g}</td>
                  <td className="px-2 py-2">{formatMakingCharge(item)}</td>
                  <td className="px-2 py-2"><StatusBadge tone={statusTone(item.status)}>{item.status ?? "—"}</StatusBadge></td>
                  <td className="px-2 py-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedTagItem(item)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-700 px-2 text-[11px] font-semibold uppercase text-slate-200 transition hover:border-emerald-400 hover:text-emerald-300 active:scale-95"
                    >
                      <Tag className="h-3 w-3" /> Tag
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEditItem(item)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 text-[11px] font-semibold uppercase text-slate-200 transition hover:border-emerald-400 hover:bg-slate-800 active:scale-95"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {selectedTagItem && <TagModal item={selectedTagItem} onClose={() => setSelectedTagItem(null)} />}
      {selectedEditItem && (
        <EditItemModal
          item={selectedEditItem}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          onClose={() => setSelectedEditItem(null)}
          onSaveSuccess={() => {
            setSelectedEditItem(null);
            void loadInventory();
          }}
        />
      )}
    </section>
  );
}

function RateInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
      {label}
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-28 border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-white outline-none focus:border-emerald-400 disabled:text-slate-500"
        inputMode="decimal"
      />
    </label>
  );
}

function FilterInput({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={filterControlClassName}
    />
  );
}

function TagModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="animate-scale-in grid gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase">Barcode Tag Preview</h2>
          <button type="button" onClick={onClose} className="border border-slate-700 px-2 py-1 text-xs uppercase">
            Close
          </button>
        </div>
        <div className="grid h-[25mm] w-[50mm] grid-rows-[8mm_1fr] border border-slate-300 bg-white p-[2mm] text-black">
          <div className="grid grid-cols-12 gap-[1px]">
            {Array.from({ length: 36 }).map((_, index) => (
              <div
                key={index}
                className="bg-black"
                style={{ opacity: index % 5 === 0 ? 1 : index % 2 === 0 ? 0.75 : 0.35 }}
              />
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-1 pt-1 text-[7px] leading-tight">
            <div>
              <div className="font-bold uppercase">{item.category}</div>
              <div>{item.purity_karat}K {item.metal_type}</div>
              <div>NW {item.net_weight_g}g</div>
            </div>
            <div className="text-right font-mono">
              <div>{item.huid ?? "NO-HUID"}</div>
              <div>{item.barcode}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMakingCharge(item: InventoryItem) {
  return item.making_charge_type === "PER_GRAM"
    ? `Rs ${item.making_charge_rupees}/g`
    : `Rs ${item.making_charge_rupees}`;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

const filterControlClassName =
  "h-8 border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-emerald-400";

function EditItemModal({
  item,
  apiBaseUrl,
  authHeaders,
  onClose,
  onSaveSuccess
}: {
  item: InventoryItem;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
  onSaveSuccess: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"erp" | "online" | "stones">("online");
  const [stones, setStones] = useState<any[]>([]);
  const [loadingStones, setLoadingStones] = useState(false);
  const [savingStones, setSavingStones] = useState(false);
  const [stoneError, setStoneError] = useState("");
  const [stoneSuccess, setStoneSuccess] = useState("");

  const [newStone, setNewStone] = useState({
    stone_type: "DIAMOND",
    shape: "",
    carat_weight: "",
    color_grade: "",
    clarity_grade: "",
    cut_grade: "",
    certificate_number: "",
    certificate_lab: "NONE",
    stone_rate_rupees: ""
  });

  useEffect(() => {
    if (activeTab === "stones") {
      setLoadingStones(true);
      setStoneError("");
      setStoneSuccess("");
      fetch(`${apiBaseUrl}/api/inventory/items/${item.id}/stones`, { headers: authHeaders })
        .then((res) => {
          if (!res.ok) throw new Error("Could not load stones.");
          return res.json();
        })
        .then((data) => {
          if (data && Array.isArray(data.stones)) {
            setStones(data.stones);
          }
        })
        .catch((err) => {
          setStoneError(err instanceof Error ? err.message : "Error loading stones.");
        })
        .finally(() => {
          setLoadingStones(false);
        });
    }
  }, [activeTab, item.id, apiBaseUrl, authHeaders]);

  const totalCarats = useMemo(() => {
    return stones.reduce((sum, s) => sum + Number(s.carat_weight || 0), 0);
  }, [stones]);

  const totalStoneWeightMg = useMemo(() => {
    return Math.round(totalCarats * 200);
  }, [totalCarats]);

  const totalStoneWeightG = (totalStoneWeightMg / 1000).toFixed(3);
  const netWeightG = ((item.gross_weight_mg - totalStoneWeightMg) / 1000).toFixed(3);
  const weightExceedsGross = totalStoneWeightMg > item.gross_weight_mg;

  const addStone = () => {
    setStoneError("");
    setStoneSuccess("");
    const carats = Number(newStone.carat_weight);
    if (!carats || carats <= 0) {
      setStoneError("Carat weight must be a positive number.");
      return;
    }
    const rateRupees = Number(newStone.stone_rate_rupees);
    if (newStone.stone_rate_rupees !== "" && (Number.isNaN(rateRupees) || rateRupees < 0)) {
      setStoneError("Rate per carat must be a non-negative number.");
      return;
    }

    const ratePaise = newStone.stone_rate_rupees ? Math.round(rateRupees * 100) : 0;

    const stoneToAdd = {
      stone_type: newStone.stone_type.toUpperCase(),
      shape: newStone.shape.trim().toUpperCase() || null,
      carat_weight: carats,
      color_grade: newStone.color_grade.trim().toUpperCase() || null,
      clarity_grade: newStone.clarity_grade.trim().toUpperCase() || null,
      cut_grade: newStone.cut_grade.trim().toUpperCase() || null,
      certificate_number: newStone.certificate_number.trim().toUpperCase() || null,
      certificate_lab: newStone.certificate_lab.toUpperCase(),
      stone_rate_paise: ratePaise
    };

    setStones([...stones, stoneToAdd]);
    setNewStone({
      stone_type: "DIAMOND",
      shape: "",
      carat_weight: "",
      color_grade: "",
      clarity_grade: "",
      cut_grade: "",
      certificate_number: "",
      certificate_lab: "NONE",
      stone_rate_rupees: ""
    });
  };

  const removeStone = (index: number) => {
    setStones(stones.filter((_, i) => i !== index));
  };

  const saveStones = async () => {
    setSavingStones(true);
    setStoneError("");
    setStoneSuccess("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory/items/${item.id}/stones`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          stones: stones.map((s) => ({
            stone_type: s.stone_type,
            shape: s.shape,
            carat_weight: Number(s.carat_weight),
            color_grade: s.color_grade,
            clarity_grade: s.clarity_grade,
            cut_grade: s.cut_grade,
            certificate_number: s.certificate_number,
            certificate_lab: s.certificate_lab,
            stone_rate_paise: Number(s.stone_rate_paise || 0)
          }))
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Failed to save stones.");
      }

      setStoneSuccess("Stones saved successfully!");
      setTimeout(() => {
        onSaveSuccess();
      }, 1000);
    } catch (err) {
      setStoneError(err instanceof Error ? err.message : "Error saving stones.");
    } finally {
      setSavingStones(false);
    }
  };

  const [isPublishedOnline, setIsPublishedOnline] = useState(Boolean(item.is_published_online));
  const [onlineTitle, setOnlineTitle] = useState(item.online_title ?? "");
  const [onlineDescription, setOnlineDescription] = useState(item.online_description ?? "");
  const [imageUrlsText, setImageUrlsText] = useState(() => {
    if (!item.image_urls) return "";
    try {
      const parsed = JSON.parse(item.image_urls);
      return Array.isArray(parsed) ? parsed.join(", ") : "";
    } catch {
      return "";
    }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const urlsArray = imageUrlsText
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const imageUrlsJson = JSON.stringify(urlsArray);

    try {
      const response = await fetch(`${apiBaseUrl}/api/items/${item.id}`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          is_published_online: isPublishedOnline,
          online_title: onlineTitle.trim(),
          online_description: onlineDescription.trim(),
          image_urls: imageUrlsJson
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Failed to update item.");
      }

      onSaveSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-sm p-4 text-left">
      <div className={`animate-scale-in flex flex-col gap-4 border border-slate-800 bg-slate-900 p-5 rounded-lg w-full ${activeTab === "stones" ? "max-w-3xl" : "max-w-lg"} shadow-2xl text-slate-100`}>
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div>
            <h2 className="text-sm font-semibold uppercase text-white">Item Catalog Details</h2>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {item.id} | Barcode: {item.barcode}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("online")}
            className={`px-3 py-1.5 font-semibold uppercase transition ${
              activeTab === "online" ? "border-b-2 border-emerald-500 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Online Listing
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("erp")}
            className={`px-3 py-1.5 font-semibold uppercase transition ${
              activeTab === "erp" ? "border-b-2 border-emerald-500 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            ERP Info (Read-Only)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stones")}
            className={`px-3 py-1.5 font-semibold uppercase transition ${
              activeTab === "stones" ? "border-b-2 border-emerald-500 text-emerald-400 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Gemstones & Diamonds
          </button>
        </div>

        {error && <p className="text-xs text-red-300 bg-red-950/20 px-2.5 py-1 rounded">{error}</p>}

        {activeTab === "erp" && (
          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/20 p-3.5 border border-slate-800 rounded">
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">Category</span>
              <span className="text-slate-300 font-medium">{item.category}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">Metal Type</span>
              <span className="text-slate-300 font-medium">{item.metal_type} ({item.purity_karat}K)</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">Gross / Net Weight</span>
              <span className="text-slate-300 font-mono">{item.gross_weight_g} / {item.net_weight_g}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">Making Charges</span>
              <span className="text-slate-300">{formatMakingCharge(item)}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">HUID</span>
              <span className="text-slate-300 font-mono">{item.huid || "-"}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[9px] font-bold">Stock Status</span>
              <span className="text-slate-300 font-semibold text-emerald-400">{item.status}</span>
            </div>
          </div>
        )}

        {activeTab === "online" && (
          <form onSubmit={handleSave} className="space-y-3.5 text-xs">
            <div className="flex items-center justify-between border border-slate-800 bg-slate-950/20 p-2.5 rounded">
              <div>
                <span className="text-white font-semibold block">Publish to Web Storefront</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Toggle this switch to catalog this item on the online shop.</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublishedOnline}
                  onChange={(e) => setIsPublishedOnline(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-950 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-slate-900 peer-checked:after:border-emerald-500"></div>
              </label>
            </div>

            <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[10px]">
              Online Product Title
              <input
                type="text"
                placeholder="e.g. Elegant 22K Gold Ruby Studded Engagement Ring"
                value={onlineTitle}
                onChange={(e) => setOnlineTitle(e.target.value)}
                className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400 transition"
              />
            </label>

            <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[10px]">
              Product Online Description
              <textarea
                placeholder="Write catalog item description for web storefront details page..."
                value={onlineDescription}
                onChange={(e) => setOnlineDescription(e.target.value)}
                className="h-20 w-full border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-normal text-xs text-white outline-none rounded resize-none focus:border-emerald-400 transition"
              />
            </label>

            <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[10px]">
              Image URLs (Comma separated list)
              <input
                type="text"
                placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
                value={imageUrlsText}
                onChange={(e) => setImageUrlsText(e.target.value)}
                className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400 transition"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="h-8 border border-slate-800 hover:border-slate-700 bg-slate-950 px-4 rounded font-semibold text-slate-300 hover:text-white uppercase transition text-[11px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-8 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 rounded uppercase transition text-[11px]"
              >
                {saving ? "Saving..." : "Save Online Listing"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "stones" && (
          <div className="space-y-4 text-xs">
            {stoneError && <p className="text-xs text-red-300 bg-red-950/20 px-2.5 py-1 rounded">{stoneError}</p>}
            {stoneSuccess && <p className="text-xs text-emerald-300 bg-emerald-950/20 px-2.5 py-1 rounded">{stoneSuccess}</p>}

            {loadingStones ? (
              <p className="text-center text-slate-400 py-4">Loading gemstone records...</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 bg-slate-950/40 p-3 border border-slate-850 rounded animate-in fade-in duration-200">
                  <div className="col-span-full font-bold uppercase text-[10px] text-emerald-400">Add Gemstone / Diamond</div>
                  
                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Type *
                    <select
                      value={newStone.stone_type}
                      onChange={(e) => setNewStone({ ...newStone, stone_type: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    >
                      <option value="DIAMOND">DIAMOND</option>
                      <option value="RUBY">RUBY</option>
                      <option value="SAPPHIRE">SAPPHIRE</option>
                      <option value="EMERALD">EMERALD</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Shape
                    <input
                      type="text"
                      placeholder="ROUND"
                      value={newStone.shape}
                      onChange={(e) => setNewStone({ ...newStone, shape: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Carats *
                    <input
                      type="number"
                      step="0.001"
                      placeholder="0.00"
                      value={newStone.carat_weight}
                      onChange={(e) => setNewStone({ ...newStone, carat_weight: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Color
                    <input
                      type="text"
                      placeholder="G"
                      value={newStone.color_grade}
                      onChange={(e) => setNewStone({ ...newStone, color_grade: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Clarity
                    <input
                      type="text"
                      placeholder="VVS1"
                      value={newStone.clarity_grade}
                      onChange={(e) => setNewStone({ ...newStone, clarity_grade: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Cut
                    <input
                      type="text"
                      placeholder="EXCELLENT"
                      value={newStone.cut_grade}
                      onChange={(e) => setNewStone({ ...newStone, cut_grade: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Lab
                    <select
                      value={newStone.certificate_lab}
                      onChange={(e) => setNewStone({ ...newStone, certificate_lab: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    >
                      <option value="NONE">NONE</option>
                      <option value="GIA">GIA</option>
                      <option value="IGI">IGI</option>
                      <option value="HRD">HRD</option>
                    </select>
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Certificate #
                    <input
                      type="text"
                      placeholder="123456"
                      value={newStone.certificate_number}
                      onChange={(e) => setNewStone({ ...newStone, certificate_number: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <label className="grid gap-1 uppercase font-semibold text-slate-500 text-[9px]">
                    Rate per Carat (Rs)
                    <input
                      type="number"
                      placeholder="0.00"
                      value={newStone.stone_rate_rupees}
                      onChange={(e) => setNewStone({ ...newStone, stone_rate_rupees: e.target.value })}
                      className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-400"
                    />
                  </label>

                  <div className="col-span-full pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={addStone}
                      className="h-8 bg-slate-800 hover:bg-slate-700 text-white font-semibold px-4 rounded uppercase transition text-[11px]"
                    >
                      Add Stone to List
                    </button>
                  </div>
                </div>

                <div className="font-bold uppercase text-[10px] text-slate-400 mt-2">Attached Stones</div>
                <div className="border border-slate-800 rounded overflow-hidden max-h-40 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950/60 text-slate-400 font-semibold uppercase text-[9px] sticky top-0">
                      <tr>
                        <th className="p-2 border-b border-slate-800">Type</th>
                        <th className="p-2 border-b border-slate-800">Shape</th>
                        <th className="p-2 border-b border-slate-800 text-right">Carats</th>
                        <th className="p-2 border-b border-slate-800">Grade (Cl/Co/Cu)</th>
                        <th className="p-2 border-b border-slate-800">Cert/Lab</th>
                        <th className="p-2 border-b border-slate-800 text-right">Rate/Carat</th>
                        <th className="p-2 border-b border-slate-800 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stones.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-slate-500 italic">No gemstones attached to this item.</td>
                        </tr>
                      ) : (
                        stones.map((s, idx) => (
                          <tr key={idx} className="border-b border-slate-850 last:border-0 hover:bg-slate-900/40">
                            <td className="p-2 font-medium">{s.stone_type}</td>
                            <td className="p-2">{s.shape || "-"}</td>
                            <td className="p-2 font-mono text-right">{s.carat_weight} ct</td>
                            <td className="p-2 font-mono">{s.clarity_grade || "-"}/{s.color_grade || "-"}/{s.cut_grade || "-"}</td>
                            <td className="p-2 font-mono">{s.certificate_number ? `${s.certificate_number} (${s.certificate_lab})` : "-"}</td>
                            <td className="p-2 font-mono text-right">Rs {((s.stone_rate_paise || 0) / 100).toLocaleString()}</td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeStone(idx)}
                                className="text-red-400 hover:text-red-300 font-semibold uppercase text-[9px] px-2 py-0.5 rounded border border-red-950 hover:bg-red-950/20"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-950/50 p-3 rounded border border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-500 block uppercase text-[9px] font-bold">Gross Weight</span>
                    <span className="text-slate-300 font-mono">{item.gross_weight_g} g</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase text-[9px] font-bold">Stones Weight (Est.)</span>
                    <span className={`font-mono ${weightExceedsGross ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                      {totalStoneWeightG} g ({totalCarats} ct)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase text-[9px] font-bold">New Net Weight</span>
                    <span className={`font-mono text-emerald-400 font-semibold ${weightExceedsGross ? 'text-red-400 line-through' : ''}`}>
                      {netWeightG} g
                    </span>
                  </div>
                  {weightExceedsGross && (
                    <div className="col-span-full text-red-400 text-[10px]">
                      ⚠️ Total stone weight cannot exceed item's gross weight!
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-8 border border-slate-800 hover:border-slate-700 bg-slate-950 px-4 rounded font-semibold text-slate-300 hover:text-white uppercase transition text-[11px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingStones || weightExceedsGross}
                    onClick={saveStones}
                    className="h-8 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 rounded uppercase transition text-[11px] disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    {savingStones ? "Saving..." : "Save Stones to Item"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

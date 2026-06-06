import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type UserManagementModuleProps = {
  apiBaseUrl?: string;
};

type Role = "ADMIN" | "MANAGER" | "ACCOUNTANT" | "COUNTER_STAFF";

type CreatedUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
};

const ROLES: { value: Role; label: string }[] = [
  { value: "COUNTER_STAFF", label: "Counter Staff" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "MANAGER", label: "Manager" },
  { value: "ADMIN", label: "Admin" }
];

export default function UserManagementModule({ apiBaseUrl = "" }: UserManagementModuleProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);
  const isAdmin = session?.user.role === "ADMIN";

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("COUNTER_STAFF");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedUser[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          username: username.trim(),
          full_name: fullName.trim() || username.trim(),
          password,
          role
        })
      });
      const result = (await response.json().catch(() => null)) as { user?: CreatedUser; errors?: string[] } | null;

      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not create user.");
      }

      if (result?.user) setCreated((current) => [result.user as CreatedUser, ...current]);
      setMessage(`Staff user "${username.trim()}" created.`);
      setUsername("");
      setFullName("");
      setPassword("");
      setRole("COUNTER_STAFF");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create user.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "h-9 w-full border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none focus:border-emerald-400 rounded";
  const labelClass = "grid gap-1 text-[10px] font-semibold uppercase text-slate-400";

  return (
    <section className="grid min-h-full content-start gap-3 bg-slate-950 p-4 text-slate-100 max-w-3xl">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold uppercase text-white">Staff User Management</h2>
        <p className="mt-1 text-xs text-slate-400">Create login accounts for staff. Only administrators can add users.</p>
      </div>

      {!isAdmin && (
        <p className="rounded bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          You are signed in as {session?.user.role ?? "a non-admin"}. Creating users requires an ADMIN account.
        </p>
      )}

      {error && <p className="rounded bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}
      {message && <p className="rounded bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">{message}</p>}

      <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Username *
            <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="e.g. counter1" />
          </label>
          <label className={labelClass}>
            Full Name
            <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Display name" />
          </label>
          <label className={labelClass}>
            Password * (min 8 chars)
            <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className={labelClass}>
            Role
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={submitting || !isAdmin} className="h-9 bg-emerald-500 px-5 text-xs font-bold uppercase text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 rounded">
            {submitting ? "Creating…" : "Create User"}
          </button>
        </div>
      </form>

      {created.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-xs font-semibold uppercase text-slate-300">Created this session</h3>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-2 py-1">ID</th>
                <th className="px-2 py-1">Username</th>
                <th className="px-2 py-1">Full Name</th>
                <th className="px-2 py-1">Role</th>
              </tr>
            </thead>
            <tbody>
              {created.map((u) => (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="px-2 py-1 font-mono text-slate-400">{u.id}</td>
                  <td className="px-2 py-1 text-slate-200">{u.username}</td>
                  <td className="px-2 py-1 text-slate-300">{u.full_name}</td>
                  <td className="px-2 py-1 text-emerald-300">{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-500">Note: the backend does not expose a user-list endpoint, so this shows only users created in the current session.</p>
        </div>
      )}
    </section>
  );
}

import type { FormEvent } from "react";
import { useState } from "react";
import { Lock, LogIn, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

export default function LoginScreen() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login({
        username: username.trim().toLowerCase(),
        password
      });
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="grid min-h-screen place-items-center bg-slate-950 px-4 py-8 text-slate-100">
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase text-emerald-300">Jewelry ERP</p>
          <h1 className="text-xl font-semibold text-white">Staff Login</h1>
        </div>

        {error && (
          <div className="border border-red-800 bg-red-950/70 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
          Username
          <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
            <span className="grid place-items-center border-r border-slate-800 text-slate-500">
              <User size={16} />
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-10 bg-transparent px-3 text-sm text-white outline-none"
              autoComplete="username"
              autoFocus
            />
          </div>
        </label>

        <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
          Password
          <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
            <span className="grid place-items-center border-r border-slate-800 text-slate-500">
              <Lock size={16} />
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 bg-transparent px-3 text-sm text-white outline-none"
              autoComplete="current-password"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-grid h-10 grid-cols-[16px_1fr] items-center gap-2 bg-emerald-500 px-4 text-sm font-semibold uppercase text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          <LogIn size={16} />
          <span>{isSubmitting ? "Signing In" : "Sign In"}</span>
        </button>
      </form>
    </section>
  );
}

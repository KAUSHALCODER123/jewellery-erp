import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type AuthRole = "ADMIN" | "MANAGER" | "ACCOUNTANT" | "COUNTER_STAFF";

export type AuthUser = {
  id: number;
  username: string;
  full_name: string;
  role: AuthRole;
  firm_id?: number | null;
  firm_key?: string | null;
  firm_name?: string | null;
  fiscal_year?: string | null;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

type LoginCredentials = {
  username: string;
  password: string;
  firm_key?: string | null;
  fiscal_year?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthSession>;
  logout: () => Promise<void>;
  setSession: (session: AuthSession | null) => void;
  authFetch: typeof fetch;
};

const AUTH_TOKEN_KEY = "jewelry_erp_jwt";
const AUTH_USER_KEY = "jewelry_erp_user";

// Set by the global 401 interceptor when it auto-clears a dead session, read once
// by the login screen so it can explain why the user was bounced back. sessionStorage
// (not state/events) survives the AuthGateway unmount→remount that clearing triggers.
export const SESSION_EXPIRED_STORAGE_KEY = "jewelry_erp_session_expired";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children, apiBaseUrl = "" }: { children: ReactNode; apiBaseUrl?: string }) {
  const [session, setSessionState] = useState<AuthSession | null>(() => getStoredSession());

  useEffect(() => {
    setSessionState(getStoredSession());
  }, []);

  const setSession = useCallback((nextSession: AuthSession | null) => {
    setSessionState(nextSession);

    if (!nextSession) {
      clearStoredSession();
      return;
    }

    localStorage.setItem(AUTH_TOKEN_KEY, nextSession.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(nextSession.user));
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    const result = (await response.json().catch(() => null)) as AuthSession & { errors?: string[] } | null;

    if (!response.ok || !result?.token || !result.user) {
      throw new Error(result?.errors?.join(" ") || "Incorrect username or password.");
    }

    setSession(result);
    return result;
  }, [apiBaseUrl, setSession]);

  const logout = useCallback(async () => {
    // Best-effort server-side revoke so the token can't be reused; clear local session regardless.
    try {
      if (session?.token) {
        await fetch(`${apiBaseUrl}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` }
        });
      }
    } catch {
      // Offline / network error — still clear the local session below.
    } finally {
      setSession(null);
    }
  }, [apiBaseUrl, session?.token, setSession]);

  const authFetch = useCallback<typeof fetch>((input, init = {}) => {
    const headers = new Headers(init.headers);

    if (session?.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${session.token}`);
    }

    let url = input;
    if (typeof url === "string" && url.startsWith("/")) {
      url = `${apiBaseUrl}${url}`;
    }

    return fetch(url, { ...init, headers });
  }, [apiBaseUrl, session?.token]);

  // Keep a ref to the live session so the long-lived fetch wrapper below always
  // sees the current value without being re-installed on every token change.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Global 401 recovery. Any 401 from our own protected API means the stored token
  // can no longer be used; clear the session so the app falls back to the login
  // screen instead of leaving the user stuck with silently-failing actions (and,
  // previously, no way back). Patching window.fetch — rather than migrating the
  // ~30 hand-built `fetch(..., { headers: authHeaders })` call sites onto authFetch —
  // covers every request path with one change.
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    const requestUrl = (input: RequestInfo | URL) => {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.toString();
      return input.url;
    };

    // Protected API lives under /api/ but NOT /api/auth/. Auth endpoints (login,
    // and verify-password for the unlock screen) return 401 by design and are
    // handled by their callers, so they must never trigger an auto-logout.
    const isProtectedApi = (url: string) => url.includes("/api/") && !url.includes("/api/auth/");

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);

      if (response.status === 401 && sessionRef.current && isProtectedApi(requestUrl(input))) {
        try {
          sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, "1");
        } catch {
          // sessionStorage can throw in locked-down/private modes — the logout
          // below is what matters; the notice is best-effort.
        }
        setSession(null);
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [setSession]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    token: session?.token ?? null,
    session,
    isAuthenticated: Boolean(session),
    login,
    logout,
    setSession,
    authFetch
  }), [authFetch, login, logout, session, setSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}

function clearStoredSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function getStoredSession(): AuthSession | null {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const storedUser = localStorage.getItem(AUTH_USER_KEY);

  if (!token) {
    return null;
  }

  const decoded = decodeJwtPayload(token);

  if (!decoded || isExpired(decoded.exp)) {
    clearStoredSession();
    return null;
  }

  const user = parseStoredUser(storedUser) ?? {
    id: decoded.userId,
    username: decoded.username,
    full_name: decoded.username,
    role: decoded.role,
    firm_id: decoded.firm_id ?? null,
    firm_key: decoded.firm_key ?? null,
    firm_name: decoded.firm_name ?? null,
    fiscal_year: decoded.fiscal_year ?? null
  };

  return { token, user };
}

function parseStoredUser(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<AuthUser>;

    if (typeof parsed.id === "number" && typeof parsed.username === "string" && isAuthRole(parsed.role)) {
      return {
        id: parsed.id,
        username: parsed.username,
        full_name: typeof parsed.full_name === "string" ? parsed.full_name : parsed.username,
        role: parsed.role,
        firm_id: typeof parsed.firm_id === "number" ? parsed.firm_id : null,
        firm_key: typeof parsed.firm_key === "string" ? parsed.firm_key : null,
        firm_name: typeof parsed.firm_name === "string" ? parsed.firm_name : null,
        fiscal_year: typeof parsed.fiscal_year === "string" ? parsed.fiscal_year : null
      };
    }
  } catch {
    return null;
  }

  return null;
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const decoded = JSON.parse(json) as Partial<AuthUser> & { userId?: number; exp?: number; firm_id?: number | null; firm_key?: string | null; firm_name?: string | null; fiscal_year?: string | null };

    if (typeof decoded.userId === "number" && typeof decoded.username === "string" && isAuthRole(decoded.role)) {
      return {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        exp: decoded.exp,
        firm_id: decoded.firm_id ?? null,
        firm_key: decoded.firm_key ?? null,
        firm_name: decoded.firm_name ?? null,
        fiscal_year: decoded.fiscal_year ?? null
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isExpired(exp: number | undefined) {
  return typeof exp === "number" && exp * 1000 <= Date.now();
}

function isAuthRole(value: unknown): value is AuthRole {
  return value === "ADMIN" || value === "MANAGER" || value === "ACCOUNTANT" || value === "COUNTER_STAFF";
}

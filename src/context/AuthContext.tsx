import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type AuthRole = "ADMIN" | "MANAGER" | "ACCOUNTANT" | "COUNTER_STAFF";

export type AuthUser = {
  id: number;
  username: string;
  full_name: string;
  role: AuthRole;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

type LoginCredentials = {
  username: string;
  password: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  session: AuthSession | null;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthSession>;
  logout: () => void;
  setSession: (session: AuthSession | null) => void;
  authFetch: typeof fetch;
};

const AUTH_TOKEN_KEY = "jewelry_erp_jwt";
const AUTH_USER_KEY = "jewelry_erp_user";
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

  const logout = useCallback(() => {
    setSession(null);
  }, [setSession]);

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
    role: decoded.role
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
        role: parsed.role
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
    const decoded = JSON.parse(json) as Partial<AuthUser> & { userId?: number; exp?: number };

    if (typeof decoded.userId === "number" && typeof decoded.username === "string" && isAuthRole(decoded.role)) {
      return {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        exp: decoded.exp
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

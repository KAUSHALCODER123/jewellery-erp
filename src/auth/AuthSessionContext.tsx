import { AuthProvider, useAuth, type AuthSession, type AuthUser } from "../context/AuthContext.js";

export type AuthSessionUser = AuthUser;
export type { AuthSession };
export const AuthSessionProvider = AuthProvider;

export function useAuthSession() {
  const { session, setSession, logout } = useAuth();

  return { session, setSession, logout };
}

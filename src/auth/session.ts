import { randomBytes } from "node:crypto";
import type { User } from "../db/schema.js";

export type PublicUser = {
  id: number;
  username: string;
  full_name: string;
  role: User["role"];
  is_active: boolean;
  created_at: string | null;
};

export type SessionUser = PublicUser;

const sessions = new Map<string, SessionUser>();

export function createSession(user: User) {
  const token = randomBytes(32).toString("hex");
  const publicUser = toPublicUser(user);

  sessions.set(token, publicUser);

  return { token, user: publicUser };
}

export function getSessionUser(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  return sessions.get(token);
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at
  };
}

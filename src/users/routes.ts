import { eq } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { normalizeUsername } from "../auth/routes.js";
import { toPublicUser } from "../auth/session.js";
import { db } from "../db/client.js";
import { users, type UserRole } from "../db/schema.js";
import { hashPassword } from "../utils/auth.js";

export const userRouter = Router();

userRouter.post("/", requireAuth, requireAdmin, async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateCreateUserRequest(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const existingUser = db.query.users.findFirst({
    where: eq(users.username, validation.user.username)
  }).sync();

  if (existingUser) {
    return response.status(409).json({ errors: ["A user with this username already exists."] });
  }

  const passwordHash = await hashPassword(validation.user.password);
  const createdUser = db
    .insert(users)
    .values({
      username: validation.user.username,
      full_name: validation.user.fullName,
      password_hash: passwordHash,
      role: validation.user.role,
      is_active: true
    })
    .returning()
    .get();

  const publicUser = toPublicUser(createdUser);
  logAction(authUser.id, "CREATE_USER", "users", createdUser.id, null, publicUser);

  return response.status(201).json({ user: publicUser });
});

type CreateUserValidation =
  | { ok: true; user: { username: string; fullName: string; password: string; role: UserRole } }
  | { ok: false; errors: string[] };

function validateCreateUserRequest(body: unknown): CreateUserValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const username = normalizeUsername(body.username);
  const fullName = typeof body.full_name === "string" && body.full_name.trim() ? body.full_name.trim() : username;
  const password = body.password;
  const role = body.role;

  if (!username) {
    errors.push("username is required.");
  }

  if (typeof password !== "string" || password.length < 8) {
    errors.push("password must be at least 8 characters.");
  }

  if (!isUserRole(role)) {
    errors.push("role must be ADMIN, MANAGER, ACCOUNTANT, or COUNTER_STAFF.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const validatedPassword = password as string;
  const validatedRole = role as UserRole;

  return {
    ok: true,
    user: {
      username,
      fullName,
      password: validatedPassword,
      role: validatedRole
    }
  };
}

function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "MANAGER" || value === "ACCOUNTANT" || value === "COUNTER_STAFF";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

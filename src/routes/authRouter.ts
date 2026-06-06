import { eq } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { getBearerToken, requireRole, revokeToken, signAuthToken, verifyToken, type AuthenticatedRequest } from "../middlewares/authMiddleware.js";
import { db } from "../db/client.js";
import { firms, organizationSettings, users, type User, type UserRole } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../utils/auth.js";

export const authRouter = Router();

authRouter.get("/firms", (_request, response) => {
  const activeFirms = db.select({
    id: firms.id,
    key: firms.key,
    display_name: firms.display_name,
    gstin: firms.gstin
  }).from(firms).where(eq(firms.is_active, true)).all();
  return response.json({ firms: activeFirms });
});

authRouter.get("/status", (_request, response) => {
  const adminUser = db.query.users.findFirst({
    where: eq(users.role, "ADMIN")
  }).sync();

  return response.json({
    initialized: Boolean(adminUser)
  });
});

authRouter.post("/login", async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const password = request.body?.password;
  const firmKey = typeof request.body?.firm_key === "string" ? request.body.firm_key.trim() : null;
  const fiscalYear = typeof request.body?.fiscal_year === "string" ? request.body.fiscal_year.trim() : null;

  if (!username || typeof password !== "string" || !password) {
    return response.status(400).json({ errors: ["username and password are required."] });
  }

  const user = db.query.users.findFirst({
    where: eq(users.username, username)
  }).sync();

  if (!user || !user.is_active) {
    return response.status(401).json({ errors: ["Invalid credentials."] });
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    return response.status(401).json({ errors: ["Invalid credentials."] });
  }

  // Resolve firm (default to first active firm if none specified)
  let resolvedFirm: { id: number; key: string; display_name: string } | null = null;
  if (firmKey) {
    resolvedFirm = db.select({ id: firms.id, key: firms.key, display_name: firms.display_name })
      .from(firms).where(eq(firms.key, firmKey)).get() ?? null;
  }
  if (!resolvedFirm) {
    resolvedFirm = db.select({ id: firms.id, key: firms.key, display_name: firms.display_name })
      .from(firms).where(eq(firms.is_active, true)).get() ?? null;
  }

  const lastLogin = new Date().toISOString();
  db.update(users)
    .set({ last_login: lastLogin })
    .where(eq(users.id, user.id))
    .run();

  const token = signAuthToken(user, {
    firm_id: resolvedFirm?.id ?? null,
    firm_key: resolvedFirm?.key ?? null,
    firm_name: resolvedFirm?.display_name ?? null,
    fiscal_year: fiscalYear
  });
  const publicUser = toAuthUser({ ...user, last_login: lastLogin });

  return response.json({
    token,
    user: {
      ...publicUser,
      firm_id: resolvedFirm?.id ?? null,
      firm_key: resolvedFirm?.key ?? null,
      firm_name: resolvedFirm?.display_name ?? null,
      fiscal_year: fiscalYear
    }
  });
});

// Re-verify the logged-in user's password to unlock the app (idle / manual lock screen).
authRouter.post("/verify-password", verifyToken, async (request, response) => {
  const password = request.body?.password;
  if (typeof password !== "string" || !password) {
    return response.status(400).json({ errors: ["password is required."] });
  }

  const authUser = (request as AuthenticatedRequest).user;
  const user = db.query.users.findFirst({ where: eq(users.id, authUser.id) }).sync();
  if (!user || !user.is_active) {
    return response.status(401).json({ ok: false });
  }

  const ok = await verifyPassword(password, user.password_hash);
  return response.status(ok ? 200 : 401).json({ ok });
});

authRouter.post("/logout", verifyToken, (request, response) => {
  // verifyToken guarantees a valid, non-revoked token here; blacklist its jti.
  revokeToken(getBearerToken(request));

  return response.status(200).json({ message: "Logged out" });
});

authRouter.post("/register", verifyToken, requireRole(["ADMIN"]), async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateRegisterRequest(request.body);

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

  const publicUser = toAuthUser(createdUser);
  logAction(authUser.userId, "REGISTER_USER", "users", createdUser.id, null, publicUser);

  return response.status(201).json({ user: publicUser });
});

authRouter.post("/setup", async (request, response) => {
  const validation = validateSetupRequest(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const existingAdmin = db.query.users.findFirst({
    where: eq(users.role, "ADMIN")
  }).sync();

  if (existingAdmin) {
    return response.status(409).json({ errors: ["Application is already initialized."] });
  }

  try {
    const passwordHash = await hashPassword(validation.setup.adminPassword);
    const createdAdmin = db.transaction((tx) => {
      const admin = tx
        .insert(users)
        .values({
          username: validation.setup.adminUsername,
          full_name: validation.setup.adminFullName,
          password_hash: passwordHash,
          role: "ADMIN",
          is_active: true
        })
        .returning()
        .get();

      tx.insert(organizationSettings)
        .values({
          shop_name: validation.setup.shopName,
          address: validation.setup.address,
          gstin: validation.setup.gstin || null,
          contact_number: validation.setup.contactNumber
        })
        .run();

      return admin;
    });

    const token = signAuthToken(createdAdmin);
    const publicUser = toAuthUser(createdAdmin);

    logAction(createdAdmin.id, "SYSTEM_INITIALIZATION", "organization_settings", 1, null, {
      shop_name: validation.setup.shopName,
      address: validation.setup.address,
      gstin: validation.setup.gstin || null,
      contact_number: validation.setup.contactNumber,
      admin_user: publicUser
    });

    return response.status(201).json({
      token,
      user: publicUser
    });
  } catch (error) {
    console.error("Failed to complete first-time setup", error);

    return response.status(500).json({ errors: ["First-time setup could not be completed."] });
  }
});

export function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function toAuthUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
    last_login: user.last_login
  };
}

type RegisterValidation =
  | { ok: true; user: { username: string; fullName: string; password: string; role: UserRole } }
  | { ok: false; errors: string[] };

function validateRegisterRequest(body: unknown): RegisterValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const username = normalizeUsername(body.username);
  const fullName = requiredText(body.full_name ?? body.fullName, "full_name", errors);
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

  return {
    ok: true,
    user: {
      username,
      fullName,
      password: password as string,
      role: role as UserRole
    }
  };
}

type SetupValidation =
  | {
      ok: true;
      setup: {
        shopName: string;
        address: string;
        gstin: string;
        contactNumber: string;
        adminUsername: string;
        adminFullName: string;
        adminPassword: string;
      };
    }
  | { ok: false; errors: string[] };

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function validateSetupRequest(body: unknown): SetupValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const shopName = requiredText(body.shop_name, "shop_name", errors);
  const address = requiredText(body.address, "address", errors);
  const contactNumber = requiredText(body.contact_number, "contact_number", errors);
  const gstin = optionalText(body.gstin, "gstin", errors).toUpperCase();
  const adminUsername = normalizeUsername(body.admin_username);
  const adminFullName = optionalText(body.admin_full_name ?? body.admin_username, "admin_full_name", errors) || adminUsername;
  const adminPassword = body.admin_password;

  if (gstin && !gstinPattern.test(gstin)) {
    errors.push("GSTIN must be a valid 15-character GSTIN.");
  }

  if (!adminUsername) {
    errors.push("admin_username is required.");
  }

  if (typeof adminPassword !== "string" || adminPassword.length < 8) {
    errors.push("admin_password must be at least 8 characters.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    setup: {
      shopName,
      address,
      gstin,
      contactNumber,
      adminUsername,
      adminFullName,
      adminPassword: adminPassword as string
    }
  };
}

function requiredText(value: unknown, field: string, errors: string[]) {
  const text = optionalText(value, field, errors);

  if (!text) {
    errors.push(`${field} is required.`);
  }

  return text;
}

function optionalText(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return "";
  }

  return value.trim();
}

function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "MANAGER" || value === "ACCOUNTANT" || value === "COUNTER_STAFF";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

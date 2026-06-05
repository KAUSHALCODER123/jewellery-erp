import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/client.js";
import { tokenBlacklist, users, type UserRole } from "../db/schema.js";

export type JwtUserPayload = {
  userId: number;
  id: number;
  username: string;
  role: UserRole;
  is_active: boolean;
  jti?: string;
  exp?: number;
};

export type AuthenticatedRequest = Request & {
  user: JwtUserPayload;
};

export function verifyToken(request: Request, response: Response, next: NextFunction) {
  return authenticateRequest(getBearerToken(request), request, response, next);
}

/**
 * Like verifyToken, but also accepts the JWT via a `token` query param. Browser
 * navigations (window.open / anchor href) used for document/PDF routes cannot set
 * an Authorization header, so those routes authenticate with this variant.
 */
export function verifyTokenAllowQueryToken(request: Request, response: Response, next: NextFunction) {
  const headerToken = getBearerToken(request);
  const queryToken = typeof request.query?.token === "string" ? request.query.token : undefined;
  return authenticateRequest(headerToken ?? queryToken, request, response, next);
}

function authenticateRequest(token: string | undefined, request: Request, response: Response, next: NextFunction) {
  if (!token) {
    return response.status(401).json({ errors: ["Authentication token required."] });
  }

  let decoded: jwt.JwtPayload & Partial<JwtUserPayload>;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & Partial<JwtUserPayload>;
  } catch {
    return response.status(401).json({ errors: ["Invalid or expired authentication token."] });
  }

  if (!decoded.userId || !decoded.username || !isUserRole(decoded.role)) {
    return response.status(401).json({ errors: ["Invalid authentication token."] });
  }

  // Reject tokens that were explicitly revoked (logout / forced sign-out).
  if (decoded.jti) {
    const revoked = db.query.tokenBlacklist.findFirst({
      where: eq(tokenBlacklist.token_jti, decoded.jti)
    }).sync();

    if (revoked) {
      return response.status(401).json({
        error: "TOKEN_REVOKED",
        message: "Session has been invalidated. Please log in again."
      });
    }
  }

  // Reject tokens for users an admin has deactivated, even before token expiry.
  const account = db.query.users.findFirst({
    where: eq(users.id, decoded.userId)
  }).sync();

  if (!account || !account.is_active) {
    return response.status(401).json({
      error: "TOKEN_REVOKED",
      message: "Session has been invalidated. Please log in again."
    });
  }

  (request as AuthenticatedRequest).user = {
    userId: decoded.userId,
    id: decoded.userId,
    username: decoded.username,
    role: decoded.role,
    is_active: true,
    jti: decoded.jti,
    exp: decoded.exp
  };

  return next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const user = (request as Partial<AuthenticatedRequest>).user;

    if (!user) {
      return response.status(401).json({ errors: ["Authentication required."] });
    }

    if (!allowedRoles.includes(user.role)) {
      return response.status(403).json({ errors: ["Insufficient role access."] });
    }

    return next();
  };
}

export function signAuthToken(user: { id: number; username: string; role: UserRole }) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      jti: randomUUID()
    },
    getJwtSecret(),
    { expiresIn: "12h" }
  );
}

/**
 * Verify a bearer token and add its jti to the blacklist so it can no longer be
 * used. Returns false when the token is missing/invalid (nothing to revoke).
 */
export function revokeToken(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  let decoded: jwt.JwtPayload & Partial<JwtUserPayload>;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & Partial<JwtUserPayload>;
  } catch {
    return false;
  }

  if (!decoded.jti) {
    return false;
  }

  // exp is unix seconds; store an ISO timestamp the cleanup job can purge by.
  const expiresAt = decoded.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  db.insert(tokenBlacklist)
    .values({
      token_jti: decoded.jti,
      user_id: decoded.userId ?? null,
      expires_at: expiresAt
    })
    .onConflictDoNothing()
    .run();

  return true;
}

export function getBearerToken(request: Request) {
  const authorization = request.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

function getJwtSecret() {
  return process.env.JWT_SECRET || "local-development-jwt-secret-change-me";
}

function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "MANAGER" || value === "ACCOUNTANT" || value === "COUNTER_STAFF";
}

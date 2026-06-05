export {
  verifyToken as requireAuth,
  requireRole,
  type AuthenticatedRequest
} from "../middlewares/authMiddleware.js";

import { requireRole } from "../middlewares/authMiddleware.js";
import type { UserRole } from "../db/schema.js";

export const requireAdmin = requireRole(["ADMIN"]);

export function requireRoles(...allowedRoles: UserRole[]) {
  return requireRole(allowedRoles);
}

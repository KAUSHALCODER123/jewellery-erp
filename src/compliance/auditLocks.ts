import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { gstAuditPeriodLocks } from "../db/schema.js";

type QueryContext = Pick<typeof db, "select">;

export function findActiveGstLockForDate(context: QueryContext, documentDate: string) {
  return context
    .select()
    .from(gstAuditPeriodLocks)
    .where(
      and(
        eq(gstAuditPeriodLocks.status, "LOCKED"),
        lte(gstAuditPeriodLocks.period_from, documentDate),
        gte(gstAuditPeriodLocks.period_to, documentDate)
      )
    )
    .get();
}

export function isGstPeriodLocked(context: QueryContext, documentDate: string) {
  return Boolean(findActiveGstLockForDate(context, documentDate));
}

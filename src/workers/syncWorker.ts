import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { syncQueue, tokenBlacklist } from "../db/schema.js";
import { syncVoucherToTally } from "../utils/tallySync.js";
import { notifyEcommercePlatform } from "../utils/webhookNotifier.js";

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 30_000;
const BLACKLIST_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let blacklistCleanupHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Purge expired token-blacklist rows so the table doesn't grow forever.
 * expires_at is stored as an ISO string; CURRENT_TIMESTAMP uses a different
 * text format, so compare via datetime() to normalise both sides.
 */
export function purgeExpiredBlacklistedTokens() {
  try {
    const result = db
      .delete(tokenBlacklist)
      .where(sql`datetime(${tokenBlacklist.expires_at}) < datetime('now')`)
      .run();

    if (result.changes > 0) {
      console.log(`[SyncWorker] Purged ${result.changes} expired blacklisted token(s).`);
    }
  } catch (err) {
    console.error("[SyncWorker] Blacklist cleanup error:", err);
  }
}

function processTask(row: typeof syncQueue.$inferSelect) {
  const taskType = row.task_type as "TALLY_VOUCHER" | "ECOMMERCE_ITEM_SOLD";
  const payload = JSON.parse(row.payload);

  switch (taskType) {
    case "TALLY_VOUCHER":
      return syncVoucherToTally(payload.voucherId);
    case "ECOMMERCE_ITEM_SOLD":
      return notifyEcommercePlatform(payload.itemId, "ITEM_SOLD");
  }
}

async function tick() {
  try {
    const rows = db
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.status, "PENDING"),
          lt(syncQueue.attempts, MAX_ATTEMPTS)
        )
      )
      .all();

    for (const row of rows) {
      db.update(syncQueue)
        .set({
          status: "PROCESSING",
          attempts: row.attempts + 1,
          last_attempted_at: new Date().toISOString()
        })
        .where(eq(syncQueue.id, row.id))
        .run();

      try {
        await processTask(row);
        db.update(syncQueue)
          .set({ status: "DONE" })
          .where(eq(syncQueue.id, row.id))
          .run();
      } catch (err) {
        const newAttempts = row.attempts + 1;
        const newStatus = newAttempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
        db.update(syncQueue)
          .set({ status: newStatus, attempts: newAttempts })
          .where(eq(syncQueue.id, row.id))
          .run();
        console.error(`[SyncWorker] Task ${row.id} (${row.task_type}) failed (attempt ${newAttempts}/${MAX_ATTEMPTS}):`, err);
      }
    }
  } catch (err) {
    console.error("[SyncWorker] tick error:", err);
  }
}

export function startSyncWorker() {
  if (intervalHandle) {
    return;
  }
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  tick();

  blacklistCleanupHandle = setInterval(purgeExpiredBlacklistedTokens, BLACKLIST_CLEANUP_INTERVAL_MS);
  purgeExpiredBlacklistedTokens();
}

export function stopSyncWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (blacklistCleanupHandle) {
    clearInterval(blacklistCleanupHandle);
    blacklistCleanupHandle = null;
  }
}

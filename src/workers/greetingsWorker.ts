import { db } from "../db/client.js";
import { customers, organizationSettings } from "../db/schema.js";
import { triggerMessage, wasMessageSentOn } from "../utils/messageService.js";

// Automated customer greetings: a daily-cadence worker that sends birthday and
// anniversary WhatsApp messages without manual intervention. Dispatch is
// idempotent (one send per customer per occasion per day) via messageLogs, so the
// worker can poll hourly and survive restarts without spamming customers.

const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly; the per-day dedup makes the cadence safe
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function monthDayOf(dateStr: string | null | undefined): string | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  return dateStr.slice(5, 10); // MM-DD
}

export type GreetingsDispatchResult = {
  enabled: boolean;
  birthdays_sent: number;
  anniversaries_sent: number;
  skipped_already_sent: number;
  skipped_no_phone: number;
};

// Sends today's greetings. Exported and pure w.r.t. the clock (accepts `today`)
// so it can be driven by the scheduler, a manual "run now" endpoint, or a test.
export function runGreetingsDispatch(today: Date = new Date()): GreetingsDispatchResult {
  const result: GreetingsDispatchResult = {
    enabled: false,
    birthdays_sent: 0,
    anniversaries_sent: 0,
    skipped_already_sent: 0,
    skipped_no_phone: 0
  };

  const settings = db.select().from(organizationSettings).get();
  if (!settings?.auto_greetings_enabled) {
    return result;
  }
  result.enabled = true;

  const dateStr = today.toISOString().slice(0, 10);
  const todayMonthDay = dateStr.slice(5, 10);

  for (const customer of db.select().from(customers).all()) {
    const occasions: Array<{ template: string; counter: "birthdays_sent" | "anniversaries_sent" }> = [];
    if (monthDayOf(customer.birthday_date) === todayMonthDay) {
      occasions.push({ template: "BIRTHDAY_WISHES", counter: "birthdays_sent" });
    }
    if (monthDayOf(customer.anniversary_date) === todayMonthDay) {
      occasions.push({ template: "ANNIVERSARY_WISHES", counter: "anniversaries_sent" });
    }
    if (occasions.length === 0) continue;

    const phone = customer.whatsapp_phone?.trim() || customer.phone?.trim();
    if (!phone) {
      result.skipped_no_phone += occasions.length;
      continue;
    }

    for (const occasion of occasions) {
      if (wasMessageSentOn(customer.id, occasion.template, dateStr)) {
        result.skipped_already_sent += 1;
        continue;
      }
      const log = triggerMessage(occasion.template, customer.id, phone, { customer_name: customer.name });
      if (log?.status === "SENT") {
        result[occasion.counter] += 1;
      }
    }
  }

  if (result.birthdays_sent + result.anniversaries_sent > 0) {
    console.log(
      `[Greetings] Auto-sent ${result.birthdays_sent} birthday, ${result.anniversaries_sent} anniversary greeting(s).`
    );
  }
  return result;
}

export function startGreetingsWorker() {
  // Skip under the jest harness (matches the backup scheduler guard) so tests
  // drive runGreetingsDispatch() explicitly rather than via a live timer.
  if (process.env.NODE_ENV === "test" && process.env.PLAYWRIGHT !== "true") {
    return;
  }
  if (intervalHandle) return;
  // Run once shortly after boot, then hourly.
  intervalHandle = setInterval(() => {
    try {
      runGreetingsDispatch();
    } catch (error) {
      console.error("[Greetings] Dispatch failed:", error);
    }
  }, POLL_INTERVAL_MS);
  try {
    runGreetingsDispatch();
  } catch (error) {
    console.error("[Greetings] Initial dispatch failed:", error);
  }
}

export function stopGreetingsWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

import { and, eq, gt, lte } from "drizzle-orm";
import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { customers, girviLoans, gssAccounts, journalEntries, ledgers } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { getWhatsAppLink, triggerMessage } from "../utils/messageService.js";

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

function todayParts() {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return { iso, monthDay: iso.slice(5) }; // MM-DD
}

// Pull the trailing MM-DD from a stored date that may be "YYYY-MM-DD" or "MM-DD".
function monthDayOf(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(5);
  if (/^\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

// FIFO age (in days) of a customer udhari ledger's oldest unpaid debit lot.
function oldestUnpaidDays(ledgerId: number, todayMs: number): number {
  const entries = db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.ledger_id, ledgerId))
    .orderBy(journalEntries.created_at)
    .all();
  const lots: Array<{ date: string | null; remaining: number }> = [];
  for (const entry of entries) {
    if (entry.transaction_type === "DEBIT") {
      lots.push({ date: entry.created_at, remaining: entry.amount_paise });
    } else {
      let pay = entry.amount_paise;
      for (const lot of lots) {
        if (pay <= 0) break;
        const take = Math.min(lot.remaining, pay);
        lot.remaining -= take;
        pay -= take;
      }
    }
  }
  let oldest = 0;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    const lotMs = lot.date ? Date.parse(lot.date.slice(0, 10)) : todayMs;
    oldest = Math.max(oldest, Math.floor((todayMs - lotMs) / 86400000));
  }
  return oldest;
}

type Reminder = {
  type: "UDHARI_OVERDUE" | "GIRVI_DUE" | "GSS_MATURITY" | "BIRTHDAY" | "ANNIVERSARY";
  customer_id: number | null;
  customer_name: string;
  phone: string | null;
  detail: string;
  amount_rupees: string | null;
  reference: string | null;
  template: string;
  message: string;
  whatsapp_link: string | null;
};

// GET /api/reminders/due?overdue_days=30&window_days=7
// A morning follow-up digest across udhari, Girvi, Gold-Scheme, and customer occasions.
// Each item carries a ready WhatsApp deep link (sending stays manual / consent-friendly).
remindersRouter.get("/due", (request, response) => {
  const overdueDays = Math.max(0, Number(request.query.overdue_days) || 30);
  const windowDays = Math.max(0, Number(request.query.window_days) || 7);
  const { iso: todayIso, monthDay: todayMonthDay } = todayParts();
  const todayMs = Date.parse(todayIso);
  const horizonIso = new Date(todayMs + windowDays * 86400000).toISOString().slice(0, 10);

  const reminders: Reminder[] = [];

  // 1) Overdue udhari — NET balance per customer beyond the threshold. Advances net
  //    against dues (consistent with the ageing report), so a customer who has overpaid
  //    is not chased and split ledgers are combined.
  const udhariLedgerRows = db
    .select({
      ledger_id: ledgers.id,
      entity_id: ledgers.entity_id,
      customer_name: customers.name,
      phone: customers.phone,
      balance_paise: ledgers.balance_paise
    })
    .from(ledgers)
    .leftJoin(customers, eq(ledgers.entity_id, customers.id))
    .where(eq(ledgers.account_type, "CUSTOMER_UDHARI"))
    .all();

  const udhariByCustomer = new Map<string, { entity_id: number | null; customer_name: string | null; phone: string | null; balance_paise: number; ledger_ids: number[] }>();
  for (const row of udhariLedgerRows) {
    const key = row.entity_id !== null ? `c${row.entity_id}` : `l${row.ledger_id}`;
    const agg = udhariByCustomer.get(key) ?? { entity_id: row.entity_id, customer_name: row.customer_name, phone: row.phone, balance_paise: 0, ledger_ids: [] };
    agg.balance_paise += row.balance_paise;
    agg.ledger_ids.push(row.ledger_id);
    udhariByCustomer.set(key, agg);
  }

  for (const agg of udhariByCustomer.values()) {
    if (agg.balance_paise <= 0) continue; // net debtors only
    const age = Math.max(0, ...agg.ledger_ids.map((id) => oldestUnpaidDays(id, todayMs)));
    if (age < overdueDays) continue;
    const amount = paiseToRupees(agg.balance_paise);
    const name = agg.customer_name ?? "Customer";
    const log = agg.entity_id && agg.phone
      ? triggerMessage("UDHARI_BALANCE_REMINDER", agg.entity_id, agg.phone, { customer_name: name, amount })
      : null;
    const message = log?.message_body ?? `Dear ${name}, our records show an outstanding balance of Rs ${amount}. Kindly clear it at your convenience. Thank you.`;
    reminders.push({
      type: "UDHARI_OVERDUE",
      customer_id: agg.entity_id,
      customer_name: name,
      phone: agg.phone,
      detail: `Outstanding ${age} days`,
      amount_rupees: amount,
      reference: null,
      template: "UDHARI_BALANCE_REMINDER",
      message,
      whatsapp_link: agg.phone ? getWhatsAppLink(agg.phone, message) : null
    });
  }

  // 2) Girvi loans whose next due date has arrived (within the window).
  const girviRows = db
    .select({
      loan: girviLoans,
      customer_name: customers.name,
      phone: customers.phone
    })
    .from(girviLoans)
    .leftJoin(customers, eq(girviLoans.customer_id, customers.id))
    .where(eq(girviLoans.status, "ACTIVE"))
    .all();

  for (const row of girviRows) {
    const due = row.loan.next_due_date;
    if (!due || due > horizonIso) continue;
    const name = row.customer_name ?? "Customer";
    const amount = paiseToRupees(row.loan.principal_amount_paise);
    const log = row.phone
      ? triggerMessage("GIRVI_REMINDER", row.loan.customer_id, row.phone, { customer_name: name, loan_number: row.loan.loan_number, due_date: due, amount })
      : null;
    const message = log?.message_body ?? `Dear ${name}, your Girvi loan ${row.loan.loan_number} due date is ${due}. Please pay outstanding Rs ${amount}.`;
    reminders.push({
      type: "GIRVI_DUE",
      customer_id: row.loan.customer_id,
      customer_name: name,
      phone: row.phone,
      detail: due < todayIso ? `Overdue since ${due}` : `Due ${due}`,
      amount_rupees: amount,
      reference: row.loan.loan_number,
      template: "GIRVI_REMINDER",
      message,
      whatsapp_link: row.phone ? getWhatsAppLink(row.phone, message) : null
    });
  }

  // 3) Gold-Saving-Scheme accounts maturing within the window.
  const gssRows = db
    .select({
      account: gssAccounts,
      customer_name: customers.name,
      phone: customers.phone
    })
    .from(gssAccounts)
    .leftJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .where(and(eq(gssAccounts.status, "ACTIVE"), lte(gssAccounts.maturity_date, horizonIso)))
    .all();

  for (const row of gssRows) {
    const name = row.customer_name ?? "Customer";
    const log = row.phone
      ? triggerMessage("GSS_REMINDER", row.account.customer_id, row.phone, { customer_name: name, card_number: row.account.card_number, amount: "" })
      : null;
    const message = log?.message_body ?? `Dear ${name}, your Gold Scheme card ${row.account.card_number} is maturing on ${row.account.maturity_date}.`;
    reminders.push({
      type: "GSS_MATURITY",
      customer_id: row.account.customer_id,
      customer_name: name,
      phone: row.phone,
      detail: `Matures ${row.account.maturity_date}`,
      amount_rupees: null,
      reference: row.account.card_number,
      template: "GSS_REMINDER",
      message,
      whatsapp_link: row.phone ? getWhatsAppLink(row.phone, message) : null
    });
  }

  // 4) Birthdays & anniversaries falling today.
  const customerRows = db.select().from(customers).all();
  for (const c of customerRows) {
    const bday = monthDayOf(c.birthday_date);
    const anniv = monthDayOf(c.anniversary_date);
    if (bday === todayMonthDay) {
      const message = triggerMessage("BIRTHDAY_WISHES", c.id, c.phone ?? "", { customer_name: c.name })?.message_body
        ?? `Happy Birthday, ${c.name}! Wishing you joy and prosperity.`;
      reminders.push({
        type: "BIRTHDAY", customer_id: c.id, customer_name: c.name, phone: c.phone,
        detail: "Birthday today", amount_rupees: null, reference: null,
        template: "BIRTHDAY_WISHES", message,
        whatsapp_link: c.phone ? getWhatsAppLink(c.phone, message) : null
      });
    }
    if (anniv === todayMonthDay) {
      const message = `Happy Anniversary, ${c.name}! Warm wishes from all of us.`;
      reminders.push({
        type: "ANNIVERSARY", customer_id: c.id, customer_name: c.name, phone: c.phone,
        detail: "Anniversary today", amount_rupees: null, reference: null,
        template: "BIRTHDAY_WISHES", message,
        whatsapp_link: c.phone ? getWhatsAppLink(c.phone, message) : null
      });
    }
  }

  const counts = {
    udhari_overdue: reminders.filter((r) => r.type === "UDHARI_OVERDUE").length,
    girvi_due: reminders.filter((r) => r.type === "GIRVI_DUE").length,
    gss_maturity: reminders.filter((r) => r.type === "GSS_MATURITY").length,
    occasions: reminders.filter((r) => r.type === "BIRTHDAY" || r.type === "ANNIVERSARY").length,
    total: reminders.length
  };

  return response.json({ date: todayIso, overdue_days: overdueDays, window_days: windowDays, counts, reminders });
});

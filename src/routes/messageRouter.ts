import { Router } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  messageTemplates,
  messageLogs,
  customers,
  girviLoans,
  gssAccounts,
  gssTemplates,
  ledgers,
  organizationSettings
} from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { triggerMessage, ensureDefaultTemplatesExist, getWhatsAppLink } from "../utils/messageService.js";
import { paiseToRupees } from "../utils/decimal.js";

export const messageRouter = Router();
messageRouter.use(requireAuth);

messageRouter.get("/templates", (_request, response) => {
  ensureDefaultTemplatesExist();
  const templates = db.select().from(messageTemplates).all();
  return response.json({ templates });
});

messageRouter.put("/templates/:id", (request, response) => {
  const templateId = Number(request.params.id);
  const { content, channel, is_active } = request.body;

  if (typeof content !== "string" || !content.trim()) {
    return response.status(400).json({ errors: ["content must be a non-empty string."] });
  }

  const updated = db.update(messageTemplates)
    .set({
      content: content.trim(),
      channel: channel || "WHATSAPP",
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1
    })
    .where(eq(messageTemplates.id, templateId))
    .returning()
    .get();

  if (!updated) {
    return response.status(404).json({ errors: ["Template not found."] });
  }

  return response.json({ template: updated });
});

messageRouter.get("/logs", (request, response) => {
  const logs = db.select().from(messageLogs).orderBy(desc(messageLogs.created_at)).all();
  return response.json({ logs });
});

messageRouter.post("/send-manual", (request, response) => {
  const { recipient, message_body, channel, customer_id } = request.body;

  if (typeof recipient !== "string" || !recipient.trim()) {
    return response.status(400).json({ errors: ["recipient must be a non-empty string."] });
  }
  if (typeof message_body !== "string" || !message_body.trim()) {
    return response.status(400).json({ errors: ["message_body must be a non-empty string."] });
  }

  const cleanRecipient = recipient.trim();
  const phoneDigits = cleanRecipient.replace(/\D/g, "");
  const isValid = phoneDigits.length >= 10;
  const status = isValid ? "SENT" : "FAILED";
  const errorMsg = isValid ? null : "Invalid recipient phone number length.";

  const log = db.insert(messageLogs).values({
    customer_id: customer_id ? Number(customer_id) : null,
    template_name: "MANUAL",
    recipient: cleanRecipient,
    message_body: message_body.trim(),
    channel: channel || "WHATSAPP",
    status,
    error_message: errorMsg
  }).returning().get();

  return response.status(201).json({
    log,
    whatsapp_link: getWhatsAppLink(cleanRecipient, message_body.trim())
  });
});

messageRouter.get("/reminders/girvi", (request, response) => {
  ensureDefaultTemplatesExist();
  const template = db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.name, "GIRVI_REMINDER")
  }).sync();

  const activeLoans = db
    .select({
      loan: girviLoans,
      customer: customers
    })
    .from(girviLoans)
    .innerJoin(customers, eq(girviLoans.customer_id, customers.id))
    .where(eq(girviLoans.status, "ACTIVE"))
    .all();

  const settings = db.select().from(organizationSettings).get();
  const shopName = settings?.shop_name ?? "Our Shop";

  const reminders = activeLoans.map((row) => {
    const amountRupees = paiseToRupees(row.loan.principal_amount_paise);
    const dueDate = row.loan.next_due_date || "N/A";

    let preview = template?.content ?? "Dear {{customer_name}}, your Girvi loan {{loan_number}} due date is {{due_date}}. Please pay outstanding Rs {{amount}}.";
    preview = preview
      .replace(/\{\{\s*customer_name\s*\}\}/gi, row.customer.name)
      .replace(/\{\{\s*loan_number\s*\}\}/gi, row.loan.loan_number)
      .replace(/\{\{\s*amount\s*\}\}/gi, amountRupees)
      .replace(/\{\{\s*due_date\s*\}\}/gi, dueDate)
      .replace(/\{\{\s*shop_name\s*\}\}/gi, shopName);

    return {
      loan_id: row.loan.id,
      customer_id: row.customer.id,
      customer_name: row.customer.name,
      phone: row.customer.phone,
      loan_number: row.loan.loan_number,
      next_due_date: row.loan.next_due_date,
      principal_amount_paise: row.loan.principal_amount_paise,
      message_preview: preview,
      whatsapp_link: getWhatsAppLink(row.customer.phone, preview)
    };
  });

  return response.json({ reminders });
});

messageRouter.get("/reminders/gss", (request, response) => {
  ensureDefaultTemplatesExist();
  const template = db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.name, "GSS_REMINDER")
  }).sync();

  const activeAccounts = db
    .select({
      account: gssAccounts,
      template: gssTemplates,
      customer: customers
    })
    .from(gssAccounts)
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .where(eq(gssAccounts.status, "ACTIVE"))
    .all();

  const settings = db.select().from(organizationSettings).get();
  const shopName = settings?.shop_name ?? "Our Shop";

  const reminders = activeAccounts.map((row) => {
    const amountRupees = paiseToRupees(row.template.monthly_amount_paise);

    let preview = template?.content ?? "Dear {{customer_name}}, your Gold Scheme card {{card_number}} installment is due. Please pay Rs {{amount}}.";
    preview = preview
      .replace(/\{\{\s*customer_name\s*\}\}/gi, row.customer.name)
      .replace(/\{\{\s*card_number\s*\}\}/gi, row.account.card_number)
      .replace(/\{\{\s*amount\s*\}\}/gi, amountRupees)
      .replace(/\{\{\s*shop_name\s*\}\}/gi, shopName);

    return {
      gss_account_id: row.account.id,
      customer_id: row.customer.id,
      customer_name: row.customer.name,
      phone: row.customer.phone,
      card_number: row.account.card_number,
      monthly_amount_paise: row.template.monthly_amount_paise,
      message_preview: preview,
      whatsapp_link: getWhatsAppLink(row.customer.phone, preview)
    };
  });

  return response.json({ reminders });
});

messageRouter.get("/reminders/udhari", (request, response) => {
  ensureDefaultTemplatesExist();
  const template = db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.name, "UDHARI_BALANCE_REMINDER")
  }).sync();

  const settings = db.select().from(organizationSettings).get();
  const shopName = settings?.shop_name ?? "Our Shop";

  const rows = db
    .select({ customer: customers, ledger: ledgers })
    .from(ledgers)
    .innerJoin(customers, eq(ledgers.entity_id, customers.id))
    .where(and(eq(ledgers.account_type, "CUSTOMER_UDHARI"), gt(ledgers.balance_paise, 0)))
    .orderBy(desc(ledgers.balance_paise))
    .all();

  const reminders = rows.map((row) => {
    const amountRupees = paiseToRupees(row.ledger.balance_paise);
    let preview = template?.content ?? "Dear {{customer_name}}, our records show an outstanding balance of Rs {{amount}} at {{shop_name}}. Kindly clear it at your convenience. Thank you.";
    preview = preview
      .replace(/\{\{\s*customer_name\s*\}\}/gi, row.customer.name)
      .replace(/\{\{\s*amount\s*\}\}/gi, amountRupees)
      .replace(/\{\{\s*shop_name\s*\}\}/gi, shopName);

    return {
      ledger_id: row.ledger.id,
      customer_id: row.customer.id,
      customer_name: row.customer.name,
      phone: row.customer.phone,
      balance_paise: row.ledger.balance_paise,
      balance_rupees: amountRupees,
      message_preview: preview,
      whatsapp_link: getWhatsAppLink(row.customer.phone ?? "", preview)
    };
  });

  return response.json({ reminders });
});

messageRouter.get("/reminders/wishes", (request, response) => {
  ensureDefaultTemplatesExist();
  const template = db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.name, "BIRTHDAY_WISHES")
  }).sync();

  const todayMonthDay = new Date().toISOString().slice(5, 10); // "MM-DD"

  const celebratingCustomers = db
    .select()
    .from(customers)
    .where(
      sql`substr(${customers.birthday_date}, 6, 5) = ${todayMonthDay} OR substr(${customers.anniversary_date}, 6, 5) = ${todayMonthDay}`
    )
    .all();

  const settings = db.select().from(organizationSettings).get();
  const shopName = settings?.shop_name ?? "Our Shop";

  const reminders = celebratingCustomers.map((c) => {
    let preview = template?.content ?? "Happy Birthday, {{customer_name}}! Wishing you joy and prosperity. From {{shop_name}}.";
    preview = preview
      .replace(/\{\{\s*customer_name\s*\}\}/gi, c.name)
      .replace(/\{\{\s*shop_name\s*\}\}/gi, shopName);

    return {
      customer_id: c.id,
      customer_name: c.name,
      phone: c.phone,
      birthday_date: c.birthday_date,
      anniversary_date: c.anniversary_date,
      message_preview: preview,
      whatsapp_link: getWhatsAppLink(c.phone, preview)
    };
  });

  return response.json({ reminders });
});

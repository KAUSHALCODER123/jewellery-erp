import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { messageTemplates, messageLogs, organizationSettings } from "../db/schema.js";

const defaultTemplates = [
  {
    name: "POS_INVOICE_CREATED",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, thank you for shopping at {{shop_name}}. Your invoice {{invoice_number}} of Rs {{amount}} is ready."
  },
  {
    name: "GIRVI_LOAN_ISSUED",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, loan number {{loan_number}} of Rs {{amount}} is issued on {{date}}. Interest rate: {{interest_rate}}%."
  },
  {
    name: "GIRVI_REPAYMENT_RECEIVED",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, payment of Rs {{amount}} received for loan {{loan_number}} on {{date}}. Thank you."
  },
  {
    name: "GSS_INSTALLMENT_RECEIVED",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, payment of Rs {{amount}} received for Gold Scheme card {{card_number}} on {{date}}. Total Paid: Rs {{total_paid}}."
  },
  {
    name: "GIRVI_REMINDER",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, your Girvi loan {{loan_number}} due date is {{due_date}}. Please pay outstanding Rs {{amount}}."
  },
  {
    name: "GSS_REMINDER",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, your Gold Scheme card {{card_number}} installment is due. Please pay Rs {{amount}}."
  },
  {
    name: "UDHARI_BALANCE_REMINDER",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, our records show an outstanding balance of Rs {{amount}} at {{shop_name}}. Kindly clear it at your convenience. Thank you."
  },
  {
    name: "UDHARI_RECEIPT_CONFIRMED",
    channel: "WHATSAPP",
    content: "Dear {{customer_name}}, we received Rs {{amount}} on {{date}}. Your outstanding balance is now Rs {{balance_after}}. Thank you. - {{shop_name}}"
  },
  {
    name: "BIRTHDAY_WISHES",
    channel: "WHATSAPP",
    content: "Happy Birthday, {{customer_name}}! Wishing you joy and prosperity. From {{shop_name}}."
  },
  {
    name: "ANNIVERSARY_WISHES",
    channel: "WHATSAPP",
    content: "Happy Anniversary, {{customer_name}}! Warm wishes from all of us at {{shop_name}}."
  }
];

export function ensureDefaultTemplatesExist() {
  for (const t of defaultTemplates) {
    const existing = db.query.messageTemplates.findFirst({
      where: eq(messageTemplates.name, t.name)
    }).sync();
    if (!existing) {
      db.insert(messageTemplates).values(t).run();
    }
  }
}

export function triggerMessage(
  templateName: string,
  customerId: number | null,
  recipient: string,
  context: Record<string, string>
) {
  try {
    ensureDefaultTemplatesExist();

    const template = db.query.messageTemplates.findFirst({
      where: and(eq(messageTemplates.name, templateName), eq(messageTemplates.is_active, 1))
    }).sync();

    if (!template) {
      console.warn(`[Messenger] Template ${templateName} not found or inactive.`);
      return null;
    }

    const settings = db.select().from(organizationSettings).get();
    const shopName = settings?.shop_name ?? "Our Shop";

    let body = template.content;
    const fullContext = {
      ...context,
      shop_name: shopName
    };

    for (const [key, val] of Object.entries(fullContext)) {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
      body = body.replace(placeholder, val || "");
    }

    const phoneDigits = recipient.replace(/\D/g, "");
    const isValid = phoneDigits.length >= 10;
    const status = isValid ? "SENT" : "FAILED";
    const errorMsg = isValid ? null : "Invalid recipient phone number length.";

    const log = db.insert(messageLogs).values({
      customer_id: customerId,
      template_name: templateName,
      recipient,
      message_body: body,
      channel: template.channel,
      status,
      error_message: errorMsg
    }).returning().get();

    console.log(`[Messenger Triggered] Template: ${templateName}, To: ${recipient}, Status: ${status}`);
    return log;
  } catch (error) {
    console.error("[Messenger] Failed to trigger message:", error);
    return null;
  }
}

// True if a SENT message for this customer+template already exists on the given
// date — used to make automated greetings idempotent (one send per occasion/day).
export function wasMessageSentOn(customerId: number, templateName: string, dateStr: string): boolean {
  const existing = db
    .select({ id: messageLogs.id })
    .from(messageLogs)
    .where(
      and(
        eq(messageLogs.customer_id, customerId),
        eq(messageLogs.template_name, templateName),
        eq(messageLogs.status, "SENT"),
        sql`date(${messageLogs.created_at}) = ${dateStr}`
      )
    )
    .get();
  return Boolean(existing);
}

export function getWhatsAppLink(phone: string, text: string): string {
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length === 10) {
    cleanPhone = "91" + cleanPhone;
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

import { useEffect, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type MessengerModuleProps = {
  apiBaseUrl?: string;
};

type MessageTemplate = {
  id: number;
  name: string;
  channel: string;
  content: string;
  is_active: number;
};

type MessageLog = {
  id: number;
  customer_id?: number | null;
  template_name: string;
  recipient: string;
  message_body: string;
  channel: string;
  status: string;
  error_message?: string | null;
  created_at: string;
};

type Reminder = {
  customer_id: number;
  customer_name: string;
  phone: string;
  message_preview: string;
  whatsapp_link: string;
  // Dynamic details depending on type
  loan_number?: string;
  next_due_date?: string;
  card_number?: string;
  birthday_date?: string;
  anniversary_date?: string;
  balance_rupees?: string;
  ledger_id?: number;
};

type ActiveSubTab = "templates" | "reminders" | "logs" | "compose";
type ActiveReminderType = "birthdays" | "girvi" | "gss" | "udhari";

export default function MessengerModule({ apiBaseUrl = "" }: MessengerModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveSubTab>("templates");
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateContent, setTemplateContent] = useState("");
  const [logs, setLogs] = useState<MessageLog[]>([]);

  // Reminders tab states
  const [reminderType, setReminderType] = useState<ActiveReminderType>("birthdays");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderLoading, setReminderLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Manual compose
  const [composeRecipient, setComposeRecipient] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeChannel, setComposeChannel] = useState<"WHATSAPP" | "SMS">("WHATSAPP");
  const [composeSending, setComposeSending] = useState(false);
  const [composeWhatsAppLink, setComposeWhatsAppLink] = useState("");

  const authHeaders = {
    Authorization: `Bearer ${session?.token ?? ""}`,
    "Content-Type": "application/json"
  };

  useEffect(() => {
    void loadTemplates();
    void loadLogs();
  }, []);

  useEffect(() => {
    if (activeTab === "reminders") {
      void scanReminders();
    }
  }, [reminderType, activeTab]);

  async function loadTemplates() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/messenger/templates`, { headers: authHeaders });
      const result = await res.json() as { templates: MessageTemplate[] };
      setTemplates(result.templates || []);
      if (result.templates?.length > 0) {
        selectTemplate(result.templates[0]);
      }
    } catch {
      setTemplates([]);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/messenger/logs`, { headers: authHeaders });
      const result = await res.json() as { logs: MessageLog[] };
      setLogs(result.logs || []);
    } catch {
      setLogs([]);
    }
  }

  function selectTemplate(t: MessageTemplate) {
    setSelectedTemplateId(t.id);
    setTemplateContent(t.content);
  }

  async function sendManualMessage() {
    setMessage("");
    setError("");
    setComposeWhatsAppLink("");
    if (!composeRecipient.trim()) {
      setError("Enter a recipient phone number.");
      return;
    }
    if (!composeBody.trim()) {
      setError("Enter a message to send.");
      return;
    }
    setComposeSending(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/messenger/send-manual`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ recipient: composeRecipient.trim(), message_body: composeBody.trim(), channel: composeChannel })
      });
      const result = (await res.json().catch(() => null)) as { log?: { status?: string }; whatsapp_link?: string; errors?: string[] } | null;
      if (!res.ok) throw new Error(result?.errors?.join(" ") || "Could not send message.");
      const failed = result?.log?.status === "FAILED";
      setMessage(failed ? "Logged, but the phone number looked invalid." : "Message logged/sent.");
      // Don't offer an "Open in WhatsApp" link for an invalid number (FAILED send).
      setComposeWhatsAppLink(failed ? "" : (result?.whatsapp_link ?? ""));
      setComposeBody("");
      void loadLogs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send message.");
    } finally {
      setComposeSending(false);
    }
  }

  async function saveTemplate() {
    if (!selectedTemplateId) return;
    setError("");
    setMessage("");

    try {
      const res = await fetch(`${apiBaseUrl}/api/messenger/templates/${selectedTemplateId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ content: templateContent })
      });
      const result = await res.json() as { template?: MessageTemplate; errors?: string[] };

      if (!res.ok) {
        throw new Error(result.errors?.join(" ") || "Failed to update template.");
      }

      setMessage("Template updated successfully.");
      void loadTemplates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update template.");
    }
  }

  async function scanReminders() {
    setReminderLoading(true);
    setReminders([]);
    try {
      const endpoint = reminderType === "birthdays" ? "wishes" : reminderType;
      const res = await fetch(`${apiBaseUrl}/api/messenger/reminders/${endpoint}`, { headers: authHeaders });
      const result = await res.json() as { reminders: Reminder[] };
      setReminders(result.reminders || []);
    } catch {
      setReminders([]);
    } finally {
      setReminderLoading(false);
    }
  }

  function formatIndianPhone(phone: string) {
    let clean = phone.replace(/\D/g, "");
    if (clean.length === 10) clean = "91" + clean;
    return clean;
  }

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold uppercase text-white">Messenger & CRM Automation</h1>
          <p className="text-xs text-slate-400">Manage transaction alerts, due reminders, and customer wishes</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <button onClick={() => setActiveTab("templates")} className={`h-8 px-4 font-semibold uppercase ${activeTab === "templates" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
            Event Templates
          </button>
          <button onClick={() => setActiveTab("compose")} className={`h-8 px-4 font-semibold uppercase ${activeTab === "compose" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
            Send Message
          </button>
          <button onClick={() => setActiveTab("reminders")} className={`h-8 px-4 font-semibold uppercase ${activeTab === "reminders" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
            Wishes & Reminders
          </button>
          <button onClick={() => setActiveTab("logs")} className={`h-8 px-4 font-semibold uppercase ${activeTab === "logs" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
            Message Logs
          </button>
        </nav>
      </header>

      {(message || error) && (
        <div className={`px-4 py-2 text-xs border-b border-slate-800 ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-auto">
        {activeTab === "compose" && (
          <div className="grid max-w-2xl gap-3 p-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-xs font-bold uppercase text-white">Send a Manual Message</h2>
              <p className="mt-1 text-[11px] text-slate-400">Compose a one-off WhatsApp/SMS message to any number. It is recorded in Message Logs.</p>
            </div>
            <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                  Recipient Phone
                  <input value={composeRecipient} onChange={(e) => setComposeRecipient(e.target.value)} placeholder="10-digit mobile" className="h-9 border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none focus:border-emerald-400 rounded" />
                </label>
                <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                  Channel
                  <select value={composeChannel} onChange={(e) => setComposeChannel(e.target.value === "SMS" ? "SMS" : "WHATSAPP")} className="h-9 border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none focus:border-emerald-400 rounded">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="SMS">SMS</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-400">
                Message
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={4} placeholder="Type your message…" className="border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-400 rounded" />
              </label>
              <div className="flex items-center justify-end gap-2">
                {composeWhatsAppLink && (
                  <a href={composeWhatsAppLink} target="_blank" rel="noopener noreferrer" className="h-9 inline-flex items-center rounded border border-emerald-500 px-4 text-xs font-bold uppercase text-emerald-300 hover:bg-emerald-950/30">
                    Open in WhatsApp
                  </a>
                )}
                <button type="button" onClick={() => void sendManualMessage()} disabled={composeSending} className="h-9 bg-emerald-500 px-5 text-xs font-bold uppercase text-slate-950 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 rounded">
                  {composeSending ? "Sending…" : "Send Message"}
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === "templates" && (
          <div className="grid h-full grid-cols-[280px_1fr] overflow-hidden">
            <aside className="border-r border-slate-800 bg-slate-900/50 p-4 overflow-y-auto">
              <h2 className="text-xs font-bold uppercase text-white mb-3">Event Alerts</h2>
              <div className="grid gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={`p-3 text-left border text-xs rounded transition-all ${selectedTemplateId === t.id ? "border-emerald-500 bg-emerald-950/20 text-white" : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"}`}
                  >
                    <div className="font-semibold uppercase">{t.name.replace(/_/g, " ")}</div>
                    <div className="text-[10px] opacity-70 mt-1">{t.channel}</div>
                  </button>
                ))}
              </div>
            </aside>

            <section className="p-6 overflow-y-auto grid grid-cols-[1fr_320px] gap-6">
              <div className="bg-slate-900 p-6 rounded-lg border border-slate-800 flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold uppercase text-white mb-1">
                    Edit {templates.find((t) => t.id === selectedTemplateId)?.name.replace(/_/g, " ")} Content
                  </h3>
                  <p className="text-xs text-slate-400">Configure what text gets sent when this transaction triggers.</p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Template Content</label>
                  <textarea
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    rows={8}
                    className="w-full bg-slate-950 border border-slate-800 p-3 text-xs text-white rounded font-sans focus:border-emerald-400 outline-none resize-none"
                  />
                </div>

                <button onClick={saveTemplate} className="w-36 h-9 bg-emerald-500 hover:bg-emerald-600 text-xs font-bold uppercase text-slate-950 rounded transition-all">
                  Save Changes
                </button>
              </div>

              <aside className="bg-slate-900/40 border border-slate-800 p-4 rounded-lg flex flex-col gap-3">
                <h4 className="text-xs font-bold uppercase text-white">Placeholder Tokens</h4>
                <p className="text-[11px] text-slate-400">Use double curly braces to insert dynamic details:</p>
                <div className="grid gap-2 text-xs">
                  <TokenItem token="customer_name" description="Name of the customer/borrower" />
                  <TokenItem token="amount" description="Formatted amount in Rs" />
                  <TokenItem token="invoice_number" description="Invoice ID/Reference" />
                  <TokenItem token="loan_number" description="Girvi loan number" />
                  <TokenItem token="card_number" description="Gold scheme card code" />
                  <TokenItem token="due_date" description="Next installment/due date" />
                  <TokenItem token="date" description="Transaction date" />
                  <TokenItem token="total_paid" description="GSS cumulative paid sum" />
                  <TokenItem token="shop_name" description="Shop name from settings" />
                </div>
              </aside>
            </section>
          </div>
        )}

        {activeTab === "reminders" && (
          <div className="grid h-full grid-rows-[auto_1fr] p-4 gap-3">
            <div className="flex gap-2 border-b border-slate-800 pb-3 items-center justify-between">
              <div className="flex border border-slate-700 text-xs">
                <button onClick={() => setReminderType("birthdays")} className={`h-8 px-4 font-semibold uppercase ${reminderType === "birthdays" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
                  🎂 Birthdays/Anniversaries
                </button>
                <button onClick={() => setReminderType("girvi")} className={`h-8 px-4 font-semibold uppercase ${reminderType === "girvi" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
                  🖨️ Girvi Due Reminders
                </button>
                <button onClick={() => setReminderType("gss")} className={`h-8 px-4 font-semibold uppercase ${reminderType === "gss" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
                  🟡 GSS Installment Due
                </button>
                <button onClick={() => setReminderType("udhari")} className={`h-8 px-4 font-semibold uppercase ${reminderType === "udhari" ? "bg-emerald-500 text-slate-950" : "bg-slate-950 text-slate-300"}`}>
                  💳 Udhari Outstanding
                </button>
              </div>

              <button onClick={scanReminders} className="h-8 px-4 bg-slate-800 hover:bg-slate-700 text-xs font-semibold uppercase text-white rounded">
                🔄 Scan Dues
              </button>
            </div>

            <div className="min-h-0 overflow-auto border border-slate-800 bg-slate-950 rounded">
              {reminderLoading ? (
                <div className="h-48 grid place-items-center text-xs text-slate-500">Scanning database records...</div>
              ) : reminders.length === 0 ? (
                <div className="h-48 grid place-items-center text-xs text-slate-500">No matching due entries found for this type.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase">
                      <th className="p-3">Customer</th>
                      <th className="p-3">Phone</th>
                      <th className="p-3">Details</th>
                      <th className="p-3">Message Preview</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {reminders.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-900/50">
                        <td className="p-3 font-semibold text-white">{r.customer_name}</td>
                        <td className="p-3 font-mono text-slate-300">{r.phone}</td>
                        <td className="p-3 text-slate-400">
                          {reminderType === "birthdays" && (r.birthday_date ? `DOB: ${r.birthday_date}` : `Anniv: ${r.anniversary_date}`)}
                          {reminderType === "girvi" && `Loan: ${r.loan_number} | Due: ${r.next_due_date || "N/A"}`}
                          {reminderType === "gss" && `Card: ${r.card_number}`}
                          {reminderType === "udhari" && <span className="font-mono font-semibold text-red-300">Rs {r.balance_rupees}</span>}
                        </td>
                        <td className="p-3 text-slate-300 italic max-w-sm truncate" title={r.message_preview}>
                          "{r.message_preview}"
                        </td>
                        <td className="p-3 text-right">
                          <a
                            href={r.whatsapp_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center h-7 px-3 bg-emerald-500 hover:bg-emerald-600 text-[10px] font-bold uppercase text-slate-950 rounded transition-all"
                          >
                            💬 Send WhatsApp
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="grid h-full grid-rows-[auto_1fr] p-4 gap-3">
            <div className="flex border-b border-slate-800 pb-2 items-center justify-between">
              <h2 className="text-xs font-bold uppercase text-white">Log Dispatch History</h2>
              <button onClick={loadLogs} className="h-7 px-3 bg-slate-800 hover:bg-slate-700 text-xs font-semibold uppercase text-white rounded">
                Refresh
              </button>
            </div>

            <div className="min-h-0 overflow-auto border border-slate-800 bg-slate-950 rounded">
              {logs.length === 0 ? (
                <div className="h-48 grid place-items-center text-xs text-slate-500">No message dispatches logged yet.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase">
                      <th className="p-3">Date</th>
                      <th className="p-3">Recipient</th>
                      <th className="p-3">Trigger Alert</th>
                      <th className="p-3">Message Body</th>
                      <th className="p-3">Channel</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {logs.map((log) => {
                      const isSent = log.status === "SENT";
                      return (
                        <tr key={log.id} className="hover:bg-slate-900/50">
                          <td className="p-3 font-mono text-slate-400">{log.created_at.slice(0, 19).replace("T", " ")}</td>
                          <td className="p-3 font-mono text-slate-200">{log.recipient}</td>
                          <td className="p-3 font-semibold text-white uppercase text-[10px]">{log.template_name.replace(/_/g, " ")}</td>
                          <td className="p-3 text-slate-300 italic max-w-md truncate" title={log.message_body}>
                            {log.message_body}
                          </td>
                          <td className="p-3 font-semibold text-[10px] text-slate-400">{log.channel}</td>
                          <td className="p-3">
                            <span className={`inline-block px-2 py-0.5 text-[9px] font-bold uppercase rounded ${isSent ? "bg-emerald-950/50 text-emerald-300 border border-emerald-800" : "bg-red-950/50 text-red-300 border border-red-800"}`}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function TokenItem({ token, description }: { token: string; description: string }) {
  return (
    <div className="bg-slate-950 p-2 border border-slate-800 rounded">
      <code className="text-emerald-400 font-mono">{"{{" + token + "}}"}</code>
      <div className="text-[10px] text-slate-500 mt-1">{description}</div>
    </div>
  );
}

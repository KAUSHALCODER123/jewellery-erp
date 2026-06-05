import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { voucherHeaders, voucherLines, ledgers, organizationSettings } from "../db/schema.js";

/**
 * Escape values interpolated into the Tally XML so ledger names / narrations
 * containing &, <, >, ", ' cannot break the document structure or inject markup.
 */
function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format date from YYYY-MM-DD or ISO string to Tally YYYYMMDD format
 */
function formatTallyDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // Extract digits
  const clean = dateStr.replace(/[^0-9]/g, "");
  if (clean.length >= 8) {
    return clean.slice(0, 8);
  }
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Synchronizes a completed voucher to Tally XML gateway
 */
export async function syncVoucherToTally(voucherId: number): Promise<void> {
  try {
    // 1. Fetch settings
    const settings = db.query.organizationSettings.findFirst().sync();
    if (!settings || !settings.tally_sync_enabled) {
      return;
    }

    const gatewayUrl = settings.tally_gateway_url || "http://localhost:9000";
    const companyName = settings.tally_company_name || "Test Shop";

    // 2. Fetch voucher header
    const header = db.query.voucherHeaders.findFirst({
      where: eq(voucherHeaders.id, voucherId)
    }).sync();

    if (!header) {
      console.warn(`[TallySync] Voucher ${voucherId} not found in database.`);
      return;
    }

    // 3. Fetch voucher lines with ledger details
    const lines = db.select({
      id: voucherLines.id,
      transactionType: voucherLines.transaction_type,
      amountPaise: voucherLines.amount_paise,
      description: voucherLines.description,
      ledgerName: ledgers.account_name
    })
    .from(voucherLines)
    .innerJoin(ledgers, eq(voucherLines.ledger_id, ledgers.id))
    .where(eq(voucherLines.voucher_id, voucherId))
    .all();

    if (lines.length === 0) {
      console.warn(`[TallySync] Voucher ${voucherId} has no accounting lines.`);
      return;
    }

    // Tally dates require YYYYMMDD
    const tallyDate = formatTallyDate(header.created_at || "");
    const voucherType = header.voucher_type || "Journal";
    const narration = header.narration || `${voucherType} Voucher ${header.voucher_number}`;

    // 4. Construct Tally XML Envelope
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${xmlEscape(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${tallyDate}</DATE>
            <VOUCHERNUMBER>${xmlEscape(header.voucher_number)}</VOUCHERNUMBER>
            <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>
            <NARRATION>${xmlEscape(narration)}</NARRATION>
`;

    // Add ledger entries list
    // Note: Debit amounts are negative in Tally XML, Credit amounts are positive.
    for (const line of lines) {
      const isDebit = line.transactionType === "DEBIT";
      const amountRupees = (line.amountPaise / 100).toFixed(2);
      const tallyAmount = isDebit ? `-${amountRupees}` : amountRupees;
      const deemedPositive = isDebit ? "Yes" : "No";

      xml += `            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${xmlEscape(line.ledgerName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>${deemedPositive}</ISDEEMEDPOSITIVE>
              <AMOUNT>${tallyAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>\n`;
    }

    xml += `          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    // 5. Send XML payload to Tally XML Gateway
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "Accept": "text/xml"
      },
      body: xml
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[TallySync] Sync failed with HTTP status ${response.status}: ${responseText}`);
      return;
    }

    if (responseText.includes("<LINEERROR>") || responseText.includes("failed")) {
      console.warn(`[TallySync] Tally Prime returned import errors: ${responseText}`);
    } else {
      console.log(`[TallySync] Successfully synchronized voucher ${header.voucher_number} to Tally.`);
    }

  } catch (err) {
    console.error("[TallySync] Exception during synchronization:", err);
  }
}

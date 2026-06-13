import { and, eq, ne, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  barcodeSequences,
  customers,
  gssAccounts,
  invoiceLines,
  invoices,
  items,
  itemStones,
  kycVault,
  loyaltyLedger,
  organizationSettings,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseReturnLines,
  purchaseReturns,
  quotationLines,
  quotations,
  salesReturnLines,
  salesReturns,
  refineries,
  refineryTransfers,
  urdPurchases,
  urdVouchers,
  scannerAuditLogs,
  ledgers,
  customerOrders,
  voucherHeaders
} from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { triggerMessage } from "../utils/messageService.js";
import { postBalancedVoucher, type VoucherPostingLine } from "../accounts/posting.js";
import { isGstPeriodLocked } from "../compliance/auditLocks.js";
import { syncQueue, type SyncQueueTaskType } from "../db/schema.js";

export const posRouter = Router();

const CASH_PAN_AADHAAR_THRESHOLD_PAISE = 20000000;
const LOYALTY_PAISE_PER_POINT = 100; // 1 loyalty point = Rs 1 when redeemed
const DEFAULT_HSN_CODE = "7113";

posRouter.post("/checkout", requireAuth, (request, response) => {
  const validation = validateCheckoutPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // 1. Enforce GST Audit Lock on today's transaction date
  const todayStr = new Date().toISOString().slice(0, 10);
  if (isGstPeriodLocked(db, todayStr)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  if (validation.checkout.customerId !== null) {
    const customer = db.query.customers.findFirst({
      where: eq(customers.id, validation.checkout.customerId)
    }).sync();

    if (!customer) {
      return response.status(404).json({ errors: ["Customer not found."] });
    }

    // Blacklist is a credit-risk control: block credit (udhari) sales, allow paid-in-full sales.
    if (customer.is_blacklisted && validation.checkout.payments.udhari > 0) {
      return response.status(422).json({
        errors: [`Customer is blacklisted${customer.blacklist_reason ? `: ${customer.blacklist_reason}` : ""}. Udhari (credit) is not allowed.`]
      });
    }
  }

  // Order-conversion: validate the booked order and decide how its advance is funded.
  // A booking voucher (CUSTOMER_ORDER_ADVANCE) means the advance is already sitting as a
  // customer credit, so the sale consumes it from the udhari ledger. Legacy orders booked
  // before advances were journaled have no such voucher, so the advance is recognised as
  // cash received at delivery instead.
  let advanceFundedFromCredit = false;
  if (validation.checkout.customerOrderId !== null) {
    const order = db.select().from(customerOrders).where(eq(customerOrders.id, validation.checkout.customerOrderId)).get();

    if (!order) {
      return response.status(404).json({ errors: ["Customer order not found."] });
    }

    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      return response.status(422).json({ errors: [`Order ${order.order_number} is already ${order.status.toLowerCase()} and cannot be billed again.`] });
    }

    if (validation.checkout.customerId !== null && order.customer_id !== validation.checkout.customerId) {
      return response.status(422).json({ errors: ["Customer order belongs to a different customer."] });
    }

    if (validation.checkout.payments.advance > order.advance_paise) {
      return response.status(422).json({ errors: [`Applied advance exceeds the Rs ${paiseToRupees(order.advance_paise)} advance collected on order ${order.order_number}.`] });
    }

    const advanceVoucher = db
      .select()
      .from(voucherHeaders)
      .where(and(eq(voucherHeaders.reference_type, "CUSTOMER_ORDER_ADVANCE"), eq(voucherHeaders.reference_id, order.id)))
      .get();
    advanceFundedFromCredit = Boolean(advanceVoucher);
  }

  const settings = db.select().from(organizationSettings).get();
  const gstPercentage = validation.checkout.invoice.gstNotRequired ? 0 : settings?.default_gst_percentage ?? 3.0;
  const gstAmountPaise = validation.checkout.invoice.gstNotRequired ? 0 : validation.checkout.totals.gstPaise ?? calculateInclusiveTaxPaise(validation.checkout.totals.netPayablePaise, gstPercentage);
  
  // 2. GST supply type and state code handling
  const shopGstin = settings?.gstin ?? "";
  const shopStateCode = (shopGstin && shopGstin.trim().length >= 2) ? shopGstin.trim().slice(0, 2) : "27";
  const placeOfSupply = validation.checkout.invoice.placeOfSupplyStateCode || shopStateCode;
  
  let gstSupplyType = validation.checkout.invoice.gstSupplyType;
  if (!gstSupplyType) {
    gstSupplyType = placeOfSupply === shopStateCode ? "INTRA_STATE" : "INTER_STATE";
  }

  let cgstAmountPaise = 0;
  let sgstAmountPaise = 0;
  let igstAmountPaise = 0;

  if (gstSupplyType === "INTRA_STATE") {
    cgstAmountPaise = Math.floor(gstAmountPaise / 2);
    sgstAmountPaise = gstAmountPaise - cgstAmountPaise;
  } else {
    igstAmountPaise = gstAmountPaise;
  }

  const taxableValuePaise = Math.max(validation.checkout.totals.netPayablePaise - gstAmountPaise, 0);
  const userId = (request as AuthenticatedRequest).user.id;

  try {
    const result = runWithRetry(() => db.transaction((tx) => {
      // 3. Block sale of any non-hallmarked Gold items
      for (const line of validation.checkout.salesItems) {
        const item = tx.select().from(items).where(eq(items.id, line.itemId)).get();

        if (!item) {
          throw new CheckoutConflictError(`Item ${line.barcode} was not found.`);
        }

        if (item.status !== "IN_STOCK") {
          throw new ItemAlreadySoldError(`Item ${line.barcode} is not available in stock.`);
        }

        // A weight-based item billed at a zero per-gram metal rate is almost always an error
        // (the live rate failed to load). Quantity-wise items sell at a flat unit price and
        // legitimately carry no metal rate, so they are exempt.
        if (item.sale_mode === "WEIGHT_WISE" && item.net_weight_mg > 0 && line.metalRatePaisePerGram <= 0) {
          throw new CheckoutConflictError(`Item ${item.barcode}: metal rate per gram cannot be zero for a weight-based item.`);
        }

        if (item.metal_type.toLowerCase() === "gold") {
          // Recycled URD gold purchased from customers is exempt from HUID validation at POS.
          // BIS hallmarking is applied during the next refinery/assay cycle.
          if (item.is_urd_recycled_gold) {
            continue;
          }

          const hasValidHuid = item.huid && /^[A-Z0-9]{6}$/.test(item.huid.trim().toUpperCase());
          const isHallmarked = item.huid_status === "HUID_RECEIVED" || item.huid_status === "CERT_PRINTED";
          if (!hasValidHuid || !isHallmarked) {
            throw new CheckoutConflictError(`Item ${item.barcode} cannot be sold because it has not been hallmarked (HUID is required).`);
          }
        }
      }

      const invoice = tx
        .insert(invoices)
        .values({
          invoice_number: generateInvoiceNumber(),
          customer_id: validation.checkout.customerId,
          walk_in_name: validation.checkout.walkInName,
          total_amount_paise: validation.checkout.totals.netPayablePaise,
          gst_percentage: gstPercentage,
          gst_amount_paise: gstAmountPaise,
          hsn_code: DEFAULT_HSN_CODE,
          discount_paise: validation.checkout.totals.discountPaise,
          wastage_total_paise: 0,
          urd_deduction_paise: validation.checkout.totals.urdDeductionPaise,
          gss_credit_paise: validation.checkout.payments.gssCredit,
          cheque_amount_paise: validation.checkout.payments.cheque,
          neft_amount_paise: validation.checkout.payments.neft,
          invoice_type: "SALE",
          bill_prefix: validation.checkout.invoice.billPrefix,
          manual_number: validation.checkout.invoice.manualNumber,
          due_date: validation.checkout.invoice.dueDate,
          salesman_name: validation.checkout.invoice.salesmanName,
          gst_not_required: validation.checkout.invoice.gstNotRequired,
          payment_mode: getInvoicePaymentMode(validation.checkout.payments),
          payment_reference_json: JSON.stringify(validation.checkout.paymentReferences),
          is_cash_above_limit: validation.checkout.payments.cash >= CASH_PAN_AADHAAR_THRESHOLD_PAISE,
          // Store detailed splits
          cgst_paise: cgstAmountPaise,
          sgst_paise: sgstAmountPaise,
          igst_paise: igstAmountPaise,
          supply_state_code: shopStateCode,
          place_of_supply_state_code: placeOfSupply,
          gst_supply_type: gstSupplyType as any,
          taxable_value_paise: taxableValuePaise
        })
        .returning()
        .get();

      // Precompute per-line GST splits so line CGST/SGST sums reconcile exactly with
      // the invoice header: flooring each line independently can undershoot the
      // header CGST by up to lines-1 paise, which surfaces as a GSTR-1 mismatch.
      const lineGsts = validation.checkout.salesItems.map(
        (line) => line.gstPaise ?? calculateInclusiveTaxPaise(line.itemTotalPaise, gstPercentage)
      );
      const lineCgsts = lineGsts.map((gst) => Math.floor(gst / 2));
      if (gstSupplyType === "INTRA_STATE" && lineGsts.reduce((a, b) => a + b, 0) === gstAmountPaise) {
        let remainder = cgstAmountPaise - lineCgsts.reduce((a, b) => a + b, 0);
        for (let i = 0; i < lineCgsts.length && remainder > 0; i += 1) {
          if (lineGsts[i] % 2 === 1) {
            lineCgsts[i] += 1;
            remainder -= 1;
          }
        }
      }

      const createdInvoiceLines = validation.checkout.salesItems.map((line, lineIndex) => {
        const item = tx.select().from(items).where(eq(items.id, line.itemId)).get();

        if (!item) {
          throw new CheckoutConflictError(`Item ${line.barcode} was not found.`);
        }

        const lineGst = lineGsts[lineIndex];
        const lineTaxable = Math.max(line.itemTotalPaise - lineGst, 0);
        let lineCgst = 0;
        let lineSgst = 0;
        let lineIgst = 0;

        if (gstSupplyType === "INTRA_STATE") {
          lineCgst = lineCgsts[lineIndex];
          lineSgst = lineGst - lineCgst;
        } else {
          lineIgst = lineGst;
        }

        return tx
          .insert(invoiceLines)
          .values({
            invoice_id: invoice.id,
            item_id: line.itemId,
            metal_type: line.metalType ?? item.metal_type,
            purity_karat: line.purityKarat ?? item.purity_karat,
            gross_weight_mg: line.grossWeightMg ?? item.gross_weight_mg,
            net_weight_mg: line.netWeightMg ?? item.net_weight_mg,
            stone_weight_mg: line.stoneWeightMg ?? item.stone_weight_mg ?? 0,
            metal_rate_paise_per_gram: line.metalRatePaisePerGram,
            making_charge_paise: line.makingChargePaise,
            wastage_charge_paise: line.wastageChargePaise,
            gst_paise: lineGst,
            cgst_paise: lineCgst,
            sgst_paise: lineSgst,
            igst_paise: lineIgst,
            taxable_value_paise: lineTaxable,
            line_total_paise: line.itemTotalPaise
          })
          .returning()
          .get();
      });

      for (const line of validation.checkout.salesItems) {
        const updateResult = tx
          .update(items)
          .set({ status: "SOLD", huid_status: "SOLD" })
          .where(and(eq(items.id, line.itemId), eq(items.status, "IN_STOCK")))
          .run();

        if (updateResult.changes !== 1) {
          throw new ItemAlreadySoldError(`Item ${line.barcode} is not available in stock.`);
        }
      }

      const createdUrdPurchases = validation.checkout.urdItems.map((line) =>
        tx
          .insert(urdPurchases)
          .values({
            invoice_id: invoice.id,
            description: line.description,
            metal_type: line.metalType,
            purity_tunch: line.purityTunch,
            weight_mg: line.weightMg,
            applied_rate_paise_per_gram: line.appliedRatePaisePerGram,
            deduction_amount_paise: line.totalValuePaise
          })
          .returning()
          .get()
      );

      const kycRecords = insertKycVaultRecords(tx, validation.checkout, userId);
      const accountingVoucher = postBalancedVoucher(tx, {
        voucherType: "POS_SALE",
        referenceType: "POS_INVOICE",
        referenceId: invoice.id,
        narration: `POS invoice ${invoice.invoice_number}`,
        createdBy: userId,
        lines: buildPosSaleVoucherLines(validation.checkout, gstAmountPaise, invoice.invoice_number, advanceFundedFromCredit)
      });

      // Converting a booked order: consume its advance (above) and close it out.
      if (validation.checkout.customerOrderId !== null) {
        tx.update(customerOrders)
          .set({ status: "COMPLETED" })
          .where(eq(customerOrders.id, validation.checkout.customerOrderId))
          .run();
      }

      // Log checkout scans to scanner audit logs
      for (const line of validation.checkout.salesItems) {
        tx.insert(scannerAuditLogs).values({
          event_type: "BARCODE_SCAN",
          barcode: line.barcode,
          item_id: line.itemId,
          result: "POS_SOLD",
          context: `POS_CHECKOUT:${invoice.invoice_number}`,
          user_id: userId
        }).run();
      }

      // GSS maturity conversion: redeem a matured GSS account against this invoice
      let redeemedGssAccount = null;
      if (validation.checkout.gssAccountId !== null && validation.checkout.payments.gssCredit > 0) {
        const gssAccount = tx.select().from(gssAccounts).where(eq(gssAccounts.id, validation.checkout.gssAccountId)).get();

        if (!gssAccount) {
          throw new CheckoutConflictError("GSS account not found for redemption.");
        }

        if (gssAccount.status !== "MATURED" && gssAccount.status !== "ACTIVE") {
          throw new CheckoutConflictError(`GSS account ${gssAccount.card_number} is not eligible for conversion (status: ${gssAccount.status}).`);
        }

        if (validation.checkout.customerId !== null && gssAccount.customer_id !== validation.checkout.customerId) {
          throw new CheckoutConflictError("GSS account does not belong to this customer.");
        }

        if (validation.checkout.payments.gssCredit > gssAccount.total_paid_paise) {
          throw new CheckoutConflictError(`GSS credit (${validation.checkout.payments.gssCredit}) exceeds account balance (${gssAccount.total_paid_paise}).`);
        }

        tx.update(gssAccounts)
          .set({
            status: "CONVERTED_TO_SALE",
            redeemed_invoice_id: invoice.id,
            redeemed_at: new Date().toISOString()
          })
          .where(eq(gssAccounts.id, gssAccount.id))
          .run();

        redeemedGssAccount = { ...gssAccount, status: "CONVERTED_TO_SALE" as const, redeemed_invoice_id: invoice.id };
      }

      // Old-dues collection: post a receipt against the customer's udhari ledger in the same bill.
      let oldDuesCollectedPaise = 0;
      if (validation.checkout.oldDues.amountPaise > 0 && validation.checkout.customerId !== null) {
        const customerRow = tx.select().from(customers).where(eq(customers.id, validation.checkout.customerId)).get();
        const existingUdhari = tx
          .select()
          .from(ledgers)
          .where(and(eq(ledgers.account_type, "CUSTOMER_UDHARI"), eq(ledgers.entity_id, validation.checkout.customerId)))
          .get();
        const udhariLedgerName = existingUdhari?.account_name ?? `Udhari - ${customerRow?.name ?? validation.checkout.customerId}`;
        const tender = validation.checkout.oldDues.mode === "CASH"
          ? { name: "Cash", type: "CASH" as const }
          : { name: "Bank", type: "BANK" as const };

        postBalancedVoucher(tx, {
          voucherType: "UDHARI_RECEIPT",
          referenceType: "POS_OLD_DUES",
          referenceId: invoice.id,
          narration: `Old dues collected with ${invoice.invoice_number}`,
          createdBy: userId,
          lines: [
            { ledgerName: tender.name, accountType: tender.type, transactionType: "DEBIT", amountPaise: validation.checkout.oldDues.amountPaise },
            { ledgerName: udhariLedgerName, accountType: "CUSTOMER_UDHARI", entityId: validation.checkout.customerId, transactionType: "CREDIT", amountPaise: validation.checkout.oldDues.amountPaise }
          ]
        });
        oldDuesCollectedPaise = validation.checkout.oldDues.amountPaise;
      }

      // Loyalty: enrolled customers can redeem and earn; every movement is ledgered.
      let loyaltyPointsEarned = 0;
      let loyaltyPointsRedeemed = 0;
      if (validation.checkout.customerId !== null) {
        const customerRow = tx.select().from(customers).where(eq(customers.id, validation.checkout.customerId)).get();
        loyaltyPointsRedeemed = validation.checkout.loyaltyPointsRedeemed;

        if (loyaltyPointsRedeemed > 0 && !customerRow?.loyalty_enrolled) {
          throw new CheckoutConflictError("Customer is not enrolled in loyalty.");
        }

        if (loyaltyPointsRedeemed > 0 && (customerRow?.loyalty_points_balance ?? 0) < loyaltyPointsRedeemed) {
          throw new CheckoutConflictError("Insufficient loyalty points balance for redemption.");
        }

        if (customerRow?.loyalty_enrolled) {
          loyaltyPointsEarned = calculateLoyaltyPointsEarned(tx, validation.checkout, settings);
        }

        let loyaltyBalanceAfter = customerRow?.loyalty_points_balance ?? 0;
        if (loyaltyPointsRedeemed > 0) {
          loyaltyBalanceAfter -= loyaltyPointsRedeemed;
          tx.insert(loyaltyLedger).values({
            customer_id: validation.checkout.customerId,
            invoice_id: invoice.id,
            transaction_type: "REDEEM",
            points: -loyaltyPointsRedeemed,
            balance_after: loyaltyBalanceAfter,
            description: `Redeemed on ${invoice.invoice_number}`
          }).run();
        }

        if (loyaltyPointsEarned > 0) {
          loyaltyBalanceAfter += loyaltyPointsEarned;
          tx.insert(loyaltyLedger).values({
            customer_id: validation.checkout.customerId,
            invoice_id: invoice.id,
            transaction_type: "EARN",
            points: loyaltyPointsEarned,
            balance_after: loyaltyBalanceAfter,
            description: `Earned on ${invoice.invoice_number}`
          }).run();
        }

        if (loyaltyPointsEarned !== 0 || loyaltyPointsRedeemed !== 0) {
          tx.update(customers)
            .set({ loyalty_points_balance: loyaltyBalanceAfter })
            .where(eq(customers.id, validation.checkout.customerId))
            .run();
        }
      }

      return {
        invoice,
        invoiceLines: createdInvoiceLines,
        urdPurchases: createdUrdPurchases,
        kycRecords,
        accountingVoucher,
        redeemedGssAccount,
        oldDuesCollectedPaise,
        loyaltyPointsEarned,
        loyaltyPointsRedeemed
      };
    }, { behavior: 'immediate' }));

    // Enqueue Tally sync for retry-worker processing
    try {
      db.insert(syncQueue).values({
        task_type: "TALLY_VOUCHER",
        payload: JSON.stringify({ voucherId: result.accountingVoucher.voucher.id }),
        status: "PENDING",
        attempts: 0
      }).run();
    } catch (queueErr) {
      console.error("[POS] Failed to enqueue Tally sync task:", queueErr);
    }

    // Enqueue e-commerce notifications for retry-worker processing
    for (const item of validation.checkout.salesItems) {
      try {
        db.insert(syncQueue).values({
          task_type: "ECOMMERCE_ITEM_SOLD",
          payload: JSON.stringify({ itemId: item.itemId, barcode: item.barcode }),
          status: "PENDING",
          attempts: 0
        }).run();
      } catch (queueErr) {
        console.error(`[POS] Failed to enqueue e-commerce notification for item ${item.itemId}:`, queueErr);
      }
    }

    // Trigger customer notification for invoice creation
    if (validation.checkout.customerId !== null) {
      try {
        const customerRow = db.query.customers.findFirst({
          where: eq(customers.id, validation.checkout.customerId)
        }).sync();

        if (customerRow && customerRow.phone) {
          triggerMessage("POS_INVOICE_CREATED", customerRow.id, customerRow.phone, {
            customer_name: customerRow.name,
            invoice_number: result.invoice.invoice_number,
            amount: paiseToRupees(result.invoice.total_amount_paise)
          });
        }
      } catch (triggerErr) {
        console.error("Failed to trigger message for POS checkout:", triggerErr);
      }
    }

    return response.status(201).json({
      invoice_id: result.invoice.id,
      invoice: {
        ...result.invoice,
        total_amount_rupees: paiseToRupees(result.invoice.total_amount_paise),
        gst_amount_rupees: paiseToRupees(result.invoice.gst_amount_paise ?? 0)
      },
      invoice_lines: result.invoiceLines,
      urd_purchases: result.urdPurchases,
      kyc_vault: result.kycRecords,
      voucher: result.accountingVoucher.voucher,
      journal_entries: result.accountingVoucher.lines.map((line) => ({
        ...line.journalEntry,
        amount_rupees: paiseToRupees(line.journalEntry.amount_paise)
      })),
      redeemed_gss_account: result.redeemedGssAccount ?? null,
      old_dues_collected_paise: result.oldDuesCollectedPaise,
      loyalty_points_earned: result.loyaltyPointsEarned,
      loyalty_points_redeemed: result.loyaltyPointsRedeemed
    });
  } catch (caught) {
    if (caught instanceof ItemAlreadySoldError) {
      return response.status(409).json({
        error: "ITEM_ALREADY_SOLD",
        message: "This item was just sold at another counter. Please rescan inventory."
      });
    }

    if (caught instanceof CheckoutConflictError) {
      return response.status(409).json({ errors: [caught.message] });
    }

    throw caught;
  }
});

posRouter.post("/urd-vouchers", requireAuth, (request, response) => {
  const validation = validateStandaloneUrdVoucherPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  if (isGstPeriodLocked(db, validation.voucher.voucherDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;

  if (validation.voucher.customerId !== null) {
    const customer = db.query.customers.findFirst({
      where: eq(customers.id, validation.voucher.customerId)
    }).sync();

    if (!customer) {
      return response.status(404).json({ errors: ["Customer not found."] });
    }
  }

  try {
    const result = db.transaction((tx) => {
      const voucher = tx.insert(urdVouchers)
        .values({
          voucher_number: generateUrdVoucherNumber(),
          customer_id: validation.voucher.customerId,
          customer_name: validation.voucher.customerName,
          customer_phone: validation.voucher.customerPhone,
          voucher_date: validation.voucher.voucherDate,
          description: validation.voucher.description,
          metal_type: validation.voucher.metalType,
          purity_tunch: validation.voucher.purityTunch,
          gross_weight_mg: validation.voucher.grossWeightMg,
          stone_weight_mg: validation.voucher.stoneWeightMg,
          black_bead_weight_mg: validation.voucher.blackBeadWeightMg,
          net_weight_mg: validation.voucher.netWeightMg,
          fine_weight_mg: validation.voucher.fineWeightMg,
          applied_rate_paise_per_gram: validation.voucher.appliedRatePaisePerGram,
          total_value_paise: validation.voucher.totalValuePaise,
          payment_mode: validation.voucher.paymentMode,
          payment_reference: validation.voucher.paymentReference,
          pan_number: validation.voucher.panNumber,
          aadhaar_number: validation.voucher.aadhaarNumber,
          kyc_verified: validation.voucher.kycVerified,
          created_by: userId
        })
        .returning()
        .get();

      if (validation.voucher.customerId !== null) {
        const imagePath = typeof request.body.document_image_path === "string" ? request.body.document_image_path.trim() : null;
        if (validation.voucher.panNumber) {
          tx.insert(kycVault)
            .values({
              customer_id: validation.voucher.customerId,
              document_type: "PAN",
              document_number_masked: maskDocumentNumber(validation.voucher.panNumber),
              document_image_path: imagePath,
              verified_by: userId
            })
            .run();
        }
        if (validation.voucher.aadhaarNumber) {
          tx.insert(kycVault)
            .values({
              customer_id: validation.voucher.customerId,
              document_type: "AADHAAR",
              document_number_masked: maskDocumentNumber(validation.voucher.aadhaarNumber),
              document_image_path: imagePath,
              verified_by: userId
            })
            .run();
        }
      }

      return voucher;
    });

    return response.status(201).json({
      voucher: formatUrdVoucher(result)
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to create URD voucher."] });
  }
});

posRouter.patch("/urd-vouchers/:id/verify-kyc", requireAuth, (request, response) => {
  const voucherId = parsePositiveId(request.params.id);

  if (!voucherId) {
    return response.status(400).json({ errors: ["URD voucher id must be a positive integer."] });
  }

  const voucher = db.query.urdVouchers.findFirst({
    where: eq(urdVouchers.id, voucherId)
  }).sync();

  if (!voucher) {
    return response.status(404).json({ errors: ["URD voucher not found."] });
  }

  try {
    const updated = db.update(urdVouchers)
      .set({ kyc_verified: true })
      .where(eq(urdVouchers.id, voucherId))
      .returning()
      .get();

    return response.json({
      voucher: formatUrdVoucher(updated)
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to verify KYC."] });
  }
});

posRouter.get("/urd-purchases", requireAuth, (_request, response) => {
  try {
    const rows = db.select({
      purchase: urdPurchases,
      invoice: invoices,
      customer: customers
    })
    .from(urdPurchases)
    .innerJoin(invoices, eq(urdPurchases.invoice_id, invoices.id))
    .leftJoin(customers, eq(invoices.customer_id, customers.id))
    .all();

    return response.json({
      purchases: rows.map(r => ({
        ...r.purchase,
        invoice_number: r.invoice.invoice_number,
        customer_name: r.customer?.name || "Walk-in Customer",
        customer_phone: r.customer?.phone || null,
        pan_number: r.customer?.pan_number || null,
        aadhaar_number: r.customer?.aadhaar_number || null,
        kyc_verified: true,
        total_value_rupees: paiseToRupees(r.purchase.deduction_amount_paise)
      }))
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to list URD purchases."] });
  }
});

posRouter.post("/urd-purchases/:id/ingest-stock", requireAuth, (request, response) => {
  const purchaseId = parsePositiveId(request.params.id);

  if (!purchaseId) {
    return response.status(400).json({ errors: ["URD purchase id must be a positive integer."] });
  }

  const purchase = db.query.urdPurchases.findFirst({
    where: eq(urdPurchases.id, purchaseId)
  }).sync();

  if (!purchase) {
    return response.status(404).json({ errors: ["URD purchase not found."] });
  }

  // Enforce GST Audit Lock
  const todayStr = new Date().toISOString().slice(0, 10);
  if (isGstPeriodLocked(db, todayStr)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  if (purchase.stock_item_id) {
    return response.status(409).json({ errors: ["This URD purchase has already been ingested into stock."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const body = isRecord(request.body) ? request.body : {};
  const barcode = optionalTrimmedText(body.barcode) ?? `URD-PUR-${purchase.id}`;
  const location = optionalTrimmedText(body.location) ?? "OLD_GOLD_VAULT";

  const duplicate = db.query.items.findFirst({
    where: eq(items.barcode, barcode)
  }).sync();

  if (duplicate) {
    return response.status(409).json({ errors: ["An item already exists with this old-gold barcode."] });
  }

  const purityKarat = Math.max(1, Math.min(24, Math.round((Number(purchase.purity_tunch) * 24) / 100)));
  const fineWeightMg = Math.round((purchase.weight_mg * Number(purchase.purity_tunch)) / 100);

  try {
    const result = db.transaction((tx) => {
      const item = tx.insert(items)
        .values({
          barcode,
          huid: null,
          category: "Old Gold / URD",
          metal_type: purchase.metal_type,
          purity_karat: purityKarat,
          gross_weight_mg: purchase.weight_mg,
          stone_weight_mg: 0,
          black_bead_weight_mg: 0,
          net_weight_mg: purchase.weight_mg,
          final_weight_mg: purchase.weight_mg,
          fine_weight_mg: fineWeightMg,
          making_charge_type: "FLAT",
          making_charge_value: 0,
          design_name: purchase.description,
          tag_prefix: "URD",
          location,
          purchase_rate_paise: purchase.applied_rate_paise_per_gram,
          purchase_date: new Date().toISOString().slice(0, 10),
          status: "IN_STOCK",
          is_urd_recycled_gold: true
        })
        .returning()
        .get();

      const updatedPurchase = tx.update(urdPurchases)
        .set({
          stock_item_id: item.id,
          stock_status: "INGESTED"
        })
        .where(eq(urdPurchases.id, purchase.id))
        .returning()
        .get();

      const voucher = postBalancedVoucher(tx, {
        voucherType: "URD_STOCK_INGESTION",
        referenceType: "URD_PURCHASE",
        referenceId: purchase.id,
        narration: `POS URD stock ingestion ${purchase.id}`,
        createdBy: userId,
        lines: [
          {
            ledgerName: "Old Gold / URD Stock",
            accountType: "STOCK",
            transactionType: "DEBIT",
            amountPaise: purchase.deduction_amount_paise,
            description: `Old-gold stock from POS purchase ${purchase.id}`
          },
          {
            ledgerName: "URD Purchase Clearing",
            accountType: "VENDOR",
            transactionType: "CREDIT",
            amountPaise: purchase.deduction_amount_paise,
            description: `URD purchase clearing ${purchase.id}`
          }
        ]
      });

      return { item, purchase: updatedPurchase, voucher };
    });

    // Enqueue Tally sync for retry-worker processing
    try {
      db.insert(syncQueue).values({
        task_type: "TALLY_VOUCHER",
        payload: JSON.stringify({ voucherId: result.voucher.voucher.id }),
        status: "PENDING",
        attempts: 0
      }).run();
    } catch (queueErr) {
      console.error("[POS] Failed to enqueue Tally sync for URD purchase ingestion:", queueErr);
    }

    return response.status(201).json({
      item: result.item,
      purchase: {
        ...result.purchase,
        total_value_rupees: paiseToRupees(result.purchase.deduction_amount_paise)
      }
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to ingest stock."] });
  }
});

posRouter.post("/urd-purchases/:id/transfer-refinery", requireAuth, (request, response) => {
  const purchaseId = parsePositiveId(request.params.id);

  if (!purchaseId) {
    return response.status(400).json({ errors: ["URD purchase id must be a positive integer."] });
  }

  const purchase = db.query.urdPurchases.findFirst({
    where: eq(urdPurchases.id, purchaseId)
  }).sync();

  if (!purchase) {
    return response.status(404).json({ errors: ["URD purchase not found."] });
  }

  if (!purchase.stock_item_id) {
    return response.status(409).json({ errors: ["Ingest URD purchase into old-gold stock before refinery transfer."] });
  }

  if (purchase.refinery_transfer_id) {
    return response.status(409).json({ errors: ["This URD purchase has already been transferred to refinery."] });
  }

  const validation = validateUrdRefineryTransferPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  if (isGstPeriodLocked(db, validation.transfer.transferDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const refinery = db.query.refineries.findFirst({
    where: eq(refineries.id, validation.transfer.refineryId)
  }).sync();

  if (!refinery) {
    return response.status(404).json({ errors: ["Refinery not found."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const fineWeightMg = Math.round((purchase.weight_mg * Number(purchase.purity_tunch)) / 100);

  try {
    const result = db.transaction((tx) => {
      const transfer = tx.insert(refineryTransfers)
        .values({
          refinery_id: validation.transfer.refineryId,
          transfer_date: validation.transfer.transferDate,
          metal_type: purchase.metal_type,
          gross_weight_mg: purchase.weight_mg,
          purity_tunch: Number(purchase.purity_tunch),
          fine_gold_mg: fineWeightMg,
          description: validation.transfer.description ?? `URD purchase ${purchase.id}`,
          created_by: userId
        })
        .returning()
        .get();

      tx.update(refineries)
        .set({
          fine_gold_balance_mg: refinery.fine_gold_balance_mg + fineWeightMg
        })
        .where(eq(refineries.id, refinery.id))
        .run();

      tx.update(items)
        .set({
          status: "MELTED",
          location: "REFINERY"
        })
        .where(eq(items.id, purchase.stock_item_id as number))
        .run();

      const updatedPurchase = tx.update(urdPurchases)
        .set({
          refinery_transfer_id: transfer.id,
          stock_status: "REFINERY_SENT"
        })
        .where(eq(urdPurchases.id, purchase.id))
        .returning()
        .get();

      return { transfer, purchase: updatedPurchase };
    });

    return response.status(201).json({
      transfer: result.transfer,
      purchase: {
        ...result.purchase,
        total_value_rupees: paiseToRupees(result.purchase.deduction_amount_paise)
      }
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to transfer to refinery."] });
  }
});

posRouter.get("/urd-vouchers", requireAuth, (_request, response) => {
  const vouchers = db.select().from(urdVouchers).all();

  return response.json({
    vouchers: vouchers.map(formatUrdVoucher)
  });
});

posRouter.post("/urd-vouchers/:id/ingest-stock", requireAuth, (request, response) => {
  const voucherId = parsePositiveId(request.params.id);

  if (!voucherId) {
    return response.status(400).json({ errors: ["URD voucher id must be a positive integer."] });
  }

  const voucher = db.query.urdVouchers.findFirst({
    where: eq(urdVouchers.id, voucherId)
  }).sync();

  if (!voucher) {
    return response.status(404).json({ errors: ["URD voucher not found."] });
  }

  // Enforce GST Audit Lock
  const todayStr = new Date().toISOString().slice(0, 10);
  if (isGstPeriodLocked(db, todayStr)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  if (voucher.stock_item_id) {
    return response.status(409).json({ errors: ["This URD voucher has already been ingested into stock."] });
  }

  if (!voucher.kyc_verified) {
    return response.status(422).json({ errors: ["KYC must be verified before old-gold stock ingestion."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const body = isRecord(request.body) ? request.body : {};
  // voucher_number is already "URD-…" (see generateUrdVoucherNumber), so use it
  // directly as the barcode — prefixing another "URD-" produced "URD-URD-…".
  const barcode = optionalTrimmedText(body.barcode) ?? voucher.voucher_number;
  const location = optionalTrimmedText(body.location) ?? "OLD_GOLD_VAULT";

  const duplicate = db.query.items.findFirst({
    where: eq(items.barcode, barcode)
  }).sync();

  if (duplicate) {
    return response.status(409).json({ errors: ["An item already exists with this old-gold barcode."] });
  }

  const purityKarat = Math.max(1, Math.min(24, Math.round((Number(voucher.purity_tunch) * 24) / 100)));
  const result = db.transaction((tx) => {
    const item = tx.insert(items)
      .values({
        barcode,
        huid: null,
        category: "Old Gold / URD",
        metal_type: voucher.metal_type,
        purity_karat: purityKarat,
        gross_weight_mg: voucher.gross_weight_mg,
        stone_weight_mg: voucher.stone_weight_mg,
        black_bead_weight_mg: voucher.black_bead_weight_mg,
        net_weight_mg: voucher.net_weight_mg,
        final_weight_mg: voucher.net_weight_mg,
        fine_weight_mg: voucher.fine_weight_mg,
        making_charge_type: "FLAT",
        making_charge_value: 0,
        design_name: voucher.description,
        tag_prefix: "URD",
        location,
        purchase_rate_paise: voucher.applied_rate_paise_per_gram,
        purchase_date: voucher.voucher_date,
        status: "IN_STOCK",
        is_urd_recycled_gold: true
      })
      .returning()
      .get();

    const updatedVoucher = tx.update(urdVouchers)
      .set({
        stock_item_id: item.id,
        stock_status: "INGESTED"
      })
      .where(eq(urdVouchers.id, voucher.id))
      .returning()
      .get();

    const accountingVoucher = postBalancedVoucher(tx, {
      voucherType: "URD_STOCK_INGESTION",
      referenceType: "URD_VOUCHER",
      referenceId: voucher.id,
      narration: `URD stock ingestion ${voucher.voucher_number}`,
      createdBy: userId,
      lines: [
        {
          ledgerName: "Old Gold / URD Stock",
          accountType: "STOCK",
          transactionType: "DEBIT",
          amountPaise: voucher.total_value_paise,
          description: `Old-gold stock from ${voucher.voucher_number}`
        },
        {
          ledgerName: "URD Purchase Clearing",
          accountType: "VENDOR",
          transactionType: "CREDIT",
          amountPaise: voucher.total_value_paise,
          description: `URD purchase clearing ${voucher.voucher_number}`
        }
      ]
    });

    return { item, voucher: updatedVoucher, accountingVoucher };
  });

  // Enqueue Tally sync for retry-worker processing
  try {
    db.insert(syncQueue).values({
      task_type: "TALLY_VOUCHER",
      payload: JSON.stringify({ voucherId: result.accountingVoucher.voucher.id }),
      status: "PENDING",
      attempts: 0
    }).run();
  } catch (queueErr) {
    console.error("[POS] Failed to enqueue Tally sync for URD voucher ingestion:", queueErr);
  }

  return response.status(201).json({
    item: result.item,
    voucher: formatUrdVoucher(result.voucher)
  });
});

posRouter.post("/urd-vouchers/:id/transfer-refinery", requireAuth, (request, response) => {
  const voucherId = parsePositiveId(request.params.id);

  if (!voucherId) {
    return response.status(400).json({ errors: ["URD voucher id must be a positive integer."] });
  }

  const voucher = db.query.urdVouchers.findFirst({
    where: eq(urdVouchers.id, voucherId)
  }).sync();

  if (!voucher) {
    return response.status(404).json({ errors: ["URD voucher not found."] });
  }

  if (!voucher.stock_item_id) {
    return response.status(409).json({ errors: ["Ingest URD voucher into old-gold stock before refinery transfer."] });
  }

  if (voucher.refinery_transfer_id) {
    return response.status(409).json({ errors: ["This URD voucher has already been transferred to refinery."] });
  }

  const validation = validateUrdRefineryTransferPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST Audit Lock
  if (isGstPeriodLocked(db, validation.transfer.transferDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const refinery = db.query.refineries.findFirst({
    where: eq(refineries.id, validation.transfer.refineryId)
  }).sync();

  if (!refinery) {
    return response.status(404).json({ errors: ["Refinery not found."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const result = db.transaction((tx) => {
    const transfer = tx.insert(refineryTransfers)
      .values({
        refinery_id: validation.transfer.refineryId,
        transfer_date: validation.transfer.transferDate,
        metal_type: voucher.metal_type,
        gross_weight_mg: voucher.net_weight_mg,
        purity_tunch: Number(voucher.purity_tunch),
        fine_gold_mg: voucher.fine_weight_mg,
        description: validation.transfer.description ?? `URD voucher ${voucher.voucher_number}`,
        created_by: userId
      })
      .returning()
      .get();

    tx.update(refineries)
      .set({
        fine_gold_balance_mg: refinery.fine_gold_balance_mg + voucher.fine_weight_mg
      })
      .where(eq(refineries.id, refinery.id))
      .run();

    tx.update(items)
      .set({
        status: "MELTED",
        location: "REFINERY"
      })
      .where(eq(items.id, voucher.stock_item_id as number))
      .run();

    const updatedVoucher = tx.update(urdVouchers)
      .set({
        refinery_transfer_id: transfer.id,
        stock_status: "REFINERY_SENT"
      })
      .where(eq(urdVouchers.id, voucher.id))
      .returning()
      .get();

    return { transfer, voucher: updatedVoucher };
  });

  return response.status(201).json({
    transfer: result.transfer,
    voucher: formatUrdVoucher(result.voucher)
  });
});

posRouter.post("/quotations", requireAuth, (request, response) => {
  const validation = validateCommercialDocumentPayload(request.body, "quotation");

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST Audit Lock
  if (isGstPeriodLocked(db, validation.document.documentDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const quote = db.transaction((tx) => {
    const inserted = tx
      .insert(quotations)
      .values({
        quotation_number: generateDocumentNumber("QT"),
        customer_id: validation.document.customerId,
        quotation_date: validation.document.documentDate,
        expiry_date: validation.document.expiryDate,
        salesman_name: validation.document.salesmanName,
        gross_total_paise: validation.document.grossTotalPaise,
        discount_paise: validation.document.discountPaise,
        gst_amount_paise: validation.document.gstAmountPaise,
        total_amount_paise: validation.document.totalAmountPaise,
        status: "POSTED",
        created_by: userId
      })
      .returning()
      .get();

    const lines = validation.document.lines.map((line) =>
      tx.insert(quotationLines)
        .values({
          quotation_id: inserted.id,
          item_id: line.itemId,
          description: line.description,
          metal_type: line.metalType,
          purity_karat: line.purityKarat,
          gross_weight_mg: line.grossWeightMg,
          stone_weight_mg: line.stoneWeightMg,
          net_weight_mg: line.netWeightMg,
          metal_rate_paise_per_gram: line.metalRatePaisePerGram,
          making_charge_paise: line.makingChargePaise,
          gst_paise: line.gstPaise,
          line_total_paise: line.lineTotalPaise
        })
        .returning()
        .get()
    );

    return { quotation: inserted, lines };
  });

  return response.status(201).json(quote);
});

posRouter.get("/quotations/:id", requireAuth, (request, response) => {
  const quotationId = parsePositiveId(request.params.id);

  if (!quotationId) {
    return response.status(400).json({ errors: ["Quotation id must be a positive integer."] });
  }

  const quotation = db.query.quotations.findFirst({
    where: eq(quotations.id, quotationId)
  }).sync();

  if (!quotation) {
    return response.status(404).json({ errors: ["Quotation not found."] });
  }

  const lines = db.select().from(quotationLines).where(eq(quotationLines.quotation_id, quotation.id)).all();

  return response.json({ quotation, lines });
});

posRouter.post("/purchases", requireAuth, (request, response) => {
  const validation = validateCommercialDocumentPayload(request.body, "purchase");

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST Audit Lock
  if (isGstPeriodLocked(db, validation.document.documentDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const result = db.transaction((tx) => {
    const purchase = tx.insert(purchaseInvoices)
      .values({
        purchase_number: generateDocumentNumber("PUR"),
        supplier_id: validation.document.supplierId,
        supplier_name: validation.document.supplierName,
        supplier_phone: validation.document.supplierPhone,
        supplier_gstin: validation.document.supplierGstin,
        purchase_date: validation.document.documentDate,
        bill_number: validation.document.billNumber,
        payment_mode: validation.document.paymentMode,
        payment_reference: validation.document.paymentReference,
        gross_total_paise: validation.document.grossTotalPaise,
        gst_amount_paise: validation.document.gstAmountPaise,
        tds_percent: validation.document.tdsPercent,
        tds_amount_paise: validation.document.tdsAmountPaise,
        total_amount_paise: validation.document.totalAmountPaise,
        created_by: userId
      })
      .returning()
      .get();

    const lines = validation.document.lines.map((line) =>
      tx.insert(purchaseInvoiceLines)
        .values({
          purchase_invoice_id: purchase.id,
          description: line.description,
          category: line.category,
          quantity: line.quantity,
          stock_mode: line.stockMode,
          metal_type: line.metalType,
          purity_karat: line.purityKarat,
          gross_weight_mg: line.grossWeightMg,
          stone_weight_mg: line.stoneWeightMg,
          net_weight_mg: line.netWeightMg,
          metal_rate_paise_per_gram: line.metalRatePaisePerGram,
          making_charge_paise: line.makingChargePaise,
          gst_paise: line.gstPaise,
          line_total_paise: line.lineTotalPaise
        })
        .returning()
        .get()
    );

    // Ingest each purchase line into live barcoded inventory.
    const stockItems = createPurchaseStockItems(tx, validation.document, purchase.purchase_number);

    const voucher = postBalancedVoucher(tx, {
      voucherType: "PURCHASE",
      referenceType: "PURCHASE_INVOICE",
      referenceId: purchase.id,
      narration: `Purchase invoice ${purchase.purchase_number}`,
      createdBy: userId,
      lines: buildPurchaseVoucherLines(validation.document, purchase.purchase_number)
    });

    return { purchase, lines, stock_items: stockItems, voucher: voucher.voucher, journal_entries: voucher.lines.map((line) => line.journalEntry) };
  });

  // Enqueue Tally sync for retry-worker processing
  try {
    db.insert(syncQueue).values({
      task_type: "TALLY_VOUCHER",
      payload: JSON.stringify({ voucherId: result.voucher.id }),
      status: "PENDING",
      attempts: 0
    }).run();
  } catch (queueErr) {
    console.error("[POS] Failed to enqueue Tally sync for purchase:", queueErr);
  }

  return response.status(201).json(result);
});

// Original total + remaining refundable amount for a source document, so the
// Returns screen can show staff the cap and warn before they over-refund.
posRouter.get("/return-summary/:kind/:id", requireAuth, (request, response) => {
  const kind = request.params.kind === "purchase" ? "purchase" : "sales";
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return response.status(400).json({ errors: ["A positive integer document id is required."] });
  }
  const summary = getReturnSummary(kind, id);
  if (summary === null) {
    return response.status(404).json({ errors: [`Original ${kind === "sales" ? "invoice" : "purchase"} #${id} was not found.`] });
  }
  return response.json({
    original_total_paise: summary.originalTotalPaise,
    prior_refund_paise: summary.priorRefundPaise,
    remaining_refundable_paise: Math.max(summary.originalTotalPaise - summary.priorRefundPaise, 0)
  });
});

posRouter.post("/sales-returns", requireAuth, (request, response) => {
  const validation = validateReturnDocumentPayload(request.body, "sales");

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST Audit Lock
  if (isGstPeriodLocked(db, validation.document.documentDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  // When tied to an original invoice, never refund more than that sale was worth.
  if (validation.document.sourceDocumentId !== null) {
    const overRefund = refundExceedsOriginal("sales", validation.document.sourceDocumentId, validation.document.totalRefundPaise);
    if (overRefund) {
      return response.status(400).json({ errors: [overRefund.error] });
    }
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const result = db.transaction((tx) => {
    const saleReturn = tx.insert(salesReturns)
      .values({
        return_number: generateDocumentNumber("SR"),
        invoice_id: validation.document.sourceDocumentId,
        customer_id: validation.document.customerId,
        return_date: validation.document.documentDate,
        refund_mode: validation.document.refundMode,
        refund_reference: validation.document.refundReference,
        reason: validation.document.reason,
        gross_total_paise: validation.document.grossTotalPaise,
        gst_reversal_paise: validation.document.gstReversalPaise,
        total_refund_paise: validation.document.totalRefundPaise,
        created_by: userId
      })
      .returning()
      .get();

    const lines = validation.document.lines.map((line) => {
      if (line.itemId !== null) {
        tx.update(items)
          .set({ status: "IN_STOCK" })
          .where(eq(items.id, line.itemId))
          .run();
      }

      return tx.insert(salesReturnLines)
        .values({
          sales_return_id: saleReturn.id,
          item_id: line.itemId,
          description: line.description,
          metal_type: line.metalType,
          purity_karat: line.purityKarat,
          gross_weight_mg: line.grossWeightMg,
          net_weight_mg: line.netWeightMg,
          refund_amount_paise: line.amountPaise,
          gst_reversal_paise: line.gstPaise
        })
        .returning()
        .get();
    });
    const voucher = postBalancedVoucher(tx, {
      voucherType: "SALES_RETURN",
      referenceType: "SALES_RETURN",
      referenceId: saleReturn.id,
      narration: `Sales return ${saleReturn.return_number}`,
      createdBy: userId,
      lines: buildSalesReturnVoucherLines(validation.document, saleReturn.return_number)
    });

    return { sales_return: saleReturn, lines, voucher: voucher.voucher, journal_entries: voucher.lines.map((line) => line.journalEntry) };
  });

  // Enqueue Tally sync for retry-worker processing
  try {
    db.insert(syncQueue).values({
      task_type: "TALLY_VOUCHER",
      payload: JSON.stringify({ voucherId: result.voucher.id }),
      status: "PENDING",
      attempts: 0
    }).run();
  } catch (queueErr) {
    console.error("[POS] Failed to enqueue Tally sync for sales return:", queueErr);
  }

  return response.status(201).json(result);
});

posRouter.post("/purchase-returns", requireAuth, (request, response) => {
  const validation = validateReturnDocumentPayload(request.body, "purchase");

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST Audit Lock
  if (isGstPeriodLocked(db, validation.document.documentDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  // When tied to an original purchase invoice, never refund more than it was worth.
  if (validation.document.sourceDocumentId !== null) {
    const overRefund = refundExceedsOriginal("purchase", validation.document.sourceDocumentId, validation.document.totalRefundPaise);
    if (overRefund) {
      return response.status(400).json({ errors: [overRefund.error] });
    }
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const result = db.transaction((tx) => {
    const purchaseReturn = tx.insert(purchaseReturns)
      .values({
        return_number: generateDocumentNumber("PR"),
        purchase_invoice_id: validation.document.sourceDocumentId,
        supplier_name: validation.document.supplierName,
        return_date: validation.document.documentDate,
        refund_mode: validation.document.refundMode,
        refund_reference: validation.document.refundReference,
        reason: validation.document.reason,
        gross_total_paise: validation.document.grossTotalPaise,
        gst_reversal_paise: validation.document.gstReversalPaise,
        total_refund_paise: validation.document.totalRefundPaise,
        created_by: userId
      })
      .returning()
      .get();

    const lines = validation.document.lines.map((line) =>
      tx.insert(purchaseReturnLines)
        .values({
          purchase_return_id: purchaseReturn.id,
          description: line.description,
          metal_type: line.metalType,
          purity_karat: line.purityKarat,
          gross_weight_mg: line.grossWeightMg,
          net_weight_mg: line.netWeightMg,
          return_amount_paise: line.amountPaise,
          gst_reversal_paise: line.gstPaise
        })
        .returning()
        .get()
    );
    const voucher = postBalancedVoucher(tx, {
      voucherType: "PURCHASE_RETURN",
      referenceType: "PURCHASE_RETURN",
      referenceId: purchaseReturn.id,
      narration: `Purchase return ${purchaseReturn.return_number}`,
      createdBy: userId,
      lines: buildPurchaseReturnVoucherLines(validation.document, purchaseReturn.return_number)
    });

    return { purchase_return: purchaseReturn, lines, voucher: voucher.voucher, journal_entries: voucher.lines.map((line) => line.journalEntry) };
  });

  // Enqueue Tally sync for retry-worker processing
  try {
    db.insert(syncQueue).values({
      task_type: "TALLY_VOUCHER",
      payload: JSON.stringify({ voucherId: result.voucher.id }),
      status: "PENDING",
      attempts: 0
    }).run();
  } catch (queueErr) {
    console.error("[POS] Failed to enqueue Tally sync for purchase return:", queueErr);
  }

  return response.status(201).json(result);
});

type CheckoutPayload = {
  customerId: number | null;
  walkInName: string | null;
  gssAccountId: number | null;
  // When converting a booked customer order, the advance collected at booking is
  // applied as a tender (see payments.advance) and the order is marked COMPLETED.
  customerOrderId: number | null;
  salesItems: SalesItemPayload[];
  urdItems: UrdItemPayload[];
  totals: {
    grossTotalPaise: number;
    discountPaise: number;
    urdDeductionPaise: number;
    netPayablePaise: number;
    gstPaise: number | null;
  };
  payments: {
    cash: number;
    upi: number;
    card: number;
    cheque: number;
    neft: number;
    udhari: number;
    gssCredit: number;
    advance: number;
  };
  paymentReferences: {
    cash: string | null;
    upi: string | null;
    card: string | null;
    cheque: string | null;
    dd: string | null;
    neft: string | null;
    bankName: string | null;
  };
  invoice: {
    billPrefix: string | null;
    manualNumber: string | null;
    dueDate: string | null;
    salesmanName: string | null;
    gstNotRequired: boolean;
    placeOfSupplyStateCode: string | null;
    gstSupplyType: string | null;
  };
  kyc: {
    panNumber: string | null;
    aadhaarNumber: string | null;
    documentImagePath: string | null;
  };
  oldDues: {
    amountPaise: number;
    mode: "CASH" | "UPI" | "CARD";
  };
  loyaltyPointsRedeemed: number;
  loyaltyRedeemPaise: number;
};

type SalesItemPayload = {
  itemId: number;
  barcode: string;
  metalType: string | null;
  purityKarat: number | null;
  grossWeightMg: number | null;
  netWeightMg: number | null;
  stoneWeightMg: number | null;
  metalRatePaisePerGram: number;
  makingChargePaise: number;
  wastageChargePaise: number;
  gstPaise: number | null;
  itemTotalPaise: number;
};

type UrdItemPayload = {
  description: string;
  metalType: string;
  purityTunch: string;
  weightMg: number;
  appliedRatePaisePerGram: number;
  totalValuePaise: number;
};

type TotalsPayload = CheckoutPayload["totals"];
type PaymentsPayload = CheckoutPayload["payments"];

type CheckoutValidation = { ok: true; checkout: CheckoutPayload } | { ok: false; errors: string[] };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CommercialDocumentLine = {
  itemId: number | null;
  description: string;
  category: string;
  quantity: number;
  stockMode: "PIECES" | "LOT";
  metalType: string;
  purityKarat: number;
  grossWeightMg: number;
  stoneWeightMg: number;
  netWeightMg: number;
  metalRatePaisePerGram: number;
  makingChargePaise: number;
  gstPaise: number;
  lineTotalPaise: number;
  // METAL = weight-priced jewellery (the default). STONE = a loose stone/diamond
  // priced by carat or as a flat amount, carried as a quantity-wise stock item.
  lineKind: "METAL" | "STONE";
  stoneType?: "DIAMOND" | "RUBY" | "SAPPHIRE" | "EMERALD" | "OTHER";
  caratWeightTotal?: number;
  stoneRatePaisePerCarat?: number;
  // Stone value excluding GST for the whole line; split per piece on ingest.
  stoneValuePaise?: number;
};

type CommercialDocumentPayload = {
  customerId: number | null;
  supplierId: number | null;
  supplierName: string;
  supplierPhone: string | null;
  supplierGstin: string | null;
  documentDate: string;
  expiryDate: string | null;
  billNumber: string | null;
  salesmanName: string | null;
  paymentMode: string;
  paymentReference: string | null;
  grossTotalPaise: number;
  discountPaise: number;
  gstAmountPaise: number;
  totalAmountPaise: number;
  // Income-tax TDS withheld from the supplier payment (purchases only).
  tdsPercent: number;
  tdsAmountPaise: number;
  lines: CommercialDocumentLine[];
};

type ReturnDocumentLine = {
  itemId: number | null;
  description: string;
  metalType: string;
  purityKarat: number;
  grossWeightMg: number;
  netWeightMg: number;
  amountPaise: number;
  gstPaise: number;
};

type ReturnDocumentPayload = {
  sourceDocumentId: number | null;
  customerId: number | null;
  supplierName: string;
  documentDate: string;
  refundMode: string;
  refundReference: string | null;
  reason: string | null;
  grossTotalPaise: number;
  gstReversalPaise: number;
  totalRefundPaise: number;
  lines: ReturnDocumentLine[];
};

type CommercialDocumentValidation = { ok: true; document: CommercialDocumentPayload } | { ok: false; errors: string[] };
type ReturnDocumentValidation = { ok: true; document: ReturnDocumentPayload } | { ok: false; errors: string[] };
type UrdRefineryTransferValidation =
  | { ok: true; transfer: { refineryId: number; transferDate: string; description: string | null } }
  | { ok: false; errors: string[] };

function validateCheckoutPayload(body: unknown): CheckoutValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = body.customer_id === null || body.customer_id === undefined ? null : body.customer_id;
  const rawSalesItems = Array.isArray(body.cartItems) ? body.cartItems : body.sales_items;
  const rawUrdItems = Array.isArray(body.urdItems) ? body.urdItems : body.urd_items;
  const rawTotals = isRecord(body.totals) ? body.totals : body.totals_paise;
  const rawPayments = isRecord(body.payments) ? body.payments : body.payments_paise;
  const rawPaymentReferences = isRecord(body.payment_references) ? body.payment_references : {};
  const rawInvoice = isRecord(body.invoice) ? body.invoice : {};
  const salesItems = Array.isArray(rawSalesItems) ? rawSalesItems.map((line) => validateSalesItem(line, errors)).filter(isDefined) : [];
  const urdItems = Array.isArray(rawUrdItems) ? rawUrdItems.map((line) => validateUrdItem(line, errors)).filter(isDefined) : [];
  const totals = validateTotals(rawTotals, errors);
  const payments = validatePayments(rawPayments, errors);
  const paymentReferences = validatePaymentReferences(rawPaymentReferences);
  const invoice = validateInvoiceMeta(rawInvoice, errors);
  const rawGssAccountId = body.gss_account_id ?? body.gssAccountId ?? null;
  const gssAccountId = rawGssAccountId === null ? null : Number(rawGssAccountId);

  if (gssAccountId !== null && (!Number.isInteger(gssAccountId) || gssAccountId <= 0)) {
    errors.push("gss_account_id must be a positive integer when provided.");
  }

  const rawCustomerOrderId = body.customer_order_id ?? body.customerOrderId ?? null;
  const customerOrderId = rawCustomerOrderId === null ? null : Number(rawCustomerOrderId);

  if (customerOrderId !== null && (!Number.isInteger(customerOrderId) || customerOrderId <= 0)) {
    errors.push("customer_order_id must be a positive integer when provided.");
  }

  const panNumber = optionalTrimmedText(body.pan_number ?? body.panNumber) ?? null;
  const aadhaarNumber = optionalTrimmedText(body.aadhaar_number ?? body.aadhaarNumber) ?? null;
  const documentImagePath = optionalTrimmedText(body.document_image_path ?? body.kyc_photo_path ?? body.kycPhotoPath) ?? null;
  const walkInName = optionalTrimmedText(body.walk_in_name ?? body.walkInName) ?? null;

  // Optional collection toward the customer's existing udhari (old dues) made in the same bill.
  const oldDuesRaw = Number(body.old_dues_payment_paise ?? body.oldDuesPaymentPaise ?? 0);
  const oldDuesPaise = Number.isFinite(oldDuesRaw) && oldDuesRaw > 0 ? Math.trunc(oldDuesRaw) : 0;
  const oldDuesModeRaw = typeof body.old_dues_payment_mode === "string" ? body.old_dues_payment_mode.toUpperCase() : "CASH";
  const oldDuesMode: "CASH" | "UPI" | "CARD" = oldDuesModeRaw === "UPI" ? "UPI" : oldDuesModeRaw === "CARD" ? "CARD" : "CASH";

  if (oldDuesPaise > 0 && customerId === null) {
    errors.push("customer_id is required to collect old dues.");
  }

  // Optional loyalty-point redemption applied as a credit toward this bill (1 point = Rs 1).
  const loyaltyRedeemRaw = Number(body.loyalty_points_redeemed ?? body.loyaltyPointsRedeemed ?? 0);
  const loyaltyPointsRedeemed = Number.isInteger(loyaltyRedeemRaw) && loyaltyRedeemRaw > 0 ? loyaltyRedeemRaw : 0;
  const loyaltyRedeemPaise = loyaltyPointsRedeemed * LOYALTY_PAISE_PER_POINT;

  if (loyaltyPointsRedeemed > 0 && customerId === null) {
    errors.push("customer_id is required to redeem loyalty points.");
  }

  if (customerId !== null && !Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer or null.");
  }

  if (!Array.isArray(rawSalesItems) || salesItems.length === 0) {
    errors.push("cartItems must contain at least one item.");
  }

  if (!Array.isArray(rawUrdItems)) {
    errors.push("urdItems must be an array.");
  }

  if (totals && payments) {
    const calculatedGrossTotal = salesItems.reduce((total, line) => total + line.itemTotalPaise, 0);
    const calculatedUrdDeduction = urdItems.reduce((total, line) => total + line.totalValuePaise, 0);
    const payableBeforeLoyalty = calculatedGrossTotal - totals.discountPaise - calculatedUrdDeduction - payments.gssCredit;
    const calculatedNetPayable = Math.max(payableBeforeLoyalty - loyaltyRedeemPaise, 0);
    const totalPaid = payments.cash + payments.upi + payments.card + payments.cheque + payments.neft + payments.udhari + payments.advance;

    if (loyaltyRedeemPaise > Math.max(payableBeforeLoyalty, 0)) {
      errors.push("loyalty redemption cannot exceed the payable amount.");
    }

    if (totals.grossTotalPaise !== calculatedGrossTotal) {
      errors.push("totals.gross_total must equal the sales item total.");
    }

    if (totals.urdDeductionPaise !== calculatedUrdDeduction) {
      errors.push("totals.urd_deduction must equal the URD total.");
    }

    if (totals.netPayablePaise !== calculatedNetPayable) {
      errors.push("totals.net_payable must equal gross minus discount, URD, and GSS credit.");
    }

    if (totalPaid !== totals.netPayablePaise) {
      errors.push("payments cash, upi, card, and udhari must equal net payable.");
    }

    if (payments.udhari > 0 && customerId === null) {
      errors.push("customer_id is required when udhari payment is used.");
    }

    if (payments.advance > 0 && customerId === null) {
      errors.push("customer_id is required when an order advance is applied.");
    }

    if (payments.advance > 0 && customerOrderId === null) {
      errors.push("customer_order_id is required to apply an order advance.");
    }

    if (payments.cash >= CASH_PAN_AADHAAR_THRESHOLD_PAISE) {
      if (!panNumber) {
        errors.push("pan_number is required when cash is Rs 2,00,000 or above.");
      }

      if (!aadhaarNumber) {
        errors.push("aadhaar_number is required when cash is Rs 2,00,000 or above.");
      }

      if (customerId === null) {
        errors.push("customer_id is required to store KYC for cash payments of Rs 2,00,000 or above.");
      }
    }

    if (calculatedUrdDeduction >= CASH_PAN_AADHAAR_THRESHOLD_PAISE) {
      if (!panNumber) {
        errors.push("pan_number is required when URD old-gold value is Rs 2,00,000 or above.");
      }

      if (!aadhaarNumber) {
        errors.push("aadhaar_number is required when URD old-gold value is Rs 2,00,000 or above.");
      }

      if (customerId === null) {
        errors.push("customer_id is required to store KYC for high-value URD old-gold exchange.");
      }
    }

    if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNumber)) {
      errors.push("PAN must be a valid 10-character alphanumeric format (e.g. ABCDE1234F).");
    }

    if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) {
      errors.push("Aadhaar number must be exactly 12 digits.");
    }
  }

  if (errors.length > 0 || !totals || !payments) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    checkout: {
      customerId: customerId as number | null,
      walkInName,
      gssAccountId: (gssAccountId ?? null) as number | null,
      customerOrderId: (customerOrderId ?? null) as number | null,
      salesItems,
      urdItems,
      totals,
      payments,
      paymentReferences,
      invoice,
      kyc: {
        panNumber,
        aadhaarNumber,
        documentImagePath
      },
      oldDues: {
        amountPaise: oldDuesPaise,
        mode: oldDuesMode
      },
      loyaltyPointsRedeemed,
      loyaltyRedeemPaise
    }
  };
}

function validatePaymentReferences(value: Record<string, unknown>) {
  return {
    cash: optionalTrimmedText(value.cash_reference ?? value.cashReference) ?? null,
    upi: optionalTrimmedText(value.upi_reference ?? value.upiReference) ?? null,
    card: optionalTrimmedText(value.card_reference ?? value.cardReference) ?? null,
    cheque: optionalTrimmedText(value.cheque_reference ?? value.chequeReference) ?? null,
    dd: optionalTrimmedText(value.dd_reference ?? value.ddReference) ?? null,
    neft: optionalTrimmedText(value.neft_reference ?? value.neftReference) ?? null,
    bankName: optionalTrimmedText(value.bank_name ?? value.bankName) ?? null
  };
}

function validateInvoiceMeta(value: Record<string, unknown>, errors: string[]) {
  const dueDate = optionalTrimmedText(value.due_date ?? value.dueDate) ?? null;

  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    errors.push("invoice.due_date must be YYYY-MM-DD when provided.");
  }

  return {
    billPrefix: optionalTrimmedText(value.bill_prefix ?? value.billPrefix) ?? null,
    manualNumber: optionalTrimmedText(value.manual_number ?? value.manualNumber) ?? null,
    dueDate,
    salesmanName: optionalTrimmedText(value.salesman_name ?? value.salesmanName) ?? null,
    gstNotRequired: value.gst_not_required === true || value.gstNotRequired === true,
    placeOfSupplyStateCode: optionalTrimmedText(value.place_of_supply_state_code ?? value.placeOfSupplyStateCode) ?? null,
    gstSupplyType: optionalTrimmedText(value.gst_supply_type ?? value.gstSupplyType) ?? null
  };
}

type StandaloneUrdVoucherValidation =
  | {
      ok: true;
      voucher: {
        customerId: number | null;
        customerName: string;
        customerPhone: string | null;
        voucherDate: string;
        description: string;
        metalType: string;
        purityTunch: string;
        grossWeightMg: number;
        stoneWeightMg: number;
        blackBeadWeightMg: number;
        netWeightMg: number;
        fineWeightMg: number;
        appliedRatePaisePerGram: number;
        totalValuePaise: number;
        paymentMode: string;
        paymentReference: string | null;
        panNumber: string | null;
        aadhaarNumber: string | null;
        kycVerified: boolean;
      };
    }
  | { ok: false; errors: string[] };

function validateStandaloneUrdVoucherPayload(body: unknown): StandaloneUrdVoucherValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = body.customer_id === undefined || body.customer_id === null ? null : body.customer_id;
  const customerName = requiredText(body.customer_name ?? body.customerName, "customer_name", errors);
  const customerPhone = optionalTrimmedText(body.customer_phone ?? body.customerPhone) ?? null;
  const voucherDate = optionalTrimmedText(body.voucher_date ?? body.voucherDate) ?? new Date().toISOString().slice(0, 10);
  const description = requiredText(body.description, "description", errors);
  const metalType = optionalTrimmedText(body.metal_type ?? body.metalType) ?? "Gold";
  const purityTunch = requiredText(body.purity_tunch ?? body.purityTunch, "purity_tunch", errors);
  const grossWeightMg = requiredPositiveInteger(body.gross_weight_mg ?? body.grossWeightMg, "gross_weight_mg", errors);
  const stoneWeightMg = optionalNonNegativeInteger(body.stone_weight_mg ?? body.stoneWeightMg, "stone_weight_mg", errors) ?? 0;
  const blackBeadWeightMg = optionalNonNegativeInteger(body.black_bead_weight_mg ?? body.blackBeadWeightMg, "black_bead_weight_mg", errors) ?? 0;
  const appliedRatePaisePerGram = requiredNonNegativeInteger(body.applied_rate_paise_per_gram ?? body.appliedRatePaisePerGram, "applied_rate_paise_per_gram", errors);
  const totalValuePaise = requiredNonNegativeInteger(body.total_value_paise ?? body.totalValuePaise, "total_value_paise", errors);
  const paymentMode = optionalTrimmedText(body.payment_mode ?? body.paymentMode) ?? "CASH";
  const paymentReference = optionalTrimmedText(body.payment_reference ?? body.paymentReference) ?? null;
  const panNumber = optionalTrimmedText(body.pan_number ?? body.panNumber) ?? null;
  const aadhaarNumber = optionalTrimmedText(body.aadhaar_number ?? body.aadhaarNumber) ?? null;

  if (customerId !== null && !Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer or null.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(voucherDate)) {
    errors.push("voucher_date must be YYYY-MM-DD.");
  }

  const netWeightMg = grossWeightMg === undefined ? undefined : grossWeightMg - stoneWeightMg - blackBeadWeightMg;
  const purityNumber = Number(purityTunch);
  const fineWeightMg = netWeightMg === undefined || !Number.isFinite(purityNumber)
    ? undefined
    : Math.round((netWeightMg * purityNumber) / 100);

  if (netWeightMg === undefined || netWeightMg <= 0) {
    errors.push("Net weight must be greater than zero after deductions.");
  }

  if (fineWeightMg === undefined || fineWeightMg <= 0) {
    errors.push("purity_tunch must be numeric for fine-weight calculation.");
  }

  if (totalValuePaise !== undefined && totalValuePaise >= CASH_PAN_AADHAAR_THRESHOLD_PAISE) {
    if (!panNumber) {
      errors.push("pan_number is required for URD purchases of Rs 2,00,000 or above.");
    }

    if (!aadhaarNumber) {
      errors.push("aadhaar_number is required for URD purchases of Rs 2,00,000 or above.");
    }
  }

  if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNumber)) {
    errors.push("PAN must be a valid 10-character alphanumeric format (e.g. ABCDE1234F).");
  }

  if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) {
    errors.push("Aadhaar number must be exactly 12 digits.");
  }

  if (
    errors.length > 0 ||
    !customerName ||
    !description ||
    !purityTunch ||
    grossWeightMg === undefined ||
    appliedRatePaisePerGram === undefined ||
    totalValuePaise === undefined ||
    netWeightMg === undefined ||
    fineWeightMg === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    voucher: {
      customerId: customerId as number | null,
      customerName,
      customerPhone,
      voucherDate,
      description,
      metalType,
      purityTunch,
      grossWeightMg,
      stoneWeightMg,
      blackBeadWeightMg,
      netWeightMg,
      fineWeightMg,
      appliedRatePaisePerGram,
      totalValuePaise,
      paymentMode,
      paymentReference,
      panNumber,
      aadhaarNumber,
      // KYC always starts UNVERIFIED — capturing PAN/Aadhaar is not the same as
      // verifying them. An explicit verify step (PATCH /urd-vouchers/:id/verify-kyc)
      // is required before stock ingestion, so the ingest-before-verify gate is
      // always enforced (and testable) regardless of which documents were supplied.
      kycVerified: false
    }
  };
}

function validateUrdRefineryTransferPayload(body: unknown): UrdRefineryTransferValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const refineryId = body.refinery_id ?? body.refineryId;
  const transferDate = optionalTrimmedText(body.transfer_date ?? body.transferDate) ?? getToday();
  const description = optionalTrimmedText(body.description) ?? null;

  if (!Number.isInteger(refineryId)) {
    errors.push("refinery_id must be an integer.");
  }

  if (!isDate(transferDate)) {
    errors.push("transfer_date must be YYYY-MM-DD.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    transfer: {
      refineryId: refineryId as number,
      transferDate,
      description
    }
  };
}

function validateSalesItem(value: unknown, errors: string[]): SalesItemPayload | undefined {
  if (!isRecord(value)) {
    errors.push("Each sales item must be an object.");
    return undefined;
  }

  const line = {
    itemId: requiredPositiveInteger(value.item_id ?? value.itemId ?? value.id, "cartItems.item_id", errors),
    barcode: requiredText(value.barcode, "cartItems.barcode", errors),
    metalType: optionalTrimmedText(value.metal_type ?? value.metalType) ?? null,
    purityKarat: optionalPositiveInteger(value.purity_karat ?? value.purityKarat, "cartItems.purity_karat", errors),
    grossWeightMg: optionalPositiveInteger(value.gross_weight_mg ?? value.grossWeightMg, "cartItems.gross_weight_mg", errors),
    netWeightMg: optionalPositiveInteger(value.net_weight_mg ?? value.netWeightMg, "cartItems.net_weight_mg", errors),
    stoneWeightMg: optionalNonNegativeInteger(value.stone_weight_mg ?? value.stoneWeightMg, "cartItems.stone_weight_mg", errors),
    metalRatePaisePerGram: requiredNonNegativeInteger(value.metal_rate_paise_per_gram ?? value.metalRatePaisePerGram, "cartItems.metal_rate_paise_per_gram", errors),
    makingChargePaise: requiredNonNegativeInteger(value.making_charge_paise ?? value.makingChargePaise, "cartItems.making_charge_paise", errors),
    wastageChargePaise: optionalNonNegativeInteger(value.wastage_charge_paise ?? value.wastageChargePaise, "cartItems.wastage_charge_paise", errors) ?? 0,
    gstPaise: optionalNonNegativeInteger(value.gst_paise ?? value.gstPaise, "cartItems.gst_paise", errors),
    itemTotalPaise: requiredNonNegativeInteger(value.item_total_paise ?? value.line_total_paise ?? value.itemTotalPaise ?? value.lineTotalPaise, "cartItems.item_total_paise", errors)
  };

  if (line.itemId === undefined || !line.barcode || line.metalRatePaisePerGram === undefined || line.makingChargePaise === undefined || line.itemTotalPaise === undefined) {
    return undefined;
  }

  return line as SalesItemPayload;
}

function validateUrdItem(value: unknown, errors: string[]): UrdItemPayload | undefined {
  if (!isRecord(value)) {
    errors.push("Each URD item must be an object.");
    return undefined;
  }

  const line = {
    description: requiredText(value.description, "urdItems.description", errors),
    metalType: optionalTrimmedText(value.metal_type) ?? "Gold",
    purityTunch: requiredText(value.purity_tunch ?? value.purityTunch, "urdItems.purity_tunch", errors),
    weightMg: requiredPositiveInteger(value.weight_mg ?? value.weightMg, "urdItems.weight_mg", errors),
    appliedRatePaisePerGram: requiredNonNegativeInteger(value.applied_rate_paise_per_gram ?? value.appliedRatePaisePerGram, "urdItems.applied_rate_paise_per_gram", errors),
    totalValuePaise: requiredNonNegativeInteger(value.total_value_paise ?? value.deduction_amount_paise ?? value.totalValuePaise, "urdItems.total_value_paise", errors)
  };

  if (!line.description || !line.purityTunch || line.weightMg === undefined || line.appliedRatePaisePerGram === undefined || line.totalValuePaise === undefined) {
    return undefined;
  }

  return line as UrdItemPayload;
}

function validateTotals(value: unknown, errors: string[]): TotalsPayload | undefined {
  if (!isRecord(value)) {
    errors.push("totals must be an object.");
    return undefined;
  }

  const grossTotalPaise = requiredNonNegativeInteger(value.gross_total ?? value.grossTotalPaise, "totals.gross_total", errors);
  const discountPaise = requiredNonNegativeInteger(value.discount ?? value.discount_paise ?? value.discountPaise, "totals.discount", errors);
  const urdDeductionPaise = requiredNonNegativeInteger(value.urd_deduction ?? value.urd_deduction_paise ?? value.urdDeductionPaise, "totals.urd_deduction", errors);
  const netPayablePaise = requiredNonNegativeInteger(value.net_payable ?? value.net_payable_paise ?? value.netPayablePaise, "totals.net_payable", errors);
  const gstPaise = optionalNonNegativeInteger(value.gst ?? value.gst_paise ?? value.gst_amount_paise ?? value.gstPaise, "totals.gst", errors);

  if (grossTotalPaise === undefined || discountPaise === undefined || urdDeductionPaise === undefined || netPayablePaise === undefined) {
    return undefined;
  }

  return {
    grossTotalPaise,
    discountPaise,
    urdDeductionPaise,
    netPayablePaise,
    gstPaise: gstPaise ?? null
  };
}

function validatePayments(value: unknown, errors: string[]): PaymentsPayload | undefined {
  if (!isRecord(value)) {
    errors.push("payments must be an object.");
    return undefined;
  }

  const cash = requiredNonNegativeInteger(value.cash, "payments.cash", errors);
  const upi = requiredNonNegativeInteger(value.upi, "payments.upi", errors);
  const card = requiredNonNegativeInteger(value.card, "payments.card", errors);
  // Optional for backward compatibility — older clients never send these modes.
  const cheque = optionalNonNegativeInteger(value.cheque, "payments.cheque", errors) ?? 0;
  const neft = optionalNonNegativeInteger(value.neft, "payments.neft", errors) ?? 0;
  const udhari = requiredNonNegativeInteger(value.udhari, "payments.udhari", errors);
  const gssCredit = optionalNonNegativeInteger(value.gss_credit ?? value.gssCredit, "payments.gss_credit", errors) ?? 0;
  const advance = optionalNonNegativeInteger(value.advance, "payments.advance", errors) ?? 0;

  if (cash === undefined || upi === undefined || card === undefined || udhari === undefined || gssCredit === undefined || cheque === undefined || neft === undefined) {
    return undefined;
  }

  return {
    cash,
    upi,
    card,
    cheque,
    neft,
    udhari,
    gssCredit,
    advance
  };
}

function insertKycVaultRecords(tx: Tx, checkout: CheckoutPayload, verifiedBy: number) {
  if (checkout.payments.cash < CASH_PAN_AADHAAR_THRESHOLD_PAISE || checkout.customerId === null) {
    return [];
  }

  const records: Array<typeof kycVault.$inferSelect> = [];

  if (checkout.kyc.panNumber) {
    records.push(insertKycVaultRecord(tx, checkout.customerId, "PAN", checkout.kyc.panNumber, checkout.kyc.documentImagePath, verifiedBy));
  }

  if (checkout.kyc.aadhaarNumber) {
    records.push(insertKycVaultRecord(tx, checkout.customerId, "AADHAAR", checkout.kyc.aadhaarNumber, checkout.kyc.documentImagePath, verifiedBy));
  }

  return records;
}

function insertKycVaultRecord(
  tx: Tx,
  customerId: number,
  documentType: "PAN" | "AADHAAR",
  documentNumber: string,
  documentImagePath: string | null,
  verifiedBy: number
) {
  return tx
    .insert(kycVault)
    .values({
      customer_id: customerId,
      document_type: documentType,
      document_number_masked: maskDocumentNumber(documentNumber),
      document_image_path: documentImagePath,
      verified_by: verifiedBy
    })
    .returning()
    .get();
}

function getInvoicePaymentMode(payments: CheckoutPayload["payments"]) {
  const activeModes = [
    payments.cash > 0 ? "CASH" : null,
    payments.upi > 0 ? "UPI" : null,
    payments.card > 0 ? "CARD" : null,
    payments.cheque > 0 ? "CHEQUE" : null,
    payments.neft > 0 ? "NEFT" : null,
    payments.udhari > 0 ? "UDHARI" : null,
    payments.gssCredit > 0 ? "GSS_CREDIT" : null,
    payments.advance > 0 ? "ADVANCE" : null
  ].filter(isDefined);

  return activeModes.length === 0 ? "CASH" : activeModes.length === 1 ? activeModes[0] : "MIXED";
}

function calculateInclusiveTaxPaise(totalPaise: number, gstPercentage: number) {
  if (gstPercentage <= 0) {
    return 0;
  }

  return Math.round((totalPaise * gstPercentage) / (100 + gstPercentage));
}

function buildPosSaleVoucherLines(checkout: CheckoutPayload, gstAmountPaise: number, invoiceNumber: string, advanceFundedFromCredit = false): VoucherPostingLine[] {
  const taxableSalePaise = checkout.totals.grossTotalPaise - checkout.totals.discountPaise;
  const salesRevenuePaise = Math.max(taxableSalePaise - gstAmountPaise, 0);
  const lines: VoucherPostingLine[] = [];

  if (checkout.payments.cash > 0) {
    lines.push({
      ledgerName: "Cash",
      accountType: "CASH",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.cash,
      description: `Cash receipt for ${invoiceNumber}`
    });
  }

  if (checkout.payments.upi > 0) {
    lines.push({
      ledgerName: "UPI Bank",
      accountType: "BANK",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.upi,
      description: `UPI receipt for ${invoiceNumber}`
    });
  }

  if (checkout.payments.card > 0) {
    lines.push({
      ledgerName: "Card Bank",
      accountType: "BANK",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.card,
      description: `Card receipt for ${invoiceNumber}`
    });
  }

  if (checkout.payments.cheque > 0) {
    lines.push({
      ledgerName: "Bank",
      accountType: "BANK",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.cheque,
      description: `Cheque receipt for ${invoiceNumber}${checkout.paymentReferences.cheque ? ` (${checkout.paymentReferences.cheque})` : ""}`
    });
  }

  if (checkout.payments.neft > 0) {
    lines.push({
      ledgerName: "Bank",
      accountType: "BANK",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.neft,
      description: `NEFT receipt for ${invoiceNumber}${checkout.paymentReferences.neft ? ` (${checkout.paymentReferences.neft})` : ""}`
    });
  }

  if (checkout.payments.udhari > 0) {
    lines.push({
      ledgerName: `Customer Udhari ${checkout.customerId}`,
      accountType: "CUSTOMER_UDHARI",
      entityId: checkout.customerId,
      transactionType: "DEBIT",
      amountPaise: checkout.payments.udhari,
      description: `Customer credit for ${invoiceNumber}`
    });
  }

  if (checkout.payments.gssCredit > 0) {
    lines.push({
      ledgerName: "GSS Liability",
      accountType: "GSS_LIABILITY",
      transactionType: "DEBIT",
      amountPaise: checkout.payments.gssCredit,
      description: `GSS credit applied to ${invoiceNumber}`
    });
  }

  // Order advance applied. If it was journaled at booking it sits as a customer credit,
  // so consume it from the udhari ledger; otherwise (legacy order) recognise it as cash.
  if (checkout.payments.advance > 0) {
    lines.push(advanceFundedFromCredit
      ? {
          ledgerName: `Customer Udhari ${checkout.customerId}`,
          accountType: "CUSTOMER_UDHARI",
          entityId: checkout.customerId,
          transactionType: "DEBIT",
          amountPaise: checkout.payments.advance,
          description: `Order advance adjusted against ${invoiceNumber}`
        }
      : {
          ledgerName: "Cash",
          accountType: "CASH",
          transactionType: "DEBIT",
          amountPaise: checkout.payments.advance,
          description: `Order advance (cash) for ${invoiceNumber}`
        });
  }

  if (checkout.totals.urdDeductionPaise > 0) {
    lines.push({
      ledgerName: "Old Gold / URD Stock",
      accountType: "STOCK",
      transactionType: "DEBIT",
      amountPaise: checkout.totals.urdDeductionPaise,
      description: `URD old-gold intake against ${invoiceNumber}`
    });
  }

  if (checkout.loyaltyRedeemPaise > 0) {
    // Loyalty redemption is a shop-funded discount; debit it so the voucher balances.
    lines.push({
      ledgerName: "Loyalty Points Redeemed",
      accountType: "EXPENSE",
      transactionType: "DEBIT",
      amountPaise: checkout.loyaltyRedeemPaise,
      description: `Loyalty points redeemed against ${invoiceNumber}`
    });
  }

  if (salesRevenuePaise > 0) {
    lines.push({
      ledgerName: "Sales Revenue",
      accountType: "SALES",
      transactionType: "CREDIT",
      amountPaise: salesRevenuePaise,
      description: `Taxable sale for ${invoiceNumber}`
    });
  }

  if (gstAmountPaise > 0) {
    lines.push({
      ledgerName: "GST Payable",
      accountType: "TAX",
      transactionType: "CREDIT",
      amountPaise: gstAmountPaise,
      description: `GST payable for ${invoiceNumber}`
    });
  }

  return lines;
}

// Create barcoded inventory items from each purchase line so a wholesale purchase
// updates live, sellable stock — distributing the line weight evenly across pieces.
function createPurchaseStockItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  document: CommercialDocumentPayload,
  purchaseNumber: string
) {
  const created: (typeof items.$inferSelect)[] = [];

  for (const line of document.lines) {
    // LOT = one weight-wise item holding the full line weight; PIECES = one item per piece.
    const quantity = line.stockMode === "LOT" ? 1 : Math.max(1, line.quantity);
    const prefix = purchaseBarcodePrefix(line.category);
    const sequence = tx.query.barcodeSequences.findFirst({
      where: eq(barcodeSequences.prefix, prefix)
    }).sync();
    const firstNumber = sequence?.next_number ?? 1;

    if (line.lineKind === "STONE") {
      createPurchaseStoneItems(tx, document, line, prefix, firstNumber, quantity, created);
      bumpBarcodeSequence(tx, sequence, prefix, firstNumber, quantity);
      continue;
    }

    const perGross = Math.floor(line.grossWeightMg / quantity);
    const perStone = Math.floor(line.stoneWeightMg / quantity);
    const perNet = Math.floor(line.netWeightMg / quantity);

    for (let piece = 0; piece < quantity; piece += 1) {
      const isLast = piece === quantity - 1;
      // The last piece absorbs the rounding remainder so per-piece weights sum to the line total.
      const grossMg = isLast ? line.grossWeightMg - perGross * (quantity - 1) : perGross;
      const stoneMg = isLast ? line.stoneWeightMg - perStone * (quantity - 1) : perStone;
      const netMg = isLast ? line.netWeightMg - perNet * (quantity - 1) : perNet;
      const tagNumber = firstNumber + piece;
      const barcode = formatPurchaseBarcode(prefix, tagNumber);

      const duplicate = tx.query.items.findFirst({ where: eq(items.barcode, barcode) }).sync();
      if (duplicate) {
        throw new Error(`Cannot ingest purchase stock: barcode ${barcode} already exists.`);
      }

      created.push(
        tx.insert(items)
          .values({
            barcode,
            huid: null,
            category: line.category,
            metal_type: line.metalType,
            purity_karat: line.purityKarat,
            gross_weight_mg: grossMg,
            stone_weight_mg: stoneMg,
            black_bead_weight_mg: 0,
            net_weight_mg: netMg,
            final_weight_mg: netMg,
            fine_weight_mg: Math.round((netMg * line.purityKarat) / 24),
            making_charge_type: "FLAT",
            making_charge_value: 0,
            design_name: line.description,
            tag_prefix: prefix,
            tag_number: tagNumber,
            location: "VAULT",
            vendor_id: document.supplierId,
            purchase_rate_paise: line.metalRatePaisePerGram,
            purchase_date: document.documentDate,
            status: "IN_STOCK",
            // A LOT line is untagged bulk stock carried as one weight-wise item.
            stock_form: line.stockMode === "LOT" ? "LOOSE" : "TAGGED"
          })
          .returning()
          .get()
      );
    }

    bumpBarcodeSequence(tx, sequence, prefix, firstNumber, quantity);
  }

  return created;
}

// Ingest a loose-stone purchase line: one quantity-wise stock item per piece, each
// with its gemstone detail (type, carat, rate) recorded in item_stones. Priced by a
// fixed per-piece amount (carat-rate or flat split evenly), not by metal weight.
function createPurchaseStoneItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  document: CommercialDocumentPayload,
  line: CommercialDocumentLine,
  prefix: string,
  firstNumber: number,
  quantity: number,
  created: (typeof items.$inferSelect)[]
) {
  const totalStoneMg = line.stoneWeightMg;
  const totalValuePaise = line.stoneValuePaise ?? 0;
  const totalCarats = line.caratWeightTotal ?? 0;
  const perStone = Math.floor(totalStoneMg / quantity);
  const perValue = Math.floor(totalValuePaise / quantity);

  for (let piece = 0; piece < quantity; piece += 1) {
    const isLast = piece === quantity - 1;
    // The last piece absorbs the rounding remainder so per-piece figures sum to the line total.
    const stoneMg = isLast ? totalStoneMg - perStone * (quantity - 1) : perStone;
    const valuePaise = isLast ? totalValuePaise - perValue * (quantity - 1) : perValue;
    const caratThis = quantity === 1 ? totalCarats : Number((totalCarats / quantity).toFixed(3));
    const tagNumber = firstNumber + piece;
    const barcode = formatPurchaseBarcode(prefix, tagNumber);

    const duplicate = tx.query.items.findFirst({ where: eq(items.barcode, barcode) }).sync();
    if (duplicate) {
      throw new Error(`Cannot ingest purchase stock: barcode ${barcode} already exists.`);
    }

    const item = tx.insert(items)
      .values({
        barcode,
        huid: null,
        category: line.category,
        metal_type: "STONE",
        purity_karat: 0,
        gross_weight_mg: stoneMg,
        stone_weight_mg: stoneMg,
        black_bead_weight_mg: 0,
        net_weight_mg: 0,
        final_weight_mg: 0,
        fine_weight_mg: 0,
        making_charge_type: "FLAT",
        making_charge_value: 0,
        design_name: line.description,
        tag_prefix: prefix,
        tag_number: tagNumber,
        location: "VAULT",
        vendor_id: document.supplierId,
        purchase_rate_paise: line.stoneRatePaisePerCarat ?? 0,
        purchase_date: document.documentDate,
        status: "IN_STOCK",
        // Loose stones are sold per piece at a fixed price, not by metal weight.
        sale_mode: "QUANTITY_WISE",
        uom: "CARAT",
        unit_price_paise: valuePaise,
        stock_form: line.stockMode === "LOT" ? "LOOSE" : "TAGGED"
      })
      .returning()
      .get();

    tx.insert(itemStones)
      .values({
        item_id: item.id,
        stone_type: line.stoneType ?? "OTHER",
        shape: null,
        carat_weight: caratThis,
        color_grade: null,
        clarity_grade: null,
        cut_grade: null,
        certificate_number: null,
        certificate_lab: "NONE",
        stone_rate_paise: line.stoneRatePaisePerCarat ?? 0
      })
      .run();

    created.push(item);
  }
}

function bumpBarcodeSequence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sequence: typeof barcodeSequences.$inferSelect | undefined,
  prefix: string,
  firstNumber: number,
  quantity: number
) {
  if (sequence) {
    tx.update(barcodeSequences)
      .set({ next_number: firstNumber + quantity, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(barcodeSequences.id, sequence.id))
      .run();
  } else {
    tx.insert(barcodeSequences).values({ prefix, next_number: firstNumber + quantity }).run();
  }
}

function purchaseBarcodePrefix(category: string) {
  const letters = category.toUpperCase().replace(/[^A-Z]/g, "");
  return letters ? letters.slice(0, 3) : "PUR";
}

function formatPurchaseBarcode(prefix: string, tagNumber: number) {
  return `${prefix}${String(tagNumber).padStart(4, "0")}`;
}

function buildPurchaseVoucherLines(document: CommercialDocumentPayload, purchaseNumber: string): VoucherPostingLine[] {
  const paymentLedger = getSettlementLedger(document.paymentMode, document.supplierName, true);
  const stockAmountPaise = Math.max(document.totalAmountPaise - document.gstAmountPaise, 0);
  const lines: VoucherPostingLine[] = [
    {
      ledgerName: "Purchase Stock",
      accountType: "STOCK",
      transactionType: "DEBIT",
      amountPaise: stockAmountPaise,
      description: `Stock purchase ${purchaseNumber}`
    }
  ];

  if (document.gstAmountPaise > 0) {
    lines.push({
      ledgerName: "GST Input Credit",
      accountType: "TAX",
      transactionType: "DEBIT",
      amountPaise: document.gstAmountPaise,
      description: `GST input for ${purchaseNumber}`
    });
  }

  // TDS withheld from the supplier payment: pay (total - TDS), owe the TDS to the
  // tax department until deposited.
  if (document.tdsAmountPaise > 0) {
    lines.push({
      ledgerName: "TDS Payable",
      accountType: "TAX",
      transactionType: "CREDIT",
      amountPaise: document.tdsAmountPaise,
      description: `TDS @ ${document.tdsPercent}% on ${purchaseNumber}`
    });
  }

  lines.push({
    ledgerName: paymentLedger.ledgerName,
    accountType: paymentLedger.accountType,
    transactionType: "CREDIT",
    amountPaise: Math.max(document.totalAmountPaise - document.tdsAmountPaise, 0),
    description: `Purchase settlement ${purchaseNumber}`
  });

  return lines;
}

function buildSalesReturnVoucherLines(document: ReturnDocumentPayload, returnNumber: string): VoucherPostingLine[] {
  const settlementLedger = getSettlementLedger(document.refundMode, document.customerId === null ? "Walk-in" : `Customer ${document.customerId}`, false);
  const salesReversalPaise = Math.max(document.totalRefundPaise - document.gstReversalPaise, 0);
  const lines: VoucherPostingLine[] = [
    {
      ledgerName: "Sales Revenue",
      accountType: "SALES",
      transactionType: "DEBIT",
      amountPaise: salesReversalPaise,
      description: `Sales return ${returnNumber}`
    }
  ];

  if (document.gstReversalPaise > 0) {
    lines.push({
      ledgerName: "GST Payable",
      accountType: "TAX",
      transactionType: "DEBIT",
      amountPaise: document.gstReversalPaise,
      description: `GST reversal ${returnNumber}`
    });
  }

  lines.push({
    ledgerName: settlementLedger.ledgerName,
    accountType: settlementLedger.accountType,
    entityId: settlementLedger.accountType === "CUSTOMER_UDHARI" ? document.customerId : null,
    transactionType: "CREDIT",
    amountPaise: document.totalRefundPaise,
    description: `Refund settlement ${returnNumber}`
  });

  return lines;
}

function buildPurchaseReturnVoucherLines(document: ReturnDocumentPayload, returnNumber: string): VoucherPostingLine[] {
  const settlementLedger = getSettlementLedger(document.refundMode, document.supplierName, true);
  const stockReversalPaise = Math.max(document.totalRefundPaise - document.gstReversalPaise, 0);
  const lines: VoucherPostingLine[] = [
    {
      ledgerName: settlementLedger.ledgerName,
      accountType: settlementLedger.accountType,
      transactionType: "DEBIT",
      amountPaise: document.totalRefundPaise,
      description: `Purchase return settlement ${returnNumber}`
    },
    {
      ledgerName: "Purchase Stock",
      accountType: "STOCK",
      transactionType: "CREDIT",
      amountPaise: stockReversalPaise,
      description: `Stock return ${returnNumber}`
    }
  ];

  if (document.gstReversalPaise > 0) {
    lines.push({
      ledgerName: "GST Input Credit",
      accountType: "TAX",
      transactionType: "CREDIT",
      amountPaise: document.gstReversalPaise,
      description: `GST input reversal ${returnNumber}`
    });
  }

  return lines;
}

function calculateLoyaltyPointsEarned(tx: Tx, checkout: CheckoutPayload, settings: typeof organizationSettings.$inferSelect | undefined) {
  const mode = settings?.loyalty_earn_mode ?? "PER_HUNDRED_RUPEES";

  if (mode === "PER_GRAM_GOLD") {
    const pointsPerGram = settings?.loyalty_points_per_gram_gold ?? 1;
    const goldNetWeightMg = checkout.salesItems.reduce((total, line) => {
      const item = tx.select().from(items).where(eq(items.id, line.itemId)).get();
      const metalType = (line.metalType ?? item?.metal_type ?? "").trim().toLowerCase();
      return metalType === "gold" ? total + (line.netWeightMg ?? item?.net_weight_mg ?? 0) : total;
    }, 0);

    return Math.floor(goldNetWeightMg / 1000) * pointsPerGram;
  }

  const pointsPerHundred = settings?.loyalty_points_per_hundred ?? 1;
  return Math.floor(checkout.totals.netPayablePaise / 10000) * pointsPerHundred;
}

function getSettlementLedger(mode: string, partyName: string, isVendor: boolean = false): { ledgerName: string; accountType: VoucherPostingLine["accountType"] } {
  const normalized = mode.trim().toUpperCase();

  if (normalized === "CASH") {
    return { ledgerName: "Cash", accountType: "CASH" };
  }

  if (normalized === "UPI") {
    return { ledgerName: "UPI Bank", accountType: "BANK" };
  }

  if (normalized === "CARD") {
    return { ledgerName: "Card Bank", accountType: "BANK" };
  }

  if (normalized === "BANK" || normalized === "NEFT" || normalized === "RTGS" || normalized === "CHEQUE") {
    return { ledgerName: "Bank", accountType: "BANK" };
  }

  if (normalized === "UDHARI" || normalized === "CREDIT") {
    if (isVendor) {
      return { ledgerName: `Vendor ${partyName}`, accountType: "VENDOR" };
    }
    return { ledgerName: `Customer Udhari ${partyName}`, accountType: "CUSTOMER_UDHARI" };
  }

  return { ledgerName: isVendor ? `Vendor ${partyName}` : `Customer Udhari ${partyName}`, accountType: isVendor ? "VENDOR" : "CUSTOMER_UDHARI" };
}

function validateCommercialDocumentPayload(body: unknown, documentType: "quotation" | "purchase"): CommercialDocumentValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = body.customer_id === undefined || body.customer_id === null ? null : body.customer_id;
  const supplierId = body.supplier_id === undefined || body.supplier_id === null ? null : body.supplier_id;
  const supplierName = optionalTrimmedText(body.supplier_name ?? body.supplierName) ?? "";
  const supplierPhone = optionalTrimmedText(body.supplier_phone ?? body.supplierPhone) ?? null;
  const supplierGstin = optionalTrimmedText(body.supplier_gstin ?? body.supplierGstin) ?? null;
  const documentDate = optionalTrimmedText(body.document_date ?? body.quotation_date ?? body.purchase_date ?? body.documentDate) ?? getToday();
  const expiryDate = optionalTrimmedText(body.expiry_date ?? body.expiryDate) ?? null;
  const billNumber = optionalTrimmedText(body.bill_number ?? body.billNumber) ?? null;
  const salesmanName = optionalTrimmedText(body.salesman_name ?? body.salesmanName) ?? null;
  const paymentMode = optionalTrimmedText(body.payment_mode ?? body.paymentMode) ?? (documentType === "purchase" ? "CREDIT" : "QUOTE");
  const paymentReference = optionalTrimmedText(body.payment_reference ?? body.paymentReference) ?? null;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map((line, index) => validateCommercialLine(line, index, errors)).filter(isDefined);
  const grossTotalPaise = requiredNonNegativeInteger(body.gross_total_paise ?? body.grossTotalPaise, "gross_total_paise", errors);
  const discountPaise = optionalNonNegativeInteger(body.discount_paise ?? body.discountPaise, "discount_paise", errors) ?? 0;
  const gstAmountPaise = optionalNonNegativeInteger(body.gst_amount_paise ?? body.gstAmountPaise, "gst_amount_paise", errors) ?? lines.reduce((total, line) => total + line.gstPaise, 0);
  const totalAmountPaise = requiredNonNegativeInteger(body.total_amount_paise ?? body.totalAmountPaise, "total_amount_paise", errors);

  // TDS percent on purchases (e.g. 0.1% under 194Q); amount is always computed server-side.
  const tdsPercentRaw = body.tds_percent ?? body.tdsPercent;
  let tdsPercent = 0;
  if (tdsPercentRaw !== undefined && tdsPercentRaw !== null && tdsPercentRaw !== "") {
    const parsed = Number(tdsPercentRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 30) {
      errors.push("tds_percent must be a number between 0 and 30.");
    } else if (documentType !== "purchase" && parsed > 0) {
      errors.push("tds_percent is only valid on purchase invoices.");
    } else {
      tdsPercent = parsed;
    }
  }

  if (customerId !== null && !Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer or null.");
  }

  if (supplierId !== null && !Number.isInteger(supplierId)) {
    errors.push("supplier_id must be an integer or null.");
  }

  if (documentType === "purchase" && !supplierName) {
    errors.push("supplier_name is required for purchase invoices.");
  }

  if (!isDate(documentDate)) {
    errors.push("document_date must be YYYY-MM-DD.");
  }

  if (expiryDate && !isDate(expiryDate)) {
    errors.push("expiry_date must be YYYY-MM-DD.");
  }

  if (lines.length === 0) {
    errors.push("lines must contain at least one line.");
  }

  const calculatedGrossTotal = lines.reduce((total, line) => total + line.lineTotalPaise, 0);

  if (grossTotalPaise !== undefined && grossTotalPaise !== calculatedGrossTotal) {
    errors.push("gross_total_paise must equal the sum of line totals.");
  }

  if (totalAmountPaise !== undefined && grossTotalPaise !== undefined && totalAmountPaise !== Math.max(grossTotalPaise - discountPaise, 0)) {
    errors.push("total_amount_paise must equal gross total minus discount.");
  }

  if (errors.length > 0 || grossTotalPaise === undefined || totalAmountPaise === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: {
      customerId: customerId as number | null,
      supplierId: supplierId as number | null,
      supplierName,
      supplierPhone,
      supplierGstin,
      documentDate,
      expiryDate,
      billNumber,
      salesmanName,
      paymentMode,
      paymentReference,
      grossTotalPaise,
      discountPaise,
      gstAmountPaise,
      totalAmountPaise,
      tdsPercent,
      tdsAmountPaise: Math.round((grossTotalPaise * tdsPercent) / 100),
      lines
    }
  };
}

// Original total + non-cancelled prior refunds for a source document, or null
// when the document does not exist. Shared by the over-refund guard and the
// return-summary endpoint so the UI and the validator agree on the numbers.
function getReturnSummary(kind: "sales" | "purchase", sourceDocumentId: number):
  { originalTotalPaise: number; priorRefundPaise: number } | null {
  if (kind === "sales") {
    const invoice = db.select({ total: invoices.total_amount_paise }).from(invoices).where(eq(invoices.id, sourceDocumentId)).get();
    if (!invoice) return null;
    const prior = db.select({ total: sql<number>`COALESCE(SUM(${salesReturns.total_refund_paise}), 0)` })
      .from(salesReturns)
      .where(and(eq(salesReturns.invoice_id, sourceDocumentId), ne(salesReturns.status, "CANCELLED")))
      .get()?.total ?? 0;
    return { originalTotalPaise: invoice.total, priorRefundPaise: prior };
  }
  const purchase = db.select({ total: purchaseInvoices.total_amount_paise }).from(purchaseInvoices).where(eq(purchaseInvoices.id, sourceDocumentId)).get();
  if (!purchase) return null;
  const prior = db.select({ total: sql<number>`COALESCE(SUM(${purchaseReturns.total_refund_paise}), 0)` })
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.purchase_invoice_id, sourceDocumentId), ne(purchaseReturns.status, "CANCELLED")))
    .get()?.total ?? 0;
  return { originalTotalPaise: purchase.total, priorRefundPaise: prior };
}

// Guard against refunding more than the source document was ever worth. A typo
// of one extra zero would otherwise hand out a refund larger than the sale.
function refundExceedsOriginal(
  kind: "sales" | "purchase",
  sourceDocumentId: number,
  newRefundPaise: number
): { error: string } | null {
  const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const summary = getReturnSummary(kind, sourceDocumentId);

  if (summary === null) {
    const label = kind === "sales" ? "invoice" : "purchase";
    return { error: `Original ${label} #${sourceDocumentId} was not found. Leave the ID blank for a return without a source document.` };
  }

  const { originalTotalPaise, priorRefundPaise } = summary;
  if (priorRefundPaise + newRefundPaise > originalTotalPaise) {
    const overBy = priorRefundPaise + newRefundPaise - originalTotalPaise;
    const label = kind === "sales" ? "sale" : "purchase";
    const priorClause = priorRefundPaise > 0 ? ` with ${money(priorRefundPaise)} already returned,` : "";
    return {
      error: `Refund exceeds the original ${label}. ${kind === "sales" ? "Invoice" : "Purchase"} #${sourceDocumentId} total is ${money(originalTotalPaise)};${priorClause} this return of ${money(newRefundPaise)} would over-refund by ${money(overBy)}.`
    };
  }

  return null;
}

function validateReturnDocumentPayload(body: unknown, documentType: "sales" | "purchase"): ReturnDocumentValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const sourceDocumentId = body.source_document_id === undefined || body.source_document_id === null
    ? body.invoice_id ?? body.purchase_invoice_id ?? null
    : body.source_document_id;
  const customerId = body.customer_id === undefined || body.customer_id === null ? null : body.customer_id;
  const supplierName = optionalTrimmedText(body.supplier_name ?? body.supplierName) ?? "";
  const documentDate = optionalTrimmedText(body.document_date ?? body.return_date ?? body.documentDate) ?? getToday();
  const refundMode = optionalTrimmedText(body.refund_mode ?? body.refundMode) ?? "CASH";
  const refundReference = optionalTrimmedText(body.refund_reference ?? body.refundReference) ?? null;
  const reason = optionalTrimmedText(body.reason) ?? null;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map((line, index) => validateReturnLine(line, index, errors)).filter(isDefined);
  const grossTotalPaise = requiredNonNegativeInteger(body.gross_total_paise ?? body.grossTotalPaise, "gross_total_paise", errors);
  const gstReversalPaise = optionalNonNegativeInteger(body.gst_reversal_paise ?? body.gstReversalPaise, "gst_reversal_paise", errors) ?? lines.reduce((total, line) => total + line.gstPaise, 0);
  const totalRefundPaise = requiredNonNegativeInteger(body.total_refund_paise ?? body.totalRefundPaise, "total_refund_paise", errors);

  if (sourceDocumentId !== null && !Number.isInteger(sourceDocumentId)) {
    errors.push("source_document_id must be an integer or null.");
  }

  if (customerId !== null && !Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer or null.");
  }

  if (documentType === "purchase" && !supplierName) {
    errors.push("supplier_name is required for purchase returns.");
  }

  if (!isDate(documentDate)) {
    errors.push("document_date must be YYYY-MM-DD.");
  }

  if (lines.length === 0) {
    errors.push("lines must contain at least one line.");
  }

  const calculatedGrossTotal = lines.reduce((total, line) => total + line.amountPaise, 0);

  if (grossTotalPaise !== undefined && grossTotalPaise !== calculatedGrossTotal) {
    errors.push("gross_total_paise must equal the sum of return line amounts.");
  }

  if (totalRefundPaise !== undefined && totalRefundPaise !== calculatedGrossTotal) {
    errors.push("total_refund_paise must equal the sum of return line amounts.");
  }

  if (errors.length > 0 || grossTotalPaise === undefined || totalRefundPaise === undefined) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    document: {
      sourceDocumentId: sourceDocumentId as number | null,
      customerId: customerId as number | null,
      supplierName,
      documentDate,
      refundMode,
      refundReference,
      reason,
      grossTotalPaise,
      gstReversalPaise,
      totalRefundPaise,
      lines
    }
  };
}

const STONE_TYPES = ["DIAMOND", "RUBY", "SAPPHIRE", "EMERALD", "OTHER"] as const;

function validateStoneLine(value: Record<string, unknown>, index: number, errors: string[]): CommercialDocumentLine | undefined {
  const description = requiredText(value.description, `lines[${index}].description`, errors);
  const category = optionalTrimmedText(value.category) ?? "Loose Stone";
  const quantity = value.quantity === undefined || value.quantity === null
    ? 1
    : requiredPositiveInteger(value.quantity, `lines[${index}].quantity`, errors);
  const stockMode = (optionalTrimmedText(value.stock_mode ?? value.stockMode) ?? "PIECES").toUpperCase() === "LOT" ? "LOT" : "PIECES";

  const stoneTypeRaw = (optionalTrimmedText(value.stone_type ?? value.stoneType) ?? "OTHER").toUpperCase();
  const stoneType = (STONE_TYPES as readonly string[]).includes(stoneTypeRaw)
    ? (stoneTypeRaw as CommercialDocumentLine["stoneType"])
    : "OTHER";

  const caratRaw = value.carat_weight ?? value.caratWeight;
  let caratWeightTotal: number | undefined;
  if (typeof caratRaw === "number" && Number.isFinite(caratRaw) && caratRaw > 0) {
    caratWeightTotal = caratRaw;
  } else {
    errors.push(`lines[${index}].carat_weight must be a positive number.`);
  }

  const stoneRatePaisePerCarat = optionalNonNegativeInteger(value.stone_rate_paise_per_carat ?? value.stoneRatePaisePerCarat, `lines[${index}].stone_rate_paise_per_carat`, errors) ?? 0;
  const stoneValuePaise = requiredNonNegativeInteger(value.stone_value_paise ?? value.stoneValuePaise, `lines[${index}].stone_value_paise`, errors);
  const gstPaise = optionalNonNegativeInteger(value.gst_paise ?? value.gstPaise, `lines[${index}].gst_paise`, errors) ?? 0;
  const lineTotalPaise = requiredNonNegativeInteger(value.line_total_paise ?? value.lineTotalPaise, `lines[${index}].line_total_paise`, errors);

  if (quantity !== undefined && quantity > 500) {
    errors.push(`lines[${index}].quantity cannot exceed 500.`);
  }

  if (!description || quantity === undefined || caratWeightTotal === undefined || stoneValuePaise === undefined || lineTotalPaise === undefined) {
    return undefined;
  }

  // 1 carat = 200 mg. A loose stone has no metal, so net (metal) weight is zero
  // and the whole physical weight is recorded as stone weight.
  const stoneWeightMg = Math.round(caratWeightTotal * 200);

  return {
    itemId: null,
    description,
    category,
    quantity,
    stockMode,
    metalType: "STONE",
    purityKarat: 0,
    grossWeightMg: stoneWeightMg,
    stoneWeightMg,
    netWeightMg: 0,
    metalRatePaisePerGram: 0,
    makingChargePaise: 0,
    gstPaise,
    lineTotalPaise,
    lineKind: "STONE",
    stoneType,
    caratWeightTotal,
    stoneRatePaisePerCarat,
    stoneValuePaise
  };
}

function validateCommercialLine(value: unknown, index: number, errors: string[]): CommercialDocumentLine | undefined {
  if (!isRecord(value)) {
    errors.push(`lines[${index}] must be an object.`);
    return undefined;
  }

  const lineKind = (optionalTrimmedText(value.line_kind ?? value.lineKind) ?? "METAL").toUpperCase() === "STONE" ? "STONE" : "METAL";
  if (lineKind === "STONE") {
    return validateStoneLine(value, index, errors);
  }

  const itemId = value.item_id === undefined || value.item_id === null ? null : value.item_id;
  const description = requiredText(value.description, `lines[${index}].description`, errors);
  const category = optionalTrimmedText(value.category) ?? "Purchase Stock";
  const quantity = value.quantity === undefined || value.quantity === null
    ? 1
    : requiredPositiveInteger(value.quantity, `lines[${index}].quantity`, errors);
  const stockMode = (optionalTrimmedText(value.stock_mode ?? value.stockMode) ?? "PIECES").toUpperCase() === "LOT" ? "LOT" : "PIECES";
  const metalType = optionalTrimmedText(value.metal_type ?? value.metalType) ?? "Gold";
  const purityKarat = requiredPositiveInteger(value.purity_karat ?? value.purityKarat, `lines[${index}].purity_karat`, errors);
  const grossWeightMg = requiredPositiveInteger(value.gross_weight_mg ?? value.grossWeightMg, `lines[${index}].gross_weight_mg`, errors);
  const stoneWeightMg = optionalNonNegativeInteger(value.stone_weight_mg ?? value.stoneWeightMg, `lines[${index}].stone_weight_mg`, errors) ?? 0;
  const netWeightMg = requiredPositiveInteger(value.net_weight_mg ?? value.netWeightMg, `lines[${index}].net_weight_mg`, errors);
  const metalRatePaisePerGram = requiredNonNegativeInteger(value.metal_rate_paise_per_gram ?? value.metalRatePaisePerGram, `lines[${index}].metal_rate_paise_per_gram`, errors);
  const makingChargePaise = optionalNonNegativeInteger(value.making_charge_paise ?? value.makingChargePaise, `lines[${index}].making_charge_paise`, errors) ?? 0;
  const gstPaise = optionalNonNegativeInteger(value.gst_paise ?? value.gstPaise, `lines[${index}].gst_paise`, errors) ?? 0;
  const lineTotalPaise = requiredNonNegativeInteger(value.line_total_paise ?? value.lineTotalPaise, `lines[${index}].line_total_paise`, errors);

  if (itemId !== null && !Number.isInteger(itemId)) {
    errors.push(`lines[${index}].item_id must be an integer or null.`);
  }

  if (quantity !== undefined && quantity > 500) {
    errors.push(`lines[${index}].quantity cannot exceed 500.`);
  }

  if (grossWeightMg !== undefined && netWeightMg !== undefined && netWeightMg > grossWeightMg) {
    errors.push(`lines[${index}].net_weight_mg cannot exceed gross_weight_mg.`);
  }

  if (!description || purityKarat === undefined || quantity === undefined || grossWeightMg === undefined || netWeightMg === undefined || metalRatePaisePerGram === undefined || lineTotalPaise === undefined) {
    return undefined;
  }

  return {
    itemId: itemId as number | null,
    description,
    category,
    quantity,
    stockMode,
    metalType,
    purityKarat,
    grossWeightMg,
    stoneWeightMg,
    netWeightMg,
    metalRatePaisePerGram,
    makingChargePaise,
    gstPaise,
    lineTotalPaise,
    lineKind: "METAL"
  };
}

function validateReturnLine(value: unknown, index: number, errors: string[]): ReturnDocumentLine | undefined {
  if (!isRecord(value)) {
    errors.push(`lines[${index}] must be an object.`);
    return undefined;
  }

  const itemId = value.item_id === undefined || value.item_id === null ? null : value.item_id;
  const description = requiredText(value.description, `lines[${index}].description`, errors);
  const metalType = optionalTrimmedText(value.metal_type ?? value.metalType) ?? "Gold";
  const purityKarat = requiredPositiveInteger(value.purity_karat ?? value.purityKarat, `lines[${index}].purity_karat`, errors);
  const grossWeightMg = requiredPositiveInteger(value.gross_weight_mg ?? value.grossWeightMg, `lines[${index}].gross_weight_mg`, errors);
  const netWeightMg = requiredPositiveInteger(value.net_weight_mg ?? value.netWeightMg, `lines[${index}].net_weight_mg`, errors);
  const amountPaise = requiredNonNegativeInteger(value.amount_paise ?? value.refund_amount_paise ?? value.return_amount_paise ?? value.amountPaise, `lines[${index}].amount_paise`, errors);
  const gstPaise = optionalNonNegativeInteger(value.gst_paise ?? value.gstPaise, `lines[${index}].gst_paise`, errors) ?? 0;

  if (itemId !== null && !Number.isInteger(itemId)) {
    errors.push(`lines[${index}].item_id must be an integer or null.`);
  }

  if (grossWeightMg !== undefined && netWeightMg !== undefined && netWeightMg > grossWeightMg) {
    errors.push(`lines[${index}].net_weight_mg cannot exceed gross_weight_mg.`);
  }

  if (!description || purityKarat === undefined || grossWeightMg === undefined || netWeightMg === undefined || amountPaise === undefined) {
    return undefined;
  }

  return {
    itemId: itemId as number | null,
    description,
    metalType,
    purityKarat,
    grossWeightMg,
    netWeightMg,
    amountPaise,
    gstPaise
  };
}

function generateDocumentNumber(prefix: string) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const timePart = `${now.getTime()}`.slice(-8);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  return `${prefix}-${datePart}-${timePart}${randomPart}`;
}

function parsePositiveId(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function generateInvoiceNumber() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const timePart = `${now.getTime()}`.slice(-8);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  return `POS-${datePart}-${timePart}${randomPart}`;
}

function generateUrdVoucherNumber() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const timePart = `${now.getTime()}`.slice(-8);

  return `URD-${datePart}-${timePart}`;
}

function formatUrdVoucher(voucher: typeof urdVouchers.$inferSelect) {
  return {
    ...voucher,
    gross_weight_g: (voucher.gross_weight_mg / 1000).toFixed(3),
    stone_weight_g: (voucher.stone_weight_mg / 1000).toFixed(3),
    black_bead_weight_g: (voucher.black_bead_weight_mg / 1000).toFixed(3),
    net_weight_g: (voucher.net_weight_mg / 1000).toFixed(3),
    fine_weight_g: (voucher.fine_weight_mg / 1000).toFixed(3),
    total_value_rupees: paiseToRupees(voucher.total_value_paise),
    legal_receipt_url: `/api/documents/urd-voucher/${voucher.id}`,
    can_ingest_stock: voucher.stock_status === "PENDING" && voucher.kyc_verified,
    can_transfer_refinery: voucher.stock_status === "INGESTED" && !voucher.refinery_transfer_id
  };
}

function requiredText(value: unknown, field: string, errors: string[]) {
  const text = optionalTrimmedText(value);

  if (!text) {
    errors.push(`${field} is required.`);
  }

  return text;
}

function requiredPositiveInteger(value: unknown, field: string, errors: string[]) {
  const integer = requiredNonNegativeInteger(value, field, errors);

  if (integer !== undefined && integer <= 0) {
    errors.push(`${field} must be greater than zero.`);
    return undefined;
  }

  return integer;
}

function optionalPositiveInteger(value: unknown, field: string, errors: string[]) {
  const integer = optionalNonNegativeInteger(value, field, errors);

  if (integer !== undefined && integer <= 0) {
    errors.push(`${field} must be greater than zero.`);
    return undefined;
  }

  return integer;
}

function optionalNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requiredNonNegativeInteger(value, field, errors);
}

function requiredNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  if (!Number.isInteger(value)) {
    errors.push(`${field} must be an integer.`);
    return undefined;
  }

  if ((value as number) < 0) {
    errors.push(`${field} cannot be negative.`);
    return undefined;
  }

  return value as number;
}

function optionalTrimmedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function maskDocumentNumber(value: string) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  const suffix = normalized.slice(-4);

  return `****${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

class CheckoutConflictError extends Error {}

class ItemAlreadySoldError extends CheckoutConflictError {}

function runWithRetry<T>(fn: () => T, maxRetries = 3, delayMs = 50): T {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      if (attempt === maxRetries || !err.message?.includes("SQLITE_BUSY")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * attempt);
    }
  }
  throw new Error("Max retries exceeded");
}

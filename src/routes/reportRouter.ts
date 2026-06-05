import { and, eq, sql, sum } from "drizzle-orm";
import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  invoices,
  invoiceLines,
  items,
  ledgers,
  karigars,
  organizationSettings,
  customers,
  girviLoans,
  gssAccounts,
  gssTemplates,
  journalEntries,
  purchaseInvoices,
  urdPurchases,
  urdVouchers,
  materialIssues,
  jobReceipts
} from "../db/schema.js";

export const reportRouter = Router();

// Protect all report endpoints to ADMIN and MANAGER roles
reportRouter.use(requireAuth);
reportRouter.use(requireRole(["ADMIN", "MANAGER"]));

/**
 * GET /api/reports/daybook-summary?date=YYYY-MM-DD
 * Unified end-of-day business summary (sales, purchase, old-gold/URD, karigar
 * metal movement, and cash/bank position) — mirrors the reference ERP's Day Book.
 */
reportRouter.get("/daybook-summary", (request, response) => {
  const date = typeof request.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.query.date)
    ? request.query.date
    : new Date().toISOString().slice(0, 10);
  const start = `${date} 00:00:00`;
  const end = `${date} 23:59:59`;

  const scalar = (query: { get: () => { total: number } | undefined }) => Number(query.get()?.total ?? 0);

  const inDay = sql`${invoices.created_at} >= ${start} AND ${invoices.created_at} <= ${end}`;

  const totalSalesPaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${invoices.total_amount_paise}), 0)` })
      .from(invoices)
      .where(sql`(${invoices.invoice_type} = 'SALE' OR ${invoices.invoice_type} IS NULL) AND ${inDay}`)
  );

  const totalPurchasePaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${purchaseInvoices.total_amount_paise}), 0)` })
      .from(purchaseInvoices)
      .where(eq(purchaseInvoices.purchase_date, date))
  );

  const urdPosPaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${urdPurchases.deduction_amount_paise}), 0)` })
      .from(urdPurchases)
      .innerJoin(invoices, eq(urdPurchases.invoice_id, invoices.id))
      .where(inDay)
  );
  const urdVoucherPaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${urdVouchers.total_value_paise}), 0)` })
      .from(urdVouchers)
      .where(eq(urdVouchers.voucher_date, date))
  );

  const karigarIssuedFineMg = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${materialIssues.fine_gold_mg}), 0)` })
      .from(materialIssues)
      .where(eq(materialIssues.issue_date, date))
  );
  const karigarReceivedFineMg = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${jobReceipts.fine_gold_debited_mg}), 0)` })
      .from(jobReceipts)
      .where(eq(jobReceipts.receive_date, date))
  );

  const cashInHandPaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${ledgers.balance_paise}), 0)` })
      .from(ledgers)
      .where(eq(ledgers.account_type, "CASH"))
  );
  const bankBalancePaise = scalar(
    db.select({ total: sql<number>`COALESCE(SUM(${ledgers.balance_paise}), 0)` })
      .from(ledgers)
      .where(eq(ledgers.account_type, "BANK"))
  );

  return response.json({
    date,
    total_sales_paise: totalSalesPaise,
    total_purchase_paise: totalPurchasePaise,
    total_urd_purchase_paise: urdPosPaise + urdVoucherPaise,
    karigar_issued_fine_mg: karigarIssuedFineMg,
    karigar_received_fine_mg: karigarReceivedFineMg,
    cash_in_hand_paise: cashInHandPaise,
    bank_balance_paise: bankBalancePaise
  });
});

/**
 * GET /api/reports/mis/kpi-summary
 * Aggregates core top-line metrics:
 * a) Total Gold in Vault (Sum of gross_weight_mg for in-stock items)
 * b) Total Market Value of Vault (Calculated against today's live rates)
 * c) Total Outstanding Udhari (Sum of balances in CUSTOMER_UDHARI ledgers)
 * d) Total Karigar Liability (Sum of fine gold balances)
 * e) Today's Sales (Sum of invoice totals for today)
 */
reportRouter.get("/mis/kpi-summary", (request, response) => {
  try {
    const settings = db.select().from(organizationSettings).get() || {
      gold_24k_rate_per_gram: 0,
      gold_22k_rate_per_gram: 0,
      gold_18k_rate_per_gram: 0,
      silver_rate_per_gram: 0
    };

    const inStockItems = db
      .select()
      .from(items)
      .where(eq(items.status, "IN_STOCK"))
      .all();

    // a) Total Gold in Vault: Sum of gross_weight_mg for all items where status = 'IN_STOCK'
    const totalGoldMg = inStockItems.reduce((sum, item) => sum + item.gross_weight_mg, 0);

    // b) Total Market Value of Vault (Calculated against today's live rate)
    let totalMarketValuePaise = 0;
    for (const item of inStockItems) {
      let ratePerGram = 0;
      const metalType = item.metal_type.trim().toLowerCase();

      if (metalType === "gold") {
        if (item.purity_karat === 24) {
          ratePerGram = settings.gold_24k_rate_per_gram;
        } else if (item.purity_karat === 22) {
          ratePerGram = settings.gold_22k_rate_per_gram;
        } else if (item.purity_karat === 18) {
          ratePerGram = settings.gold_18k_rate_per_gram;
        } else {
          // Proportional rate fallback
          ratePerGram = Math.round((settings.gold_24k_rate_per_gram * item.purity_karat) / 24);
        }
      } else if (metalType === "silver") {
        ratePerGram = settings.silver_rate_per_gram;
      }

      // Base Metal Value in Paise = (Gross Weight mg * Live Rate per gram) / 1000
      const metalValuePaise = (item.gross_weight_mg * ratePerGram) / 1000;
      totalMarketValuePaise += Math.round(metalValuePaise);
    }

    // c) Total Outstanding Udhari: Sum of balances in 'CUSTOMER_UDHARI' ledgers
    const udhariLedgers = db
      .select({ balance_paise: ledgers.balance_paise })
      .from(ledgers)
      .where(eq(ledgers.account_type, "CUSTOMER_UDHARI"))
      .all();
    const totalOutstandingUdhariPaise = udhariLedgers.reduce((sum, l) => sum + l.balance_paise, 0);

    // d) Total Karigar Liability: Sum of fine_gold_balance_mg across all Karigars
    const karigarRows = db
      .select({ fine_gold_balance_mg: karigars.fine_gold_balance_mg })
      .from(karigars)
      .all();
    const totalKarigarLiabilityMg = karigarRows.reduce((sum, k) => sum + k.fine_gold_balance_mg, 0);

    // e) Today's Sales: Sum of invoices total_amount_paise created today
    const todaySalesRow = db
      .select({
        today_sales_paise: sum(invoices.total_amount_paise)
      })
      .from(invoices)
      .where(sql`date(${invoices.created_at}) = date('now')`)
      .get();
    const todaySalesPaise = Number(todaySalesRow?.today_sales_paise || 0);

    return response.json({
      total_gold_mg: totalGoldMg,
      total_market_value_paise: totalMarketValuePaise,
      total_outstanding_udhari_paise: totalOutstandingUdhariPaise,
      total_karigar_liability_mg: totalKarigarLiabilityMg,
      today_sales_paise: todaySalesPaise
    });
  } catch (error) {
    console.error("Failed to generate MIS KPI summary", error);
    return response.status(500).json({ errors: ["Failed to fetch KPI summary report details."] });
  }
});

/**
 * GET /api/reports/mis/sales-trend
 * Returns list of daily sales summaries for charting: date, total sales, old gold received.
 * Accepts a 'date_range' query ('last_30_days', 'this_year').
 */
reportRouter.get("/mis/sales-trend", (request, response) => {
  const dateRange = request.query.date_range;

  try {
    const dateSql = sql<string>`date(${invoices.created_at})`;
    let startDateSql = sql`date('now', '-30 days')`;

    if (dateRange === "this_year") {
      startDateSql = sql`date('now', 'start of year')`;
    }

    const rows = db
      .select({
        date: dateSql,
        total_sales_paise: sum(invoices.total_amount_paise),
        total_old_gold_received_paise: sum(invoices.urd_deduction_paise)
      })
      .from(invoices)
      .where(sql`date(${invoices.created_at}) >= ${startDateSql}`)
      .groupBy(dateSql)
      .orderBy(dateSql)
      .all();

    const formattedTrend = rows.map((row) => ({
      date: row.date,
      total_sales_paise: Number(row.total_sales_paise || 0),
      total_old_gold_received_paise: Number(row.total_old_gold_received_paise || 0)
    }));

    return response.json({ sales_trend: formattedTrend });
  } catch (error) {
    console.error("Failed to generate sales trend data", error);
    return response.status(500).json({ errors: ["Failed to fetch sales trend report data."] });
  }
});

/**
 * GET /api/reports/mis/true-margin
 * Calculates profit margins by category: sales total - purchase rate total
 */
reportRouter.get("/mis/true-margin", (request, response) => {
  try {
    const lines = db
      .select({
        line_total_paise: invoiceLines.line_total_paise,
        gross_weight_mg: invoiceLines.gross_weight_mg,
        category: items.category,
        metal_type: items.metal_type,
        purchase_rate_paise: items.purchase_rate_paise
      })
      .from(invoiceLines)
      .innerJoin(items, eq(invoiceLines.item_id, items.id))
      .all();

    const categoryGroups: Record<
      string,
      {
        category: string;
        total_sales_paise: number;
        total_purchase_cost_paise: number;
      }
    > = {};

    for (const line of lines) {
      const category = line.category || "Other";
      if (!categoryGroups[category]) {
        categoryGroups[category] = {
          category,
          total_sales_paise: 0,
          total_purchase_cost_paise: 0
        };
      }

      const sales = line.line_total_paise || 0;
      const rate = line.purchase_rate_paise || 0;

      // Check if item uses rate-per-gram pricing or flat pricing based on metal type
      const isPerGram =
        line.metal_type.toLowerCase() === "gold" ||
        line.metal_type.toLowerCase() === "silver";
      const cost = isPerGram ? Math.round((rate * line.gross_weight_mg) / 1000) : rate;

      categoryGroups[category].total_sales_paise += sales;
      categoryGroups[category].total_purchase_cost_paise += cost;
    }

    const marginByCategory = Object.values(categoryGroups).map((g) => {
      const profit = g.total_sales_paise - g.total_purchase_cost_paise;
      const margin = g.total_sales_paise > 0 ? (profit / g.total_sales_paise) * 100 : 0;
      return {
        category: g.category,
        total_sales_paise: g.total_sales_paise,
        total_purchase_cost_paise: g.total_purchase_cost_paise,
        realized_profit_paise: profit,
        margin_percentage: Math.round(margin * 100) / 100 // round to 2 decimal places
      };
    });

    return response.json({ margin_by_category: marginByCategory });
  } catch (error) {
    console.error("Failed to generate profit margin report", error);
    return response.status(500).json({ errors: ["Failed to calculate category margins details."] });
  }
});

reportRouter.post("/builder/query", (request, response) => {
  try {
    const { dataSource, columns, filters = {}, groupBy, aggregate } = request.body;

    if (!dataSource || typeof dataSource !== "string") {
      return response.status(400).json({ errors: ["dataSource is required."] });
    }

    const { startDate, endDate, searchQuery, status, metalType, category } = filters;

    let query: any;
    const conditions: any[] = [];

    // Helper to get date field
    let dateField: any;
    if (dataSource === "invoices") dateField = invoices.created_at;
    else if (dataSource === "items") dateField = items.purchase_date;
    else if (dataSource === "girvi_loans") dateField = girviLoans.issue_date;
    else if (dataSource === "gss_accounts") dateField = gssAccounts.enrollment_date;
    else if (dataSource === "journal_entries") dateField = journalEntries.created_at;

    if (dateField) {
      if (startDate) {
        conditions.push(sql`date(${dateField}) >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`date(${dateField}) <= ${endDate}`);
      }
    }

    // Apply Search Query wildcard filter
    if (searchQuery && typeof searchQuery === "string" && searchQuery.trim()) {
      const wildcard = `%${searchQuery.trim()}%`;
      if (dataSource === "invoices") {
        conditions.push(
          sql`(${invoices.invoice_number} LIKE ${wildcard} OR ${customers.name} LIKE ${wildcard} OR ${customers.phone} LIKE ${wildcard})`
        );
      } else if (dataSource === "items") {
        conditions.push(
          sql`(${items.barcode} LIKE ${wildcard} OR ${items.design_name} LIKE ${wildcard} OR ${items.category} LIKE ${wildcard})`
        );
      } else if (dataSource === "girvi_loans") {
        conditions.push(
          sql`(${girviLoans.loan_number} LIKE ${wildcard} OR ${customers.name} LIKE ${wildcard} OR ${customers.phone} LIKE ${wildcard})`
        );
      } else if (dataSource === "gss_accounts") {
        conditions.push(
          sql`(${gssAccounts.card_number} LIKE ${wildcard} OR ${customers.name} LIKE ${wildcard} OR ${customers.phone} LIKE ${wildcard} OR ${gssTemplates.scheme_name} LIKE ${wildcard})`
        );
      } else if (dataSource === "journal_entries") {
        conditions.push(
          sql`(${journalEntries.description} LIKE ${wildcard} OR ${ledgers.account_name} LIKE ${wildcard})`
        );
      }
    }

    // Apply status filter
    if (status && typeof status === "string" && status !== "ALL") {
      if (dataSource === "invoices") {
        conditions.push(eq(invoices.invoice_type, status));
      } else if (dataSource === "items") {
        conditions.push(eq(items.status, status));
      } else if (dataSource === "girvi_loans") {
        conditions.push(eq(girviLoans.status, status as any));
      } else if (dataSource === "gss_accounts") {
        conditions.push(eq(gssAccounts.status, status as any));
      } else if (dataSource === "journal_entries") {
        conditions.push(eq(journalEntries.transaction_type, status as any));
      }
    }

    // Item-specific filters
    if (dataSource === "items") {
      if (metalType && metalType !== "ALL") {
        conditions.push(eq(items.metal_type, metalType));
      }
      if (category && category !== "ALL") {
        conditions.push(eq(items.category, category));
      }
    }

    // Select core data fields depending on source
    if (dataSource === "invoices") {
      query = db
        .select({
          id: invoices.id,
          invoice_number: invoices.invoice_number,
          total_amount_paise: invoices.total_amount_paise,
          gst_amount_paise: invoices.gst_amount_paise,
          discount_paise: invoices.discount_paise,
          urd_deduction_paise: invoices.urd_deduction_paise,
          payment_mode: invoices.payment_mode,
          invoice_type: invoices.invoice_type,
          created_at: invoices.created_at,
          customer_name: customers.name,
          customer_phone: customers.phone
        })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customer_id, customers.id));
    } else if (dataSource === "items") {
      query = db
        .select({
          id: items.id,
          barcode: items.barcode,
          name: items.design_name,
          metal_type: items.metal_type,
          category: items.category,
          purity_karat: items.purity_karat,
          gross_weight_mg: items.gross_weight_mg,
          net_weight_mg: items.net_weight_mg,
          stone_weight_mg: items.stone_weight_mg,
          purchase_rate_paise: items.purchase_rate_paise,
          selling_price_paise: sql<number | null>`null`,
          status: items.status,
          created_at: items.purchase_date
        })
        .from(items);
    } else if (dataSource === "girvi_loans") {
      query = db
        .select({
          id: girviLoans.id,
          loan_number: girviLoans.loan_number,
          principal_amount_paise: girviLoans.principal_amount_paise,
          interest_rate_percentage: girviLoans.interest_rate_percentage,
          interest_type: girviLoans.interest_type,
          rate_period: girviLoans.rate_period,
          issue_date: girviLoans.issue_date,
          next_due_date: girviLoans.next_due_date,
          status: girviLoans.status,
          total_repaid_paise: girviLoans.total_repaid_paise,
          customer_name: customers.name,
          customer_phone: customers.phone
        })
        .from(girviLoans)
        .leftJoin(customers, eq(girviLoans.customer_id, customers.id));
    } else if (dataSource === "gss_accounts") {
      query = db
        .select({
          id: gssAccounts.id,
          card_number: gssAccounts.card_number,
          enrollment_date: gssAccounts.enrollment_date,
          maturity_date: gssAccounts.maturity_date,
          status: gssAccounts.status,
          total_paid_paise: gssAccounts.total_paid_paise,
          installments_paid_count: gssAccounts.installments_paid_count,
          customer_name: customers.name,
          customer_phone: customers.phone,
          scheme_name: gssTemplates.scheme_name,
          monthly_amount_paise: gssTemplates.monthly_amount_paise
        })
        .from(gssAccounts)
        .leftJoin(customers, eq(gssAccounts.customer_id, customers.id))
        .leftJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id));
    } else if (dataSource === "journal_entries") {
      query = db
        .select({
          id: journalEntries.id,
          transaction_type: journalEntries.transaction_type,
          amount_paise: journalEntries.amount_paise,
          reference_type: journalEntries.reference_type,
          reference_id: journalEntries.reference_id,
          description: journalEntries.description,
          created_at: journalEntries.created_at,
          ledger_name: ledgers.account_name,
          account_type: ledgers.account_type
        })
        .from(journalEntries)
        .leftJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id));
    } else {
      return response.status(400).json({ errors: ["Invalid dataSource selection."] });
    }

    // Append filters using AND relation
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const rows = query.all();

    // Calculate Summary/Aggregations on total matched dataset
    const summary = {
      totalCount: rows.length,
      sumAmountPaise: 0,
      sumWeightMg: 0,
      sumPrincipalPaise: 0,
      sumPaidPaise: 0
    };

    for (const r of rows) {
      if (r.total_amount_paise) summary.sumAmountPaise += Number(r.total_amount_paise) || 0;
      else if (r.amount_paise) summary.sumAmountPaise += Number(r.amount_paise) || 0;

      if (r.gross_weight_mg) summary.sumWeightMg += Number(r.gross_weight_mg) || 0;
      if (r.principal_amount_paise) summary.sumPrincipalPaise += Number(r.principal_amount_paise) || 0;
      if (r.total_paid_paise) summary.sumPaidPaise += Number(r.total_paid_paise) || 0;
    }

    // Apply grouping & aggregation if requested (in memory)
    let processedRows = rows;
    if (groupBy && typeof groupBy === "string") {
      const groups: Record<string, any> = {};
      for (const r of rows) {
        const val = r[groupBy] !== undefined && r[groupBy] !== null ? String(r[groupBy]) : "N/A";
        if (!groups[val]) {
          groups[val] = {
            group_value: val,
            count: 0
          };
          if (aggregate && typeof aggregate === "object" && aggregate.type === "SUM") {
            groups[val][aggregate.field] = 0;
          }
        }
        groups[val].count += 1;
        if (aggregate && typeof aggregate === "object" && aggregate.type === "SUM") {
          const num = Number(r[aggregate.field]) || 0;
          groups[val][aggregate.field] += num;
        }
      }
      processedRows = Object.values(groups);
    }

    // Filter properties to keep only requested columns if specified
    if (columns && Array.isArray(columns) && columns.length > 0) {
      // If grouped, keep group_value, count, and dynamic aggregate field
      if (groupBy) {
        const keepKeys = ["group_value", "count"];
        if (aggregate && typeof aggregate === "object") {
          keepKeys.push(aggregate.field);
        }
        processedRows = processedRows.map((r: any) => {
          const filtered: Record<string, any> = {};
          for (const key of keepKeys) {
            if (r[key] !== undefined) filtered[key] = r[key];
          }
          return filtered;
        });
      } else {
        processedRows = processedRows.map((r: any) => {
          const filtered: Record<string, any> = {};
          for (const col of columns) {
            if (r[col] !== undefined) filtered[col] = r[col];
          }
          return filtered;
        });
      }
    }

    return response.json({
      rows: processedRows,
      summary
    });
  } catch (error) {
    console.error("[Report Builder Query Failed]", error);
    return response.status(500).json({ errors: ["Failed to execute report builder query."] });
  }
});

-- Phase 2: merge legacy split customer-udhari ledgers into one canonical ledger per
-- customer (the lowest-id CUSTOMER_UDHARI ledger for each entity). Earlier builds posted
-- a customer's dues and advances to differently-named ledgers, so receivables were split
-- across rows. This consolidates them; debits=credits are preserved (pure re-pointing),
-- so the trial balance is unaffected. Idempotent: a customer with one ledger is unchanged.

-- 1) Roll each customer's combined balance into their canonical (min-id) udhari ledger.
UPDATE ledgers
SET balance_paise = (
  SELECT SUM(l2.balance_paise) FROM ledgers l2
  WHERE l2.account_type = 'CUSTOMER_UDHARI' AND l2.entity_id = ledgers.entity_id
)
WHERE account_type = 'CUSTOMER_UDHARI'
  AND entity_id IS NOT NULL
  AND id = (
    SELECT MIN(l3.id) FROM ledgers l3
    WHERE l3.account_type = 'CUSTOMER_UDHARI' AND l3.entity_id = ledgers.entity_id
  );
--> statement-breakpoint
-- 2) Re-point journal entries from non-canonical udhari ledgers to the canonical one.
UPDATE journal_entries
SET ledger_id = (
  SELECT MIN(l3.id) FROM ledgers l3
  WHERE l3.account_type = 'CUSTOMER_UDHARI'
    AND l3.entity_id = (SELECT le.entity_id FROM ledgers le WHERE le.id = journal_entries.ledger_id)
)
WHERE ledger_id IN (
  SELECT id FROM ledgers WHERE account_type = 'CUSTOMER_UDHARI' AND entity_id IS NOT NULL
);
--> statement-breakpoint
-- 3) Re-point voucher lines likewise.
UPDATE voucher_lines
SET ledger_id = (
  SELECT MIN(l3.id) FROM ledgers l3
  WHERE l3.account_type = 'CUSTOMER_UDHARI'
    AND l3.entity_id = (SELECT le.entity_id FROM ledgers le WHERE le.id = voucher_lines.ledger_id)
)
WHERE ledger_id IN (
  SELECT id FROM ledgers WHERE account_type = 'CUSTOMER_UDHARI' AND entity_id IS NOT NULL
);
--> statement-breakpoint
-- 4) Delete the now-empty, re-pointed non-canonical udhari ledgers.
DELETE FROM ledgers
WHERE account_type = 'CUSTOMER_UDHARI'
  AND entity_id IS NOT NULL
  AND id <> (
    SELECT MIN(l3.id) FROM ledgers l3
    WHERE l3.account_type = 'CUSTOMER_UDHARI' AND l3.entity_id = ledgers.entity_id
  );

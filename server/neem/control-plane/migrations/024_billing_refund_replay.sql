-- Migration 024: Preserve the provider refund reference for idempotent replay.

ALTER TABLE neem_billing_transactions
  ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(128);

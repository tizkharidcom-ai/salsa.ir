-- Migration 023: Preserve invoice cycle and prevent duplicate gateway authorities.

DO $$
BEGIN
  IF EXISTS (
    SELECT gateway_authority
    FROM neem_billing_transactions
    WHERE gateway_authority IS NOT NULL
    GROUP BY gateway_authority
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'BILLING_GATEWAY_AUTHORITY_DUPLICATES: resolve duplicate gateway authorities before applying migration 023';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_neem_billing_gateway_authority
  ON neem_billing_transactions(gateway_authority)
  WHERE gateway_authority IS NOT NULL;

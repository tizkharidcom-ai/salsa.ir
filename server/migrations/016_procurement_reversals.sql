BEGIN;

ALTER TABLE finance_vendor_invoices
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS reversed_by TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE finance_vendor_invoices
  DROP CONSTRAINT IF EXISTS finance_vendor_invoices_status_check;
ALTER TABLE finance_vendor_invoices
  ADD CONSTRAINT finance_vendor_invoices_status_check
  CHECK (status IN ('received','matched','exception','approved','partially_paid','paid','cancelled','reversed'));
ALTER TABLE finance_vendor_invoices
  ADD CONSTRAINT finance_vendor_invoice_reversal_chain_check
  CHECK (status <> 'reversed' OR (
    journal_entry_id IS NOT NULL
    AND reversal_journal_entry_id IS NOT NULL
    AND reversed_by IS NOT NULL
    AND reversed_at IS NOT NULL
  ));

CREATE UNIQUE INDEX IF NOT EXISTS finance_vendor_invoice_journal_unique
  ON finance_vendor_invoices(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_vendor_invoice_reversal_journal_unique
  ON finance_vendor_invoices(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finance_vendor_invoice_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor_invoices_are_immutable_use_reversal';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number
    OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
    OR NEW.total_irr IS DISTINCT FROM OLD.total_irr
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id)
    OR (OLD.reversal_journal_entry_id IS NOT NULL AND NEW.reversal_journal_entry_id IS DISTINCT FROM OLD.reversal_journal_entry_id)
    OR (OLD.status = 'reversed' AND ROW(NEW.status,NEW.reversed_by,NEW.reversed_at)
      IS DISTINCT FROM ROW(OLD.status,OLD.reversed_by,OLD.reversed_at)) THEN
    RAISE EXCEPTION 'vendor_invoice_financial_fields_are_immutable_use_reversal';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE finance_vendor_payments
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES journal_entries_v2(id),
  ADD COLUMN IF NOT EXISTS reversed_by TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE finance_vendor_payments
  DROP CONSTRAINT IF EXISTS finance_vendor_payments_status_check;
ALTER TABLE finance_vendor_payments
  ADD CONSTRAINT finance_vendor_payments_status_check
  CHECK (status IN ('pending_approval','approved','sent','succeeded','failed','cancelled','reversed'));
ALTER TABLE finance_vendor_payments
  ADD CONSTRAINT finance_vendor_payment_reversal_chain_check
  CHECK (status <> 'reversed' OR (
    journal_entry_id IS NOT NULL
    AND reversal_journal_entry_id IS NOT NULL
    AND reversed_by IS NOT NULL
    AND reversed_at IS NOT NULL
  ));

CREATE UNIQUE INDEX IF NOT EXISTS finance_vendor_payment_journal_unique
  ON finance_vendor_payments(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_vendor_payment_reversal_journal_unique
  ON finance_vendor_payments(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finance_vendor_payment_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor_payments_are_immutable_use_reversal';
  END IF;
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.amount_irr IS DISTINCT FROM OLD.amount_irr
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id)
    OR (OLD.reversal_journal_entry_id IS NOT NULL AND NEW.reversal_journal_entry_id IS DISTINCT FROM OLD.reversal_journal_entry_id)
    OR (OLD.status = 'reversed' AND ROW(NEW.status,NEW.reversed_by,NEW.reversed_at)
      IS DISTINCT FROM ROW(OLD.status,OLD.reversed_by,OLD.reversed_at)) THEN
    RAISE EXCEPTION 'vendor_payment_financial_fields_are_immutable_use_reversal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_vendor_payment_immutable_trigger ON finance_vendor_payments;
CREATE TRIGGER finance_vendor_payment_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_vendor_payments
  FOR EACH ROW EXECUTE FUNCTION finance_vendor_payment_immutable_guard();

COMMIT;

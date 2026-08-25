BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS finance_events (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  amount_irr BIGINT NOT NULL CHECK (amount_irr >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','posted','blocked','quarantined')),
  error JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, source_version)
);

CREATE TABLE IF NOT EXISTS finance_payments (
  id UUID PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES unified_orders(id),
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  tender TEXT NOT NULL,
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','cancelled','refunded')),
  provider TEXT,
  provider_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  paid_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_provider_reference_unique
  ON finance_payments (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_refunds (
  id UUID PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES finance_payments(id),
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','processing','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_cash_sessions (
  id UUID PRIMARY KEY,
  legacy_session_id TEXT UNIQUE,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  cashier_id TEXT NOT NULL,
  terminal_id TEXT,
  opening_amount_irr BIGINT NOT NULL CHECK (opening_amount_irr >= 0),
  counted_amount_irr BIGINT CHECK (counted_amount_irr >= 0),
  expected_amount_irr BIGINT CHECK (expected_amount_irr >= 0),
  variance_irr BIGINT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  CHECK (closed_at IS NULL OR counted_amount_irr IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS finance_inventory_movements (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  item_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receipt','consume','waste','production','count_adjustment','return')),
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity <> 0),
  unit_cost_irr BIGINT CHECK (unit_cost_irr >= 0),
  total_cost_irr BIGINT CHECK (total_cost_irr >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_type, source_id, item_id)
);

CREATE TABLE IF NOT EXISTS finance_recipe_versions (
  id UUID PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  yield_quantity NUMERIC(18,6) NOT NULL CHECK (yield_quantity > 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  ingredients JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS finance_purchase_orders (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  vendor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','partially_received','received','cancelled','closed')),
  total_irr BIGINT NOT NULL CHECK (total_irr >= 0),
  lines JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_goods_receipts (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES finance_purchase_orders(id),
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  received_at TIMESTAMPTZ NOT NULL,
  lines JSONB NOT NULL,
  received_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS finance_vendor_invoices (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  purchase_order_id UUID REFERENCES finance_purchase_orders(id),
  total_irr BIGINT NOT NULL CHECK (total_irr > 0),
  status TEXT NOT NULL CHECK (status IN ('received','matched','exception','approved','partially_paid','paid','cancelled')),
  match_result JSONB,
  invoice_date DATE NOT NULL,
  due_date DATE,
  UNIQUE (vendor_id, number)
);

CREATE TABLE IF NOT EXISTS finance_vendor_payments (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES finance_vendor_invoices(id),
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','sent','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE IF NOT EXISTS fiscal_periods_v2 (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','soft_closed','closed','reopened')),
  closed_by TEXT,
  closed_at TIMESTAMPTZ,
  reopened_by TEXT,
  reopened_at TIMESTAMPTZ,
  CHECK (starts_on <= ends_on),
  EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE OR REPLACE FUNCTION finance_validate_period_continuity() RETURNS trigger AS $$
DECLARE previous_end DATE; next_start DATE;
BEGIN
  SELECT MAX(ends_on) INTO previous_end FROM fiscal_periods_v2 WHERE id <> NEW.id AND ends_on < NEW.starts_on;
  SELECT MIN(starts_on) INTO next_start FROM fiscal_periods_v2 WHERE id <> NEW.id AND starts_on > NEW.ends_on;
  IF previous_end IS NOT NULL AND previous_end + 1 <> NEW.starts_on THEN RAISE EXCEPTION 'fiscal_period_gap_before'; END IF;
  IF next_start IS NOT NULL AND NEW.ends_on + 1 <> next_start THEN RAISE EXCEPTION 'fiscal_period_gap_after'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_period_continuity_guard ON fiscal_periods_v2;
CREATE TRIGGER finance_period_continuity_guard
  BEFORE INSERT OR UPDATE ON fiscal_periods_v2
  FOR EACH ROW EXECUTE FUNCTION finance_validate_period_continuity();

CREATE TABLE IF NOT EXISTS journal_entries_v2 (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  period_id UUID REFERENCES fiscal_periods_v2(id),
  finance_event_id UUID UNIQUE REFERENCES finance_events(id),
  source TEXT NOT NULL,
  source_id TEXT,
  entry_at TIMESTAMPTZ NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','posted','reversed','rejected')),
  debit_irr BIGINT NOT NULL CHECK (debit_irr >= 0),
  credit_irr BIGINT NOT NULL CHECK (credit_irr >= 0),
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  reversal_of_id UUID UNIQUE REFERENCES journal_entries_v2(id),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  CHECK (status NOT IN ('posted','reversed') OR (period_id IS NOT NULL AND debit_irr = credit_irr))
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_v2_source_unique
  ON journal_entries_v2 (source, source_id)
  WHERE source_id IS NOT NULL AND status IN ('posted','reversed');

CREATE TABLE IF NOT EXISTS journal_lines_v2 (
  id UUID PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  account_code TEXT NOT NULL,
  debit_irr BIGINT NOT NULL DEFAULT 0 CHECK (debit_irr >= 0),
  credit_irr BIGINT NOT NULL DEFAULT 0 CHECK (credit_irr >= 0),
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  cost_center TEXT NOT NULL,
  counterparty_id TEXT,
  payment_method TEXT,
  item_id TEXT,
  recipe_version_id TEXT,
  memo TEXT,
  CHECK ((debit_irr > 0 AND credit_irr = 0) OR (credit_irr > 0 AND debit_irr = 0)),
  UNIQUE (journal_entry_id, line_no)
);

CREATE TABLE IF NOT EXISTS finance_approvals (
  id UUID PRIMARY KEY,
  operation TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  amount_irr BIGINT CHECK (amount_irr >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (decided_by IS NULL OR decided_by <> created_by)
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  order_id BIGINT REFERENCES unified_orders(id),
  payment_id TEXT,
  cash_session_id TEXT,
  bank_reference TEXT,
  settlement_reference TEXT,
  psp TEXT,
  terminal_id TEXT,
  batch_no TEXT,
  journal_entry_id UUID REFERENCES journal_entries_v2(id),
  amount_irr BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unmatched','matched','exception','resolved')),
  matched_at TIMESTAMPTZ,
  matched_by TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_outbox (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS finance_legacy_archive (
  id UUID PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  trust_status TEXT NOT NULL CHECK (trust_status IN ('verified','inferred_needs_approval','quarantined')),
  reason TEXT NOT NULL,
  source_payload JSONB NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_settlement_batch_unique
  ON reconciliation_items (psp, terminal_id, batch_no)
  WHERE kind = 'settlement' AND status <> 'exception';

CREATE UNIQUE INDEX IF NOT EXISTS finance_depreciation_asset_period_unique
  ON journal_entries_v2 ((source_id), period_id)
  WHERE source = 'depreciation' AND status IN ('posted','reversed');

CREATE INDEX IF NOT EXISTS finance_events_status_occurred_idx ON finance_events(status, occurred_at);
CREATE INDEX IF NOT EXISTS journal_entries_v2_branch_at_idx ON journal_entries_v2(branch_id, entry_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_items_status_idx ON reconciliation_items(status, branch_id, created_at DESC);

CREATE OR REPLACE FUNCTION finance_validate_refund_total() RETURNS trigger AS $$
DECLARE paid_amount BIGINT; refunded_amount BIGINT;
BEGIN
  SELECT amount_irr INTO paid_amount FROM finance_payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_irr), 0) INTO refunded_amount
    FROM finance_refunds
    WHERE payment_id = NEW.payment_id AND status NOT IN ('failed','cancelled') AND id <> NEW.id;
  IF paid_amount IS NULL OR refunded_amount + NEW.amount_irr > paid_amount THEN
    RAISE EXCEPTION 'refund_total_exceeds_payment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_refund_total_guard ON finance_refunds;
CREATE TRIGGER finance_refund_total_guard
  BEFORE INSERT OR UPDATE ON finance_refunds
  FOR EACH ROW EXECUTE FUNCTION finance_validate_refund_total();

CREATE OR REPLACE FUNCTION finance_guard_posted_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'posted_journal_is_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'posted_journal_is_immutable_use_reversal';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_journal_immutable_guard ON journal_entries_v2;
CREATE TRIGGER finance_journal_immutable_guard
  BEFORE UPDATE OR DELETE ON journal_entries_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_posted_immutable();

CREATE OR REPLACE FUNCTION finance_guard_posted_lines_immutable() RETURNS trigger AS $$
DECLARE target_id UUID; target_status TEXT;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
  SELECT status INTO target_status FROM journal_entries_v2 WHERE id = target_id;
  IF target_status IN ('posted','reversed') THEN
    RAISE EXCEPTION 'posted_journal_lines_are_immutable_use_reversal';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_journal_lines_immutable_guard ON journal_lines_v2;
CREATE TRIGGER finance_journal_lines_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_posted_lines_immutable();

CREATE OR REPLACE FUNCTION finance_validate_posted_journal() RETURNS trigger AS $$
DECLARE target_id UUID; target_status TEXT; target_period UUID; expected_debit BIGINT; expected_credit BIGINT; line_debit BIGINT; line_credit BIGINT; period_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries_v2' THEN
    target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
  END IF;
  SELECT status, period_id, debit_irr, credit_irr INTO target_status, target_period, expected_debit, expected_credit
    FROM journal_entries_v2 WHERE id = target_id;
  IF target_status IN ('posted','reversed') THEN
    SELECT COALESCE(SUM(debit_irr),0), COALESCE(SUM(credit_irr),0) INTO line_debit, line_credit FROM journal_lines_v2 WHERE journal_entry_id = target_id;
    SELECT status INTO period_status FROM fiscal_periods_v2 WHERE id = target_period;
    IF line_debit <> line_credit OR line_debit <> expected_debit OR line_credit <> expected_credit THEN RAISE EXCEPTION 'posted_journal_lines_unbalanced'; END IF;
    IF period_status NOT IN ('open','reopened') THEN RAISE EXCEPTION 'fiscal_period_not_open'; END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_journal_balance_guard ON journal_entries_v2;
CREATE CONSTRAINT TRIGGER finance_journal_balance_guard
  AFTER INSERT OR UPDATE ON journal_entries_v2 DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_validate_posted_journal();

DROP TRIGGER IF EXISTS finance_journal_lines_balance_guard ON journal_lines_v2;
CREATE CONSTRAINT TRIGGER finance_journal_lines_balance_guard
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines_v2 DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_validate_posted_journal();

COMMIT;

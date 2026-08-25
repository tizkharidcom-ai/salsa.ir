BEGIN;

CREATE TABLE IF NOT EXISTS finance_cost_commitments (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  commitment_type TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency = 'monthly'),
  monthly_amount_irr BIGINT NOT NULL CHECK (monthly_amount_irr > 0),
  expense_account_code TEXT NOT NULL CHECK (expense_account_code ~ '^[0-9]{4,10}$'),
  liability_account_code TEXT NOT NULL CHECK (liability_account_code ~ '^[0-9]{4,10}$'),
  cost_behavior TEXT NOT NULL CHECK (cost_behavior IN ('fixed','variable')),
  counterparty_id TEXT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_by TEXT,
  deactivated_at TIMESTAMPTZ,
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS finance_cost_accruals (
  id UUID PRIMARY KEY,
  cost_commitment_id UUID NOT NULL REFERENCES finance_cost_commitments(id) ON DELETE RESTRICT,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  service_month DATE NOT NULL CHECK (EXTRACT(DAY FROM service_month) = 1),
  posting_date TIMESTAMPTZ NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id) ON DELETE RESTRICT,
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  expense_account_code TEXT NOT NULL CHECK (expense_account_code ~ '^[0-9]{4,10}$'),
  liability_account_code TEXT NOT NULL CHECK (liability_account_code ~ '^[0-9]{4,10}$'),
  override_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','posted','partially_paid','paid','rejected','reversed')),
  paid_amount_irr BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount_irr >= 0 AND paid_amount_irr <= amount_irr),
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by TEXT,
  posted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_cost_accrual_active_month_unique
  ON finance_cost_accruals (cost_commitment_id, service_month)
  WHERE status NOT IN ('rejected','reversed');

CREATE TABLE IF NOT EXISTS finance_cost_payments (
  id UUID PRIMARY KEY,
  cost_accrual_id UUID NOT NULL REFERENCES finance_cost_accruals(id) ON DELETE RESTRICT,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank','cash','petty_cash')),
  payment_date TIMESTAMPTZ NOT NULL,
  reference TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','paid','rejected','reversed')),
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS finance_cost_commitments_branch_status_idx
  ON finance_cost_commitments (branch_id, status, starts_on);

CREATE INDEX IF NOT EXISTS finance_cost_accruals_branch_status_idx
  ON finance_cost_accruals (branch_id, status, posting_date DESC);

COMMIT;

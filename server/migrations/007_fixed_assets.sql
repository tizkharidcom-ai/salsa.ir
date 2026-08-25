BEGIN;

CREATE TABLE IF NOT EXISTS finance_fixed_assets (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  asset_code TEXT NOT NULL CHECK (asset_code ~ '^[A-Z0-9_-]{3,40}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  category TEXT NOT NULL,
  asset_account_code TEXT NOT NULL CHECK (asset_account_code IN ('1810','1820','1830')),
  funding_method TEXT NOT NULL CHECK (funding_method IN ('bank','cash')),
  funding_account_code TEXT NOT NULL CHECK (funding_account_code IN ('1210','1110')),
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  purchase_date DATE NOT NULL,
  in_service_date DATE NOT NULL,
  purchase_cost_irr BIGINT NOT NULL CHECK (purchase_cost_irr > 0),
  salvage_value_irr BIGINT NOT NULL DEFAULT 0 CHECK (salvage_value_irr >= 0),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months BETWEEN 1 AND 600),
  depreciation_method TEXT NOT NULL CHECK (depreciation_method = 'straight_line'),
  depreciation_convention TEXT NOT NULL CHECK (depreciation_convention = 'full_month'),
  accumulated_depreciation_irr BIGINT NOT NULL DEFAULT 0 CHECK (accumulated_depreciation_irr >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','active','rejected','reversed','disposed')),
  acquisition_journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  acquisition_approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  last_depreciation_month DATE,
  last_depreciation_at TIMESTAMPTZ,
  CHECK (in_service_date >= purchase_date),
  CHECK (salvage_value_irr < purchase_cost_irr),
  CHECK (accumulated_depreciation_irr <= purchase_cost_irr - salvage_value_irr)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_fixed_asset_branch_code_unique
  ON finance_fixed_assets(branch_id, asset_code)
  WHERE status NOT IN ('rejected','reversed');

CREATE TABLE IF NOT EXISTS finance_depreciation_runs (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  service_month DATE NOT NULL CHECK (EXTRACT(DAY FROM service_month) = 1),
  posting_date TIMESTAMPTZ NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method = 'straight_line'),
  convention TEXT NOT NULL CHECK (convention = 'full_month'),
  total_depreciation_irr BIGINT NOT NULL CHECK (total_depreciation_irr > 0),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','posted','rejected','reversed')),
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS finance_asset_depreciation_lines (
  id UUID PRIMARY KEY,
  depreciation_run_id UUID NOT NULL REFERENCES finance_depreciation_runs(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES finance_fixed_assets(id) ON DELETE RESTRICT,
  service_month DATE NOT NULL CHECK (EXTRACT(DAY FROM service_month) = 1),
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  accumulated_before_irr BIGINT NOT NULL CHECK (accumulated_before_irr >= 0),
  remaining_before_irr BIGINT NOT NULL CHECK (remaining_before_irr >= amount_irr),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','posted','rejected','reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (depreciation_run_id, asset_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_asset_depreciation_period_unique
  ON finance_asset_depreciation_lines(asset_id, service_month)
  WHERE status NOT IN ('rejected','reversed');

CREATE INDEX IF NOT EXISTS finance_fixed_assets_branch_status_idx
  ON finance_fixed_assets(branch_id, status, in_service_date);

CREATE INDEX IF NOT EXISTS finance_depreciation_runs_branch_month_idx
  ON finance_depreciation_runs(branch_id, service_month DESC, status);

COMMIT;

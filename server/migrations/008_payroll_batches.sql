BEGIN;

CREATE TABLE IF NOT EXISTS finance_payroll_runs (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  service_month DATE NOT NULL CHECK (EXTRACT(DAY FROM service_month) = 1),
  posting_date DATE NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id) ON DELETE RESTRICT,
  source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) >= 3),
  headcount INTEGER NOT NULL CHECK (headcount BETWEEN 1 AND 10000),
  kitchen_gross_irr BIGINT NOT NULL DEFAULT 0 CHECK (kitchen_gross_irr >= 0),
  service_gross_irr BIGINT NOT NULL DEFAULT 0 CHECK (service_gross_irr >= 0),
  total_gross_irr BIGINT NOT NULL CHECK (total_gross_irr > 0),
  employer_insurance_irr BIGINT NOT NULL DEFAULT 0 CHECK (employer_insurance_irr >= 0),
  employee_insurance_irr BIGINT NOT NULL DEFAULT 0 CHECK (employee_insurance_irr >= 0),
  total_insurance_irr BIGINT NOT NULL DEFAULT 0 CHECK (total_insurance_irr >= 0),
  payroll_tax_irr BIGINT NOT NULL DEFAULT 0 CHECK (payroll_tax_irr >= 0),
  other_deductions_irr BIGINT NOT NULL DEFAULT 0 CHECK (other_deductions_irr >= 0),
  net_pay_irr BIGINT NOT NULL CHECK (net_pay_irr > 0),
  total_expense_irr BIGINT NOT NULL CHECK (total_expense_irr > 0),
  calculation_policy TEXT NOT NULL CHECK (calculation_policy = 'accountant_confirmed_totals_no_automatic_statutory_rate'),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','posted','partially_paid','paid','rejected','reversed')),
  paid_by_liability JSONB NOT NULL DEFAULT '{"net_salary":0,"social_security":0,"payroll_tax":0,"other_deductions":0}'::jsonb,
  journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID UNIQUE REFERENCES journal_entries_v2(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by TEXT,
  posted_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  CHECK (service_month = date_trunc('month', posting_date)::date),
  CHECK (total_gross_irr = kitchen_gross_irr + service_gross_irr),
  CHECK (net_pay_irr = total_gross_irr - employee_insurance_irr - payroll_tax_irr - other_deductions_irr),
  CHECK (total_insurance_irr = employer_insurance_irr + employee_insurance_irr),
  CHECK (total_expense_irr = total_gross_irr + employer_insurance_irr),
  CHECK (jsonb_typeof(paid_by_liability) = 'object'),
  CHECK (COALESCE((paid_by_liability->>'net_salary')::BIGINT, 0) BETWEEN 0 AND net_pay_irr),
  CHECK (COALESCE((paid_by_liability->>'social_security')::BIGINT, 0) BETWEEN 0 AND total_insurance_irr),
  CHECK (COALESCE((paid_by_liability->>'payroll_tax')::BIGINT, 0) BETWEEN 0 AND payroll_tax_irr),
  CHECK (COALESCE((paid_by_liability->>'other_deductions')::BIGINT, 0) BETWEEN 0 AND other_deductions_irr)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_payroll_branch_month_unique
  ON finance_payroll_runs(branch_id, service_month)
  WHERE status NOT IN ('rejected','reversed');

CREATE TABLE IF NOT EXISTS finance_payroll_payments (
  id UUID PRIMARY KEY,
  payroll_run_id UUID NOT NULL REFERENCES finance_payroll_runs(id) ON DELETE RESTRICT,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  liability_type TEXT NOT NULL CHECK (liability_type IN ('net_salary','social_security','payroll_tax','other_deductions')),
  liability_account_code TEXT NOT NULL CHECK (liability_account_code IN ('2600','2230','2220','2700')),
  amount_irr BIGINT NOT NULL CHECK (amount_irr > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank','cash')),
  payment_date DATE NOT NULL,
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

CREATE INDEX IF NOT EXISTS finance_payroll_runs_branch_status_idx
  ON finance_payroll_runs(branch_id, service_month DESC, status);

CREATE INDEX IF NOT EXISTS finance_payroll_payments_run_status_idx
  ON finance_payroll_payments(payroll_run_id, liability_type, status);

CREATE OR REPLACE FUNCTION finance_guard_payroll_payment_ceiling()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_run UUID;
  target_type TEXT;
  ceiling_irr BIGINT;
  committed_irr BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_run := OLD.payroll_run_id;
    target_type := OLD.liability_type;
  ELSE
    target_run := NEW.payroll_run_id;
    target_type := NEW.liability_type;
  END IF;
  SELECT CASE target_type
    WHEN 'net_salary' THEN net_pay_irr
    WHEN 'social_security' THEN total_insurance_irr
    WHEN 'payroll_tax' THEN payroll_tax_irr
    WHEN 'other_deductions' THEN other_deductions_irr
  END INTO ceiling_irr
  FROM finance_payroll_runs WHERE id = target_run;

  IF ceiling_irr IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT COALESCE(SUM(amount_irr), 0) INTO committed_irr
  FROM finance_payroll_payments
  WHERE payroll_run_id = target_run
    AND liability_type = target_type
    AND status IN ('pending_approval','paid');

  IF committed_irr > ceiling_irr THEN
    RAISE EXCEPTION 'payroll payment ceiling exceeded for run % and liability %', target_run, target_type
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS finance_payroll_payment_ceiling_trigger ON finance_payroll_payments;
CREATE CONSTRAINT TRIGGER finance_payroll_payment_ceiling_trigger
AFTER INSERT OR UPDATE OR DELETE ON finance_payroll_payments
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION finance_guard_payroll_payment_ceiling();

COMMIT;

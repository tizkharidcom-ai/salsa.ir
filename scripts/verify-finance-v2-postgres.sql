\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unified_branches WHERE id = 1) THEN
    RAISE EXCEPTION 'verification_requires_branch_1';
  END IF;
END;
$$;

INSERT INTO fiscal_periods_v2(id,name,starts_on,ends_on,status)
VALUES('d0000000-0000-4000-8000-000000000001','Finance V2 verification','2026-08-01','2026-08-31','open');

INSERT INTO finance_approvals(id,operation,entity_type,entity_id,amount_irr,status,created_by)
VALUES
  ('d0000000-0000-4000-8000-000000000002','approve_payroll_run','journal_entry','d0000000-0000-4000-8000-000000000003',3300,'pending','accountant-verification'),
  ('d0000000-0000-4000-8000-000000000004','approve_payroll_run','journal_entry','d0000000-0000-4000-8000-000000000005',3300,'pending','accountant-verification');

INSERT INTO journal_entries_v2(id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
VALUES
  ('d0000000-0000-4000-8000-000000000003','VERIFY-PAYROLL-1','payroll.run','verify-payroll-1','2026-08-25 12:00:00+03:30','Payroll verification','pending_approval',3300,3300,1,'accountant-verification'),
  ('d0000000-0000-4000-8000-000000000005','VERIFY-PAYROLL-2','payroll.run','verify-payroll-2','2026-08-25 12:00:00+03:30','Duplicate payroll verification','pending_approval',3300,3300,1,'accountant-verification');

INSERT INTO finance_payroll_runs(
  id,branch_id,service_month,posting_date,fiscal_period_id,source_reference,headcount,
  kitchen_gross_irr,service_gross_irr,total_gross_irr,employer_insurance_irr,
  employee_insurance_irr,total_insurance_irr,payroll_tax_irr,other_deductions_irr,
  net_pay_irr,total_expense_irr,calculation_policy,status,paid_by_liability,
  journal_entry_id,approval_id,created_by
) VALUES (
  'd0000000-0000-4000-8000-000000000006',1,'2026-08-01','2026-08-25','d0000000-0000-4000-8000-000000000001','VERIFY-PAYROLL',2,
  2000,1000,3000,300,200,500,100,0,2700,3300,
  'accountant_confirmed_totals_no_automatic_statutory_rate','pending_approval',
  '{"net_salary":0,"social_security":0,"payroll_tax":0,"other_deductions":0}',
  'd0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000002','accountant-verification'
);

DO $$
BEGIN
  BEGIN
    UPDATE finance_payroll_runs
      SET net_pay_irr = 2701
      WHERE id = 'd0000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'payroll_equation_constraint_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

DO $$
DECLARE violated_constraint TEXT;
BEGIN
  BEGIN
    INSERT INTO finance_payroll_runs(
      id,branch_id,service_month,posting_date,fiscal_period_id,source_reference,headcount,
      kitchen_gross_irr,service_gross_irr,total_gross_irr,employer_insurance_irr,
      employee_insurance_irr,total_insurance_irr,payroll_tax_irr,other_deductions_irr,
      net_pay_irr,total_expense_irr,calculation_policy,status,paid_by_liability,
      journal_entry_id,approval_id,created_by
    ) SELECT
      'd0000000-0000-4000-8000-000000000007',branch_id,service_month,posting_date,fiscal_period_id,'VERIFY-DUPLICATE',headcount,
      kitchen_gross_irr,service_gross_irr,total_gross_irr,employer_insurance_irr,
      employee_insurance_irr,total_insurance_irr,payroll_tax_irr,other_deductions_irr,
      net_pay_irr,total_expense_irr,calculation_policy,status,paid_by_liability,
      'd0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000004',created_by
    FROM finance_payroll_runs WHERE id = 'd0000000-0000-4000-8000-000000000006';
    RAISE EXCEPTION 'payroll_branch_month_unique_not_enforced';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'finance_payroll_branch_month_unique' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO finance_approvals(id,operation,entity_type,entity_id,amount_irr,status,created_by)
VALUES
  ('d0000000-0000-4000-8000-000000000008','approve_payroll_payment','payroll_payment','d0000000-0000-4000-8000-000000000009',2000,'pending','accountant-verification'),
  ('d0000000-0000-4000-8000-000000000010','approve_payroll_payment','payroll_payment','d0000000-0000-4000-8000-000000000011',800,'pending','accountant-verification');

INSERT INTO finance_payroll_payments(
  id,payroll_run_id,branch_id,liability_type,liability_account_code,amount_irr,
  payment_method,payment_date,reference,status,approval_id,created_by
) VALUES (
  'd0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000006',1,
  'net_salary','2600',2000,'bank','2026-08-26','VERIFY-PAY-1','pending_approval',
  'd0000000-0000-4000-8000-000000000008','accountant-verification'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO finance_payroll_payments(
      id,payroll_run_id,branch_id,liability_type,liability_account_code,amount_irr,
      payment_method,payment_date,reference,status,approval_id,created_by
    ) VALUES (
      'd0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000006',1,
      'net_salary','2600',800,'bank','2026-08-26','VERIFY-PAY-OVER','pending_approval',
      'd0000000-0000-4000-8000-000000000010','accountant-verification'
    );
    RAISE EXCEPTION 'payroll_payment_ceiling_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO finance_legacy_archive(
  id,source_table,source_id,trust_status,reason,source_payload,branch_id,amount_irr,
  decision,decision_notes,decision_history,archived_by
) VALUES (
  'd0000000-0000-4000-8000-000000000012','accounting.journalEntries','VERIFY-LEGACY-1',
  'quarantined','explicit_test_or_demo_marker','{"number":"TEST-1"}',1,1000,
  'keep_quarantined','verification','[]','accountant-verification'
);

DO $$
BEGIN
  BEGIN
    UPDATE finance_legacy_archive
      SET backfill_status = 'pending_approval'
      WHERE id = 'd0000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'legacy_backfill_chain_constraint_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_legacy_archive
      SET backfill_status = 'reversed'
      WHERE id = 'd0000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'legacy_backfill_reversal_chain_constraint_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_legacy_archive
      SET decision = 'approved_for_backfill'
      WHERE id = 'd0000000-0000-4000-8000-000000000012';
    RAISE EXCEPTION 'quarantined_backfill_constraint_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

SELECT json_build_object(
  'ok', true,
  'payrollEquation', 'enforced',
  'branchMonthUnique', 'enforced',
  'paymentCeiling', 'enforced',
  'quarantineBackfill', 'enforced',
  'legacyBackfillChain', 'enforced',
  'legacyBackfillReversalChain', 'enforced',
  'temporaryRows', (SELECT COUNT(*) FROM finance_payroll_runs WHERE source_reference LIKE 'VERIFY-%')
) AS finance_v2_postgres_verification;

ROLLBACK;

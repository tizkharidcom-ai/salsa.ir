\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unified_branches WHERE id = 1) THEN
    RAISE EXCEPTION 'verification_requires_branch_1';
  END IF;
END;
$$;

INSERT INTO finance_inventory_items_v2(
  id,branch_id,sku,name,base_unit_code,costing_method,reorder_point_base,safety_stock_base,lead_time_days,active
) VALUES (
  'verify-recipe-beef',1,'VERIFY-RECIPE-BEEF','ماده آزمون رسپی','kg','weighted_average',0,0,1,true
);

INSERT INTO finance_approvals(
  id,operation,entity_type,entity_id,amount_irr,status,created_by,created_at,history
) VALUES (
  'fb000000-0000-4000-8000-000000000001','approve_recipe_version','recipe_version',
  'fb000000-0000-4000-8000-000000000002',0,'pending','kitchen-verification',now(),'[]'::jsonb
);

INSERT INTO finance_recipe_versions(
  id,recipe_id,menu_item_id,menu_item_name,name,version,branch_id,yield_quantity,effective_from,ingredients,
  status,approval_id,created_by,created_at,history
) VALUES (
  'fb000000-0000-4000-8000-000000000002','menu:verify:branch:1','verify','آیتم آزمون','رسپی آزمون',1,1,1,
  now(),'[{"itemId":"verify-recipe-beef","quantity":0.2,"unit":"kg"}]'::jsonb,
  'pending_approval','fb000000-0000-4000-8000-000000000001','kitchen-verification',now(),'[]'::jsonb
);

INSERT INTO finance_recipe_ingredients(
  id,recipe_version_id,line_no,item_id,quantity,unit_code,quantity_basis,yield_percent
) VALUES (
  'fb000000-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000002',1,
  'verify-recipe-beef',0.2,'kg','raw',100
);

UPDATE finance_approvals SET status='approved',decided_by='owner-verification',decided_at=now()
  WHERE id='fb000000-0000-4000-8000-000000000001';
UPDATE finance_recipe_versions SET status='approved',approved_by='owner-verification',approved_at=now()
  WHERE id='fb000000-0000-4000-8000-000000000002';

DO $$
BEGIN
  BEGIN
    UPDATE finance_recipe_versions SET yield_quantity=2
      WHERE id='fb000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'recipe_core_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'recipe_core_immutability_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'finance_recipe_version_core_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE finance_recipe_ingredients SET quantity=0.3
      WHERE id='fb000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'recipe_ingredient_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'recipe_ingredient_immutability_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'finance_recipe_ingredient_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM finance_recipe_versions
      WHERE id='fb000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'recipe_delete_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'recipe_delete_immutability_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'finance_recipe_version_delete_forbidden' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO finance_migration_baselines(
  id,branch_id,status,source_count,source_keys,source_fingerprints,source_sha256,trust_summary,scanned_by,scanned_at
) VALUES (
  'a1000000-0000-4000-8000-000000000001',1,'active',1,'["orders:verify-1"]'::jsonb,
  '{"orders:verify-1":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '{"verified":1,"inferred_needs_approval":0,"quarantined":0}'::jsonb,'accountant-verification',now()
);

DO $$
DECLARE violated_constraint TEXT;
BEGIN
  BEGIN
    INSERT INTO finance_migration_baselines(
      id,branch_id,status,source_count,source_keys,source_fingerprints,source_sha256,trust_summary,scanned_by,scanned_at
    ) VALUES (
      'a1000000-0000-4000-8000-000000000002',1,'active',0,'[]'::jsonb,'{}'::jsonb,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','{}'::jsonb,'accountant-verification',now()
    );
    RAISE EXCEPTION 'finance_migration_baseline_unique_not_enforced';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'finance_migration_baseline_one_active' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE finance_migration_baselines
  SET status='superseded',superseded_at=now()
  WHERE id='a1000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    UPDATE finance_migration_baselines SET source_count=0,source_keys='[]'::jsonb
      WHERE id='a1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'finance_migration_baseline_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
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

INSERT INTO finance_approvals(id,operation,entity_type,entity_id,amount_irr,status,created_by)
VALUES
  ('e0000000-0000-4000-8000-000000000001','post_opening_balance','journal_entry','e0000000-0000-4000-8000-000000000002',1000,'pending','accountant-verification'),
  ('e0000000-0000-4000-8000-000000000003','post_opening_balance','journal_entry','e0000000-0000-4000-8000-000000000004',1000,'pending','accountant-verification');

INSERT INTO journal_entries_v2(id,number,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,created_by)
VALUES
  ('e0000000-0000-4000-8000-000000000002','VERIFY-OPENING-1','opening_balance','verify-opening-1','2026-08-01 12:00:00+03:30','Opening balance verification','pending_approval',1000,1000,1,'accountant-verification'),
  ('e0000000-0000-4000-8000-000000000004','VERIFY-OPENING-2','opening_balance','verify-opening-2','2026-08-01 12:00:00+03:30','Duplicate opening balance verification','pending_approval',1000,1000,1,'accountant-verification');

INSERT INTO finance_opening_balance_batches(
  id,branch_id,as_of_date,fiscal_period_id,source_reference,debit_irr,credit_irr,lines,status,
  journal_entry_id,approval_id,created_by
) VALUES (
  'e0000000-0000-4000-8000-000000000005',1,'2026-08-01','d0000000-0000-4000-8000-000000000001','VERIFY-OPENING',1000,1000,
  '[{"accountCode":"1210","debitIrr":1000,"creditIrr":0,"branchId":1,"costCenter":"branch:1"},{"accountCode":"3100","debitIrr":0,"creditIrr":1000,"branchId":1,"costCenter":"branch:1"}]'::jsonb,
  'pending_approval','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','accountant-verification'
);

DO $$
DECLARE violated_constraint TEXT;
BEGIN
  BEGIN
    INSERT INTO finance_opening_balance_batches(
      id,branch_id,as_of_date,fiscal_period_id,source_reference,debit_irr,credit_irr,lines,status,
      journal_entry_id,approval_id,created_by
    ) SELECT
      'e0000000-0000-4000-8000-000000000006',branch_id,as_of_date,fiscal_period_id,'VERIFY-OPENING-DUP',debit_irr,credit_irr,lines,status,
      'e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000003',created_by
    FROM finance_opening_balance_batches WHERE id = 'e0000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'opening_balance_branch_unique_not_enforced';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'finance_opening_balance_one_active_branch' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_opening_balance_batches
      SET lines = '[{"accountCode":"1210","debitIrr":1000,"creditIrr":0,"branchId":1,"costCenter":"branch:1"},{"accountCode":"3900","debitIrr":0,"creditIrr":1000,"branchId":1,"costCenter":"branch:1"}]'::jsonb
      WHERE id = 'e0000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'opening_balance_line_constraint_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

UPDATE finance_opening_balance_batches
  SET status='posted',decided_by='owner-verification',decided_at=now(),posted_by='owner-verification',posted_at=now()
  WHERE id = 'e0000000-0000-4000-8000-000000000005';

DO $$
BEGIN
  BEGIN
    UPDATE finance_opening_balance_batches SET source_reference='MUTATED'
      WHERE id = 'e0000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'opening_balance_immutable_guard_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_opening_balance_batches SET status='reversed'
      WHERE id = 'e0000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'opening_balance_reversal_chain_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO finance_approvals(id,operation,entity_type,entity_id,amount_irr,status,created_by)
VALUES
  ('f0000000-0000-4000-8000-000000000001','activate_finance_branch_cutover','finance_branch_rollout','f0000000-0000-4000-8000-000000000003',0,'pending','manager-verification'),
  ('f0000000-0000-4000-8000-000000000002','activate_finance_branch_cutover','finance_branch_rollout','f0000000-0000-4000-8000-000000000004',0,'pending','manager-verification');

INSERT INTO finance_branch_rollouts(
  id,branch_id,status,approval_id,requested_by,requested_at,readiness_snapshot
) VALUES (
  'f0000000-0000-4000-8000-000000000003',1,'pending_approval','f0000000-0000-4000-8000-000000000001',
  'manager-verification',now(),'{"status":"READY_FOR_CUTOVER_REVIEW"}'::jsonb
);

DO $$
DECLARE violated_constraint TEXT;
BEGIN
  BEGIN
    INSERT INTO finance_branch_rollouts(
      id,branch_id,status,approval_id,requested_by,requested_at,readiness_snapshot
    ) VALUES (
      'f0000000-0000-4000-8000-000000000004',1,'pending_approval','f0000000-0000-4000-8000-000000000002',
      'manager-verification',now(),'{"status":"READY_FOR_CUTOVER_REVIEW"}'::jsonb
    );
    RAISE EXCEPTION 'finance_branch_rollout_unique_not_enforced';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'finance_branch_rollout_one_active_request' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_branch_rollouts
      SET status='active',decided_by='manager-verification',decided_at=now(),activated_by='manager-verification',activated_at=now(),
          readiness_at_activation='{"status":"READY_FOR_CUTOVER_REVIEW"}'::jsonb
      WHERE id='f0000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'finance_branch_rollout_sod_not_enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

UPDATE finance_branch_rollouts
  SET status='active',decided_by='owner-verification',decided_at=now(),activated_by='owner-verification',activated_at=now(),
      readiness_at_activation='{"status":"READY_FOR_CUTOVER_REVIEW"}'::jsonb
  WHERE id='f0000000-0000-4000-8000-000000000003';

DO $$
BEGIN
  BEGIN
    UPDATE finance_branch_rollouts SET status='rejected'
      WHERE id='f0000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'finance_branch_rollout_active_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
END;
$$;

INSERT INTO finance_purchase_orders(id,number,branch_id,vendor_id,status,total_irr,lines,created_by)
VALUES(
  'fa000000-0000-4000-8000-000000000001','VERIFY-PO-IMMUTABLE',1,'vendor-verification','received',1000,
  '[{"itemId":"verify-item","quantity":1,"unit":"عدد","unitPriceIrr":1000}]'::jsonb,'accountant-verification'
);

INSERT INTO finance_goods_receipts(id,number,purchase_order_id,branch_id,received_at,lines,received_by,idempotency_key)
VALUES(
  'fa000000-0000-4000-8000-000000000002','VERIFY-GRN-IMMUTABLE','fa000000-0000-4000-8000-000000000001',1,now(),
  '[{"itemId":"verify-item","acceptedQuantity":1,"unit":"عدد"}]'::jsonb,'warehouse-verification','verify-grn-immutable'
);

INSERT INTO finance_vendor_invoices(id,number,vendor_id,branch_id,purchase_order_id,total_irr,status,match_result,invoice_date,journal_entry_id)
VALUES(
  'fa000000-0000-4000-8000-000000000003','VERIFY-INV-IMMUTABLE','vendor-verification',1,
  'fa000000-0000-4000-8000-000000000001',1000,'matched','{"matchStatus":"matched"}'::jsonb,'2026-08-25',
  'd0000000-0000-4000-8000-000000000003'
);

DO $$
BEGIN
  BEGIN
    UPDATE finance_goods_receipts SET lines='[]'::jsonb
      WHERE id='fa000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'goods_receipt_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_vendor_invoices SET total_irr=1100
      WHERE id='fa000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'vendor_invoice_financial_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  UPDATE finance_vendor_invoices
    SET status='partially_paid',match_result='{"matchStatus":"matched","paymentStatus":"partial"}'::jsonb
    WHERE id='fa000000-0000-4000-8000-000000000003';
  BEGIN
    DELETE FROM finance_vendor_invoices
      WHERE id='fa000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'vendor_invoice_delete_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
END;
$$;

INSERT INTO finance_vendor_payments(
  id,invoice_id,amount_irr,status,idempotency_key,created_by,approved_by,created_at,approved_at,journal_entry_id
) VALUES (
  'fa000000-0000-4000-8000-000000000004','fa000000-0000-4000-8000-000000000003',1000,'succeeded',
  'verify-supplier-payment-reversal','accountant-verification','owner-verification',now(),now(),
  'd0000000-0000-4000-8000-000000000005'
);

UPDATE finance_vendor_payments
  SET status='reversed',reversal_journal_entry_id='e0000000-0000-4000-8000-000000000004',
      reversed_by='owner-verification',reversed_at=now()
  WHERE id='fa000000-0000-4000-8000-000000000004';

UPDATE finance_vendor_invoices
  SET status='reversed',reversal_journal_entry_id='e0000000-0000-4000-8000-000000000002',
      reversed_by='owner-verification',reversed_at=now()
  WHERE id='fa000000-0000-4000-8000-000000000003';

DO $$
BEGIN
  BEGIN
    UPDATE finance_vendor_payments SET amount_irr=900
      WHERE id='fa000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'vendor_payment_financial_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'vendor_payment_financial_immutability_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'vendor_payment_financial_fields_are_immutable_use_reversal' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM finance_vendor_payments
      WHERE id='fa000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'vendor_payment_delete_immutability_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'vendor_payment_delete_immutability_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'vendor_payments_are_immutable_use_reversal' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO finance_idempotency_requests(
  idempotency_key,operation,request_sha256,outcome_kind,outcome_id,created_at
) VALUES (
  'verify-route-idempotency-0001','POST:/api/admin/v2/finance/purchase-orders',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'purchase_order','fa000000-0000-4000-8000-000000000001',now()
);

DO $$
DECLARE violated_constraint TEXT;
BEGIN
  BEGIN
    INSERT INTO finance_idempotency_requests(
      idempotency_key,operation,request_sha256,outcome_kind,outcome_id
    ) VALUES (
      'verify-route-idempotency-0001','POST:/api/admin/v2/finance/vendor-invoices',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'vendor_invoice','fa000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'finance_idempotency_key_unique_not_enforced';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'finance_idempotency_requests_pkey' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE finance_idempotency_requests
      SET request_sha256='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      WHERE idempotency_key='verify-route-idempotency-0001';
    RAISE EXCEPTION 'finance_idempotency_request_update_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'finance_idempotency_request_update_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'finance_idempotency_requests_are_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM finance_idempotency_requests
      WHERE idempotency_key='verify-route-idempotency-0001';
    RAISE EXCEPTION 'finance_idempotency_request_delete_not_enforced';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'finance_idempotency_request_delete_not_enforced' THEN RAISE; END IF;
    IF SQLERRM <> 'finance_idempotency_requests_are_immutable' THEN RAISE; END IF;
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
  'openingBalanceLineShape', 'enforced',
  'openingBalanceOneActiveBranch', 'enforced',
  'openingBalanceImmutable', 'enforced',
  'openingBalanceReversalChain', 'enforced',
  'branchRolloutOneActive', 'enforced',
  'branchRolloutSegregationOfDuties', 'enforced',
  'branchRolloutActiveImmutable', 'enforced',
  'goodsReceiptImmutable', 'enforced',
  'vendorInvoiceFinancialFieldsImmutable', 'enforced',
  'vendorInvoiceDeleteImmutable', 'enforced',
  'vendorInvoiceReversalChain', 'enforced',
  'vendorPaymentReversalChain', 'enforced',
  'vendorPaymentImmutable', 'enforced',
  'requestIdempotencyKeyUnique', 'enforced',
  'requestIdempotencyImmutable', 'enforced',
  'recipeIndependentApproval', 'enforced',
  'recipeCoreImmutable', 'enforced',
  'recipeIngredientsAppendOnly', 'enforced',
  'recipeDeleteForbidden', 'enforced',
  'migrationBaselineOneActive', 'enforced',
  'migrationBaselineImmutable', 'enforced',
  'temporaryRows', (SELECT COUNT(*) FROM finance_payroll_runs WHERE source_reference LIKE 'VERIFY-%')
) AS finance_v2_postgres_verification;

ROLLBACK;

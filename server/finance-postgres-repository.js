'use strict';

const { stableUuid } = require('./finance/legacy-classifier');

function list(value) { return Array.isArray(value) ? value : []; }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function iso(value) { return value || new Date().toISOString(); }
function uuidOrNull(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null; }
function procurementStatus(status) {
  return ({ pending_approval: 'draft', rejected: 'cancelled' })[status] || status;
}
function invoiceStatus(status) {
  return ({ open: 'matched', match_exception: 'exception' })[status] || status;
}
function paymentStatus(status) {
  return ({ paid: 'succeeded', rejected: 'cancelled' })[status] || status;
}
function movementType(value) {
  return ({ goods_receipt: 'receipt', sale_consumption: 'consume' })[value] || value;
}

async function normalizedSchemaAvailable(client) {
  const result = await client.query(`SELECT
    to_regclass('public.finance_events') AS finance_events,
    to_regclass('public.journal_entries_v2') AS journal_entries,
    to_regclass('public.finance_outbox') AS outbox,
    to_regclass('public.finance_order_item_cost_snapshots') AS cost_snapshots,
    to_regclass('public.finance_inventory_movement_valuations') AS movement_valuations,
    to_regclass('public.finance_production_batches') AS production_batches,
    to_regclass('public.finance_cost_commitments') AS cost_commitments,
    to_regclass('public.finance_fixed_assets') AS fixed_assets,
    to_regclass('public.finance_payroll_runs') AS payroll_runs,
    to_regclass('public.finance_opening_balance_batches') AS opening_balances,
    to_regclass('public.finance_legacy_archive') AS legacy_archive,
    (SELECT COUNT(*) = 12 FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_legacy_archive'
      AND column_name IN ('reviewed_tenders','backfill_status','backfill_journal_entry_id','backfill_approval_id','backfill_event_id','backfill_requested_by','backfill_requested_at','backfilled_by','backfilled_at','backfill_reversal_journal_entry_id','backfill_reversed_by','backfill_reversed_at')) AS legacy_backfill`);
  const row = result.rows?.[0] || {};
  return Boolean(row.finance_events && row.journal_entries && row.outbox && row.cost_snapshots && row.movement_valuations && row.production_batches && row.cost_commitments && row.fixed_assets && row.payroll_runs && row.opening_balances && row.legacy_archive && row.legacy_backfill);
}

async function syncPeriods(client, state) {
  for (const period of list(state.fiscalPeriods)) {
    await client.query(`INSERT INTO fiscal_periods_v2
      (id,name,starts_on,ends_on,status,closed_by,closed_at,reopened_by,reopened_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on,
        status=EXCLUDED.status, closed_by=EXCLUDED.closed_by, closed_at=EXCLUDED.closed_at,
        reopened_by=EXCLUDED.reopened_by, reopened_at=EXCLUDED.reopened_at`, [
      period.id, period.name || period.id, period.startDate, period.endDate, period.status,
      period.closedBy || null, period.closedAt || null, period.reopenedBy || null, period.reopenedAt || null,
    ]);
  }
}

async function syncEvents(client, state) {
  for (const event of list(state.events)) {
    await client.query(`INSERT INTO finance_events
      (id,source,source_id,source_version,idempotency_key,branch_id,occurred_at,amount_irr,payload,status,error,processed_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,payload=EXCLUDED.payload,
        processed_at=EXCLUDED.processed_at,amount_irr=EXCLUDED.amount_irr`, [
      event.id, event.source, String(event.sourceId), event.sourceVersion || 1, event.idempotencyKey,
      event.branchId, event.occurredAt, event.amountIrr || 0, json(event.payload), event.status,
      event.error ? json(event.error) : null, event.processedAt || null, iso(event.createdAt),
    ]);
    await client.query(`INSERT INTO finance_outbox
      (id,aggregate_type,aggregate_id,event_type,idempotency_key,payload,occurred_at,published_at,attempts,last_error)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=EXCLUDED.payload,published_at=EXCLUDED.published_at,
        attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error`, [
      event.id, event.source.split('.')[0] || 'finance', String(event.sourceId), event.source,
      `outbox:${event.idempotencyKey}`, json({ financeEventId: event.id, ...event.payload }), event.occurredAt,
      event.status === 'posted' ? (event.processedAt || event.createdAt) : null, event.error ? 1 : 0, event.error?.message || null,
    ]);
  }
}

async function syncPaymentsAndRefunds(client, state) {
  for (const payment of list(state.payments)) {
    await client.query(`INSERT INTO finance_payments
      (id,order_id,branch_id,tender,amount_irr,status,provider,provider_reference,idempotency_key,paid_at,payload,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload`, [
      payment.id, Number(payment.orderId), payment.branchId, payment.tender, payment.amountIrr, payment.status,
      payment.provider || null, payment.providerReference || null, payment.idempotencyKey, payment.paidAt || null,
      json({ ...(payment.payload || {}), refundedIrr: payment.refundedIrr || 0 }), iso(payment.createdAt),
    ]);
  }
  for (const refund of list(state.refunds)) {
    await client.query(`INSERT INTO finance_refunds
      (id,payment_id,amount_irr,reason,status,idempotency_key,approved_by,approved_at,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at`, [
      refund.id, refund.paymentId, refund.amountIrr, refund.reason, refund.status, refund.idempotencyKey,
      refund.approvedBy || null, refund.approvedAt || null, refund.createdBy, iso(refund.createdAt),
    ]);
  }
}

async function syncJournals(client, state) {
  for (const entry of list(state.journalEntries)) {
    const finalStatus = entry.status;
    const insertStatus = ['posted', 'reversed'].includes(finalStatus) ? 'draft' : finalStatus;
    await client.query(`INSERT INTO journal_entries_v2
      (id,number,period_id,finance_event_id,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,reversal_of_id,created_by,created_at,posted_by,posted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(id) DO UPDATE SET period_id=EXCLUDED.period_id,description=EXCLUDED.description,status=EXCLUDED.status,
        debit_irr=EXCLUDED.debit_irr,credit_irr=EXCLUDED.credit_irr,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at
      WHERE journal_entries_v2.status NOT IN ('posted','reversed')`, [
      entry.id, entry.number, entry.periodId || null, entry.sourceEventId || null, entry.source, entry.sourceId == null ? null : String(entry.sourceId),
      entry.date, entry.description, insertStatus, entry.debitIrr, entry.creditIrr, entry.branchId, entry.reversalOfId || null,
      entry.createdBy || 'system', iso(entry.createdAt), entry.postedBy || null, entry.postedAt || null,
    ]);
    for (const line of list(entry.lines)) {
      await client.query(`INSERT INTO journal_lines_v2
        (id,journal_entry_id,line_no,account_code,debit_irr,credit_irr,branch_id,cost_center,counterparty_id,payment_method,item_id,recipe_version_id,memo)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(id) DO NOTHING`, [
        line.id, entry.id, line.lineNo, line.accountCode, line.debitIrr, line.creditIrr, line.branchId,
        line.costCenter || `branch:${line.branchId}`, line.counterpartyId || null, line.paymentMethod || null,
        line.itemId || null, line.recipeVersionId || null, line.memo || null,
      ]);
    }
    if (insertStatus !== finalStatus) {
      await client.query(`UPDATE journal_entries_v2 SET status=$2,period_id=$3,posted_by=$4,posted_at=$5
        WHERE id=$1 AND status NOT IN ('posted','reversed')`, [entry.id, finalStatus, entry.periodId, entry.postedBy || entry.createdBy || 'system', entry.postedAt || entry.createdAt]);
    }
  }
}

async function syncApprovals(client, state) {
  for (const approval of list(state.approvals)) {
    await client.query(`INSERT INTO finance_approvals
      (id,operation,entity_type,entity_id,amount_irr,status,created_by,created_at,decided_by,decided_at,history)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,
        decided_at=EXCLUDED.decided_at,history=EXCLUDED.history`, [
      approval.id, approval.operation, approval.entityType, String(approval.entityId), approval.amountIrr,
      approval.status, approval.createdBy, approval.createdAt, approval.decidedBy || null, approval.decidedAt || null, json(approval.history || []),
    ]);
  }
}

async function syncOpeningBalances(client, state) {
  for (const batch of list(state.openingBalanceBatches)) {
    await client.query(`INSERT INTO finance_opening_balance_batches
      (id,branch_id,as_of_date,fiscal_period_id,source_reference,debit_irr,credit_irr,lines,status,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,decided_by,decided_at,posted_by,posted_at,reversed_by,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,fiscal_period_id=EXCLUDED.fiscal_period_id,
        reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,decided_by=EXCLUDED.decided_by,
        decided_at=EXCLUDED.decided_at,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,
        reversed_by=EXCLUDED.reversed_by,reversed_at=EXCLUDED.reversed_at`, [
      batch.id, batch.branchId, batch.asOfDate, batch.fiscalPeriodId, batch.sourceReference,
      batch.debitIrr, batch.creditIrr, json(batch.lines), batch.status, batch.journalEntryId,
      batch.approvalId, batch.reversalJournalEntryId || null, batch.createdBy, iso(batch.createdAt),
      batch.decidedBy || null, batch.decidedAt || null, batch.postedBy || null, batch.postedAt || null,
      batch.reversedBy || null, batch.reversedAt || null,
    ]);
  }
}

async function syncLegacyArchive(client, state) {
  for (const record of list(state.legacyArchive)) {
    const archiveId = uuidOrNull(record.id) || stableUuid(`finance-legacy-archive:${record.sourceTable}:${record.sourceId}`);
    await client.query(`INSERT INTO finance_legacy_archive
      (id,source_table,source_id,trust_status,reason,source_payload,branch_id,amount_irr,occurred_at,classification_details,decision,decision_notes,evidence_reference,decision_history,decided_by,decided_at,archived_by,archived_at,
       reviewed_tenders,backfill_status,backfill_journal_entry_id,backfill_approval_id,backfill_event_id,backfill_requested_by,backfill_requested_at,backfilled_by,backfilled_at,backfill_reversal_journal_entry_id,backfill_reversed_by,backfill_reversed_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
      ON CONFLICT(source_table,source_id) DO UPDATE SET
        decision=EXCLUDED.decision,decision_notes=EXCLUDED.decision_notes,evidence_reference=EXCLUDED.evidence_reference,
        decision_history=EXCLUDED.decision_history,decided_by=EXCLUDED.decided_by,decided_at=EXCLUDED.decided_at,
        reviewed_tenders=EXCLUDED.reviewed_tenders,backfill_status=EXCLUDED.backfill_status,
        backfill_journal_entry_id=EXCLUDED.backfill_journal_entry_id,backfill_approval_id=EXCLUDED.backfill_approval_id,
        backfill_event_id=EXCLUDED.backfill_event_id,backfill_requested_by=EXCLUDED.backfill_requested_by,
        backfill_requested_at=EXCLUDED.backfill_requested_at,backfilled_by=EXCLUDED.backfilled_by,backfilled_at=EXCLUDED.backfilled_at,
        backfill_reversal_journal_entry_id=EXCLUDED.backfill_reversal_journal_entry_id,backfill_reversed_by=EXCLUDED.backfill_reversed_by,backfill_reversed_at=EXCLUDED.backfill_reversed_at`, [
      archiveId, record.sourceTable, String(record.sourceId), record.trustStatus, record.reason,
      json(record.sourcePayload), record.branchId == null ? null : Number(record.branchId), record.amountIrr == null ? null : Number(record.amountIrr),
      record.occurredAt || null, json(record.classificationDetails), record.decision || (record.trustStatus === 'quarantined' ? 'keep_quarantined' : 'pending'),
      record.decisionNotes || null, record.evidenceReference || null, json(record.decisionHistory || []),
      record.decidedBy || null, record.decidedAt || null, record.archivedBy || null, iso(record.archivedAt),
      json(record.reviewedTenders || []), record.backfillStatus || 'not_requested', record.backfillJournalEntryId || null,
      record.backfillApprovalId || null, record.backfillEventId || null, record.backfillRequestedBy || null,
      record.backfillRequestedAt || null, record.backfilledBy || null, record.backfilledAt || null,
      record.backfillReversalJournalEntryId || null, record.backfillReversedBy || null, record.backfillReversedAt || null,
    ]);
  }
}

async function syncProcurement(client, state) {
  for (const po of list(state.purchaseOrders)) {
    await client.query(`INSERT INTO finance_purchase_orders(id,number,branch_id,vendor_id,status,total_irr,lines,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,total_irr=EXCLUDED.total_irr,lines=EXCLUDED.lines`, [
      po.id, po.number, po.branchId, po.vendorId, procurementStatus(po.status), po.totalIrr, json(po.lines), po.createdBy, po.createdAt,
    ]);
  }
  for (const grn of list(state.goodsReceipts)) {
    await client.query(`INSERT INTO finance_goods_receipts(id,number,purchase_order_id,branch_id,received_at,lines,received_by,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(id) DO NOTHING`, [
      grn.id, grn.number, grn.purchaseOrderId, grn.branchId, grn.receivedAt, json(grn.lines), grn.createdBy, `grn:${grn.id}`,
    ]);
  }
  for (const invoice of list(state.vendorInvoices)) {
    await client.query(`INSERT INTO finance_vendor_invoices(id,number,vendor_id,branch_id,purchase_order_id,total_irr,status,match_result,invoice_date,due_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,match_result=EXCLUDED.match_result,total_irr=EXCLUDED.total_irr`, [
      invoice.id, invoice.invoiceNumber, invoice.vendorId, invoice.branchId, invoice.purchaseOrderId, invoice.totalIrr,
      invoiceStatus(invoice.status), json({ matchStatus: invoice.matchStatus, quantityVariance: invoice.quantityVariance, priceVarianceIrr: invoice.priceVarianceIrr, lines: invoice.lines }),
      String(invoice.invoiceDate).slice(0, 10), invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : null,
    ]);
  }
  for (const payment of list(state.supplierPayments)) {
    await client.query(`INSERT INTO finance_vendor_payments(id,invoice_id,amount_irr,status,idempotency_key,created_by,approved_by,created_at,approved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at`, [
      payment.id, payment.vendorInvoiceId, payment.amountIrr, paymentStatus(payment.status), `supplier-payment:${payment.id}`,
      payment.createdBy, payment.approvedBy || null, payment.createdAt, payment.approvedAt || null,
    ]);
  }
}

async function syncCosting(client, state) {
  for (const movement of list(state.inventoryMovements)) {
    await client.query(`INSERT INTO finance_inventory_movements
      (id,branch_id,item_id,movement_type,quantity,unit_cost_irr,total_cost_irr,source_type,source_id,idempotency_key,occurred_at,status,created_by,created_at,history,reversal_of_id,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb) ON CONFLICT(id) DO NOTHING`, [
      movement.id, movement.branchId, String(movement.itemId), movementType(movement.movementType), movement.quantityBase,
      movement.unitCostIrr ?? null, movement.totalCostIrr ?? null, movement.source, String(movement.sourceId),
      `movement:${movement.id}`, movement.occurredAt, 'approved', movement.createdBy || 'system', iso(movement.createdAt || movement.occurredAt), '[]',
      movement.reversalOfId || null, json({ direction: movement.direction || null, reason: movement.reason || null, recipeId: movement.recipeId || null }),
    ]);
  }
  for (const valuation of list(state.inventoryMovementValuations)) {
    await client.query(`INSERT INTO finance_inventory_movement_valuations
      (id,movement_id,unit_cost_irr,total_cost_irr,valuation_source,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(movement_id) DO NOTHING`, [
      valuation.id, valuation.movementId, valuation.unitCostIrr, valuation.totalCostIrr,
      valuation.source, valuation.createdBy || 'system', iso(valuation.createdAt),
    ]);
  }
  for (const batch of list(state.productionBatches)) {
    const financeEvent = list(state.events).find((event) => event.source === 'inventory.production_batch' && String(event.sourceId) === String(batch.id));
    await client.query(`INSERT INTO finance_production_batches
      (id,branch_id,recipe_version_id,recipe_source_id,output_item_id,planned_yield,actual_yield,status,produced_at,created_by,idempotency_key,finance_event_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`, [
      batch.id, batch.branchId, uuidOrNull(batch.recipeVersionId), String(batch.recipeVersionId), batch.outputItemId || null,
      batch.plannedYield, batch.actualYield, batch.status, batch.producedAt || null, batch.createdBy,
      batch.idempotencyKey, financeEvent?.id || null, iso(batch.createdAt),
    ]);
  }
  for (const snapshot of list(state.orderItemCostSnapshots)) {
    await client.query(`INSERT INTO finance_order_item_cost_snapshots
      (id,order_id,order_line_key,branch_id,recipe_version_id,quantity,net_sales_irr,theoretical_cogs_irr,captured_at,calculation_payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(order_id,order_line_key) DO NOTHING`, [
      snapshot.id, Number(snapshot.orderId), snapshot.orderLineKey, snapshot.branchId, uuidOrNull(snapshot.recipeVersionId),
      snapshot.quantity, snapshot.netSalesIrr, snapshot.theoreticalCogsIrr, snapshot.capturedAt,
      json({ recipeVersionId: snapshot.recipeVersionId, recipeVersion: snapshot.recipeVersion, components: snapshot.components }),
    ]);
  }
}

async function syncRecurringCosts(client, state) {
  for (const commitment of list(state.costCommitments)) {
    await client.query(`INSERT INTO finance_cost_commitments
      (id,branch_id,name,commitment_type,frequency,monthly_amount_irr,expense_account_code,liability_account_code,cost_behavior,counterparty_id,starts_on,ends_on,status,notes,created_by,created_at,deactivated_by,deactivated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,deactivated_by=EXCLUDED.deactivated_by,deactivated_at=EXCLUDED.deactivated_at`, [
      commitment.id, commitment.branchId, commitment.name, commitment.type, commitment.frequency,
      commitment.monthlyAmountIrr, commitment.expenseAccount, commitment.liabilityAccount, commitment.behavior,
      commitment.counterpartyId || null, commitment.startDate, commitment.endDate || null, commitment.status,
      commitment.notes || null, commitment.createdBy, iso(commitment.createdAt), commitment.deactivatedBy || null, commitment.deactivatedAt || null,
    ]);
  }
  for (const accrual of list(state.costAccruals)) {
    await client.query(`INSERT INTO finance_cost_accruals
      (id,cost_commitment_id,branch_id,service_month,posting_date,fiscal_period_id,amount_irr,expense_account_code,liability_account_code,override_reason,status,paid_amount_irr,journal_entry_id,approval_id,created_by,created_at,posted_by,posted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,paid_amount_irr=EXCLUDED.paid_amount_irr,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at`, [
      accrual.id, accrual.costCommitmentId, accrual.branchId, `${accrual.serviceMonth}-01`, accrual.postingDate,
      accrual.fiscalPeriodId, accrual.amountIrr, accrual.expenseAccount, accrual.liabilityAccount,
      accrual.overrideReason || null, accrual.status, accrual.paidAmountIrr || 0, accrual.journalEntryId,
      accrual.approvalId, accrual.createdBy, iso(accrual.createdAt), accrual.postedBy || null, accrual.postedAt || null,
    ]);
  }
  for (const payment of list(state.costPayments)) {
    await client.query(`INSERT INTO finance_cost_payments
      (id,cost_accrual_id,branch_id,amount_irr,payment_method,payment_date,reference,status,approval_id,journal_entry_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at`, [
      payment.id, payment.costAccrualId, payment.branchId, payment.amountIrr, payment.paymentMethod,
      payment.paymentDate, payment.reference || null, payment.status, payment.approvalId, payment.journalEntryId || null,
      payment.reversalJournalEntryId || null, payment.createdBy, iso(payment.createdAt), payment.approvedBy || null, payment.approvedAt || null, payment.reversedAt || null,
    ]);
  }
}

async function syncFixedAssets(client, state) {
  for (const asset of list(state.fixedAssets)) {
    await client.query(`INSERT INTO finance_fixed_assets
      (id,branch_id,asset_code,name,category,asset_account_code,funding_method,funding_account_code,source_reference,purchase_date,in_service_date,purchase_cost_irr,salvage_value_irr,useful_life_months,depreciation_method,depreciation_convention,accumulated_depreciation_irr,status,acquisition_journal_entry_id,acquisition_approval_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at,last_depreciation_month,last_depreciation_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,accumulated_depreciation_irr=EXCLUDED.accumulated_depreciation_irr,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at,last_depreciation_month=EXCLUDED.last_depreciation_month,last_depreciation_at=EXCLUDED.last_depreciation_at`, [
      asset.id, asset.branchId, asset.assetCode, asset.name, asset.category, asset.assetAccount,
      asset.fundingMethod, asset.fundingAccount, asset.sourceReference, asset.purchaseDate, asset.inServiceDate,
      asset.purchaseCostIrr, asset.salvageValueIrr || 0, asset.usefulLifeMonths, asset.depreciationMethod,
      asset.depreciationConvention, asset.accumulatedDepreciationIrr || 0, asset.status,
      asset.acquisitionJournalEntryId, asset.acquisitionApprovalId, asset.reversalJournalEntryId || null,
      asset.createdBy, iso(asset.createdAt), asset.approvedBy || null, asset.approvedAt || null,
      asset.reversedAt || null, asset.lastDepreciationMonth ? `${asset.lastDepreciationMonth}-01` : null,
      asset.lastDepreciationAt || null,
    ]);
  }
  for (const run of list(state.depreciationRuns)) {
    await client.query(`INSERT INTO finance_depreciation_runs
      (id,branch_id,service_month,posting_date,fiscal_period_id,method,convention,total_depreciation_irr,status,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,posted_by,posted_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,reversed_at=EXCLUDED.reversed_at`, [
      run.id, run.branchId, `${run.serviceMonth}-01`, run.postingDate, run.fiscalPeriodId,
      run.method, run.convention, run.totalDepreciationIrr, run.status, run.journalEntryId,
      run.approvalId, run.reversalJournalEntryId || null, run.createdBy, iso(run.createdAt),
      run.postedBy || null, run.postedAt || null, run.reversedAt || null,
    ]);
    for (const line of list(run.lines)) {
      await client.query(`INSERT INTO finance_asset_depreciation_lines
        (id,depreciation_run_id,asset_id,service_month,amount_irr,accumulated_before_irr,remaining_before_irr,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status`, [
        line.id, run.id, line.assetId, `${run.serviceMonth}-01`, line.amountIrr,
        line.accumulatedBeforeIrr, line.remainingBeforeIrr, run.status, iso(run.createdAt),
      ]);
    }
  }
}

async function syncPayroll(client, state) {
  for (const run of list(state.payrollRuns)) {
    await client.query(`INSERT INTO finance_payroll_runs
      (id,branch_id,service_month,posting_date,fiscal_period_id,source_reference,headcount,kitchen_gross_irr,service_gross_irr,total_gross_irr,employer_insurance_irr,employee_insurance_irr,total_insurance_irr,payroll_tax_irr,other_deductions_irr,net_pay_irr,total_expense_irr,calculation_policy,status,paid_by_liability,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,posted_by,posted_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,paid_by_liability=EXCLUDED.paid_by_liability,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,reversed_at=EXCLUDED.reversed_at`, [
      run.id, run.branchId, `${run.serviceMonth}-01`, String(run.postingDate).slice(0, 10), run.fiscalPeriodId,
      run.sourceReference, run.headcount, run.kitchenGrossIrr, run.serviceGrossIrr, run.totalGrossIrr,
      run.employerInsuranceIrr, run.employeeInsuranceIrr, run.totalInsuranceIrr, run.payrollTaxIrr,
      run.otherDeductionsIrr, run.netPayIrr, run.totalExpenseIrr, run.calculationPolicy, run.status,
      json(run.paidByLiability), run.journalEntryId, run.approvalId, run.reversalJournalEntryId || null,
      run.createdBy, iso(run.createdAt), run.postedBy || null, run.postedAt || null, run.reversedAt || null,
    ]);
  }
  for (const payment of list(state.payrollPayments)) {
    await client.query(`INSERT INTO finance_payroll_payments
      (id,payroll_run_id,branch_id,liability_type,liability_account_code,amount_irr,payment_method,payment_date,reference,status,approval_id,journal_entry_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at`, [
      payment.id, payment.payrollRunId, payment.branchId, payment.liabilityType, payment.liabilityAccount,
      payment.amountIrr, payment.paymentMethod, String(payment.paymentDate).slice(0, 10), payment.reference || null,
      payment.status, payment.approvalId, payment.journalEntryId || null, payment.reversalJournalEntryId || null,
      payment.createdBy, iso(payment.createdAt), payment.approvedBy || null, payment.approvedAt || null, payment.reversedAt || null,
    ]);
  }
}

async function syncReconciliation(client, state) {
  for (const item of list(state.reconciliationItems)) {
    await client.query(`INSERT INTO reconciliation_items
      (id,kind,branch_id,order_id,payment_id,cash_session_id,bank_reference,settlement_reference,psp,terminal_id,batch_no,journal_entry_id,amount_irr,status,matched_at,matched_by,details,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,matched_at=EXCLUDED.matched_at,matched_by=EXCLUDED.matched_by,details=EXCLUDED.details`, [
      item.id, item.kind, item.branchId, item.orderId == null ? null : Number(item.orderId), item.paymentId || null,
      item.cashSessionId || null, item.bankReference || null, item.settlementReference || null, item.psp || null,
      item.terminalId || null, item.batchNo || null, item.journalEntryId || null, item.amountIrr, item.status,
      item.matchedAt || null, item.matchedBy || null, json(item.details || {}), iso(item.createdAt),
    ]);
  }
}

async function syncFinanceState(client, financeState, { checkSchema = true } = {}) {
  const state = financeState || {};
  if (checkSchema && !(await normalizedSchemaAvailable(client))) return { available: false, reason: 'finance_schema_missing' };
  await syncPeriods(client, state);
  await syncPaymentsAndRefunds(client, state);
  await syncEvents(client, state);
  await syncJournals(client, state);
  await syncApprovals(client, state);
  await syncOpeningBalances(client, state);
  await syncLegacyArchive(client, state);
  await syncProcurement(client, state);
  await syncRecurringCosts(client, state);
  await syncFixedAssets(client, state);
  await syncPayroll(client, state);
  await syncCosting(client, state);
  await syncReconciliation(client, state);
  return {
    available: true,
    counts: {
      events: list(state.events).length, journals: list(state.journalEntries).length,
      payments: list(state.payments).length, refunds: list(state.refunds).length,
      purchaseOrders: list(state.purchaseOrders).length, inventoryMovements: list(state.inventoryMovements).length,
      movementValuations: list(state.inventoryMovementValuations).length,
      productionBatches: list(state.productionBatches).length, costSnapshots: list(state.orderItemCostSnapshots).length,
      costCommitments: list(state.costCommitments).length, costAccruals: list(state.costAccruals).length,
      fixedAssets: list(state.fixedAssets).length, depreciationRuns: list(state.depreciationRuns).length,
      payrollRuns: list(state.payrollRuns).length, payrollPayments: list(state.payrollPayments).length,
      openingBalanceBatches: list(state.openingBalanceBatches).length,
      legacyArchive: list(state.legacyArchive).length,
    },
  };
}

module.exports = { normalizedSchemaAvailable, syncFinanceState };

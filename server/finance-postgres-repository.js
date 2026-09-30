'use strict';

const { stableUuid } = require('./finance/legacy-classifier');

function list(value) { return Array.isArray(value) ? value : []; }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value == null ? null : value);
}
function sameJson(left, right) { return canonicalJson(left) === canonicalJson(right); }
function iso(value) { return value || new Date().toISOString(); }

function assertImmutableSyncResult(result, entity, sourceId) {
  if (result?.rowCount !== 0) return;
  const error = new Error(`finance_${entity}_immutable_conflict:${sourceId}`);
  error.code = 'postgres_finance_immutable_conflict';
  error.entity = entity;
  error.sourceId = String(sourceId);
  throw error;
}

function uuidOrNull(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null; }
// Legacy JSON snapshots predate the normalized schema and commonly use
// human-readable keys (for example `foundation-2026-08-31`).  PostgreSQL
// UUID columns must still receive stable values so re-running the import is
// idempotent.  Preserve already-valid UUIDs and deterministically derive the
// rest without mutating the source snapshot.
function uuidOrStable(value, namespace) {
  if (value == null || String(value) === '') return null;
  return uuidOrNull(value) || stableUuid(`${namespace}:${String(value)}`);
}
function procurementStatus(status) {
  return ({ pending_approval: 'draft', rejected: 'cancelled' })[status] || status;
}
function invoiceStatus(status) {
  return ({ open: 'matched', match_exception: 'exception', match_rejected: 'cancelled' })[status] || status;
}
function paymentStatus(status) {
  return ({ paid: 'succeeded', rejected: 'cancelled' })[status] || status;
}
function movementType(value) {
  return ({ goods_receipt: 'receipt', sale_consumption: 'consume' })[value] || value;
}
function unitCode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, '_');
  return ({
    gram: 'g', grams: 'g', گرم: 'g', kilogram: 'kg', kilograms: 'kg', کیلوگرم: 'kg', کیلو: 'kg',
    milliliter: 'ml', milliliters: 'ml', میلی_لیتر: 'ml', liter: 'l', liters: 'l', لیتر: 'l',
    pcs: 'count', piece: 'count', pieces: 'count', عدد: 'count', each: 'count',
  })[normalized] || normalized;
}

function cashAmountIrr(value, label, { allowNegative = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || (!allowNegative && amount < 0)) {
    const error = new Error(`finance_cash_session_${label}_invalid`);
    error.code = `finance_cash_session_${label}_invalid`;
    throw error;
  }
  const irr = amount * 10;
  if (!Number.isSafeInteger(irr)) {
    const error = new Error(`finance_cash_session_${label}_unsafe`);
    error.code = `finance_cash_session_${label}_unsafe`;
    throw error;
  }
  return irr;
}

function cashTimestamp(value, label) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) {
    const error = new Error(`finance_cash_session_${label}_invalid`);
    error.code = `finance_cash_session_${label}_invalid`;
    throw error;
  }
  return date.toISOString();
}

async function normalizedSchemaAvailable(client) {
  const result = await client.query(`SELECT
    to_regclass('public.finance_events') AS finance_events,
    to_regclass('public.finance_payments') AS finance_payments,
    to_regclass('public.finance_refunds') AS finance_refunds,
    to_regclass('public.finance_inventory_movements') AS inventory_movements,
    to_regclass('public.finance_purchase_orders') AS purchase_orders,
    to_regclass('public.finance_goods_receipts') AS goods_receipts,
    to_regclass('public.finance_cost_accruals') AS cost_accruals,
    to_regclass('public.finance_cost_payments') AS cost_payments,
    to_regclass('public.finance_depreciation_runs') AS depreciation_runs,
    to_regclass('public.finance_asset_depreciation_lines') AS depreciation_lines,
    to_regclass('public.journal_entries_v2') AS journal_entries,
    to_regclass('public.journal_lines_v2') AS journal_lines,
    to_regclass('public.finance_approvals') AS approvals,
    to_regclass('public.reconciliation_items') AS reconciliation_items,
    to_regclass('public.finance_outbox') AS outbox,
    to_regclass('public.finance_order_item_cost_snapshots') AS cost_snapshots,
    to_regclass('public.finance_inventory_movement_valuations') AS movement_valuations,
    to_regclass('public.finance_production_batches') AS production_batches,
    to_regclass('public.finance_inventory_items_v2') AS inventory_items,
    to_regclass('public.finance_inventory_balances') AS inventory_balances,
    to_regclass('public.finance_item_unit_conversions') AS item_unit_conversions,
    to_regclass('public.finance_cash_sessions') AS cash_sessions,
    to_regclass('public.finance_recipe_versions') AS recipe_versions,
    to_regclass('public.finance_recipe_ingredients') AS recipe_ingredients,
    to_regclass('public.finance_cost_commitments') AS cost_commitments,
    to_regclass('public.finance_fixed_assets') AS fixed_assets,
    to_regclass('public.finance_payroll_runs') AS payroll_runs,
    to_regclass('public.finance_opening_balance_batches') AS opening_balances,
    to_regclass('public.finance_branch_rollouts') AS branch_rollouts,
    to_regclass('public.finance_migration_baselines') AS migration_baselines,
    to_regclass('public.finance_schema_migrations') AS schema_migrations,
    to_regclass('public.finance_idempotency_requests') AS idempotency_requests,
    to_regclass('public.finance_legacy_archive') AS legacy_archive,
    to_regclass('public.finance_vendor_invoices') AS vendor_invoices,
    to_regclass('public.finance_vendor_payments') AS vendor_payments,
    (SELECT COUNT(*) = 4 FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_vendor_invoices'
      AND column_name IN ('journal_entry_id','reversal_journal_entry_id','reversed_by','reversed_at')) AS vendor_invoice_reversals,
    (SELECT COUNT(*) = 4 FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_vendor_payments'
      AND column_name IN ('journal_entry_id','reversal_journal_entry_id','reversed_by','reversed_at')) AS vendor_payment_reversals,
    (SELECT COUNT(*) = 11 FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_recipe_versions'
      AND column_name IN ('menu_item_name','name','output_item_id','approval_id','approved_by','approved_at','rejected_by','rejected_at','retired_by','retired_at','history')) AS recipe_workflow,
    (SELECT COUNT(*) = 12 FROM information_schema.columns WHERE table_schema='public' AND table_name='finance_legacy_archive'
      AND column_name IN ('reviewed_tenders','backfill_status','backfill_journal_entry_id','backfill_approval_id','backfill_event_id','backfill_requested_by','backfill_requested_at','backfilled_by','backfilled_at','backfill_reversal_journal_entry_id','backfill_reversed_by','backfill_reversed_at')) AS legacy_backfill,
    EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname='finance_payments_order_branch_fkey'
         AND c.contype='f'
         AND c.conrelid=to_regclass('public.finance_payments')
         AND c.confrelid=to_regclass('public.unified_orders')
         AND c.convalidated AND c.condeferrable AND c.condeferred
         AND c.conkey=ARRAY[
           (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='order_id' AND NOT attisdropped),
           (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='branch_id' AND NOT attisdropped)
         ]::smallint[]
         AND c.confkey=ARRAY[
           (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id' AND NOT attisdropped),
           (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='branch_id' AND NOT attisdropped)
         ]::smallint[]
    ) AS payment_branch_scope,
    EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
       WHERE t.tgrelid=to_regclass('public.finance_refunds')
         AND t.tgname='finance_refund_total_guard'
         AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
         AND p.proname='finance_validate_refund_total'
    ) AS refund_total_guard,
    EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid=to_regclass('public.finance_payments')
         AND c.contype IN ('p','u') AND c.convalidated
         AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='idempotency_key' AND NOT attisdropped)]::smallint[]
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='idempotency_key' AND a.attnotnull AND NOT a.attisdropped)
    ) AS payment_idempotency_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid=to_regclass('public.finance_refunds')
         AND c.contype IN ('p','u') AND c.convalidated
         AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='idempotency_key' AND NOT attisdropped)]::smallint[]
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='idempotency_key' AND a.attnotnull AND NOT a.attisdropped)
    ) AS refund_idempotency_unique,
    EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
       WHERE t.tgrelid=to_regclass('public.finance_idempotency_requests')
         AND t.tgname='finance_idempotency_request_immutable_trigger'
         AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
         AND p.proname='finance_idempotency_request_immutable_guard'
    ) AS idempotency_immutable`);
  const row = result.rows?.[0] || {};
  const requiredRelations = [
    'finance_events', 'finance_payments', 'finance_refunds', 'inventory_movements', 'purchase_orders', 'goods_receipts',
    'cost_accruals', 'cost_payments', 'depreciation_runs', 'depreciation_lines', 'journal_entries', 'journal_lines',
    'approvals', 'reconciliation_items', 'outbox', 'cost_snapshots', 'movement_valuations', 'production_batches',
    'inventory_items', 'inventory_balances', 'item_unit_conversions', 'cash_sessions', 'recipe_versions', 'recipe_ingredients', 'cost_commitments', 'fixed_assets', 'payroll_runs',
    'opening_balances', 'branch_rollouts', 'migration_baselines', 'schema_migrations', 'idempotency_requests',
    'legacy_archive', 'vendor_invoices', 'vendor_payments',
  ];
  return requiredRelations.every((relation) => Boolean(row[relation]))
    && Boolean(row.recipe_workflow && row.vendor_invoice_reversals && row.vendor_payment_reversals && row.legacy_backfill
      && row.payment_branch_scope && row.refund_total_guard && row.payment_idempotency_unique
      && row.refund_idempotency_unique && row.idempotency_immutable);
}

async function syncInventoryAndRecipes(client, state, operationalState) {
  const inventoryItems = list(operationalState?.accounting?.inventoryItems);
  const branchCatalog = list(operationalState?.branches)
    .map((branch) => Number(branch?.id))
    .filter((branchId) => Number.isSafeInteger(branchId) && branchId > 0);
  const knownBranches = new Set(branchCatalog);
  const defaultBranchId = branchCatalog.length === 1 ? branchCatalog[0] : null;
  const quarantine = { inventoryItems: [], recipeVersions: [] };
  const validInventoryIds = new Set();
  const approvalsById = new Map(list(state.approvals).map((approval) => [String(approval.id), approval]));
  const resolveBranch = (rawBranchId) => {
    if (!Array.isArray(operationalState?.branches)) return rawBranchId == null ? null : Number(rawBranchId);
    if (rawBranchId == null || rawBranchId === '') return defaultBranchId;
    const branchId = Number(rawBranchId);
    return knownBranches.has(branchId) ? branchId : null;
  };

  for (const item of inventoryItems) {
    const branchId = resolveBranch(item.branchId);
    if (branchId == null) {
      quarantine.inventoryItems.push({ id: String(item.id), branchId: item.branchId ?? null, reason: 'branch_not_in_operational_catalog' });
      continue;
    }
    const baseUnit = unitCode(item.unit || item.baseUnit);
    if (!['g', 'kg', 'ml', 'l', 'count'].includes(baseUnit)) {
      const error = new Error(`finance_inventory_unit_unsupported:${item.id}:${baseUnit || 'missing'}`);
      error.code = 'finance_inventory_unit_unsupported';
      throw error;
    }
    await client.query(`INSERT INTO finance_inventory_items_v2
      (id,branch_id,sku,name,base_unit_code,costing_method,reorder_point_base,safety_stock_base,lead_time_days,active,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,reorder_point_base=EXCLUDED.reorder_point_base,
        safety_stock_base=EXCLUDED.safety_stock_base,lead_time_days=EXCLUDED.lead_time_days,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at`, [
      String(item.id), branchId, String(item.sku || item.id), item.name || String(item.id), baseUnit,
      item.costingMethod === 'fifo' ? 'fifo' : 'weighted_average', Number(item.minStock ?? item.reorderPoint ?? 0),
      Number(item.safetyStock ?? item.safetyStockQuantity ?? 0), item.leadTimeDays == null ? null : Number(item.leadTimeDays),
      item.active !== false, iso(item.createdAt), iso(item.updatedAt),
    ]);
    const quantities = {
      onHand: Number(item.qtyOnHand ?? item.quantityOnHand ?? 0),
      reserved: Number(item.reservedQty ?? item.reservedQuantity ?? 0),
      quarantined: Number(item.quarantinedQty ?? item.quarantinedQuantity ?? 0),
    };
    if (Object.values(quantities).some((quantity) => !Number.isFinite(quantity) || quantity < 0)
      || quantities.reserved + quantities.quarantined > quantities.onHand) {
      const error = new Error(`finance_inventory_balance_invalid:${item.id}`);
      error.code = 'finance_inventory_balance_invalid';
      throw error;
    }
    await client.query(`INSERT INTO finance_inventory_balances
      (branch_id,item_id,on_hand_base,reserved_base,quarantined_base,updated_at)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(branch_id,item_id) DO UPDATE SET on_hand_base=EXCLUDED.on_hand_base,
        reserved_base=EXCLUDED.reserved_base,quarantined_base=EXCLUDED.quarantined_base,updated_at=EXCLUDED.updated_at`, [
      branchId, String(item.id), quantities.onHand, quantities.reserved, quantities.quarantined, iso(item.updatedAt),
    ]);
    for (const conversion of list(item.conversions)) {
      const fromUnit = unitCode(conversion.fromUnit || conversion.unit);
      const toUnit = unitCode(conversion.toUnit || conversion.baseUnit);
      const multiplier = Number(conversion.multiplier ?? conversion.factor);
      if (!['g', 'kg', 'ml', 'l', 'count'].includes(fromUnit)
        || !['g', 'kg', 'ml', 'l', 'count'].includes(toUnit)
        || fromUnit === toUnit || !Number.isFinite(multiplier) || multiplier <= 0) {
        const error = new Error(`finance_inventory_conversion_invalid:${item.id}`);
        error.code = 'finance_inventory_conversion_invalid';
        throw error;
      }
      await client.query(`INSERT INTO finance_item_unit_conversions
        (item_id,from_unit_code,to_unit_code,multiplier,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(item_id,from_unit_code,to_unit_code) DO UPDATE SET multiplier=EXCLUDED.multiplier`, [
        String(item.id), fromUnit, toUnit, multiplier, item.updatedBy || item.createdBy || 'legacy-import', iso(item.updatedAt),
      ]);
    }
    validInventoryIds.add(String(item.id));
  }

  for (const recipe of list(state.recipeVersions)) {
    const branchId = resolveBranch(recipe.branchId);
    if (branchId == null) {
      quarantine.recipeVersions.push({ id: String(recipe.id), branchId: recipe.branchId ?? null, reason: 'branch_not_in_operational_catalog' });
      continue;
    }
    const missingIngredient = list(recipe.ingredients).find((ingredient) => !validInventoryIds.has(String(ingredient.itemId)));
    const outputItemMissing = recipe.outputItemId != null && !validInventoryIds.has(String(recipe.outputItemId));
    const approval = recipe.approvalId == null ? null : approvalsById.get(String(recipe.approvalId));
    // A reference alone is not approval evidence. It must point at the
    // recipe's own workflow request and that request must already be decided
    // approved; otherwise keep the normalized row pending and quarantine it.
    const approvalMatchesRecipe = approval
      && approval.entityType === 'recipe_version'
      && String(approval.entityId) === String(recipe.id)
      && approval.operation === 'approve_recipe_version'
      && approval.status === 'approved';
    const approvalUuid = approvalMatchesRecipe
      ? uuidOrStable(recipe.approvalId, 'finance-approval') : null;
    if (missingIngredient || outputItemMissing) {
      quarantine.recipeVersions.push({
        id: String(recipe.id), branchId, reason: missingIngredient ? 'ingredient_item_not_in_inventory_catalog' : 'output_item_not_in_inventory_catalog',
      });
      continue;
    }
    let finalStatus = recipe.status || 'pending_approval';
    // A legacy "approved" flag without a separate approver/timestamp is not
    // sufficient evidence for the normalized workflow. Keep it pending and
    // expose the row in quarantine for an explicit re-approval.
    if (['approved', 'retired'].includes(finalStatus) && (!recipe.approvedBy || !recipe.approvedAt || !approvalUuid)) {
      finalStatus = 'pending_approval';
      quarantine.recipeVersions.push({
        id: String(recipe.id), branchId,
        reason: recipe.approvalId && !approvalUuid ? 'approval_reference_missing' : 'approval_audit_missing',
      });
    }
    const recipeUuid = uuidOrStable(recipe.id, 'finance-recipe-version');
    await client.query(`INSERT INTO finance_recipe_versions
      (id,recipe_id,menu_item_id,menu_item_name,name,version,branch_id,yield_quantity,effective_from,effective_to,ingredients,output_item_id,status,approval_id,created_by,created_at,approved_by,approved_at,rejected_by,rejected_at,retired_by,retired_at,history)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10::jsonb,$11,'pending_approval',$12,$13,$14,NULL,NULL,NULL,NULL,NULL,NULL,$15::jsonb)
      ON CONFLICT(id) DO NOTHING`, [
      recipeUuid, String(recipe.recipeId ?? recipe.id ?? recipe.menuItemId), String(recipe.menuItemId ?? recipe.recipeId ?? recipe.id), recipe.menuItemName || null, recipe.name || null,
      Number(recipe.version || 1), branchId, Number(recipe.yieldQuantity || recipe.portions || 1), recipe.effectiveFrom || recipe.createdAt || new Date().toISOString(), json(recipe.ingredients || []),
      recipe.outputItemId || null, approvalUuid, recipe.createdBy || 'legacy-import', iso(recipe.createdAt), json(recipe.history || []),
    ]);
    for (const [ingredientIndex, ingredient] of list(recipe.ingredients).entries()) {
      const ingredientUuid = uuidOrStable(
        ingredient.id ?? `${ingredient.itemId || 'item'}:${ingredient.lineNo || ingredientIndex + 1}`,
        `finance-recipe-ingredient:${recipeUuid}`,
      );
      await client.query(`INSERT INTO finance_recipe_ingredients
        (id,recipe_version_id,line_no,item_id,quantity,unit_code,quantity_basis,yield_percent)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM finance_recipe_ingredients WHERE id=$1)
        ON CONFLICT(id) DO NOTHING`, [
        ingredientUuid, recipeUuid, ingredient.lineNo || ingredientIndex + 1, String(ingredient.itemId), ingredient.quantity,
        unitCode(ingredient.unit), ingredient.quantityBasis || 'raw', ingredient.yieldPercent ?? 100,
      ]);
    }
    if (['approved', 'retired'].includes(finalStatus)) {
      await client.query(`UPDATE finance_recipe_versions SET status='approved',approved_by=$2,approved_at=$3,history=$4::jsonb
        WHERE id=$1 AND status IN ('draft','pending_approval')`, [recipeUuid, recipe.approvedBy, recipe.approvedAt, json(recipe.history || [])]);
    }
    if (finalStatus === 'retired') {
      await client.query(`UPDATE finance_recipe_versions SET status='retired',effective_to=$2,retired_by=$3,retired_at=$4,history=$5::jsonb
        WHERE id=$1 AND status='approved'`, [recipeUuid, recipe.effectiveTo, recipe.retiredBy, recipe.retiredAt, json(recipe.history || [])]);
    } else if (finalStatus === 'rejected') {
      await client.query(`UPDATE finance_recipe_versions SET status='rejected',rejected_by=$2,rejected_at=$3,history=$4::jsonb
        WHERE id=$1 AND status IN ('draft','pending_approval')`, [recipeUuid, recipe.rejectedBy, recipe.rejectedAt, json(recipe.history || [])]);
    }
  }
  return quarantine;
}

async function syncIdempotencyRequests(client, state) {
  for (const [key, request] of Object.entries(state.idempotencyRequests || {})) {
    const outcome = state.idempotency?.[key];
    if (!outcome?.kind || outcome.id == null) continue;
    const inserted = await client.query(`INSERT INTO finance_idempotency_requests
      (idempotency_key,operation,request_sha256,outcome_kind,outcome_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING idempotency_key`, [
      key, request.kind, request.fingerprint, outcome.kind, String(outcome.id), request.at || outcome.at || new Date().toISOString(),
    ]);
    if (inserted.rowCount === 1) continue;
    const existing = await client.query(`SELECT operation,request_sha256,outcome_kind,outcome_id
      FROM finance_idempotency_requests WHERE idempotency_key=$1`, [key]);
    const row = existing.rows?.[0];
    if (!row || row.operation !== request.kind || row.request_sha256 !== request.fingerprint
      || row.outcome_kind !== outcome.kind || row.outcome_id !== String(outcome.id)) {
      const error = new Error('postgres_finance_idempotency_conflict');
      error.code = 'postgres_finance_idempotency_conflict';
      throw error;
    }
  }
}

async function fiscalPeriodBranchScopeAvailable(client) {
  const result = await client.query(`SELECT COUNT(*)::int AS count
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='fiscal_periods_v2' AND column_name='branch_id'`);
  return Number(result.rows?.[0]?.count || 0) > 0;
}

async function syncPeriods(client, state) {
  // Migration 019 is additive and may be pending during a rolling deploy. Do
  // not make the pre-019 schema unusable; use the legacy global-period shape
  // until the branch column is actually present.
  const hasBranchScope = await fiscalPeriodBranchScopeAvailable(client);
  for (const period of list(state.fiscalPeriods)) {
    const periodUuid = uuidOrStable(period.id, 'finance-period');
    const columns = hasBranchScope
      ? '(id,name,starts_on,ends_on,status,closed_by,closed_at,reopened_by,reopened_at,branch_id)'
      : '(id,name,starts_on,ends_on,status,closed_by,closed_at,reopened_by,reopened_at)';
    const placeholders = hasBranchScope ? '$1,$2,$3,$4,$5,$6,$7,$8,$9,$10' : '$1,$2,$3,$4,$5,$6,$7,$8,$9';
    const branchUpdate = hasBranchScope ? ', branch_id=EXCLUDED.branch_id' : '';
    const values = [
      periodUuid, period.name || period.id, period.startDate, period.endDate, period.status,
      period.closedBy || null, period.closedAt || null, period.reopenedBy || null, period.reopenedAt || null,
    ];
    if (hasBranchScope) values.push(period.branchId == null || period.branchId === '' ? null : Number(period.branchId));
    await client.query(`INSERT INTO fiscal_periods_v2
      ${columns}
      VALUES(${placeholders})
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on,
        status=EXCLUDED.status, closed_by=EXCLUDED.closed_by, closed_at=EXCLUDED.closed_at,
        reopened_by=EXCLUDED.reopened_by, reopened_at=EXCLUDED.reopened_at${branchUpdate}`, values);
  }
}

async function syncCashSessions(client, operationalState) {
  for (const session of list(operationalState?.cashSessions)) {
    const branchId = Number(session.branchId);
    if (!Number.isSafeInteger(branchId) || branchId <= 0) {
      const error = new Error(`finance_cash_session_branch_invalid:${session.id}`);
      error.code = 'finance_cash_session_branch_invalid';
      throw error;
    }
    const cashierId = String(session.cashierId || session.cashierPhone || session.phone || session.openedBy || '').trim();
    if (!cashierId) {
      const error = new Error(`finance_cash_session_cashier_missing:${session.id}`);
      error.code = 'finance_cash_session_cashier_missing';
      throw error;
    }
    const movements = list(session.movements);
    const openingAmountIrr = cashAmountIrr(session.openingAmountIrr ?? session.openingAmount, 'opening_amount');
    if (openingAmountIrr == null) {
      const error = new Error(`finance_cash_session_opening_amount_required:${session.id}`);
      error.code = 'finance_cash_session_opening_amount_required';
      throw error;
    }
    const movementAmountToman = movements.reduce((sum, movement) => {
      const amount = Number(movement?.amount || 0);
      if (!Number.isSafeInteger(amount)) {
        const error = new Error(`finance_cash_session_movement_amount_invalid:${session.id}`);
        error.code = 'finance_cash_session_movement_amount_invalid';
        throw error;
      }
      return sum + amount;
    }, 0);
    if (!Number.isSafeInteger(movementAmountToman)) {
      const error = new Error(`finance_cash_session_expected_amount_unsafe:${session.id}`);
      error.code = 'finance_cash_session_expected_amount_unsafe';
      throw error;
    }
    const expectedAmountIrr = cashAmountIrr(
      session.expectedAmountIrr ?? session.expectedAmount ?? (Number(session.openingAmount || 0) + movementAmountToman),
      'expected_amount',
    );
    const countedAmountIrr = cashAmountIrr(session.countedAmountIrr ?? session.countedAmount, 'counted_amount');
    const varianceIrr = cashAmountIrr(session.varianceIrr ?? session.variance, 'variance', { allowNegative: true });
    const closedAt = session.closedAt ? cashTimestamp(session.closedAt, 'closed_at') : null;
    if (closedAt && countedAmountIrr == null) {
      const error = new Error(`finance_cash_session_count_required:${session.id}`);
      error.code = 'finance_cash_session_count_required';
      throw error;
    }
    await client.query(`INSERT INTO finance_cash_sessions
      (id,legacy_session_id,branch_id,cashier_id,terminal_id,opening_amount_irr,counted_amount_irr,expected_amount_irr,variance_irr,opened_at,closed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(id) DO UPDATE SET branch_id=EXCLUDED.branch_id,cashier_id=EXCLUDED.cashier_id,terminal_id=EXCLUDED.terminal_id,
        opening_amount_irr=EXCLUDED.opening_amount_irr,counted_amount_irr=EXCLUDED.counted_amount_irr,
        expected_amount_irr=EXCLUDED.expected_amount_irr,variance_irr=EXCLUDED.variance_irr,
        opened_at=EXCLUDED.opened_at,closed_at=EXCLUDED.closed_at`, [
      uuidOrStable(session.id, 'finance-cash-session'), String(session.id), branchId, cashierId,
      session.terminalId == null ? null : String(session.terminalId), openingAmountIrr,
      countedAmountIrr, expectedAmountIrr, varianceIrr, cashTimestamp(session.openedAt, 'opened_at'), closedAt,
    ]);
  }
}

async function syncOperationalOrders(client, operationalState) {
  if (!operationalState?.orders || !Array.isArray(operationalState.orders)) return;
  const check = await client.query("SELECT to_regclass('public.unified_orders') AS tbl");
  if (!check.rows[0]?.tbl) return;

  for (const order of operationalState.orders) {
    if (!order || order.id == null) continue;
    const orderId = Number(order.id);
    if (!Number.isSafeInteger(orderId)) continue;
    const phone = String(order.phone || '').trim() || null;
    if (phone) {
      const custCheck = await client.query("SELECT to_regclass('public.unified_customers') AS tbl");
      if (custCheck.rows[0]?.tbl) {
        await client.query(`
          INSERT INTO unified_customers (phone, name, points, first_seen_at, last_seen_at, data)
          VALUES ($1, $2, 0, now(), now(), '{}'::jsonb)
          ON CONFLICT (phone) DO NOTHING
        `, [phone, order.name || 'مشتری']);
      }
    }
    const branchId = Number(order.branchId);
    const resolvedBranchId = Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
    await client.query(`
      INSERT INTO unified_orders (id, order_no, branch_id, customer_phone, table_no, fulfillment, payment_method, payment_status, status, total, created_at, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        order_no = EXCLUDED.order_no,
        branch_id = EXCLUDED.branch_id,
        customer_phone = EXCLUDED.customer_phone,
        table_no = EXCLUDED.table_no,
        fulfillment = EXCLUDED.fulfillment,
        payment_method = EXCLUDED.payment_method,
        payment_status = EXCLUDED.payment_status,
        status = EXCLUDED.status,
        total = EXCLUDED.total,
        data = EXCLUDED.data
    `, [
      orderId,
      order.orderNo || `WSTO-${orderId}`,
      resolvedBranchId,
      phone,
      order.tableNo || null,
      order.fulfillment || null,
      order.paymentMethod || null,
      order.paymentStatus || null,
      order.status || 'unknown',
      Math.max(0, Number(order.total) || 0),
      order.createdAt || new Date().toISOString(),
      JSON.stringify(order),
    ]);
  }
}

async function syncEvents(client, state) {
  for (const event of list(state.events)) {
    const eventUuid = uuidOrStable(event.id, 'finance-event');
    const result = await client.query(`INSERT INTO finance_events
      (id,source,source_id,source_version,idempotency_key,branch_id,occurred_at,amount_irr,payload,status,error,processed_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,payload=EXCLUDED.payload,
        processed_at=EXCLUDED.processed_at
      WHERE finance_events.source IS NOT DISTINCT FROM EXCLUDED.source
        AND finance_events.source_id IS NOT DISTINCT FROM EXCLUDED.source_id
        AND finance_events.source_version IS NOT DISTINCT FROM EXCLUDED.source_version
        AND finance_events.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
        AND finance_events.branch_id IS NOT DISTINCT FROM EXCLUDED.branch_id
        AND finance_events.occurred_at IS NOT DISTINCT FROM EXCLUDED.occurred_at
        AND finance_events.amount_irr IS NOT DISTINCT FROM EXCLUDED.amount_irr
        AND finance_events.payload <@ EXCLUDED.payload
      RETURNING id`, [
      eventUuid, event.source, String(event.sourceId), event.sourceVersion || 1, event.idempotencyKey,
      event.branchId, event.occurredAt, event.amountIrr || 0, json(event.payload), event.status,
      event.error ? json(event.error) : null, event.processedAt || null, iso(event.createdAt),
    ]);
    assertImmutableSyncResult(result, 'event', event.id);
    const outboxResult = await client.query(`INSERT INTO finance_outbox
      (id,aggregate_type,aggregate_id,event_type,idempotency_key,payload,occurred_at,published_at,attempts,last_error)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
      ON CONFLICT(idempotency_key) DO UPDATE SET payload=EXCLUDED.payload,published_at=EXCLUDED.published_at,
        attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error
      WHERE finance_outbox.aggregate_type IS NOT DISTINCT FROM EXCLUDED.aggregate_type
        AND finance_outbox.aggregate_id IS NOT DISTINCT FROM EXCLUDED.aggregate_id
        AND finance_outbox.event_type IS NOT DISTINCT FROM EXCLUDED.event_type
        AND finance_outbox.id IS NOT DISTINCT FROM EXCLUDED.id
        AND finance_outbox.payload <@ EXCLUDED.payload
        AND finance_outbox.occurred_at IS NOT DISTINCT FROM EXCLUDED.occurred_at
      RETURNING id`, [
      eventUuid, event.source.split('.')[0] || 'finance', String(event.sourceId), event.source,
      `outbox:${event.idempotencyKey}`, json({ financeEventId: eventUuid, ...event.payload }), event.occurredAt,
      event.status === 'posted' ? (event.processedAt || event.createdAt) : null, event.error ? 1 : 0, event.error?.message || null,
    ]);
    assertImmutableSyncResult(outboxResult, 'outbox', event.id);
  }
}

async function syncPaymentsAndRefunds(client, state) {
  for (const payment of list(state.payments)) {
    const paymentUuid = uuidOrStable(payment.id, 'finance-payment');
    const result = await client.query(`INSERT INTO finance_payments
      (id,order_id,branch_id,tender,amount_irr,status,provider,provider_reference,idempotency_key,paid_at,payload,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload
      WHERE finance_payments.order_id IS NOT DISTINCT FROM EXCLUDED.order_id
        AND finance_payments.branch_id IS NOT DISTINCT FROM EXCLUDED.branch_id
        AND finance_payments.tender IS NOT DISTINCT FROM EXCLUDED.tender
        AND finance_payments.amount_irr IS NOT DISTINCT FROM EXCLUDED.amount_irr
        AND finance_payments.provider IS NOT DISTINCT FROM EXCLUDED.provider
        AND finance_payments.provider_reference IS NOT DISTINCT FROM EXCLUDED.provider_reference
        AND finance_payments.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
        AND finance_payments.paid_at IS NOT DISTINCT FROM EXCLUDED.paid_at
        AND finance_payments.payload->>'operationalPaymentId' IS NOT DISTINCT FROM EXCLUDED.payload->>'operationalPaymentId'
        AND finance_payments.payload->>'orderNo' IS NOT DISTINCT FROM EXCLUDED.payload->>'orderNo'
        AND finance_payments.payload->>'cashSessionId' IS NOT DISTINCT FROM EXCLUDED.payload->>'cashSessionId'
        AND finance_payments.payload->>'receiptFinanceEventId' IS NOT DISTINCT FROM EXCLUDED.payload->>'receiptFinanceEventId'
        AND finance_payments.payload->>'receiptJournalEntryId' IS NOT DISTINCT FROM EXCLUDED.payload->>'receiptJournalEntryId'
      RETURNING id`, [
      paymentUuid, Number(payment.orderId), payment.branchId, payment.tender, payment.amountIrr, payment.status,
      payment.provider || null, payment.providerReference || null, payment.idempotencyKey, payment.paidAt || null,
      json({ ...(payment.payload || {}), refundedIrr: payment.refundedIrr || 0 }), iso(payment.createdAt),
    ]);
    assertImmutableSyncResult(result, 'payment', payment.id);
  }
  for (const refund of list(state.refunds)) {
    const refundUuid = uuidOrStable(refund.id, 'finance-refund');
    const paymentUuid = uuidOrStable(refund.paymentId, 'finance-payment');
    const result = await client.query(`INSERT INTO finance_refunds
      (id,payment_id,amount_irr,reason,status,idempotency_key,approved_by,approved_at,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at
      WHERE finance_refunds.payment_id IS NOT DISTINCT FROM EXCLUDED.payment_id
        AND finance_refunds.amount_irr IS NOT DISTINCT FROM EXCLUDED.amount_irr
        AND finance_refunds.reason IS NOT DISTINCT FROM EXCLUDED.reason
        AND finance_refunds.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
        AND finance_refunds.created_by IS NOT DISTINCT FROM EXCLUDED.created_by
        AND (
          finance_refunds.status IS NOT DISTINCT FROM EXCLUDED.status
          OR (finance_refunds.status='pending_approval' AND EXCLUDED.status IN ('approved','cancelled'))
          OR (finance_refunds.status='approved' AND EXCLUDED.status IN ('processing','succeeded','failed','cancelled'))
          OR (finance_refunds.status='processing' AND EXCLUDED.status IN ('succeeded','failed','cancelled'))
        )
        AND (
          (
            finance_refunds.status IS NOT DISTINCT FROM EXCLUDED.status
            AND finance_refunds.approved_by IS NOT DISTINCT FROM EXCLUDED.approved_by
            AND finance_refunds.approved_at IS NOT DISTINCT FROM EXCLUDED.approved_at
          )
          OR (
            finance_refunds.status='pending_approval' AND EXCLUDED.status='approved'
            AND EXCLUDED.approved_by IS NOT NULL AND EXCLUDED.approved_at IS NOT NULL
          )
          OR (
            finance_refunds.status='pending_approval' AND EXCLUDED.status='cancelled'
            AND finance_refunds.approved_by IS NOT DISTINCT FROM EXCLUDED.approved_by
            AND finance_refunds.approved_at IS NOT DISTINCT FROM EXCLUDED.approved_at
          )
          OR (
            finance_refunds.status IN ('approved','processing')
            AND EXCLUDED.status IN ('processing','succeeded','failed','cancelled')
            AND finance_refunds.approved_by IS NOT DISTINCT FROM EXCLUDED.approved_by
            AND finance_refunds.approved_at IS NOT DISTINCT FROM EXCLUDED.approved_at
          )
        )
      RETURNING id`, [
      refundUuid, paymentUuid, refund.amountIrr, refund.reason, refund.status, refund.idempotencyKey,
      refund.approvedBy || null, refund.approvedAt || null, refund.createdBy, iso(refund.createdAt),
    ]);
    assertImmutableSyncResult(result, 'refund', refund.id);
  }
}

async function syncJournals(client, state) {
  for (const entry of list(state.journalEntries)) {
    const entryUuid = uuidOrStable(entry.id, 'finance-journal-entry');
    const periodUuid = uuidOrStable(entry.periodId, 'finance-period');
    const eventUuid = uuidOrStable(entry.sourceEventId, 'finance-event');
    const reversalUuid = uuidOrStable(entry.reversalOfId, 'finance-journal-entry');
    const finalStatus = entry.status;
    const insertStatus = ['posted', 'reversed'].includes(finalStatus) ? 'draft' : finalStatus;
    const entryResult = await client.query(`INSERT INTO journal_entries_v2
      (id,number,period_id,finance_event_id,source,source_id,entry_at,description,status,debit_irr,credit_irr,branch_id,reversal_of_id,created_by,created_at,posted_by,posted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(id) DO UPDATE SET period_id=EXCLUDED.period_id,description=EXCLUDED.description,
        status=CASE WHEN journal_entries_v2.status IN ('posted','reversed') THEN journal_entries_v2.status ELSE EXCLUDED.status END,
        debit_irr=EXCLUDED.debit_irr,credit_irr=EXCLUDED.credit_irr,
        posted_by=CASE WHEN journal_entries_v2.status IN ('posted','reversed') THEN journal_entries_v2.posted_by ELSE EXCLUDED.posted_by END,
        posted_at=CASE WHEN journal_entries_v2.status IN ('posted','reversed') THEN journal_entries_v2.posted_at ELSE EXCLUDED.posted_at END
      WHERE journal_entries_v2.number IS NOT DISTINCT FROM EXCLUDED.number
        AND journal_entries_v2.period_id IS NOT DISTINCT FROM EXCLUDED.period_id
        AND journal_entries_v2.finance_event_id IS NOT DISTINCT FROM EXCLUDED.finance_event_id
        AND journal_entries_v2.source IS NOT DISTINCT FROM EXCLUDED.source
        AND journal_entries_v2.source_id IS NOT DISTINCT FROM EXCLUDED.source_id
        AND journal_entries_v2.entry_at IS NOT DISTINCT FROM EXCLUDED.entry_at
        AND journal_entries_v2.description IS NOT DISTINCT FROM EXCLUDED.description
        AND journal_entries_v2.debit_irr IS NOT DISTINCT FROM EXCLUDED.debit_irr
        AND journal_entries_v2.credit_irr IS NOT DISTINCT FROM EXCLUDED.credit_irr
        AND journal_entries_v2.branch_id IS NOT DISTINCT FROM EXCLUDED.branch_id
        AND journal_entries_v2.reversal_of_id IS NOT DISTINCT FROM EXCLUDED.reversal_of_id
        AND journal_entries_v2.created_by IS NOT DISTINCT FROM EXCLUDED.created_by
      RETURNING id`, [
      entryUuid, entry.number, periodUuid, eventUuid, entry.source, entry.sourceId == null ? null : String(entry.sourceId),
      entry.date, entry.description, insertStatus, entry.debitIrr, entry.creditIrr, entry.branchId, reversalUuid,
      entry.createdBy || 'system', iso(entry.createdAt), entry.postedBy || null, entry.postedAt || null,
    ]);
    assertImmutableSyncResult(entryResult, 'journal_entry', entry.id);
    for (const [lineIndex, line] of list(entry.lines).entries()) {
      const lineUuid = uuidOrStable(line.id ?? `${entryUuid}:${line.lineNo || lineIndex + 1}`, `finance-journal-line:${entryUuid}`);
      const recipeUuid = uuidOrStable(line.recipeVersionId, 'finance-recipe-version');
      const lineResult = await client.query(`INSERT INTO journal_lines_v2
        (id,journal_entry_id,line_no,account_code,debit_irr,credit_irr,branch_id,cost_center,counterparty_id,payment_method,item_id,recipe_version_id,memo)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id
        WHERE journal_lines_v2.journal_entry_id IS NOT DISTINCT FROM EXCLUDED.journal_entry_id
          AND journal_lines_v2.line_no IS NOT DISTINCT FROM EXCLUDED.line_no
          AND journal_lines_v2.account_code IS NOT DISTINCT FROM EXCLUDED.account_code
          AND journal_lines_v2.debit_irr IS NOT DISTINCT FROM EXCLUDED.debit_irr
          AND journal_lines_v2.credit_irr IS NOT DISTINCT FROM EXCLUDED.credit_irr
          AND journal_lines_v2.branch_id IS NOT DISTINCT FROM EXCLUDED.branch_id
          AND journal_lines_v2.cost_center IS NOT DISTINCT FROM EXCLUDED.cost_center
          AND journal_lines_v2.counterparty_id IS NOT DISTINCT FROM EXCLUDED.counterparty_id
          AND journal_lines_v2.payment_method IS NOT DISTINCT FROM EXCLUDED.payment_method
          AND journal_lines_v2.item_id IS NOT DISTINCT FROM EXCLUDED.item_id
          AND journal_lines_v2.recipe_version_id IS NOT DISTINCT FROM EXCLUDED.recipe_version_id
          AND journal_lines_v2.memo IS NOT DISTINCT FROM EXCLUDED.memo
        RETURNING id`, [
        lineUuid, entryUuid, line.lineNo || lineIndex + 1, line.accountCode, line.debitIrr, line.creditIrr, line.branchId,
        line.costCenter || `branch:${line.branchId}`, line.counterpartyId || null, line.paymentMethod || null,
        line.itemId || null, recipeUuid, line.memo || null,
      ]);
      assertImmutableSyncResult(lineResult, 'journal_line', line.id ?? `${entry.id}:${line.lineNo || lineIndex + 1}`);
    }
    if (insertStatus !== finalStatus) {
      await client.query(`UPDATE journal_entries_v2 SET status=$2,period_id=$3,posted_by=$4,posted_at=$5
        WHERE id=$1 AND status NOT IN ('posted','reversed')`, [entryUuid, finalStatus, periodUuid, entry.postedBy || entry.createdBy || 'system', entry.postedAt || entry.createdAt]);
    }
  }
}

async function syncApprovals(client, state) {
  for (const approval of list(state.approvals)) {
    const approvalUuid = uuidOrStable(approval.id, 'finance-approval');
    const result = await client.query(`INSERT INTO finance_approvals
      (id,operation,entity_type,entity_id,amount_irr,status,created_by,created_at,decided_by,decided_at,history)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,
        decided_at=EXCLUDED.decided_at,history=EXCLUDED.history
      WHERE finance_approvals.operation IS NOT DISTINCT FROM EXCLUDED.operation
        AND finance_approvals.entity_type IS NOT DISTINCT FROM EXCLUDED.entity_type
        AND finance_approvals.entity_id IS NOT DISTINCT FROM EXCLUDED.entity_id
        AND finance_approvals.amount_irr IS NOT DISTINCT FROM EXCLUDED.amount_irr
        AND finance_approvals.created_by IS NOT DISTINCT FROM EXCLUDED.created_by
        AND finance_approvals.created_at IS NOT DISTINCT FROM EXCLUDED.created_at
        AND (
          (
            finance_approvals.status IS NOT DISTINCT FROM EXCLUDED.status
            AND finance_approvals.decided_by IS NOT DISTINCT FROM EXCLUDED.decided_by
            AND finance_approvals.decided_at IS NOT DISTINCT FROM EXCLUDED.decided_at
            AND finance_approvals.history IS NOT DISTINCT FROM EXCLUDED.history
          )
          OR (
            finance_approvals.status='pending'
            AND EXCLUDED.status IN ('approved','rejected','cancelled')
          )
        )
      RETURNING id`, [
      approvalUuid, approval.operation, approval.entityType, String(approval.entityId), approval.amountIrr,
      approval.status, approval.createdBy, approval.createdAt, approval.decidedBy || null, approval.decidedAt || null, json(approval.history || []),
    ]);
    assertImmutableSyncResult(result, 'approval', approval.id);
  }
}

async function syncOpeningBalances(client, state) {
  for (const batch of list(state.openingBalanceBatches)) {
    const batchUuid = uuidOrStable(batch.id, 'finance-opening-balance');
    const periodUuid = uuidOrStable(batch.fiscalPeriodId, 'finance-period');
    const journalUuid = uuidOrStable(batch.journalEntryId, 'finance-journal-entry');
    const approvalUuid = uuidOrStable(batch.approvalId, 'finance-approval');
    const reversalUuid = uuidOrStable(batch.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_opening_balance_batches
      (id,branch_id,as_of_date,fiscal_period_id,source_reference,debit_irr,credit_irr,lines,status,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,decided_by,decided_at,posted_by,posted_at,reversed_by,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,fiscal_period_id=EXCLUDED.fiscal_period_id,
        reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,decided_by=EXCLUDED.decided_by,
        decided_at=EXCLUDED.decided_at,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,
        reversed_by=EXCLUDED.reversed_by,reversed_at=EXCLUDED.reversed_at`, [
      batchUuid, batch.branchId, batch.asOfDate, periodUuid, batch.sourceReference,
      batch.debitIrr, batch.creditIrr, json(batch.lines), batch.status, journalUuid,
      approvalUuid, reversalUuid, batch.createdBy, iso(batch.createdAt),
      batch.decidedBy || null, batch.decidedAt || null, batch.postedBy || null, batch.postedAt || null,
      batch.reversedBy || null, batch.reversedAt || null,
    ]);
  }
}

async function syncBranchRollouts(client, state) {
  for (const rollout of list(state.branchRollouts)) {
    const rolloutUuid = uuidOrStable(rollout.id, 'finance-branch-rollout');
    const approvalUuid = uuidOrStable(rollout.approvalId, 'finance-approval');
    await client.query(`INSERT INTO finance_branch_rollouts
      (id,branch_id,status,approval_id,requested_by,requested_at,decided_by,decided_at,activated_by,activated_at,readiness_snapshot,readiness_at_activation)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,
        decided_at=EXCLUDED.decided_at,activated_by=EXCLUDED.activated_by,activated_at=EXCLUDED.activated_at,
        readiness_at_activation=EXCLUDED.readiness_at_activation`, [
      rolloutUuid, rollout.branchId, rollout.status, approvalUuid, rollout.requestedBy,
      rollout.requestedAt, rollout.decidedBy || null, rollout.decidedAt || null,
      rollout.activatedBy || null, rollout.activatedAt || null, json(rollout.readinessSnapshot || {}),
      rollout.readinessAtActivation ? json(rollout.readinessAtActivation) : null,
    ]);
  }
}

async function syncMigrationBaselines(client, state) {
  const rows = list(state.migrationBaselines).slice().sort((a, b) => {
    if (a.status === b.status) return new Date(a.scannedAt) - new Date(b.scannedAt);
    return a.status === 'superseded' ? -1 : 1;
  });
  for (const baseline of rows) {
    const baselineUuid = uuidOrStable(baseline.id, 'finance-migration-baseline');
    const existing = await client.query(`SELECT branch_id,status,source_count,source_keys,source_fingerprints,source_sha256,trust_summary,scanned_by,scanned_at
      FROM finance_migration_baselines WHERE id=$1`, [baselineUuid]);
    const previous = existing.rows?.[0];
    if (previous && (
      Number(previous.branch_id) !== Number(baseline.branchId)
      || Number(previous.source_count) !== Number(baseline.sourceCount)
      || !sameJson(previous.source_keys, baseline.sourceKeys || [])
      || !sameJson(previous.source_fingerprints, baseline.sourceFingerprints || {})
      || previous.source_sha256 !== baseline.sourceSha256
      || !sameJson(previous.trust_summary, baseline.trustSummary || {})
      || String(previous.scanned_by) !== String(baseline.scannedBy)
      || new Date(previous.scanned_at).getTime() !== new Date(baseline.scannedAt).getTime()
    )) {
      const error = new Error(`finance_migration_baseline_immutable_conflict:${baseline.id}`);
      error.code = 'postgres_migration_baseline_immutable_conflict';
      throw error;
    }
    await client.query(`INSERT INTO finance_migration_baselines
      (id,branch_id,status,source_count,source_keys,source_fingerprints,source_sha256,trust_summary,scanned_by,scanned_at,superseded_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10,$11)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,superseded_at=EXCLUDED.superseded_at
      WHERE finance_migration_baselines.status='active' AND EXCLUDED.status='superseded'`, [
      baselineUuid, baseline.branchId, baseline.status, baseline.sourceCount, json(baseline.sourceKeys || []),
      json(baseline.sourceFingerprints || {}), baseline.sourceSha256, json(baseline.trustSummary || {}),
      baseline.scannedBy, baseline.scannedAt, baseline.supersededAt || null,
    ]);
  }
}

async function syncLegacyArchive(client, state) {
  for (const record of list(state.legacyArchive)) {
    const archiveId = uuidOrNull(record.id) || stableUuid(`finance-legacy-archive:${record.sourceTable}:${record.sourceId}`);
    const backfillJournalUuid = uuidOrStable(record.backfillJournalEntryId, 'finance-journal-entry');
    const backfillApprovalUuid = uuidOrStable(record.backfillApprovalId, 'finance-approval');
    const backfillEventUuid = uuidOrStable(record.backfillEventId, 'finance-event');
    const backfillReversalUuid = uuidOrStable(record.backfillReversalJournalEntryId, 'finance-journal-entry');
    const result = await client.query(`INSERT INTO finance_legacy_archive
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
        backfill_reversal_journal_entry_id=EXCLUDED.backfill_reversal_journal_entry_id,backfill_reversed_by=EXCLUDED.backfill_reversed_by,backfill_reversed_at=EXCLUDED.backfill_reversed_at
      WHERE finance_legacy_archive.trust_status=EXCLUDED.trust_status
        AND finance_legacy_archive.reason=EXCLUDED.reason
        AND finance_legacy_archive.source_payload IS NOT DISTINCT FROM EXCLUDED.source_payload
        AND finance_legacy_archive.branch_id IS NOT DISTINCT FROM EXCLUDED.branch_id
        AND finance_legacy_archive.amount_irr IS NOT DISTINCT FROM EXCLUDED.amount_irr
        AND finance_legacy_archive.occurred_at IS NOT DISTINCT FROM EXCLUDED.occurred_at
        AND finance_legacy_archive.classification_details IS NOT DISTINCT FROM EXCLUDED.classification_details
      RETURNING id`, [
      archiveId, record.sourceTable, String(record.sourceId), record.trustStatus, record.reason,
      json(record.sourcePayload), record.branchId == null ? null : Number(record.branchId), record.amountIrr == null ? null : Number(record.amountIrr),
      record.occurredAt || null, json(record.classificationDetails), record.decision || (record.trustStatus === 'quarantined' ? 'keep_quarantined' : 'pending'),
      record.decisionNotes || null, record.evidenceReference || null, json(record.decisionHistory || []),
      record.decidedBy || null, record.decidedAt || null, record.archivedBy || null, iso(record.archivedAt),
      json(record.reviewedTenders || []), record.backfillStatus || 'not_requested', backfillJournalUuid,
      backfillApprovalUuid, backfillEventUuid, record.backfillRequestedBy || null,
      record.backfillRequestedAt || null, record.backfilledBy || null, record.backfilledAt || null,
      backfillReversalUuid, record.backfillReversedBy || null, record.backfillReversedAt || null,
    ]);
    if (result.rowCount === 0) {
      const error = new Error(`finance_legacy_archive_immutable_conflict:${record.sourceTable}:${record.sourceId}`);
      error.code = 'postgres_legacy_archive_immutable_conflict';
      throw error;
    }
  }
}

async function syncProcurement(client, state) {
  const purchaseLineIds = new Map();
  const receiptLineIds = new Map();
  for (const po of list(state.purchaseOrders)) {
    const poUuid = uuidOrStable(po.id, 'finance-purchase-order');
    await client.query(`INSERT INTO finance_purchase_orders(id,number,branch_id,vendor_id,status,total_irr,lines,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,total_irr=EXCLUDED.total_irr,lines=EXCLUDED.lines`, [
      poUuid, po.number, po.branchId, po.vendorId, procurementStatus(po.status), po.totalIrr, json(po.lines), po.createdBy, po.createdAt,
    ]);
    for (const [index, line] of list(po.lines).entries()) {
      const itemId = String(line.itemId || line.ingredientId || '').trim();
      if (!itemId) throw Object.assign(new Error(`finance_procurement_line_item_missing:${po.id}:${index + 1}`), { code: 'finance_procurement_line_item_missing' });
      const lineUuid = uuidOrStable(line.id || `${po.id}:${index + 1}`, `finance-purchase-order-line:${poUuid}`);
      purchaseLineIds.set(String(line.id || `${po.id}:${index + 1}`), lineUuid);
      await client.query(`INSERT INTO finance_purchase_order_lines
        (id,purchase_order_id,line_no,item_id,ordered_quantity,unit_code,unit_price_irr,tax_irr,discount_irr,line_total_irr)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO UPDATE SET ordered_quantity=EXCLUDED.ordered_quantity,unit_price_irr=EXCLUDED.unit_price_irr,
          tax_irr=EXCLUDED.tax_irr,discount_irr=EXCLUDED.discount_irr,line_total_irr=EXCLUDED.line_total_irr`, [
        lineUuid, poUuid, line.lineNo || index + 1, itemId, Number(line.quantity ?? line.orderedQuantity), unitCode(line.unitCode || line.unit),
        Number(line.unitPriceIrr ?? line.unitPrice ?? line.price ?? 0), Number(line.taxIrr ?? line.tax ?? 0), Number(line.discountIrr ?? line.discount ?? 0),
        Number(line.lineTotalIrr ?? line.totalPrice ?? line.total ?? 0),
      ]);
    }
  }
  for (const grn of list(state.goodsReceipts)) {
    const grnUuid = uuidOrStable(grn.id, 'finance-goods-receipt');
    const poUuid = uuidOrStable(grn.purchaseOrderId, 'finance-purchase-order');
    await client.query(`INSERT INTO finance_goods_receipts(id,number,purchase_order_id,branch_id,received_at,lines,received_by,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(id) DO NOTHING`, [
      grnUuid, grn.number, poUuid, grn.branchId, grn.receivedAt, json(grn.lines), grn.createdBy, `grn:${grn.id}`,
    ]);
    for (const [index, line] of list(grn.lines).entries()) {
      const sourcePoLineId = String(line.poLineId || line.purchaseOrderLineId || '').trim();
      const poLineUuid = purchaseLineIds.get(sourcePoLineId);
      if (!poLineUuid) throw Object.assign(new Error(`finance_goods_receipt_po_line_missing:${grn.id}:${sourcePoLineId || index + 1}`), { code: 'finance_goods_receipt_po_line_missing' });
      const lineUuid = uuidOrStable(line.id || `${grn.id}:${index + 1}`, `finance-goods-receipt-line:${grnUuid}`);
      receiptLineIds.set(String(line.id || `${grn.id}:${index + 1}`), lineUuid);
      const quantity = Number(line.quantityReceived ?? line.receivedQuantity ?? line.quantity);
      const rejected = Number(line.rejectedQuantity ?? line.rejected ?? 0);
      const accepted = Number(line.acceptedQuantity ?? (quantity - rejected));
      await client.query(`INSERT INTO finance_goods_receipt_lines
        (id,goods_receipt_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,unit_code,lot_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(id) DO NOTHING`, [
        // Lots are not part of the legacy procurement snapshot; keep the
        // source lot key in the parent JSON and leave the normalized FK null
        // until a corresponding inventory lot has been imported.
        lineUuid, grnUuid, poLineUuid, quantity, accepted, rejected, unitCode(line.unitCode || line.unit), null,
      ]);
    }
  }
  for (const invoice of list(state.vendorInvoices)) {
    const invoiceUuid = uuidOrStable(invoice.id, 'finance-vendor-invoice');
    const poUuid = uuidOrStable(invoice.purchaseOrderId, 'finance-purchase-order');
    const journalUuid = uuidOrStable(invoice.journalEntryId, 'finance-journal-entry');
    const reversalUuid = uuidOrStable(invoice.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_vendor_invoices(id,number,vendor_id,branch_id,purchase_order_id,total_irr,status,match_result,invoice_date,due_date,journal_entry_id,reversal_journal_entry_id,reversed_by,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,match_result=EXCLUDED.match_result,total_irr=EXCLUDED.total_irr,
        journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,
        reversed_by=EXCLUDED.reversed_by,reversed_at=EXCLUDED.reversed_at`, [
      invoiceUuid, invoice.invoiceNumber, invoice.vendorId, invoice.branchId, poUuid, invoice.totalIrr,
      invoiceStatus(invoice.status), json({ matchStatus: invoice.matchStatus, quantityVariance: invoice.quantityVariance, priceVarianceIrr: invoice.priceVarianceIrr, matchReview: invoice.matchReview || null, lines: invoice.lines }),
      String(invoice.invoiceDate).slice(0, 10), invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : null,
      journalUuid, reversalUuid, invoice.reversedBy || null, invoice.reversedAt || null,
    ]);
    for (const [index, line] of list(invoice.lines).entries()) {
      const sourcePoLineId = String(line.poLineId || line.purchaseOrderLineId || '').trim();
      const sourceReceiptLineId = String(line.grnLineId || line.receiptLineId || line.goodsReceiptLineId || '').trim();
      const poLineUuid = sourcePoLineId ? purchaseLineIds.get(sourcePoLineId) : null;
      const receiptLineUuid = sourceReceiptLineId ? receiptLineIds.get(sourceReceiptLineId) : null;
      const linkedPo = sourcePoLineId
        ? list(state.purchaseOrders.find((candidate) => String(candidate.id) === String(invoice.purchaseOrderId || invoice.poId))?.lines).find((candidate) => String(candidate.id) === sourcePoLineId)
        : null;
      const linkedReceipt = sourceReceiptLineId
        ? list(state.goodsReceipts.find((candidate) => String(candidate.id) === String(invoice.goodsReceiptId || invoice.grnId))?.lines).find((candidate) => String(candidate.id) === sourceReceiptLineId)
        : null;
      const itemId = String(line.itemId || linkedPo?.itemId || linkedReceipt?.itemId || '').trim();
      if (!itemId) throw Object.assign(new Error(`finance_vendor_invoice_line_item_missing:${invoice.id}:${index + 1}`), { code: 'finance_vendor_invoice_line_item_missing' });
      const lineUuid = uuidOrStable(line.id || `${invoice.id}:${index + 1}`, `finance-vendor-invoice-line:${invoiceUuid}`);
      await client.query(`INSERT INTO finance_vendor_invoice_lines
        (id,vendor_invoice_id,line_no,purchase_order_line_id,goods_receipt_line_id,item_id,invoiced_quantity,unit_code,unit_price_irr,tax_irr,discount_irr,line_total_irr,quantity_variance,price_variance_irr)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(id) DO UPDATE SET invoiced_quantity=EXCLUDED.invoiced_quantity,unit_price_irr=EXCLUDED.unit_price_irr,
          tax_irr=EXCLUDED.tax_irr,discount_irr=EXCLUDED.discount_irr,line_total_irr=EXCLUDED.line_total_irr`, [
        lineUuid, invoiceUuid, line.lineNo || index + 1, poLineUuid, receiptLineUuid, itemId,
        Number(line.invoicedQuantity ?? line.quantity), unitCode(line.unitCode || line.unit || linkedPo?.unitCode || linkedPo?.unit || linkedReceipt?.unitCode || linkedReceipt?.unit), Number(line.unitPriceIrr ?? line.unitPrice ?? line.price ?? linkedPo?.unitPrice ?? 0),
        Number(line.taxIrr ?? line.tax ?? 0), Number(line.discountIrr ?? line.discount ?? 0), Number(line.lineTotalIrr ?? line.totalPrice ?? line.total ?? 0),
        line.quantityVariance == null ? null : Number(line.quantityVariance), line.priceVarianceIrr == null ? null : Number(line.priceVarianceIrr),
      ]);
    }
  }
  for (const payment of list(state.supplierPayments)) {
    const paymentUuid = uuidOrStable(payment.id, 'finance-vendor-payment');
    const invoiceUuid = uuidOrStable(payment.vendorInvoiceId, 'finance-vendor-invoice');
    const journalUuid = uuidOrStable(payment.journalEntryId, 'finance-journal-entry');
    const reversalUuid = uuidOrStable(payment.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_vendor_payments(id,invoice_id,amount_irr,status,idempotency_key,created_by,approved_by,created_at,approved_at,journal_entry_id,reversal_journal_entry_id,reversed_by,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,
        journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,
        reversed_by=EXCLUDED.reversed_by,reversed_at=EXCLUDED.reversed_at`, [
      paymentUuid, invoiceUuid, payment.amountIrr, paymentStatus(payment.status), `supplier-payment:${payment.id}`,
      payment.createdBy, payment.approvedBy || null, payment.createdAt, payment.approvedAt || null,
      journalUuid, reversalUuid, payment.reversedBy || null, payment.reversedAt || null,
    ]);
  }
}

async function syncCosting(client, state) {
  for (const movement of list(state.inventoryMovements)) {
    const movementUuid = uuidOrStable(movement.id, 'finance-inventory-movement');
    const reversalUuid = uuidOrStable(movement.reversalOfId, 'finance-inventory-movement');
    await client.query(`INSERT INTO finance_inventory_movements
      (id,branch_id,item_id,movement_type,quantity,unit_cost_irr,total_cost_irr,source_type,source_id,idempotency_key,occurred_at,payload,reversal_of_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) ON CONFLICT(id) DO NOTHING`, [
      movementUuid, movement.branchId, String(movement.itemId), movementType(movement.movementType), movement.quantityBase,
      movement.unitCostIrr ?? null, movement.totalCostIrr ?? null, movement.source, String(movement.sourceId),
      `movement:${movement.id}`, movement.occurredAt,
      json({
        direction: movement.direction || null,
        reason: movement.reason || null,
        recipeId: movement.recipeId || null,
        legacyStatus: movement.status || null,
        createdBy: movement.createdBy || 'system',
        createdAt: iso(movement.createdAt || movement.occurredAt),
      }), reversalUuid,
    ]);
  }
  for (const valuation of list(state.inventoryMovementValuations)) {
    const valuationUuid = uuidOrStable(valuation.id, 'finance-inventory-valuation');
    const movementUuid = uuidOrStable(valuation.movementId, 'finance-inventory-movement');
    await client.query(`INSERT INTO finance_inventory_movement_valuations
      (id,movement_id,unit_cost_irr,total_cost_irr,valuation_source,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(movement_id) DO NOTHING`, [
      valuationUuid, movementUuid, valuation.unitCostIrr, valuation.totalCostIrr,
      valuation.source, valuation.createdBy || 'system', iso(valuation.createdAt),
    ]);
  }
  for (const batch of list(state.productionBatches)) {
    const financeEvent = list(state.events).find((event) => event.source === 'inventory.production_batch' && String(event.sourceId) === String(batch.id));
    const batchUuid = uuidOrStable(batch.id, 'finance-production-batch');
    const recipeUuid = uuidOrStable(batch.recipeVersionId, 'finance-recipe-version');
    const eventUuid = uuidOrStable(financeEvent?.id, 'finance-event');
    await client.query(`INSERT INTO finance_production_batches
      (id,branch_id,recipe_version_id,recipe_source_id,output_item_id,planned_yield,actual_yield,status,produced_at,created_by,idempotency_key,finance_event_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING`, [
      batchUuid, batch.branchId, recipeUuid, String(batch.recipeVersionId), batch.outputItemId || null,
      batch.plannedYield, batch.actualYield, batch.status, batch.producedAt || null, batch.createdBy,
      batch.idempotencyKey, eventUuid, iso(batch.createdAt),
    ]);
  }
  for (const snapshot of list(state.orderItemCostSnapshots)) {
    const snapshotUuid = uuidOrStable(snapshot.id, 'finance-cost-snapshot');
    const recipeUuid = uuidOrStable(snapshot.recipeVersionId, 'finance-recipe-version');
    await client.query(`INSERT INTO finance_order_item_cost_snapshots
      (id,order_id,order_line_key,branch_id,recipe_version_id,quantity,net_sales_irr,theoretical_cogs_irr,captured_at,calculation_payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(order_id,order_line_key) DO NOTHING`, [
      snapshotUuid, Number(snapshot.orderId), snapshot.orderLineKey, snapshot.branchId, recipeUuid,
      snapshot.quantity, snapshot.netSalesIrr, snapshot.theoreticalCogsIrr, snapshot.capturedAt,
      json({ recipeVersionId: snapshot.recipeVersionId, recipeVersion: snapshot.recipeVersion, components: snapshot.components }),
    ]);
  }
}

async function syncRecurringCosts(client, state) {
  for (const commitment of list(state.costCommitments)) {
    const commitmentUuid = uuidOrStable(commitment.id, 'finance-cost-commitment');
    await client.query(`INSERT INTO finance_cost_commitments
      (id,branch_id,name,commitment_type,frequency,monthly_amount_irr,expense_account_code,liability_account_code,cost_behavior,counterparty_id,starts_on,ends_on,status,notes,created_by,created_at,deactivated_by,deactivated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,deactivated_by=EXCLUDED.deactivated_by,deactivated_at=EXCLUDED.deactivated_at`, [
      commitmentUuid, commitment.branchId, commitment.name, commitment.type, commitment.frequency,
      commitment.monthlyAmountIrr, commitment.expenseAccount, commitment.liabilityAccount, commitment.behavior,
      commitment.counterpartyId || null, commitment.startDate, commitment.endDate || null, commitment.status,
      commitment.notes || null, commitment.createdBy, iso(commitment.createdAt), commitment.deactivatedBy || null, commitment.deactivatedAt || null,
    ]);
  }
  for (const accrual of list(state.costAccruals)) {
    const accrualUuid = uuidOrStable(accrual.id, 'finance-cost-accrual');
    const commitmentUuid = uuidOrStable(accrual.costCommitmentId, 'finance-cost-commitment');
    const periodUuid = uuidOrStable(accrual.fiscalPeriodId, 'finance-period');
    const journalUuid = uuidOrStable(accrual.journalEntryId, 'finance-journal-entry');
    const approvalUuid = uuidOrStable(accrual.approvalId, 'finance-approval');
    await client.query(`INSERT INTO finance_cost_accruals
      (id,cost_commitment_id,branch_id,service_month,posting_date,fiscal_period_id,amount_irr,expense_account_code,liability_account_code,override_reason,status,paid_amount_irr,journal_entry_id,approval_id,created_by,created_at,posted_by,posted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,paid_amount_irr=EXCLUDED.paid_amount_irr,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at`, [
      accrualUuid, commitmentUuid, accrual.branchId, `${accrual.serviceMonth}-01`, accrual.postingDate,
      periodUuid, accrual.amountIrr, accrual.expenseAccount, accrual.liabilityAccount,
      accrual.overrideReason || null, accrual.status, accrual.paidAmountIrr || 0, journalUuid,
      approvalUuid, accrual.createdBy, iso(accrual.createdAt), accrual.postedBy || null, accrual.postedAt || null,
    ]);
  }
  for (const payment of list(state.costPayments)) {
    const paymentUuid = uuidOrStable(payment.id, 'finance-cost-payment');
    const accrualUuid = uuidOrStable(payment.costAccrualId, 'finance-cost-accrual');
    const approvalUuid = uuidOrStable(payment.approvalId, 'finance-approval');
    const journalUuid = uuidOrStable(payment.journalEntryId, 'finance-journal-entry');
    const reversalUuid = uuidOrStable(payment.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_cost_payments
      (id,cost_accrual_id,branch_id,amount_irr,payment_method,payment_date,reference,status,approval_id,journal_entry_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at`, [
      paymentUuid, accrualUuid, payment.branchId, payment.amountIrr, payment.paymentMethod,
      payment.paymentDate, payment.reference || null, payment.status, approvalUuid, journalUuid,
      reversalUuid, payment.createdBy, iso(payment.createdAt), payment.approvedBy || null, payment.approvedAt || null, payment.reversedAt || null,
    ]);
  }
}

async function syncFixedAssets(client, state) {
  for (const asset of list(state.fixedAssets)) {
    const assetUuid = uuidOrStable(asset.id, 'finance-fixed-asset');
    const acquisitionJournalUuid = uuidOrStable(asset.acquisitionJournalEntryId, 'finance-journal-entry');
    const acquisitionApprovalUuid = uuidOrStable(asset.acquisitionApprovalId, 'finance-approval');
    const reversalUuid = uuidOrStable(asset.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_fixed_assets
      (id,branch_id,asset_code,name,category,asset_account_code,funding_method,funding_account_code,source_reference,purchase_date,in_service_date,purchase_cost_irr,salvage_value_irr,useful_life_months,depreciation_method,depreciation_convention,accumulated_depreciation_irr,status,acquisition_journal_entry_id,acquisition_approval_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at,last_depreciation_month,last_depreciation_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,accumulated_depreciation_irr=EXCLUDED.accumulated_depreciation_irr,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at,last_depreciation_month=EXCLUDED.last_depreciation_month,last_depreciation_at=EXCLUDED.last_depreciation_at`, [
      assetUuid, asset.branchId, asset.assetCode, asset.name, asset.category, asset.assetAccount,
      asset.fundingMethod, asset.fundingAccount, asset.sourceReference, asset.purchaseDate, asset.inServiceDate,
      asset.purchaseCostIrr, asset.salvageValueIrr || 0, asset.usefulLifeMonths, asset.depreciationMethod,
      asset.depreciationConvention, asset.accumulatedDepreciationIrr || 0, asset.status,
      acquisitionJournalUuid, acquisitionApprovalUuid, reversalUuid,
      asset.createdBy, iso(asset.createdAt), asset.approvedBy || null, asset.approvedAt || null,
      asset.reversedAt || null, asset.lastDepreciationMonth ? `${asset.lastDepreciationMonth}-01` : null,
      asset.lastDepreciationAt || null,
    ]);
  }
  for (const run of list(state.depreciationRuns)) {
    const runUuid = uuidOrStable(run.id, 'finance-depreciation-run');
    const periodUuid = uuidOrStable(run.fiscalPeriodId, 'finance-period');
    const journalUuid = uuidOrStable(run.journalEntryId, 'finance-journal-entry');
    const approvalUuid = uuidOrStable(run.approvalId, 'finance-approval');
    const reversalUuid = uuidOrStable(run.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_depreciation_runs
      (id,branch_id,service_month,posting_date,fiscal_period_id,method,convention,total_depreciation_irr,status,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,posted_by,posted_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,reversed_at=EXCLUDED.reversed_at`, [
      runUuid, run.branchId, `${run.serviceMonth}-01`, run.postingDate, periodUuid,
      run.method, run.convention, run.totalDepreciationIrr, run.status, journalUuid,
      approvalUuid, reversalUuid, run.createdBy, iso(run.createdAt),
      run.postedBy || null, run.postedAt || null, run.reversedAt || null,
    ]);
    for (const line of list(run.lines)) {
      const lineUuid = uuidOrStable(line.id, `finance-depreciation-line:${runUuid}`);
      const assetUuid = uuidOrStable(line.assetId, 'finance-fixed-asset');
      await client.query(`INSERT INTO finance_asset_depreciation_lines
        (id,depreciation_run_id,asset_id,service_month,amount_irr,accumulated_before_irr,remaining_before_irr,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status`, [
        lineUuid, runUuid, assetUuid, `${run.serviceMonth}-01`, line.amountIrr,
        line.accumulatedBeforeIrr, line.remainingBeforeIrr, run.status, iso(run.createdAt),
      ]);
    }
  }
}

async function syncPayroll(client, state) {
  for (const run of list(state.payrollRuns)) {
    const runUuid = uuidOrStable(run.id, 'finance-payroll-run');
    const periodUuid = uuidOrStable(run.fiscalPeriodId, 'finance-period');
    const journalUuid = uuidOrStable(run.journalEntryId, 'finance-journal-entry');
    const approvalUuid = uuidOrStable(run.approvalId, 'finance-approval');
    const reversalUuid = uuidOrStable(run.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_payroll_runs
      (id,branch_id,service_month,posting_date,fiscal_period_id,source_reference,headcount,kitchen_gross_irr,service_gross_irr,total_gross_irr,employer_insurance_irr,employee_insurance_irr,total_insurance_irr,payroll_tax_irr,other_deductions_irr,net_pay_irr,total_expense_irr,calculation_policy,status,paid_by_liability,journal_entry_id,approval_id,reversal_journal_entry_id,created_by,created_at,posted_by,posted_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,paid_by_liability=EXCLUDED.paid_by_liability,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,posted_by=EXCLUDED.posted_by,posted_at=EXCLUDED.posted_at,reversed_at=EXCLUDED.reversed_at`, [
      runUuid, run.branchId, `${run.serviceMonth}-01`, String(run.postingDate).slice(0, 10), periodUuid,
      run.sourceReference, run.headcount, run.kitchenGrossIrr, run.serviceGrossIrr, run.totalGrossIrr,
      run.employerInsuranceIrr, run.employeeInsuranceIrr, run.totalInsuranceIrr, run.payrollTaxIrr,
      run.otherDeductionsIrr, run.netPayIrr, run.totalExpenseIrr, run.calculationPolicy, run.status,
      json(run.paidByLiability), journalUuid, approvalUuid, reversalUuid,
      run.createdBy, iso(run.createdAt), run.postedBy || null, run.postedAt || null, run.reversedAt || null,
    ]);
  }
  for (const payment of list(state.payrollPayments)) {
    const paymentUuid = uuidOrStable(payment.id, 'finance-payroll-payment');
    const runUuid = uuidOrStable(payment.payrollRunId, 'finance-payroll-run');
    const approvalUuid = uuidOrStable(payment.approvalId, 'finance-approval');
    const journalUuid = uuidOrStable(payment.journalEntryId, 'finance-journal-entry');
    const reversalUuid = uuidOrStable(payment.reversalJournalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO finance_payroll_payments
      (id,payroll_run_id,branch_id,liability_type,liability_account_code,amount_irr,payment_method,payment_date,reference,status,approval_id,journal_entry_id,reversal_journal_entry_id,created_by,created_at,approved_by,approved_at,reversed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,journal_entry_id=EXCLUDED.journal_entry_id,reversal_journal_entry_id=EXCLUDED.reversal_journal_entry_id,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,reversed_at=EXCLUDED.reversed_at`, [
      paymentUuid, runUuid, payment.branchId, payment.liabilityType, payment.liabilityAccount,
      payment.amountIrr, payment.paymentMethod, String(payment.paymentDate).slice(0, 10), payment.reference || null,
      payment.status, approvalUuid, journalUuid, reversalUuid,
      payment.createdBy, iso(payment.createdAt), payment.approvedBy || null, payment.approvedAt || null, payment.reversedAt || null,
    ]);
  }
}

async function syncReconciliation(client, state) {
  for (const item of list(state.reconciliationItems)) {
    const itemUuid = uuidOrStable(item.id, 'finance-reconciliation-item');
    const journalUuid = uuidOrStable(item.journalEntryId, 'finance-journal-entry');
    await client.query(`INSERT INTO reconciliation_items
      (id,kind,branch_id,order_id,payment_id,cash_session_id,bank_reference,settlement_reference,psp,terminal_id,batch_no,journal_entry_id,amount_irr,status,matched_at,matched_by,details,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,matched_at=EXCLUDED.matched_at,matched_by=EXCLUDED.matched_by,details=EXCLUDED.details`, [
      itemUuid, item.kind, item.branchId, item.orderId == null ? null : Number(item.orderId), item.paymentId || null,
      item.cashSessionId || null, item.bankReference || null, item.settlementReference || null, item.psp || null,
      item.terminalId || null, item.batchNo || null, journalUuid, item.amountIrr, item.status,
      item.matchedAt || null, item.matchedBy || null, json(item.details || {}), iso(item.createdAt),
    ]);
  }
}

async function syncFinanceState(client, financeState, { checkSchema = true, operationalState = null } = {}) {
  const state = financeState || {};
  if (checkSchema && !(await normalizedSchemaAvailable(client))) return { available: false, reason: 'finance_schema_missing' };
  await syncIdempotencyRequests(client, state);
  await syncPeriods(client, state);
  await syncCashSessions(client, operationalState);
  await syncOperationalOrders(client, operationalState);
  await syncPaymentsAndRefunds(client, state);
  await syncEvents(client, state);
  await syncJournals(client, state);
  await syncApprovals(client, state);
  const quarantine = await syncInventoryAndRecipes(client, state, operationalState);
  await syncOpeningBalances(client, state);
  await syncBranchRollouts(client, state);
  await syncMigrationBaselines(client, state);
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
      cashSessions: list(operationalState?.cashSessions).length,
      payments: list(state.payments).length, refunds: list(state.refunds).length,
      purchaseOrders: list(state.purchaseOrders).length, inventoryMovements: list(state.inventoryMovements).length,
      movementValuations: list(state.inventoryMovementValuations).length,
      productionBatches: list(state.productionBatches).length, costSnapshots: list(state.orderItemCostSnapshots).length,
      recipeVersions: list(state.recipeVersions).length,
      costCommitments: list(state.costCommitments).length, costAccruals: list(state.costAccruals).length,
      fixedAssets: list(state.fixedAssets).length, depreciationRuns: list(state.depreciationRuns).length,
      payrollRuns: list(state.payrollRuns).length, payrollPayments: list(state.payrollPayments).length,
      openingBalanceBatches: list(state.openingBalanceBatches).length,
      branchRollouts: list(state.branchRollouts).length,
      migrationBaselines: list(state.migrationBaselines).length,
      legacyArchive: list(state.legacyArchive).length,
      idempotencyRequests: Object.keys(state.idempotencyRequests || {}).length,
    },
    quarantine,
  };
}

module.exports = { normalizedSchemaAvailable, syncFinanceState };

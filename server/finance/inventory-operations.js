'use strict';

const crypto = require('crypto');
const { convertQuantity, ingredientRequirement, canonicalUnit, recipeCatalog } = require('./restaurant-intelligence');
const { physicalAvailable, unitCostIrr } = require('./order-costing');

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`; }
function sameBranch(row, branchId) { return row?.branchId == null || Number(row.branchId) === Number(branchId); }

function inventoryItem(db, itemId, branchId) {
  const key = String(itemId ?? '').trim();
  const scoped = list(db.accounting?.inventoryItems).filter((row) => sameBranch(row, branchId));
  return scoped.find((row) => String(row.id) === key)
    || scoped.find((row) => String(row.sku || '').trim() === key)
    || null;
}

function inventoryItemAnyBranch(db, itemId) {
  const key = String(itemId ?? '').trim();
  return list(db.accounting?.inventoryItems).find((row) => (
    String(row.id) === key || String(row.sku || '').trim() === key
  )) || null;
}

function physicalOnHand(item, state, branchId) {
  const opening = number(item?.qtyOnHand ?? item?.onHand ?? item?.quantity);
  if (opening == null) return { ok: false, code: 'on_hand_missing', value: null };
  let movement = 0;
  for (const row of list(state?.inventoryMovements)) {
    if (String(row.itemId) !== String(item.id) || !sameBranch(row, branchId)) continue;
    const quantity = number(row.quantityBase);
    if (quantity == null) return { ok: false, code: 'inventory_movement_quantity_invalid', value: null };
    movement += quantity;
    if (!Number.isFinite(movement)) return { ok: false, code: 'inventory_movement_quantity_unsafe', value: null };
  }
  return { ok: true, value: opening + movement, opening, movement };
}

function quantityInItemUnit(item, quantity, unit) {
  const value = number(quantity);
  if (value == null || value < 0) return { ok: false, code: 'quantity_invalid', value: null };
  const converted = convertQuantity(value, unit || item.unit, item.unit, item.conversions);
  if (converted.ok && !Number.isFinite(converted.value)) return { ok: false, code: 'quantity_unsafe', value: null };
  return converted;
}

function valuedMovement({ item, quantityBase, branchId, movementType, source, sourceId, occurredAt, actor, settings, extra = {} }) {
  const cost = unitCostIrr(item, null, settings);
  const totalCostIrr = cost.ok ? Math.round(Math.abs(quantityBase) * cost.amountIrr) : null;
  return {
    id: id(), branchId, itemId: String(item.id), itemName: item.name || String(item.id),
    movementType, quantityBase, baseUnit: canonicalUnit(item.unit) || item.unit,
    unitCostIrr: cost.ok ? cost.amountIrr : null, totalCostIrr,
    costSource: cost.ok ? cost.source : null, valuationStatus: cost.ok ? 'valued' : 'unvalued',
    source, sourceId, occurredAt, createdAt: new Date().toISOString(), createdBy: actor,
    reversalOfId: null, ...extra,
  };
}

function buildWaste(db, state, input, actor) {
  const branchId = Number(input.branchId) || null;
  const item = inventoryItem(db, input.itemId, branchId);
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبه مشخص نیست.', issues: [] };
  if (!item) return { ok: false, code: inventoryItemAnyBranch(db, input.itemId) ? 'inventory_item_branch_mismatch' : 'inventory_item_not_found', message: 'مادهٔ انبار در این شعبه یافت نشد.', issues: [] };
  const converted = quantityInItemUnit(item, input.quantity, input.unit);
  if (!converted.ok || converted.value <= 0) return { ok: false, code: converted.code || 'quantity_invalid', message: 'مقدار یا واحد ضایعات معتبر نیست.', issues: [] };
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3) return { ok: false, code: 'waste_reason_required', message: 'علت ضایعات الزامی است.', issues: [] };
  const available = physicalAvailable(item, state, branchId);
  const issues = [];
  if (!available.ok) issues.push({ code: available.code, itemId: item.id });
  else if (converted.value > available.value + 1e-9) issues.push({ code: 'waste_exceeds_available', itemId: item.id, quantityBase: converted.value, availableQuantityBase: available.value });
  const blockingIssue = issues[0];
  if (blockingIssue) {
    return {
      ok: false,
      code: blockingIssue.code,
      message: blockingIssue.code === 'waste_exceeds_available'
        ? 'مقدار ضایعات از موجودی قابل‌مصرف بیشتر است.'
        : 'ماندهٔ قابل‌مصرف کالا مشخص نیست.',
      issues,
    };
  }
  const operationId = id();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const movement = valuedMovement({
    item, quantityBase: -converted.value, branchId, movementType: 'waste', source: 'inventory.waste',
    sourceId: operationId, occurredAt, actor, settings: state.settings,
    extra: { reason, station: String(input.station || '').slice(0, 80) || null },
  });
  if (movement.valuationStatus === 'unvalued') issues.push({ code: 'inventory_cost_unit_ambiguous', itemId: item.id });
  return { ok: true, kind: 'waste', operationId, branchId, occurredAt, reason, item, movements: [movement], issues, totalCostIrr: movement.totalCostIrr };
}

function buildStockCount(db, state, input, actor) {
  const branchId = Number(input.branchId) || null;
  const item = inventoryItem(db, input.itemId, branchId);
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبه مشخص نیست.', issues: [] };
  if (!item) return { ok: false, code: inventoryItemAnyBranch(db, input.itemId) ? 'inventory_item_branch_mismatch' : 'inventory_item_not_found', message: 'مادهٔ انبار در این شعبه یافت نشد.', issues: [] };
  const converted = quantityInItemUnit(item, input.countedQuantity, input.unit);
  if (!converted.ok) return { ok: false, code: converted.code || 'quantity_invalid', message: 'مقدار یا واحد شمارش معتبر نیست.', issues: [] };
  const expected = physicalOnHand(item, state, branchId);
  if (!expected.ok) return { ok: false, code: expected.code, message: 'ماندهٔ مبنای کالا مشخص نیست.', issues: [{ code: expected.code, itemId: item.id }] };
  const deltaBase = converted.value - expected.value;
  const operationId = id();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const reason = String(input.reason || 'شمارش فیزیکی').trim().slice(0, 300);
  const movements = Math.abs(deltaBase) <= 1e-9 ? [] : [valuedMovement({
    item, quantityBase: deltaBase, branchId, movementType: 'count_adjustment', source: 'inventory.stock_count',
    sourceId: operationId, occurredAt, actor, settings: state.settings,
    extra: { countedQuantityBase: converted.value, expectedQuantityBase: expected.value, reason },
  })];
  const issues = [];
  if (movements[0]?.valuationStatus === 'unvalued') issues.push({ code: 'inventory_cost_unit_ambiguous', itemId: item.id });
  const variancePercent = expected.value > 0 ? Math.abs(deltaBase) / expected.value * 100 : (deltaBase ? 100 : 0);
  if (variancePercent >= 5) issues.push({ code: 'stock_count_material_variance', itemId: item.id, variancePercent: Math.round(variancePercent * 100) / 100, deltaBase });
  return {
    ok: true, kind: 'stock_count', operationId, branchId, occurredAt, reason, item, movements, issues,
    countedQuantityBase: converted.value, expectedQuantityBase: expected.value, deltaBase,
    totalCostIrr: movements[0]?.totalCostIrr || 0,
  };
}

function buildProductionBatch(db, state, input, actor) {
  const branchId = Number(input.branchId) || null;
  const recipe = recipeCatalog(db, branchId).find((row) => String(row.id) === String(input.recipeId));
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبه مشخص نیست.', issues: [] };
  if (!recipe) return { ok: false, code: 'recipe_not_found', message: 'رسپی تولید یافت نشد.', issues: [] };
  if (recipe.status === 'retired') return { ok: false, code: 'recipe_retired', message: 'نسخهٔ بازنشستهٔ رسپی برای تولید قابل استفاده نیست.', issues: [] };
  const outputItemId = input.outputItemId || recipe.outputItemId;
  const outputItem = inventoryItem(db, outputItemId, branchId);
  if (!outputItem) return { ok: false, code: inventoryItemAnyBranch(db, outputItemId) ? 'production_output_branch_mismatch' : 'production_output_item_missing', message: 'کالای خروجی رسپی در این شعبه مشخص نیست.', issues: [] };
  const plannedYield = number(input.plannedYield);
  const actualYield = number(input.actualYield);
  if (plannedYield == null || plannedYield <= 0 || actualYield == null || actualYield < 0) return { ok: false, code: 'production_yield_invalid', message: 'بازده برنامه‌ریزی‌شده و واقعی معتبر نیست.', issues: [] };
  const convertedOutput = quantityInItemUnit(outputItem, actualYield, input.outputUnit || outputItem.unit);
  if (!convertedOutput.ok) return { ok: false, code: convertedOutput.code, message: 'واحد خروجی تولید معتبر نیست.', issues: [] };
  const operationId = id();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const issues = [];
  const consumeMovements = [];
  const requiredByItem = new Map();
  let totalCostIrr = 0;
  let allValued = true;
  for (const ingredient of list(recipe.ingredients)) {
    const item = inventoryItem(db, ingredient.itemId, branchId);
    if (!item) { issues.push({ code: inventoryItemAnyBranch(db, ingredient.itemId) ? 'ingredient_item_branch_mismatch' : 'ingredient_item_missing', itemId: ingredient.itemId }); continue; }
    if (String(item.id) === String(outputItem.id)) { issues.push({ code: 'production_output_is_ingredient', itemId: item.id }); continue; }
    const required = ingredientRequirement({
      ...ingredient,
      quantityBasis: ingredient.quantityBasis ?? ingredient.quantity_basis ?? 'raw',
    }, recipe, item);
    if (!required.ok) { issues.push({ code: required.code, itemId: item.id }); continue; }
    const quantityBase = required.value * plannedYield;
    if (!Number.isFinite(quantityBase) || quantityBase <= 0) { issues.push({ code: 'quantity_unsafe', itemId: item.id }); continue; }
    const aggregate = requiredByItem.get(String(item.id)) || { item, requiredQuantityBase: 0 };
    aggregate.requiredQuantityBase += quantityBase;
    requiredByItem.set(String(item.id), aggregate);
    const movement = valuedMovement({
      item, quantityBase: -quantityBase, branchId, movementType: 'production', source: 'inventory.production_batch',
      sourceId: operationId, occurredAt, actor, settings: state.settings,
      extra: { direction: 'consume', recipeId: String(recipe.id), plannedYield, actualYield },
    });
    if (movement.valuationStatus === 'unvalued') { allValued = false; issues.push({ code: 'inventory_cost_unit_ambiguous', itemId: item.id }); }
    else totalCostIrr += movement.totalCostIrr;
    consumeMovements.push(movement);
  }
  for (const aggregate of requiredByItem.values()) {
    const available = physicalAvailable(aggregate.item, state, branchId);
    if (!available.ok || aggregate.requiredQuantityBase > available.value + 1e-9) issues.push({
      code: available.ok ? 'inventory_shortage' : available.code, itemId: aggregate.item.id,
      requiredQuantityBase: aggregate.requiredQuantityBase, availableQuantityBase: available.ok ? available.value : null,
    });
  }
  if (!consumeMovements.length) return { ok: false, code: issues[0]?.code || 'recipe_ingredients_missing', message: 'مواد قابل‌مصرف رسپی تولید کامل نیست.', issues };
  const blockingIssue = issues.find((issue) => issue.code !== 'inventory_cost_unit_ambiguous');
  if (blockingIssue) {
    return {
      ok: false,
      code: blockingIssue.code === 'inventory_shortage' ? 'production_inventory_shortage' : 'production_recipe_not_executable',
      message: blockingIssue.code === 'inventory_shortage'
        ? 'موجودی مواد برای تولید این بچ کافی نیست؛ ابتدا دریافت یا شمارش موجودی را ثبت کنید.'
        : 'رسپی یا واحد مواد برای ثبت تولید کامل نیست.',
      issues,
    };
  }
  const outputMovement = {
    id: id(), branchId, itemId: String(outputItem.id), itemName: outputItem.name || String(outputItem.id),
    movementType: 'production', quantityBase: convertedOutput.value, baseUnit: canonicalUnit(outputItem.unit) || outputItem.unit,
    unitCostIrr: allValued && convertedOutput.value > 0 ? Math.round(totalCostIrr / convertedOutput.value) : null,
    totalCostIrr: allValued ? totalCostIrr : null, costSource: allValued ? 'production_batch_allocation' : null,
    valuationStatus: allValued ? 'valued' : 'unvalued', source: 'inventory.production_batch', sourceId: operationId,
    occurredAt, createdAt: new Date().toISOString(), createdBy: actor, reversalOfId: null,
    direction: 'produce', recipeId: String(recipe.id), plannedYield, actualYield,
  };
  if (actualYield === 0) outputMovement.totalCostIrr = 0;
  return {
    ok: true, kind: 'production_batch', operationId, branchId, occurredAt, recipe, outputItem,
    plannedYield, actualYield, movements: [...consumeMovements, ...(actualYield > 0 ? [outputMovement] : [])],
    issues, totalCostIrr: allValued ? totalCostIrr : null, allValued,
  };
}

module.exports = { inventoryItem, physicalOnHand, quantityInItemUnit, buildWaste, buildStockCount, buildProductionBatch };

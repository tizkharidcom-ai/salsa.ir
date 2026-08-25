'use strict';

const crypto = require('crypto');
const { convertQuantity, ingredientRequirement, canonicalUnit } = require('./restaurant-intelligence');
const { physicalAvailable, unitCostIrr } = require('./order-costing');

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`; }
function sameBranch(row, branchId) { return row?.branchId == null || Number(row.branchId) === Number(branchId); }

function inventoryItem(db, itemId, branchId) {
  return list(db.accounting?.inventoryItems).find((row) => String(row.id) === String(itemId) && sameBranch(row, branchId)) || null;
}

function physicalOnHand(item, state, branchId) {
  const opening = number(item?.qtyOnHand ?? item?.onHand ?? item?.quantity);
  if (opening == null) return { ok: false, code: 'on_hand_missing', value: null };
  const movement = list(state?.inventoryMovements)
    .filter((row) => String(row.itemId) === String(item.id) && sameBranch(row, branchId))
    .reduce((sum, row) => sum + (number(row.quantityBase) || 0), 0);
  return { ok: true, value: opening + movement, opening, movement };
}

function quantityInItemUnit(item, quantity, unit) {
  const value = number(quantity);
  if (value == null || value < 0) return { ok: false, code: 'quantity_invalid', value: null };
  return convertQuantity(value, unit || item.unit, item.unit, item.conversions);
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
  if (!item) return { ok: false, code: 'inventory_item_not_found', message: 'مادهٔ انبار یافت نشد.', issues: [] };
  const converted = quantityInItemUnit(item, input.quantity, input.unit);
  if (!converted.ok || converted.value <= 0) return { ok: false, code: converted.code || 'quantity_invalid', message: 'مقدار یا واحد ضایعات معتبر نیست.', issues: [] };
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3) return { ok: false, code: 'waste_reason_required', message: 'علت ضایعات الزامی است.', issues: [] };
  const available = physicalAvailable(item, state, branchId);
  const issues = [];
  if (!available.ok) issues.push({ code: available.code, itemId: item.id });
  else if (converted.value > available.value + 1e-9) issues.push({ code: 'waste_exceeds_available', itemId: item.id, quantityBase: converted.value, availableQuantityBase: available.value });
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
  if (!item) return { ok: false, code: 'inventory_item_not_found', message: 'مادهٔ انبار یافت نشد.', issues: [] };
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
  const recipe = list(db.accounting?.recipes).find((row) => String(row.id) === String(input.recipeId) && sameBranch(row, branchId));
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبه مشخص نیست.', issues: [] };
  if (!recipe) return { ok: false, code: 'recipe_not_found', message: 'رسپی تولید یافت نشد.', issues: [] };
  const outputItemId = input.outputItemId || recipe.outputItemId;
  const outputItem = inventoryItem(db, outputItemId, branchId);
  if (!outputItem) return { ok: false, code: 'production_output_item_missing', message: 'کالای خروجی رسپی تولید مشخص نیست.', issues: [] };
  const plannedYield = number(input.plannedYield);
  const actualYield = number(input.actualYield);
  if (plannedYield == null || plannedYield <= 0 || actualYield == null || actualYield < 0) return { ok: false, code: 'production_yield_invalid', message: 'بازده برنامه‌ریزی‌شده و واقعی معتبر نیست.', issues: [] };
  const convertedOutput = quantityInItemUnit(outputItem, actualYield, input.outputUnit || outputItem.unit);
  if (!convertedOutput.ok) return { ok: false, code: convertedOutput.code, message: 'واحد خروجی تولید معتبر نیست.', issues: [] };
  const operationId = id();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const issues = [];
  const consumeMovements = [];
  let totalCostIrr = 0;
  let allValued = true;
  for (const ingredient of list(recipe.ingredients)) {
    const item = inventoryItem(db, ingredient.itemId, branchId);
    if (!item) { issues.push({ code: 'ingredient_item_missing', itemId: ingredient.itemId }); continue; }
    if (String(item.id) === String(outputItem.id)) { issues.push({ code: 'production_output_is_ingredient', itemId: item.id }); continue; }
    const required = ingredientRequirement(ingredient, recipe, item);
    if (!required.ok) { issues.push({ code: required.code, itemId: item.id }); continue; }
    const quantityBase = required.value * plannedYield;
    const available = physicalAvailable(item, state, branchId);
    if (!available.ok || quantityBase > available.value + 1e-9) issues.push({
      code: available.ok ? 'inventory_shortage' : available.code, itemId: item.id,
      requiredQuantityBase: quantityBase, availableQuantityBase: available.ok ? available.value : null,
    });
    const movement = valuedMovement({
      item, quantityBase: -quantityBase, branchId, movementType: 'production', source: 'inventory.production_batch',
      sourceId: operationId, occurredAt, actor, settings: state.settings,
      extra: { direction: 'consume', recipeId: String(recipe.id), plannedYield, actualYield },
    });
    if (movement.valuationStatus === 'unvalued') { allValued = false; issues.push({ code: 'inventory_cost_unit_ambiguous', itemId: item.id }); }
    else totalCostIrr += movement.totalCostIrr;
    consumeMovements.push(movement);
  }
  if (!consumeMovements.length) return { ok: false, code: issues[0]?.code || 'recipe_ingredients_missing', message: 'مواد قابل‌مصرف رسپی تولید کامل نیست.', issues };
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

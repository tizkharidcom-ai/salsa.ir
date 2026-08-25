'use strict';

const PAID_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);

const UNIT_ALIASES = Object.freeze({
  g: 'g', gram: 'g', grams: 'g', 'گرم': 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', 'کیلو': 'kg', 'کیلوگرم': 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', 'میلی لیتر': 'ml', 'میلی‌لیتر': 'ml',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l', 'لیتر': 'l',
  count: 'count', each: 'count', unit: 'count', pcs: 'count', piece: 'count', 'عدد': 'count', 'واحد': 'count',
});

const UNIT_META = Object.freeze({
  g: { dimension: 'mass', baseFactor: 1 },
  kg: { dimension: 'mass', baseFactor: 1000 },
  ml: { dimension: 'volume', baseFactor: 1 },
  l: { dimension: 'volume', baseFactor: 1000 },
  count: { dimension: 'count', baseFactor: 1 },
});

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function int(value) { return Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function canonicalUnit(value) { return UNIT_ALIASES[String(value || '').trim().toLowerCase()] || null; }
function sameBranch(row, branchId) { return !branchId || Number(row?.branchId) === Number(branchId); }
function sharedOrBranch(row, branchId) { return row?.branchId == null || sameBranch(row, branchId); }
function isPaid(order) { return order?.paymentStatus === 'paid' || PAID_STATUSES.has(String(order?.status || '')); }

function itemConversion(quantity, fromUnit, toUnit, conversions = []) {
  for (const row of list(conversions)) {
    const from = canonicalUnit(row.fromUnit || row.unit);
    const to = canonicalUnit(row.toUnit || row.baseUnit);
    const multiplier = number(row.multiplier ?? row.factor);
    if (from === fromUnit && to === toUnit && multiplier != null && multiplier > 0) return quantity * multiplier;
    if (from === toUnit && to === fromUnit && multiplier != null && multiplier > 0) return quantity / multiplier;
  }
  return null;
}

function convertQuantity(quantity, from, to, conversions = []) {
  const value = number(quantity);
  const fromUnit = canonicalUnit(from);
  const toUnit = canonicalUnit(to);
  if (value == null || value < 0) return { ok: false, code: 'quantity_invalid', value: null };
  if (!fromUnit || !toUnit) return { ok: false, code: 'unit_unknown', value: null, fromUnit, toUnit };
  if (fromUnit === toUnit) return { ok: true, value, fromUnit, toUnit, source: 'same_unit' };
  const explicit = itemConversion(value, fromUnit, toUnit, conversions);
  if (explicit != null) return { ok: true, value: explicit, fromUnit, toUnit, source: 'item_conversion' };
  const fromMeta = UNIT_META[fromUnit];
  const toMeta = UNIT_META[toUnit];
  if (!fromMeta || !toMeta || fromMeta.dimension !== toMeta.dimension) {
    return { ok: false, code: 'unit_incompatible', value: null, fromUnit, toUnit };
  }
  return { ok: true, value: value * fromMeta.baseFactor / toMeta.baseFactor, fromUnit, toUnit, source: 'dimension_conversion' };
}

function availableQuantity(item) {
  const onHand = number(item.qtyOnHand ?? item.onHand ?? item.quantity);
  if (onHand == null) return { ok: false, code: 'on_hand_missing', value: null };
  const reserved = number(item.reservedQty ?? item.qtyReserved) || 0;
  const quarantined = number(item.quarantinedQty ?? item.qtyQuarantined) || 0;
  const expired = number(item.expiredQty ?? item.qtyExpired) || 0;
  const safetyStock = number(item.safetyStockBase ?? item.safetyStockQty ?? item.safetyStock) || 0;
  const raw = onHand - reserved - quarantined - expired - safetyStock;
  return { ok: true, value: Math.max(0, raw), raw, negative: raw < 0 };
}

function recipePortions(recipe) {
  const yieldQuantity = number(recipe.yieldQuantity ?? recipe.portions ?? recipe.servings);
  return yieldQuantity != null && yieldQuantity > 0 ? yieldQuantity : 1;
}

function ingredientRequirement(ingredient, recipe, item) {
  const rawQuantity = number(ingredient.quantity ?? ingredient.qty);
  if (rawQuantity == null || rawQuantity <= 0) return { ok: false, code: 'ingredient_quantity_invalid' };
  const yieldPercent = number(ingredient.yieldPercent ?? recipe.yieldPercent);
  if (yieldPercent != null && (yieldPercent <= 0 || yieldPercent > 100)) return { ok: false, code: 'yield_percent_invalid' };
  const quantityBasis = String(ingredient.quantityBasis || ingredient.quantity_basis || 'usable');
  if (!['raw', 'usable'].includes(quantityBasis)) return { ok: false, code: 'quantity_basis_invalid' };
  const adjusted = rawQuantity / recipePortions(recipe) / (quantityBasis === 'usable' ? ((yieldPercent || 100) / 100) : 1);
  const converted = convertQuantity(adjusted, ingredient.unit || item.unit, item.unit, item.conversions);
  if (!converted.ok) return converted;
  return { ok: true, value: converted.value, source: converted.source };
}

function calculateRecipeCapacity({ items = [], recipes = [], branchId = null } = {}) {
  const scopedItems = list(items).filter((row) => sameBranch(row, branchId));
  const itemMap = new Map(scopedItems.map((row) => [String(row.id), row]));
  return list(recipes).filter((row) => sharedOrBranch(row, branchId)).map((recipe) => {
    const issues = [];
    const ingredients = list(recipe.ingredients).map((ingredient) => {
      const item = itemMap.get(String(ingredient.itemId));
      if (!item) {
        const issue = { code: 'ingredient_item_missing', itemId: ingredient.itemId || null };
        issues.push(issue);
        return { itemId: ingredient.itemId || null, name: ingredient.name || 'ماده نامشخص', capacity: null, issue };
      }
      const available = availableQuantity(item);
      const required = ingredientRequirement(ingredient, recipe, item);
      if (!available.ok || !required.ok) {
        const issue = { code: available.ok ? required.code : available.code, itemId: item.id };
        issues.push(issue);
        return { itemId: item.id, name: item.name || ingredient.name || item.id, capacity: null, issue };
      }
      if (available.negative) issues.push({ code: 'negative_available_quantity', itemId: item.id, rawQuantity: available.raw });
      const capacity = Math.floor(available.value / required.value);
      return {
        itemId: item.id, name: item.name || ingredient.name || item.id, unit: canonicalUnit(item.unit) || item.unit,
        availableQuantity: available.value, requiredPerPortion: required.value, capacity,
      };
    });
    const valid = ingredients.filter((row) => Number.isFinite(row.capacity));
    const complete = ingredients.length > 0 && valid.length === ingredients.length;
    const capacity = complete ? Math.min(...valid.map((row) => row.capacity)) : null;
    const limiting = complete ? valid.find((row) => row.capacity === capacity) : null;
    return {
      recipeId: recipe.id || null, menuItemId: recipe.menuItemId || null, name: recipe.name || recipe.menuItemName || 'رسپی بدون نام',
      version: recipe.version || recipe.versionId || null,
      status: complete ? 'available' : 'insufficient_data', capacity,
      limitingIngredient: limiting ? { itemId: limiting.itemId, name: limiting.name, capacity: limiting.capacity } : null,
      ingredients, issues,
    };
  });
}

function orderDate(order) { return new Date(order.paidAt || order.createdAt || order.date || 0); }

function effectiveRecipeForSale(recipes, menuItemId, soldAt) {
  const candidates = list(recipes).filter((recipe) => String(recipe.menuItemId) === String(menuItemId));
  if (!candidates.length) return null;
  const at = new Date(soldAt).getTime();
  const versioned = candidates.filter((recipe) => recipe.effectiveFrom || recipe.effectiveTo);
  if (versioned.length && Number.isFinite(at)) {
    const effective = versioned.filter((recipe) => {
      const start = recipe.effectiveFrom ? new Date(recipe.effectiveFrom).getTime() : -Infinity;
      const end = recipe.effectiveTo ? new Date(recipe.effectiveTo).getTime() : Infinity;
      return !Number.isNaN(start) && !Number.isNaN(end) && at >= start && at < end;
    }).sort((a, b) => new Date(b.effectiveFrom || 0) - new Date(a.effectiveFrom || 0));
    return effective[0] || null;
  }
  return latestRecipes(candidates)[0] || null;
}

function historyWindow(orders, from, to) {
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  const validDates = orders.map(orderDate).filter((date) => Number.isFinite(date.getTime())).sort((a, b) => a - b);
  const actualStart = start && Number.isFinite(start.getTime()) ? start : validDates[0];
  const actualEnd = end && Number.isFinite(end.getTime()) ? end : validDates.at(-1);
  if (!actualStart || !actualEnd || actualStart > actualEnd) return { days: 0, from: null, to: null };
  return { days: Math.max(1, Math.floor((actualEnd - actualStart) / 86400000) + 1), from: actualStart, to: actualEnd };
}

function calculateStockoutForecast({ items = [], recipes = [], orders = [], branchId = null, from = null, to = null, minHistoryDays = 14 } = {}) {
  const fromAt = from ? new Date(from).getTime() : null;
  const toAt = to ? new Date(to).getTime() : null;
  const paidOrders = list(orders).filter((order) => {
    if (!isPaid(order) || !sameBranch(order, branchId)) return false;
    const at = orderDate(order).getTime();
    if (!Number.isFinite(at)) return false;
    if (Number.isFinite(fromAt) && at < fromAt) return false;
    if (Number.isFinite(toAt) && at > toAt) return false;
    return true;
  });
  const window = historyWindow(paidOrders, from, to);
  if (window.days < minHistoryDays) {
    return { status: 'insufficient_data', historyDays: window.days, minimumHistoryDays: minHistoryDays, items: [], recipeCoveragePercent: null };
  }
  const scopedRecipes = list(recipes).filter((row) => sharedOrBranch(row, branchId));
  const itemMap = new Map(list(items).filter((row) => sameBranch(row, branchId)).map((item) => [String(item.id), item]));
  const usage = new Map();
  let soldLines = 0;
  let coveredLines = 0;
  for (const order of paidOrders) {
    for (const line of list(order.items)) {
      soldLines += 1;
      const recipe = effectiveRecipeForSale(scopedRecipes, line.menuItemId, orderDate(order));
      if (!recipe) continue;
      coveredLines += 1;
      const soldQty = number(line.qty ?? line.quantity) || 0;
      for (const ingredient of list(recipe.ingredients)) {
        const item = itemMap.get(String(ingredient.itemId));
        if (!item) continue;
        const required = ingredientRequirement(ingredient, recipe, item);
        if (!required.ok) continue;
        usage.set(String(item.id), (usage.get(String(item.id)) || 0) + required.value * soldQty);
      }
    }
  }
  const rows = [];
  for (const [itemId, totalUsage] of usage) {
    const item = itemMap.get(itemId);
    const available = availableQuantity(item);
    const dailyUsage = totalUsage / window.days;
    if (!available.ok || dailyUsage <= 0) continue;
    const daysRemaining = available.value / dailyUsage;
    const forecastDate = new Date((window.to || new Date()).getTime() + Math.ceil(daysRemaining) * 86400000).toISOString().slice(0, 10);
    rows.push({
      itemId: item.id, name: item.name || item.id, unit: canonicalUnit(item.unit) || item.unit,
      availableQuantity: available.value, averageDailyUsage: dailyUsage, daysRemaining, forecastDate,
      reorderPoint: number(item.minStock ?? item.reorderPoint),
      urgency: daysRemaining <= 3 ? 'critical' : daysRemaining <= 7 ? 'warning' : 'normal',
    });
  }
  rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return {
    status: rows.length ? (coveredLines === soldLines ? 'available' : 'partial_coverage') : 'insufficient_data',
    historyDays: window.days, minimumHistoryDays: minHistoryDays, items: rows,
    recipeCoveragePercent: soldLines ? Math.round(coveredLines / soldLines * 10000) / 100 : null,
  };
}

function calculateBreakEven({ fixedCostsIrr, sales = [], realizedNetSalesIrr = null, remainingOpenDays = null } = {}) {
  const fixedRows = Array.isArray(fixedCostsIrr) ? fixedCostsIrr : [fixedCostsIrr];
  const normalizedFixed = fixedRows.map(int);
  if (!normalizedFixed.length || normalizedFixed.some((value) => value == null || value < 0)) {
    return { status: 'insufficient_data', reason: 'fixed_costs_missing', breakEvenSalesIrr: null };
  }
  const rows = list(sales).map((row) => ({ revenueIrr: int(row.revenueIrr), variableCostIrr: int(row.variableCostIrr) }));
  if (!rows.length || rows.some((row) => row.revenueIrr == null || row.variableCostIrr == null || row.revenueIrr < 0 || row.variableCostIrr < 0)) {
    return { status: 'insufficient_data', reason: 'contribution_data_missing', breakEvenSalesIrr: null };
  }
  const revenueIrr = rows.reduce((sum, row) => sum + row.revenueIrr, 0);
  const variableCostIrr = rows.reduce((sum, row) => sum + row.variableCostIrr, 0);
  const contributionIrr = revenueIrr - variableCostIrr;
  if (revenueIrr <= 0 || contributionIrr <= 0) {
    return { status: 'insufficient_data', reason: 'positive_contribution_required', breakEvenSalesIrr: null, revenueIrr, variableCostIrr, contributionIrr };
  }
  const totalFixedCostsIrr = normalizedFixed.reduce((sum, value) => sum + value, 0);
  const contributionMarginRatio = contributionIrr / revenueIrr;
  const breakEvenSalesIrr = Math.ceil(totalFixedCostsIrr / contributionMarginRatio);
  const realized = int(realizedNetSalesIrr) ?? revenueIrr;
  const gapIrr = Math.max(0, breakEvenSalesIrr - realized);
  const days = int(remainingOpenDays);
  return {
    status: 'available', totalFixedCostsIrr, revenueIrr, variableCostIrr, contributionIrr,
    contributionMarginRatio, breakEvenSalesIrr, realizedNetSalesIrr: realized, gapIrr,
    requiredDailySalesIrr: days != null && days > 0 ? Math.ceil(gapIrr / days) : null,
    remainingOpenDays: days != null && days > 0 ? days : null,
  };
}

function latestRecipes(recipes) {
  const selected = new Map();
  for (const recipe of list(recipes)) {
    const key = String(recipe.menuItemId ?? recipe.id ?? '');
    if (!key) continue;
    const current = selected.get(key);
    const at = new Date(recipe.effectiveFrom || recipe.updatedAt || 0).getTime() || 0;
    const currentAt = current ? (new Date(current.effectiveFrom || current.updatedAt || 0).getTime() || 0) : -1;
    if (!current || at >= currentAt) selected.set(key, recipe);
  }
  return [...selected.values()];
}

function deriveRestaurantIntelligence(db, query = {}) {
  const accounting = db.accounting || {};
  const branchId = query.branchId ? Number(query.branchId) : null;
  const shadowMovementByItem = new Map();
  for (const movement of list(db.financeV2?.inventoryMovements).filter((row) => sameBranch(row, branchId))) {
    const key = String(movement.itemId);
    shadowMovementByItem.set(key, (shadowMovementByItem.get(key) || 0) + (number(movement.quantityBase) || 0));
  }
  const items = list(accounting.inventoryItems).filter((row) => sameBranch(row, branchId)).map((row) => ({
    ...row,
    qtyOnHand: (number(row.qtyOnHand ?? row.onHand ?? row.quantity) || 0) + (shadowMovementByItem.get(String(row.id)) || 0),
  }));
  const allRecipes = list(accounting.recipes).filter((row) => sharedOrBranch(row, branchId));
  const recipes = latestRecipes(allRecipes);
  const orders = list(db.orders).filter((row) => sameBranch(row, branchId));
  const capacity = calculateRecipeCapacity({ items, recipes, branchId });
  const stockout = calculateStockoutForecast({ items, recipes: allRecipes, orders, branchId, from: query.from, to: query.to });
  const explicitFixedCosts = accounting.restaurantPlanning?.fixedCostsIrr;
  const explicitSalesMix = accounting.restaurantPlanning?.salesMix;
  const breakEven = calculateBreakEven({ fixedCostsIrr: explicitFixedCosts, sales: explicitSalesMix });
  return {
    recipeCapacity: capacity,
    stockoutForecast: stockout,
    breakEven,
    dataQuality: {
      recipeCount: recipes.length,
      capacityReady: capacity.filter((row) => row.status === 'available').length,
      fixedCostPlanAvailable: Array.isArray(explicitFixedCosts) && explicitFixedCosts.length > 0,
      shadowInventoryMovementCount: list(db.financeV2?.inventoryMovements).filter((row) => sameBranch(row, branchId)).length,
      moneyPolicy: 'Only explicit IRR planning fields are eligible for break-even; ambiguous legacy amounts are not converted.',
    },
  };
}

module.exports = {
  canonicalUnit,
  convertQuantity,
  availableQuantity,
  calculateRecipeCapacity,
  calculateStockoutForecast,
  calculateBreakEven,
  deriveRestaurantIntelligence,
  latestRecipes,
  effectiveRecipeForSale,
  ingredientRequirement,
};

'use strict';

const valueContracts = require('./value-contracts');

const PAID_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const UNIT_ALIASES = valueContracts.UNIT_ALIASES;
const UNIT_META = valueContracts.UNIT_META;

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) {
  try {
    return valueContracts.parseDecimal(value, { emptyValue: null, label: 'عدد' });
  } catch {
    return null;
  }
}
function int(value) { return Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function canonicalUnit(value) { return valueContracts.canonicalUnit(value); }
function sameBranch(row, branchId) { return !branchId || Number(row?.branchId) === Number(branchId); }
function sharedOrBranch(row, branchId) { return row?.branchId == null || sameBranch(row, branchId); }
function isPaid(order) {
  if (order?.paymentStatus === 'unpaid' || order?.paymentStatus === 'pending') return false;
  return order?.paymentStatus === 'paid' || PAID_STATUSES.has(String(order?.status || ''));
}

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
  return valueContracts.convertQuantity(quantity, from, to, conversions);
}

function availableQuantity(item) {
  const onHand = number(item.qtyOnHand ?? item.onHand ?? item.quantity);
  if (onHand == null) return { ok: false, code: 'on_hand_missing', value: null };
  const reserved = number(item.reservedQty ?? item.qtyReserved) || 0;
  const quarantined = number(item.quarantinedQty ?? item.qtyQuarantined) || 0;
  const expired = number(item.expiredQty ?? item.qtyExpired) || 0;
  const safetyStock = number(item.safetyStockBase ?? item.safetyStockQty ?? item.safetyStock) || 0;
  const raw = onHand - reserved - quarantined - expired;
  return { ok: true, value: Math.max(0, raw), raw, negative: raw < 0, safetyStock };
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
  const numBranch = Number(branchId);
  const branchSuffix = numBranch ? `-b${numBranch}`.toLowerCase() : null;
  const itemMap = new Map();
  for (const row of scopedItems) {
    const idStr = String(row.id || '').trim();
    const skuStr = String(row.sku || '').trim();
    if (idStr) {
      itemMap.set(idStr, row);
      itemMap.set(idStr.toLowerCase(), row);
      if (branchSuffix && idStr.toLowerCase().endsWith(branchSuffix)) {
        const base = idStr.slice(0, -branchSuffix.length);
        if (base && !itemMap.has(base)) {
          itemMap.set(base, row);
          itemMap.set(base.toLowerCase(), row);
        }
      }
    }
    if (skuStr) {
      itemMap.set(skuStr, row);
      itemMap.set(skuStr.toLowerCase(), row);
      itemMap.set(`sku:${skuStr}`, row);
      itemMap.set(`sku:${skuStr.toLowerCase()}`, row);
      if (branchSuffix && skuStr.toLowerCase().endsWith(branchSuffix)) {
        const baseSku = skuStr.slice(0, -branchSuffix.length);
        if (baseSku && !itemMap.has(`sku:${baseSku}`)) {
          itemMap.set(`sku:${baseSku}`, row);
          itemMap.set(`sku:${baseSku.toLowerCase()}`, row);
          itemMap.set(baseSku, row);
          itemMap.set(baseSku.toLowerCase(), row);
        }
      }
    }
  }
  return list(recipes).filter((row) => sharedOrBranch(row, branchId)).map((recipe) => {
    const issues = [];
    const ingredients = list(recipe.ingredients).map((ingredient) => {
      const ingredientKey = String(ingredient.itemId ?? '').trim();
      const item = itemMap.get(ingredientKey)
        || itemMap.get(ingredientKey.toLowerCase())
        || itemMap.get(`sku:${ingredientKey}`)
        || itemMap.get(`sku:${ingredientKey.toLowerCase()}`)
        || (branchSuffix ? (itemMap.get(`${ingredientKey}${branchSuffix}`) || itemMap.get(`${ingredientKey.toLowerCase()}${branchSuffix}`)) : null);
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

function recipeCatalog(db, branchId = null, { includePending = false } = {}) {
  const legacy = list(db?.accounting?.recipes).filter((row) => sharedOrBranch(row, branchId));
  const allowedStatuses = includePending
    ? new Set(['draft', 'pending_approval', 'approved', 'retired', 'rejected'])
    : new Set(['approved', 'retired']);
  const v2 = list(db?.financeV2?.recipeVersions)
    .filter((row) => sharedOrBranch(row, branchId) && allowedStatuses.has(String(row.status || 'draft')));
  const byId = new Map();
  legacy.forEach((row) => byId.set(String(row.id), row));
  v2.forEach((row) => byId.set(String(row.id), row));
  return [...byId.values()];
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

const TEHRAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

function calendarDateKey(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(TEHRAN_DATE_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarKeys(fromDate, toDate) {
  const fromKey = calendarDateKey(fromDate);
  const toKey = calendarDateKey(toDate);
  if (!fromKey || !toKey || fromKey > toKey) return [];
  const keys = [];
  for (let key = fromKey; key <= toKey; key = addCalendarDays(key, 1)) keys.push(key);
  return keys;
}

function weekdayIndex(dateKey) { return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay(); }

function weekdayProfile(dailyUsage, keys) {
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  keys.forEach((key) => {
    const weekday = weekdayIndex(key);
    totals[weekday] += dailyUsage.get(key) || 0;
    counts[weekday] += 1;
  });
  return totals.map((total, weekday) => counts[weekday] ? total / counts[weekday] : 0);
}

function weekdayBacktestWape(dailyUsage, keys) {
  if (keys.length < 28) return null;
  const splitAt = Math.max(14, Math.floor(keys.length * 0.7));
  const training = keys.slice(0, splitAt);
  const validation = keys.slice(splitAt);
  if (validation.length < 7) return null;
  const profile = weekdayProfile(dailyUsage, training);
  let absoluteError = 0;
  let actualTotal = 0;
  validation.forEach((key) => {
    const actual = dailyUsage.get(key) || 0;
    const predicted = profile[weekdayIndex(key)] || 0;
    absoluteError += Math.abs(actual - predicted);
    actualTotal += actual;
  });
  return actualTotal > 0 ? Math.round(absoluteError / actualTotal * 10000) / 100 : null;
}

function calculateStockoutForecast({
  items = [], recipes = [], orders = [], purchaseOrders = [], branchId = null,
  from = null, to = null, minHistoryDays = 14, forecastHorizonDays = 365,
} = {}) {
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
  const branchItems = list(items).filter((row) => sameBranch(row, branchId));
  const itemMap = new Map();
  for (const item of branchItems) {
    itemMap.set(String(item.id), item);
    const baseId = String(item.id).replace(/-b\d+$/, '');
    if (!itemMap.has(baseId)) itemMap.set(baseId, item);
    if (item.sku) itemMap.set(String(item.sku), item);
  }
  const usage = new Map();
  const usageByDateMap = new Map();
  let soldLines = 0;
  let coveredLines = 0;
  const coverageIssues = [];
  for (const order of paidOrders) {
    for (const line of list(order.items)) {
      soldLines += 1;
      const recipe = effectiveRecipeForSale(scopedRecipes, line.menuItemId, orderDate(order));
      if (!recipe) { coverageIssues.push({ code: 'recipe_missing', menuItemId: line.menuItemId || null, orderId: order.id || null }); continue; }
      const soldQty = number(line.qty ?? line.quantity) || 0;
      if (soldQty <= 0 || !list(recipe.ingredients).length) { coverageIssues.push({ code: 'recipe_line_invalid', menuItemId: line.menuItemId || null, orderId: order.id || null }); continue; }
      const contributions = [];
      let covered = true;
      for (const ingredient of list(recipe.ingredients)) {
        const item = itemMap.get(String(ingredient.itemId)) || itemMap.get(String(ingredient.itemId).replace(/-b\d+$/, ''));
        if (!item) { coverageIssues.push({ code: 'ingredient_item_missing', itemId: ingredient.itemId || null, menuItemId: line.menuItemId || null, orderId: order.id || null }); covered = false; break; }
        const required = ingredientRequirement(ingredient, recipe, item);
        if (!required.ok) { coverageIssues.push({ code: required.code, itemId: item.id, menuItemId: line.menuItemId || null, orderId: order.id || null }); covered = false; break; }
        contributions.push({ itemId: String(item.id), quantity: required.value * soldQty });
      }
      if (!covered) continue;
      coveredLines += 1;
      const saleDateKey = calendarDateKey(orderDate(order));
      contributions.forEach((row) => {
        usage.set(row.itemId, (usage.get(row.itemId) || 0) + row.quantity);
        if (!usageByDateMap.has(row.itemId)) usageByDateMap.set(row.itemId, new Map());
        const byDate = usageByDateMap.get(row.itemId);
        if (saleDateKey) byDate.set(saleDateKey, (byDate.get(saleDateKey) || 0) + row.quantity);
      });
    }
  }
  const historyKeys = calendarKeys(window.from, window.to);
  const anchorDate = calendarDateKey(window.to);
  const inboundIssues = [];
  const inboundByItem = new Map();
  list(purchaseOrders).filter((po) => sameBranch(po, branchId) && ['approved', 'partially_received'].includes(po.status)).forEach((po) => {
    const expectedDate = calendarDateKey(po.expectedDate);
    for (const line of list(po.lines)) {
      const remainingQuantity = Math.max(0, (number(line.quantity) || 0) - (number(line.receivedQuantity) || 0));
      if (!remainingQuantity) continue;
      if (!expectedDate) {
        inboundIssues.push({ code: 'approved_po_expected_date_missing', purchaseOrderId: po.id || null, itemId: line.itemId || null });
        continue;
      }
      if (expectedDate <= anchorDate) {
        inboundIssues.push({ code: 'approved_po_overdue_not_assumed_received', purchaseOrderId: po.id || null, itemId: line.itemId || null, expectedDate, quantity: remainingQuantity });
        continue;
      }
      const itemId = String(line.itemId);
      if (!inboundByItem.has(itemId)) inboundByItem.set(itemId, []);
      inboundByItem.get(itemId).push({ purchaseOrderId: po.id || null, purchaseOrderNumber: po.number || null, expectedDate, quantity: remainingQuantity });
    }
  });
  const rows = [];
  for (const [itemId, totalUsage] of usage) {
    const item = itemMap.get(itemId);
    const available = availableQuantity(item);
    const averageDailyUsage = totalUsage / window.days;
    if (!available.ok || averageDailyUsage <= 0 || !anchorDate) continue;
    const itemDailyUsage = usageByDateMap.get(itemId);
    const byDate = itemDailyUsage instanceof Map ? itemDailyUsage : new Map();
    const usageByWeekday = weekdayProfile(byDate, historyKeys);
    const backtestWapePercent = weekdayBacktestWape(byDate, historyKeys);
    const inboundSchedule = list(inboundByItem.get(itemId)).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const inboundByDate = new Map();
    inboundSchedule.forEach((row) => inboundByDate.set(row.expectedDate, (inboundByDate.get(row.expectedDate) || 0) + row.quantity));
    let projectedQuantity = available.value;
    let forecastDate = null;
    let daysRemaining = null;
    for (let day = 1; day <= forecastHorizonDays; day += 1) {
      const dateKey = addCalendarDays(anchorDate, day);
      projectedQuantity += inboundByDate.get(dateKey) || 0;
      projectedQuantity -= usageByWeekday[weekdayIndex(dateKey)] || 0;
      if (projectedQuantity <= 1e-9) { forecastDate = dateKey; daysRemaining = day; break; }
    }
    const leadTimeDays = number(item.leadTimeDays ?? item.supplierLeadTimeDays);
    const safetyDays = number(item.safetyDays ?? item.safetyLeadDays);
    const reorderByDate = forecastDate && leadTimeDays != null && leadTimeDays >= 0
      ? addCalendarDays(forecastDate, -Math.ceil(leadTimeDays + Math.max(0, safetyDays || 0))) : null;
    const reorderPoint = number(item.minStock ?? item.reorderPoint);
    const projectedInboundQuantity = inboundSchedule.reduce((sum, row) => sum + row.quantity, 0);
    const confidence = coveredLines !== soldLines || backtestWapePercent == null ? 'low'
      : window.days >= 56 && backtestWapePercent <= 25 ? 'high'
        : window.days >= 28 && backtestWapePercent <= 50 ? 'medium' : 'low';
    const daysUntilReorder = reorderByDate ? Math.floor((new Date(`${reorderByDate}T00:00:00.000Z`) - new Date(`${anchorDate}T00:00:00.000Z`)) / 86400000) : null;
    rows.push({
      itemId: item.id, name: item.name || item.id, unit: canonicalUnit(item.unit) || item.unit,
      availableQuantity: available.value, averageDailyUsage, weekdayAverageUsage: usageByWeekday,
      daysRemaining, forecastDate, forecastStatus: forecastDate ? 'stockout_projected' : 'beyond_horizon',
      forecastHorizonDays, leadTimeDays: leadTimeDays != null && leadTimeDays >= 0 ? leadTimeDays : null,
      safetyDays: safetyDays != null && safetyDays >= 0 ? safetyDays : null,
      reorderPoint, reorderByDate, projectedInboundQuantity, inboundSchedule,
      backtestWapePercent, confidence,
      urgency: daysUntilReorder != null && daysUntilReorder <= 0 ? 'critical' : daysUntilReorder != null && daysUntilReorder <= 3 ? 'warning' : 'normal',
    });
  }
  rows.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
  return {
    status: rows.length ? (coveredLines === soldLines ? 'available' : 'partial_coverage') : 'insufficient_data',
    historyDays: window.days, minimumHistoryDays: minHistoryDays, items: rows,
    asOfDate: anchorDate, forecastMethod: 'weekday_consumption_with_approved_po', forecastHorizonDays,
    recipeCoveragePercent: soldLines ? Math.round(coveredLines / soldLines * 10000) / 100 : null,
    coverageIssues, inboundIssues,
    policy: {
      paidOrdersOnly: true, effectiveRecipeVersionRequired: true, completeLineCoverageRequired: true,
      approvedFuturePurchaseOrdersIncluded: true, overduePurchaseOrdersNotAssumedReceived: true,
      safetyStockTrackedSeparatelyFromAvailable: true, safetyDaysRequireExplicitItemValue: true,
    },
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
  const allRecipes = recipeCatalog(db, branchId);
  const recipes = latestRecipes(allRecipes);
  const orders = list(db.orders).filter((row) => sameBranch(row, branchId));
  const capacity = calculateRecipeCapacity({ items, recipes, branchId });
  const stockout = calculateStockoutForecast({ items, recipes: allRecipes, orders, purchaseOrders: db.financeV2?.purchaseOrders, branchId, from: query.from, to: query.to });
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
  recipeCatalog,
  ingredientRequirement,
};

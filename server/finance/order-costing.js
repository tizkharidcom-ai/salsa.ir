'use strict';

const crypto = require('crypto');
const {
  canonicalUnit,
  effectiveRecipeForSale,
  ingredientRequirement,
  recipeCatalog,
} = require('./restaurant-intelligence');

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function safeIrr(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null; }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`; }
function sameBranch(row, branchId) { return row?.branchId == null || Number(row.branchId) === Number(branchId); }

function legacyOrderAmountToIrr(value) {
  const amount = number(value);
  if (amount == null || amount < 0) return null;
  const irr = Math.round(amount) * 10;
  return Number.isSafeInteger(irr) ? irr : null;
}

function unitCostIrr(item, ingredient, settings = {}) {
  const explicit = [
    ['inventory_avg_cost_irr', item?.avgCostIrr],
    ['inventory_unit_cost_irr', item?.unitCostIrr],
    ['recipe_unit_cost_irr', ingredient?.unitCostIrr],
  ];
  for (const [source, value] of explicit) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const amount = safeIrr(value);
    if (amount == null) return { ok: false, code: 'inventory_cost_unsafe' };
    return { ok: true, amountIrr: amount, source };
  }

  const policy = String(settings.legacyInventoryCostUnit || '').toUpperCase();
  const legacy = item?.avgCost ?? item?.unitCost ?? ingredient?.unitCost;
  const amount = number(legacy);
  if (amount == null || amount < 0 || !['IRR', 'TOMAN'].includes(policy)) {
    return { ok: false, code: 'inventory_cost_unit_ambiguous' };
  }
  const amountIrr = Math.round(amount) * (policy === 'TOMAN' ? 10 : 1);
  if (!Number.isSafeInteger(amountIrr)) return { ok: false, code: 'inventory_cost_unsafe' };
  return { ok: true, amountIrr, source: `legacy_inventory_cost_${policy.toLowerCase()}` };
}

function movementBalance(state, itemId, branchId) {
  let balance = 0;
  for (const row of list(state?.inventoryMovements)) {
    if (String(row.itemId) !== String(itemId) || !sameBranch(row, branchId)) continue;
    const quantity = number(row.quantityBase);
    if (quantity == null) return { ok: false, code: 'inventory_movement_quantity_invalid' };
    balance += quantity;
    if (!Number.isFinite(balance)) return { ok: false, code: 'inventory_movement_quantity_unsafe' };
  }
  return { ok: true, value: balance };
}

function physicalAvailable(item, state, branchId) {
  const onHand = number(item?.qtyOnHand ?? item?.onHand ?? item?.quantity);
  if (onHand == null) return { ok: false, code: 'on_hand_missing' };
  if (onHand < 0) return { ok: false, code: 'negative_on_hand' };
  const controls = [
    ['reservedQty', 'qtyReserved', 'reserved_quantity_invalid'],
    ['quarantinedQty', 'qtyQuarantined', 'quarantined_quantity_invalid'],
    ['expiredQty', 'qtyExpired', 'expired_quantity_invalid'],
  ];
  const values = {};
  for (const [primary, fallback, code] of controls) {
    const raw = item?.[primary] ?? item?.[fallback];
    const value = raw === undefined || raw === null || raw === '' ? 0 : number(raw);
    if (value == null || value < 0) return { ok: false, code };
    values[primary] = value;
  }
  const shadow = movementBalance(state, item.id, branchId);
  if (!shadow.ok) return shadow;
  const { reservedQty: reserved, quarantinedQty: quarantined, expiredQty: expired } = values;
  const shadowMovement = shadow.value;
  return { ok: true, value: onHand - reserved - quarantined - expired + shadowMovement, openingOnHand: onHand, shadowMovement };
}

function orderLineSalesIrr(line) {
  for (const value of [line?.netSalesIrr, line?.lineTotalIrr]) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const amount = safeIrr(value);
    if (amount != null) return amount;
    return null;
  }
  return legacyOrderAmountToIrr(line?.lineTotal ?? ((number(line?.unitTotal ?? line?.price) || 0) * (number(line?.qty ?? line?.quantity) || 0)));
}

function buildOrderCosting(db, order) {
  const state = db.financeV2 || {};
  const accounting = db.accounting || {};
  const branchId = Number(order?.branchId) || null;
  const occurredAt = order?.paidAt || order?.createdAt;
  const issues = [];
  if (!branchId) issues.push({ code: 'branch_missing', message: 'شعبهٔ سفارش مشخص نیست.' });
  if (!Number.isFinite(new Date(occurredAt).getTime())) issues.push({ code: 'sale_date_invalid', message: 'زمان قطعی فروش معتبر نیست.' });

  const items = list(accounting.inventoryItems).filter((row) => sameBranch(row, branchId));
  const itemMap = new Map();
  items.forEach((row) => {
    itemMap.set(String(row.id), row);
    if (row.sku != null && String(row.sku).trim()) itemMap.set(`sku:${String(row.sku).trim()}`, row);
  });
  const recipes = recipeCatalog(db, branchId);
  const snapshots = [];
  const usage = new Map();

  for (const [index, line] of list(order?.items).entries()) {
    const orderLineKey = String(line.id ?? line.orderLineId ?? `${index + 1}`);
    const quantity = number(line.qty ?? line.quantity);
    const menuItemId = line.menuItemId ?? line.itemId ?? line.productId ?? line.id;
    if (quantity == null || quantity <= 0) {
      issues.push({ code: 'order_line_quantity_invalid', orderLineKey, menuItemId: menuItemId ?? null });
      continue;
    }
    const recipe = effectiveRecipeForSale(recipes, menuItemId, occurredAt);
    if (!recipe) {
      issues.push({ code: 'effective_recipe_missing', orderLineKey, menuItemId: menuItemId ?? null });
      continue;
    }
    if (!list(recipe.ingredients).length) {
      issues.push({ code: 'recipe_ingredients_missing', orderLineKey, recipeVersionId: recipe.id ?? null });
      continue;
    }

    const components = [];
    let lineCogsIrr = 0;
    let lineComplete = true;
    for (const ingredient of list(recipe.ingredients)) {
      const ingredientKey = String(ingredient.itemId ?? '').trim();
      const item = itemMap.get(ingredientKey) || itemMap.get(`sku:${ingredientKey}`);
      if (!item) {
        issues.push({ code: 'ingredient_item_missing', orderLineKey, itemId: ingredient.itemId ?? null, recipeVersionId: recipe.id ?? null });
        lineComplete = false;
        continue;
      }
      const required = ingredientRequirement({
        ...ingredient,
        quantityBasis: ingredient.quantityBasis ?? ingredient.quantity_basis ?? 'raw',
      }, recipe, item);
      if (!required.ok) {
        issues.push({ code: required.code, orderLineKey, itemId: item.id, recipeVersionId: recipe.id ?? null });
        lineComplete = false;
        continue;
      }
      const cost = unitCostIrr(item, ingredient, state.settings);
      if (!cost.ok) {
        issues.push({ code: cost.code, orderLineKey, itemId: item.id, recipeVersionId: recipe.id ?? null });
        lineComplete = false;
        continue;
      }
      const quantityBase = required.value * quantity;
      const componentCostIrr = Math.round(quantityBase * cost.amountIrr);
      if (!Number.isFinite(quantityBase) || quantityBase <= 0 || !Number.isSafeInteger(componentCostIrr)) {
        issues.push({ code: 'component_cost_unsafe', orderLineKey, itemId: item.id, recipeVersionId: recipe.id ?? null });
        lineComplete = false;
        continue;
      }
      const component = {
        itemId: String(item.id), itemName: item.name || ingredient.name || String(item.id),
        quantityBase, baseUnit: canonicalUnit(item.unit) || item.unit,
        unitCostIrr: cost.amountIrr, componentCostIrr, costSource: cost.source,
      };
      components.push(component);
      lineCogsIrr += componentCostIrr;
      const aggregate = usage.get(String(item.id)) || { item, quantityBase: 0, totalCostIrr: 0, costSources: new Set(), recipeVersionIds: new Set() };
      aggregate.quantityBase += quantityBase;
      aggregate.totalCostIrr += componentCostIrr;
      aggregate.costSources.add(cost.source);
      aggregate.recipeVersionIds.add(String(recipe.id ?? recipe.versionId ?? recipe.version ?? 'unknown'));
      usage.set(String(item.id), aggregate);
    }
    if (!lineComplete) continue;
    const netSalesIrr = orderLineSalesIrr(line);
    if (netSalesIrr == null) {
      issues.push({ code: 'order_line_sales_amount_invalid', orderLineKey, menuItemId: line.menuItemId ?? null });
      continue;
    }
    snapshots.push({
      id: id(), orderId: String(order.id), orderLineKey, orderLineNo: index + 1, branchId,
      menuItemId: line.menuItemId == null ? null : String(line.menuItemId), itemName: line.name || null,
      quantity, netSalesIrr, recipeVersionId: String(recipe.id ?? recipe.versionId ?? recipe.version ?? ''),
      recipeVersion: recipe.version ?? null, theoreticalCogsIrr: lineCogsIrr,
      components, capturedAt: new Date().toISOString(),
    });
  }

  if (!list(order?.items).length) issues.push({ code: 'order_items_missing', message: 'اقلام سفارش برای محاسبهٔ رسپی موجود نیست.' });
  if (snapshots.length !== list(order?.items).length) {
    issues.push({ code: 'order_recipe_coverage_incomplete', coveredLines: snapshots.length, totalLines: list(order?.items).length });
  }

  for (const [itemId, aggregate] of usage) {
    const available = physicalAvailable(aggregate.item, state, branchId);
    if (!available.ok) {
      issues.push({ code: available.code, itemId });
      continue;
    }
    if (available.value + 1e-9 < aggregate.quantityBase) {
      issues.push({
        code: 'inventory_shortage', itemId, requiredQuantityBase: aggregate.quantityBase,
        availableQuantityBase: available.value, openingOnHand: available.openingOnHand,
        priorShadowMovement: available.shadowMovement,
      });
    }
  }

  const complete = issues.length === 0 && snapshots.length > 0;
  const totalCogsIrr = complete ? snapshots.reduce((sum, row) => sum + row.theoreticalCogsIrr, 0) : null;
  const movements = complete ? [...usage.entries()].map(([itemId, aggregate]) => ({
    id: id(), branchId, itemId, movementType: 'sale_consumption', quantityBase: -aggregate.quantityBase,
    unitCostIrr: aggregate.quantityBase > 0 ? Math.round(aggregate.totalCostIrr / aggregate.quantityBase) : 0,
    totalCostIrr: aggregate.totalCostIrr, orderId: String(order.id), source: 'order.cogs',
    sourceId: String(order.id), recipeVersionIds: [...aggregate.recipeVersionIds], costSources: [...aggregate.costSources],
    occurredAt, createdAt: new Date().toISOString(), reversalOfId: null,
  })) : [];
  return {
    ok: complete,
    code: complete ? null : (issues[0]?.code || 'order_costing_incomplete'),
    message: complete ? null : 'رسپی، واحد، بهای ریالی یا موجودی سفارش برای ثبت بهای تمام‌شده کامل و قابل اتکا نیست.',
    branchId, occurredAt, snapshots: complete ? snapshots : [], movements,
    issues, totalCogsIrr,
  };
}

module.exports = {
  buildOrderCosting,
  legacyOrderAmountToIrr,
  orderLineSalesIrr,
  physicalAvailable,
  unitCostIrr,
};

'use strict';

const { canonicalUnit, ingredientRequirement } = require('./restaurant-intelligence');

function list(value) { return Array.isArray(value) ? value : []; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function normalizedBranchId(branchId) {
  const value = Number(branchId);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}
function sameBranch(row, branchId) { return branchId == null || row?.branchId == null || Number(row.branchId) === Number(branchId); }
function findItem(items, itemId, branchId) {
  const key = String(itemId ?? '').trim();
  const scoped = list(items).filter((item) => sameBranch(item, branchId));
  const matches = scoped.filter((item) => String(item.id) === key || String(item.sku || '').trim() === key);
  if (matches.length > 1) throw new Error(`مادهٔ اولیهٔ «${key}» در محدودهٔ انتخاب‌شده مبهم است؛ شعبهٔ رسپی را مشخص کنید.`);
  return matches[0] || null;
}

function unitCost(item, ingredient) {
  const value = item?.avgCostIrr ?? item?.unitCostIrr ?? item?.avgCost ?? item?.unitCost ?? ingredient?.unitCost;
  const cost = number(value);
  if (cost == null || cost < 0 || !Number.isSafeInteger(Math.round(cost))) throw new Error('بهای واحد مادهٔ اولیه معتبر نیست.');
  return cost;
}

function availableQuantity(item) {
  const onHand = number(item?.qtyOnHand ?? item?.onHand ?? item?.quantity);
  if (onHand == null || onHand < 0) throw new Error('موجودی مادهٔ اولیه معتبر نیست.');
  const unavailable = [
    ['reservedQty', 'qtyReserved'],
    ['quarantinedQty', 'qtyQuarantined'],
    ['expiredQty', 'qtyExpired'],
  ].reduce((sum, [primary, fallback]) => {
    const raw = item?.[primary] ?? item?.[fallback] ?? 0;
    const value = number(raw === '' ? 0 : raw);
    if (value == null || value < 0) throw new Error('موجودی غیرقابل مصرف معتبر نیست.');
    return sum + value;
  }, 0);
  return Math.max(0, onHand - unavailable);
}

function setOnHand(item, value) {
  if (item?.qtyOnHand !== undefined) item.qtyOnHand = value;
  else if (item?.onHand !== undefined) item.onHand = value;
  else item.quantity = value;
}

/**
 * WESTO Advanced F&B Recipe & Cost Optimization Engine
 * Handles Multi-Level BOM, Sub-Recipes (Batch Prep), Yield Shrinkage %,
 * Portion Variance Analysis, and Dynamic What-If Pricing Simulations.
 */

const money = require('./money');

/**
 * Calculates raw weight after shrinkage and cooking yield percentage.
 * Example: 200g cooked steak with 80% yield requires 200 / 0.8 = 250g raw meat.
 */
function defCalculateYieldCost(rawUnitCost, rawQty, yieldPercent = 100) {
  const cost = number(rawUnitCost);
  const quantity = number(rawQty);
  const yieldValue = number(yieldPercent);
  if (cost == null || cost < 0) throw new Error('بهای واحد مادهٔ اولیه معتبر نیست.');
  if (quantity == null || quantity <= 0) throw new Error('مقدار مادهٔ اولیه باید بزرگتر از صفر باشد.');
  if (yieldValue == null || yieldValue <= 0 || yieldValue > 100) throw new Error('بازده باید بین صفر و صد باشد.');
  const yieldRatio = yieldValue / 100;
  const effectiveRawQty = quantity / yieldRatio;
  const lineCost = Math.round(cost * effectiveRawQty);
  if (!Number.isFinite(effectiveRawQty) || !Number.isSafeInteger(lineCost)) throw new Error('بهای محاسبه‌شده از محدودهٔ امن خارج است.');
  return {
    rawQty: quantity,
    effectiveRawQty: Number(effectiveRawQty.toFixed(3)),
    yieldPercent: yieldValue,
    lineCost,
  };
}

/**
 * Sub-Recipe (Batch Prep) Registry and Production Execution.
 * Converts raw ingredients from inventory into a prepared sub-recipe item.
 */
function produceSubRecipeBatch(acc, subRecipeId, batchCount = 1, context = {}) {
  const branchId = normalizedBranchId(context.branchId);
  if (!Array.isArray(acc.inventoryItems)) acc.inventoryItems = [];
  if (!Array.isArray(acc.prepProductionLogs)) acc.prepProductionLogs = [];
  const requestKey = String(context.idempotencyKey || '').trim();
  if (requestKey) {
    const replay = acc.prepProductionLogs.find((log) => log.idempotencyKey === requestKey);
    if (replay) return replay;
  }
  const subRecipe = list(acc.subRecipes).find((s) => String(s.id) === String(subRecipeId) && sameBranch(s, branchId));
  const itemFromOtherBranch = subRecipe ? null : list(acc.subRecipes).find((s) => String(s.id) === String(subRecipeId));
  if (!subRecipe) {
    if (itemFromOtherBranch) throw new Error('دستور تهیه نیمه‌آماده به شعبهٔ دیگری تعلق دارد.');
    throw new Error(`دستور تهیه نیمه‌آماده با شناسه ${subRecipeId} یافت نشد.`);
  }

  const batchMultiplier = number(batchCount);
  if (batchMultiplier == null || batchMultiplier <= 0) throw new Error('تعداد دسته باید بزرگتر از صفر باشد.');
  const baseYieldUnits = number(subRecipe.batchYieldUnits ?? subRecipe.yieldUnits ?? subRecipe.yieldQty ?? subRecipe.yieldQuantity);
  if (baseYieldUnits == null || baseYieldUnits <= 0) throw new Error('بازده دستور تهیه نیمه‌آماده معتبر نیست.');
  const requirements = new Map();
  const ingredientLines = [];

  // Validate and aggregate every input before mutating inventory.
  list(subRecipe.ingredients).forEach((ing) => {
    const invItem = findItem(acc.inventoryItems, ing.itemId, branchId);
    if (!invItem) throw new Error(`مادهٔ اولیهٔ دستور تهیه نیمه‌آماده در این شعبه یافت نشد: ${ing.itemId}`);
    const rawQty = number(ing.qty ?? ing.quantity);
    if (rawQty == null || rawQty <= 0) throw new Error('مقدار مادهٔ اولیهٔ دستور تهیه نیمه‌آماده معتبر نیست.');
    const required = ingredientRequirement({
      ...ing,
      quantity: rawQty,
      quantityBasis: ing.quantityBasis ?? ing.quantity_basis ?? 'raw',
    }, { ...subRecipe, yieldQuantity: 1 }, invItem);
    if (!required.ok) throw new Error(`مقدار یا واحد مادهٔ اولیهٔ دستور تهیه نیمه‌آماده معتبر نیست (${required.code}).`);
    const requiredQty = required.value * batchMultiplier;
    if (!Number.isFinite(requiredQty) || requiredQty <= 0) throw new Error('مقدار مصرف دستور تهیه نیمه‌آماده از محدودهٔ امن خارج است.');
    const existing = requirements.get(String(invItem.id)) || { item: invItem, requiredQty: 0, unitCost: unitCost(invItem, ing) };
    existing.requiredQty += requiredQty;
    requirements.set(String(invItem.id), existing);
    ingredientLines.push({ item: invItem, qtyConsumed: requiredQty, unit: invItem.unit, unitCost: existing.unitCost });
  });
  if (!requirements.size) throw new Error('دستور تهیه نیمه‌آماده حداقل به یک مادهٔ اولیه نیاز دارد.');
  let totalBatchCost = 0;
  for (const requirement of requirements.values()) {
    const available = availableQuantity(requirement.item);
    if (requirement.requiredQty > available + 1e-9) throw new Error('موجودی کافی برای تولید دستور تهیه نیمه‌آماده وجود ندارد.');
    totalBatchCost += Math.round(requirement.unitCost * requirement.requiredQty);
  }

  if (!Number.isSafeInteger(Math.round(totalBatchCost))) throw new Error('بهای تولید دستور تهیه نیمه‌آماده از محدودهٔ امن خارج است.');

  const totalYieldUnits = baseYieldUnits * batchMultiplier;
  if (!Number.isFinite(totalYieldUnits) || totalYieldUnits <= 0) throw new Error('بازده دستور تهیه نیمه‌آماده از محدودهٔ امن خارج است.');
  const unitCostPrepared = Math.round(totalBatchCost / totalYieldUnits);
  if (!Number.isSafeInteger(unitCostPrepared)) throw new Error('بهای واحد دستور تهیه نیمه‌آماده از محدودهٔ امن خارج است.');

  // Validate the output item before changing any input quantity.
  let prepItem = findItem(acc.inventoryItems, subRecipe.prepItemId || subRecipe.sku, branchId);
  const prepItemOtherBranch = prepItem ? null : list(acc.inventoryItems).find((item) => (
    (subRecipe.prepItemId && String(item.id) === String(subRecipe.prepItemId))
    || (subRecipe.sku && String(item.sku || '') === String(subRecipe.sku))
  ));
  if (!prepItem && prepItemOtherBranch) throw new Error('کالای نیمه‌آماده به شعبهٔ دیگری تعلق دارد.');
  let currentQty = 0;
  let currentCost = 0;
  if (prepItem) {
    currentQty = number(prepItem.qtyOnHand ?? prepItem.onHand ?? prepItem.quantity);
    currentCost = number(prepItem.avgCostIrr ?? prepItem.avgCost ?? 0);
    if (currentQty == null || currentQty < 0 || currentCost == null || currentCost < 0) throw new Error('موجودی کالای نیمه‌آماده معتبر نیست.');
  }

  for (const requirement of requirements.values()) {
    const onHand = number(requirement.item.qtyOnHand ?? requirement.item.onHand ?? requirement.item.quantity);
    setOnHand(requirement.item, onHand - requirement.requiredQty);
  }
  if (!prepItem) {
    prepItem = {
      id: subRecipe.prepItemId || `prep-${Date.now()}`,
      sku: subRecipe.sku || `PREP-${String(subRecipe.id).toUpperCase()}`,
      name: subRecipe.name,
      category: 'نیمه‌آماده و سس‌ها',
      unit: subRecipe.yieldUnit || 'لیتر',
      qtyOnHand: totalYieldUnits,
      avgCost: unitCostPrepared,
      minStock: 5,
      branchId,
    };
    acc.inventoryItems.push(prepItem);
  } else {
    const currentVal = currentQty * currentCost;
    const newQty = currentQty + totalYieldUnits;
    prepItem.qtyOnHand = newQty;
    prepItem.avgCost = newQty > 0 ? Math.round((currentVal + totalBatchCost) / newQty) : unitCostPrepared;
    if (prepItem.avgCostIrr !== undefined) prepItem.avgCostIrr = prepItem.avgCost;
  }

  // Log Production Batch
  const logEntry = {
    id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subRecipeId,
    subRecipeName: subRecipe.name,
    batchCount: batchMultiplier,
    totalYieldUnits,
    yieldUnit: subRecipe.yieldUnit || 'لیتر',
    totalBatchCost,
    unitCostPrepared,
    consumedIngredients: ingredientLines.map((line) => ({
      itemId: line.item.id,
      name: line.item.name,
      qtyConsumed: line.qtyConsumed,
      unit: line.unit,
      unitCost: line.unitCost,
      lineCost: Math.round(line.unitCost * line.qtyConsumed),
    })),
    producedBy: context.producedBy || 'سرآشپز شیفت آماده‌سازی',
    branchId,
    idempotencyKey: requestKey || null,
    createdAt: new Date().toISOString(),
  };
  acc.prepProductionLogs.unshift(logEntry);

  return logEntry;
}

/**
 * Explodes Multi-Level BOM to calculate total real cost of a finished menu dish.
 */
function explodeRecipeBOM(acc, recipeId) {
  const recipe = (acc.recipes || []).find((r) => r.id === recipeId);
  if (!recipe) throw new Error(`دستور تهیه با شناسه ${recipeId} یافت نشد.`);
  const branchId = recipe.branchId == null || recipe.branchId === '' ? null : normalizedBranchId(recipe.branchId);

  let totalCost = 0;
  const detailedIngredients = (recipe.ingredients || []).map((ing) => {
    const subRecipe = (acc.subRecipes || []).find((s) => (
      sameBranch(s, branchId) && (String(s.prepItemId) === String(ing.itemId) || String(s.id) === String(ing.itemId))
    ));
    const invItem = findItem(acc.inventoryItems, ing.itemId, branchId);
    if (!invItem) throw new Error(`مادهٔ اولیهٔ دستور تهیه در شعبه یافت نشد: ${ing.itemId}`);
    const rawQty = number(ing.qty ?? ing.quantity);
    if (rawQty == null || rawQty <= 0) throw new Error('مقدار مادهٔ اولیهٔ دستور تهیه معتبر نیست.');
    const yieldPercent = number(ing.yieldPercent ?? recipe.yieldPercent ?? 100);
    if (yieldPercent == null || yieldPercent <= 0 || yieldPercent > 100) throw new Error('بازده دستور تهیه باید بین صفر و صد باشد.');
    const required = ingredientRequirement({
      ...ing,
      quantity: rawQty,
      quantityBasis: ing.quantityBasis ?? ing.quantity_basis ?? 'raw',
      yieldPercent,
    }, recipe, invItem);
    if (!required.ok) throw new Error(`مقدار یا واحد مادهٔ اولیهٔ دستور تهیه معتبر نیست (${required.code}).`);
    const unitCostValue = unitCost(invItem, ing);
    const lineCost = Math.round(unitCostValue * required.value);
    if (!Number.isSafeInteger(lineCost)) throw new Error('بهای دستور تهیه از محدودهٔ امن خارج است.');

    totalCost += lineCost;

    return {
      itemId: ing.itemId,
      name: ing.name || invItem?.name || subRecipe?.name || 'ماده اولیه',
      isSubRecipe: Boolean(subRecipe),
      rawQty,
      effectiveQty: Number(required.value.toFixed(3)),
      yieldPercent,
      unit: canonicalUnit(invItem.unit) || invItem.unit || 'واحد',
      unitCost: unitCostValue,
      lineCost,
      currentStock: Number(invItem.qtyOnHand ?? invItem.onHand ?? invItem.quantity),
    };
  });

  const sellingPrice = Number(recipe.sellingPrice ?? 0);
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw new Error('قیمت فروش دستور تهیه معتبر نیست.');
  const grossMargin = sellingPrice - totalCost;
  const foodCostPercent = sellingPrice > 0 ? Number(((totalCost / sellingPrice) * 100).toFixed(1)) : 0;

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    category: recipe.category || 'عمومی',
    version: recipe.version || '1.0',
    sellingPrice,
    totalCost,
    grossMargin,
    foodCostPercent,
    ingredients: detailedIngredients,
    status: foodCostPercent < 28 ? 'OPTIMAL' : (foodCostPercent <= 35 ? 'STANDARD' : 'HIGH'),
  };
}

/**
 * Simulates What-If scenario: Adjusting ingredient purchase costs or selling prices.
 */
function simulateMenuPricingWhatIf(acc, scenario = {}) {
  const { costAdjustments = {}, priceAdjustments = {} } = scenario;
  const currentCards = (acc.recipes || []).map((r) => explodeRecipeBOM(acc, r.id));

  const simulatedCards = currentCards.map((card) => {
    let simTotalCost = 0;
    const simIngredients = card.ingredients.map((ing) => {
      const adjustmentPct = Number(costAdjustments[ing.itemId] || costAdjustments['global'] || 0);
      const adjustedUnitCost = Math.round(ing.unitCost * (1 + adjustmentPct / 100));
      const simLineCost = Math.round(adjustedUnitCost * ing.effectiveQty);
      simTotalCost += simLineCost;
      return {
        ...ing,
        adjustedUnitCost,
        simLineCost,
      };
    });

    const priceAdjustmentPct = Number(priceAdjustments[card.recipeId] || priceAdjustments['global'] || 0);
    const simSellingPrice = Math.round(card.sellingPrice * (1 + priceAdjustmentPct / 100));
    const simGrossMargin = simSellingPrice - simTotalCost;
    const simFoodCostPercent = simSellingPrice > 0 ? Number(((simTotalCost / simSellingPrice) * 100).toFixed(1)) : 0;

    return {
      recipeId: card.recipeId,
      name: card.recipeName,
      originalCost: card.totalCost,
      simTotalCost,
      originalPrice: card.sellingPrice,
      simSellingPrice,
      originalFoodCostPct: card.foodCostPercent,
      simFoodCostPercent,
      originalMargin: card.grossMargin,
      simGrossMargin,
      marginChange: simGrossMargin - card.grossMargin,
      simIngredients,
    };
  });

  return {
    scenario,
    cards: simulatedCards,
    avgOriginalFoodCost: Number((currentCards.reduce((s, c) => s + c.foodCostPercent, 0) / Math.max(1, currentCards.length)).toFixed(1)),
    avgSimulatedFoodCost: Number((simulatedCards.reduce((s, c) => s + c.simFoodCostPercent, 0) / Math.max(1, simulatedCards.length)).toFixed(1)),
  };
}

module.exports = {
  defCalculateYieldCost,
  produceSubRecipeBatch,
  explodeRecipeBOM,
  simulateMenuPricingWhatIf,
};

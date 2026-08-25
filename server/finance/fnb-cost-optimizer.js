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
defCalculateYieldCost = (rawUnitCost, rawQty, yieldPercent = 100) => {
  const yieldRatio = Math.max(0.01, Number(yieldPercent || 100) / 100);
  const effectiveRawQty = rawQty / yieldRatio;
  const lineCost = Math.round(rawUnitCost * effectiveRawQty);
  return {
    rawQty,
    effectiveRawQty: Number(effectiveRawQty.toFixed(3)),
    yieldPercent,
    lineCost,
  };
};

/**
 * Sub-Recipe (Batch Prep) Registry and Production Execution.
 * Converts raw ingredients from inventory into a prepared sub-recipe item.
 */
function produceSubRecipeBatch(acc, subRecipeId, batchCount = 1, context = {}) {
  const subRecipe = (acc.subRecipes || []).find((s) => s.id === subRecipeId);
  if (!subRecipe) {
    throw new Error(`ساب‌رسپی با شناسه ${subRecipeId} یافت نشد.`);
  }

  const batchMultiplier = Math.max(1, Number(batchCount || 1));
  let totalBatchCost = 0;
  const consumedIngredients = [];

  // Consume raw ingredients from inventory
  (subRecipe.ingredients || []).forEach((ing) => {
    const invItem = (acc.inventoryItems || []).find((i) => i.id === ing.itemId || i.sku === ing.itemId);
    const unitCost = invItem ? invItem.avgCost : Number(ing.unitCost || 0);
    const requiredQty = Number(ing.qty || 0) * batchMultiplier;
    const lineCost = Math.round(unitCost * requiredQty);

    if (invItem) {
      invItem.qtyOnHand = Math.max(0, (invItem.qtyOnHand || 0) - requiredQty);
    }

    totalBatchCost += lineCost;
    consumedIngredients.push({
      itemId: ing.itemId,
      name: ing.name || invItem?.name,
      qtyConsumed: requiredQty,
      unit: ing.unit || invItem?.unit || 'واحد',
      unitCost,
      lineCost,
    });
  });

  const totalYieldUnits = Number(subRecipe.batchYieldUnits || 1) * batchMultiplier;
  const unitCostPrepared = Math.round(totalBatchCost / Math.max(1, totalYieldUnits));

  // Add or update prepared inventory item
  let prepItem = (acc.inventoryItems || []).find((i) => i.id === subRecipe.prepItemId || i.sku === subRecipe.sku);
  if (!prepItem) {
    prepItem = {
      id: subRecipe.prepItemId || `prep-${Date.now()}`,
      sku: subRecipe.sku || `PREP-${subRecipe.id.toUpperCase()}`,
      name: subRecipe.name,
      category: 'نیمه‌آماده و سس‌ها',
      unit: subRecipe.yieldUnit || 'لیتر',
      qtyOnHand: totalYieldUnits,
      avgCost: unitCostPrepared,
      minStock: 5,
      branchId: context.branchId || 1,
    };
    acc.inventoryItems.push(prepItem);
  } else {
    // Recalculate MWA for prep item
    const currentVal = (prepItem.qtyOnHand || 0) * (prepItem.avgCost || 0);
    const newVal = currentVal + totalBatchCost;
    const newQty = (prepItem.qtyOnHand || 0) + totalYieldUnits;
    prepItem.qtyOnHand = newQty;
    prepItem.avgCost = newQty > 0 ? Math.round(newVal / newQty) : unitCostPrepared;
  }

  // Log Production Batch
  if (!Array.isArray(acc.prepProductionLogs)) acc.prepProductionLogs = [];
  const logEntry = {
    id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subRecipeId,
    subRecipeName: subRecipe.name,
    batchCount: batchMultiplier,
    totalYieldUnits,
    yieldUnit: subRecipe.yieldUnit || 'لیتر',
    totalBatchCost,
    unitCostPrepared,
    consumedIngredients,
    producedBy: context.producedBy || 'سرآشپز شیفت آماده‌سازی',
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
  if (!recipe) throw new Error(`رسپی با شناسه ${recipeId} یافت نشد.`);

  let totalCost = 0;
  const detailedIngredients = (recipe.ingredients || []).map((ing) => {
    // Check if ingredient is a sub-recipe / prep item
    const subRecipe = (acc.subRecipes || []).find((s) => s.prepItemId === ing.itemId || s.id === ing.itemId);
    const invItem = (acc.inventoryItems || []).find((i) => i.id === ing.itemId || i.sku === ing.itemId);

    let unitCost = 0;
    let isSubRecipe = false;

    if (subRecipe) {
      isSubRecipe = true;
      unitCost = invItem ? invItem.avgCost : Number(subRecipe.estimatedUnitCost || 0);
    } else {
      unitCost = invItem ? invItem.avgCost : Number(ing.unitCost || 0);
    }

    const yieldPercent = Number(ing.yieldPercent || recipe.yieldPercent || 100);
    const yieldRatio = Math.max(0.01, yieldPercent / 100);
    const effectiveQty = Number(ing.qty || 0) / yieldRatio;
    const lineCost = Math.round(unitCost * effectiveQty);

    totalCost += lineCost;

    return {
      itemId: ing.itemId,
      name: ing.name || invItem?.name || subRecipe?.name || 'ماده اولیه',
      isSubRecipe,
      rawQty: Number(ing.qty || 0),
      effectiveQty: Number(effectiveQty.toFixed(3)),
      yieldPercent,
      unit: ing.unit || invItem?.unit || 'واحد',
      unitCost,
      lineCost,
      currentStock: invItem ? invItem.qtyOnHand : 0,
    };
  });

  const sellingPrice = Number(recipe.sellingPrice || 0);
  const grossMargin = Math.max(0, sellingPrice - totalCost);
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
    const simGrossMargin = Math.max(0, simSellingPrice - simTotalCost);
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

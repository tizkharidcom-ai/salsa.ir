const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryEngine = require('../server/finance/inventory-engine');

test('Recipe Management: Every product has a recipe and existing recipes can be edited in place', () => {
  const acc = {
    inventoryItems: [
      { id: 'inv-beef', name: 'گوشت گوساله', unit: 'کیلوگرم', avgCostIrr: 4500000, branchId: 1 },
      { id: 'inv-bread', name: 'نان برگر', unit: 'عدد', avgCostIrr: 150000, branchId: 1 },
      { id: 'inv-cheese', name: 'پنیر گودا', unit: 'گرم', avgCostIrr: 3000, branchId: 1 },
    ],
    recipes: [],
  };

  // 1. Create initial recipe for product 101
  const recipe1 = inventoryEngine.saveRecipe(acc, {
    menuItemId: '101',
    name: 'چیز برگر کلاسیک',
    branchId: 1,
    yieldQuantity: 1,
    sellingPrice: 1500000, // 150,000 Tomans
    ingredients: [
      { itemId: 'inv-beef', quantity: 0.15, unit: 'کیلوگرم' },
      { itemId: 'inv-bread', quantity: 1, unit: 'عدد' },
    ],
  });

  assert.equal(acc.recipes.length, 1);
  assert.equal(recipe1.menuItemId, '101');
  assert.equal(recipe1.ingredients.length, 2);

  // 2. Edit existing recipe for product 101 (adding cheese and updating beef quantity)
  const updatedRecipe = inventoryEngine.saveRecipe(acc, {
    menuItemId: '101',
    name: 'چیز برگر دوبل پنیر',
    branchId: 1,
    yieldQuantity: 1,
    sellingPrice: 1800000,
    ingredients: [
      { itemId: 'inv-beef', quantity: 0.18, unit: 'کیلوگرم' },
      { itemId: 'inv-bread', quantity: 1, unit: 'عدد' },
      { itemId: 'inv-cheese', quantity: 30, unit: 'گرم' },
    ],
  });

  // Verify that it updated the existing recipe in place rather than creating a duplicate
  assert.equal(acc.recipes.length, 1, 'Should not create a duplicate recipe');
  assert.equal(updatedRecipe.id, recipe1.id, 'Recipe ID must remain consistent');
  assert.equal(updatedRecipe.name, 'چیز برگر دوبل پنیر');
  assert.equal(updatedRecipe.ingredients.length, 3);
  assert.equal(updatedRecipe.ingredients[2].unit, 'گرم');
});

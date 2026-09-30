'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryEngine = require('../server/finance/inventory-engine');
const inventoryOperations = require('../server/finance/inventory-operations');

function fixture(onHand = 0.3) {
  return {
    db: {
      accounting: {
        inventoryItems: [{
          id: 'fractional-stock', branchId: 7, name: 'مادهٔ آزمون', unit: 'g',
          qtyOnHand: onHand, avgCostIrr: 100,
        }],
      },
    },
    state: { inventoryMovements: [] },
  };
}

test('waste rejects a real sub-nanounit overdraw without planning a stock movement', () => {
  const { db, state } = fixture();
  const result = inventoryOperations.buildWaste(db, state, {
    branchId: 7,
    itemId: 'fractional-stock',
    quantity: 0.3 + 5e-10,
    unit: 'g',
    reason: 'تست مرز موجودی',
  }, 'inventory-test');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'waste_exceeds_available');
  assert.equal(result.issues[0].availableQuantityBase, 0.3);
  assert.deepEqual(state.inventoryMovements, []);
});

test('waste still accepts only binary-float rounding noise at the exact stock boundary', () => {
  const { db, state } = fixture();
  const result = inventoryOperations.buildWaste(db, state, {
    branchId: 7,
    itemId: 'fractional-stock',
    quantity: 0.1 + 0.2,
    unit: 'g',
    reason: 'تست دقت شناور',
  }, 'inventory-test');

  assert.equal(result.ok, true);
  assert.equal(result.movements[0].quantityBase, -0.30000000000000004);
});

test('an invalid explicit branch cannot silently turn inventory and finance reports into consolidated reports', () => {
  const acc = {
    inventoryItems: [
      { id: 'branch-seven-stock', branchId: 7, qtyOnHand: 2, avgCostIrr: 100 },
      { id: 'branch-eight-stock', branchId: 8, qtyOnHand: 3, avgCostIrr: 200 },
    ],
    recipes: [],
    inventoryTransactions: [],
  };
  const db = { orders: [], financeV2: { inventoryMovements: [] } };

  assert.deepEqual(inventoryEngine.getInventoryValuation(acc, 7).items.map((item) => item.branchId), [7]);
  assert.throws(() => inventoryEngine.getInventoryValuation(acc, 'not-a-branch'), /شعبهٔ معتبر/);
  assert.throws(() => inventoryEngine.getCOGSVarianceAnalysis(acc, db, 'not-a-branch'), /شعبهٔ معتبر/);
  assert.throws(() => inventoryEngine.getMenuEngineeringMatrix(acc, db, 'not-a-branch'), /شعبهٔ معتبر/);
});

test('invalid recipe branch cannot borrow another branch stock cost or be saved as a global recipe', () => {
  const acc = {
    inventoryItems: [{
      id: 'only-branch-eight-stock', branchId: 8, name: 'مادهٔ شعبهٔ ۸',
      unit: 'g', qtyOnHand: 10, avgCostIrr: 500,
    }],
    recipes: [{
      id: 'bad-scope-recipe', branchId: 'not-a-branch', name: 'رسپی نامعتبر', menuItemId: 'dish-8',
      ingredients: [{ itemId: 'only-branch-eight-stock', quantity: 1, unit: 'g' }], sellingPrice: 2000,
    }],
  };

  const [card] = inventoryEngine.getRecipeCostCards(acc);
  assert.equal(card.totalCost, null);
  assert.equal(card.healthStatus, 'INVALID');
  assert.ok(card.issues.some((issue) => issue.code === 'recipe_branch_invalid'));
  assert.equal(card.ingredients[0].costStatus, 'invalid');

  const before = acc.recipes.length;
  assert.throws(() => inventoryEngine.saveRecipe(acc, {
    branchId: 'not-a-branch',
    name: 'رسپی جدید',
    menuItemId: 'dish-new',
    ingredients: [{ itemId: 'only-branch-eight-stock', quantity: 1, unit: 'g' }],
  }), /شعبهٔ معتبر/);
  assert.equal(acc.recipes.length, before);
});

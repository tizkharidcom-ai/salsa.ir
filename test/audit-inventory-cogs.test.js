'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const inventoryEngine = require('../server/finance/inventory-engine');
const inventoryOperations = require('../server/finance/inventory-operations');
const orderCosting = require('../server/finance/order-costing');
const fnbOptimizer = require('../server/finance/fnb-cost-optimizer');
const finance = require('../server/finance-v2');

function accountingFixture() {
  return {
    inventoryItems: [],
    inventoryTransactions: [],
    inventoryCounts: [],
    wasteLog: [],
    recipes: [],
  };
}

function v2Fixture() {
  return {
    branches: [{ id: 1, name: 'اصلی' }, { id: 2, name: 'دوم' }],
    accounting: accountingFixture(),
    financeV2: { inventoryMovements: [], settings: {} },
  };
}

test('legacy inventory mutations validate quantities, isolate branches, and never create negative consumption', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [
    { id: 'milk', sku: 'MILK', name: 'شیر شعبه اول', unit: 'لیتر', qtyOnHand: 5, avgCost: 100, branchId: 1 },
    { id: 'milk', sku: 'MILK-B2', name: 'شیر شعبه دوم', unit: 'لیتر', qtyOnHand: 7, avgCost: 200, branchId: 2 },
  ];

  const received = inventoryEngine.receiveStock(acc, {
    itemId: 'milk', qty: 2, unitCost: 300, branchId: 2,
  });
  assert.equal(received.item.branchId, 2);
  assert.equal(received.item.qtyOnHand, 9);
  assert.equal(acc.inventoryItems[0].qtyOnHand, 5);

  const negative = inventoryEngine.consumeStock(acc, { itemId: 'milk', qty: -1, branchId: 2 });
  assert.match(negative.error, /مقدار مصرف/);
  assert.equal(acc.inventoryItems[1].qtyOnHand, 9);

  const excessive = inventoryEngine.consumeStock(acc, { itemId: 'milk', qty: 10, branchId: 2 });
  assert.match(excessive.error, /موجودی کافی/);
  assert.equal(acc.inventoryItems[1].qtyOnHand, 9);

  assert.throws(
    () => inventoryEngine.recordWaste(acc, { itemId: 'milk', qty: 10, reason: 'آزمون کنترل موجودی', branchId: 2 }),
    /موجودی کافی/,
  );
  assert.equal(acc.inventoryItems[1].qtyOnHand, 9);
});

test('production aggregates repeated ingredient references and resolves SKU references before shortage checks', () => {
  const db = v2Fixture();
  db.accounting.inventoryItems = [
    { id: 'raw-1', sku: 'RAW-1', name: 'ماده خام', unit: 'kg', qtyOnHand: 5, avgCostIrr: 100, branchId: 1 },
    { id: 'prep-1', name: 'محصول آماده', unit: 'count', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 },
  ];
  db.accounting.recipes = [{
    id: 'batch-duplicate', name: 'بچ تکراری', version: 1, branchId: 1, servings: 1, outputItemId: 'prep-1',
    ingredients: [
      { itemId: 'RAW-1', qty: 4, unit: 'kg', quantityBasis: 'raw' },
      { itemId: 'RAW-1', qty: 4, unit: 'kg', quantityBasis: 'raw' },
    ],
  }];

  const result = inventoryOperations.buildProductionBatch(
    db,
    db.financeV2,
    { branchId: 1, recipeId: 'batch-duplicate', plannedYield: 1, actualYield: 1 },
    'kitchen-1',
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'inventory_shortage'));
  assert.equal(result.issues.find((issue) => issue.code === 'inventory_shortage').requiredQuantityBase, 8);
});

test('retired recipe versions cannot be used for new production', () => {
  const db = v2Fixture();
  db.accounting.inventoryItems = [
    { id: 'raw-1', name: 'ماده خام', unit: 'kg', qtyOnHand: 10, avgCostIrr: 100, branchId: 1 },
    { id: 'prep-1', name: 'محصول آماده', unit: 'count', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 },
  ];
  db.financeV2.recipeVersions = [{
    id: 'recipe-retired', recipeId: 'menu:1:branch:1', menuItemId: '1', name: 'نسخه قدیمی', branchId: 1,
    status: 'retired', version: 1, yieldQuantity: 1, outputItemId: 'prep-1',
    ingredients: [{ itemId: 'raw-1', quantity: 1, unit: 'kg', quantityBasis: 'raw', yieldPercent: 100 }],
  }];

  const result = inventoryOperations.buildProductionBatch(
    db,
    db.financeV2,
    { branchId: 1, recipeId: 'recipe-retired', plannedYield: 1, actualYield: 1 },
    'kitchen-1',
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'recipe_retired');
});

test('order costing rejects malformed explicit sales amounts instead of silently falling back', () => {
  const db = v2Fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 10, avgCostIrr: 100, branchId: 1 }];
  db.accounting.recipes = [{
    id: 'recipe-1', menuItemId: 'drink-1', branchId: 1, version: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'milk', qty: 1, unit: 'l', quantityBasis: 'raw' }],
  }];

  const result = orderCosting.buildOrderCosting(db, {
    id: 'order-1', branchId: 1, paidAt: '2026-08-24T10:00:00.000Z',
    items: [{ id: 'line-1', menuItemId: 'drink-1', qty: 1, lineTotalIrr: 1.5, unitTotal: 999 }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'order_line_sales_amount_invalid'));
  assert.equal(result.snapshots.length, 0);
});

test('order costing resolves ingredient SKUs while preserving branch and shadow movement isolation', () => {
  const db = v2Fixture();
  db.accounting.inventoryItems = [
    { id: 'milk-1', sku: 'MILK-1', name: 'شیر شعبه اول', unit: 'l', qtyOnHand: 2, avgCostIrr: 100, branchId: 1 },
    { id: 'milk-2', sku: 'MILK-2', name: 'شیر شعبه دوم', unit: 'l', qtyOnHand: 100, avgCostIrr: 900, branchId: 2 },
  ];
  db.financeV2.inventoryMovements.push({ itemId: 'milk-1', branchId: 2, quantityBase: 100 });
  db.accounting.recipes = [{
    id: 'recipe-1', menuItemId: 'drink-1', branchId: 1, version: 1,
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    ingredients: [{ itemId: 'MILK-1', qty: 1, unit: 'l', quantityBasis: 'raw' }],
  }];

  const result = orderCosting.buildOrderCosting(db, {
    id: 'order-1', branchId: 1, paidAt: '2026-08-24T10:00:00.000Z',
    items: [{ id: 'line-1', menuItemId: 'drink-1', qty: 2, lineTotalIrr: 2000 }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.movements.map((row) => [row.itemId, row.quantityBase, row.totalCostIrr]), [['milk-1', -2, 200]]);
});

test('F&B optimizer rejects invalid yield and refuses an insufficient sub-recipe batch without mutation', () => {
  assert.throws(() => fnbOptimizer.defCalculateYieldCost(100, 1, 0), /بازده/);
  const acc = {
    inventoryItems: [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 1, avgCost: 100, branchId: 1 }],
    subRecipes: [{
      id: 'base', name: 'بیس', sku: 'BASE', prepItemId: 'prep', yieldUnit: 'l', batchYieldUnits: 2, branchId: 1,
      ingredients: [{ itemId: 'milk', qty: 2, unit: 'l' }],
    }],
  };
  assert.throws(
    () => fnbOptimizer.produceSubRecipeBatch(acc, 'base', 1, { branchId: 1 }),
    /موجودی کافی/,
  );
  assert.equal(acc.inventoryItems[0].qtyOnHand, 1);
  assert.equal(acc.inventoryItems.some((item) => item.id === 'prep'), false);
});

test('waste posting is atomic when the journal adapter fails', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 5, avgCost: 100, branchId: 1 }];

  assert.throws(
    () => inventoryEngine.recordWaste(acc, { itemId: 'milk', qty: 2, reason: 'خطای سند', branchId: 1 }, {
      postJournalFn: () => { throw new Error('journal failed'); },
    }),
    /journal failed/,
  );
  assert.equal(acc.inventoryItems[0].qtyOnHand, 5);
  assert.equal(acc.wasteLog.length, 0);
  assert.equal(acc.inventoryTransactions.length, 0);
});

test('recipe costing converts units and applies usable yield without cross-branch lookup', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [{ id: 'flour', sku: 'FLOUR', name: 'آرد', unit: 'kg', qtyOnHand: 10, avgCost: 100, branchId: 1 }];

  const recipe = inventoryEngine.saveRecipe(acc, {
    id: 'recipe-flour', branchId: 1, name: 'نان', sellingPrice: 1000, yieldPercent: 50,
    ingredients: [{ itemId: 'FLOUR', qty: 500, unit: 'g', quantityBasis: 'usable' }],
  });
  assert.equal(recipe.totalCost, 100);
  assert.equal(recipe.foodCostPercent, 10);
  assert.throws(
    () => inventoryEngine.saveRecipe(acc, {
      id: 'recipe-wrong-branch', branchId: 2, sellingPrice: 1000,
      ingredients: [{ itemId: 'FLOUR', qty: 1, unit: 'kg', quantityBasis: 'raw' }],
    }),
    /مادهٔ اولیهٔ رسپی قابل محاسبه نیست/,
  );
});

test('COGS variance isolates branch, uses effective recipe costing, and reports waste separately', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [
    { id: 'milk-1', name: 'شیر شعبه اول', unit: 'l', qtyOnHand: 10, avgCost: 100, branchId: 1 },
    { id: 'milk-2', name: 'شیر شعبه دوم', unit: 'l', qtyOnHand: 10, avgCost: 900, branchId: 2 },
  ];
  acc.recipes = [{
    id: 'recipe-drink', menuItemId: 'drink-1', branchId: 1, yieldPercent: 100,
    ingredients: [{ itemId: 'milk-1', qty: 1, unit: 'l', quantityBasis: 'raw' }],
  }];
  acc.inventoryTransactions = [
    { id: 'sale-1', type: 'USAGE_ACTUAL', itemId: 'milk-1', itemName: 'شیر', qty: 2, totalCost: 200, branchId: 1, date: '2026-08-24T12:00:00.000Z' },
    { id: 'waste-1', type: 'WASTE', itemId: 'milk-1', itemName: 'شیر', qty: 3, totalCost: 300, branchId: 1, date: '2026-08-24T13:00:00.000Z' },
    { id: 'sale-2', type: 'USAGE_ACTUAL', itemId: 'milk-2', itemName: 'شیر شعبه دوم', qty: 99, totalCost: 9900, branchId: 2, date: '2026-08-24T12:00:00.000Z' },
  ];
  const db = {
    orders: [{ id: 'order-1', branchId: 1, status: 'paid', paidAt: '2026-08-24T11:00:00.000Z', items: [{ id: 'drink-1', quantity: 2, name: 'نوشیدنی' }] }],
    financeV2: { recipeVersions: [] },
  };

  const report = inventoryEngine.getCOGSVarianceAnalysis(acc, db, 1, {
    from: '2026-08-24T00:00:00.000Z', to: '2026-08-24T23:59:59.999Z',
  });
  assert.equal(report.totalTheoreticalCOGS, 200);
  assert.equal(report.totalActualCOGS, 200);
  assert.equal(report.totalWasteCost, 300);
  assert.equal(report.actualBreakdown.length, 1);
  assert.equal(report.wasteBreakdown.length, 1);
  assert.equal(report.wasteBreakdown[0].itemId, 'milk-1');
});

test('legacy COGS report includes valued V2 shadow sale consumption exactly once', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [{ id: 'coffee', name: 'قهوه', unit: 'kg', qtyOnHand: 10, avgCost: 500, branchId: 1 }];
  acc.recipes = [{
    id: 'recipe-coffee', menuItemId: 'coffee-drink', branchId: 1, yieldPercent: 100,
    ingredients: [{ itemId: 'coffee', qty: 1, unit: 'kg', quantityBasis: 'raw' }],
  }];
  acc.inventoryTransactions = [{
    id: 'legacy-duplicate', type: 'USAGE_ACTUAL', orderId: 'order-coffee', itemId: 'coffee', itemName: 'قهوه',
    qty: 1, totalCost: 500, branchId: 1, date: '2026-08-24T10:05:00.000Z',
  }];
  const db = {
    orders: [{ id: 'order-coffee', branchId: 1, status: 'paid', paidAt: '2026-08-24T10:00:00.000Z', items: [{ id: 'coffee-drink', quantity: 1 }] }],
    financeV2: {
      recipeVersions: [],
      inventoryMovements: [{ id: 'shadow-sale', sourceId: 'order-coffee', branchId: 1, itemId: 'coffee', itemName: 'قهوه', movementType: 'sale_consumption', quantityBase: -1, totalCostIrr: 500, occurredAt: '2026-08-24T10:05:00.000Z' }],
    },
  };
  const report = inventoryEngine.getCOGSVarianceAnalysis(acc, db, 1);
  assert.equal(report.totalTheoreticalCOGS, 500);
  assert.equal(report.totalActualCOGS, 500);
  assert.equal(report.actualBreakdown[0].qty, 1);
  assert.equal(report.transactionIssues.length, 0);
});

test('sub-recipe production replays the same idempotency key without double consumption', () => {
  const acc = {
    inventoryItems: [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 10, avgCost: 100, branchId: 1 }],
    subRecipes: [{
      id: 'base', name: 'بیس', sku: 'BASE', prepItemId: 'prep', yieldUnit: 'l', batchYieldUnits: 2, branchId: 1,
      ingredients: [{ itemId: 'milk', qty: 2, unit: 'l' }],
    }],
  };
  const first = fnbOptimizer.produceSubRecipeBatch(acc, 'base', 1, { branchId: 1, idempotencyKey: 'prep-request-1' });
  const replay = fnbOptimizer.produceSubRecipeBatch(acc, 'base', 1, { branchId: 1, idempotencyKey: 'prep-request-1' });
  assert.equal(replay.id, first.id);
  assert.equal(acc.inventoryItems.find((item) => item.id === 'milk').qtyOnHand, 8);
  assert.equal(acc.prepProductionLogs.length, 1);
});

test('V2 inventory builders reject invalid shadow quantities and cross-branch item references', () => {
  const db = v2Fixture();
  db.accounting.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 5, avgCostIrr: 100, branchId: 1 }];
  db.financeV2.inventoryMovements.push({ id: 'bad-shadow', itemId: 'milk', branchId: 1, quantityBase: 'not-a-number' });

  const count = inventoryOperations.buildStockCount(
    db,
    db.financeV2,
    { branchId: 1, itemId: 'milk', countedQuantity: 5, unit: 'l' },
    'kitchen-1',
  );
  assert.equal(count.ok, false);
  assert.equal(count.code, 'inventory_movement_quantity_invalid');

  const waste = inventoryOperations.buildWaste(
    db,
    { ...db.financeV2, inventoryMovements: [] },
    { branchId: 2, itemId: 'milk', quantity: 1, unit: 'l', reason: 'کنترل شعبه' },
    'kitchen-2',
  );
  assert.equal(waste.ok, false);
  assert.equal(waste.code, 'inventory_item_branch_mismatch');
});

test('BOM costing rejects zero yield and does not clamp negative gross margin', () => {
  const acc = {
    inventoryItems: [{ id: 'oil', name: 'روغن', unit: 'l', qtyOnHand: 5, avgCost: 100, branchId: 1 }],
    recipes: [{
      id: 'recipe-loss', name: 'رسپی زیان‌ده', branchId: 1, sellingPrice: 50, yieldPercent: 100,
      ingredients: [{ itemId: 'oil', qty: 1, unit: 'l', quantityBasis: 'raw' }],
    }],
  };
  const card = fnbOptimizer.explodeRecipeBOM(acc, 'recipe-loss');
  assert.equal(card.totalCost, 100);
  assert.equal(card.grossMargin, -50);
  acc.recipes[0].yieldPercent = 0;
  assert.throws(() => fnbOptimizer.explodeRecipeBOM(acc, 'recipe-loss'), /بازده/);
});

test('legacy consumption and waste cannot use reserved, quarantined, or expired stock', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [{
    id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 5, reservedQty: 2,
    quarantinedQty: 2, expiredQty: 1, avgCostIrr: 100, branchId: 1,
  }];

  const consumed = inventoryEngine.consumeStock(acc, { itemId: 'milk', qty: 0.1, branchId: 1 });
  assert.match(consumed.error, /موجودی کافی/);
  assert.equal(acc.inventoryItems[0].qtyOnHand, 5);
  assert.equal(acc.inventoryTransactions.length, 0);

  assert.throws(
    () => inventoryEngine.recordWaste(acc, { itemId: 'milk', qty: 0.1, reason: 'کنترل', branchId: 1 }),
    /موجودی کافی/,
  );
  assert.equal(acc.inventoryItems[0].qtyOnHand, 5);
  assert.equal(acc.wasteLog.length, 0);
});

test('V2 waste shortage fails closed before physical or financial mutation', () => {
  const db = {
    branches: [{ id: 1, name: 'اصلی' }], orders: [],
    accounting: {
      fiscalPeriods: [{ id: 'p1', startDate: '2026-08-01', endDate: '2026-08-31', status: 'open' }],
      inventoryItems: [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 1, avgCostIrr: 100, branchId: 1 }],
      inventoryTransactions: [], wasteLog: [], recipes: [], journalEntries: [],
    },
    financeV2: {},
  };

  assert.throws(
    () => finance.recordInventoryOperationV2(db, 'waste', {
      branchId: 1, itemId: 'milk', quantity: 2, unit: 'l', reason: 'ثبت بیش از موجودی',
    }, 'kitchen-1', 'waste-shortage-1'),
    (error) => error.code === 'waste_exceeds_available',
  );
  assert.equal(db.accounting.inventoryItems[0].qtyOnHand, 1);
  assert.equal(db.financeV2.inventoryMovements.length, 0);
  assert.equal(db.financeV2.events.length, 0);
  assert.equal(db.financeV2.journalEntries.length, 0);
});

test('legacy, order, and F&B costing use the same raw default when yield is present', () => {
  const acc = {
    inventoryItems: [{ id: 'flour', name: 'آرد', unit: 'kg', qtyOnHand: 10, avgCostIrr: 100, branchId: 1 }],
    inventoryTransactions: [], wasteLog: [], recipes: [],
  };
  const saved = inventoryEngine.saveRecipe(acc, {
    id: 'recipe-yield-default', menuItemId: 'bread', branchId: 1, sellingPrice: 1000, yieldPercent: 50,
    ingredients: [{ itemId: 'flour', qty: 1, unit: 'kg' }],
  });
  const card = fnbOptimizer.explodeRecipeBOM(acc, saved.id);
  const order = orderCosting.buildOrderCosting({
    accounting: acc, financeV2: { recipeVersions: [], inventoryMovements: [], settings: {} },
  }, {
    id: 'order-yield-default', branchId: 1, paidAt: '2026-08-24T10:00:00.000Z',
    items: [{ menuItemId: 'bread', qty: 1, lineTotalIrr: 10000 }],
  });

  assert.equal(saved.totalCost, 100);
  assert.equal(card.totalCost, 100);
  assert.equal(order.ok, true);
  assert.equal(order.snapshots[0].theoreticalCogsIrr, 100);
});

test('unscoped F&B BOM refuses an ambiguous inventory item across branches', () => {
  const acc = {
    inventoryItems: [
      { id: 'same-item', name: 'شعبه اول', unit: 'kg', qtyOnHand: 1, avgCostIrr: 100, branchId: 1 },
      { id: 'same-item', name: 'شعبه دوم', unit: 'kg', qtyOnHand: 1, avgCostIrr: 900, branchId: 2 },
    ],
    recipes: [{
      id: 'unscoped-recipe', name: 'رسپی مبهم', sellingPrice: 1000,
      ingredients: [{ itemId: 'same-item', qty: 1, unit: 'kg', quantityBasis: 'raw' }],
    }],
  };
  assert.throws(() => fnbOptimizer.explodeRecipeBOM(acc, 'unscoped-recipe'), /چند شعبه|شعبه/);
});

test('COGS variance does not let a shadow movement from another branch or date suppress legacy COGS', () => {
  const acc = accountingFixture();
  acc.inventoryItems = [{ id: 'milk', name: 'شیر', unit: 'l', qtyOnHand: 10, avgCostIrr: 100, branchId: 1 }];
  acc.inventoryTransactions = [
    { id: 'legacy-branch', type: 'USAGE_ACTUAL', orderId: 'same-source', itemId: 'milk', qty: 1, totalCost: 100, branchId: 1, date: '2026-08-24T12:00:00.000Z' },
    { id: 'legacy-date', type: 'USAGE_ACTUAL', orderId: 'old-source', itemId: 'milk', qty: 2, totalCost: 200, branchId: 1, date: '2026-08-24T13:00:00.000Z' },
  ];
  const db = {
    orders: [],
    financeV2: { recipeVersions: [], inventoryMovements: [
      { id: 'wrong-branch', sourceId: 'same-source', branchId: 2, itemId: 'milk', movementType: 'sale_consumption', quantityBase: -1, totalCostIrr: 900, occurredAt: '2026-08-24T12:30:00.000Z' },
      { id: 'outside-window', sourceId: 'old-source', branchId: 1, itemId: 'milk', movementType: 'sale_consumption', quantityBase: -2, totalCostIrr: 200, occurredAt: '2026-08-23T12:30:00.000Z' },
    ] },
  };
  const report = inventoryEngine.getCOGSVarianceAnalysis(acc, db, 1, { from: '2026-08-24', to: '2026-08-24' });
  assert.equal(report.totalActualCOGS, 300);
  assert.equal(report.actualBreakdown[0].qty, 3);
  assert.equal(report.transactionIssues.length, 0);
});

test('yield cost helper rejects unsafe money results instead of returning Infinity', () => {
  assert.throws(
    () => fnbOptimizer.defCalculateYieldCost(Number.MAX_VALUE, 1, 100),
    /محدوده/,
  );
});

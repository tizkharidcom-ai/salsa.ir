'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { physicalAvailable, buildOrderCosting } = require('../server/finance/order-costing');
const financeV2 = require('../server/finance-v2');
const inventoryEngine = require('../server/finance/inventory-engine');
const inventoryOperations = require('../server/finance/inventory-operations');

const PAID_AT = '2026-09-23T08:00:00.000Z';

function oneIngredientRecipe(branchId = 1) {
  return {
    id: `recipe-dish-b${branchId}`,
    branchId,
    menuItemId: 'dish-1',
    version: 1,
    status: 'approved',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    yieldQuantity: 1,
    ingredients: [{ itemId: 'flour-b1', quantity: 1, unit: 'g', quantityBasis: 'raw' }],
  };
}

function inventorySaleDb(onHand, recipes = [oneIngredientRecipe()]) {
  const db = {
    branches: [{ id: 1, active: true }],
    accounting: {
      settings: { autoPostOrders: false },
      inventoryItems: [{
        id: 'flour-b1', branchId: 1, name: 'آرد', unit: 'g', qtyOnHand: onHand, avgCostIrr: 100,
      }],
      recipes,
    },
  };
  financeV2.createFiscalPeriod(db, {
    branchId: 1, name: 'دورهٔ آزمون', startDate: '2026-01-01', endDate: '2026-12-31',
  }, 'inventory-test');
  return db;
}

function paidOrder(id, qty = 1) {
  return {
    id, branchId: 1, orderNo: id, total: 1000,
    status: 'paid', paymentStatus: 'paid', paymentTender: 'cash',
    createdAt: PAID_AT, paidAt: PAID_AT,
    partialPayments: [{ id: `payment-${id}`, tender: 'cash', amount: 1000, at: PAID_AT }],
    items: [{ id: `line-${id}`, menuItemId: 'dish-1', name: 'غذا', qty, lineTotal: 1000 }],
  };
}

test('physical availability subtracts holds and only applies movements from the selected branch', () => {
  const item = {
    id: 'flour-b1', branchId: 1, unit: 'g', qtyOnHand: 12,
    reservedQty: 2, quarantinedQty: 1, expiredQty: 1,
  };
  const result = physicalAvailable(item, {
    inventoryMovements: [
      { itemId: 'flour-b1', branchId: 1, quantityBase: -3 },
      { itemId: 'flour-b1', branchId: 2, quantityBase: -5 },
    ],
  }, 1);

  assert.equal(result.ok, true);
  assert.equal(result.value, 5);
});

test('order costing fails closed instead of using another branch inventory item', () => {
  const db = {
    accounting: {
      inventoryItems: [{
        id: 'flour-b2', branchId: 2, name: 'آرد شعبه ۲', unit: 'g', qtyOnHand: 50, avgCostIrr: 100,
      }],
      recipes: [oneIngredientRecipe(1)],
    },
    financeV2: { inventoryMovements: [] },
  };
  const result = buildOrderCosting(db, {
    id: 'order-branch-scope', branchId: 1, paidAt: PAID_AT,
    items: [{ id: 'line-1', menuItemId: 'dish-1', name: 'غذا', qty: 1, lineTotal: 1000 }],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'ingredient_item_missing'));
  assert.deepEqual(result.movements, []);
});

test('paid sale can post while its COGS capture is blocked by inventory shortage', () => {
  const db = inventorySaleDb(0, [oneIngredientRecipe(1)]);
  const order = paidOrder('order-short-stock');

  const result = financeV2.capturePaidOrder(db, order, { actor: 'inventory-test' });

  assert.equal(result.journalEntry?.status, 'posted');
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].status, 'succeeded');
  assert.equal(result.costing.event?.source, 'order.cogs');
  assert.equal(result.costing.event?.status, 'blocked');
  assert.equal(result.costing.event?.error?.code, 'inventory_shortage');
  assert.equal(db.financeV2.inventoryMovements.some((movement) => movement.source === 'order.cogs'), false);
});

test('shared ingredients across different menu lines are aggregated before a sale can consume stock', () => {
  const secondRecipe = {
    ...oneIngredientRecipe(), id: 'recipe-dish-2-b1', menuItemId: 'dish-2',
    ingredients: [{ itemId: 'flour-b1', quantity: 0.75, unit: 'g', quantityBasis: 'raw' }],
  };
  const firstRecipe = {
    ...oneIngredientRecipe(), ingredients: [{ itemId: 'flour-b1', quantity: 0.75, unit: 'g', quantityBasis: 'raw' }],
  };
  const db = inventorySaleDb(1.4, [firstRecipe, secondRecipe]);
  const result = buildOrderCosting(db, {
    id: 'order-shared-stock', branchId: 1, paidAt: PAID_AT,
    items: [
      { id: 'line-1', menuItemId: 'dish-1', name: 'غذای اول', qty: 1, lineTotal: 1000 },
      { id: 'line-2', menuItemId: 'dish-2', name: 'غذای دوم', qty: 1, lineTotal: 1000 },
    ],
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'inventory_shortage'
    && issue.itemId === 'flour-b1'
    && issue.requiredQuantityBase === 1.5
    && issue.availableQuantityBase === 1.4));
  assert.deepEqual(result.movements, []);
});

test('successive paid orders cannot post COGS movements beyond the remaining branch stock', () => {
  const db = inventorySaleDb(1.5);
  const first = paidOrder('order-stock-1');
  const second = paidOrder('order-stock-2');

  const firstResult = financeV2.capturePaidOrder(db, first, { actor: 'inventory-test' });
  const replay = financeV2.capturePaidOrder(db, first, { actor: 'inventory-test' });
  const secondResult = financeV2.capturePaidOrder(db, second, { actor: 'inventory-test' });

  const cogsMovements = db.financeV2.inventoryMovements.filter((movement) => movement.source === 'order.cogs');
  assert.equal(firstResult.costing.event.status, 'posted');
  assert.equal(replay.costing.idempotentReplay, true);
  assert.equal(secondResult.costing.event.status, 'blocked');
  assert.equal(secondResult.costing.event.error.code, 'inventory_shortage');
  assert.equal(cogsMovements.filter((movement) => movement.sourceId === first.id).length, 1);
  assert.equal(cogsMovements.some((movement) => movement.sourceId === second.id), false);
  assert.ok(Math.abs(cogsMovements.reduce((sum, movement) => sum - movement.quantityBase, 0)) <= 1.5);
});

test('order COGS reversal restores only its own movement once before a later sale', () => {
  const db = inventorySaleDb(1);
  const original = paidOrder('order-reversed-stock');
  financeV2.capturePaidOrder(db, original, { actor: 'inventory-test' });

  const reversed = financeV2.reverseOrderCogsAndInventory(db, original.id, 'inventory-test', 'لغو آزمون', PAID_AT);
  const repeatedReversal = financeV2.reverseOrderCogsAndInventory(db, original.id, 'inventory-test', 'لغو تکراری آزمون', PAID_AT);
  const nextSale = financeV2.capturePaidOrder(db, paidOrder('order-after-reversal'), { actor: 'inventory-test' });

  assert.equal(reversed.returnMovements.length, 1);
  assert.equal(repeatedReversal.returnMovements.length, 0);
  assert.equal(nextSale.costing.event.status, 'posted');
  const netConsumed = db.financeV2.inventoryMovements
    .filter((movement) => String(movement.itemId) === 'flour-b1')
    .reduce((sum, movement) => sum + movement.quantityBase, 0);
  assert.equal(netConsumed, -1);
});

test('legacy stock consumption rejects material overdraw but permits machine-epsilon rounding noise', () => {
  const acc = {
    inventoryItems: [{ id: 'legacy-flour', branchId: 1, unit: 'g', qtyOnHand: 0.5, avgCost: 100 }],
  };

  const beyondAvailable = inventoryEngine.consumeStock(acc, {
    itemId: 'legacy-flour', branchId: 1, qty: 0.5 + 5e-10,
  });
  assert.equal(beyondAvailable.error, 'موجودی کافی برای مصرف وجود ندارد.');
  assert.equal(acc.inventoryItems[0].qtyOnHand, 0.5);
  assert.equal(acc.inventoryTransactions.length, 0);

  const exactConsumption = inventoryEngine.consumeStock(acc, {
    itemId: 'legacy-flour', branchId: 1, qty: 0.5,
  });
  assert.equal(exactConsumption.error, undefined);
  assert.equal(acc.inventoryItems[0].qtyOnHand, 0);
  assert.equal(acc.inventoryTransactions.length, 1);

  const decimalAcc = {
    inventoryItems: [{ id: 'decimal-flour', branchId: 1, unit: 'g', qtyOnHand: 0.3, avgCost: 100 }],
  };
  const roundingNoise = inventoryEngine.consumeStock(decimalAcc, {
    itemId: 'decimal-flour', branchId: 1, qty: 0.1 + 0.2,
  });
  assert.equal(roundingNoise.error, undefined);
  assert.equal(decimalAcc.inventoryItems[0].qtyOnHand, 0);
  assert.equal(decimalAcc.inventoryTransactions.length, 1);

  const largeAcc = {
    inventoryItems: [{ id: 'large-flour', branchId: 1, unit: 'g', qtyOnHand: 1e15, avgCost: 0 }],
  };
  const scaledOverdraw = inventoryEngine.consumeStock(largeAcc, {
    itemId: 'large-flour', branchId: 1, qty: 1e15 + 0.5,
  });
  assert.equal(scaledOverdraw.error, 'موجودی کافی برای مصرف وجود ندارد.');
  assert.equal(largeAcc.inventoryItems[0].qtyOnHand, 1e15);
  assert.equal(largeAcc.inventoryTransactions.length, 0);
});

test('legacy consumption cannot spend reserved, quarantined, or expired stock', () => {
  const acc = {
    inventoryItems: [{
      id: 'held-flour', branchId: 1, unit: 'g', qtyOnHand: 5, avgCost: 100,
      reservedQty: 2, quarantinedQty: 1, expiredQty: 0.5,
    }],
  };

  const sellable = inventoryEngine.consumeStock(acc, {
    itemId: 'held-flour', branchId: 1, qty: 1.5,
  });
  const heldStock = inventoryEngine.consumeStock(acc, {
    itemId: 'held-flour', branchId: 1, qty: 0.01,
  });

  assert.equal(sellable.error, undefined);
  assert.equal(acc.inventoryItems[0].qtyOnHand, 3.5);
  assert.equal(heldStock.error, 'موجودی کافی برای مصرف وجود ندارد.');
  assert.equal(acc.inventoryItems[0].qtyOnHand, 3.5);
  assert.equal(acc.inventoryTransactions.length, 1);
});

test('legacy waste cannot exceed sellable quantity by more than floating-point noise', () => {
  const acc = {
    inventoryItems: [{ id: 'waste-flour', branchId: 1, unit: 'g', qtyOnHand: 0.5, avgCost: 100 }],
  };

  assert.throws(() => inventoryEngine.recordWaste(acc, {
    itemId: 'waste-flour', branchId: 1, qty: 0.5 + 5e-10, reason: 'مرز موجودی',
  }), /موجودی کافی برای ثبت ضایعات/);
  assert.equal(acc.inventoryItems[0].qtyOnHand, 0.5);
  assert.equal(acc.wasteLog.length, 0);
  assert.equal(acc.inventoryTransactions.length, 0);
});

test('accounting demo inventory and recipes are never seeded in production', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDemoSeed = process.env.WESTO_ACCOUNTING_DEMO_SEED;
  process.env.NODE_ENV = 'production';
  process.env.WESTO_ACCOUNTING_DEMO_SEED = 'true';
  try {
    const accounting = { inventoryItems: [], recipes: [] };
    inventoryEngine.ensureInventory(accounting);

    assert.deepEqual(accounting.inventoryItems, []);
    assert.deepEqual(accounting.recipes, []);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDemoSeed === undefined) delete process.env.WESTO_ACCOUNTING_DEMO_SEED;
    else process.env.WESTO_ACCOUNTING_DEMO_SEED = previousDemoSeed;
  }
});

test('stock issue and transfer preserve order reservations, quarantined stock, and expired stock', () => {
  const db = {
    accounting: {
      inventoryItems: [{
        id: 'protected-flour', branchId: 1, unit: 'g', qtyOnHand: 10, avgCostIrr: 100,
        reservedQty: 2, quarantinedQty: 1, expiredQty: 1,
      }],
    },
    financeV2: {
      inventoryMovements: [{ itemId: 'protected-flour', branchId: 1, quantityBase: -2 }],
    },
  };
  const request = {
    branchId: 1, itemId: 'protected-flour', quantity: 5, unit: 'g',
    reason: 'تست حفاظت موجودی', sourceWarehouse: 'انبار اصلی', destinationWarehouse: 'آشپزخانه',
  };

  const issue = inventoryOperations.buildStockIssue(db, db.financeV2, request, 'inventory-test');
  const transfer = inventoryOperations.buildStockTransfer(db, db.financeV2, request, 'inventory-test');

  for (const result of [issue, transfer]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, 'movement_exceeds_available');
    assert.equal(result.issues[0].availableQuantityBase, 4);
    assert.deepEqual(db.financeV2.inventoryMovements, [{
      itemId: 'protected-flour', branchId: 1, quantityBase: -2,
    }], 'a rejected plan must not append or mutate a stock movement');
  }

  const exactlyAvailable = inventoryOperations.buildStockIssue(db, db.financeV2, {
    ...request, quantity: 4,
  }, 'inventory-test');
  assert.equal(exactlyAvailable.ok, true);
  assert.equal(exactlyAvailable.movements[0].quantityBase, -4);
});

test('stock issue tolerance accepts float rounding noise but rejects a real small overdraw', () => {
  const db = {
    accounting: {
      inventoryItems: [{ id: 'small-stock', branchId: 1, unit: 'g', qtyOnHand: 0.3, avgCostIrr: 100 }],
    },
    financeV2: { inventoryMovements: [] },
  };
  const request = { branchId: 1, itemId: 'small-stock', unit: 'g', reason: 'تست تلرانس' };

  const roundingNoise = inventoryOperations.buildStockIssue(db, db.financeV2, {
    ...request, quantity: 0.1 + 0.2,
  }, 'inventory-test');
  const realOverdraw = inventoryOperations.buildStockTransfer(db, db.financeV2, {
    ...request, quantity: 0.3 + 5e-10, sourceWarehouse: 'انبار اصلی', destinationWarehouse: 'آشپزخانه',
  }, 'inventory-test');

  assert.equal(roundingNoise.ok, true);
  assert.equal(realOverdraw.ok, false);
  assert.equal(realOverdraw.code, 'movement_exceeds_available');
  assert.equal(realOverdraw.issues[0].availableQuantityBase, 0.3);
});

test('zero-yield production records consumed ingredients and no output movement', () => {
  const recipe = {
    ...oneIngredientRecipe(), outputItemId: 'prepared-batch-b1',
  };
  const db = inventorySaleDb(2, [recipe]);
  db.accounting.inventoryItems.push({
    id: 'prepared-batch-b1', branchId: 1, name: 'محصول آماده', unit: 'عدد', qtyOnHand: 0, avgCostIrr: 100,
  });

  const result = financeV2.recordInventoryOperationV2(db, 'production_batch', {
    branchId: 1, recipeId: recipe.id, plannedYield: 1, actualYield: 0,
  }, 'inventory-test', 'full-batch-loss-test');

  assert.equal(result.physicalRecorded, true);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0].direction, 'consume');
  assert.equal(result.movements[0].itemId, 'flour-b1');
  assert.equal(result.movements[0].quantityBase, -1);
  assert.equal(result.movements.some((movement) => movement.direction === 'produce'), false);
  assert.equal(db.financeV2.inventoryMovements.length, 1);
  assert.equal(result.journalEntry?.status, 'posted');
  assert.ok(result.journalEntry.lines.some((line) => line.accountCode === '5130' && line.debitIrr === 100));
});

test('open V2 orders reserve recipe stock across snapshot reload and release on cancellation', () => {
  const db = inventorySaleDb(1);
  const order = {
    id: 'open-order-1', branchId: 1, status: 'pending', paymentStatus: 'unpaid', createdAt: PAID_AT,
    items: [{ menuItemId: 'dish-1', qty: 1 }],
  };
  order.inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(db, order.items, 1, PAID_AT);
  db.orders = [order];

  const afterReload = JSON.parse(JSON.stringify(db));
  const additionalOrder = financeV2.menuItemAvailability(afterReload, 'dish-1', 1, 1, PAID_AT);
  const editCurrentOrder = financeV2.menuItemAvailability(afterReload, 'dish-1', 1, 1, PAID_AT, { excludeOrderId: order.id });

  assert.equal(afterReload.orders[0].inventoryReservationSnapshot.items[0].itemId, 'flour-b1');
  assert.equal(afterReload.orders[0].inventoryReservationSnapshot.items[0].quantityBase, 1);
  assert.equal(additionalOrder.available, false);
  assert.equal(additionalOrder.issues.find((issue) => issue.code === 'inventory_shortage').reservedQuantity, 1);
  assert.equal(editCurrentOrder.available, true, 'editing an order excludes its own persisted hold');

  afterReload.orders[0].status = 'cancelled';
  const afterCancellation = financeV2.menuItemAvailability(afterReload, 'dish-1', 1, 1, PAID_AT);
  assert.equal(afterCancellation.available, true);
  assert.deepEqual(db.financeV2.inventoryMovements, []);
});

test('menu availability tolerates binary float noise but rejects a real fractional overdraw', () => {
  const roundingRecipe = {
    ...oneIngredientRecipe(),
    ingredients: [{ itemId: 'flour-b1', quantity: 0.1 + 0.2, unit: 'g', quantityBasis: 'raw' }],
  };
  const roundingDb = inventorySaleDb(0.3, [roundingRecipe]);
  const roundingNoise = financeV2.menuItemAvailability(roundingDb, 'dish-1', 1, 1, PAID_AT);

  assert.equal(roundingNoise.available, true, '0.1 + 0.2 should compare as the same physical quantity as 0.3');

  const overdrawRecipe = {
    ...oneIngredientRecipe(),
    ingredients: [{ itemId: 'flour-b1', quantity: 0.3 + 5e-10, unit: 'g', quantityBasis: 'raw' }],
  };
  const overdrawDb = inventorySaleDb(0.3, [overdrawRecipe]);
  const realOverdraw = financeV2.menuItemAvailability(overdrawDb, 'dish-1', 1, 1, PAID_AT);

  assert.equal(realOverdraw.available, false, 'a 5e-10 excess is real stock demand, not binary representation noise');
  assert.ok(realOverdraw.issues.some((issue) => issue.code === 'inventory_shortage'));

  const tinyQuantityRecipe = {
    ...oneIngredientRecipe(),
    ingredients: [{ itemId: 'flour-b1', quantity: 1e-8 + 1e-16, unit: 'g', quantityBasis: 'raw' }],
  };
  const tinyQuantityDb = inventorySaleDb(1e-8, [tinyQuantityRecipe]);
  const tinyRealOverdraw = financeV2.menuItemAvailability(tinyQuantityDb, 'dish-1', 1, 1, PAID_AT);

  assert.equal(tinyRealOverdraw.available, false, 'tolerance must scale with quantity rather than treating 1e-9 as negligible');
});

test('posted order COGS converts its reservation into a durable stock movement exactly once', () => {
  const db = inventorySaleDb(1);
  const order = {
    id: 'paid-stock-order', branchId: 1, status: 'paid', paymentStatus: 'paid', createdAt: PAID_AT,
    items: [{ menuItemId: 'dish-1', qty: 1 }],
  };
  order.inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(db, order.items, 1, PAID_AT);
  db.orders = [order];

  assert.equal(financeV2.menuItemAvailability(db, 'dish-1', 1, 1, PAID_AT).available, false);
  db.financeV2.inventoryMovements.push({
    id: 'cogs-movement', itemId: 'flour-b1', branchId: 1, quantityBase: -1,
    source: 'order.cogs', sourceId: order.id,
  });
  db.financeV2.events.push({
    id: 'cogs-event', source: 'order.cogs', sourceId: order.id, branchId: 1,
    status: 'posted', journalEntryId: 'cogs-journal',
  });
  db.financeV2.journalEntries.push({ id: 'cogs-journal', status: 'posted' });

  const afterReload = JSON.parse(JSON.stringify(db));
  const availability = financeV2.menuItemAvailability(afterReload, 'dish-1', 1, 1, PAID_AT);
  assert.equal(availability.available, false, 'the released hold is replaced by the posted consumption movement');
  assert.ok(availability.issues.some((issue) => issue.code === 'inventory_shortage' && issue.reservedQuantity === 0));
});

test('order reservation snapshots retain the recipe version active at reservation time', () => {
  const firstRecipe = oneIngredientRecipe();
  const nextRecipe = {
    ...oneIngredientRecipe(), id: 'recipe-dish-next', version: 2,
    effectiveFrom: '2026-09-24T00:00:00.000Z',
    ingredients: [{ itemId: 'rice-b1', quantity: 1, unit: 'g', quantityBasis: 'raw' }],
  };
  const db = inventorySaleDb(1, [firstRecipe, nextRecipe]);
  db.accounting.inventoryItems.push({ id: 'rice-b1', branchId: 1, name: 'برنج', unit: 'g', qtyOnHand: 1, avgCostIrr: 100 });
  const lines = [{ menuItemId: 'dish-1', qty: 1 }];
  const snapshot = financeV2.buildOrderInventoryReservationSnapshot(db, lines, 1, PAID_AT);

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.items.map((item) => item.itemId), ['flour-b1']);
  assert.deepEqual(snapshot.items[0].recipeVersionIds, ['recipe-dish-b1']);
});

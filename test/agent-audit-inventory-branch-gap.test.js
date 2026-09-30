'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryEngine = require('../server/finance/inventory-engine');
const inventoryOperations = require('../server/finance/inventory-operations');

test('branch-scoped inventory must not resolve branchless stock or movements as local stock', () => {
  const db = {
    accounting: {
      inventoryItems: [{ id: 'unassigned-flour', unit: 'g', qtyOnHand: 10, avgCostIrr: 100 }],
    },
  };
  const state = {
    inventoryMovements: [{ itemId: 'unassigned-flour', quantityBase: 7 }],
  };
  const legacyAccounting = {
    inventoryItems: [{ id: 'unassigned-flour', unit: 'g', qtyOnHand: 10, avgCost: 100 }],
  };
  const legacyIssue = inventoryEngine.consumeStock(legacyAccounting, {
    itemId: 'unassigned-flour', branchId: 2, qty: 2,
  });

  assert.deepEqual(
    {
      resolvedItem: inventoryOperations.inventoryItem(db, 'unassigned-flour', 2),
      branchTwoPhysical: inventoryOperations.physicalOnHand(db.accounting.inventoryItems[0], state, 2),
      legacyIssue: { accepted: !legacyIssue.error, onHand: legacyAccounting.inventoryItems[0].qtyOnHand },
    },
    {
      resolvedItem: null,
      branchTwoPhysical: { ok: true, value: 10, opening: 10, movement: 0 },
      legacyIssue: { accepted: false, onHand: 10 },
    },
  );

  assert.throws(() => inventoryEngine.receiveStock(legacyAccounting, {
    itemId: 'new-stock', itemName: 'Unknown branch stock', qty: 1, unitCost: 100,
  }), /شعبهٔ معتبر/);
  assert.match(inventoryEngine.consumeStock(legacyAccounting, {
    itemId: 'unassigned-flour', qty: 1,
  }).error, /شعبهٔ معتبر/);
  assert.throws(() => inventoryEngine.recordWaste(legacyAccounting, {
    itemId: 'unassigned-flour', qty: 1, reason: 'missing branch',
  }), /شعبهٔ معتبر/);
  assert.deepEqual(legacyAccounting.inventoryItems, [{ id: 'unassigned-flour', unit: 'g', qtyOnHand: 10, avgCost: 100 }]);
});

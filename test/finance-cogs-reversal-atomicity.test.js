'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');

test('COGS reversal fails closed when its journal period is closed', () => {
  const orderId = 'order-cogs-reversal-closed-period';
  const occurredAt = '2026-09-23T08:00:00.000Z';
  const db = {
    branches: [{ id: 1, active: true }],
    accounting: {
      settings: { autoPostOrders: false },
      inventoryItems: [{
        id: 'flour-b1', branchId: 1, name: 'آرد', unit: 'g', qtyOnHand: 2, avgCostIrr: 100,
      }],
      recipes: [{
        id: 'recipe-dish-b1', branchId: 1, menuItemId: 'dish-1', version: 1,
        status: 'approved', effectiveFrom: '2026-01-01T00:00:00.000Z', yieldQuantity: 1,
        ingredients: [{ itemId: 'flour-b1', quantity: 1, unit: 'g', quantityBasis: 'raw' }],
      }],
    },
  };
  const period = financeV2.createFiscalPeriod(db, {
    branchId: 1, name: 'Test period', startDate: '2026-01-01', endDate: '2026-12-31',
  }, 'finance-test');
  const order = {
    id: orderId, branchId: 1, orderNo: orderId, total: 1000,
    status: 'paid', paymentStatus: 'paid', paymentTender: 'cash',
    createdAt: occurredAt, paidAt: occurredAt,
    partialPayments: [{ id: `payment-${orderId}`, tender: 'cash', amount: 1000, at: occurredAt }],
    items: [{ id: `line-${orderId}`, menuItemId: 'dish-1', name: 'غذا', qty: 1, lineTotal: 1000 }],
  };

  const captured = financeV2.capturePaidOrder(db, order, { actor: 'finance-test' });
  assert.equal(captured.costing.event.status, 'posted');
  const cogsEntry = db.financeV2.journalEntries.find((entry) => entry.id === captured.costing.journalEntry.id);
  const originalMovementCount = db.financeV2.inventoryMovements.length;
  assert.ok(cogsEntry);

  period.status = 'closed';

  assert.throws(() => financeV2.reverseOrderCogsAndInventory(
    db, orderId, 'finance-test', 'لغو سفارش آزمون', occurredAt,
  ), { code: 'fiscal_period_closed', status: 409 });

  assert.equal(cogsEntry.status, 'posted');
  assert.equal(cogsEntry.reversedById, null);
  assert.equal(db.financeV2.journalEntries.some((entry) => entry.reversalOfId === cogsEntry.id), false);
  assert.equal(db.financeV2.inventoryMovements.length, originalMovementCount);
  assert.equal(db.financeV2.inventoryMovements.some((movement) => movement.source === 'order.cogs.reversal'), false);
});

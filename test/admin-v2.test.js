'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server/admin-v2');

const db = {
  orders: [
    { id: 1, orderNo: 'W-1', branchId: 1, phone: '0912', name: 'مینا', tableNo: '1', status: 'paid', paymentStatus: 'paid', total: 120000, items: [{ menuItemId: 5, name: 'قهوه', qty: 2, price: 60000 }], createdAt: new Date().toISOString() },
    { id: 2, orderNo: 'W-2', branchId: 1, phone: '0913', tableNo: '2', status: 'preparing', paymentStatus: 'paid', total: 90000, items: [], createdAt: new Date().toISOString() },
  ],
  tables: [{ id: 1, branchId: 1, label: 'میز ۱', seats: 2, zone: 'سالن', active: true }, { id: 2, branchId: 1, label: 'میز ۲', seats: 4, zone: 'سالن', active: true }],
  reservations: [], waiterCalls: [{ id: 1, branchId: 1, tableNo: '2', status: 'open' }], menuItems: [{ id: 5, name: 'قهوه', stock: 2, lowStockAt: 5 }], loyaltyLedger: [{ phone: '0912', balance: 25 }], feedback: [{ id: 1, branchId: 1, status: 'new', score: 9 }], newsletter: [{ email: 'a@example.test' }], users: [{ phone: '0912', role: 'cashier' }], branches: [{ id: 1, name: 'اصلی', active: true }], settings: { adminPhones: [] }, restaurant: {}, theme: {},
};

test('overview derives live WESTO operations without demo fixtures', () => {
  const data = __test.overview(db, 1);
  assert.equal(data.metrics.salesToday, 210000);
  assert.equal(data.metrics.activeOrders, 2);
  assert.equal(data.metrics.openWaiterCalls, 1);
});

test('floor combines active orders and waiter calls', () => {
  const data = __test.floor(db, 1);
  assert.equal(data.tables.find((table) => table.id === 1).state, 'busy');
  assert.ok(data.tables.find((table) => table.id === 1).serviceEndsAt);
  assert.ok(data.tables.find((table) => table.id === 1).serviceRemainingSec <= 45 * 60);
  assert.equal(data.tables.find((table) => table.id === 2).state, 'attention');
  assert.equal(data.summary.serviceMinutes, 45);
});

test('floor automatically releases a table after its 45 minute service window without deleting the order', () => {
  const oldOrder = { id: 3, branchId: 1, tableNo: '3', status: 'preparing', createdAt: new Date(Date.now() - 46 * 60 * 1000).toISOString(), items: [] };
  const timedDb = { ...db, orders: [...db.orders, oldOrder], tables: [...db.tables, { id: 3, branchId: 1, label: 'میز ۳', seats: 2, zone: 'تراس', active: true }] };
  const data = __test.floor(timedDb, 1);
  const released = data.tables.find((table) => table.id === 3);
  assert.equal(released.state, 'available');
  assert.equal(released.autoReleased, true);
  assert.equal(released.serviceRemainingSec, 0);
  assert.equal(timedDb.orders.includes(oldOrder), true);
  assert.equal(data.summary.autoReleased, 1);
});

test('legacy finance read model never manufactures sale entries', () => {
  const before = db.accounting?.journalEntries?.length || 0;
  const data = __test.finance(db, 1);
  assert.equal(data.summary.entries, before);
  assert.equal(db.accounting.journalEntries.length, before);
  assert.equal(data.summary.sales, 0);
});

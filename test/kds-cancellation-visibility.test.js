'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { paymentStatusFor } = require('../server/command-center');
const { isKitchenOrderPaymentEligible } = require('../server/waiter-order-invariants');
const { prepareKitchenQueue } = require('../server/kitchen-queue');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const roleSource = fs.readFileSync(path.join(root, 'js/role-panel.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const kdsCss = fs.readFileSync(path.join(root, 'css/kitchen-kds.css'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'css/panel.css'), 'utf8');

function kitchenOrdersHandler(dependencies) {
  const start = serverSource.indexOf("app.get('/api/kitchen/orders'");
  const end = serverSource.indexOf("\napp.patch('/api/kitchen/orders/:id'", start);
  assert.ok(start >= 0 && end > start, 'the GET KDS route is present');
  const routeSource = serverSource.slice(start, end);
  const arrow = routeSource.indexOf('(req, res) => {');
  const bodyStart = arrow + '(req, res) => {'.length;
  const bodyEnd = routeSource.lastIndexOf('\n});');
  assert.ok(arrow >= 0 && bodyEnd > bodyStart, 'the route handler can be isolated without booting the server');
  return new Function(...Object.keys(dependencies), `return (req, res) => {${routeSource.slice(bodyStart, bodyEnd)};};`)(...Object.values(dependencies));
}

function makeOrder({ id, status, branchId = 3, statusAt, statusHistory = [], items = [{ name: `خوراک ${id}`, qty: 1, station: 'hot' }], fulfillment = 'dine_in', tableNo = 'میز ۴', paymentStatus, deliveryAcceptance }) {
  return { id, orderNo: `W-${id}`, branchId, status, statusAt, statusHistory, items, fulfillment, tableNo, paymentStatus, deliveryAcceptance, createdAt: '2026-05-14T10:00:00.000Z' };
}

function acceptedByRestaurant(reference) {
  return {
    status: 'accepted', source: 'restaurant', reference,
    acceptedAt: '2026-05-14T11:59:59.000Z',
    acceptedBy: { phone: '09123456789', role: 'manager' },
  };
}

function runKitchenOrdersRoute(orders) {
  const fixedNow = Date.parse('2026-05-14T12:00:00.000Z');
  class FixedDate extends Date {
    static now() { return fixedNow; }
  }
  const observedCancelledOrder = [];
  const dependencies = {
    db: { orders, branches: [{ id: 3 }], menuItems: [], menuCategories: [] },
    requestedKdsBranch: () => 3,
    normalizeFulfillment: (value, { tableNo = '' } = {}) => ['dine_in', 'pickup', 'delivery'].includes(String(value || '').trim())
      ? String(value).trim()
      : tableNo ? 'dine_in' : 'pickup',
    hasAcceptedDelivery: (order) => String(order?.fulfillment || '').trim() !== 'delivery'
      || String(order?.deliveryAcceptance?.status || '').trim().toLowerCase() === 'accepted',
    paymentStatusFor,
    isKdsPaymentEligible: (order) => isKitchenOrderPaymentEligible(order, paymentStatusFor(order)),
    summarizeKdsPaymentReview: (orders, branchId) => {
      const summary = { blockedCount: 0, pendingCount: 0, unknownCount: 0, incompatibleCount: 0 };
      for (const order of orders || []) {
        if (Number(order.branchId) !== Number(branchId) || isKitchenOrderPaymentEligible(order, paymentStatusFor(order))) continue;
        summary.blockedCount += 1;
        const status = paymentStatusFor(order);
        if (status === 'pending') summary.pendingCount += 1;
        else if (status === 'unknown' || !status) summary.unknownCount += 1;
        else summary.incompatibleCount += 1;
      }
      return summary;
    },
    kitchenLines: (order, { onlyHeld = false } = {}) => (order.items || []).filter((item) => !!item.held === onlyHeld),
    kitchenTicket: (order) => {
      if (order.status === 'cancelled') observedCancelledOrder.push(order);
      order.kds = order.kds && typeof order.kds === 'object' ? order.kds : {};
      order.kds.itemStates = order.kds.itemStates || {};
      order.kds.priority = !!order.kds.priority;
      const lines = (order.items || []).filter((item) => !item.held);
      const heldCourseItems = (order.items || []).filter((item) => !!item.held);
      return {
        ...order,
        items: lines,
        heldCourseItems,
        column: ({ sent_to_kitchen: 'new', paid: 'new', preparing: 'preparing', ready: 'ready' })[order.status] || 'new',
        ageSec: 0,
        kds: { priority: !!order.kds?.priority, priorityAt: null, completedAt: null },
      };
    },
    prepareKitchenQueue,
    KDS_STATIONS: [{ id: 'expo', label: 'خروج' }, { id: 'hot', label: 'خط گرم' }],
    kdsPerformance: () => ({ averagePrepSec: 0, p90PrepSec: 0, completedToday: 0 }),
    Date: FixedDate,
  };
  const handler = kitchenOrdersHandler(dependencies);
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  handler({ query: {}, body: {} }, response);
  return { response, observedCancelledOrder, originalOrders: orders };
}

test('KDS route excludes awaiting delivery orders and includes persisted accepted delivery independently of payment', () => {
  const waitingDelivery = makeOrder({
    id: 31, status: 'awaiting_confirmation', fulfillment: 'delivery', tableNo: '', paymentStatus: 'paid',
  });
  const acceptedUnpaidDelivery = makeOrder({
    id: 32, status: 'sent_to_kitchen', fulfillment: 'delivery', tableNo: '', paymentStatus: 'unpaid',
    statusAt: '2026-05-14T11:59:59.500Z',
    deliveryAcceptance: acceptedByRestaurant('delivery-accept-32'),
  });
  const acceptedUnknownPaymentDelivery = makeOrder({
    id: 33, status: 'sent_to_kitchen', fulfillment: 'delivery', tableNo: '', paymentStatus: 'unknown',
    statusAt: '2026-05-14T11:59:59.500Z',
    deliveryAcceptance: acceptedByRestaurant('delivery-accept-33'),
  });

  const { response } = runKitchenOrdersRoute([waitingDelivery, acceptedUnpaidDelivery, acceptedUnknownPaymentDelivery]);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.tickets.map((ticket) => ticket.id), [32]);
  assert.equal(response.body.tickets[0].paymentStatus, 'unpaid', 'restaurant acceptance and payment are independent');
  assert.equal(response.body.tickets.some((ticket) => ticket.id === 31), false, 'payment alone never admits an unaccepted delivery order');
  assert.equal(response.body.tickets.some((ticket) => ticket.id === 33), false, 'unknown payment state stays blocked even after acceptance');
});

test('KDS API keeps cancellation terminal and returns recent kitchen cancellations separately without mutating stored orders', () => {
  const recent = makeOrder({
    id: 11,
    status: 'cancelled',
    statusAt: '2026-05-14T11:30:00.000Z',
    statusHistory: [{ status: 'sent_to_kitchen', at: '2026-05-14T11:00:00.000Z' }, { status: 'cancelled', at: '2026-05-14T11:30:00.000Z' }],
  });
  const undated = makeOrder({ id: 12, status: 'cancelled', statusHistory: [{ status: 'ready' }] });
  const old = makeOrder({ id: 13, status: 'cancelled', statusAt: '2026-05-13T10:00:00.000Z', statusHistory: [{ status: 'preparing' }] });
  const preKitchen = makeOrder({ id: 14, status: 'cancelled', statusAt: '2026-05-14T11:40:00.000Z', statusHistory: [{ status: 'pay_at_cashier' }] });
  const otherBranch = makeOrder({ id: 15, status: 'cancelled', branchId: 9, statusAt: '2026-05-14T11:40:00.000Z', statusHistory: [{ status: 'paid' }] });
  const preparing = makeOrder({ id: 16, status: 'preparing', paymentStatus: 'unpaid' });
  const ready = makeOrder({ id: 17, status: 'ready', paymentStatus: 'unpaid' });
  const { response, observedCancelledOrder, originalOrders } = runKitchenOrdersRoute([recent, undated, old, preKitchen, otherBranch, preparing, ready]);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.tickets.map((ticket) => ticket.id), [16, 17]);
  assert.deepEqual(response.body.cancelledTickets.map((ticket) => ticket.id), [11, 12]);
  assert.deepEqual(response.body.counts, { new: 0, preparing: 1, ready: 1, cancelled: 2 });
  assert.equal(response.body.cancellationWindowHours, 24);
  assert.equal(response.body.cancelledTickets.find((ticket) => ticket.id === 11).cancelledAt, '2026-05-14T11:30:00.000Z');
  assert.equal(response.body.cancelledTickets.find((ticket) => ticket.id === 12).cancelledAt, null);
  assert.equal(response.body.summary.itemUnits, 2, 'cancelled food is not included in active work units');
  assert.equal(observedCancelledOrder.some((order) => order === recent), false, 'cancelled tickets are formatted from a clone');
  const cancelledOriginals = originalOrders.filter((order) => order.status === 'cancelled');
  assert.equal(cancelledOriginals.every((order) => !order.kds), true, 'cancelled records stay untouched even when the formatter normalizes its input');
  assert.equal(originalOrders.find((order) => order.id === 16).kds.priority, false, 'the active formatter receives its original object as before');
});

test('cancelled queue rows never enter active ticket arrays or active counts', () => {
  const result = prepareKitchenQueue([
    { id: 1, column: 'new' },
    { id: 2, status: 'cancelled' },
  ]);
  assert.deepEqual(result.tickets.map((ticket) => ticket.id), [1]);
  assert.deepEqual(result.cancelledTickets.map((ticket) => ticket.id), [2]);
  assert.deepEqual(result.counts, { new: 1, preparing: 0, ready: 0, cancelled: 1 });
});

test('standalone KDS exposes an accessible, read-only cancellation lane and a visible jump control', () => {
  const laneStart = roleSource.indexOf('function kdsCancelledTicketMarkup(');
  const laneEnd = roleSource.indexOf('\n  }', laneStart);
  const boardStart = roleSource.indexOf('function kitchenBoard(');
  const boardEnd = roleSource.indexOf('\n  }', boardStart);
  const wiringStart = roleSource.indexOf('function wireKitchen(');
  const wiringEnd = roleSource.indexOf('\n  }', wiringStart);
  assert.ok(laneStart >= 0 && laneEnd > laneStart && boardEnd > boardStart && wiringEnd > wiringStart);
  const cardMarkup = roleSource.slice(laneStart, laneEnd);
  const boardMarkup = roleSource.slice(boardStart, boardEnd);
  const wireMarkup = roleSource.slice(wiringStart, wiringEnd);
  assert.match(boardMarkup, /data\.cancelledTickets\s*\|\|\s*\[\]/);
  assert.match(boardMarkup, /aria-controls="kds-cancelled-lane"/);
  assert.match(boardMarkup, /role="region" aria-labelledby="kds-cancelled-title"/);
  assert.match(boardMarkup, /cancelledTickets\.map\(kdsCancelledTicketMarkup\)/);
  assert.match(cardMarkup, /لغو شد/);
  assert.match(cardMarkup, /items\.map\(/);
  assert.doesNotMatch(cardMarkup, /<button/);
  assert.match(wireMarkup, /kds-cancelled-jump/);
  assert.match(wireMarkup, /lane\?\.focus/);
  assert.match(kdsCss, /\.kds-cancelled-lane/);
  assert.match(kdsCss, /\.kds-cancelled-jump:focus-visible/);
});

test('admin kitchen renders the same cancellation response as a separate non-actionable lane', () => {
  const kitchenStart = adminSource.indexOf('async kitchen() {');
  const kitchenEnd = adminSource.indexOf('\n    async reservations()', kitchenStart);
  assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart);
  const kitchenUi = adminSource.slice(kitchenStart, kitchenEnd);
  assert.match(kitchenUi, /const cancelledTickets = queue\.cancelledTickets \|\| \[\]/);
  assert.match(kitchenUi, /لغوهای اخیر/);
  assert.match(kitchenUi, /cancelledTickets\.map\(cancelledCard\)/);
  assert.match(kitchenUi, /role="region" aria-labelledby="kds-cancelled-title"/);
  const cancelledCardStart = kitchenUi.indexOf('const cancelledCard =');
  const cancelledCardEnd = kitchenUi.indexOf('const calls =', cancelledCardStart);
  assert.ok(cancelledCardStart >= 0 && cancelledCardEnd > cancelledCardStart);
  const cancelledCard = kitchenUi.slice(cancelledCardStart, cancelledCardEnd);
  assert.match(cancelledCard, /heldCourseItems/);
  assert.match(cancelledCard, /یادداشت آشپزخانه/);
  assert.doesNotMatch(cancelledCard, /<button|data-kstatus/);
  assert.match(adminCss, /\.kds-cancelled-lane--admin/);
});

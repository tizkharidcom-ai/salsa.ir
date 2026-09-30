'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { customerOrderProgress } = require('../server/customer-order-progress');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function sourceFunction(name) {
  const match = serverSource.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `missing source function: ${name}`);
  return match[0];
}

test('customer history receives only recognized payment and delivery progress fields', () => {
  const order = {
    paymentStatus: 'PAID', fulfillment: 'delivery',
    deliveryAcceptance: {
      status: 'accepted', source: 'restaurant', acceptedBy: { phone: 'private' },
      reason: 'internal', reference: 'private-ref',
    },
  };

  assert.deepEqual(customerOrderProgress(order), {
    paymentStatus: 'paid', deliveryAcceptance: { status: 'accepted' },
  });
  assert.equal(order.deliveryAcceptance.reason, 'internal', 'projection does not mutate stored order');
});

test('missing or invalid progress is not inferred and internal acceptance evidence is omitted', () => {
  assert.deepEqual(customerOrderProgress({ fulfillment: 'delivery' }), {});
  assert.deepEqual(customerOrderProgress({ paymentStatus: 'future-state', fulfillment: 'pickup' }), {});
  assert.deepEqual(customerOrderProgress({ paymentStatus: 'reconciliation_required' }), { paymentStatus: 'unknown' });
  assert.deepEqual(customerOrderProgress({
    paymentStatus: 'partial', fulfillment: 'dine_in',
    deliveryAcceptance: { status: 'accepted', reason: 'private' },
  }), { paymentStatus: 'partial' });
  assert.deepEqual(customerOrderProgress(null), {});
});

test('missing payment evidence never defaults customer order history to paid or contradicts its label', () => {
  const projectStatus = new Function(
    'customerOrderProgress',
    'normalizeCustomerOrderStatus',
    'getOrderStatusFaLabel',
    `${sourceFunction('customerOrderStatusProjection')}; return customerOrderStatusProjection;`,
  )(
    customerOrderProgress,
    (status) => ['paid', 'done', 'delivered', 'pending', 'ready'].includes(String(status || '').toLowerCase())
      ? String(status).toLowerCase() : 'unknown',
    (status) => status === 'unknown' ? 'وضعیت سفارش نامشخص' : status,
  );

  assert.deepEqual(projectStatus({}), {
    paymentStatus: 'unknown', status: 'unknown', statusLabel: 'وضعیت سفارش نامشخص',
  });
  assert.deepEqual(projectStatus({ status: 'paid' }), {
    paymentStatus: 'unknown', status: 'unknown', statusLabel: 'وضعیت سفارش نامشخص',
  });
  assert.equal(projectStatus({ status: 'paid', paymentStatus: 'paid' }).status, 'paid');
});

test('authenticated self-order route merges only the customer-safe status projection', () => {
  const start = serverSource.indexOf("app.get('/api/orders/my-orders'");
  const end = serverSource.indexOf("app.get('/api/profile/orders'", start);
  assert.ok(start >= 0 && end > start, 'self-order route exists');
  const route = serverSource.slice(start, end);
  assert.match(route, /\.\.\.customerOrderStatusProjection\(o\)/);
  assert.doesNotMatch(route, /\.\.\.o\b|deliveryAcceptance:\s*o\.deliveryAcceptance/);
});

test('an explicit different order owner cannot fall through to a colliding phone number', () => {
  const helper = serverSource.match(/function customerOwnsHistoryOrder\(order, user\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'customer-order ownership predicate exists');
  const phoneMatches = (left, right) => String(left || '').replace(/\D/g, '')
    === String(right || '').replace(/\D/g, '');
  const ownsOrder = new Function('phonesMatch', `${helper[0]}; return customerOwnsHistoryOrder;`)(phoneMatches);

  assert.equal(ownsOrder({ userId: 'account-A', phone: '09120000001' }, { id: 'account-B', phone: '09120000001' }), false);
  assert.equal(ownsOrder({ userId: 'account-A', phone: '09120000001' }, { id: 'account-A', phone: '09120000002' }), true);
  assert.equal(ownsOrder({ phone: '09120000001' }, { id: 'account-B', phone: '09120000001' }), true,
    'OTP-authenticated phone lookup remains available for an unowned guest order');
  assert.equal(ownsOrder({ userId: ' ', phone: '09120000001' }, { id: 'account-B', phone: '09120000001' }), false,
    'a malformed explicit owner fails closed instead of using phone fallback');

  const routeStart = serverSource.indexOf("app.get('/api/orders/my-orders'");
  const routeEnd = serverSource.indexOf("app.get('/api/profile/orders'", routeStart);
  assert.match(serverSource.slice(routeStart, routeEnd), /\.filter\(\(o\) => customerOwnsHistoryOrder\(o, req\.user\)\)/);
});

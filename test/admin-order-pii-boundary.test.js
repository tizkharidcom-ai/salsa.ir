'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { __test, registerAdminV2Routes } = require('../server/admin-v2');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin-v2.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const fixture = {
  id: 91,
  orderNo: 'W-91',
  branchId: 4,
  status: 'dispatched',
  fulfillment: 'delivery',
  tableNo: null,
  name: 'Guest Name',
  phone: '09120000000',
  email: 'guest@example.test',
  note: 'Call on arrival',
  address: 'Private address',
  delivery: {
    zoneId: 3,
    zoneName: 'North',
    fee: 80000,
    etaMinutes: 35,
    address: 'Private address',
    recipient: 'Guest Name',
    phone: '09120000000',
    latitude: 35.7,
    longitude: 51.4,
    secretInternalMarker: 'must-not-leak',
  },
  items: [{ id: 'line-1', menuItemId: 7, name: 'Food', qty: 2, price: 100, lineTotal: 200, privateField: 'must-not-leak' }],
  total: 200,
  paymentStatus: 'partial',
  amountPaid: 50,
  balanceDue: 150,
  partialPayments: [{ id: 'payment-1', amount: 50, tender: 'cash', reference: 'CARD-SECRET', at: '2026-09-24T10:00:00Z', rawProvider: 'must-not-leak' }],
  statusHistory: [{ status: 'dispatched', at: '2026-09-24T10:00:00Z', actorPhone: '09121111111', source: 'cashier' }],
  rawInternalMetadata: { secret: 'must-not-leak' },
};

test('orders.view DTO keeps operational fields but omits customer PII and arbitrary source properties', () => {
  const dto = __test.adminOrderDto(fixture);
  assert.equal(dto.id, 91);
  assert.equal(dto.branchId, 4);
  assert.equal(dto.status, 'dispatched');
  assert.equal(dto.items[0].name, 'Food');
  assert.equal(dto.balanceDue, 150);
  assert.equal(dto.delivery.zoneName, 'North');
  assert.equal(dto.delivery.address, undefined);
  assert.equal(dto.customer, undefined);
  assert.equal(dto.name, undefined);
  assert.equal(dto.phone, undefined);
  assert.equal(dto.email, undefined);
  assert.equal(dto.note, undefined);
  assert.equal(dto.partialPayments[0].reference, undefined);
  assert.equal(dto.statusHistory[0].actorPhone, undefined);
  assert.equal(dto.rawInternalMetadata, undefined);
  assert.equal(dto.delivery.secretInternalMarker, undefined);
  assert.equal(dto.items[0].privateField, undefined);
  assert.doesNotMatch(JSON.stringify(dto), /09120000000|guest@example\.test|Private address|CARD-SECRET|must-not-leak/);
});

test('pii.view exposes only explicit customer/contact/delivery fields and payment managers alone see receipt references', () => {
  const piiOnly = __test.adminOrderDto(fixture, { includePii: true });
  assert.deepEqual(piiOnly.customer, {
    name: 'Guest Name', phone: '09120000000', email: 'guest@example.test',
  });
  assert.equal(piiOnly.name, 'Guest Name', 'legacy order consumers receive PII only when authorized');
  assert.equal(piiOnly.phone, '09120000000');
  assert.equal(piiOnly.email, 'guest@example.test');
  assert.equal(piiOnly.note, 'Call on arrival');
  assert.equal(piiOnly.delivery.address, 'Private address');
  assert.equal(piiOnly.delivery.phone, '09120000000');
  assert.equal(piiOnly.delivery.latitude, 35.7);
  assert.equal(piiOnly.rawInternalMetadata, undefined);
  assert.equal(piiOnly.partialPayments[0].reference, undefined);

  const paymentManager = __test.adminOrderDto(fixture, { includePaymentReferences: true });
  assert.equal(paymentManager.partialPayments[0].reference, 'CARD-SECRET');
  assert.equal(paymentManager.customer, undefined);
});

test('the endpoint derives PII and payment-reference visibility from independent capabilities', () => {
  const start = source.indexOf("app.get('/api/admin/v2/orders'");
  const end = source.indexOf("app.get('/api/admin/v2/staff'", start);
  assert.ok(start >= 0 && end > start, 'orders route is present');
  const route = source.slice(start, end);
  assert.match(route, /requireCapability\('orders\.view'\)/);
  assert.match(route, /commandCenter\.can\(req\.user, 'pii\.view', settings\)/);
  assert.match(route, /commandCenter\.can\(req\.user, 'payments\.manage', settings\)/);
  assert.match(route, /commandCenter\.can\(req\.user, 'delivery\.manage', settings\)/);
  assert.match(route, /operationalOrderDto\(order, \{ includePii, includePaymentReferences, includeDeliveryReason \}\)/);
  assert.doesNotMatch(route, /\(\{ \.\.\.order/);
});

test('admin v2 orders handler returns rejection reason only to delivery managers and never leaks cashier PII', () => {
  const order = {
    ...fixture,
    status: 'awaiting_confirmation',
    deliveryAcceptance: {
      status: 'rejected',
      reason: 'نشانی خارج از محدودهٔ ارسال',
      rejectedBy: { phone: '09121112222', role: 'cashier' },
      reference: 'rejection-reference-91',
    },
  };
  let ordersHandler = null;
  const app = new Proxy({}, {
    get(_target, method) {
      return (routePath, ...handlers) => {
        if (method === 'get' && routePath === '/api/admin/v2/orders') ordersHandler = handlers.at(-1);
      };
    },
  });
  registerAdminV2Routes({
    app,
    getDb: () => ({ orders: [order], settings: {} }),
    save() {},
    requireCapability: () => (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    parseBranchId: () => 4,
    normalizeDigits: String,
    phoneRe: /^\+?\d{8,15}$/,
    recordAudit() {},
    appendAudit() {},
  });
  assert.equal(typeof ordersHandler, 'function');

  const fetchAs = (role) => {
    let payload;
    ordersHandler({ user: { role }, query: {} }, {
      json(value) { payload = value; return this; },
    });
    return payload.orders[0];
  };

  const cashierOrder = fetchAs('cashier');
  assert.deepEqual(cashierOrder.deliveryAcceptance, {
    status: 'rejected', reason: 'نشانی خارج از محدودهٔ ارسال',
  });
  assert.equal(cashierOrder.customer, undefined);
  assert.equal(cashierOrder.phone, undefined);
  assert.equal(cashierOrder.delivery.address, undefined);
  assert.doesNotMatch(JSON.stringify(cashierOrder), /09120000000|guest@example\.test|Private address|rejection-reference-91|09121112222/);

  const waiterOrder = fetchAs('waiter');
  assert.deepEqual(waiterOrder.deliveryAcceptance, { status: 'rejected' });
  assert.equal(waiterOrder.partialPayments[0].reference, undefined);
  assert.doesNotMatch(JSON.stringify(waiterOrder), /نشانی خارج از محدودهٔ ارسال|09120000000|Private address/);
});

test('legacy orders endpoint applies the allowlisted DTO to live and both closed-history sources', () => {
  const start = serverSource.indexOf("app.get('/api/admin/orders'");
  const end = serverSource.indexOf("app.post('/api/staff/orders'", start);
  assert.ok(start >= 0 && end > start, 'legacy orders endpoint is present');
  const route = serverSource.slice(start, end);
  assert.match(route, /const includePii = userCan\(req\.user, 'pii\.view'\)/);
  assert.match(route, /const includePaymentReferences = userCan\(req\.user, 'payments\.manage'\)/);
  assert.match(route, /includeDeliveryReason: userCan\(req\.user, 'delivery\.manage'\)/);
  assert.match(route, /archive\.orders\s*\|\|\s*\[\]\)\.map\(\(order\) => adminOrderDto\(order, orderOptions\)\)/);
  assert.match(route, /cached\.orders\s*\|\|\s*\[\]\)\.map\(\(order\) => adminOrderDto\(order, orderOptions\)\)/);
  assert.match(route, /orders\.map\(\(order\) => operationalOrderResponse\(order, req\.user\)\)/);
  assert.doesNotMatch(route, /orders:\s*orders\s*[,}]/);
});

test('operational order actions are derived from persisted delivery provenance before it is projected away', () => {
  const acceptedAt = new Date(Date.now() - 60_000).toISOString();
  const kitchenAt = new Date(Date.now() - 30_000).toISOString();
  const fullOrder = {
    id: 92,
    branchId: 4,
    status: 'ready',
    fulfillment: 'delivery',
    paymentStatus: 'paid',
    amountPaid: 200,
    total: 200,
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      acceptedAt,
      acceptedBy: { phone: '09121112222', role: 'cashier' },
      reference: 'acceptance-reference-92',
    },
    statusHistory: [{ status: 'ready', at: kitchenAt, source: 'kitchen' }],
  };

  const dto = __test.operationalOrderDto(fullOrder);
  assert.ok(dto.allowedStatusTransitions.includes('dispatched'));
  assert.deepEqual(dto.deliveryAcceptance, { status: 'accepted' });
  assert.equal(dto.deliveryAcceptance.acceptedAt, undefined);
  assert.equal(dto.deliveryAcceptance.source, undefined);
  assert.equal(dto.deliveryAcceptance.acceptedBy, undefined);
  assert.equal(dto.deliveryAcceptance.reference, undefined);

  const unaccepted = __test.operationalOrderDto({ ...fullOrder, deliveryAcceptance: null });
  assert.equal(unaccepted.allowedStatusTransitions.includes('dispatched'), false);
});

test('delivery rejection free text requires delivery.manage independently of pii.view', () => {
  const order = {
    ...fixture,
    status: 'awaiting_confirmation',
    deliveryAcceptance: {
      status: 'rejected',
      reason: 'آدرس نیاز به تأیید تلفنی دارد',
      rejectedBy: { phone: '09121112222' },
      reference: 'rejection-reference-92',
    },
  };
  const piiOnly = __test.operationalOrderDto(order, { includePii: true });
  assert.deepEqual(piiOnly.deliveryAcceptance, { status: 'rejected' });
  const deliveryManager = __test.operationalOrderDto(order, { includeDeliveryReason: true });
  assert.deepEqual(deliveryManager.deliveryAcceptance, {
    status: 'rejected',
    reason: 'آدرس نیاز به تأیید تلفنی دارد',
  });
  assert.doesNotMatch(JSON.stringify(deliveryManager), /09121112222|rejection-reference-92/);
});

test('payment DTO exposes receipt references only to payments.manage and strips internal evidence', () => {
  const payment = {
    id: 'payment-92',
    tender: 'manual_card',
    amount: 100,
    amountTendered: 100,
    changeDue: 0,
    at: '2026-09-24T10:00:00Z',
    idempotencyKey: 'settlement-key-92',
    reference: 'CARD-SECRET',
    requestFingerprint: 'private-fingerprint',
    by: '09120000000',
  };

  const waiterDto = __test.adminPaymentDto(payment);
  assert.equal(waiterDto.reference, undefined);
  assert.equal(waiterDto.idempotencyKey, 'settlement-key-92');
  assert.equal(waiterDto.requestFingerprint, undefined);
  assert.equal(waiterDto.by, undefined);

  const paymentManagerDto = __test.adminPaymentDto(payment, { includePaymentReferences: true });
  assert.equal(paymentManagerDto.reference, 'CARD-SECRET');
  assert.equal(paymentManagerDto.requestFingerprint, undefined);
});

test('cashier and waiter order mutation routes return projected orders and capability-gated payment DTOs', () => {
  const start = serverSource.indexOf("app.post('/api/staff/orders'");
  const end = serverSource.indexOf('/* ---- Kitchen Display System (KDS) ---- */', start);
  assert.ok(start >= 0 && end > start, 'staff/cashier/waiter order mutation routes are present');
  const routes = serverSource.slice(start, end);
  const helperStart = serverSource.indexOf('function operationalOrderResponse(order, user)');
  const helperEnd = serverSource.indexOf('\nfunction operationalPaymentResponse', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'central operational response projection exists');
  assert.match(serverSource.slice(helperStart, helperEnd), /userCan\(user, 'pii\.view'\)[\s\S]*?userCan\(user, 'payments\.manage'\)[\s\S]*?userCan\(user, 'delivery\.manage'\)/);
  assert.match(routes, /operationalPaymentResponse\(existingPayment, req\.user\)/);
  assert.match(routes, /operationalPaymentResponse\(payment, req\.user\)/);
  assert.doesNotMatch(routes, /(?:order|primaryOrder|splitOrder):\s*(?:order|subOrder|replayOrder)\s*[,}]/);
});

test('delivery mutation response keeps only capability-gated rejection reason and projected order state', () => {
  const start = serverSource.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const end = serverSource.indexOf("app.patch('/api/admin/orders/:id'", start);
  assert.ok(start >= 0 && end > start, 'delivery acceptance/rejection routes are present');
  const routes = serverSource.slice(start, end);
  assert.match(routes, /order: operationalOrderResponse\(order, req\.user\)/);
  assert.doesNotMatch(routes, /order:\s*order\s*[,}]/);
  assert.match(serverSource, /includeDeliveryReason: userCan\(user, 'delivery\.manage'\)/);
});

test('wallet settlement replay and paid fast path use safe order/payment projections', () => {
  const start = serverSource.indexOf("app.post('/api/orders/:id/pay-wallet', requireAuth");
  const end = serverSource.indexOf("app.get('/api/admin/wallet/summary'", start);
  assert.ok(start >= 0 && end > start, 'wallet settlement route is present');
  const route = serverSource.slice(start, end);
  assert.match(route, /idempotent: true,[\s\S]{0,120}order: operationalOrderResponse\(order, req\.user\),[\s\S]{0,100}payment: operationalPaymentResponse\(existingWalletPayment, req\.user\)/,
    'wallet idempotent replay must not return the persisted order/payment objects');
  assert.match(route, /if \(order\.paymentStatus === 'paid'\) \{\s*return res\.json\(\{ ok: true, idempotent: true, order: operationalOrderResponse\(order, req\.user\) \}\);/,
    'the paid fast path must use the same PII-gated order projection');
  assert.match(route, /order: operationalOrderResponse\(order, req\.user\)[\s\S]*?paymentResult: \{[\s\S]*?amountPaid: paymentResult\?\.amountPaid[\s\S]*?newBalance: paymentResult\?\.newBalance/,
    'the committed wallet response projects the order and omits the raw wallet ledger entry');
  assert.match(route, /userCan\(req\.user, 'payments\.manage'\) && error\.details/,
    'internal finance error details are restricted to payment managers');
  assert.doesNotMatch(route, /order, payment: existingWalletPayment|paymentResult,\s*finance: financeResult/);
});

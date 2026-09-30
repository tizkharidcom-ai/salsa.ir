'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { paymentProviderPublicStatus } = require('../server/payment-provider-status');

const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
const webhookStart = server.indexOf("app.post('/api/payments/webhook/:provider'");
const webhookEnd = server.indexOf('function getOrderStatusFaLabel(', webhookStart);
assert.ok(webhookStart >= 0 && webhookEnd > webhookStart, 'payment webhook route boundaries exist');
const webhook = server.slice(webhookStart, webhookEnd);

test('production payment status never reports the local sandbox as an available provider', () => {
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox', enabled: true }, {
    nodeEnv: 'production', providerReady: false,
  }), { mode: 'unavailable', provider: null, enabled: false });
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'live', provider: 'zarinpal', enabled: true }, {
    nodeEnv: 'production', providerReady: false,
  }), { mode: 'unavailable', provider: null, enabled: false });
});

test('ready development sandbox and explicitly disabled configuration remain accurately represented', () => {
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox', enabled: true }, {
    nodeEnv: 'development', providerReady: false,
  }), { mode: 'sandbox', provider: 'sandbox', enabled: true });
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox', enabled: false }, {
    nodeEnv: 'development', providerReady: false,
  }), { mode: 'sandbox', provider: 'sandbox', enabled: false });
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'disabled', provider: 'sandbox', enabled: true }, {
    nodeEnv: 'development', providerReady: true,
  }), { mode: 'disabled', provider: null, enabled: false });
});

test('sandbox and live provider identities cannot be crossed by configuration', () => {
  const unavailable = { mode: 'unavailable', provider: null, enabled: false };
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'zarinpal', enabled: true }, {
    nodeEnv: 'development', providerReady: true,
  }), unavailable, 'a real-provider name cannot inherit local sandbox readiness');
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'live', provider: 'sandbox', enabled: true }, {
    nodeEnv: 'production', providerReady: true,
  }), unavailable, 'the sandbox identity cannot be presented as a live provider');
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'staging', provider: 'zarinpal', enabled: true }, {
    nodeEnv: 'development', providerReady: true,
  }), unavailable, 'unknown modes fail closed');
});

test('live readiness requires an explicit provider readiness assertion', () => {
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'live', provider: 'zarinpal', enabled: true }, {
    nodeEnv: 'development', providerReady: true,
  }), { mode: 'unavailable', provider: null, enabled: false },
  'the local readiness shortcut cannot advertise a live gateway');
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'live', provider: 'zarinpal', enabled: true }, {
    nodeEnv: 'production', providerReady: false,
  }), { mode: 'unavailable', provider: null, enabled: false });
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'live', provider: ' ZARINPAL ', enabled: true }, {
    nodeEnv: 'production', providerReady: true,
  }), { mode: 'live', provider: 'zarinpal', enabled: true });
});

test('payment webhook stays closed in production and validates sandbox identity, token, and exact amount before mutation', () => {
  const productionGate = webhook.indexOf("process.env.NODE_ENV === 'production'");
  const sandboxIdentityGate = webhook.indexOf("payment.mode !== 'sandbox' || payment.provider !== 'sandbox'");
  const tokenCheck = webhook.indexOf('req.body.token !== payment.sandboxToken');
  const amountCheck = webhook.indexOf('!Number.isSafeInteger(callbackAmount)');
  const snapshot = webhook.indexOf('const snapshot = snapshotFinanceMutationState()');
  assert.ok(productionGate >= 0 && sandboxIdentityGate > productionGate && tokenCheck > sandboxIdentityGate
    && amountCheck > tokenCheck && snapshot > amountCheck,
  'production and non-sandbox callbacks must be rejected before mutation; sandbox amount must match exactly');
  assert.match(webhook, /callbackAmount !== expectedAmount/);
  assert.match(webhook, /payment_webhook_provider_unavailable/);
});

test('checkout metadata and the admin delivery payment view share one provider-truth function', () => {
  const readinessStart = server.indexOf('function productionPaymentProviderReady()');
  const readinessEnd = server.indexOf('\n}', readinessStart) + 2;
  const checkoutMetaStart = server.indexOf("app.get('/api/checkout/meta'");
  const checkoutMetaEnd = server.indexOf("app.post('/api/checkout/quote'", checkoutMetaStart);
  const adminPaymentsStart = server.indexOf("app.get('/api/admin/payments'");
  const adminPaymentsEnd = server.indexOf('function maybeAwardOrderLoyalty', adminPaymentsStart);
  assert.ok(checkoutMetaStart >= 0 && checkoutMetaEnd > checkoutMetaStart);
  assert.ok(adminPaymentsStart >= 0 && adminPaymentsEnd > adminPaymentsStart);
  assert.ok(readinessStart >= 0 && readinessEnd > readinessStart);
  const readiness = server.slice(readinessStart, readinessEnd);
  assert.match(server.slice(checkoutMetaStart, checkoutMetaEnd), /paymentProviderPublicStatus\(db\.paymentProvider/);
  assert.match(server.slice(adminPaymentsStart, adminPaymentsEnd), /provider: paymentProviderPublicStatus\(db\.paymentProvider/);
  assert.match(readiness, /db\.paymentProvider\?\.enabled === false/);
  assert.match(readiness, /configuredMode === 'disabled'/);
  assert.match(admin, /unavailable:\s*'در دسترس نیست'/);
  assert.match(admin, /if \(!provider\) return 'بدون درگاه'/);
  assert.match(admin, /String\(value \|\| 'نامشخص'\)/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { paymentAttemptTransition } = require('../server/payment-attempt-transitions');
const { paymentProviderPublicStatus } = require('../server/payment-provider-status');

const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

function sourceBlock(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `server source block exists: ${startMarker}`);
  return server.slice(start, end);
}

const settleStart = server.indexOf('function settlePaymentAttempt(');
const settleEnd = server.indexOf('\nfunction publishPaymentCommitEffects(', settleStart);
assert.ok(settleStart >= 0 && settleEnd > settleStart, 'payment settlement helper boundaries exist');
const settle = server.slice(settleStart, settleEnd);

function isolatedSettlement(db) {
  const context = { db, paymentAttemptTransition };
  return vm.runInNewContext(`${settle}; settlePaymentAttempt;`, context, {
    timeout: 100,
    filename: 'isolated-payment-settlement.js',
  });
}

const webhook = sourceBlock("app.post('/api/payments/webhook/:provider'", '\nfunction getOrderStatusFaLabel(');

test('provider enablement is opt-in and malformed persisted values fail closed', () => {
  const disabled = { mode: 'sandbox', provider: 'sandbox', enabled: false };
  for (const value of ['false', 'true', '0', 0, 1, null, {}, []]) {
    assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox', enabled: value }, {
      nodeEnv: 'development',
    }), disabled, `enabled=${JSON.stringify(value)} is not an explicit boolean opt-in`);
  }
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox' }, {
    nodeEnv: 'development',
  }), disabled, 'missing enablement is not treated as consent');
  assert.deepEqual(paymentProviderPublicStatus({ mode: 'sandbox', provider: 'sandbox', enabled: true }, {
    nodeEnv: 'development',
  }), { mode: 'sandbox', provider: 'sandbox', enabled: true });
});

test('callback state replays are idempotent while contradictory late outcomes require reconciliation', () => {
  for (const status of ['pending', 'unknown', 'reconciliation_required', 'paid', 'failed', 'cancelled']) {
    assert.deepEqual(paymentAttemptTransition(status, status), { ok: true, idempotent: true }, status);
  }
  assert.deepEqual(paymentAttemptTransition('paid', 'failed'), {
    ok: false, error: 'payment_paid_terminal',
  });
  assert.deepEqual(paymentAttemptTransition('failed', 'paid'), {
    ok: false, error: 'payment_terminal_conflict',
  });
  assert.deepEqual(paymentAttemptTransition('failed', 'reconciliation_required'), {
    ok: true, idempotent: false,
  });
  assert.deepEqual(paymentAttemptTransition('unknown', 'paid'), {
    ok: false, error: 'payment_status_reconciliation_required',
  });
});

test('settlement treats identical non-paid callbacks as no-ops and rejects paid replay reference changes', () => {
  assert.match(settle, /paymentAttemptTransition\(payment\.status, status\)/);
  assert.match(settle, /alreadyPaid && reference && String\(reference\)\.trim\(\) !== String\(payment\.reference \|\| ''\)\.trim\(\)/,
    'a paid callback replay cannot replace the settled provider reference');
  assert.match(settle, /transition\.idempotent && !alreadyPaid[\s\S]*?return \{ payment, order: existingOrder \|\| null, finance: null, idempotent: true \}/,
    'same-status terminal callbacks return before mutating or reposting finance');
  assert.match(settle, /if \(status === 'paid'\)[\s\S]*?captureOnlinePaidOrder/,
    'only a paid settlement invokes the idempotent finance capture path');
});

test('the real settlement helper safely replays failed callbacks and rejects a paid reference change', () => {
  const order = { id: 44, branchId: 3, status: 'pending_online' };
  const failedPayment = {
    id: 70, orderId: 44, branchId: 3, status: 'failed', reference: 'gateway-failure-70', updatedAt: 'before',
  };
  const settleFailureReplay = isolatedSettlement({ orders: [order] });
  const failedReplay = settleFailureReplay(failedPayment, {
    status: 'failed', reference: 'gateway-failure-70', source: 'sandbox',
  });
  assert.equal(failedReplay.idempotent, true);
  assert.equal(failedPayment.reference, 'gateway-failure-70');
  assert.equal(failedPayment.updatedAt, 'before');
  assert.equal(order.status, 'pending_online');

  const paidPayment = {
    id: 71, orderId: 44, branchId: 3, status: 'paid', reference: 'gateway-paid-71', updatedAt: 'settled',
  };
  const settlePaidReplay = isolatedSettlement({ orders: [order] });
  const paidReplayConflict = settlePaidReplay(paidPayment, {
    status: 'paid', reference: 'different-provider-reference', source: 'sandbox',
  });
  assert.equal(paidReplayConflict.error, 'payment_reference_conflict');
  assert.equal(paidReplayConflict.status, 409);
  assert.equal(paidPayment.reference, 'gateway-paid-71');
  assert.equal(paidPayment.updatedAt, 'settled');
});

test('webhook rejects untrusted callbacks before snapshot or persistence', () => {
  const productionGate = webhook.indexOf("process.env.NODE_ENV === 'production'");
  const sandboxIdentityGate = webhook.indexOf("payment.mode !== 'sandbox' || payment.provider !== 'sandbox'");
  const tokenGate = webhook.indexOf('req.body.token !== payment.sandboxToken');
  const amountGate = webhook.indexOf('callbackAmount !== expectedAmount');
  const snapshot = webhook.indexOf('const snapshot = snapshotFinanceMutationState()');
  const settlement = webhook.indexOf('result = settlePaymentAttempt(');
  const persistence = webhook.indexOf('await persistFinanceMutation(snapshot)');
  assert.ok(productionGate >= 0 && sandboxIdentityGate > productionGate
    && tokenGate > sandboxIdentityGate && amountGate > tokenGate
    && snapshot > amountGate && settlement > snapshot && persistence > settlement,
  'production, identity, token, and exact amount checks must precede all writes');
  assert.match(webhook, /payment_webhook_provider_unavailable/);
  assert.match(webhook, /payment_amount_mismatch/);
});

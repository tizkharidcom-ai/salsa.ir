'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentAttemptTransition, orderPaymentStatusForAttempt } = require('../server/payment-attempt-transitions');
const { canSettleOrder, paymentStatusFor } = require('../server/command-center');

const transitionMatrix = [
  {
    current: 'pending',
    allowed: ['pending', 'unknown', 'reconciliation_required', 'paid', 'failed', 'cancelled'],
    defaultError: null,
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'unknown',
    allowed: ['unknown', 'reconciliation_required'],
    defaultError: 'payment_status_reconciliation_required',
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'reconciliation_required',
    allowed: ['reconciliation_required', 'paid', 'failed', 'cancelled'],
    defaultError: 'payment_reconciliation_regression',
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'paid',
    allowed: ['paid'],
    defaultError: 'payment_paid_terminal',
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'failed',
    allowed: ['failed', 'reconciliation_required'],
    defaultError: 'payment_terminal_conflict',
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'cancelled',
    allowed: ['cancelled', 'reconciliation_required'],
    defaultError: 'payment_terminal_conflict',
    errorsByTarget: { refunded: 'payment_refund_requires_reversal' },
  },
  {
    current: 'refunded',
    allowed: ['refunded'],
    defaultError: 'payment_refund_terminal',
    errorsByTarget: {},
  },
];

test('the table-driven transition matrix makes retries safe and terminal states irreversible', () => {
  const statuses = transitionMatrix.map(({ current }) => current);

  for (const row of transitionMatrix) {
    for (const requested of statuses) {
      const label = `${row.current} -> ${requested}`;
      const actual = paymentAttemptTransition(row.current, requested);

      if (row.allowed.includes(requested)) {
        assert.deepEqual(actual, {
          ok: true,
          idempotent: row.current === requested,
        }, label);
        continue;
      }

      const error = row.errorsByTarget[requested] || row.defaultError;
      assert.ok(error, `test matrix must define rejection for ${label}`);
      assert.deepEqual(actual, { ok: false, error }, label);
    }
  }
});

test('unknown payment outcomes stay explicit until reconciliation is requested', () => {
  assert.deepEqual(paymentAttemptTransition('pending', 'unknown'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('unknown', 'unknown'), { ok: true, idempotent: true });
  assert.deepEqual(paymentAttemptTransition('unknown', 'paid'), {
    ok: false,
    error: 'payment_status_reconciliation_required',
  });
  assert.deepEqual(paymentAttemptTransition('unknown', 'reconciliation_required'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('reconciliation_required', 'paid'), { ok: true, idempotent: false });
  assert.deepEqual(paymentAttemptTransition('reconciliation_required', 'unknown'), {
    ok: false,
    error: 'payment_reconciliation_regression',
  });
});

test('unknown or missing current states are never silently treated as pending', () => {
  for (const current of [undefined, null, '', 'settled', 0]) {
    assert.deepEqual(paymentAttemptTransition(current, 'paid'), {
      ok: false,
      error: 'payment_current_status_invalid',
    }, String(current));
  }
});

test('invalid requested states are rejected and normalized state replays remain idempotent', () => {
  for (const requested of [undefined, null, '', 'authorized', 1]) {
    assert.deepEqual(paymentAttemptTransition('pending', requested), {
      ok: false,
      error: 'payment_status_invalid',
    }, String(requested));
  }

  assert.deepEqual(paymentAttemptTransition(' PAID ', 'paid'), { ok: true, idempotent: true });
});

test('terminal failures can only be reopened through explicit reconciliation', () => {
  for (const terminal of ['failed', 'cancelled']) {
    assert.deepEqual(paymentAttemptTransition(terminal, 'paid'), {
      ok: false,
      error: 'payment_terminal_conflict',
    }, `${terminal} cannot become paid directly`);
    assert.deepEqual(paymentAttemptTransition(terminal, 'reconciliation_required'), {
      ok: true,
      idempotent: false,
    }, `${terminal} can enter the explicit recovery path`);
    assert.deepEqual(paymentAttemptTransition('reconciliation_required', 'paid'), {
      ok: true,
      idempotent: false,
    });
  }

  assert.deepEqual(paymentAttemptTransition('paid', 'reconciliation_required'), {
    ok: false,
    error: 'payment_paid_terminal',
  }, 'a confirmed capture must be reversed, not rewritten as an unresolved attempt');
});

test('attempt reconciliation status projects to an order-level unknown state and stays unpayable', () => {
  assert.equal(orderPaymentStatusForAttempt('reconciliation_required'), 'unknown');
  assert.equal(orderPaymentStatusForAttempt('unknown'), 'unknown');
  assert.equal(orderPaymentStatusForAttempt('failed'), 'failed');
  assert.equal(orderPaymentStatusForAttempt('paid'), 'paid');
  assert.equal(orderPaymentStatusForAttempt('refunded'), null);

  const order = {
    status: 'awaiting_confirmation',
    fulfillment: 'delivery',
    paymentStatus: orderPaymentStatusForAttempt('reconciliation_required'),
  };
  assert.equal(paymentStatusFor(order), 'unknown');
  assert.equal(canSettleOrder(order), false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSettlementAmounts } = require('../server/settlement-amounts');

const production = { environment: () => 'production' };

test('fully refunded unsupported tender does not block a new cashier split, while any effective unsupported balance still fails closed', () => {
  const recollectAfterRefund = resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 0,
    payments: [{
      id: 'online-refunded-1',
      tender: 'online',
      amount: 4_000,
      refundedAmount: 4_000,
    }],
    tender: 'cash',
    paymentAmount: 2_500,
    amountTendered: 3_000,
  }, production);

  assert.deepEqual(recollectAfterRefund, {
    ok: true,
    orderTotal: 10_000,
    alreadyPaid: 0,
    outstanding: 10_000,
    requestedAmount: 2_500,
    amountTendered: 3_000,
  });

  const onlineStillHasBalance = resolveSettlementAmounts({
    total: 10_000,
    amountPaid: 1_000,
    payments: [{
      id: 'online-part-refund-1',
      tender: 'online',
      amount: 4_000,
      refundedAmount: 3_000,
    }],
    tender: 'manual_card',
    paymentAmount: 9_000,
  }, production);
  assert.equal(onlineStillHasBalance.error, 'partial_settlement_not_approved');
});

test('cash split amount is bounded by the net due and fractional Toman is never rounded', () => {
  const existingCashLeg = [{ id: 'cash-leg-1', tender: 'cash', amount: 4_000 }];
  const base = {
    total: 10_000,
    amountPaid: 4_000,
    payments: existingCashLeg,
    tender: 'manual_card',
  };

  assert.equal(resolveSettlementAmounts({ ...base, paymentAmount: 6_001 }, production).error,
    'payment_amount_exceeds_due');
  assert.equal(resolveSettlementAmounts({ ...base, paymentAmount: 5_999.5 }, production).error,
    'payment_amount_invalid');
  assert.deepEqual(resolveSettlementAmounts({ ...base, paymentAmount: 6_000 }, production), {
    ok: true,
    orderTotal: 10_000,
    alreadyPaid: 4_000,
    outstanding: 6_000,
    requestedAmount: 6_000,
    amountTendered: 6_000,
  });
});

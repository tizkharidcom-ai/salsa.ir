'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const financeV2 = require('../server/finance-v2');
const periodService = require('../server/finance/period-service');

const period = {
  id: 'period-boundary',
  name: 'دوره مرزی',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  status: 'open',
};

test('Finance V2 includes the full final fiscal-period day', () => {
  const db = { financeV2: { fiscalPeriods: [period] } };
  assert.equal(financeV2.validateOpenPeriod(db, '2026-08-31T23:59:59.999Z').ok, true);
  assert.equal(financeV2.validateOpenPeriod(db, '2026-09-01T00:00:00.000Z').ok, false);
});

test('legacy accounting period service includes the full final fiscal-period day', () => {
  const acc = { fiscalPeriods: [period] };
  assert.equal(periodService.findPeriodForDate(acc, '2026-08-31T23:59:59.999Z').id, period.id);
  assert.equal(periodService.findPeriodForDate(acc, '2026-09-01T00:00:00.000Z'), undefined);
});

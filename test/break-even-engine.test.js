'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../server/finance/break-even-engine');

const baselineLines = [
  { id: 'rent', name: 'اجاره', monthlyAmountIrr: 8_000_000_000 },
  { id: 'payroll', name: 'حقوق', monthlyAmountIrr: 4_500_000_000 },
  { id: 'utilities', name: 'آب و برق و گاز', monthlyAmountIrr: 300_000_000 },
];

test('break-even projection allocates the stated monthly baseline exactly across a full calendar month', () => {
  const schedule = engine.fixedCostSchedule(baselineLines, engine.dateRange('2026-08-01', '2026-08-31'));
  assert.equal(schedule.length, 31);
  assert.equal(schedule.reduce((sum, row) => sum + row.fixedCostIrr, 0), 12_800_000_000);
});

test('break-even projection distinguishes actual performance, forecast and the profitability deadline', () => {
  const actualDaily = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    salesIrr: 1_000_000_000,
    variableCostIrr: 400_000_000,
  }));
  const result = engine.buildBreakEvenProjection({
    startDate: '2026-08-01',
    deadlineDate: '2026-08-31',
    asOfDate: '2026-08-10',
    fixedCostLines: baselineLines,
    actualDaily,
    source: { type: 'posted_ledger', official: true },
  });

  assert.equal(result.status, 'available');
  assert.equal(result.fixedCostTotalIrr, 12_800_000_000);
  assert.equal(result.actual.netSalesIrr, 10_000_000_000);
  assert.equal(result.actual.variableCostIrr, 4_000_000_000);
  assert.equal(result.contributionMarginRatio, 0.6);
  assert.equal(result.breakEvenSalesIrr, 21_333_333_334);
  assert.equal(result.gapIrr, 11_333_333_334);
  assert.equal(result.remainingOpenDays, 21);
  assert.equal(result.requiredDailySalesIrr, 539_682_540);
  assert.equal(result.series.length, 32);
  assert.equal(result.series.at(10).isActual, true);
  assert.equal(result.series.at(11).isForecast, true);
  assert.ok(result.forecast.breakEvenDate > '2026-08-10');
  assert.equal(result.forecast.deadlineStatus, 'on_track');
});

test('break-even projection rejects optimistic forecasts when revenue has no covered variable cost', () => {
  const result = engine.buildBreakEvenProjection({
    startDate: '2026-08-01',
    deadlineDate: '2026-08-31',
    asOfDate: '2026-08-03',
    fixedCostLines: baselineLines,
    actualDaily: [{ date: '2026-08-01', salesIrr: 2_000_000_000, variableCostIrr: 0 }],
  });

  assert.equal(result.status, 'insufficient_data');
  assert.deepEqual(result.missing, ['variable_cost']);
  assert.equal(result.breakEvenSalesIrr, null);
  assert.deepEqual(result.series, []);
});

test('break-even projection keeps a missed deadline distinct from a future at-risk forecast', () => {
  const result = engine.buildBreakEvenProjection({
    startDate: '2026-08-01',
    deadlineDate: '2026-08-03',
    asOfDate: '2026-08-05',
    fixedCostLines: baselineLines,
    actualDaily: [{ date: '2026-08-01', salesIrr: 1_000_000_000, variableCostIrr: 900_000_000 }],
  });

  assert.equal(result.status, 'available');
  assert.equal(result.forecast.deadlineStatus, 'missed');
  assert.equal(result.forecast.breakEvenDate, null);
});

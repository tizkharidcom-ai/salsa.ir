'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOMAN_TO_IRR,
  PLANNING_ASSUMPTION_STATUS,
  PLANNING_ASSUMPTION_SOURCE,
  DEADLINE_NEEDS_INPUT_STATUS,
  DEADLINE_CONFIGURED_STATUS,
  createBreakEvenPlanningDefaults,
  getMonthlyPlanningCostSummary,
} = require('../server/finance/break-even-defaults');

function assumptionById(scenario, id) {
  return scenario.assumptions.find((item) => item.id === id);
}

test('break-even defaults retain the exact user assumptions in Toman and canonical IRR', () => {
  const scenario = createBreakEvenPlanningDefaults();
  const rent = assumptionById(scenario, 'planning-rent-monthly');
  const payroll = assumptionById(scenario, 'planning-payroll-monthly');
  const utilities = assumptionById(scenario, 'planning-utilities-monthly');

  assert.equal(TOMAN_TO_IRR, 10);
  assert.deepEqual(
    { toman: rent.amountToman, irr: rent.amountIrr },
    { toman: 800_000_000, irr: 8_000_000_000 },
  );
  assert.deepEqual(
    {
      headcount: payroll.headcount,
      salaryPerPersonToman: payroll.salaryPerPersonToman,
      salaryPerPersonIrr: payroll.salaryPerPersonIrr,
      totalToman: payroll.amountToman,
      totalIrr: payroll.amountIrr,
    },
    {
      headcount: 10,
      salaryPerPersonToman: 45_000_000,
      salaryPerPersonIrr: 450_000_000,
      totalToman: 450_000_000,
      totalIrr: 4_500_000_000,
    },
  );
  assert.deepEqual(
    { toman: utilities.amountToman, irr: utilities.amountIrr },
    { toman: 30_000_000, irr: 300_000_000 },
  );

  for (const assumption of scenario.assumptions) {
    assert.equal(assumption.amountIrr, assumption.amountToman * TOMAN_TO_IRR);
  }
});

test('planning defaults carry category, monthly period, deadline and non-actual status', () => {
  const scenario = createBreakEvenPlanningDefaults();

  assert.equal(scenario.status, PLANNING_ASSUMPTION_STATUS);
  assert.equal(scenario.source, PLANNING_ASSUMPTION_SOURCE);
  assert.equal(scenario.isSampleData, false);
  assert.equal(scenario.actualsPolicy, 'exclude_from_actual_expenses_and_ledger');
  assert.deepEqual(
    scenario.costCategories.map((category) => category.code),
    ['rent', 'payroll', 'utilities'],
  );
  assert.deepEqual(scenario.period, {
    unit: 'month',
    interval: 1,
    basis: 'calendar_month',
    label: 'برنامه‌ریزی ماهانه',
    editable: true,
  });
  assert.equal(scenario.deadline.status, DEADLINE_NEEDS_INPUT_STATUS);
  assert.equal(scenario.deadline.targetDate, null);
  assert.equal(scenario.deadline.editable, true);

  for (const assumption of scenario.assumptions) {
    assert.equal(assumption.status, PLANNING_ASSUMPTION_STATUS);
    assert.equal(assumption.source, PLANNING_ASSUMPTION_SOURCE);
    assert.equal(assumption.isSampleData, false);
    assert.equal(assumption.actualRecord, false);
    assert.equal(assumption.writePolicy, 'non_destructive');
    assert.equal(assumption.editable, true);
  }
});

test('the scenario is editable, non-destructive and can receive an explicit deadline', () => {
  const first = createBreakEvenPlanningDefaults({ branchId: 7, deadlineDate: '2026-12-29' });
  const second = createBreakEvenPlanningDefaults();

  first.assumptions[0].amountIrr = 1;
  first.deadline.targetDate = '2027-01-01';

  assert.equal(first.branchId, 7);
  assert.equal(first.deadline.status, DEADLINE_CONFIGURED_STATUS);
  assert.equal(second.assumptions[0].amountIrr, 8_000_000_000);
  assert.equal(second.deadline.targetDate, null);

  const summary = getMonthlyPlanningCostSummary(second);
  assert.deepEqual(summary, {
    period: 'monthly',
    assumptionCount: 3,
    totalAmountIrr: 12_800_000_000,
    totalAmountToman: 1_280_000_000,
    status: PLANNING_ASSUMPTION_STATUS,
    isDerived: true,
  });

  second.assumptions.push({
    id: 'actual-rent-record',
    amountIrr: 99_999_999,
    actualRecord: true,
    status: 'posted',
    period: { unit: 'month', interval: 1 },
  });
  assert.equal(getMonthlyPlanningCostSummary(second).totalAmountIrr, 12_800_000_000);
});

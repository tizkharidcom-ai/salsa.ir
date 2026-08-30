'use strict';

/**
 * Editable, non-destructive defaults for a break-even planning scenario.
 *
 * Monetary values are always stored as integer IRR.  The matching Toman value
 * is kept beside it only to preserve the original user-entered assumption.
 * This module deliberately creates no expense, journal, inventory, or recipe
 * record; consumers must explicitly decide how and whether to persist edits.
 */

const TOMAN_TO_IRR = 10;
const PLANNING_ASSUMPTION_STATUS = 'planning_assumption';
const PLANNING_ASSUMPTION_LABEL = 'فرض برنامه‌ریزی';
const PLANNING_ASSUMPTION_SOURCE = 'user_provided_baseline';
const PLANNING_ASSUMPTION_SOURCE_LABEL = 'مبنای واردشده برای برنامه‌ریزی';
const DEADLINE_NEEDS_INPUT_STATUS = 'needs_input';
const DEADLINE_CONFIGURED_STATUS = 'configured';

function tomanToIrr(amountToman) {
  return Number(amountToman) * TOMAN_TO_IRR;
}

function monthlyAssumption({
  id,
  name,
  categoryId,
  categoryCode,
  categoryName,
  amountToman,
  details = {},
}) {
  return {
    id,
    name,
    categoryId,
    categoryCode,
    categoryName,
    amountToman,
    amountIrr: tomanToIrr(amountToman),
    period: {
      unit: 'month',
      interval: 1,
      label: 'ماهانه',
    },
    status: PLANNING_ASSUMPTION_STATUS,
    statusLabel: PLANNING_ASSUMPTION_LABEL,
    source: PLANNING_ASSUMPTION_SOURCE,
    sourceLabel: PLANNING_ASSUMPTION_SOURCE_LABEL,
    isSampleData: false,
    editable: true,
    actualRecord: false,
    writePolicy: 'non_destructive',
    ...details,
  };
}

/**
 * Returns a new scenario on every call, so editing it never changes another
 * planning scenario or existing actual financial data.
 *
 * @param {object} [options]
 * @param {string|number|null} [options.branchId=null] branch scope selected by the caller.
 * @param {string} [options.scenarioId='break-even-planning-default-v1'] editable scenario id.
 * @param {string|null} [options.deadlineDate=null] target date supplied by the user (YYYY-MM-DD).
 * @returns {object} editable break-even planning scenario.
 */
function createBreakEvenPlanningDefaults({
  branchId = null,
  scenarioId = 'break-even-planning-default-v1',
  deadlineDate = null,
} = {}) {
  const hasDeadline = typeof deadlineDate === 'string' && deadlineDate.trim().length > 0;
  const costCategories = [
    {
      id: 'facility-rent',
      code: 'rent',
      name: 'اجاره محل',
      classification: 'fixed_operating_cost',
      editable: true,
    },
    {
      id: 'payroll',
      code: 'payroll',
      name: 'هزینه نیرو',
      classification: 'fixed_operating_cost',
      editable: true,
    },
    {
      id: 'utilities',
      code: 'utilities',
      name: 'اشتراک آب، برق و گاز',
      classification: 'recurring_operating_cost',
      editable: true,
    },
  ];

  const assumptions = [
    monthlyAssumption({
      id: 'planning-rent-monthly',
      name: 'اجاره ماهانه مغازه',
      categoryId: 'facility-rent',
      categoryCode: 'rent',
      categoryName: 'اجاره محل',
      amountToman: 800_000_000,
    }),
    monthlyAssumption({
      id: 'planning-payroll-monthly',
      name: 'حقوق ماهانه نیروها',
      categoryId: 'payroll',
      categoryCode: 'payroll',
      categoryName: 'هزینه نیرو',
      amountToman: 10 * 45_000_000,
      details: {
        headcount: 10,
        salaryPerPersonToman: 45_000_000,
        salaryPerPersonIrr: tomanToIrr(45_000_000),
      },
    }),
    monthlyAssumption({
      id: 'planning-utilities-monthly',
      name: 'اشتراک ماهانه آب، برق و گاز',
      categoryId: 'utilities',
      categoryCode: 'utilities',
      categoryName: 'اشتراک آب، برق و گاز',
      amountToman: 30_000_000,
    }),
  ];

  return {
    schemaVersion: 1,
    id: scenarioId,
    entityType: 'break_even_planning_scenario',
    branchId,
    status: PLANNING_ASSUMPTION_STATUS,
    statusLabel: PLANNING_ASSUMPTION_LABEL,
    source: PLANNING_ASSUMPTION_SOURCE,
    sourceLabel: PLANNING_ASSUMPTION_SOURCE_LABEL,
    isSampleData: false,
    editable: true,
    writePolicy: 'non_destructive',
    actualsPolicy: 'exclude_from_actual_expenses_and_ledger',
    period: {
      unit: 'month',
      interval: 1,
      basis: 'calendar_month',
      label: 'برنامه‌ریزی ماهانه',
      editable: true,
    },
    deadline: {
      targetDate: hasDeadline ? deadlineDate.trim() : null,
      status: hasDeadline ? DEADLINE_CONFIGURED_STATUS : DEADLINE_NEEDS_INPUT_STATUS,
      targetMetric: 'monthly_operating_profit_irr',
      comparison: 'gte',
      targetAmountIrr: 0,
      label: 'ددلاین رسیدن به سوددهی',
      editable: true,
    },
    costCategories,
    assumptions,
  };
}

/**
 * Produces a derived monthly fixed-cost total for a planning scenario without
 * changing the scenario.  Actual expense records are intentionally ignored.
 */
function getMonthlyPlanningCostSummary(scenario) {
  const assumptions = Array.isArray(scenario?.assumptions) ? scenario.assumptions : [];
  const planningAssumptions = assumptions.filter((item) => (
    item
    && item.status === PLANNING_ASSUMPTION_STATUS
    && item.actualRecord === false
    && item.period?.unit === 'month'
    && Number(item.period?.interval) === 1
  ));
  const totalIrr = planningAssumptions.reduce((sum, item) => sum + Number(item.amountIrr || 0), 0);

  return {
    period: 'monthly',
    assumptionCount: planningAssumptions.length,
    totalAmountIrr: totalIrr,
    totalAmountToman: totalIrr / TOMAN_TO_IRR,
    status: PLANNING_ASSUMPTION_STATUS,
    isDerived: true,
  };
}

module.exports = {
  TOMAN_TO_IRR,
  PLANNING_ASSUMPTION_STATUS,
  PLANNING_ASSUMPTION_LABEL,
  PLANNING_ASSUMPTION_SOURCE,
  PLANNING_ASSUMPTION_SOURCE_LABEL,
  DEADLINE_NEEDS_INPUT_STATUS,
  DEADLINE_CONFIGURED_STATUS,
  tomanToIrr,
  createBreakEvenPlanningDefaults,
  getMonthlyPlanningCostSummary,
};

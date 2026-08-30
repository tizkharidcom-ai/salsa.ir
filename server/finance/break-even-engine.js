'use strict';

/**
 * Break-even projection primitives.
 *
 * The engine has no storage or HTTP dependency.  Finance V2 supplies the
 * posted-ledger or recipe-cost daily rows, while this module allocates the
 * editable monthly planning costs across calendar days and produces a
 * transparent actual/forecast series.  Planning costs are never treated as
 * journal entries by this module.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PROJECTION_DAYS = 731;

function issue(message, code) {
  return Object.assign(new Error(message), { code, status: 400 });
}

function integer(value, code, { min = 0 } = {}) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < min) throw issue('مبلغ یا تعداد باید عدد صحیح و معتبر باشد.', code);
  return amount;
}

function dateKey(value, code = 'break_even_date_invalid') {
  const raw = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw issue('تاریخ برنامهٔ سودآوری معتبر نیست.', code);
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(raw.slice(0, 4))
    || parsed.getUTCMonth() + 1 !== Number(raw.slice(5, 7))
    || parsed.getUTCDate() !== Number(raw.slice(8, 10))
  ) throw issue('تاریخ برنامهٔ سودآوری معتبر نیست.', code);
  return raw;
}

function compareDateKeys(left, right) {
  return String(left).localeCompare(String(right));
}

function addDays(key, days) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const left = new Date(`${from}T12:00:00.000Z`);
  const right = new Date(`${to}T12:00:00.000Z`);
  return Math.round((right.getTime() - left.getTime()) / DAY_MS);
}

function dateRange(startDate, endDate) {
  const days = daysBetween(startDate, endDate);
  if (days < 0) throw issue('تاریخ شروع باید قبل از ددلاین یا هم‌زمان با آن باشد.', 'break_even_period_invalid');
  if (days + 1 > MAX_PROJECTION_DAYS) throw issue('بازهٔ نمودار حداکثر دو سال می‌تواند باشد.', 'break_even_period_too_long');
  return Array.from({ length: days + 1 }, (_, index) => addDays(startDate, index));
}

function monthInfo(key) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return {
    year,
    month,
    day: Number(key.slice(8, 10)),
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

function normalizeFixedCostLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw issue('حداقل یک هزینهٔ ثابت برنامه‌ای لازم است.', 'break_even_fixed_costs_missing');
  const normalized = lines.map((line, index) => {
    const monthlyAmountIrr = integer(line?.monthlyAmountIrr ?? line?.amountIrr, 'break_even_fixed_cost_invalid');
    return {
      id: String(line?.id || `fixed-${index + 1}`).slice(0, 120),
      name: String(line?.name || line?.label || `هزینهٔ ثابت ${index + 1}`).trim().slice(0, 160) || `هزینهٔ ثابت ${index + 1}`,
      monthlyAmountIrr,
      category: String(line?.category || line?.categoryCode || '').trim().slice(0, 80) || null,
    };
  });
  if (!normalized.some((line) => line.monthlyAmountIrr > 0)) throw issue('جمع هزینهٔ ثابت برنامه باید بزرگ‌تر از صفر باشد.', 'break_even_fixed_costs_zero');
  return normalized;
}

function fixedCostSchedule(lines, dates) {
  return dates.map((date) => {
    const month = monthInfo(date);
    const fixedCostIrr = lines.reduce((total, line) => {
      const base = Math.floor(line.monthlyAmountIrr / month.daysInMonth);
      const remainder = line.monthlyAmountIrr % month.daysInMonth;
      return total + base + (month.day <= remainder ? 1 : 0);
    }, 0);
    return { date, fixedCostIrr };
  });
}

function aggregateActualRows(rows, { startDate, asOfDate }) {
  const byDate = new Map();
  let sourceRowCount = 0;
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const date = dateKey(row?.date ?? row?.day ?? row?.occurredAt ?? row?.capturedAt, `break_even_daily_date_invalid_${index + 1}`);
    const salesIrr = integer(row?.salesIrr ?? row?.revenueIrr ?? row?.netSalesIrr, 'break_even_daily_sales_invalid');
    const variableCostIrr = integer(row?.variableCostIrr ?? row?.costIrr ?? row?.theoreticalCogsIrr, 'break_even_daily_variable_cost_invalid');
    if (compareDateKeys(date, startDate) < 0 || compareDateKeys(date, asOfDate) > 0) continue;
    const current = byDate.get(date) || { salesIrr: 0, variableCostIrr: 0, rows: 0 };
    current.salesIrr += salesIrr;
    current.variableCostIrr += variableCostIrr;
    current.rows += 1;
    byDate.set(date, current);
    sourceRowCount += 1;
  }
  return { byDate, sourceRowCount };
}

function missingProjection({ fixedCostTotalIrr, period, source, reason, missing, actual = {} }) {
  return {
    status: 'insufficient_data',
    reason,
    missing,
    source,
    period,
    fixedCostTotalIrr,
    totalFixedCostsIrr: fixedCostTotalIrr,
    actual: {
      netSalesIrr: actual.netSalesIrr || 0,
      variableCostIrr: actual.variableCostIrr || 0,
      contributionIrr: actual.contributionIrr || 0,
      transactionDays: actual.transactionDays || 0,
      sourceRowCount: actual.sourceRowCount || 0,
    },
    breakEvenSalesIrr: null,
    realizedNetSalesIrr: actual.netSalesIrr || 0,
    gapIrr: null,
    requiredDailySalesIrr: null,
    contributionMarginRatio: null,
    series: [],
    forecast: null,
  };
}

/**
 * Builds an actual + forecast break-even series.
 *
 * `actualDaily` must contain daily rows from one internally-consistent
 * authority (posted ledger or recipe-cost snapshots).  Do not mix revenue
 * from one source with cost from another: source selection belongs to the
 * Finance V2 adapter.
 */
function buildBreakEvenProjection({
  startDate,
  deadlineDate,
  asOfDate,
  fixedCostLines,
  actualDaily = [],
  source = { type: 'unknown', label: 'منبع نامشخص' },
} = {}) {
  const start = dateKey(startDate, 'break_even_start_date_invalid');
  const deadline = dateKey(deadlineDate, 'break_even_deadline_invalid');
  const dates = dateRange(start, deadline);
  const asOfRaw = dateKey(asOfDate || new Date().toISOString().slice(0, 10), 'break_even_as_of_date_invalid');
  const effectiveAsOf = compareDateKeys(asOfRaw, start) < 0 ? addDays(start, -1) : (compareDateKeys(asOfRaw, deadline) > 0 ? deadline : asOfRaw);
  const actualDates = compareDateKeys(effectiveAsOf, start) < 0 ? [] : dates.filter((date) => compareDateKeys(date, effectiveAsOf) <= 0);
  const remainingOpenDays = Math.max(0, dates.length - actualDates.length);
  const lines = normalizeFixedCostLines(fixedCostLines);
  const fixedSchedule = fixedCostSchedule(lines, dates);
  const fixedByDate = new Map(fixedSchedule.map((row) => [row.date, row.fixedCostIrr]));
  const fixedCostTotalIrr = fixedSchedule.reduce((total, row) => total + row.fixedCostIrr, 0);
  const fixedCostToDateIrr = actualDates.reduce((total, date) => total + (fixedByDate.get(date) || 0), 0);
  const period = {
    startDate: start,
    deadlineDate: deadline,
    asOfDate: asOfRaw,
    effectiveAsOfDate: actualDates.length ? effectiveAsOf : null,
    calendarDays: dates.length,
    elapsedCalendarDays: actualDates.length,
    remainingOpenDays,
  };
  const actualRows = aggregateActualRows(actualDaily, { startDate: start, asOfDate: effectiveAsOf });
  const actual = actualDates.reduce((totals, date) => {
    const row = actualRows.byDate.get(date);
    totals.netSalesIrr += row?.salesIrr || 0;
    totals.variableCostIrr += row?.variableCostIrr || 0;
    if ((row?.salesIrr || 0) > 0) totals.transactionDays += 1;
    return totals;
  }, { netSalesIrr: 0, variableCostIrr: 0, transactionDays: 0, sourceRowCount: actualRows.sourceRowCount });
  actual.contributionIrr = actual.netSalesIrr - actual.variableCostIrr;

  const missing = [];
  if (actual.netSalesIrr <= 0) missing.push('net_sales');
  // In a restaurant a zero variable cost is normally missing COGS coverage,
  // not a 100% margin.  Refuse to fabricate an optimistic projection.
  if (actual.variableCostIrr <= 0) missing.push('variable_cost');
  if (actual.contributionIrr <= 0) missing.push('positive_contribution');
  if (missing.length) {
    return missingProjection({
      fixedCostTotalIrr,
      period,
      source,
      reason: missing.includes('positive_contribution') ? 'positive_contribution_required' : 'actual_contribution_data_missing',
      missing,
      actual,
    });
  }

  const contributionMarginRatio = actual.contributionIrr / actual.netSalesIrr;
  const variableCostRatio = actual.variableCostIrr / actual.netSalesIrr;
  const breakEvenSalesIrr = Math.ceil(fixedCostTotalIrr / contributionMarginRatio);
  const gapIrr = Math.max(0, breakEvenSalesIrr - actual.netSalesIrr);
  const requiredDailySalesIrr = remainingOpenDays > 0 ? Math.ceil(gapIrr / remainingOpenDays) : null;
  const forecastDailySalesIrr = Math.round(actual.netSalesIrr / Math.max(1, actualDates.length));

  let cumulativeSalesIrr = 0;
  let cumulativeVariableCostIrr = 0;
  let accruedFixedCostIrr = 0;
  const series = [{
    day: 0,
    date: addDays(start, -1),
    salesIrr: 0,
    variableCostIrr: 0,
    fixedCostIrr: 0,
    totalCostIrr: 0,
    cumulativeSalesIrr: 0,
    cumulativeVariableCostIrr: 0,
    // The whole fixed-cost budget is held against sales from the start of the
    // deadline window.  Allocating it only day by day can falsely show an
    // early profit before rent and payroll for the period are actually covered.
    cumulativeFixedCostIrr: fixedCostTotalIrr,
    accruedFixedCostIrr: 0,
    cumulativeCostIrr: fixedCostTotalIrr,
    cumulativeProfitIrr: -fixedCostTotalIrr,
    isActual: false,
    isForecast: false,
  }];

  for (const [index, date] of dates.entries()) {
    const isActual = actualDates.includes(date);
    const recorded = actualRows.byDate.get(date);
    const salesIrr = isActual ? (recorded?.salesIrr || 0) : forecastDailySalesIrr;
    const variableCostIrr = isActual
      ? (recorded?.variableCostIrr || 0)
      : Math.round(forecastDailySalesIrr * variableCostRatio);
    const fixedCostIrr = fixedByDate.get(date) || 0;
    cumulativeSalesIrr += salesIrr;
    cumulativeVariableCostIrr += variableCostIrr;
    accruedFixedCostIrr += fixedCostIrr;
    const cumulativeCostIrr = cumulativeVariableCostIrr + fixedCostTotalIrr;
    series.push({
      day: index + 1,
      date,
      salesIrr,
      variableCostIrr,
      fixedCostIrr,
      totalCostIrr: variableCostIrr + fixedCostIrr,
      cumulativeSalesIrr,
      cumulativeVariableCostIrr,
      cumulativeFixedCostIrr: fixedCostTotalIrr,
      accruedFixedCostIrr,
      cumulativeCostIrr,
      cumulativeProfitIrr: cumulativeSalesIrr - cumulativeCostIrr,
      isActual,
      isForecast: !isActual,
    });
  }

  const firstBreakEven = series.slice(1).find((row) => row.cumulativeProfitIrr >= 0 && row.cumulativeSalesIrr > 0) || null;
  const actualBreakEven = series.slice(1).find((row) => row.isActual && row.cumulativeProfitIrr >= 0 && row.cumulativeSalesIrr > 0) || null;
  const finalRow = series.at(-1);
  const deadlineIsPast = compareDateKeys(asOfRaw, deadline) >= 0;
  const deadlineStatus = deadlineIsPast
    ? finalRow.cumulativeProfitIrr >= 0 ? 'achieved' : 'missed'
    : finalRow.cumulativeProfitIrr >= 0 ? 'on_track' : 'at_risk';

  return {
    status: 'available',
    source,
    period,
    fixedCostLines: lines,
    fixedCostTotalIrr,
    totalFixedCostsIrr: fixedCostTotalIrr,
    fixedCostToDateIrr,
    actual,
    netSalesIrr: actual.netSalesIrr,
    realizedNetSalesIrr: actual.netSalesIrr,
    variableCostIrr: actual.variableCostIrr,
    contributionIrr: actual.contributionIrr,
    contributionMarginRatio,
    variableCostRatio,
    breakEvenSalesIrr,
    gapIrr,
    remainingOpenDays,
    requiredDailySalesIrr,
    forecast: {
      dailySalesIrr: forecastDailySalesIrr,
      dailyVariableCostIrr: Math.round(forecastDailySalesIrr * variableCostRatio),
      deadlineSalesIrr: finalRow.cumulativeSalesIrr,
      deadlineCostIrr: finalRow.cumulativeCostIrr,
      deadlineNetProfitIrr: finalRow.cumulativeProfitIrr,
      breakEvenDate: firstBreakEven?.date || null,
      breakEvenDay: firstBreakEven?.day ?? null,
      actualBreakEvenDate: actualBreakEven?.date || null,
      deadlineStatus,
    },
    series,
  };
}

module.exports = {
  MAX_PROJECTION_DAYS,
  addDays,
  buildBreakEvenProjection,
  dateKey,
  dateRange,
  daysBetween,
  fixedCostSchedule,
  normalizeFixedCostLines,
};

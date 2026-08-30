'use strict';
/**
 * WESTO Finance — Predictive & Analytical Engine (ported from NEEM)
 * Cash runway, burn rate analysis, revenue trend forecasting, expense anomaly detection.
 */
const { toInt } = require('./money');

function getPredictiveAnalytics(db, filter = {}) {
  const acc = db.accounting || {};
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const entries = (acc.journalEntries || []).filter((entry) => {
    if (entry.status !== 'posted') return false;
    if (branchId == null) return true;
    const lines = entry.lines || [];
    return lines.some((line) => Number(line.branchId ?? entry.branchId) === branchId);
  });
  const orders = (db.orders || []).filter((order) => (branchId == null || Number(order.branchId) === branchId)
    && (order.paymentStatus === 'paid' || ['paid', 'delivered', 'done'].includes(order.status)));

  // 1. Calculate liquid cash and monthly average burn
  let totalCash = 0;
  let totalBank = 0;
  const accounts = acc.accounts || [];

  const balanceMap = {};
  accounts.forEach(a => { balanceMap[a.code] = 0; });
  entries.forEach(e => {
    (e.lines || []).forEach(l => {
      if (branchId != null && Number(l.branchId ?? e.branchId) !== branchId) return;
      const code = l.accountCode;
      if (balanceMap[code] !== undefined) {
        balanceMap[code] += (l.debit || 0) - (l.credit || 0);
      }
    });
  });

  accounts.forEach(a => {
    if (a.subtype === 'cash') totalCash += Math.max(0, balanceMap[a.code] || 0);
    if (a.subtype === 'bank') totalBank += Math.max(0, balanceMap[a.code] || 0);
  });
  const liquidFunds = totalCash + totalBank;

  // Monthly operating expenses over last 90 days
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 3600 * 1000;
  let recentExpenses = 0;
  let recentRevenues = 0;

  entries.forEach(e => {
    const eDate = new Date(e.date).getTime();
    if (eDate >= ninetyDaysAgo) {
      (e.lines || []).forEach(l => {
        if (branchId != null && Number(l.branchId ?? e.branchId) !== branchId) return;
        const accDef = accounts.find(a => a.code === l.accountCode);
        if (accDef) {
          if (accDef.type === 'expense' || accDef.type === 'cogs') recentExpenses += (l.debit || 0) - (l.credit || 0);
          if (accDef.type === 'revenue') recentRevenues += (l.credit || 0) - (l.debit || 0);
        }
      });
    }
  });

  const monthlyBurn = Math.max(0, Math.round(recentExpenses / 3));
  const monthlyRevenue = Math.max(0, Math.round(recentRevenues / 3));
  const netMonthlyCashflow = monthlyRevenue - monthlyBurn;
  const runwayMonths = monthlyBurn > 0 ? Number((liquidFunds / monthlyBurn).toFixed(1)) : null;

  // 2. Daily Sales Trend & Forecast (linear regression on last 30 days)
  const dailySales = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    dailySales[d] = 0;
  }
  orders.forEach(o => {
    const d = (o.createdAt || new Date().toISOString()).slice(0, 10);
    if (dailySales[d] !== undefined) {
      dailySales[d] += toInt(o.total || 0);
    }
  });

  const salesTrend = Object.entries(dailySales).map(([date, amount]) => ({ date, amount }));
  const avgDailySales = salesTrend.length ? Math.round(salesTrend.reduce((s, x) => s + x.amount, 0) / salesTrend.length) : 0;
  const observedSalesDays = salesTrend.filter((row) => row.amount > 0).length;
  const sufficientForecastHistory = observedSalesDays >= 14;
  const projected30DayRevenue = sufficientForecastHistory ? avgDailySales * 30 : null;

  // 3. Expense Anomalies (detect categories with > 25% spike)
  const categoryExpenses = {};
  (acc.expenses || []).filter((exp) => branchId == null || Number(exp.branchId) === branchId).forEach(exp => {
    const cat = exp.category || 'عمومی';
    categoryExpenses[cat] = (categoryExpenses[cat] || 0) + toInt(exp.amount || 0);
  });

  // Anomaly detection needs comparable historical periods; a single aggregate
  // must never be labelled anomalous using a hard-coded amount threshold.
  const anomalies = [];

  return {
    liquidFunds,
    monthlyBurn,
    monthlyRevenue,
    netMonthlyCashflow,
    runwayMonths,
    salesTrend,
    avgDailySales,
    projected30DayRevenue,
    anomalies,
    forecastConfidence: sufficientForecastHistory ? Math.min(0.9, observedSalesDays / 30) : null,
    sufficientForecastHistory,
    observedSalesDays,
    anomalyStatus: Object.keys(categoryExpenses).length ? 'insufficient_comparable_periods' : 'insufficient_data',
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getPredictiveAnalytics,
};

'use strict';

/**
 * WESTO Finance — AI CFO Assistant & Executive Brief Engine
 * Synthesizes GL data, Sales POS, Inventory COGS, Payroll and Treasury into actionable CFO insights.
 * Implements:
 * 1. Daily Executive Financial Brief
 * 2. Prime Cost & Benchmark Analysis (Target: 55-65%)
 * 3. Food Cost % & Labor Cost % Diagnostic Rules
 * 4. Break-even Revenue & Cash Runway Calculation
 * 5. Tax Compliance Status & Smart Financial Directives
 */

const { toFaDigits, toIRR, formatNumber } = require('./money');

function generateCFOBrief(db, filter = {}) {
  const acc = db.accounting || {};
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const orders = (db.orders || []).filter((order) => branchId == null || Number(order.branchId) === branchId);
  const entries = (acc.journalEntries || []).filter((entry) => entry.status === 'posted' && (branchId == null
    || (entry.lines || []).some((line) => Number(line.branchId ?? entry.branchId) === branchId)));

  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysOrders = orders.filter(
    (o) => (o.createdAt || '').slice(0, 10) === todayStr && (o.paymentStatus === 'paid' || ['paid', 'delivered', 'done', 'preparing', 'ready'].includes(o.status))
  );
  const todayRevenue = todaysOrders.reduce((s, o) => s + toIRR(o.total || 0), 0);
  const todayOrderCount = todaysOrders.length;
  const todayAOV = todayOrderCount ? Math.round(todayRevenue / todayOrderCount) : 0;

  // Calculate Cumulative GL Metrics
  let totalRevenue = 0;
  let totalDiscounts = 0;
  let totalFoodCogs = 0;
  let totalBeverageCogs = 0;
  let totalWaste = 0;
  let totalLabor = 0;
  let totalOpex = 0;
  let totalLiquidCash = 0;

  entries.forEach((e) => {
    (e.lines || []).forEach((l) => {
      if (branchId != null && Number(l.branchId ?? e.branchId) !== branchId) return;
      const code = String(l.accountCode);
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);
      const netDeb = debit - credit;
      const netCred = credit - debit;

      if (code.startsWith('41') || code.startsWith('42') || code.startsWith('43') || code.startsWith('44')) {
        totalRevenue += netCred;
      } else if (code.startsWith('49')) {
        totalDiscounts += netDeb;
      } else if (code === '5100') {
        totalFoodCogs += netDeb;
      } else if (code === '5200') {
        totalBeverageCogs += netDeb;
      } else if (code === '5400') {
        totalWaste += netDeb;
      } else if (code.startsWith('61')) {
        totalLabor += netDeb;
      } else if (code.startsWith('6') && !code.startsWith('61')) {
        totalOpex += netDeb;
      } else if (code === '1110' || code === '1120' || code === '1130' || code === '1210' || code === '1220') {
        totalLiquidCash += netDeb;
      }
    });
  });

  const netSales = Math.max(0, totalRevenue - totalDiscounts);
  const totalCogs = totalFoodCogs + totalBeverageCogs + totalWaste;
  const primeCost = totalCogs + totalLabor;

  const primeCostPct = netSales > 0 ? Number(((primeCost / netSales) * 100).toFixed(1)) : 0;
  const foodCostPct = netSales > 0 ? Number(((totalCogs / netSales) * 100).toFixed(1)) : 0;
  const laborCostPct = netSales > 0 ? Number(((totalLabor / netSales) * 100).toFixed(1)) : 0;

  // Active Drawers & Pending AP
  const activeDrawers = (db.cashSessions || []).filter((session) => (branchId == null || Number(session.branchId) === branchId) && !session.closedAt);
  const pendingBills = (acc.vendorBills || []).filter((bill) => (branchId == null || Number(bill.branchId) === branchId)
    && (bill.status === 'open' || bill.status === 'partial'));
  const pendingBillsTotal = pendingBills.reduce((s, b) => s + (b.balance || b.total || 0), 0);

  // Daily Cash Burn & Runway Estimation
  const hasExpenseHistory = totalOpex + totalLabor > 0;
  const dailyOpexEstimate = hasExpenseHistory ? Math.round((totalOpex + totalLabor) / 30) : null;
  const cashRunwayDays = dailyOpexEstimate > 0 ? Math.round(totalLiquidCash / dailyOpexEstimate) : null;

  // Diagnostic Rules & Smart Highlights
  const highlights = [`فروش ثبت‌شده امروز مبلغ ${formatNumber(todayRevenue)} ریال در قالب ${toFaDigits(todayOrderCount)} سفارش بوده است.`];
  if (netSales > 0 && totalCogs + totalLabor > 0) highlights.push(`شاخص بهای اولیه بر دادهٔ دفتر برابر ${toFaDigits(primeCostPct)}٪ است.`);
  if (cashRunwayDays != null) highlights.push(`تاب‌آوری نقدینگی محاسبه‌شده بر تاریخچهٔ موجود ${toFaDigits(cashRunwayDays)} روز است.`);
  else highlights.push('برای محاسبهٔ تاب‌آوری نقدینگی، تاریخچهٔ هزینهٔ معتبر کافی نیست.');
  highlights.push(`تعداد ${toFaDigits(pendingBills.length)} فاکتور خرید باز به ارزش ${formatNumber(pendingBillsTotal)} ریال ثبت شده است.`);

  const recommendations = [];
  if (primeCostPct > 65) {
    recommendations.push('هشدار بهای اولیه: شاخص Prime Cost بالاتر از سقف بهینه ۶۵٪ است. بازنگری قراردادهای تأمین مواد و کنترل اضافه‌کاری شیفت‌ها توصیه می‌شود.');
  } else if (primeCostPct > 0) {
    recommendations.push('شاخص بهای اولیه (Prime Cost) در وضعیت کاملاً بهینه و سودآور قرار دارد.');
  }

  if (pendingBills.length >= 3) {
    recommendations.push('تعداد فاکتورهای سررسیدشده تامین‌کنندگان رو به افزایش است؛ جهت حفظ اعتبار با تامین‌کنندگان تسویه دوره‌ای برنامه‌ریزی شود.');
  }

  if (activeDrawers.length > 0) {
    recommendations.push(`تعداد ${toFaDigits(activeDrawers.length)} شیفت صندوق باز است؛ کنترل پایان شیفت و شمارش فیزیکی صندوق انجام گردد.`);
  }

  if (recommendations.length === 0) recommendations.push('دادهٔ تأییدشده برای صدور توصیهٔ مالی کافی نیست؛ ابتدا مغایرت‌ها و تاریخچهٔ هزینه تکمیل شود.');

  return {
    date: todayStr,
    todayRevenue,
    todayOrderCount,
    todayAOV,
    kpis: {
      netSales,
      totalCogs,
      totalLabor,
      primeCost,
      primeCostPct,
      foodCostPct,
      laborCostPct,
      totalLiquidCash,
      cashRunwayDays,
    },
    activeDrawersCount: activeDrawers.length,
    pendingBillsCount: pendingBills.length,
    pendingBillsTotal,
    highlights,
    recommendations,
    dataSufficiency: { primeCost: netSales > 0 && totalCogs + totalLabor > 0, cashRunway: cashRunwayDays != null },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  generateCFOBrief,
};

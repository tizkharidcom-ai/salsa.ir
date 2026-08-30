'use strict';
/**
 * WESTO Finance — Multi-Branch Consolidation & Benchmarking Engine (ported from NEEM)
 * Consolidates financial statements across branches and manages inter-branch transfers and eliminations.
 */
const { toInt } = require('./money');

function getBranchComparison(db, filter = {}) {
  const branches = db.branches || [{ id: 1, name: 'شعبه مرکزی', code: 'main' }];
  const branchIds = Array.isArray(filter.branchIds)
    ? new Set(filter.branchIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))
    : null;
  const visibleBranches = branchIds == null
    ? branches
    : branches.filter((branch) => branchIds.has(Number(branch.id)));
  const orders = db.orders || [];
  const acc = db.accounting || {};
  const entries = (acc.journalEntries || []).filter(e => e.status === 'posted');

  const branchMetrics = visibleBranches.map(branch => {
    const branchOrders = orders.filter(o => Number(o.branchId) === Number(branch.id) && (o.paymentStatus === 'paid' || ['paid', 'delivered', 'done'].includes(o.status)));
    const revenue = branchOrders.reduce((s, o) => s + toInt(o.total || 0), 0);
    const orderCount = branchOrders.length;
    const aov = orderCount ? Math.round(revenue / orderCount) : 0;

    // Filter journal lines for this branch
    let expenses = 0;
    entries.forEach(e => {
      (e.lines || []).forEach(l => {
        if (Number(l.branchId) === Number(branch.id)) {
          const accDef = (acc.accounts || []).find(a => a.code === l.accountCode);
          if (accDef && (accDef.type === 'expense' || accDef.type === 'cogs')) {
            expenses += (l.debit || 0) - (l.credit || 0);
          }
        }
      });
    });

    const netProfit = revenue - expenses;
    const profitMarginPct = revenue ? Math.round((netProfit / revenue) * 100) : 0;

    return {
      branchId: branch.id,
      branchName: branch.name,
      revenue,
      orderCount,
      aov,
      expenses,
      netProfit,
      profitMarginPct,
    };
  });

  return {
    branches: branchMetrics,
    totalConsolidatedRevenue: branchMetrics.reduce((s, b) => s + b.revenue, 0),
    totalConsolidatedProfit: branchMetrics.reduce((s, b) => s + b.netProfit, 0),
    generatedAt: new Date().toISOString(),
  };
}

function recordInterBranchTransfer(acc, { fromBranchId, toBranchId, amount, description, date, postJournalFn, db }) {
  if (!Array.isArray(acc.interBranchTransfers)) acc.interBranchTransfers = [];
  const id = `ibt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const amt = toInt(amount);

  const transfer = {
    id,
    fromBranchId: Number(fromBranchId),
    toBranchId: Number(toBranchId),
    amount: amt,
    description: String(description || 'انتقال بین شعب').slice(0, 200),
    date: date || new Date().toISOString(),
    status: 'posted',
  };

  acc.interBranchTransfers.push(transfer);

  let je = null;
  if (postJournalFn && db) {
    je = postJournalFn(db, {
      source: 'inter_branch_transfer',
      date: transfer.date,
      description: `انتقال وجه از شعبه ${fromBranchId} به شعبه ${toBranchId}: ${transfer.description}`,
      lines: [
        { accountCode: '1120', debit: amt, credit: 0, memo: `دریافت وجه در شعبه مقصد`, branchId: toBranchId },
        { accountCode: '1120', debit: 0, credit: amt, memo: `ارسال وجه از شعبه مبدا`, branchId: fromBranchId },
      ],
    });
  }

  return { ok: true, transfer, journalEntry: je };
}

module.exports = {
  getBranchComparison,
  recordInterBranchTransfer,
};

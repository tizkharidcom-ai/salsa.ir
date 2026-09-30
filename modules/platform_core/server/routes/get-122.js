'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/stats', __westoModuleContext.requireAdmin, (req, res) => {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const weekAgo = now - 7 * dayMs;
  const dayAgo = now - dayMs;
  // Keep owner analytics consolidated by default, while resolving a scoped
  // manager/accountant to an allowed branch when the dashboard omits a filter.
  const requestedBranch = __westoModuleContext.requestBranchValue(req);
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  const bid = requestedBranch != null
    ? __westoModuleContext.parseBranchId(req)
    : allowedBranchIds === null
      ? null
      : (__westoModuleContext.defaultBranch() && allowedBranchIds.includes(Number(__westoModuleContext.defaultBranch().id))
        ? __westoModuleContext.defaultBranch().id
        : allowedBranchIds[0] || null);
  let orders = __westoModuleContext.db.orders || [];
  if (bid) orders = orders.filter((o) => Number(o.branchId) === bid);
  // Revenue is an accounting-facing metric. Pending/unpaid/partial orders
  // belong in the operational queue, never in sales totals; retain the
  // status fallback only for legacy rows that predate paymentStatus.
  const paidLike = orders.filter((o) => {
    if (typeof o?.paymentStatus === 'string') return o.paymentStatus === 'paid';
    return __westoModuleContext.FINANCIAL_PAID_ORDER_STATUSES.has(String(o?.status || ''));
  });
  const revenue = paidLike.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenueToday = paidLike
    .filter((o) => new Date(o.createdAt).getTime() >= dayAgo)
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenueWeek = paidLike
    .filter((o) => new Date(o.createdAt).getTime() >= weekAgo)
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const visits = __westoModuleContext.db.visits || [];
  const visitsToday = visits.filter((v) => new Date(v.at).getTime() >= dayAgo).length;
  const visitsWeek = visits.filter((v) => new Date(v.at).getTime() >= weekAgo).length;
  const uniqueSessions = new Set(visits.filter((v) => new Date(v.at).getTime() >= weekAgo).map((v) => v.sessionId)).size;

  // Top selling items
  const itemMap = new Map();
  for (const o of paidLike) {
    for (const line of o.items || []) {
      const cur = itemMap.get(line.menuItemId) || { id: line.menuItemId, name: line.name, qty: 0, revenue: 0 };
      cur.qty += line.qty || 0;
      cur.revenue += line.lineTotal || (line.price || 0) * (line.qty || 0);
      itemMap.set(line.menuItemId, cur);
    }
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);

  // Hourly heatmap (last 7d)
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const o of paidLike.filter((o) => new Date(o.createdAt).getTime() >= weekAgo)) {
    byHour[new Date(o.createdAt).getHours()] += 1;
  }

  const tablesScoped = (__westoModuleContext.db.tables || []).filter((t) => (bid ? Number(t.branchId) === bid : true));
  const v2Inventory = __westoModuleContext.financeV2.inventoryItemsView(__westoModuleContext.db, { branchId: bid }).items;
  const legacyTrackedMenu = (__westoModuleContext.db.menuItems || []).filter((item) => !__westoModuleContext.financeV2.menuItemUsesInventoryV2(__westoModuleContext.db, item.id, bid));

  res.json({
    users: __westoModuleContext.db.users.length,
    newsletter: __westoModuleContext.db.newsletter.length,
    orders: orders.length,
    openOrders: orders.filter((o) => !['done', 'cancelled', 'paid'].includes(o.status)).length,
    menuItems: (__westoModuleContext.db.menuItems || []).length,
    unavailable: (__westoModuleContext.db.menuItems || []).filter((m) => m.available === false).length,
    lowStock: v2Inventory.filter((item) => Number(item.availableQuantity ?? item.qtyOnHand ?? 0) > 0 && Number(item.minStock || 0) > 0 && Number(item.availableQuantity ?? item.qtyOnHand ?? 0) <= Number(item.minStock)).length + legacyTrackedMenu.filter(
      (m) => typeof m.stock === 'number' && m.stock > 0 && m.stock <= (m.lowStockAt ?? 5)
    ).length,
    outOfStock: v2Inventory.filter((item) => Number(item.availableQuantity ?? item.qtyOnHand ?? 0) <= 0).length + legacyTrackedMenu.filter((m) => m.stock === 0).length,
    tables: tablesScoped.filter((t) => t.active !== false).length,
    branchId: bid,
    branches: (__westoModuleContext.db.branches || []).length,
    revenue,
    revenueToday,
    revenueWeek,
    visitsToday,
    visitsWeek,
    uniqueSessions,
    topItems,
    byHour,
    dailySales30d: (() => {
      const dailyMap = new Map();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
        dailyMap.set(d, { date: d, count: 0, sales: 0 });
      }
      for (const o of paidLike) {
        const d = (o.createdAt || '').slice(0, 10);
        if (dailyMap.has(d)) {
          const row = dailyMap.get(d);
          row.count += 1;
          row.sales += Number(o.total || 0);
        }
      }
      return [...dailyMap.values()];
    })(),
    costStructure: (() => {
      const be = __westoModuleContext.financeV2.breakEvenDashboard(__westoModuleContext.db, { branchId: bid || 1 });
      const plan = be.plan || be.suggestedPlan;
      const assumptions = Array.isArray(plan?.assumptions) ? plan.assumptions : [];
      const totalFixedCostsToman = assumptions.reduce((sum, a) => sum + Number(a.amountToman || 0), 0)
        || Number(plan?.monthlyFixedCostIrr ? plan.monthlyFixedCostIrr / 10 : 1_280_000_000);
      
      const accountingExpenses = (__westoModuleContext.db.accounting?.expenses || []).filter((e) => !bid || Number(e.branchId) === bid);
      
      return {
        totalFixedCostsToman,
        totalFixedCostsIrr: totalFixedCostsToman * 10,
        assumptions: assumptions.map((a) => ({
          id: a.id,
          name: a.name || a.categoryName,
          amountToman: Number(a.amountToman || (a.amountIrr ? a.amountIrr / 10 : 0)),
          categoryCode: a.categoryCode,
          headcount: a.headcount,
          salaryPerPersonToman: a.salaryPerPersonToman,
        })),
        actualExpensesCount: accountingExpenses.length,
      };
    })(),
    recentLogins: __westoModuleContext.db.loginLog.slice(0, 10),
    recentOrders: orders.slice(0, 6),
    reservationsToday: (__westoModuleContext.db.reservations || []).filter(
      (r) => r.date === new Date().toISOString().slice(0, 10) && ['pending', 'confirmed', 'seated'].includes(r.status)
        && (!bid || Number(r.branchId) === bid)
    ).length,
    reservationsPending: (__westoModuleContext.db.reservations || []).filter(
      (r) => r.status === 'pending' && (!bid || Number(r.branchId) === bid)
    ).length,
    ...(() => {
      let fb = __westoModuleContext.db.feedback || [];
      if (bid) fb = fb.filter((f) => Number(f.branchId) === bid);
      const week = fb.filter((f) => new Date(f.createdAt).getTime() >= weekAgo);
      const scores = week.map((f) => Number(f.score)).filter((n) => Number.isFinite(n));
      const promoters = scores.filter((s) => s >= 9).length;
      const detractors = scores.filter((s) => s <= 6).length;
      const nps =
        scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) : null;
      return {
        feedbackWeek: week.length,
        npsWeek: nps,
        feedbackPending: fb.filter((f) => f.status === 'new').length,
      };
    })(),
  });
});
};

'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/orders', __westoModuleContext.requireCapability('orders.view'), async (req, res) => {
  const includePii = __westoModuleContext.userCan(req.user, 'pii.view');
  const includePaymentReferences = __westoModuleContext.userCan(req.user, 'payments.manage');
  const orderOptions = {
    includePii,
    includePaymentReferences,
    includeDeliveryReason: __westoModuleContext.userCan(req.user, 'delivery.manage'),
  };
  // Owners see a consolidated queue by default. Scoped operators must never
  // fall back to the owner default branch (or receive every branch) when the
  // UI omits branchId; resolve the same effective scope used by reports.
  const requestedBranch = __westoModuleContext.requestBranchValue(req);
  const allowedBranchIds = __westoModuleContext.branchScopeForUser(req.user, { role: __westoModuleContext.effectiveRole(req.user) });
  const branchId = requestedBranch != null
    ? __westoModuleContext.parseBranchId(req)
    : allowedBranchIds === null
      ? null
      : (__westoModuleContext.defaultBranch() && allowedBranchIds.includes(Number(__westoModuleContext.defaultBranch().id))
        ? __westoModuleContext.defaultBranch().id
        : allowedBranchIds[0] || null);

  if (String(req.query?.history || '') === 'closed') {
    try {
      const cursor = __westoModuleContext.normalizeOrderHistoryCursor(req.query?.cursor);
      const limit = __westoModuleContext.historyPageSize(req.query?.limit);
      const tenantId = __westoModuleContext.tenantStorage.getStore()?.tenantId || __westoModuleContext.TENANT_CONFIG.tenantId || 'westo';
      if (__westoModuleContext.stateStore.enabled && tenantId === 'westo') {
        try {
          const archive = await __westoModuleContext.stateStore.listClosedOrders({ branchId, cursor, limit });
          if (archive.available) {
            const invalidRows = Number(archive.invalidRows) || 0;
            return res.json({
              orders: (archive.orders || []).map((order) => __westoModuleContext.adminOrderDto(order, orderOptions)),
              hasMore: archive.hasMore,
              nextCursor: archive.nextCursor,
              limit: archive.limit,
              complete: false,
              coverage: 'unverified',
              source: 'postgres',
              skippedInvalidRows: invalidRows,
              warning: `آرشیو پایدار سفارش‌ها صفحه‌بندی شده است، اما کامل بودن سوابق پیش از مهاجرت هنوز تأیید نشده است.${invalidRows ? ` ${invalidRows.toLocaleString('fa-IR')} ردیف نامعتبر نیز نمایش داده نشد.` : ''}`,
              serverTime: new Date().toISOString(),
            });
          }
          if (__westoModuleContext.stateStore.required) {
            return res.status(503).json({
              error: 'order_history_store_unavailable',
              message: 'آرشیو پایدار سفارش‌ها در دسترس نیست؛ برای جلوگیری از نمایش تاریخچهٔ ناقص دوباره تلاش کنید.',
            });
          }
        } catch (error) {
          if (error.status === 400) return res.status(400).json({ error: error.code || 'order_history_cursor_invalid', message: 'نشانگر صفحهٔ تاریخچه معتبر نیست.' });
          if (__westoModuleContext.stateStore.required) {
            console.error('[orders] durable history read failed', error);
            return res.status(503).json({ error: 'order_history_store_unavailable', message: 'خواندن آرشیو پایدار سفارش‌ها ممکن نیست؛ دوباره تلاش کنید.' });
          }
          console.warn('[orders] falling back to bounded closed-order cache', error.message);
        }
      }

      const cached = __westoModuleContext.paginateCachedClosedOrders(__westoModuleContext.db.orders || [], { branchId, cursor, limit });
      const warning = tenantId !== 'westo'
        ? 'برای این مجموعه آرشیو پایدار سفارش در این سرویس متصل نیست؛ فقط سابقهٔ موجود در حافظهٔ اخیر نمایش داده می‌شود و کامل نیست.'
        : 'آرشیو پایدار در دسترس نیست؛ فقط سفارش‌های بستهٔ موجود در حافظهٔ اخیر نمایش داده می‌شوند و ممکن است سابقهٔ قدیمی‌تر را شامل نشوند.';
      return res.json({
        ...cached,
        orders: (cached.orders || []).map((order) => __westoModuleContext.adminOrderDto(order, orderOptions)),
        complete: false,
        coverage: 'recent-cache-only',
        source: 'recent-cache',
        warning,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'order_history_invalid', message: 'درخواست تاریخچهٔ سفارش معتبر نیست.' });
    }
  }

  let orders = (__westoModuleContext.db.orders || []).slice();
  if (branchId != null) orders = orders.filter((o) => Number(o.branchId) === Number(branchId));
  const terminal = new Set(['picked_up', 'delivered', 'done', 'cancelled']);
  orders.sort((a, b) => {
    const aClosed = terminal.has(String(a.status));
    const bClosed = terminal.has(String(b.status));
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    const at = new Date(a.createdAt || 0).getTime() || 0;
    const bt = new Date(b.createdAt || 0).getTime() || 0;
    return aClosed ? bt - at : at - bt; // oldest actionable first; newest archived first
  });
  res.json({
    orders: orders.map((order) => __westoModuleContext.operationalOrderResponse(order, req.user)),
    serverTime: new Date().toISOString(),
  });
});
};

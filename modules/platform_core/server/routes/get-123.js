'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/notifications', __westoModuleContext.requireAdmin, (req, res) => {
  const bid = __westoModuleContext.parseBranchId(req) || null;
  const items = [];

  // 1. Finance & Accounting Approvals
  let state = null;
  try {
    state = __westoModuleContext.financeV2.ensureFinanceV2(__westoModuleContext.db);
  } catch (_) {}

  if (state) {
    const approvals = (state.approvals || []).filter(
      (a) => a.status === 'pending' && (!bid || !a.branchId || Number(a.branchId) === bid)
    );
    for (const a of approvals) {
      let title = `درخواست تأیید مالی (${a.operation || a.entityType})`;
      let tab = 'accounting';
      let workspace = 'workbench';
      if (a.entityType === 'purchase_order') {
        title = `تأیید فاکتور خرید شماره ${a.entityId}`;
        workspace = 'purchases';
      } else if (a.entityType === 'vendor_invoice_match') {
        title = `مغایرت فاکتور و رسید بار شماره ${a.entityId}`;
        workspace = 'purchases';
      } else if (a.entityType === 'recipe_version') {
        title = 'تأیید نسخه جدید دستور تهیه';
        tab = 'inventory';
        workspace = 'costing';
      } else if (a.entityType === 'cost_accrual' || a.entityType === 'cost_payment') {
        title = 'تأیید سند هزینه و پرداخت تنخواه';
        workspace = 'purchases';
      } else if (a.entityType === 'supplier_payment') {
        title = 'تأیید پرداخت به تأمین‌کننده';
        workspace = 'purchases';
      } else if (a.operation === 'reopen_fiscal_period') {
        title = 'درخواست بازگشایی دوره مالی';
        workspace = 'reports';
      }

      items.push({
        id: `approval-${a.id}`,
        category: 'approval',
        priority: a.operation === 'reopen_fiscal_period' ? 'urgent' : 'high',
        title,
        description: `درخواست‌شده توسط ${a.requestedBy || 'کاربر سیستم'} • نیاز به تأیید نهایی مدیر`,
        tab,
        workspace,
        actionLabel: 'بررسی و تأیید',
        createdAt: a.createdAt || new Date().toISOString(),
      });
    }

    // 2. Blocked or failed finance events
    const unresolvedEvents = (state.events || []).filter(
      (e) => ['blocked', 'failed'].includes(e.status) && (!bid || !e.branchId || Number(e.branchId) === bid)
    );
    if (unresolvedEvents.length > 0) {
      items.push({
        id: 'blocked-finance-events',
        category: 'attention',
        priority: 'high',
        title: `${unresolvedEvents.length} رویداد مالی مسدود یا متوقف‌شده`,
        description: 'اسناد یا تراکنش‌های مالی دارای خطا نیازمند رفع مسدودی در میزکار مالی هستند.',
        tab: 'accounting',
        workspace: 'workbench',
        actionLabel: 'میزکار مالی',
        createdAt: unresolvedEvents[0]?.occurredAt || new Date().toISOString(),
      });
    }

    // 3. Receivable Purchase Orders
    const pendingPOs = (state.purchaseOrders || []).filter(
      (po) => ['approved', 'partially_received'].includes(po.status) && (!bid || !po.branchId || Number(po.branchId) === bid)
    );
    if (pendingPOs.length > 0) {
      items.push({
        id: 'receivable-pos',
        category: 'attention',
        priority: 'medium',
        title: `${pendingPOs.length} محموله خرید آماده تحویل بار`,
        description: 'کالاهای سفارش‌داده‌شده رسیده به مجموعه نیازمند ثبت رسید بار در بخش انبار هستند.',
        tab: 'inventory',
        workspace: 'purchases',
        actionUrl: `/admin/kitchen?view=inventory${bid ? `&branchId=${bid}` : ''}`,
        actionLabel: 'ثبت رسید بار',
        createdAt: pendingPOs[0]?.createdAt || new Date().toISOString(),
      });
    }

    // 4. Draft Journal Entries
    const draftJournals = (state.journalEntries || []).filter(
      (j) => j.status === 'draft' && (!bid || !j.branchId || Number(j.branchId) === bid)
    );
    if (draftJournals.length > 0) {
      items.push({
        id: 'draft-journals',
        category: 'approval',
        priority: 'medium',
        title: `${draftJournals.length} سند حسابداری در انتظار ثبت نهایی`,
        description: 'اسناد پیش‌نویس مالی آماده بررسی تراز و تأیید ثبت در دفتر کل هستند.',
        tab: 'accounting',
        workspace: 'reports',
        actionLabel: 'دفتر اسناد',
        createdAt: draftJournals[0]?.date || new Date().toISOString(),
      });
    }
  }

  // 5. Critical inventory shortages
  try {
    const inv = __westoModuleContext.financeV2.inventoryItemsView(__westoModuleContext.db, { branchId: bid });
    const lowItems = (inv?.items || []).filter(
      (item) => Number(item.availableQuantity) <= Number(item.reorderPoint)
    );
    if (lowItems.length > 0) {
      const names = lowItems.slice(0, 3).map((i) => `${i.name} (${i.availableQuantity} ${i.unit})`).join('، ');
      items.push({
        id: 'low-stock-alert',
        category: 'attention',
        priority: lowItems.some((i) => Number(i.availableQuantity) <= 0) ? 'urgent' : 'high',
        title: `هشدار کسری موجودی (${lowItems.length} قلم کالا)`,
        description: `موجودی به زیر نقطهٔ سفارش رسیده است: ${names}${lowItems.length > 3 ? ' و...' : ''}`,
        tab: 'inventory',
        actionLabel: 'مشاهده انبار',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (_) {}

  // 6. Reservations pending confirmation
  const pendingRes = (__westoModuleContext.db.reservations || []).filter(
    (r) => r.status === 'pending' && (!bid || Number(r.branchId) === bid)
  );
  if (pendingRes.length > 0) {
    const summaryText = pendingRes
      .slice(0, 2)
      .map((r) => `${r.name || 'مهمان'} (${r.partySize || 2} نفر برای ${r.date} ${r.time})`)
      .join(' | ');
    items.push({
      id: 'pending-reservations',
      category: 'approval',
      priority: 'high',
      title: `${pendingRes.length} رزرو میز جدید نیازمند بررسی`,
      description: summaryText + (pendingRes.length > 2 ? ` و ${pendingRes.length - 2} مورد دیگر` : ''),
      tab: 'reservations',
      actionLabel: 'بررسی رزروها',
      createdAt: pendingRes[0]?.createdAt || new Date().toISOString(),
    });
  }

  // 7. Feedback needing attention
  let fbList = __westoModuleContext.db.feedback || [];
  if (bid) fbList = fbList.filter((f) => Number(f.branchId) === bid);
  const newFeedback = fbList.filter((f) => f.status === 'new' || f.reviewed === false);
  const lowScoreFeedback = fbList.filter((f) => Number(f.score) <= 6 && Number(f.score) > 0);
  if (newFeedback.length > 0 || lowScoreFeedback.length > 0) {
    const totalIssues = newFeedback.length || lowScoreFeedback.length;
    items.push({
      id: 'feedback-attention',
      category: 'attention',
      priority: lowScoreFeedback.length > 0 ? 'high' : 'medium',
      title: `${totalIssues} بازخورد مشتریان نیازمند توجه`,
      description: lowScoreFeedback.length > 0
        ? `${lowScoreFeedback.length} نظر با امتیاز پایین ثبت شده که نیازمند پیگیری و رسیدگی مدیر است.`
        : 'نظرات جدید دریافت شده توسط مشتریان نیازمند بازبینی است.',
      tab: 'feedback',
      actionLabel: 'مشاهده بازخوردها',
      createdAt: (newFeedback[0] || lowScoreFeedback[0])?.createdAt || new Date().toISOString(),
    });
  }

  // 8. Delayed active orders
  const activeOrders = (__westoModuleContext.db.orders || []).filter(
    (o) => ['pending', 'preparing'].includes(o.status) && (!bid || Number(o.branchId) === bid)
  );
  const delayedOrders = activeOrders.filter((o) => {
    const ageMin = (Date.now() - new Date(o.createdAt).getTime()) / 60000;
    return ageMin >= 30;
  });
  if (delayedOrders.length > 0) {
    items.push({
      id: 'delayed-orders',
      category: 'attention',
      priority: 'urgent',
      title: `${delayedOrders.length} سفارش معطل بیش از ۳۰ دقیقه`,
      description: 'سفارش‌های ثبت‌شده با زمان انتظار بالا نیازمند تسریع در بخش سفارش‌ها یا آشپزخانه است.',
      tab: 'orders',
      actionLabel: 'مشاهده سفارش‌ها',
      createdAt: delayedOrders[0]?.createdAt || new Date().toISOString(),
    });
  }

  // Priority sorting: urgent -> high -> medium -> low
  const priorityWeight = { urgent: 4, critical: 4, high: 3, medium: 2, low: 1 };
  items.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));

  res.json({
    ok: true,
    summary: {
      total: items.length,
      approvals: items.filter((i) => i.category === 'approval').length,
      attention: items.filter((i) => i.category === 'attention').length,
      critical: items.filter((i) => ['urgent', 'critical', 'high'].includes(i.priority)).length,
    },
    items,
  });
});
};

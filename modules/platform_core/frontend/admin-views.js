/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:dashboard*/
window.WestoAdminModules.defineView('platform_core', 'dashboard', function(__westoViewContext) {
return {
async dashboard() {
      __westoViewContext.setActiveTab('dashboard');
      const [d, live, stats, financeResult, beResult] = await Promise.all([
        __westoViewContext.api(`/api/admin/command-center${__westoViewContext.branchQs()}`),
        __westoViewContext.api(`/api/admin/v2/overview${__westoViewContext.branchQs()}`),
        __westoViewContext.api(`/api/admin/stats${__westoViewContext.branchQs()}`).catch(() => ({ revenueWeek: 0, topItems: [] })),
        __westoViewContext.hasCapability('finance.view') && __westoViewContext.canOpenModuleTab('accounting')
          ? __westoViewContext.api(`/api/admin/v2/finance/workbench${__westoViewContext.branchQs()}`).catch((error) => ({ data: null, loadError: error?.message || 'داده مالی در دسترس نیست' }))
          : Promise.resolve({ data: null, loadError: null }),
        __westoViewContext.hasCapability('finance.view') && __westoViewContext.canOpenModuleTab('accounting')
          ? __westoViewContext.api(`/api/admin/v2/finance/planning/break-even/dashboard${__westoViewContext.branchQs()}`).catch((error) => ({ data: {
              status: 'load_error',
              chart: { status: 'insufficient_data', title: 'نقطهٔ سربه‌سر و مسیر سوددهی' },
              message: error?.message || 'دادهٔ تحلیل سودآوری دریافت نشد.',
            } }))
          : Promise.resolve(null),
      ]);
      const br = __westoViewContext.currentBranch();
      const salesToday = Number(live.metrics?.salesToday || 0);
      const activeOrders = Number(live.metrics?.activeOrders || 0);
      const busyTables = Number(live.metrics?.busyTables || 0);
      const reservationsToday = Number(d.summary?.reservationsToday || 0);
      const openCalls = Number(live.metrics?.openWaiterCalls || 0);
      const delayed = Number(d.summary?.delayed || 0);
      const queue = Number(d.summary?.queue || 0);
      const kitchenQueue = Number(d.summary?.kitchenQueue ?? (d.queue || []).filter((order) => ['sent_to_kitchen', 'paid', 'preparing'].includes(order.status)).length);
      const financeData = financeResult?.data || null;
      const breakEvenDashboard = beResult?.data || beResult || null;
      const financeCriticalIssues = Array.isArray(financeData?.issues)
        ? financeData.issues.filter((issue) => issue.severity === 'critical')
        : [];
      const financeDifferenceIrr = Number(financeData?.metrics?.unexplainedDifferenceIrr || 0);
      const financeNeedsAttention = financeCriticalIssues.length > 0 || financeDifferenceIrr !== 0;
      const financeLoadError = __westoViewContext.hasCapability('finance.view') ? financeResult?.loadError : null;
      const weeklyDailyAverage = Number(stats.revenueWeek || 0) / 7;
      const salesHealth = salesToday > 0
        ? Math.max(1, Math.min(100, Math.round((salesToday / Math.max(1, weeklyDailyAverage || salesToday)) * 100)))
        : 0;
      const kitchenHealth = Math.max(0, Math.min(100, 100 - delayed * 14 - Math.max(0, kitchenQueue - 3) * 4));
      const overviewSegments = [
        { label: 'سفارش فعال', value: activeOrders, color: '#66c346' },
        { label: 'میز درگیر', value: busyTables, color: '#4d97ed' },
        { label: 'رزرو امروز', value: reservationsToday, color: '#9b7eea' },
        { label: 'فراخوان باز', value: openCalls, color: '#ffad45' },
      ];
      const overviewTotal = overviewSegments.reduce((sum, item) => sum + item.value, 0) || 1;
      let overviewCursor = 0;
      const overviewGradient = overviewSegments.map((item) => {
        const start = overviewCursor;
        overviewCursor += (item.value / overviewTotal) * 100;
        return `${item.color} ${start.toFixed(2)}% ${overviewCursor.toFixed(2)}%`;
      }).join(', ');
      const displayName = __westoViewContext.currentUser?.name || __westoViewContext.currentUser?.phone || 'مدیر وستو';
      if (window.WestoDashboardView && typeof window.WestoDashboardView.render === 'function') {
        const payload = {
          d,
          live,
          stats,
          financeResult,
          beResult,
          currentBranch: br,
          currentUser: /*westo-module-shorthand*/ __westoViewContext.currentUser,
          hasCapability: /*westo-module-shorthand*/ __westoViewContext.hasCapability,
          esc: /*westo-module-shorthand*/ __westoViewContext.esc,
          fmtMoney: /*westo-module-shorthand*/ __westoViewContext.fmtMoney,
          fmtNum: /*westo-module-shorthand*/ __westoViewContext.fmtNum,
          sparkBars: /*westo-module-shorthand*/ __westoViewContext.sparkBars,
          fulfillmentLabel: /*westo-module-shorthand*/ __westoViewContext.fulfillmentLabel,
          statusLabel: /*westo-module-shorthand*/ __westoViewContext.statusLabel,
          renderDashboardBreakEvenShell: /*westo-module-shorthand*/ __westoViewContext.renderDashboardBreakEvenShell,
        };
        __westoViewContext.main.innerHTML = window.WestoDashboardView.render(payload, { tabs: /*westo-module-shorthand*/ __westoViewContext.tabs, showToast: /*westo-module-shorthand*/ __westoViewContext.showToast, legacyTabs: __westoViewContext.tabs });
        __westoViewContext.mountDashboardBreakEven(breakEvenDashboard);
        window.WestoDashboardView.bindEvents(__westoViewContext.main, payload, { tabs: /*westo-module-shorthand*/ __westoViewContext.tabs, showToast: /*westo-module-shorthand*/ __westoViewContext.showToast });
        return;
      }
      __westoViewContext.main.innerHTML = `
        <div class="vital-dashboard">
          <header class="vital-welcome">
            <div>
              <p class="eyebrow">مرکز فرمان زنده${br ? ` · ${__westoViewContext.esc(br.name)}` : ''}</p>
              <h1>وقت بخیر، ${__westoViewContext.esc(displayName)} <span aria-hidden="true">👋</span></h1>
              <p class="lead">امروز در مجموعه چه می‌گذرد؛ فروش، سفارش، آشپزخانه و هشدارها در یک نگاه.</p>
            </div>
            <div class="vital-page-actions">
              <span class="vital-date-pill">${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateFull(new Date()) : new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <button class="btn btn-sm btn-ghost" data-quick-tab="orders">+ سفارش جدید</button>
            </div>
          </header>

          ${financeNeedsAttention ? `<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">﷼</i><span><b>فروش و دفتر مالی نیازمند تطبیق‌اند</b><small>${__westoViewContext.fmtNum(financeCriticalIssues.length)} نوع هشدار فوری${financeDifferenceIrr ? ` · ${__westoViewContext.fmtMoney(Math.round(Math.abs(financeDifferenceIrr) / 10))} اختلاف توضیح‌نشده` : ''}</small></span><strong>باز کردن کارتابل حسابدار ←</strong></button>` : ''}
          ${financeLoadError ? '<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">!</i><span><b>وضعیت مالی دریافت نشد</b><small>خطا پنهان نشده است؛ جزئیات و تلاش دوباره در کارتابل حسابدار قرار دارد.</small></span><strong>بررسی وضعیت ←</strong></button>' : ''}

          <section class="vital-kpi-grid" aria-label="شاخص‌های اصلی امروز">
            <article class="vital-kpi is-green"><span class="vital-kpi__icon" aria-hidden="true">⌁</span><small>فروش امروز</small><strong>${__westoViewContext.fmtMoney(salesToday)}</strong><em>${salesHealth >= 100 ? 'بالاتر از میانگین هفتگی' : `${__westoViewContext.fmtNum(salesHealth)}٪ میانگین روزانه هفته`}</em></article>
            <article class="vital-kpi is-purple"><span class="vital-kpi__icon" aria-hidden="true">▣</span><small>سفارش‌های فعال</small><strong>${__westoViewContext.fmtNum(activeOrders)}</strong><em>${queue ? `${__westoViewContext.fmtNum(queue)} سفارش نیازمند اقدام` : 'صف عملیات تحت کنترل است'}</em></article>
            <article class="vital-kpi is-blue"><span class="vital-kpi__icon" aria-hidden="true">▤</span><small>میزهای درگیر</small><strong>${__westoViewContext.fmtNum(busyTables)} <i>از ${__westoViewContext.fmtNum(live.metrics?.totalTables || 0)}</i></strong><em>وضعیت زنده سالن</em></article>
            <article class="vital-kpi is-orange"><span class="vital-kpi__icon" aria-hidden="true">◌</span><small>رزروهای امروز</small><strong>${__westoViewContext.fmtNum(reservationsToday)}</strong><em>${openCalls ? `${__westoViewContext.fmtNum(openCalls)} فراخوان گارسون باز` : 'فراخوان بازی وجود ندارد'}</em></article>
          </section>

          ${__westoViewContext.renderDashboardBreakEvenShell(breakEvenDashboard, stats, financeData, __westoViewContext.hasCapability('finance.view'))}

          <div class="vital-dashboard-layout">
            <div class="vital-dashboard-main">
              <section class="vital-health-grid" aria-label="سلامت عملیات">
                <article class="vital-health-card vital-health-card--sales">
                  <header><span>سلامت فروش</span><button type="button" class="vital-more" aria-label="جزئیات فروش" data-quick-tab="reports">•••</button></header>
                  <div class="vital-dot-score" aria-label="امتیاز ${__westoViewContext.fmtNum(salesHealth)} از ۱۰۰">${__westoViewContext.fmtNum(salesHealth)}</div>
                  <strong>${salesHealth >= 90 ? 'عالی' : salesHealth >= 65 ? 'رو به رشد' : 'نیازمند توجه'}</strong>
                  <p>${__westoViewContext.fmtMoney(salesToday)} فروش ثبت‌شده امروز</p>
                  <div class="vital-dot-wave" aria-hidden="true"></div>
                </article>
                <article class="vital-health-card vital-health-card--kitchen">
                  <header><span>عملکرد آشپزخانه</span><button type="button" class="vital-more" aria-label="جزئیات آشپزخانه" data-quick-tab="kitchen">•••</button></header>
                  <div class="vital-dot-score" aria-label="امتیاز ${__westoViewContext.fmtNum(kitchenHealth)} از ۱۰۰">${__westoViewContext.fmtNum(kitchenHealth)}</div>
                  <strong>${delayed ? 'نیازمند اقدام' : 'خوب'}</strong>
                  <p>${delayed ? `${__westoViewContext.fmtNum(delayed)} سفارش دارای تأخیر` : 'سفارش دیرکرده‌ای ثبت نشده است'}</p>
                  <div class="vital-dot-wave" aria-hidden="true"></div>
                </article>
                <article class="vital-overview-card">
                  <header><div><p class="eyebrow">نمای امروز</p><h2>ترکیب عملیات</h2></div></header>
                  <div class="vital-overview-content">
                    <div class="vital-donut" style="--vital-donut:${overviewGradient}" role="img" aria-label="ترکیب عملیات امروز"><span><strong>${__westoViewContext.fmtNum(overviewSegments.reduce((sum, item) => sum + item.value, 0))}</strong><small>رویداد</small></span></div>
                    <div class="vital-donut-legend">
                      ${overviewSegments.map((item) => `<div><i style="--legend:${item.color}"></i><span>${__westoViewContext.esc(item.label)}</span><strong>${__westoViewContext.fmtNum(item.value)} <small>(${Math.round((item.value / overviewTotal) * 100)}٪)</small></strong></div>`).join('')}
                    </div>
                  </div>
                </article>
              </section>

              <section class="vital-detail-grid">
                <article class="section-box vital-chart-card">
                  <div class="ops-panel__head"><div><p class="eyebrow">روند درآمد</p><h2>${__westoViewContext.fmtMoney(stats.revenueWeek || 0)}</h2><span class="hint">فروش هفته جاری</span></div><button class="text-btn" data-quick-tab="reports">مشاهده گزارش</button></div>
                  ${__westoViewContext.sparkBars([Math.max(0, weeklyDailyAverage * .58), weeklyDailyAverage * .72, weeklyDailyAverage * .68, weeklyDailyAverage * .86, weeklyDailyAverage, weeklyDailyAverage * .92, salesToday], 76)}
                </article>
                <article class="section-box vital-selling-card">
                  <div class="ops-panel__head"><div><p class="eyebrow">محبوب‌ترین‌ها</p><h2>محصولات پرفروش</h2></div><button class="text-btn" data-quick-tab="reports">همه</button></div>
                  <div class="vital-selling-list">
                    ${(stats.topItems || []).slice(0, 5).map((item, index) => `<div><span class="vital-selling-rank">${__westoViewContext.fmtNum(index + 1)}</span><div><b>${__westoViewContext.esc(item.name)}</b><small>${__westoViewContext.fmtNum(item.qty)} فروش</small></div><strong>${__westoViewContext.fmtMoney(item.revenue)}</strong></div>`).join('') || '<p class="ops-empty">هنوز فروش ثبت نشده است.</p>'}
                  </div>
                </article>
              </section>

              <nav class="vital-action-dock" aria-label="اقدام‌های سریع">
                <button data-quick-tab="orders"><i>＋</i><span>سفارش‌ها</span></button>
                <button data-quick-tab="reservations"><i>□</i><span>رزرو میز</span></button>
                <button data-quick-tab="menu"><i>＋</i><span>افزودن محصول</span></button>
                <button data-quick-tab="club"><i>⌁</i><span>پیام به مشتریان</span></button>
                ${__westoViewContext.hasCapability('finance.view')
                  ? '<button data-quick-tab="accounting"><i>✓</i><span>کارتابل حسابدار</span></button>'
                  : '<button data-quick-tab="reports"><i>▥</i><span>گزارش‌ها</span></button>'}
              </nav>
            </div>

            <aside class="vital-side-column" aria-label="جریان زنده و هشدارها">
              <section class="section-box vital-live-panel">
                <div class="ops-panel__head"><h2>سفارش‌های زنده</h2><button class="text-btn" data-quick-tab="orders">همه</button></div>
                <div class="vital-live-list">
                  ${(d.queue || []).slice(0, 5).map((order, index) => `<button data-order-jump="${order.id}"><i class="vital-status-dot is-${index % 4}"></i><span><b>#${order.id}</b><small>${__westoViewContext.esc(order.tableNo ? `میز ${order.tableNo}` : __westoViewContext.fulfillmentLabel(order.fulfillment))}</small></span><em>${__westoViewContext.esc(__westoViewContext.statusLabel(order.status))}</em><time>${__westoViewContext.fmtNum(order.ageMinutes)}د</time></button>`).join('') || '<p class="ops-empty">سفارشی در صف نیست.</p>'}
                </div>
              </section>
              <section class="section-box vital-alert-panel">
                <div class="ops-panel__head"><h2>هشدارها</h2><button class="text-btn" data-quick-tab="inventory">همه</button></div>
                <div class="vital-alert-list">
          ${[
            ...(d.delayed || []).map((order) => ({ ...order, title: `تأخیر آشپزخانه سفارش #${order.id}` })),
            ...(d.paymentAttention || []).map((order) => ({ ...order, title: `پیگیری پرداخت سفارش #${order.id}` })),
            ...(d.handoffAttention || []).map((order) => ({ ...order, title: `انتظار تحویل سفارش #${order.id}` })),
          ].slice(0, 3).map((order) => `<div><i class="is-red">!</i><span><b>${__westoViewContext.esc(order.title)}</b><small>${__westoViewContext.fmtNum(order.stageAgeMinutes ?? order.ageMinutes)} دقیقه در ${__westoViewContext.esc(__westoViewContext.statusLabel(order.status))}</small></span></div>`).join('')}
                  ${(d.lowStock || []).slice(0, 3).map((item) => `<div><i class="is-orange">▣</i><span><b>موجودی کم: ${__westoViewContext.esc(item.name)}</b><small>${__westoViewContext.fmtNum(item.stock)} عدد باقی مانده</small></span></div>`).join('')}
                  ${!(d.delayed || []).length && !(d.lowStock || []).length ? '<p class="ops-empty">هشدار فوری وجود ندارد.</p>' : ''}
                </div>
              </section>
              <section class="section-box vital-task-panel">
                <div class="ops-panel__head"><h2>پیگیری امروز</h2><button class="text-btn" data-quick-tab="reservations">همه</button></div>
                <div class="vital-task-list">
                  ${(d.reservations || []).slice(0, 4).map((reservation) => `<div class="vital-task-row"><i aria-hidden="true"></i><span>${__westoViewContext.esc(reservation.time)} · ${__westoViewContext.esc(reservation.name)}</span></div>`).join('') || '<p class="ops-empty">کاری برای پیگیری ثبت نشده است.</p>'}
                </div>
              </section>
            </aside>
          </div>
        </div>`;
      __westoViewContext.mountDashboardBreakEven(breakEvenDashboard);
      __westoViewContext.main.querySelectorAll('[data-quick-tab]').forEach((button) => {
        button.addEventListener('click', () => __westoViewContext.tabs[button.dataset.quickTab]?.().catch((error) => __westoViewContext.showToast(error.message)));
      });
      __westoViewContext.main.querySelectorAll('[data-order-jump]').forEach((button) => {
        button.addEventListener('click', () => {
          sessionStorage.setItem('westo_admin_focus_order', button.dataset.orderJump);
          __westoViewContext.tabs.orders().catch((error) => __westoViewContext.showToast(error.message));
        });
      });
    }
}['dashboard'];
});
/*westo-view:end:dashboard*/

/*westo-view:start:users*/
window.WestoAdminModules.defineView('platform_core', 'users', function(__westoViewContext) {
return {
async users(activeSubTab = 'staff') {
      __westoViewContext.setActiveTab('users');
      const [d, matrixData, branchesData] = await Promise.all([
        __westoViewContext.api('/api/admin/users').catch(() => ({ users: [], branches: [] })),
        __westoViewContext.api('/api/admin/roles/matrix').catch(() => null),
        __westoViewContext.api('/api/branches').catch(() => ({ branches: [] })),
      ]);

      const allUsers = Array.isArray(d.users) ? d.users : [];
      const allBranches = (branchesData.branches && branchesData.branches.length) ? branchesData.branches : (d.branches || []);
      const branchMap = Object.fromEntries(allBranches.map((b) => [Number(b.id), b.name]));

      const roleDefs = {
        owner: { label: 'مالک / مدیر ارشد', icon: '👑', tagClass: 'role-tag--owner', desc: 'دسترسی نامحدود به تمامی بخش‌ها و اسناد' },
        manager: { label: 'مدیر داخلی', icon: '🧑‍💼', tagClass: 'role-tag--manager', desc: 'مدیریت سفارش‌ها، پرسنل، انبار، صندوق و گزارش‌ها' },
        accountant: { label: 'حسابدار / مدیر مالی', icon: '💰', tagClass: 'role-tag--accountant', desc: 'اسناد دوبل، ترازنامه، سودوزیان، مغایرت‌گیری و انبار' },
        cashier: { label: 'صندوقدار', icon: '💵', tagClass: 'role-tag--cashier', desc: 'ثبت سفارش، تسویه فاکتور، مدیریت پوز و نقد، تحویل' },
        waiter: { label: 'گارسون / سالن‌کار', icon: '🤵', tagClass: 'role-tag--waiter', desc: 'سفارش‌گیری سر میز، فراخوانی مهمان، وضعیت میزها' },
        kitchen: { label: 'آشپزخانه / سرآشپز', icon: '🍳', tagClass: 'role-tag--kitchen', desc: 'صف پخت KDS، شروع پخت، اعلام آماده و حواله مصرف' },
        guest: { label: 'مشتری / مهمان', icon: '🌟', tagClass: 'role-tag--guest', desc: 'مشتری عادی، سفارش، رزرو، کیف پول و باشگاه وفاداری' },
      };

      const staffRoles = new Set(['owner', 'manager', 'accountant', 'cashier', 'waiter', 'kitchen']);
      const staffUsers = allUsers.filter((u) => staffRoles.has(u.role));
      const customerUsers = allUsers.filter((u) => !staffRoles.has(u.role));
      const adminsCount = allUsers.filter((u) => u.role === 'owner' || u.role === 'manager').length;
      const walletHoldersCount = customerUsers.filter((u) => Number(u.walletBalanceToman || 0) > 0).length;

      const formatBranchScope = (user) => {
        if (user.role === 'owner') return '<span class="branch-scope-badge">همه شعب (دسترسی کل)</span>';
        if (!user.allowedBranchIds || !user.allowedBranchIds.length) return '<span class="branch-scope-badge">همه شعب مجاز</span>';
        const names = user.allowedBranchIds.map((id) => branchMap[Number(id)] || `شعبه ${id}`).join('، ');
        return `<span class="branch-scope-badge" title="${__westoViewContext.esc(names)}">${__westoViewContext.esc(names)}</span>`;
      };

      __westoViewContext.main.innerHTML = `
        <div class="users-view-root">
          <div class="page-header" style="margin-bottom:0.25rem;">
            <div>
              <span class="eyebrow">سازماندهی دسترسی و پرسنل</span>
              <h1>کاربران، پرسنل و باشگاه مشتریان</h1>
              <p class="lead">مدیریت پرسنل ایستگاه‌ها (گارسون، صندوقدار، حسابدار و...)، اعضای باشگاه مشتریان و ماتریس اختیارات بخش‌های سامانه.</p>
            </div>
            <div class="header-actions">
              <button class="btn btn-primary" id="btn-quick-new-user" type="button">➕ افزودن کاربر یا پرسنل</button>
            </div>
          </div>

          <!-- Top Header Navigation Tabs -->
          <nav class="users-nav" aria-label="بخش‌های کاربران و دسترسی">
            <button class="users-nav-item ${activeSubTab === 'staff' ? 'is-active' : ''}" data-users-tab="staff" type="button">
              <span>👨‍🍳 پرسنل و کادر رستوران</span>
              <span class="users-nav-badge">${__westoViewContext.fmtNum(staffUsers.length)}</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'customers' ? 'is-active' : ''}" data-users-tab="customers" type="button">
              <span>🌟 مشتریان و باشگاه</span>
              <span class="users-nav-badge">${__westoViewContext.fmtNum(customerUsers.length)}</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'matrix' ? 'is-active' : ''}" data-users-tab="matrix" type="button">
              <span>🛡️ ماتریس دسترسی و اختیارات</span>
            </button>
            <button class="users-nav-item ${activeSubTab === 'new' ? 'is-active' : ''}" data-users-tab="new" type="button">
              <span>➕ تعریف کاربر جدید</span>
            </button>
          </nav>

          <!-- KPI Summary Strip -->
          <div class="users-kpi-grid">
            <div class="users-kpi-card kpi--staff">
              <span class="users-kpi-lbl">کادر فعال رستوران</span>
              <div class="users-kpi-val">${__westoViewContext.fmtNum(staffUsers.length)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">گارسون، صندوق، حسابدار، آشپزخانه و مدیر</span>
            </div>
            <div class="users-kpi-card kpi--customers">
              <span class="users-kpi-lbl">مشتریان باشگاه وفاداری</span>
              <div class="users-kpi-val">${__westoViewContext.fmtNum(customerUsers.length)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">کاربر</small></div>
              <span class="users-kpi-sub">اعضای ثبت‌نام‌شده با شماره همراه</span>
            </div>
            <div class="users-kpi-card kpi--admins">
              <span class="users-kpi-lbl">مدیران و دسترسی‌های ارشد</span>
              <div class="users-kpi-val">${__westoViewContext.fmtNum(adminsCount)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">مالک مجموعه و مدیران داخلی</span>
            </div>
            <div class="users-kpi-card kpi--wallet">
              <span class="users-kpi-lbl">اعضای دارای کیف پول</span>
              <div class="users-kpi-val">${__westoViewContext.fmtNum(walletHoldersCount)} <small style="font-size:0.85rem; font-weight:600; color:var(--v-muted);">نفر</small></div>
              <span class="users-kpi-sub">دارای مانده اعتبار فعال</span>
            </div>
          </div>

          <!-- Dynamic Container -->
          <div id="users-tab-content"></div>
        </div>
      `;

      // Bind Top Header Tabs
      __westoViewContext.main.querySelectorAll('[data-users-tab]').forEach((btn) => {
        btn.addEventListener('click', () => __westoViewContext.tabs.users(btn.dataset.usersTab));
      });
      document.getElementById('btn-quick-new-user')?.addEventListener('click', () => __westoViewContext.tabs.users('new'));

      const container = document.getElementById('users-tab-content');

      // ─────────────────────────────────────────────────────────────
      // 1. SUBTAB: STAFF (پرسنل و کادر رستوران)
      // ─────────────────────────────────────────────────────────────
      if (activeSubTab === 'staff') {
        container.innerHTML = `
          <div class="users-toolbar">
            <div class="users-search-box">
              <input id="staff-search-input" class="users-search-input" placeholder="🔍 جستجوی پرسنل با نام، شماره یا نقش…" />
            </div>
            <div class="users-filter-pills" id="staff-role-pills">
              <button type="button" class="users-pill-btn is-active" data-staff-filter="all">همه پرسنل (${__westoViewContext.fmtNum(staffUsers.length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="waiter">🤵 گارسون (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='waiter').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="cashier">💵 صندوقدار (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='cashier').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="accountant">💰 حسابدار (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='accountant').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="kitchen">🍳 آشپزخانه (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='kitchen').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="manager">🧑‍💼 مدیر (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='manager').length)})</button>
              <button type="button" class="users-pill-btn" data-staff-filter="owner">👑 مالک (${__westoViewContext.fmtNum(staffUsers.filter(u=>u.role==='owner').length)})</button>
            </div>
          </div>

          <div class="section-box" style="padding:0; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="tbl" style="margin:0;">
                <thead>
                  <tr>
                    <th>پرسنل</th>
                    <th>نقش انتصابی</th>
                    <th>تخصیص شعب</th>
                    <th>وضعیت حساب</th>
                    <th>آخرین ورود</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody id="staff-table-body"></tbody>
              </table>
            </div>
          </div>
        `;

        let activeFilter = 'all';
        let searchQuery = '';

        const renderStaffTable = () => {
          const tbody = document.getElementById('staff-table-body');
          if (!tbody) return;

          const filtered = staffUsers.filter((u) => {
            if (activeFilter !== 'all' && u.role !== activeFilter) return false;
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              const matchPhone = (u.phone || '').includes(q);
              const matchName = (u.name || '').toLowerCase().includes(q);
              const matchRole = (roleDefs[u.role]?.label || '').toLowerCase().includes(q);
              if (!matchPhone && !matchName && !matchRole) return false;
            }
            return true;
          });

          if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2.5rem; color:var(--v-muted);">پرسنلی با این مشخصات یافت نشد.</td></tr>`;
            return;
          }

          tbody.innerHTML = filtered.map((u) => {
            const roleMeta = roleDefs[u.role] || roleDefs.guest;
            const isOwnerUser = u.role === 'owner';
            const workspaceMap = {
              cashier: '/admin/cashier',
              waiter: '/admin/waiter',
              kitchen: '/admin/kitchen',
              accountant: '/admin?tab=accounting',
              manager: '/admin',
              owner: '/admin',
            };
            const rolePath = workspaceMap[u.role] || '/role-panel.html';

            return `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:36px; height:36px; border-radius:50%; background:var(--v-panel-muted); display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">
                      ${roleMeta.icon}
                    </div>
                    <div>
                      <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${__westoViewContext.esc(u.name || 'بدون نام')}</strong>
                      <span class="hint ltr" style="font-size:0.78rem;">${__westoViewContext.esc(u.phone)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <select class="input input-sm" data-change-role="${__westoViewContext.esc(u.phone)}" style="font-weight:600; font-size:0.8rem; width:auto;">
                      ${Object.entries(roleDefs).map(([rKey, rVal]) => `
                        <option value="${rKey}" ${u.role === rKey ? 'selected' : ''}>${rVal.icon} ${rVal.label}</option>
                      `).join('')}
                    </select>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    ${formatBranchScope(u)}
                    ${!isOwnerUser ? `<button type="button" class="btn btn-xs btn-ghost" data-assign-branch="${__westoViewContext.esc(u.phone)}" title="تغییر شعبه">✏️</button>` : ''}
                  </div>
                </td>
                <td>
                  ${u.blocked 
                    ? '<span class="pill blocked" style="font-size:0.75rem;">⛔ مسدود</span>' 
                    : '<span class="pill" style="background:rgba(16,185,129,0.12); color:#059669; font-size:0.75rem;">🟢 فعال</span>'}
                </td>
                <td>
                  <span style="font-size:0.78rem; color:var(--v-muted);">${__westoViewContext.fmtDateTime(u.lastLoginAt || u.createdAt)}</span>
                </td>
                <td>
                  <div class="row-actions" style="gap:0.35rem;">
                    ${workspaceMap[u.role] ? `
                      <a href="${rolePath}" target="_blank" class="btn btn-xs btn-ghost" title="مشاهده پنل نقش">👁️ پنل نقش</a>
                    ` : ''}
                    <button class="btn btn-xs ${u.blocked ? 'btn-ghost' : 'btn-ghost'}" data-toggle-block="${__westoViewContext.esc(u.phone)}" data-val="${!u.blocked}">
                      ${u.blocked ? 'رفع مسدودی' : 'مسدودسازی'}
                    </button>
                    ${!isOwnerUser ? `<button class="btn btn-xs btn-danger" data-delete-user="${__westoViewContext.esc(u.phone)}">حذف</button>` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Bind Role Switchers
          tbody.querySelectorAll('[data-change-role]').forEach((sel) => {
            sel.addEventListener('change', async () => {
              const phone = sel.dataset.changeRole;
              const newRole = sel.value;
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ role: newRole }),
                });
                __westoViewContext.showToast(`نقش کاربر ${phone} به «${roleDefs[newRole]?.label || newRole}» تغییر یافت.`);
                __westoViewContext.tabs.users('staff');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در تغییر نقش');
              }
            });
          });

          // Bind Branch Assignment
          tbody.querySelectorAll('[data-assign-branch]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const phone = btn.dataset.assignBranch;
              const user = staffUsers.find((x) => x.phone === phone);
              if (!user) return;
              renderBranchAssignModal(user, allBranches);
            });
          });

          // Bind Toggle Block
          tbody.querySelectorAll('[data-toggle-block]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.toggleBlock;
              const blocked = btn.dataset.val === 'true';
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ blocked }),
                });
                __westoViewContext.showToast(blocked ? 'کاربر مسدود شد' : 'رفع مسدودی انجام شد');
                __westoViewContext.tabs.users('staff');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در تغییر وضعیت کاربر');
              }
            });
          });

          // Bind Delete
          tbody.querySelectorAll('[data-delete-user]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.deleteUser;
              if (!confirm(`آیا از حذف حساب پرسنل ${phone} اطمینان دارید؟`)) return;
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, { method: 'DELETE' });
                __westoViewContext.showToast('کاربر حذف شد');
                __westoViewContext.tabs.users('staff');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در حذف کاربر');
              }
            });
          });
        };

        renderStaffTable();

        document.getElementById('staff-search-input')?.addEventListener('input', (e) => {
          searchQuery = e.target.value.trim();
          renderStaffTable();
        });

        document.getElementById('staff-role-pills')?.querySelectorAll('[data-staff-filter]').forEach((pill) => {
          pill.addEventListener('click', () => {
            document.getElementById('staff-role-pills').querySelectorAll('[data-staff-filter]').forEach((p) => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            activeFilter = pill.dataset.staffFilter;
            renderStaffTable();
          });
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 2. SUBTAB: CUSTOMERS (مشتریان و باشگاه)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'customers') {
        container.innerHTML = `
          <div class="users-toolbar">
            <div class="users-search-box">
              <input id="cust-search-input" class="users-search-input" placeholder="🔍 جستجوی مشتری با نام یا شماره همراه…" />
            </div>
            <div class="users-filter-pills" id="cust-tier-pills">
              <button type="button" class="users-pill-btn is-active" data-cust-filter="all">همه مشتریان (${__westoViewContext.fmtNum(customerUsers.length)})</button>
              <button type="button" class="users-pill-btn" data-cust-filter="wallet">💳 دارای کیف پول (${__westoViewContext.fmtNum(walletHoldersCount)})</button>
              <button type="button" class="users-pill-btn" data-cust-filter="bronze">🥉 برنزی</button>
              <button type="button" class="users-pill-btn" data-cust-filter="silver">🥈 نقره‌ای</button>
              <button type="button" class="users-pill-btn" data-cust-filter="gold">🥇 طلایی</button>
              <button type="button" class="users-pill-btn" data-cust-filter="diamond">💎 VIP</button>
            </div>
          </div>

          <div class="section-box" style="padding:0; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="tbl" style="margin:0;">
                <thead>
                  <tr>
                    <th>مشتری</th>
                    <th>سطح وفاداری</th>
                    <th>امتیاز باشگاه</th>
                    <th>موجودی کیف پول</th>
                    <th>سفارش‌ها / خرید</th>
                    <th>آخرین فعالیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody id="customers-table-body"></tbody>
              </table>
            </div>
          </div>
        `;

        let activeCustFilter = 'all';
        let custSearchQuery = '';

        const renderCustTable = () => {
          const tbody = document.getElementById('customers-table-body');
          if (!tbody) return;

          const filtered = customerUsers.filter((u) => {
            const tierId = u.tier?.id || 'bronze';
            if (activeCustFilter === 'wallet' && !(Number(u.walletBalanceToman || 0) > 0)) return false;
            if (activeCustFilter !== 'all' && activeCustFilter !== 'wallet' && tierId !== activeCustFilter) return false;
            if (custSearchQuery) {
              const q = custSearchQuery.toLowerCase();
              const matchPhone = (u.phone || '').includes(q);
              const matchName = (u.name || '').toLowerCase().includes(q);
              if (!matchPhone && !matchName) return false;
            }
            return true;
          });

          if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--v-muted);">مشتری با این فیلتر یافت نشد.</td></tr>`;
            return;
          }

          tbody.innerHTML = filtered.map((u) => {
            const t = u.tier || { name: 'برنزی', badgeIcon: '🥉', id: 'bronze' };
            const walletToman = Number(u.walletBalanceToman || 0);

            return `
              <tr>
                <td>
                  <div style="display:flex; align-items:center; gap:0.65rem;">
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(56,189,248,0.1); color:#0284c7; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.88rem; flex-shrink:0;">
                      ${__westoViewContext.esc((u.name || 'م')[0])}
                    </div>
                    <div>
                      <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${__westoViewContext.esc(u.name || 'مشتری بدون نام')}</strong>
                      <span class="hint ltr" style="font-size:0.78rem;">${__westoViewContext.esc(u.phone)}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="tier-badge tier-badge-${__westoViewContext.esc(t.id || 'bronze')}" style="display:inline-flex; align-items:center; gap:0.35rem; font-size:0.78rem;">
                    ${__westoViewContext.esc(t.badgeIcon || '🥉')} ${__westoViewContext.esc(t.name || 'برنزی')}
                  </span>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:0.4rem;">
                    <strong style="font-size:0.86rem; color:#7357ce;">${__westoViewContext.fmtNum(u.points || 0)}</strong>
                    <button type="button" class="btn btn-xs btn-ghost" data-adjust-points="${__westoViewContext.esc(u.phone)}" data-curr-pts="${u.points || 0}" title="تنظیم امتیاز">✏️</button>
                  </div>
                </td>
                <td>
                  <strong style="font-size:0.86rem; color:${walletToman > 0 ? '#10b981' : 'var(--v-muted)'};">
                    ${walletToman > 0 ? __westoViewContext.fmtMoney(walletToman) : '۰ تومان'}
                  </strong>
                </td>
                <td>
                  <span style="font-size:0.8rem;">${__westoViewContext.fmtNum(u.ordersCount || 0)} سفارش</span>
                  ${u.totalSpendToman ? `<small style="display:block; color:var(--v-muted); font-size:0.72rem;">${__westoViewContext.fmtMoney(u.totalSpendToman)}</small>` : ''}
                </td>
                <td>
                  <span style="font-size:0.78rem; color:var(--v-muted);">${__westoViewContext.fmtDateTime(u.lastLoginAt || u.createdAt)}</span>
                </td>
                <td>
                  <div class="row-actions" style="gap:0.35rem;">
                    <button class="btn btn-xs btn-primary" data-open-dossier="${__westoViewContext.esc(u.phone)}">📋 پرونده</button>
                    <button class="btn btn-xs btn-ghost" data-promote-staff="${__westoViewContext.esc(u.phone)}" title="تبدیل به پرسنل">👔 پرسنل</button>
                    <button class="btn btn-xs btn-ghost" data-toggle-block="${__westoViewContext.esc(u.phone)}" data-val="${!u.blocked}">
                      ${u.blocked ? 'رفع مسدودی' : 'مسدودسازی'}
                    </button>
                    <button class="btn btn-xs btn-danger" data-delete-user="${__westoViewContext.esc(u.phone)}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Open Dossier
          tbody.querySelectorAll('[data-open-dossier]').forEach((btn) => {
            btn.addEventListener('click', () => {
              if (typeof __westoViewContext.tabs.club === 'function') {
                __westoViewContext.tabs.club('customers');
              }
            });
          });

          // Promote to Staff
          tbody.querySelectorAll('[data-promote-staff]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.promoteStaff;
              const newRole = prompt(`نقش پرسنلی برای ${phone} را انتخاب کنید:\n(waiter=گارسون, cashier=صندوقدار, accountant=حسابدار, kitchen=آشپزخانه, manager=مدیر)`, 'waiter');
              if (!newRole) return;
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ role: newRole.trim() }),
                });
                __westoViewContext.showToast(`کاربر با موفقیت به کادر پرسنلی اضافه شد.`);
                __westoViewContext.tabs.users('staff');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در تبدیل نقش');
              }
            });
          });

          // Adjust Points
          tbody.querySelectorAll('[data-adjust-points]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.adjustPoints;
              const current = Number(btn.dataset.currPts || 0);
              const val = prompt(`امتیاز جدید برای مشتری ${phone}:`, current);
              if (val === null) return;
              const newPoints = __westoViewContext.parseInputNumber(val);
              if (newPoints == null || Number.isNaN(newPoints) || newPoints < 0) {
                __westoViewContext.showToast('امتیاز باید یک عدد معتبر باشد.');
                return;
              }
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ points: newPoints }),
                });
                __westoViewContext.showToast('امتیاز به‌روزرسانی شد');
                __westoViewContext.tabs.users('customers');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در ثبت امتیاز');
              }
            });
          });

          // Toggle Block
          tbody.querySelectorAll('[data-toggle-block]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.toggleBlock;
              const blocked = btn.dataset.val === 'true';
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ blocked }),
                });
                __westoViewContext.showToast(blocked ? 'مشتری مسدود شد' : 'رفع مسدودی انجام شد');
                __westoViewContext.tabs.users('customers');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در تغییر وضعیت');
              }
            });
          });

          // Delete
          tbody.querySelectorAll('[data-delete-user]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const phone = btn.dataset.deleteUser;
              if (!confirm(`آیا از حذف حساب مشتری ${phone} اطمینان دارید؟`)) return;
              try {
                await __westoViewContext.api(`/api/admin/users/${phone}`, { method: 'DELETE' });
                __westoViewContext.showToast('مشتری حذف شد');
                __westoViewContext.tabs.users('customers');
              } catch (err) {
                __westoViewContext.showToast(err.message || 'خطا در حذف');
              }
            });
          });
        };

        renderCustTable();

        document.getElementById('cust-search-input')?.addEventListener('input', (e) => {
          custSearchQuery = e.target.value.trim();
          renderCustTable();
        });

        document.getElementById('cust-tier-pills')?.querySelectorAll('[data-cust-filter]').forEach((pill) => {
          pill.addEventListener('click', () => {
            document.getElementById('cust-tier-pills').querySelectorAll('[data-cust-filter]').forEach((p) => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            activeCustFilter = pill.dataset.custFilter;
            renderCustTable();
          });
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 3. SUBTAB: MATRIX (ماتریس دسترسی‌ها و اختیارات نقش‌ها)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'matrix') {
        const matrixSections = matrixData?.sections || [
          { id: 'orders', title: 'سفارش‌ها و صندوق', description: 'ثبت، تسویه فاکتور و مشاهده سفارش‌ها', roles: { owner: 'full', manager: 'full', cashier: 'full', waiter: 'create_view', kitchen: 'none', accountant: 'none', guest: 'self_only' } },
          { id: 'kitchen', title: 'صف آشپزخانه (KDS)', description: 'کارت‌های پخت و اعلام وضعیت آماده', roles: { owner: 'full', manager: 'full', kitchen: 'full', cashier: 'none', waiter: 'none', accountant: 'none', guest: 'none' } },
          { id: 'tables', title: 'میزها و سالن', description: 'نقشه میزها و فراخوانی گارسون', roles: { owner: 'full', manager: 'full', waiter: 'full', cashier: 'full', kitchen: 'none', accountant: 'none', guest: 'call_only' } },
          { id: 'finance', title: 'مالی و حسابداری', description: 'اسناد دوبل، ترازنامه، سودوزیان', roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'cash_only', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'inventory', title: 'انبار و مواد اولیه', description: 'موجودی، رسید ورود کالا و حواله مصرف', roles: { owner: 'full', manager: 'full', accountant: 'view_only', kitchen: 'operations_only', cashier: 'none', waiter: 'none', guest: 'none' } },
          { id: 'menu', title: 'منو و محصولات', description: 'ویرایش غذاها و قیمت‌گذاری منو', roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'reports', title: 'گزارش‌های فروش و آمار', description: 'آمار فروش، سودآوری و ترافیک مهمان', roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
          { id: 'club', title: 'باشگاه مشتریان و پیامک', description: 'اعضای باشگاه، کیف پول، سطوح و SMS', roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'profile_only' } },
          { id: 'settings', title: 'تنظیمات و دسترسی کاربران', description: 'تغییر نقش، تعریف پرسنل و شعب', roles: { owner: 'full', manager: 'view_manage', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' } },
        ];

        const permBadge = (status) => {
          if (status === 'full') return '<span class="perm-indicator perm-full">🟢 کامل</span>';
          if (status === 'none') return '<span class="perm-indicator perm-none">🔴 عدم دسترسی</span>';
          if (status === 'create_view') return '<span class="perm-indicator perm-partial">🟡 ثبت و مشاهده</span>';
          if (status === 'view_only') return '<span class="perm-indicator perm-partial">🟡 فقط مشاهده</span>';
          if (status === 'cash_only') return '<span class="perm-indicator perm-partial">🟡 فقط نقد و پوز</span>';
          if (status === 'operations_only') return '<span class="perm-indicator perm-partial">🟡 حواله مصرف</span>';
          if (status === 'view_manage') return '<span class="perm-indicator perm-partial">🟡 مشاهده و ویرایش</span>';
          if (status === 'call_only') return '<span class="perm-indicator perm-partial">🟡 درخواست سرویس</span>';
          if (status === 'self_only') return '<span class="perm-indicator perm-partial">🟡 سفارش شخصی</span>';
          if (status === 'profile_only') return '<span class="perm-indicator perm-partial">🟡 صفحه پروفایل</span>';
          return `<span class="perm-indicator perm-partial">🟡 ${__westoViewContext.esc(status)}</span>`;
        };

        container.innerHTML = `
          <div class="role-matrix-section">
            <div class="section-box">
              <h2>ایستگاه‌ها و فضاهای کاری پرسنل</h2>
              <p class="lead">هر نقش کاری در سامانه وستو دارای رابط کاربری ایزوله و اختصاصی است تا تداخلی میان عملیات سالن، آشپزخانه و حسابداری ایجاد نشود.</p>
              
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:1rem; margin-top:1rem;">
                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>🤵 گارسون (سالن‌کار)</strong>
                    <span class="role-tag role-tag--waiter">Waiter</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">سفارش‌گیری سر میز با تبلت، مشاهده وضعیت میزها و دریافت اعلان‌های فراخوانی مهمان.</p>
                  <a href="/admin/waiter" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل گارسون ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>💵 صندوقدار (POS)</strong>
                    <span class="role-tag role-tag--cashier">Cashier</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">تسویه سفارش‌های حضوری و آنلاین، مدیریت کارت‌خوان و صندوق نقدی، وضعیت ارسال و پیک.</p>
                  <a href="/admin/cashier" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل صندوقدار ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>🍳 آشپزخانه (KDS)</strong>
                    <span class="role-tag role-tag--kitchen">Kitchen</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">صف کارت‌های پخت زنده، دکمه‌های شروع آماده‌سازی و تغییر وضعیت به آماده با میانبرهای کیبورد.</p>
                  <a href="/admin/kitchen" target="_blank" class="btn btn-sm btn-ghost" style="width:100%; justify-content:center;">ورود به پنل آشپزخانه ↗</a>
                </div>

                <div class="role-matrix-card">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <strong>💰 حسابدار (Finance)</strong>
                    <span class="role-tag role-tag--accountant">Accountant</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--v-muted); margin-bottom:0.75rem;">اسناد حسابداری دوبل، تراز آزمایشی، صورت‌های مالی، بهای تمام‌شده و مغایرت‌گیری بانکی.</p>
                  <button type="button" class="btn btn-sm btn-ghost" id="btn-go-accounting" style="width:100%; justify-content:center;">ورود به کارتابل حسابداری ↗</button>
                </div>
              </div>
            </div>

            <!-- Full Capability Matrix Table -->
            <div class="section-box" style="padding:0; overflow:hidden;">
              <div style="padding:1.25rem 1.25rem 0.5rem 1.25rem;">
                <h2>ماتریس دسترسی به بخش‌های نرم‌افزار</h2>
                <p class="lead">سطح دسترسی هر نقش به ماژول‌های مختلف بر اساس اصل کمترین دسترسی لازم (Least Privilege) تنظیم شده است.</p>
              </div>
              <div style="overflow-x:auto;">
                <table class="role-matrix-table" style="margin:0;">
                  <thead>
                    <tr>
                      <th style="min-width:200px;">بخش نرم‌افزار</th>
                      <th>👑 مالک</th>
                      <th>🧑‍💼 مدیر</th>
                      <th>💰 حسابدار</th>
                      <th>💵 صندوقدار</th>
                      <th>🤵 گارسون</th>
                      <th>🍳 آشپزخانه</th>
                      <th>🌟 مشتری</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${matrixSections.map((sec) => `
                      <tr>
                        <td>
                          <strong style="display:block; font-size:0.88rem; color:var(--v-ink);">${__westoViewContext.esc(sec.title)}</strong>
                          <span style="font-size:0.75rem; color:var(--v-muted);">${__westoViewContext.esc(sec.description)}</span>
                        </td>
                        <td>${permBadge(sec.roles.owner)}</td>
                        <td>${permBadge(sec.roles.manager)}</td>
                        <td>${permBadge(sec.roles.accountant)}</td>
                        <td>${permBadge(sec.roles.cashier)}</td>
                        <td>${permBadge(sec.roles.waiter)}</td>
                        <td>${permBadge(sec.roles.kitchen)}</td>
                        <td>${permBadge(sec.roles.guest)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;

        document.getElementById('btn-go-accounting')?.addEventListener('click', () => {
          if (typeof __westoViewContext.tabs.accounting === 'function') __westoViewContext.tabs.accounting();
        });
      }

      // ─────────────────────────────────────────────────────────────
      // 4. SUBTAB: NEW USER (افزودن کاربر یا پرسنل جدید)
      // ─────────────────────────────────────────────────────────────
      else if (activeSubTab === 'new') {
        container.innerHTML = `
          <div class="section-box" style="max-width:720px; margin:0 auto;">
            <h2>تعریف کاربر یا پرسنل جدید</h2>
            <p class="lead">ثبت شماره همراه، نام و تعیین سطح دسترسی (مشتری باشگاه، گارسون، صندوقدار، حسابدار، مدیر و...).</p>

            <form id="form-create-new-user" class="user-add-sheet" style="margin-top:1.25rem;">
              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-phone">شماره موبایل <span style="color:#ef4444;">*</span></label>
                  <input type="tel" id="nu-phone" class="input ltr" placeholder="09123456789" required maxlength="11" />
                  <span class="hint">شماره همراه ۱۱ رقمی استاندارد</span>
                </div>

                <div class="field">
                  <label for="nu-name">نام و نام خانوادگی <span style="color:#ef4444;">*</span></label>
                  <input type="text" id="nu-name" class="input" placeholder="مثال: علی احمدی" required />
                </div>
              </div>

              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-role">نقش و سطح دسترسی <span style="color:#ef4444;">*</span></label>
                  <select id="nu-role" class="input" style="font-weight:600;">
                    <optgroup label="کادر پرسنل رستوران">
                      <option value="waiter">🤵 گارسون (سالن‌کار)</option>
                      <option value="cashier">💵 صندوقدار (صندوق و تحویل)</option>
                      <option value="accountant">💰 حسابدار (مدیریت مالی)</option>
                      <option value="kitchen">🍳 آشپزخانه (KDS)</option>
                      <option value="manager">🧑‍💼 مدیر داخلی (عملیات و پرسنل)</option>
                      <option value="owner">👑 مالک (دسترسی نامحدود)</option>
                    </optgroup>
                    <optgroup label="مشتریان">
                      <option value="guest" selected>🌟 مشتری / عضو باشگاه وفاداری</option>
                    </optgroup>
                  </select>
                </div>

                <div class="field" id="nu-branch-wrap">
                  <label for="nu-branch">تخصیص شعبه</label>
                  <select id="nu-branch" class="input">
                    <option value="">همه شعب مجاز</option>
                    ${allBranches.map((b) => `<option value="${b.id}">${__westoViewContext.esc(b.name || `شعبه ${b.id}`)}</option>`).join('')}
                  </select>
                  <span class="hint">برای پرسنل محدود به یک شعبه مشخص</span>
                </div>
              </div>

              <div class="user-add-grid">
                <div class="field">
                  <label for="nu-points">امتیاز اولیه باشگاه</label>
                  <input type="number" id="nu-points" class="input ltr" placeholder="0" value="0" min="0" />
                </div>

                <div class="field">
                  <label for="nu-email">پست الکترونیک (اختیاری)</label>
                  <input type="email" id="nu-email" class="input ltr" placeholder="name@example.com" />
                </div>
              </div>

              <div class="field">
                <label for="nu-notes">یادداشت پرسنلی / توضیحات</label>
                <textarea id="nu-notes" class="input" rows="2" placeholder="توضیحات تکمیلی درباره کاربر یا پرسنل…"></textarea>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:0.75rem; margin-top:0.5rem;">
                <button type="button" class="btn btn-ghost" id="nu-cancel-btn">انصراف</button>
                <button type="submit" class="btn btn-primary" id="nu-submit-btn">ثبت و ایجاد کاربر</button>
              </div>
            </form>
          </div>
        `;

        document.getElementById('nu-cancel-btn')?.addEventListener('click', () => __westoViewContext.tabs.users('staff'));

        document.getElementById('form-create-new-user')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const phone = normalizeDigits(document.getElementById('nu-phone')?.value || '').trim();
          const name = document.getElementById('nu-name')?.value.trim() || '';
          const role = document.getElementById('nu-role')?.value || 'guest';
          const branchId = document.getElementById('nu-branch')?.value || null;
          const points = __westoViewContext.parseInputNumber(document.getElementById('nu-points')?.value) || 0;
          const email = document.getElementById('nu-email')?.value.trim() || '';
          const notes = document.getElementById('nu-notes')?.value.trim() || '';

          const submitBtn = document.getElementById('nu-submit-btn');
          submitBtn.disabled = true;
          submitBtn.textContent = 'در حال ثبت…';

          try {
            await __westoViewContext.api('/api/admin/users', {
              method: 'POST',
              body: JSON.stringify({
                phone,
                name,
                role,
                branchId: branchId || null,
                points,
                email,
                notes,
              }),
            });
            __westoViewContext.showToast(`کاربر «${name}» با نقش «${roleDefs[role]?.label || role}» با موفقیت اضافه شد.`);
            __westoViewContext.tabs.users(staffRoles.has(role) ? 'staff' : 'customers');
          } catch (err) {
            __westoViewContext.showToast(err.message || 'خطا در ثبت کاربر');
            submitBtn.disabled = false;
            submitBtn.textContent = 'ثبت و ایجاد کاربر';
          }
        });
      }

      // ─────────────────────────────────────────────────────────────
      // Helper Modal: Branch Allocation
      // ─────────────────────────────────────────────────────────────
      function renderBranchAssignModal(user, branches) {
        let modal = document.getElementById('branch-assign-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'branch-assign-modal';
          modal.className = 'dossier-modal-overlay';
          document.body.appendChild(modal);
        }

        const userBranches = Array.isArray(user.allowedBranchIds) ? user.allowedBranchIds : [];
        const isAll = user.allowedBranchIds === null;

        modal.innerHTML = `
          <div class="dossier-modal-box" style="max-width:440px;" role="dialog" aria-modal="true">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--v-line); padding-bottom:0.6rem; margin-bottom:0.85rem;">
              <div>
                <h3 style="margin:0; font-size:1.05rem;">تخصیص شعب به ${__westoViewContext.esc(user.name || user.phone)}</h3>
                <span class="hint" style="font-size:0.78rem;">نقش: ${__westoViewContext.esc(roleDefs[user.role]?.label || user.role)}</span>
              </div>
              <button class="btn btn-sm btn-ghost" id="ba-close-btn" type="button">✕</button>
            </div>

            <form id="ba-form">
              <div style="margin-bottom:0.85rem;">
                <label style="display:flex; align-items:center; gap:0.5rem; font-weight:700; cursor:pointer; margin-bottom:0.65rem;">
                  <input type="radio" name="ba-scope" value="all" ${isAll ? 'checked' : ''} />
                  <span>دسترسی به همه شعب</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.5rem; font-weight:700; cursor:pointer;">
                  <input type="radio" name="ba-scope" value="specific" ${!isAll ? 'checked' : ''} />
                  <span>دسترسی فقط به شعب مشخص‌شده:</span>
                </label>
              </div>

              <div id="ba-branches-list" style="display:flex; flex-direction:column; gap:0.4rem; padding-right:1.25rem; margin-bottom:1.25rem;">
                ${branches.map((b) => `
                  <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.85rem; cursor:pointer;">
                    <input type="checkbox" class="ba-branch-chk" value="${b.id}" ${userBranches.includes(Number(b.id)) ? 'checked' : ''} />
                    <span>${__westoViewContext.esc(b.name || `شعبه ${b.id}`)}</span>
                  </label>
                `).join('')}
              </div>

              <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
                <button type="button" class="btn btn-sm btn-ghost" id="ba-cancel">انصراف</button>
                <button type="submit" class="btn btn-sm btn-primary">ذخیره تغییرات</button>
              </div>
            </form>
          </div>
        `;

        modal.querySelector('#ba-close-btn').addEventListener('click', () => modal.remove());
        modal.querySelector('#ba-cancel').addEventListener('click', () => modal.remove());

        modal.querySelector('#ba-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const scope = modal.querySelector('input[name="ba-scope"]:checked').value;
          let allowedBranchIds = null;
          if (scope === 'specific') {
            allowedBranchIds = Array.from(modal.querySelectorAll('.ba-branch-chk:checked')).map((c) => Number(c.value));
          }
          try {
            await __westoViewContext.api(`/api/admin/users/${user.phone}`, {
              method: 'PATCH',
              body: JSON.stringify({ allowedBranchIds }),
            });
            __westoViewContext.showToast('تخصیص شعب با موفقیت ذخیره شد');
            modal.remove();
            __westoViewContext.tabs.users('staff');
          } catch (err) {
            __westoViewContext.showToast(err.message || 'خطا در ذخیره شعب');
          }
        });
      }
    }
}['users'];
});
/*westo-view:end:users*/

/*westo-view:start:neem*/
window.WestoAdminModules.defineView('platform_core', 'neem', function(__westoViewContext) {
return {
async neem() {
      __westoViewContext.setActiveTab('neem');
      const d = await __westoViewContext.api('/api/admin/neem-integration');
      const sync = d.integration || {};
      const hasError = !!sync.lastError || (sync.recentFailures || []).length > 0;
      __westoViewContext.main.innerHTML = `
        <h1>همگام‌سازی سامانه بیرونی</h1>
        <p class="lead">منوی عمومی، ثبت سفارش و تجربه سه‌بعدی وستو مستقل می‌مانند. سفارش، پرداخت، مشتری و امتیاز وفاداری در پس‌زمینه با سامانه مالی بیرونی همگام می‌شوند.</p>
        <div class="cards">
          <div class="card ${sync.enabled ? 'accent' : 'warn'}"><div class="num">${sync.enabled ? 'فعال' : 'متوقف'}</div><div class="lbl">وضعیت اتصال</div></div>
          <div class="card ${Number(sync.queued || 0) ? 'warn' : ''}"><div class="num">${__westoViewContext.fmtNum(sync.queued || 0)}</div><div class="lbl">رویداد در صف</div></div>
          <div class="card"><div class="num">${__westoViewContext.fmtNum(sync.deliveredRetained || 0)}</div><div class="lbl">ارسال‌های ثبت‌شده</div></div>
          <div class="card ${hasError ? 'danger' : ''}"><div class="num">${hasError ? 'نیازمند پیگیری' : 'سالم'}</div><div class="lbl">آخرین وضعیت</div></div>
        </div>
        <div class="section-box">
          <h2>عملیات</h2>
          <p class="hint">سفارش‌های جدید خودکار همگام می‌شوند و ثبت سفارش مشتری را معطل نمی‌کنند. همگام‌سازی اولیه فقط برای وارد کردن سفارش‌های قبلی وستو است.</p>
          <div class="row-actions" style="margin-top:0.9rem">
            <button class="btn btn-sm" id="neem-open">باز کردن پنل مالی و مشتریان</button>
            <button class="btn btn-sm btn-ghost" id="neem-retry">ارسال دوبارهٔ صف</button>
            <button class="btn btn-sm btn-ghost" id="neem-backfill">همگام‌سازی سفارش‌های قبلی</button>
          </div>
        </div>
        <div class="section-box">
          <h2>گزارش اتصال</h2>
          <div class="grid-2">
            <div><b>آخرین ارسال موفق</b><p class="hint">${sync.lastSuccessAt ? __westoViewContext.fmtDateTime(sync.lastSuccessAt) : 'هنوز ارسالی ثبت نشده است'}</p></div>
            <div><b>وضعیت سرویس</b><p class="hint ltr">${__westoViewContext.esc(sync.endpoint || '—')}</p></div>
          </div>
          ${hasError ? `<div class="ops-alert is-warn"><b>پیام اتصال</b><span>${__westoViewContext.esc(sync.lastError || sync.recentFailures?.[0]?.error || 'خطای نامشخص')}</span></div>` : '<p class="hint">همگام‌سازی بدون خطای ثبت‌شده است.</p>'}
        </div>`;

      document.getElementById('neem-open').addEventListener('click', () => { window.open('/ops', '_blank', 'noopener'); });
      document.getElementById('neem-retry').addEventListener('click', async () => {
        await __westoViewContext.api('/api/admin/neem-integration/retry', { method: 'POST' });
        __westoViewContext.showToast('ارسال دوبارهٔ صف شروع شد', 'success');
        setTimeout(() => __westoViewContext.tabs.neem().catch((error) => __westoViewContext.showToast(error.message)), 350);
      });
      document.getElementById('neem-backfill').addEventListener('click', async () => {
        if (!confirm('سفارش‌های قبلی وستو برای ساخت گزارش و حسابداری به سامانه بیرونی فرستاده شوند؟ این کار در پس‌زمینه انجام می‌شود.')) return;
        const result = await __westoViewContext.api('/api/admin/neem-integration/backfill', { method: 'POST' });
        __westoViewContext.showToast(`${__westoViewContext.fmtNum(result.queued || 0)} سفارش به صف همگام‌سازی اضافه شد`, 'success', 4200);
        __westoViewContext.tabs.neem();
      });
    }
}['neem'];
});
/*westo-view:end:neem*/

/*westo-view:start:salsa*/
window.WestoAdminModules.defineView('platform_core', 'salsa', function(__westoViewContext) {
return {
async salsa() {
      return this.neem();
    }
}['salsa'];
});
/*westo-view:end:salsa*/

/*westo-view:start:settings*/
window.WestoAdminModules.defineView('platform_core', 'settings', function(__westoViewContext) {
return {
async settings() {
      __westoViewContext.setActiveTab('settings');
      const [restaurantPayload, themePayload, usersPayload] = await Promise.all([
        __westoViewContext.api('/api/admin/restaurant'),
        __westoViewContext.api('/api/admin/theme'),
        __westoViewContext.api('/api/admin/users'),
      ]);
      const restaurant = restaurantPayload.restaurant || {};
      const theme = themePayload.theme || {};
      const branches = __westoViewContext.branchesCache || [];
      const activeBranches = branches.filter((branch) => branch.active !== false);
      const users = usersPayload.users || [];
      const contentKeys = Object.keys(__westoViewContext.state.content || {});
      const configuredContent = contentKeys.filter((key) => String(__westoViewContext.state.content[key] || '').trim()).length;
      const cards = [
        { icon: '⌂', title: 'هویت مجموعه', detail: restaurant.name || 'نام مجموعه ثبت نشده', meta: restaurant.phone ? `تلفن ${restaurant.phone}` : 'شماره تماس ثبت نشده', tab: 'restaurant', tone: 'cyan' },
        { icon: '◈', title: 'ظاهر و برند', detail: theme.accent ? `رنگ اصلی ${theme.accent}` : 'ظاهر هنوز تنظیم نشده', meta: theme.fontDisplay || 'قلم پیش‌فرض پنل', tab: 'theme', tone: 'violet' },
        { icon: '✦', title: 'محتوا و رسانه', detail: `${__westoViewContext.fmtNum(configuredContent)} مورد محتوای تنظیم‌شده`, meta: `${__westoViewContext.fmtNum(contentKeys.length)} کلید محتوایی · لوگو و الگو`, tab: 'content', secondaryTab: 'media', tone: 'orange' },
        { icon: '⌘', title: 'شعبه و ساعت کاری', detail: `${__westoViewContext.fmtNum(activeBranches.length)} شعبه فعال در سامانه`, meta: `${__westoViewContext.fmtNum(branches.length)} شعبه ثبت‌شده · بررسی ساعت کاری`, tab: 'branches', secondaryTab: 'hours', tone: 'green' },
        { icon: '◎', title: 'کارکنان و دسترسی‌ها', detail: `${__westoViewContext.fmtNum(users.length)} حساب کاربری`, meta: 'مدیریت پرسنل، نقش‌ها و مجوزهای سامانه', tab: 'users', tone: 'blue' },
        { icon: '?', title: 'سؤالات متداول', detail: 'مدیریت پاسخ‌های آمادهٔ سایت', meta: 'ویرایش و مرتب‌سازی پرسش‌ها', tab: 'faq', tone: 'slate' },
      ];
      __westoViewContext.main.innerHTML = `
        <section class="settings-dashboard" aria-labelledby="settings-dashboard-title">
          <header class="settings-dashboard__hero">
            <div>
              <p class="eyebrow">مرکز تنظیمات وستو</p>
              <h1 id="settings-dashboard-title">تنظیمات</h1>
              <p class="lead">همهٔ تنظیمات مجموعه، ظاهر سایت، محتوا و دسترسی‌ها را از یک نمای ساده مدیریت کنید.</p>
            </div>
            <div class="settings-dashboard__summary">
              <span class="settings-dashboard__status-dot" aria-hidden="true"></span>
              <div><strong>${__westoViewContext.esc(restaurant.name || 'مجموعه شما')}</strong><small>${__westoViewContext.fmtNum(activeBranches.length)} شعبه فعال · ${__westoViewContext.fmtNum(users.length)} کاربر</small></div>
            </div>
          </header>
          <div class="settings-dashboard__toolbar">
            <strong>دسترسی سریع به تنظیمات</strong>
            <span>هر کارت شما را به صفحهٔ تخصصی همان بخش می‌برد.</span>
          </div>
          <div class="settings-dashboard__grid">
            ${cards.map((card) => `<article class="settings-dashboard__card settings-dashboard__card--${__westoViewContext.esc(card.tone)}">
              <div class="settings-dashboard__card-top"><span class="settings-dashboard__icon" aria-hidden="true">${__westoViewContext.esc(card.icon)}</span><span class="settings-dashboard__arrow" aria-hidden="true">←</span></div>
              <div><h2>${__westoViewContext.esc(card.title)}</h2><p>${__westoViewContext.esc(card.detail)}</p><small>${__westoViewContext.esc(card.meta)}</small></div>
              <div class="settings-dashboard__actions"><button type="button" class="btn btn-sm" data-settings-tab="${__westoViewContext.esc(card.tab)}">باز کردن</button>${card.secondaryTab ? `<button type="button" class="btn btn-sm btn-ghost" data-settings-tab="${__westoViewContext.esc(card.secondaryTab)}">${card.secondaryTab === 'media' ? 'رسانه' : 'ساعت کاری'}</button>` : ''}</div>
            </article>`).join('')}
          </div>
          <section class="settings-dashboard__footer section-box">
            <div><h2>تنظیمات پیشنهادی</h2><p class="lead">برای شروع، هویت مجموعه و ظاهر برند را کامل کنید؛ بعد محتوای سایت و دسترسی کاربران را بررسی کنید.</p></div>
            <div class="settings-dashboard__steps"><span><b>۱</b> هویت مجموعه</span><span><b>۲</b> ظاهر برند</span><span><b>۳</b> محتوا و دسترسی</span></div>
          </section>
        </section>`;
      __westoViewContext.main.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => __westoViewContext.tabs[button.dataset.settingsTab]?.().catch((error) => __westoViewContext.showToast(error.message))));
    }
}['settings'];
});
/*westo-view:end:settings*/

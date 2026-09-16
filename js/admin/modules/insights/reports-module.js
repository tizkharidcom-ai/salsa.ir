/* WESTO Admin — visitor analytics and sales reports module. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  registry.register({
    id: 'insights',
    title: 'آمار و گزارش‌ها',
    version: '1.0.0',
    tabs: ['analytics', 'reports'],
    dependencies: ['core'],
    stateKeys: ['analytics', 'reports'],

    createTabs(context) {
      const { api, branchQs, currentBranch, esc, fmtMoney, fmtNum, fmtDateTime, financeWorkspaceHref, main, setActiveTab, sparkBars } = context;
      return {
        async analytics() {
          setActiveTab('analytics');
          const data = await api('/api/admin/analytics?days=7');
          const dayValues = Object.keys(data.byDay || {}).sort().map((key) => data.byDay[key]);
          main.innerHTML = `
            <h1>بازدید و آمار مهمانان</h1>
            <p class="lead">رهگیری بازدید صفحات منو — مشابه آمار بازدید در سامانه‌های منوی دیجیتال.</p>
            <div class="cards">
              <div class="card"><div class="num">${fmtNum(data.total)}</div><div class="lbl">بازدید ${fmtNum(data.days || 7)} روز</div></div>
              <div class="card"><div class="num">${fmtNum(data.sessions)}</div><div class="lbl">نشست یکتا</div></div>
              <div class="card"><div class="num">${fmtNum((data.topPaths || [])[0]?.count || 0)}</div><div class="lbl">بیشترین مسیر</div></div>
            </div>
            <div class="section-box">
              <h2>روند روزانه</h2>
              ${sparkBars(dayValues.length ? dayValues : [0], 64)}
            </div>
            <div class="grid-2-main">
              <div class="section-box">
                <h2>توزیع ساعتی</h2>
                ${sparkBars(data.byHour || Array(24).fill(0), 48)}
              </div>
              <div class="section-box">
                <h2>مسیرهای پربازدید</h2>
                <table class="tbl"><thead><tr><th>مسیر</th><th>بازدید</th></tr></thead><tbody>
                  ${(data.topPaths || []).map((path) => `<tr><td class="ltr">${esc(path.path)}</td><td>${fmtNum(path.count)}</td></tr>`).join('') || '<tr><td colspan="2">هنوز بازدیدی ثبت نشده — سایت را باز کنید</td></tr>'}
                </tbody></table>
              </div>
            </div>
            <div class="section-box">
              <h2>آخرین بازدیدها</h2>
              <table class="tbl"><thead><tr><th>زمان</th><th>مسیر</th><th>نشست</th></tr></thead><tbody>
                ${(data.recent || []).map((visit) => `<tr><td>${fmtDateTime(visit.at)}</td><td class="ltr">${esc(visit.path)}</td><td class="ltr">${esc(String(visit.sessionId || '').slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
              </tbody></table>
            </div>`;
        },

        async reports() {
          setActiveTab('reports');
          const stats = await api(`/api/admin/stats${branchQs()}`);
          main.innerHTML = `
            <div class="ops-page-head"><div><p class="eyebrow">گزارش عملیاتی فروش</p><h1>گزارش فروش</h1><p class="lead">فروش و رتبه‌بندی محصولات${currentBranch() ? ` برای شعبه ${esc(currentBranch().name)}` : ''}. برای تطبیق روش پرداخت، صندوق و دفتر مالی از حسابداری استفاده کنید.</p></div><a class="btn btn-sm btn-ghost" href="${financeWorkspaceHref('sales_bank')}">تطبیق با صندوق و دفتر مالی</a></div>
            <div class="cards">
              <div class="card accent"><div class="num">${fmtMoney(stats.revenue)}</div><div class="lbl">جمع کل فروش</div></div>
              <div class="card"><div class="num">${fmtMoney(stats.revenueWeek)}</div><div class="lbl">هفته جاری</div></div>
              <div class="card"><div class="num">${fmtNum(stats.orders)}</div><div class="lbl">تعداد سفارش</div></div>
            </div>
            <div class="section-box">
              <h2>رتبه‌بندی محصولات</h2>
              <table class="tbl"><thead><tr><th>#</th><th>نام</th><th>تعداد</th><th>درآمد</th><th>سهم</th></tr></thead><tbody>
                ${(stats.topItems || []).map((item, index) => {
                  const share = stats.revenue ? Math.round((item.revenue / stats.revenue) * 100) : 0;
                  return `<tr><td>${fmtNum(index + 1)}</td><td>${esc(item.name)}</td><td>${fmtNum(item.qty)}</td><td>${fmtMoney(item.revenue)}</td><td>${fmtNum(share)}٪</td></tr>`;
                }).join('') || '<tr><td colspan="5">داده‌ای نیست</td></tr>'}
              </tbody></table>
            </div>`;
        },
      };
    },
  });
})();

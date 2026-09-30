/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:costControl*/
window.WestoAdminModules.defineView('inventory', 'costControl', function(__westoViewContext) {
return {
async costControl() {
      __westoViewContext.setActiveTab('costControl');
      const d = await __westoViewContext.api(`/api/admin/v2/catalog${__westoViewContext.branchQs()}`);
      const cost = d.cost || {};
      const inventory = d.inventory || {};
      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">کنترل هزینه · نمای سریع عملیاتی</p><h1>کنترل هزینه و سودآوری</h1><p class="lead">فروش، بهای تمام‌شده و وضعیت انبار فقط از داده‌های ثبت‌شده وستو محاسبه می‌شوند؛ رقم نمایشی یا جایگزین وارد این صفحه نمی‌شود.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="${__westoViewContext.financeWorkspaceHref('costing')}">تحلیل رسمی در حسابداری</a><button class="btn btn-sm" id="cc-open-inventory">مدیریت موجودی فروش</button></div>
        </div>
        <div class="cards">
          <div class="card accent"><div class="num">${__westoViewContext.fmtMoney(cost.sales || 0)}</div><div class="lbl">فروش دوره</div></div>
          <div class="card warn"><div class="num">${__westoViewContext.fmtMoney(cost.estimatedCogs || 0)}</div><div class="lbl">بهای تمام‌شده ثبت‌شده</div></div>
          <div class="card"><div class="num">${__westoViewContext.fmtMoney(cost.estimatedProfit || 0)}</div><div class="lbl">سود ناخالص</div></div>
          <div class="card"><div class="num">${__westoViewContext.fmtNum(cost.grossMarginPct || 0)}٪</div><div class="lbl">حاشیه سود</div></div>
          <div class="card ${inventory.low ? 'warn' : ''}"><div class="num">${__westoViewContext.fmtNum(inventory.low || 0)}</div><div class="lbl">موجودی کم یا تمام‌شده</div></div>
        </div>
        <div class="grid-2-main">
          <section class="section-box">
            <h2>اقلام نیازمند اقدام</h2>
            <table class="tbl"><thead><tr><th>محصول</th><th>موجودی</th><th>وضعیت</th></tr></thead><tbody>
              ${(inventory.items || []).filter((item) => item.low || item.empty).slice(0, 30).map((item) => `<tr><td>${__westoViewContext.esc(item.name)}</td><td>${item.tracked ? __westoViewContext.fmtNum(item.stock) : 'نامحدود'}</td><td>${item.empty ? '<span class="pill blocked">تمام</span>' : '<span class="pill admin-pill-warn">کم</span>'}</td></tr>`).join('') || '<tr><td colspan="3">کمبود موجودی ثبت نشده است.</td></tr>'}
            </tbody></table>
          </section>
          <section class="section-box">
            <h2>دقت محاسبه هزینه</h2>
            <p class="hint">هزینه فقط برای محصولاتی محاسبه می‌شود که دستور تهیه یا هزینه واحد آن‌ها ثبت شده باشد. تا قبل از ثبت مواد اولیه، رقم ساختگی جایگزین نمی‌شود.</p>
            <div class="ops-alert ${cost.estimatedCogs ? '' : 'is-warn'}"><b>${cost.estimatedCogs ? 'محاسبه فعال است' : 'دستور تهیه نیاز است'}</b><span>${cost.estimatedCogs ? 'بهای تمام‌شده بر پایه هزینه‌های ثبت‌شده محاسبه شده است.' : 'برای محاسبه دقیق، مواد اولیه و هزینه واحد محصولات را ثبت کنید.'}</span></div>
          </section>
        </div>`;
      document.getElementById('cc-open-inventory').onclick = () => __westoViewContext.tabs.inventory().catch((error) => __westoViewContext.showToast(error.message));
    }
}['costControl'];
});
/*westo-view:end:costControl*/

/*westo-view:start:inventory*/
window.WestoAdminModules.defineView('inventory', 'inventory', function(__westoViewContext) {
return {
async inventory() {
      __westoViewContext.setActiveTab('inventory');
      const d = await __westoViewContext.api('/api/admin/inventory');
      const rank = (m) => m.empty ? 0 : m.low ? 1 : m.tracked ? 2 : 3;
      const all = (d.items || []).slice().sort((a, b) => rank(a) - rank(b) || String(a.category || '').localeCompare(String(b.category || ''), 'fa') || String(a.name || '').localeCompare(String(b.name || ''), 'fa'));
      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">موجودی قابل فروش منو</p><h1>موجودی فروش</h1><p class="lead">این صفحه دسترس‌پذیری اقلام منو را کنترل می‌کند. دریافت کالا، ضایعات، شمارش و دستور تهیه در پنل انبار ثبت می‌شوند و اثر مالی آن‌ها در حسابداری دیده می‌شود.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(__westoViewContext.currentBranchId || 1)}">عملیات واقعی انبار</a><a class="btn btn-sm btn-ghost" href="${__westoViewContext.financeWorkspaceHref('costing')}">اثر مالی و بهای تمام‌شده</a><span class="ops-provider-pill">${__westoViewContext.fmtNum(d.summary?.low || 0)} هشدار کمبود</span></div>
        </div>
        <div class="cards cards-dense">
          <button class="card admin-stat-button" data-inv-filter="tracked"><div class="num">${__westoViewContext.fmtNum(d.summary?.tracked || 0)}</div><div class="lbl">تحت ردیابی</div></button>
          <button class="card warn admin-stat-button" data-inv-filter="low"><div class="num">${__westoViewContext.fmtNum(d.summary?.low || 0)}</div><div class="lbl">موجودی کم</div></button>
          <button class="card admin-stat-button is-danger" data-inv-filter="empty"><div class="num">${__westoViewContext.fmtNum(d.summary?.empty || 0)}</div><div class="lbl">تمام‌شده</div></button>
          <button class="card admin-stat-button" data-inv-filter="unlimited"><div class="num">${__westoViewContext.fmtNum(d.summary?.unlimited || 0)}</div><div class="lbl">نامحدود</div></button>
        </div>
        <section class="section-box admin-help-strip" aria-label="راهنمای موجودی"><strong>روال پیشنهادی:</strong><span>اول «تمام‌شده» و «کم» را بررسی کنید؛ سپس شمارش واقعی را وارد کنید. +۱ و +۱۰ برای دریافت سریع کالا هستند.</span></section>
        <div class="section-box">
          <div class="ops-filters admin-filter-row">
            <label><span>جست‌وجو</span><input id="inv-search" type="search" placeholder="نام یا دسته…" /></label>
            <label><span>وضعیت</span><select id="inv-status"><option value="">همه</option><option value="empty">تمام‌شده</option><option value="low">کم</option><option value="tracked">تحت ردیابی</option><option value="unlimited">نامحدود</option></select></label>
            <span class="ops-filter-count" id="inv-count"></span>
          </div>
          <table class="tbl admin-dense-table"><thead><tr><th>نام</th><th>دسته</th><th>موجودی</th><th>آستانه</th><th>وضعیت</th><th>اقدام سریع</th></tr></thead>
          <tbody id="inv-body"></tbody></table>
        </div>`;

      const body = document.getElementById('inv-body');
      const statusKey = (m) => m.empty ? 'empty' : m.low ? 'low' : m.tracked ? 'tracked' : 'unlimited';
      const paint = () => {
        const q = String(document.getElementById('inv-search')?.value || '').trim().toLowerCase();
        const filter = document.getElementById('inv-status')?.value || '';
        const list = all.filter((m) => (!q || `${m.name} ${m.category}`.toLowerCase().includes(q)) && (!filter || statusKey(m) === filter));
        const count = document.getElementById('inv-count');
        if (count) count.textContent = `${__westoViewContext.fmtNum(list.length)} محصول`;
        body.innerHTML = list.map((m) => {
          const status = m.empty
            ? '<span class="pill blocked">تمام</span>'
            : m.low
              ? '<span class="pill admin-pill-warn">کم</span>'
              : m.tracked
                ? '<span class="pill ok">موجود</span>'
                : '<span class="pill">نامحدود</span>';
          return `<tr data-iid="${m.id}" data-istatus="${statusKey(m)}">
            <td><strong>${__westoViewContext.esc(m.name)}</strong></td><td>${__westoViewContext.esc(m.category)}</td>
            <td><input class="ltr-input inv-stock" aria-label="موجودی ${__westoViewContext.esc(m.name)}" dir="ltr" type="number" min="0" placeholder="∞" value="${m.tracked ? m.stock : ''}" /></td>
            <td><input class="ltr-input inv-low" aria-label="آستانه ${__westoViewContext.esc(m.name)}" dir="ltr" type="number" min="0" value="${m.lowStockAt}" /></td>
            <td>${status}${m.available ? '' : ' <span class="pill blocked">ناموجود در منو</span>'}</td>
            <td class="row-actions admin-inline-actions">
              <button class="btn btn-sm btn-ghost" data-idelta="${m.id}" data-delta="1">+۱</button>
              <button class="btn btn-sm btn-ghost" data-idelta="${m.id}" data-delta="10">+۱۰</button>
              <button class="btn btn-sm btn-ghost" data-iunlim="${m.id}">نامحدود</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="6">محصولی با این فیلتر پیدا نشد.</td></tr>';

        body.querySelectorAll('tr[data-iid]').forEach((tr) => {
          const id = Number(tr.dataset.iid);
          const saveInv = async () => {
            const raw = tr.querySelector('.inv-stock')?.value;
            const parsedStock = __westoViewContext.parseInputNumber(raw);
            const parsedLow = __westoViewContext.parseInputNumber(tr.querySelector('.inv-low')?.value);
            try {
              await __westoViewContext.api('/api/admin/inventory/adjust', {
                method: 'POST',
                body: JSON.stringify({
                  id,
                  mode: 'set',
                  stock: raw === '' ? null : (parsedStock ?? 0),
                  lowStockAt: parsedLow ?? 0,
                  restock: raw !== '' && (parsedStock ?? 0) > 0,
                }),
              });
              __westoViewContext.showToast('موجودی ذخیره شد', 'success', 1400);
            } catch (e) {
              __westoViewContext.showToast(e.message || 'خطا در ذخیره موجودی', 'error');
            }
          };
          const run = __westoViewContext.autosave(saveInv, { debounceMs: 350, silent: true });
          tr.querySelector('.inv-stock')?.addEventListener('change', run);
          tr.querySelector('.inv-stock')?.addEventListener('blur', run);
          tr.querySelector('.inv-low')?.addEventListener('change', run);
          tr.querySelector('.inv-low')?.addEventListener('blur', run);
        });
        body.querySelectorAll('[data-idelta]').forEach((b) => b.addEventListener('click', () => __westoViewContext.runBusy(b, async () => {
          await __westoViewContext.api('/api/admin/inventory/adjust', { method:'POST', body:JSON.stringify({ id:Number(b.dataset.idelta), delta:Number(b.dataset.delta), restock:true }) });
          await __westoViewContext.tabs.inventory();
        }, '…').catch((e) => __westoViewContext.showToast(e.message, 'error'))));
        body.querySelectorAll('[data-iunlim]').forEach((b) => b.addEventListener('click', () => __westoViewContext.runBusy(b, async () => {
          await __westoViewContext.api('/api/admin/inventory/adjust', { method:'POST', body:JSON.stringify({ id:Number(b.dataset.iunlim), mode:'unlimited', restock:true }) });
          await __westoViewContext.tabs.inventory();
        }, '…').catch((e) => __westoViewContext.showToast(e.message, 'error'))));
      };
      paint();
      document.getElementById('inv-search')?.addEventListener('input', paint);
      document.getElementById('inv-status')?.addEventListener('change', paint);
      __westoViewContext.main.querySelectorAll('[data-inv-filter]').forEach((b) => b.addEventListener('click', () => { document.getElementById('inv-status').value = b.dataset.invFilter; paint(); }));
    }
}['inventory'];
});
/*westo-view:end:inventory*/

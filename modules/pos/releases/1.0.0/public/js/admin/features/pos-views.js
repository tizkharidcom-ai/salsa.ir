/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:promotions*/
window.WestoAdminModules.defineView('pos', 'promotions', function(__westoViewContext) {
return {
async promotions() {
      __westoViewContext.setActiveTab('promotions');
      const d = await __westoViewContext.api('/api/admin/promotions');
      __westoViewContext.main.innerHTML = `
        <h1>تخفیف‌ها و پیشنهادهای فروش</h1>
        <p class="lead">کد تخفیف و پیشنهاد درصدی برای اعضای باشگاه مشتریان و فروش دوره‌ای.</p>
        <div class="section-box">
          <h2>پیشنهاد جدید</h2>
          <div class="grid-2">
            ${__westoViewContext.field('عنوان', 'pr_title', '')}
            ${__westoViewContext.field('درصد تخفیف', 'pr_pct', '10', { ltr: true, type: 'number' })}
            ${__westoViewContext.field('کد (اختیاری)', 'pr_code', '', { ltr: true })}
          </div>
          <button class="btn btn-sm" id="pr-add">ایجاد</button>
        </div>
        <div class="section-box">
          <table class="tbl"><thead><tr><th>عنوان</th><th>٪</th><th>کد</th><th>وضعیت</th><th></th></tr></thead><tbody>
            ${(d.promotions || [])
              .map(
                (p) => `<tr>
                  <td>${__westoViewContext.esc(p.title)}</td>
                  <td>${p.percent}٪</td>
                  <td class="ltr">${__westoViewContext.esc(p.code || '—')}</td>
                  <td>${p.active ? '<span class="pill ok">فعال</span>' : '<span class="pill">غیرفعال</span>'}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm btn-ghost" data-ptoggle="${p.id}" data-val="${!p.active}">${p.active ? 'غیرفعال' : 'فعال'}</button>
                    <button class="btn btn-sm btn-danger" data-pdel="${p.id}">حذف</button>
                  </td>
                </tr>`
              )
              .join('') || '<tr><td colspan="5">هنوز پیشنهادی ثبت نشده است</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('pr-add')?.addEventListener('click', async () => {
        const title = document.getElementById('pr_title')?.value.trim() || '';
        if (!title) return __westoViewContext.showToast('عنوان را وارد کنید', 'warn');
        try {
          await __westoViewContext.api('/api/admin/promotions', {
            method: 'POST',
            body: JSON.stringify({
              title,
              percent: __westoViewContext.parseInputNumber(document.getElementById('pr_pct')?.value) || 0,
              code: document.getElementById('pr_code')?.value || '',
            }),
          });
          __westoViewContext.showToast('پیشنهاد فروش ایجاد شد', 'success');
          __westoViewContext.tabs.promotions();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ایجاد پیشنهاد فروش', 'error');
        }
      });
      __westoViewContext.main.querySelectorAll('[data-ptoggle]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            await __westoViewContext.api(`/api/admin/promotions/${b.dataset.ptoggle}`, {
              method: 'PATCH',
              body: JSON.stringify({ active: b.dataset.val === 'true' }),
            });
            __westoViewContext.tabs.promotions();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در تغییر وضعیت پیشنهاد', 'error');
          }
        })
      );
      __westoViewContext.main.querySelectorAll('[data-pdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('حذف شود؟')) return;
          try {
            await __westoViewContext.api(`/api/admin/promotions/${b.dataset.pdel}`, { method: 'DELETE' });
            __westoViewContext.tabs.promotions();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در حذف پیشنهاد', 'error');
          }
        })
      );
    }
}['promotions'];
});
/*westo-view:end:promotions*/

/*westo-view:start:orders*/
window.WestoAdminModules.defineView('pos', 'orders', function(__westoViewContext) {
return {
async orders() {
      __westoViewContext.setActiveTab('orders');
      const d = await __westoViewContext.api(`/api/admin/orders${__westoViewContext.branchQs()}`);
      const orders = (d.orders || []).slice();
      const canManageDelivery = __westoViewContext.hasCapability('delivery.manage');
      const active = orders.filter((o)=>!__westoViewContext.TERMINAL_ORDER_STATUSES.has(String(o.status)));
      const lateCount = active.filter((o)=>__westoViewContext.orderAgeMinutes(o)>=20).length;
      const readyCount = active.filter((o)=>o.status==='ready').length;
      const paymentPending = orders.filter((o)=>['pending','unpaid','partial','failed','unknown'].includes(String(o.paymentStatus||'')) || ['pending_online','pay_at_cashier'].includes(o.status)).length;
      const paymentReviewCount = orders.filter((o)=>String(o.paymentStatus||'')==='unknown').length;
      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">کنترل سفارش</p><h1>سفارش‌ها</h1><p class="lead">سفارش‌های باز قبل از آرشیو و قدیمی‌ترین موارد باز زودتر نمایش داده می‌شوند. دکمه اصلی فقط مرحله مجاز بعدی را اجرا می‌کند.</p></div><div class="row-actions"><button class="btn btn-sm btn-ghost" id="order-history-toggle" type="button" aria-expanded="false" aria-controls="closed-order-history">سابقه سفارش‌های بسته</button><a class="btn btn-sm btn-ghost" href="${__westoViewContext.financeWorkspaceHref('sales_bank')}">کنترل مالی فروش</a><a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">باز کردن ثبت سفارش</a></div></div>
        <div class="cards cards-dense">
          <div class="card"><div class="num">${__westoViewContext.fmtNum(active.length)}</div><div class="lbl">باز / نیازمند پیگیری</div></div>
          <div class="card ${lateCount?'is-danger':''}"><div class="num">${__westoViewContext.fmtNum(lateCount)}</div><div class="lbl">در مرحله بیش از ۲۰ دقیقه</div></div>
          <div class="card accent"><div class="num">${__westoViewContext.fmtNum(readyCount)}</div><div class="lbl">آماده تحویل</div></div>
          <div class="card ${paymentPending?'warn':''}"><div class="num">${__westoViewContext.fmtNum(paymentPending)}</div><div class="lbl">پرداخت نیازمند توجه</div></div>
        </div>
        ${paymentReviewCount?`<section class="section-box" role="alert"><strong>${__westoViewContext.fmtNum(paymentReviewCount)} سفارش با سابقهٔ پرداخت نامشخص</strong><p>برای جلوگیری از دریافت دوباره، پیش از تسویه این سفارش‌ها را با سوابق صندوق و بانک تطبیق دهید.</p></section>`:''}
        <section class="admin-help-strip section-box"><strong>برای کاربر تازه‌کار:</strong><span>روی دکمه پررنگ هر کارت بزنید تا سفارش فقط یک مرحله مجاز جلو برود. منوی کشویی برای حالت‌های خاص و لغو است.</span></section>
        <section class="section-box ops-filters admin-filter-row">
          <label><span>جست‌وجو</span><input id="order-search" type="search" autocomplete="off" placeholder="شماره، نام، تلفن یا غذا…" /></label>
          <label><span>وضعیت</span><select id="order-status-filter"><option value="">همه</option>${['pending_online','awaiting_confirmation','pay_at_cashier','paid','preparing','ready','dispatched','picked_up','delivered','done','cancelled'].map((status)=>`<option value="${status}">${__westoViewContext.statusLabel(status)}</option>`).join('')}</select></label>
          <label><span>نوع تحویل</span><select id="order-fulfillment-filter"><option value="">همه</option><option value="dine_in">داخل مجموعه</option><option value="pickup">تحویل حضوری</option><option value="delivery">پیک</option></select></label>
          <label><span>پرداخت</span><select id="order-payment-filter"><option value="">همه</option><option value="paid">پرداخت‌شده</option><option value="partial">پرداخت ناقص</option><option value="pending">در انتظار</option><option value="unpaid">پرداخت‌نشده</option><option value="failed">ناموفق</option><option value="unknown">نامشخص · تطبیق لازم</option></select></label>
          <span class="ops-filter-count" id="order-filter-count">${__westoViewContext.fmtNum(orders.length)} سفارش</span>
        </section>
        <section class="ops-order-grid" id="ops-order-grid">
          ${orders.map((order)=>{
            const search=[order.id,order.orderNo,order.name,order.phone,order.tableNo,...(order.items||[]).map((i)=>i.name)].join(' ').toLowerCase();
            const history=(order.statusHistory||[]).slice().reverse();
            const payment=String(order.paymentStatus||'unknown');
            const paymentLabel={paid:'پرداخت‌شده',partial:'پرداخت ناقص',pending:'در انتظار پرداخت',unpaid:'پرداخت‌نشده',failed:'ناموفق',cancelled:'لغو شده',refunded:'بازپرداخت',unknown:'وضعیت پرداخت نامشخص · بررسی لازم'}[payment]||'وضعیت پرداخت نامشخص · بررسی لازم';
            const needsCashierSettlement=['unpaid','partial'].includes(payment)&&order.status!=='pending_online';
            const amountDue=Math.max(0,Number(order.balanceDue??(Number(order.total||0)-Number(order.amountPaid||0)))||0);
            const fulfillment=order.fulfillment||(order.tableNo?'dine_in':'pickup');
            const urgency=__westoViewContext.orderUrgency(order); const next=__westoViewContext.primaryNextStatus(order);
            const acceptanceView=__westoViewContext.adminDeliveryAcceptanceView(order,canManageDelivery);
            const deliveryStep=__westoViewContext.adminDeliveryNextStep(order);
            const deliveryStepMarkup=deliveryStep?`<aside class="delivery-ops-step delivery-ops-step--${__westoViewContext.esc(deliveryStep.key)}" data-delivery-step="${__westoViewContext.esc(deliveryStep.key)}" aria-label="گام جاری ارسال"><strong>${__westoViewContext.esc(deliveryStep.label)}</strong><span>${__westoViewContext.esc(deliveryStep.detail)}</span></aside>`:'';
            const orderBranchId=order.branchId??__westoViewContext.currentBranchId;
            const orderBranch=__westoViewContext.branchesCache.find((branch)=>String(branch.id)===String(orderBranchId));
            const deliveryBranchContext=orderBranch?.name|| (orderBranchId?`شعبه ${__westoViewContext.fmtNum(orderBranchId)}`:'شعبه نامشخص');
            const deliveryOrderContext=`#${order.id}${order.orderNo?` · ${order.orderNo}`:''}`;
            const acceptanceMarkup=acceptanceView?`<section class="delivery-acceptance delivery-acceptance--${__westoViewContext.esc(acceptanceView.status)}" aria-label="پذیرش رستوران" data-delivery-acceptance>
              <div class="delivery-acceptance__head"><b>پذیرش رستوران</b><span class="delivery-acceptance__badge">${__westoViewContext.esc(acceptanceView.badge)}</span></div>
              <div class="delivery-acceptance__context"><span>شعبه: ${__westoViewContext.esc(deliveryBranchContext)}</span><span>سفارش: ${__westoViewContext.esc(deliveryOrderContext)}</span></div>
              <p>${__westoViewContext.esc(acceptanceView.detail)}</p>
              <div class="delivery-acceptance__feedback" data-delivery-acceptance-feedback role="status" aria-live="polite" hidden></div>
              ${acceptanceView.canAccept?`<div class="row-actions delivery-acceptance__actions"><button type="button" class="btn admin-primary-action delivery-acceptance__action" data-delivery-accept="${__westoViewContext.esc(order.id)}" aria-label="پذیرش سفارش ارسال ${__westoViewContext.esc(order.orderNo||order.id)} و ارسال به آشپزخانه">پذیرش و ارسال به آشپزخانه</button><button type="button" class="btn btn-danger delivery-acceptance__reject-open" data-delivery-reject-open="${__westoViewContext.esc(order.id)}" aria-expanded="false" aria-controls="delivery-reject-form-${__westoViewContext.esc(order.id)}">رد سفارش</button></div>
                <form class="delivery-acceptance__reject-form" id="delivery-reject-form-${__westoViewContext.esc(order.id)}" data-delivery-reject-form="${__westoViewContext.esc(order.id)}" hidden novalidate>
                  <div class="field"><label for="delivery-reject-reason-${__westoViewContext.esc(order.id)}">علت رد پذیرش ارسال <span aria-hidden="true">(الزامی)</span></label><textarea id="delivery-reject-reason-${__westoViewContext.esc(order.id)}" data-delivery-reject-reason rows="3" maxlength="500" required aria-required="true" aria-describedby="delivery-reject-help-${__westoViewContext.esc(order.id)}" placeholder="مثلاً محدودهٔ ارسال پوشش داده نمی‌شود"></textarea></div>
                  <p class="hint" id="delivery-reject-help-${__westoViewContext.esc(order.id)}">این تصمیم فقط پذیرش ارسال را ثبت می‌کند؛ وضعیت پرداخت بدون تغییر می‌ماند.</p>
                  <div class="row-actions"><button type="submit" class="btn btn-danger" data-delivery-reject-submit="${__westoViewContext.esc(order.id)}">ثبت رد سفارش</button><button type="button" class="btn btn-ghost" data-delivery-reject-cancel="${__westoViewContext.esc(order.id)}">انصراف</button></div>
                </form>`:''}
            </section>`:'';
            return `<article class="ops-order-card${urgency.className}" data-order-card="${order.id}" data-search="${__westoViewContext.esc(search)}" data-status="${__westoViewContext.esc(order.status)}" data-fulfillment="${__westoViewContext.esc(fulfillment)}" data-payment="${__westoViewContext.esc(payment)}">
              <header class="ops-order-card__head"><div><p>#${order.id}${order.orderNo?` · ${__westoViewContext.esc(order.orderNo)}`:''}</p><h2>${__westoViewContext.esc(order.name||'مهمان')}</h2><span>${__westoViewContext.esc(__westoViewContext.fulfillmentLabel(fulfillment))}${order.tableNo?` · میز ${__westoViewContext.esc(order.tableNo)}`:''}</span></div><div class="admin-order-state"><span class="ops-status ops-status--${__westoViewContext.esc(order.status)}">${__westoViewContext.esc(__westoViewContext.adminOrderStatusLabel(order))}</span><small class="admin-age-badge">${__westoViewContext.esc(urgency.label)}</small></div></header>
              <div class="ops-order-card__meta"><span>${__westoViewContext.fmtMoney(order.total)}</span><span>${__westoViewContext.esc(paymentLabel)}</span><span>${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateTime(order.createdAt) : new Date(order.createdAt).toLocaleString('fa-IR')}</span></div>
              ${deliveryStepMarkup}
              ${order.note?`<div class="admin-order-note"><b>یادداشت:</b> ${__westoViewContext.esc(order.note)}</div>`:''}
              <ul class="ops-order-items">${(order.items||[]).map((item)=>`<li><b>${__westoViewContext.fmtNum(item.qty)}×</b><span>${__westoViewContext.esc(item.name)}</span><em>${__westoViewContext.fmtMoney(item.lineTotal)}</em></li>`).join('')}</ul>
              ${acceptanceMarkup}
              <details class="ops-order-detail"><summary>جزئیات و تاریخچه</summary><div class="ops-order-detail__content"><p><b>تماس:</b> <span dir="ltr">${__westoViewContext.esc(order.phone||'—')}</span></p>${order.delivery?`<p><b>ارسال:</b> ${__westoViewContext.esc(order.delivery.zoneName||'')} · ${__westoViewContext.esc(order.delivery.address||'')}</p>`:''}<ol>${history.map((e)=>`<li>${__westoViewContext.esc(__westoViewContext.statusLabel(e.status))}<time>${e.at?(window.ShamsiCore ? window.ShamsiCore.formatShamsiDateTime(e.at) : new Date(e.at).toLocaleString('fa-IR')):''}</time></li>`).join('')||'<li>تاریخچه‌ای ثبت نشده است</li>'}</ol></div></details>
              <footer class="ops-order-card__actions">${next?`<button class="btn admin-primary-action" data-onext="${order.id}" data-next-status="${next}">${__westoViewContext.esc(__westoViewContext.primaryActionLabel(next))}</button>`:''}${needsCashierSettlement?`<a class="btn" href="/admin/cashier?view=orders&amp;focusOrder=${encodeURIComponent(order.id)}">تسویه در صندوق · ${__westoViewContext.fmtMoney(amountDue)}</a>`:''}<label class="admin-secondary-select"><span>تغییر دستی وضعیت</span><select data-ostatus="${order.id}" ${__westoViewContext.nextStatusesForOrder(order).length<=1?'disabled':''}>${__westoViewContext.nextStatusesForOrder(order).map((status)=>`<option value="${status}" ${order.status===status?'selected':''}>${__westoViewContext.statusLabel(status)}</option>`).join('')}</select></label>${order.cancellationBlocked?.message?`<small class="admin-cancel-blocked" role="note">${__westoViewContext.esc(order.cancellationBlocked.message)}</small>`:''}</footer>
            </article>`;
          }).join('')||'<p class="ops-empty">سفارشی ثبت نشده است.</p>'}
        </section>`;

      __westoViewContext.main.insertAdjacentHTML('beforeend', `
        <section class="section-box order-history-panel" id="closed-order-history" aria-labelledby="order-history-title" hidden>
          <header class="order-history-panel__head"><div><p class="eyebrow">فقط‌خواندنی</p><h2 id="order-history-title">سابقه سفارش‌های بسته</h2></div><span id="order-history-coverage" class="order-history-coverage"></span></header>
          <p id="order-history-warning" class="order-history-warning" role="note" hidden></p>
          <p id="order-history-status" class="order-history-status" role="status" aria-live="polite">برای دیدن سفارش‌های بسته، سابقه را باز کنید.</p>
          <button class="btn btn-sm" id="order-history-retry" type="button" hidden>تلاش دوباره</button>
          <div class="order-history-list" id="order-history-list"></div>
          <button class="btn order-history-more" id="order-history-more" type="button" hidden>سفارش‌های قدیمی‌تر</button>
        </section>`);

      let historyCursor = null;
      let historyLoaded = false;
      let historyLoading = false;
      const historyToggle = document.getElementById('order-history-toggle');
      const historyPanel = document.getElementById('closed-order-history');
      const historyStatus = document.getElementById('order-history-status');
      const historyList = document.getElementById('order-history-list');
      const historyWarning = document.getElementById('order-history-warning');
      const historyCoverage = document.getElementById('order-history-coverage');
      const historyRetry = document.getElementById('order-history-retry');
      const historyMore = document.getElementById('order-history-more');
      const loadOrderHistory = async ({ append = false } = {}) => {
        if (historyLoading) return;
        historyLoading = true;
        historyRetry.hidden = true;
        historyMore.disabled = true;
        historyStatus.textContent = append ? 'در حال دریافت سفارش‌های قدیمی‌تر…' : 'در حال دریافت سابقه…';
        try {
          const query = { history: 'closed', limit: '30' };
          if (append && historyCursor) query.cursor = historyCursor;
          const data = await __westoViewContext.api(`/api/admin/orders${__westoViewContext.branchQs(query)}`);
          const page = Array.isArray(data.orders) ? data.orders : [];
          const cards = page.map((order) => {
            const status = String(order.status || '');
            const payment = String(order.paymentStatus || 'unknown');
            const paymentLabel = ({ paid: 'پرداخت‌شده', partial: 'پرداخت ناقص', pending: 'در انتظار پرداخت', unpaid: 'پرداخت‌نشده', failed: 'ناموفق', refunded: 'بازپرداخت', unknown: 'وضعیت پرداخت نامشخص' })[payment] || 'وضعیت پرداخت نامشخص';
            const createdAt = order.createdAt && Number.isFinite(new Date(order.createdAt).getTime())
              ? (window.ShamsiCore ? window.ShamsiCore.formatShamsiDateTime(order.createdAt) : new Date(order.createdAt).toLocaleString('fa-IR'))
              : 'زمان نامشخص';
            const amount = Number.isFinite(Number(order.total)) ? __westoViewContext.fmtMoney(order.total) : 'مبلغ نامشخص';
            const fulfillment = order.fulfillment || (order.tableNo ? 'dine_in' : 'pickup');
            const itemRows = (Array.isArray(order.items) ? order.items : []).map((item) => `<li><span>${__westoViewContext.fmtNum(item.qty || 1)}× ${__westoViewContext.esc(item.name || 'قلم سفارش')}</span><b>${Number.isFinite(Number(item.lineTotal)) ? __westoViewContext.fmtMoney(item.lineTotal) : ''}</b></li>`).join('');
            const orderRef = order.orderNo ? ` · ${__westoViewContext.esc(order.orderNo)}` : '';
            return `<article class="order-history-card"><header><div><strong>#${__westoViewContext.esc(order.id)}${orderRef}</strong><span class="ops-status ops-status--${__westoViewContext.esc(status)}">${__westoViewContext.esc(__westoViewContext.statusLabel(status))}</span></div><time>${__westoViewContext.esc(createdAt)}</time></header><div class="order-history-card__meta"><strong>${__westoViewContext.esc(amount)}</strong><span>${__westoViewContext.esc(paymentLabel)}</span><span>${__westoViewContext.esc(__westoViewContext.fulfillmentLabel(fulfillment))}${order.tableNo ? ` · میز ${__westoViewContext.esc(order.tableNo)}` : ''}</span></div><details><summary>اقلام سفارش ${__westoViewContext.fmtNum(Array.isArray(order.items) ? order.items.length : 0)}</summary>${itemRows ? `<ul>${itemRows}</ul>` : '<p>جزئیات اقلام در سابقهٔ ذخیره‌شده موجود نیست.</p>'}</details></article>`;
          }).join('');
          if (!append) historyList.innerHTML = '';
          if (cards) historyList.insertAdjacentHTML('beforeend', cards);
          if (!historyList.children.length) historyList.innerHTML = '<p class="ops-empty">سفارش بسته‌ای در سابقهٔ قابل‌دسترسی پیدا نشد.</p>';
          historyCursor = data.nextCursor || null;
          historyMore.hidden = data.hasMore !== true || !historyCursor;
          historyMore.disabled = false;
          historyLoaded = true;
          historyCoverage.textContent = data.source === 'postgres' ? 'آرشیو پایدار · پوشش تاریخی تأییدنشده' : 'حافظهٔ اخیر · سابقه ناقص';
          historyWarning.textContent = data.warning || 'کامل بودن سابقهٔ قدیمی‌تر هنوز تأیید نشده است.';
          historyWarning.hidden = data.complete === true;
          historyStatus.textContent = data.hasMore ? `${__westoViewContext.fmtNum(page.length)} سفارش دریافت شد؛ برای موارد قدیمی‌تر ادامه دهید.` : `${__westoViewContext.fmtNum(page.length)} سفارش در این صفحه دریافت شد.`;
        } catch (error) {
          historyStatus.textContent = error.message || 'دریافت سابقه ناموفق بود.';
          historyRetry.hidden = false;
          historyMore.disabled = false;
        } finally {
          historyLoading = false;
        }
      };
      historyToggle.addEventListener('click', async () => {
        const opening = historyPanel.hidden;
        historyPanel.hidden = !opening;
        historyToggle.setAttribute('aria-expanded', String(opening));
        historyToggle.textContent = opening ? 'بستن سابقه سفارش‌ها' : 'سابقه سفارش‌های بسته';
        if (opening && !historyLoaded) await loadOrderHistory();
      });
      historyRetry.addEventListener('click', () => loadOrderHistory());
      historyMore.addEventListener('click', () => loadOrderHistory({ append: true }));

      const filterOrders=()=>{ const q=String(document.getElementById('order-search')?.value||'').trim().toLowerCase(), status=document.getElementById('order-status-filter')?.value||'', fulfillment=document.getElementById('order-fulfillment-filter')?.value||'', payment=document.getElementById('order-payment-filter')?.value||''; let count=0; __westoViewContext.main.querySelectorAll('[data-order-card]').forEach((card)=>{const ok=(!q||card.dataset.search.includes(q))&&(!status||card.dataset.status===status)&&(!fulfillment||card.dataset.fulfillment===fulfillment)&&(!payment||card.dataset.payment===payment);card.hidden=!ok;if(ok)count++;}); const el=document.getElementById('order-filter-count');if(el)el.textContent=`${__westoViewContext.fmtNum(count)} سفارش`; };
      ['order-search','order-status-filter','order-fulfillment-filter','order-payment-filter'].forEach((id)=>document.getElementById(id)?.addEventListener(id==='order-search'?'input':'change',filterOrders));
      const changeStatus=async(id,status)=>__westoViewContext.api(`/api/v2/orders/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});
      const setAcceptanceFeedback=(orderId,message,{error=false,disableAction=false}={})=>{
        const card=__westoViewContext.main.querySelector(`[data-order-card="${CSS.escape(String(orderId))}"]`);
        const feedback=card?.querySelector('[data-delivery-acceptance-feedback]');
        if(feedback){
          feedback.hidden=false;
          feedback.setAttribute('role',error?'alert':'status');
          feedback.replaceChildren(document.createTextNode(message));
          if(disableAction){
            const check=document.createElement('button');
            check.type='button';
            check.className='btn btn-sm delivery-acceptance__check';
            check.dataset.deliveryAcceptCheck=String(orderId);
            check.textContent='بررسی وضعیت از سرور';
            check.addEventListener('click',()=>__westoViewContext.runBusy(check,()=>checkDeliveryAcceptanceStatus(check),'در حال بررسی…').catch((checkError)=>__westoViewContext.showToast(checkError.message,'error')));
            feedback.appendChild(check);
          }
        }
        if(disableAction){card?.querySelectorAll('[data-delivery-accept],[data-delivery-reject-open],[data-delivery-reject-submit],[data-delivery-reject-cancel],[data-delivery-reject-reason]').forEach((action)=>{action.disabled=true;});}
      };
      const checkDeliveryAcceptanceStatus=async(button)=>{
        const orderId=button.dataset.deliveryAcceptCheck;
        const freshOrders=await __westoViewContext.tabs.orders();
        const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
        const status=String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase();
        if(status==='accepted'){
          __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(`westo:delivery-accept:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
          __westoViewContext.clearAdminDeliveryRejectionIntent(`westo:delivery-reject:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
          __westoViewContext.showToast('پذیرش رستوران از سرور تأیید شد.','success',1800);
          return;
        }
        if(status==='rejected'){
          __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(`westo:delivery-accept:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
          __westoViewContext.clearAdminDeliveryRejectionIntent(`westo:delivery-reject:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
          __westoViewContext.showToast('رد سفارش ارسال از سرور تأیید شد.','success',1800);
          return;
        }
        if(['pending','unrecorded'].includes(status)){
          __westoViewContext.clearAdminDeliveryRejectionIntent(`westo:delivery-reject:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
          setAcceptanceFeedback(orderId,'سرور هنوز تصمیمی برای این سفارش ثبت نکرده است؛ پس از بررسی می‌توانید دوباره اقدام کنید.',{error:true});
          return;
        }
        setAcceptanceFeedback(orderId,'وضعیت پذیرش هنوز از پاسخ سفارش قابل تأیید نیست؛ اقدام تکراری متوقف می‌ماند.',{error:true,disableAction:true});
      };
      __westoViewContext.main.querySelectorAll('[data-delivery-accept]').forEach((button)=>button.addEventListener('click',()=>{
        let keepDisabled=false;
        const decisionPanel=button.closest('[data-delivery-acceptance]');
        decisionPanel?.setAttribute('aria-busy','true');
        const rejectionControls=decisionPanel?.querySelectorAll('[data-delivery-reject-open],[data-delivery-reject-submit],[data-delivery-reject-cancel]')||[];
        rejectionControls.forEach((control)=>{control.disabled=true;});
        __westoViewContext.runBusy(button,async()=>{
        const orderId=button.dataset.deliveryAccept;
        const acceptanceKey=__westoViewContext.adminDeliveryAcceptanceIdempotencyKey(orderId);
        const feedback=button.closest('[data-order-card]')?.querySelector('[data-delivery-acceptance-feedback]');
        if(feedback){feedback.hidden=false;feedback.textContent='در حال ثبت پذیرش رستوران و دریافت نتیجه از سرور…';}
        let response;
        try{
          response=await __westoViewContext.api(`/api/delivery/orders/${encodeURIComponent(orderId)}/accept${__westoViewContext.branchQs()}`,{
            method:'POST',
            headers:{'Idempotency-Key':acceptanceKey.key},
            body:JSON.stringify({}),
          });
        }catch(error){
          try{
            const freshOrders=await __westoViewContext.tabs.orders();
            const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
            const status=String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase();
            if(status==='accepted'){
              __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(acceptanceKey.storageKey);
              __westoViewContext.showToast('پذیرش از وضعیت تازهٔ سرور تأیید شد.','success',1800);
              return;
            }
            if(!['pending','unrecorded'].includes(status)){
              keepDisabled=true;
              setAcceptanceFeedback(orderId,'نتیجهٔ درخواست نامشخص است و وضعیت تازهٔ پذیرش هم از سرور دریافت نشد؛ برای جلوگیری از درخواست تکراری، دوباره ارسال نکنید و ابتدا وضعیت را بررسی کنید.',{error:true,disableAction:true});
              return;
            }
            setAcceptanceFeedback(orderId,`${error.message||'ثبت پذیرش ناموفق بود.'} وضعیت تازه هنوز پذیرش‌نشده است؛ می‌توانید پس از بررسی دوباره تلاش کنید.`,{error:true});
          }catch(refreshError){
            keepDisabled=true;
            setAcceptanceFeedback(orderId,'پاسخ پذیرش نامشخص است و تازه‌سازی سفارش هم ناموفق بود؛ برای جلوگیری از تکرار، دکمه موقتاً غیرفعال شد. ابتدا اتصال را برقرار و وضعیت سفارش را بررسی کنید.',{error:true,disableAction:true});
          }
          __westoViewContext.showToast(error.message||'ثبت پذیرش ناموفق بود.','error');
          return;
        }

        const responseOrder=response?.order;
        const responseAccepted=String(responseOrder?.deliveryAcceptance?.status||'').trim().toLowerCase()==='accepted'
          && String(responseOrder?.id)===String(orderId);
        if(!responseAccepted){
          try{
            const freshOrders=await __westoViewContext.tabs.orders();
            const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
            if(String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase()==='accepted'){
              __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(acceptanceKey.storageKey);
              __westoViewContext.showToast('پذیرش از وضعیت تازهٔ سرور تأیید شد.','success',1800);
              return;
            }
            const status=String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase();
            if(!['pending','unrecorded'].includes(status)){
              keepDisabled=true;
              setAcceptanceFeedback(orderId,'پاسخ پذیرش نامعتبر بود و وضعیت تازه هنوز روشن نیست؛ برای جلوگیری از تکرار، اقدام متوقف شد.',{error:true,disableAction:true});
              return;
            }
          }catch(refreshError){
            keepDisabled=true;
            setAcceptanceFeedback(orderId,'سرور پذیرش را تأیید نکرد و تازه‌سازی سفارش هم ناموفق بود؛ وضعیت را پیش از هر تلاش دوباره بررسی کنید.',{error:true,disableAction:true});
            return;
          }
          setAcceptanceFeedback(orderId,'پاسخ سرور پذیرش را تأیید نکرد؛ وضعیت سفارش تازه شد. اگر هنوز پذیرش‌نشده است، پس از بررسی دوباره تلاش کنید.',{error:true});
          return;
        }

        try{
          const freshOrders=await __westoViewContext.tabs.orders();
          const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
          if(String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase()==='accepted'){
            __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(acceptanceKey.storageKey);
            __westoViewContext.showToast('پذیرش رستوران ثبت و سفارش از سرور تازه‌سازی شد.','success',1800);
            return;
          }
          keepDisabled=true;
          setAcceptanceFeedback(orderId,'پاسخ ثبت پذیرش موفق بود، اما فهرست تازه هنوز آن را تأیید نمی‌کند؛ اقدام دوباره متوقف شد تا وضعیت با سرور تطبیق داده شود.',{error:true,disableAction:true});
        }catch(refreshError){
          keepDisabled=true;
          setAcceptanceFeedback(orderId,'پذیرش در پاسخ سرور تأیید شد، اما تازه‌سازی فهرست ناموفق بود؛ برای جلوگیری از ارسال دوباره، دکمه غیرفعال شد. صفحه را پس از اتصال تازه‌سازی کنید.',{error:true,disableAction:true});
        }
        },'در حال پذیرش…').catch((error)=>__westoViewContext.showToast(error.message,'error')).finally(()=>{
          decisionPanel?.removeAttribute('aria-busy');
          if(!keepDisabled)rejectionControls.forEach((control)=>{control.disabled=false;});
          if(keepDisabled){
            const currentCard=__westoViewContext.main.querySelector(`[data-order-card="${CSS.escape(String(button.dataset.deliveryAccept))}"]`);
            currentCard?.querySelectorAll('[data-delivery-accept],[data-delivery-reject-open],[data-delivery-reject-submit]').forEach((action)=>{action.disabled=true;});
          }
        });
      }));
      __westoViewContext.main.querySelectorAll('[data-delivery-reject-open]').forEach((button)=>button.addEventListener('click',()=>{
        const panel=button.closest('[data-delivery-acceptance]');
        const form=panel?.querySelector('[data-delivery-reject-form]');
        const reason=form?.querySelector('[data-delivery-reject-reason]');
        if(!form||button.disabled)return;
        form.hidden=false;
        button.setAttribute('aria-expanded','true');
        reason?.focus();
      }));
      __westoViewContext.main.querySelectorAll('[data-delivery-reject-cancel]').forEach((button)=>button.addEventListener('click',()=>{
        const panel=button.closest('[data-delivery-acceptance]');
        const form=button.closest('[data-delivery-reject-form]');
        const opener=panel?.querySelector('[data-delivery-reject-open]');
        if(form){form.reset();form.hidden=true;}
        opener?.setAttribute('aria-expanded','false');
        opener?.focus();
      }));
      __westoViewContext.main.querySelectorAll('[data-delivery-reject-form]').forEach((form)=>form.addEventListener('submit',async(event)=>{
        event.preventDefault();
        const submit=form.querySelector('[data-delivery-reject-submit]');
        if(!submit||submit.dataset.busy==='1')return;
        const orderId=form.dataset.deliveryRejectForm;
        const panel=form.closest('[data-delivery-acceptance]');
        const card=form.closest('[data-order-card]');
        const reasonField=form.querySelector('[data-delivery-reject-reason]');
        const feedback=panel?.querySelector('[data-delivery-acceptance-feedback]');
        const payload=__westoViewContext.adminDeliveryRejectionPayload(reasonField?.value);
        if(!payload){
          reasonField?.setCustomValidity(__westoViewContext.adminDeliveryRejectionValidationMessage(reasonField?.value));
          reasonField?.reportValidity();
          return;
        }
        const rejectionIntent=__westoViewContext.adminDeliveryRejectionIntent(orderId,payload.reason);
        if(!rejectionIntent.ok){
          const message=rejectionIntent.needsStatusCheck
            ? 'از تلاش قبلی نتیجهٔ قطعی نداریم. ابتدا وضعیت سفارش را از سرور بررسی کنید؛ هنوز درخواست تازه‌ای ارسال نشده است.'
            : rejectionIntent.reasonConflict
              ? 'متن علت با تلاش قبلی یکسان نیست. ابتدا وضعیت سرور را بررسی کنید تا تصمیم تکراری یا متناقض ثبت نشود.'
              : 'ذخیرهٔ امن شناسهٔ درخواست در این مرورگر ممکن نیست؛ برای جلوگیری از رد تکراری، درخواست ارسال نشد.';
          setAcceptanceFeedback(orderId,message,{error:true,disableAction:true});
          return;
        }
        reasonField?.setCustomValidity('');
        const submitLabel=submit.textContent;
        submit.dataset.busy='1';
        submit.disabled=true;
        submit.setAttribute('aria-busy','true');
        submit.textContent='در حال ثبت رد…';
        if(reasonField)reasonField.disabled=true;
        let keepLocked=false;
        let confirmed=false;
        const setFeedback=(message,{error=false,lock=false}={})=>{
          if(feedback){feedback.hidden=false;feedback.setAttribute('role',error?'alert':'status');feedback.replaceChildren(document.createTextNode(message));}
          if(lock){
            keepLocked=true;
            const check=document.createElement('button');
            check.type='button';
            check.className='btn btn-sm delivery-acceptance__check';
            check.dataset.deliveryAcceptCheck=String(orderId);
            check.textContent='بررسی وضعیت از سرور';
            check.addEventListener('click',()=>__westoViewContext.runBusy(check,()=>checkDeliveryAcceptanceStatus(check),'در حال بررسی…').catch((checkError)=>__westoViewContext.showToast(checkError.message,'error')));
            feedback?.appendChild(check);
            card?.querySelectorAll('[data-delivery-accept],[data-delivery-reject-open],[data-delivery-reject-submit],[data-delivery-reject-cancel],[data-delivery-reject-reason]').forEach((action)=>{action.disabled=true;});
          }
        };
        const acceptButton=panel?.querySelector('[data-delivery-accept]');
        const rejectOpen=panel?.querySelector('[data-delivery-reject-open]');
        const cancelButton=panel?.querySelector('[data-delivery-reject-cancel]');
        if(acceptButton)acceptButton.disabled=true;
        if(rejectOpen)rejectOpen.disabled=true;
        if(cancelButton)cancelButton.disabled=true;
        panel?.setAttribute('aria-busy','true');
        if(feedback){feedback.hidden=false;feedback.setAttribute('role','status');feedback.textContent='در حال ثبت رد سفارش و دریافت تأیید از سرور…';}
        try{
          const response=await __westoViewContext.api(`/api/delivery/orders/${encodeURIComponent(orderId)}/reject${__westoViewContext.branchQs()}`,{
            method:'POST',
            headers:{'Idempotency-Key':rejectionIntent.key},
            body:JSON.stringify(payload),
          });
          if(!__westoViewContext.adminDeliveryRejectionConfirmed(response,orderId)){
            setFeedback('پاسخ سرور رد این سفارش را تأیید نکرد؛ برای جلوگیری از ثبت تکراری، وضعیت را از سرور بررسی کنید.',{error:true,lock:true});
            return;
          }
          confirmed=true;
          let freshOrders;
          try{
            freshOrders=await __westoViewContext.tabs.orders();
          }catch(refreshError){
            setFeedback('رد سفارش از سوی سرور تأیید شد، اما تازه‌سازی فهرست ناموفق بود؛ پیش از هر اقدام دوباره وضعیت را بررسی کنید.',{error:true,lock:true});
            __westoViewContext.showToast('رد سفارش ثبت شد؛ تازه‌سازی فهرست ناموفق بود.','error');
            return;
          }
          const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
          if(String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase()==='rejected'){
            __westoViewContext.clearAdminDeliveryRejectionIntent(rejectionIntent.storageKey);
            __westoViewContext.showToast('رد سفارش ارسال ثبت و فهرست به‌روز شد.','success',1800);
            return;
          }
          setAcceptanceFeedback(orderId,'رد سفارش در پاسخ سرور تأیید شد، اما فهرست تازه هنوز آن را نشان نمی‌دهد؛ برای جلوگیری از ثبت دوباره، ابتدا وضعیت را بررسی کنید.',{error:true,disableAction:true});
          __westoViewContext.showToast('پاسخ ثبت رد دریافت شد؛ وضعیت فهرست نیازمند بررسی است.','error');
        }catch(error){
          try{
            const freshOrders=await __westoViewContext.tabs.orders();
            const freshOrder=freshOrders.find((entry)=>String(entry.id)===String(orderId));
            const status=String(freshOrder?.deliveryAcceptance?.status||'').trim().toLowerCase();
            if(status==='rejected'){
              __westoViewContext.clearAdminDeliveryRejectionIntent(rejectionIntent.storageKey);
              __westoViewContext.clearAdminDeliveryAcceptanceIdempotencyKey(`westo:delivery-accept:${__westoViewContext.currentBranchId||'branch'}:${String(orderId)}`);
              __westoViewContext.showToast('رد سفارش از وضعیت تازهٔ سرور تأیید شد.','success',1800);
              return;
            }
            if(status==='accepted'){
              __westoViewContext.clearAdminDeliveryRejectionIntent(rejectionIntent.storageKey);
              __westoViewContext.showToast('پذیرش قبلاً در سرور ثبت شده است؛ این سفارش دوباره رد نشد.','error');
              setAcceptanceFeedback(orderId,'این سفارش از قبل پذیرفته شده است؛ برای جلوگیری از تصمیم متناقض، رد سفارش متوقف شد.',{error:true,disableAction:true});
              keepLocked=true;
              return;
            }
            if(['pending','unrecorded'].includes(status)){
              __westoViewContext.clearAdminDeliveryRejectionIntent(rejectionIntent.storageKey);
              setAcceptanceFeedback(orderId,`${error.message||'ثبت رد سفارش انجام نشد.'} وضعیت تازهٔ سرور هنوز بدون تصمیم است؛ پس از بررسی می‌توانید دوباره اقدام کنید.`,{error:true});
              __westoViewContext.showToast(error.message||'ثبت رد سفارش ناموفق بود.','error');
              return;
            }
            setFeedback('نتیجهٔ درخواست نامشخص است و وضعیت تازهٔ سفارش قابل تأیید نیست؛ برای جلوگیری از ثبت تکراری، اقدام متوقف شد.',{error:true,lock:true});
          }catch(refreshError){
            setFeedback('پاسخ رد سفارش نامشخص بود و دریافت وضعیت تازه هم ناموفق شد؛ برای جلوگیری از ثبت دوباره، ابتدا اتصال را برقرار و وضعیت سفارش را بررسی کنید.',{error:true,lock:true});
          }
          __westoViewContext.showToast(error.message||'نتیجهٔ رد سفارش نامشخص است؛ وضعیت را بررسی کنید.','error');
        }finally{
          panel?.removeAttribute('aria-busy');
          if(!keepLocked&&!confirmed){
            if(acceptButton)acceptButton.disabled=false;
            if(rejectOpen)rejectOpen.disabled=false;
            if(cancelButton)cancelButton.disabled=false;
          }
          submit.dataset.busy='0';
          submit.disabled=keepLocked||confirmed;
          submit.removeAttribute('aria-busy');
          submit.textContent=submitLabel;
        }
      }));
      const lockDeliveryStepForRefresh=(orderId,message)=>{
        const card=__westoViewContext.main.querySelector(`[data-order-card="${CSS.escape(String(orderId))}"]`);
        if(!card)return;
        card.querySelectorAll('[data-onext],[data-ostatus],[data-delivery-accept],[data-delivery-reject-open],[data-delivery-reject-submit]').forEach((control)=>{control.disabled=true;});
        let feedback=card.querySelector('[data-delivery-step-feedback]');
        if(!feedback){
          feedback=document.createElement('p');
          feedback.dataset.deliveryStepFeedback='1';
          feedback.className='delivery-ops-step__feedback';
          feedback.setAttribute('role','alert');
          card.querySelector('.ops-order-card__actions')?.appendChild(feedback);
        }
        feedback.replaceChildren(document.createTextNode(message));
        const check=document.createElement('button');
        check.type='button';
        check.className='btn btn-sm';
        check.textContent='بازخوانی وضعیت سفارش';
        check.addEventListener('click',()=>__westoViewContext.runBusy(check,async()=>{
          const refreshed=await __westoViewContext.tabs.orders();
          const current=refreshed.find((entry)=>String(entry.id)===String(orderId));
          __westoViewContext.showToast(current?`وضعیت تازهٔ سفارش: ${__westoViewContext.statusLabel(current.status)}`:'سفارش در فهرست این شعبه پیدا نشد.',current?'success':'error',2200);
        },'در حال بررسی…').catch((error)=>__westoViewContext.showToast(error.message||'بررسی وضعیت ناموفق بود.','error')));
        feedback.appendChild(document.createTextNode(' '));
        feedback.appendChild(check);
      };
      const runDeliveryCourierStep=async(button,targetStatus)=>{
        const orderId=button.dataset.onext||button.dataset.ostatus;
        const card=button.closest('[data-order-card]');
        const previousStatus=String(card?.dataset.status||'');
        if(!card||button.dataset.busy==='1')return;
        const confirmation=__westoViewContext.adminDeliveryStatusConfirmation(orderId,targetStatus);
        if(confirmation&&!window.confirm(confirmation)){
          if(button.matches('[data-ostatus]'))__westoViewContext.adminRestoreDeliveryStatusSelection(button,previousStatus);
          return;
        }
        const controls=card.querySelectorAll('[data-onext],[data-ostatus],[data-delivery-accept],[data-delivery-reject-open],[data-delivery-reject-submit]');
        controls.forEach((control)=>{control.disabled=true;});
        button.dataset.busy='1';
        button.setAttribute('aria-busy','true');
        const originalLabel=button.textContent;
        button.textContent=targetStatus==='dispatched'?'در حال ثبت تحویل به پیک…':'در حال ثبت تحویل نهایی…';
        let mutationError=null;
        try{
          const response=await changeStatus(orderId,targetStatus);
          const responseOrder=response?.order;
          if(response?.ok!==true||String(responseOrder?.id)!==String(orderId)||String(responseOrder?.status)!==targetStatus){
            mutationError=new Error('پاسخ سرور مرحلهٔ تحویل را تأیید نکرد.');
          }
        }catch(error){mutationError=error;}
        let refreshed;
        try{refreshed=await __westoViewContext.tabs.orders();}
        catch(refreshError){
          button.dataset.busy='0';
          button.removeAttribute('aria-busy');
          button.textContent=originalLabel;
          lockDeliveryStepForRefresh(orderId,'نتیجهٔ ثبت مرحلهٔ تحویل نامشخص است؛ برای جلوگیری از ثبت دوباره، ابتدا وضعیت سرور را بازخوانی کنید.');
          return;
        }
        const current=refreshed.find((entry)=>String(entry.id)===String(orderId));
        if(String(current?.status||'')===targetStatus){
          __westoViewContext.showToast(targetStatus==='dispatched'?'تحویل به پیک از وضعیت سرور تأیید شد.':'تحویل به مشتری از وضعیت سرور تأیید شد.','success',1800);
          return;
        }
        if(current&&String(current.status)===previousStatus&&mutationError){
          __westoViewContext.showToast(mutationError.message||'مرحلهٔ تحویل ثبت نشد؛ وضعیت فعلی از سرور تازه شد.','error');
          return;
        }
        if(current){
          __westoViewContext.showToast(`وضعیت از سرور تازه شد: ${__westoViewContext.statusLabel(current.status)}؛ پیش از اقدام بعدی دوباره بررسی کنید.`,mutationError?'error':'success',2400);
          return;
        }
        __westoViewContext.showToast(mutationError?.message||'سفارش در فهرست تازه پیدا نشد؛ وضعیت را بررسی کنید.','error');
      };
      __westoViewContext.main.querySelectorAll('[data-onext]').forEach((button)=>button.addEventListener('click',()=>{
        const card=button.closest('[data-order-card]');
        const targetStatus=String(button.dataset.nextStatus||'');
        if(card?.dataset.fulfillment==='delivery'&&['dispatched','delivered'].includes(targetStatus)){
          runDeliveryCourierStep(button,targetStatus).catch((error)=>__westoViewContext.showToast(error.message,'error'));
          return;
        }
        __westoViewContext.runBusy(button,async()=>{await changeStatus(button.dataset.onext,targetStatus);__westoViewContext.showToast('سفارش به مرحله بعد رفت','success',1400);await __westoViewContext.tabs.orders();}).catch((error)=>__westoViewContext.showToast(error.message,'error'));
      }));
      __westoViewContext.main.querySelectorAll('[data-ostatus]').forEach((select)=>select.addEventListener('change',async()=>{
        const status=select.value;
        const card=select.closest('[data-order-card]');
        if(card?.dataset.fulfillment==='delivery'&&['dispatched','delivered'].includes(status)){
          await runDeliveryCourierStep(select,status);
          return;
        }
        if(status==='cancelled'&&!window.confirm('این سفارش لغو شود؟ این اقدام در تاریخچه ثبت می‌شود.')){await __westoViewContext.tabs.orders();return;}
        select.disabled=true;
        try{await changeStatus(select.dataset.ostatus,status);__westoViewContext.showToast('وضعیت سفارش به‌روز شد','success',1400);await __westoViewContext.tabs.orders();}
        catch(error){__westoViewContext.showToast(error.message,'error');select.disabled=false;}
      }));
      const focused=sessionStorage.getItem('westo_admin_focus_order');if(focused){sessionStorage.removeItem('westo_admin_focus_order');const card=__westoViewContext.main.querySelector(`[data-order-card="${CSS.escape(focused)}"]`);if(card){card.classList.add('is-focused');card.scrollIntoView({behavior:'smooth',block:'center'});card.querySelector('button,select')?.focus({preventScroll:true});}}
      return orders;
    }
}['orders'];
});
/*westo-view:end:orders*/

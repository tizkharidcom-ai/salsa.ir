/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:kitchen*/
window.WestoAdminModules.defineView('kds', 'kitchen', function(__westoViewContext) {
return {
async kitchen() {
      __westoViewContext.setActiveTab('kitchen');
      let paintVersion = 0;
      let lastSnapshotBranchId = null;
      let lastSnapshotAt = null;
      let kdsActionsNeedRefresh = true;
      const paint = async () => {
        const requestVersion = ++paintVersion;
        const requestedBranchId = __westoViewContext.currentBranchId == null ? '' : String(__westoViewContext.currentBranchId);
        if (lastSnapshotBranchId !== null && requestedBranchId !== lastSnapshotBranchId) {
          lastSnapshotBranchId = requestedBranchId;
          lastSnapshotAt = null;
          kdsActionsNeedRefresh = true;
          __westoViewContext.kitchenSeenIds = new Set();
          __westoViewContext.main.innerHTML = '<section class="section-box" role="status"><p class="eyebrow">تغییر شعبه</p><h1>در حال دریافت صف آشپزخانه</h1><p class="lead">تا دریافت پاسخ تازه، سفارش‌های شعبهٔ قبلی پنهان می‌مانند.</p></section>';
        }

        let queueResult;
        try {
          queueResult = await __westoViewContext.settleKitchenWorkspaceRequests(
            __westoViewContext.api(`/api/kitchen/orders${__westoViewContext.branchQs()}`, { timeoutMs: 12000 }),
            __westoViewContext.api(`/api/kitchen/calls${__westoViewContext.branchQs()}`, { timeoutMs: 8000 }),
            8000
          );
        } catch (error) {
          kdsActionsNeedRefresh = true;
          if (!__westoViewContext.shouldRenderKitchenSnapshot(requestVersion, paintVersion, requestedBranchId, __westoViewContext.currentBranchId, __westoViewContext.activeTab)) {
            return { ok: false, stale: true, branchId: requestedBranchId };
          }
          const lastSuccessLabel = lastSnapshotAt
            ? `آخرین دریافت موفق: ${new Date(lastSnapshotAt).toLocaleString('fa-IR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : 'هنوز دریافت موفقی برای این شعبه ثبت نشده است.';
          const errorMarkup = `<section class="section-box kds-queue-error" role="alert"><div class="ops-panel__head"><div><p class="eyebrow">صف آشپزخانه به‌روز نیست</p><h2>دریافت سفارش‌ها ناموفق بود</h2></div><button type="button" class="btn btn-sm" data-kds-queue-retry>تلاش دوباره</button></div><p class="lead">${__westoViewContext.esc(error?.message || 'ارتباط با صف سفارش‌ها برقرار نشد.')}</p><p class="hint">${__westoViewContext.esc(lastSuccessLabel)}${__westoViewContext.main.querySelector('.kds-board') ? ' · اطلاعات قبلی فقط برای مشاهده است و ممکن است تغییر کرده باشد.' : ''}</p></section>`;
          if (__westoViewContext.main.querySelector('.kds-board')) {
            __westoViewContext.main.querySelector('.kds-queue-error')?.remove();
            __westoViewContext.main.querySelector('.ops-page-head')?.insertAdjacentHTML('afterend', errorMarkup);
            __westoViewContext.main.querySelectorAll('.kds-card [data-kds-action]').forEach((button) => {
              button.disabled = true;
              button.setAttribute('aria-disabled', 'true');
            });
          } else {
            __westoViewContext.main.innerHTML = errorMarkup;
          }
          __westoViewContext.main.querySelector('[data-kds-queue-retry]')?.addEventListener('click', (event) => __westoViewContext.runBusy(event.currentTarget, () => paint(), 'در حال دریافت…').catch((retryError) => __westoViewContext.showToast(retryError.message, 'error')));
          return { ok: false, stale: true, branchId: requestedBranchId, error };
        }
        if (!__westoViewContext.shouldRenderKitchenSnapshot(requestVersion, paintVersion, requestedBranchId, __westoViewContext.currentBranchId, __westoViewContext.activeTab)) {
          return { ok: false, stale: true, branchId: requestedBranchId };
        }
        kdsActionsNeedRefresh = false;
        const { queue, calls: callsRes, callsError } = queueResult;
        lastSnapshotBranchId = requestedBranchId;
        lastSnapshotAt = queue.serverTime || new Date().toISOString();
        const tickets = __westoViewContext.orderKitchenAdminTickets(queue.tickets || []);
        const cancelledTickets = queue.cancelledTickets || [];
        const blockedDeliveryCount = Math.max(0, Number(queue.counts?.blocked) || 0);
        const blockedDeliveryReasons = [
          [queue.counts?.blockedReasons?.acceptanceRequired, 'پذیرش رستوران هنوز ثبت نشده است.'],
          [queue.counts?.blockedReasons?.acceptanceRejected, 'پذیرش رستوران رد شده است؛ پیگیری با مسئول پذیرش لازم است.'],
          [queue.counts?.blockedReasons?.acceptanceProvenanceInvalid, 'مرجع پذیرش معتبر نیست یا ثبت نشده است؛ بررسی مدیر لازم است.'],
        ].filter(([count]) => Number(count) > 0);
        const blockedDeliveryMarkup = blockedDeliveryCount
          ? `<section class="section-box kds-acceptance-block" role="status" aria-live="polite" aria-labelledby="kds-acceptance-block-title">
              <div class="ops-panel__head"><div><p class="eyebrow">پذیرش پیش از آماده‌سازی</p><h2 id="kds-acceptance-block-title">سفارش‌های ارسال خارج از صف پخت</h2></div><strong class="kds-acceptance-block__count">${__westoViewContext.fmtNum(blockedDeliveryCount)} سفارش</strong></div>
              <p>${__westoViewContext.fmtNum(blockedDeliveryCount)} سفارش ارسال به‌دلیل وضعیت پذیرش وارد صف پخت نشده‌اند؛ دریافت وجه به‌تنهایی مجوز شروع آماده‌سازی نیست.</p>
              <ul>${blockedDeliveryReasons.map(([count, reason]) => `<li><b>${__westoViewContext.fmtNum(count)}</b> ${__westoViewContext.esc(reason)}</li>`).join('') || '<li>جزئیات دلیل از سرویس صف مشخص نیست؛ وضعیت پذیرش باید بررسی شود.</li>'}</ul>
              <p class="hint">آشپزخانه امکان تأیید سفارش ارسال را ندارد؛ پذیرش را از مسیر رسمی ثبت سفارش پیگیری کنید.</p>
            </section>`
          : '';
        const ids = new Set(tickets.map((t) => t.id));
        for (const id of ids) if (!__westoViewContext.kitchenSeenIds.has(id) && __westoViewContext.kitchenSeenIds.size > 0) __westoViewContext.beepNewOrder();
        __westoViewContext.kitchenSeenIds = ids;
        const col = (name) => tickets.filter((t) => t.column === name);
        const itemMarkup = (item, ticket, held = false) => {
          const isHeld = held || __westoViewContext.adminKdsIsHeldLine(item);
          const completed = Boolean(item.completedAt);
          const itemAction = isHeld ? null : __westoViewContext.adminKitchenLineAction(item, ticket.column);
          const paymentGuard = __westoViewContext.adminKitchenPaymentGuard(ticket);
          const actionsBlocked = kdsActionsNeedRefresh || !paymentGuard.eligible;
          const modifiers = (item.modifiers || []).map((modifier) => typeof modifier === 'string' ? modifier : modifier?.name).filter(Boolean);
          const allergens = (item.allergens || []).filter(Boolean);
          const stateLabel = isHeld
            ? 'منتظر ارسال از سالن؛ فعلاً در صف پخت نیست'
            : completed
              ? 'این قلم تکمیل شده است'
              : ticket.column === 'new'
                ? 'پس از شروع آماده‌سازی فعال می‌شود'
                : 'در انتظار تکمیل';
          const actionLabel = itemAction?.action === 'undo_item'
            ? ticket.column === 'ready' ? 'بازگردانی همین قلم به آماده‌سازی' : 'بازگردانی همین قلم'
            : itemAction ? 'ثبت تکمیل این قلم' : '';
          return `<li class="kds-order-line${isHeld ? ' is-held' : ''}${completed ? ' is-complete' : ''}">
            <div class="kds-order-line__body"><span class="kds-order-line__qty">${__westoViewContext.fmtNum(item.qty)}×</span><span><strong>${__westoViewContext.esc(item.name || 'قلم بدون نام')}</strong>${item.seat ? `<small> · صندلی ${__westoViewContext.fmtNum(item.seat)}</small>` : ''}${modifiers.length ? `<small> · ${__westoViewContext.esc(modifiers.join('، '))}</small>` : ''}${item.note ? `<small> · یادداشت: ${__westoViewContext.esc(item.note)}</small>` : ''}${allergens.length ? `<small class="kds-order-line__allergen"> · ⚠ ${__westoViewContext.esc(allergens.join('، '))}</small>` : ''}</span></div>
            <span class="kds-order-line__state">${__westoViewContext.esc(stateLabel)}</span>
            ${itemAction ? `<button type="button" class="btn kds-order-line__action" data-kds-action="${itemAction.action}" data-kds-ticket-id="${__westoViewContext.esc(ticket.id)}" data-line-key="${__westoViewContext.esc(itemAction.lineKey)}" ${actionsBlocked ? `disabled aria-disabled="true" title="${__westoViewContext.esc(kdsActionsNeedRefresh ? 'صف تازه نیست؛ ابتدا آن را به‌روز کنید.' : paymentGuard.message)}"` : ''} aria-label="${__westoViewContext.esc(actionLabel)}: ${__westoViewContext.esc(item.name || 'قلم سفارش')}، سفارش ${__westoViewContext.esc(ticket.orderNo || ticket.id)}">${__westoViewContext.esc(actionLabel)}</button>` : ''}
          </li>`;
        };
        const card = (t) => {
          const hot = t.ageSec >= 1200 ? ' is-critical' : t.ageSec >= 600 ? ' is-late' : t.ageSec >= 300 ? ' is-warn' : '';
          const fulfillment = __westoViewContext.fulfillmentLabel(t.fulfillment || (t.tableNo ? 'dine_in' : 'pickup'));
          const unitCount = (t.items || []).reduce((sum, i) => sum + Math.max(1, Number(i.qty) || 1), 0);
          const progress = __westoViewContext.adminKitchenTicketProgress(t);
          const paymentGuard = __westoViewContext.adminKitchenPaymentGuard(t);
          const actionsBlocked = kdsActionsNeedRefresh || !paymentGuard.eligible;
          const amendmentLabel = __westoViewContext.adminKitchenAmendmentLabel(t);
          const completionAction = __westoViewContext.adminKitchenCompletionAction(t, progress);
          const startAction = t.column === 'new' && progress.activeCount > 0 && !actionsBlocked;
          const progressLabel = progress.activeCount
            ? `پیشرفت پخت: ${__westoViewContext.fmtNum(progress.completedCount)} از ${__westoViewContext.fmtNum(progress.activeCount)} قلم تکمیل شده${progress.heldCount ? ` · ${__westoViewContext.fmtNum(progress.heldCount)} قلم منتظر ارسال از سالن` : ''}`
            : `هنوز قلمی برای پخت ارسال نشده${progress.heldCount ? ` · ${__westoViewContext.fmtNum(progress.heldCount)} قلم منتظر ارسال از سالن` : ''}`;
          const completionMarkup = completionAction
            ? completionAction.enabled
              ? `<button type="button" class="btn admin-primary-action" data-kds-action="complete_ticket" data-kds-can-complete="true" data-kds-ticket-id="${__westoViewContext.esc(t.id)}" ${actionsBlocked ? 'disabled aria-disabled="true"' : ''} aria-label="ثبت آماده‌بودن سفارش ${__westoViewContext.esc(t.orderNo || t.id)}">${__westoViewContext.esc(kdsActionsNeedRefresh ? 'صف تازه نیست؛ ابتدا به‌روزرسانی کنید' : !paymentGuard.eligible ? 'وضعیت پرداخت نیازمند بررسی است' : 'ثبت آماده‌بودن سفارش')}</button>`
              : `<button type="button" class="btn admin-primary-action" disabled aria-disabled="true">${__westoViewContext.esc(kdsActionsNeedRefresh ? 'صف تازه نیست؛ ابتدا به‌روزرسانی کنید' : !paymentGuard.eligible ? 'وضعیت پرداخت نیازمند بررسی است' : completionAction.label)}</button>`
            : '';
          const paymentBlock = paymentGuard.eligible ? '' : `<p class="kds-order-progress is-blocked" role="status">${__westoViewContext.esc(paymentGuard.message)}</p>`;
          return `<article class="kds-card${hot}" data-oid="${t.id}" aria-label="سفارش ${t.id}">
            <header><div><strong>${t.tableNo ? `میز ${__westoViewContext.esc(t.tableNo)}` : __westoViewContext.esc(fulfillment)}</strong><small>${t.kds?.priority === true ? '★ اولویت · ' : ''}${__westoViewContext.esc(fulfillment)} · ${__westoViewContext.fmtNum(unitCount)} قلم</small></div><span class="kds-age">${__westoViewContext.fmtAge(t.ageSec)}</span></header>
            <div class="kds-id">#${t.id}${t.orderNo ? ` · ${__westoViewContext.esc(t.orderNo)}` : ''}</div>
            ${amendmentLabel ? `<p class="kds-amendment">${__westoViewContext.esc(amendmentLabel)}</p>` : ''}
            ${t.note ? `<div class="kds-note"><strong>یادداشت سفارش</strong><span>${__westoViewContext.esc(t.note)}</span></div>` : ''}
            ${t.kitchenNote ? `<div class="kds-note"><strong>یادداشت آشپزخانه</strong><span>${__westoViewContext.esc(t.kitchenNote)}</span></div>` : ''}
            ${paymentBlock}
            <p class="kds-order-progress" role="status">${__westoViewContext.esc(progressLabel)}</p>
            <ul class="kds-items">${(t.items || []).map((item) => itemMarkup(item, t)).join('')}${(t.heldCourseItems || []).map((item) => itemMarkup(item, t, true)).join('')}</ul>
            <div class="kds-actions">
              ${t.column === 'new' ? startAction ? `<button type="button" class="btn admin-primary-action" data-kds-action="start_ticket" data-kds-ticket-id="${__westoViewContext.esc(t.id)}" aria-label="شروع آماده‌سازی سفارش ${__westoViewContext.esc(t.orderNo || t.id)}">شروع آماده‌سازی</button>` : `<button type="button" class="btn admin-primary-action" disabled aria-disabled="true">${__westoViewContext.esc(kdsActionsNeedRefresh ? 'صف تازه نیست؛ ابتدا به‌روزرسانی کنید' : !paymentGuard.eligible ? 'وضعیت پرداخت نیازمند بررسی است' : 'منتظر ارسال دوره از سالن')}</button>` : ''}
              ${completionMarkup}
              ${t.column === 'ready' ? '<span class="kds-ready-note" role="status">✓ سفارش آمادهٔ تحویل است؛ برای بازگشت، فقط همان قلم را انتخاب کنید.</span>' : ''}
            </div>
          </article>`;
        };
        const cancelledCard = (t) => {
          const cancelledAt = t.cancelledAt ? new Date(t.cancelledAt) : null;
          const cancelledLabel = cancelledAt && Number.isFinite(cancelledAt.getTime())
            ? cancelledAt.toLocaleString('fa-IR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
            : 'زمان ثبت نامشخص';
          const location = t.tableNo ? `میز ${__westoViewContext.esc(t.tableNo)}` : __westoViewContext.fulfillmentLabel(t.fulfillment || 'pickup');
          const lines = [...(t.items || []), ...(t.heldCourseItems || [])];
          return `<article class="kds-cancelled-card" aria-label="سفارش لغوشده ${__westoViewContext.esc(t.orderNo || `شماره ${t.id}`)}"><header><strong>${__westoViewContext.esc(location)}</strong><span>${__westoViewContext.esc(t.orderNo || `#${t.id}`)}</span></header><p class="kds-cancelled-card__time">لغو شد · ${__westoViewContext.esc(cancelledLabel)}</p><ul>${lines.map((item) => {
            const modifiers = (item.modifiers || []).map((modifier) => typeof modifier === 'string' ? modifier : modifier?.name).filter(Boolean);
            return `<li><b>${__westoViewContext.fmtNum(item.qty)}×</b> ${__westoViewContext.esc(item.name || 'قلم بدون نام')}${modifiers.length ? `<small> · ${__westoViewContext.esc(modifiers.join('، '))}</small>` : ''}${item.note ? `<small> · ${__westoViewContext.esc(item.note)}</small>` : ''}</li>`;
          }).join('') || '<li>اقلام سفارش ثبت نشده است</li>'}</ul>${t.note ? `<p class="kds-cancelled-card__note"><b>یادداشت سفارش</b>${__westoViewContext.esc(t.note)}</p>` : ''}${t.kitchenNote ? `<p class="kds-cancelled-card__note"><b>یادداشت آشپزخانه</b>${__westoViewContext.esc(t.kitchenNote)}</p>` : ''}</article>`;
        };
        const calls = (callsRes.calls || []).slice().sort((a,b) => new Date(a.createdAt||0)-new Date(b.createdAt||0));
        const prepLoad = new Map();
        tickets.filter((t) => t.column !== 'ready').forEach((t) => (t.items || []).forEach((item) => {
          const key = String(item.name || 'سفارش');
          prepLoad.set(key, (prepLoad.get(key) || 0) + Math.max(1, Number(item.qty) || 1));
        }));
        const topPrep = [...prepLoad.entries()].sort((a,b) => b[1]-a[1]).slice(0,6);
        __westoViewContext.main.innerHTML = `
          <div class="ops-page-head"><div><p class="eyebrow">نمایش زنده آشپزخانه</p><h1>آشپزخانه</h1><p class="lead">قدیمی‌ترین سفارش در هر ستون بالاتر است. هدف شیفت: «جدید» را شروع کنید، «در حال آماده‌سازی» را فقط وقتی کامل شد آماده بزنید.</p><p class="hint" data-kds-snapshot-time>آخرین دریافت: ${__westoViewContext.esc(new Date(lastSnapshotAt).toLocaleString('fa-IR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p></div><div class="row-actions"><button type="button" class="btn btn-sm btn-ghost" data-kds-refresh>تازه‌سازی صف</button><a class="btn btn-sm btn-ghost" href="/admin/kitchen">نمایشگر مستقل آشپزخانه</a><span class="ops-provider-pill">قدیمی‌ترین: ${__westoViewContext.fmtAge(queue.summary?.oldestAgeSec || 0)}</span></div></div>
          <div class="cards cards-dense">
            <div class="card"><div class="num">${__westoViewContext.fmtNum(queue.counts?.new || 0)}</div><div class="lbl">جدید</div></div>
            <div class="card warn"><div class="num">${__westoViewContext.fmtNum(queue.counts?.preparing || 0)}</div><div class="lbl">در حال آماده‌سازی</div></div>
            <div class="card accent"><div class="num">${__westoViewContext.fmtNum(queue.counts?.ready || 0)}</div><div class="lbl">آماده تحویل</div></div>
            <div class="card ${cancelledTickets.length ? 'is-danger' : ''}"><div class="num">${__westoViewContext.fmtNum(cancelledTickets.length)}</div><div class="lbl">لغوهای اخیر</div></div>
            <div class="card ${queue.summary?.delayed ? 'is-danger' : ''}"><div class="num">${__westoViewContext.fmtNum(queue.summary?.delayed || 0)}</div><div class="lbl">بیش از ۲۰ دقیقه</div></div>
            <div class="card"><div class="num">${__westoViewContext.fmtNum(queue.summary?.itemUnits || 0)}</div><div class="lbl">واحد غذا در صف</div></div>
            <div class="card"><div class="num">${__westoViewContext.fmtNum(calls.length)}</div><div class="lbl">فراخوان گارسون</div></div>
          </div>
          ${blockedDeliveryMarkup}
          ${callsError ? `<section class="section-box kds-calls-error" role="alert"><div class="ops-panel__head"><div><p class="eyebrow">سالن</p><h2>فراخوان‌های سالن موقتاً بارگذاری نشدند</h2></div><button type="button" class="btn btn-sm" data-kds-calls-retry>تلاش دوباره</button></div><p class="hint">صف سفارش‌های آشپزخانه در دسترس است؛ برای دیدن و پاسخ به فراخوان‌ها دوباره تلاش کنید.</p></section>` : calls.length ? `<section class="section-box kds-calls"><div class="ops-panel__head"><div><p class="eyebrow">سالن</p><h2>فراخوان‌های باز</h2></div><span class="hint">قدیمی‌ترین ابتدا</span></div><div class="kds-call-list">${calls.map((c) => `<button class="btn btn-sm btn-ghost kds-call-btn" data-calldone="${c.id}"><b>میز ${__westoViewContext.esc(c.tableNo)}</b><span>${c.note ? __westoViewContext.esc(c.note) : 'بدون توضیح'}</span><small>${c.createdAt ? new Date(c.createdAt).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}) : ''}</small><em>انجام شد ✓</em></button>`).join('')}</div></section>` : ''}
          ${topPrep.length ? `<section class="section-box kds-prep-load"><div class="ops-panel__head"><div><p class="eyebrow">فشار آماده‌سازی</p><h2>تعداد تجمیعی غذاهای در انتظار</h2></div><span class="hint">برای هماهنگی سریع تیم</span></div><div class="kds-prep-chips">${topPrep.map(([name,qty])=>`<span><b>${__westoViewContext.fmtNum(qty)}×</b>${__westoViewContext.esc(name)}</span>`).join('')}</div></section>` : ''}
          <section class="admin-help-strip section-box"><strong>راهنمای رنگ:</strong><span>۵ دقیقه = توجه · ۱۰ دقیقه = هشدار · ۲۰ دقیقه = بحرانی. رنگ فقط هشدار است و ترتیب اصلی بر اساس سن سفارش می‌ماند.</span></section>
          <div class="kds-board" role="region" aria-label="صف آشپزخانه">
            <section class="kds-col"><h2>جدید <small>${__westoViewContext.fmtNum(col('new').length)}</small></h2>${col('new').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
            <section class="kds-col"><h2>در حال آماده‌سازی <small>${__westoViewContext.fmtNum(col('preparing').length)}</small></h2>${col('preparing').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
            <section class="kds-col"><h2>آماده <small>${__westoViewContext.fmtNum(col('ready').length)}</small></h2>${col('ready').map(card).join('') || '<p class="hint">فعلاً خالی است</p>'}</section>
          </div>
          <section class="kds-cancelled-lane--admin" role="region" aria-labelledby="kds-cancelled-title"><header class="ops-panel__head"><div><p class="eyebrow">خارج از صف فعال · ۲۴ ساعت اخیر</p><h2 id="kds-cancelled-title">سفارش‌های لغوشده پس از ورود به آشپزخانه</h2></div><span class="hint">${__westoViewContext.fmtNum(cancelledTickets.length)} مورد</span></header><p class="hint">اقلام این سفارش‌ها دیگر در صف پخت نیستند؛ پیش از ادامهٔ آماده‌سازی، تحویل یا دورریختن آن‌ها را با مسئول شیفت بررسی کنید.</p><div class="kds-cancelled-lane--admin__list">${cancelledTickets.map(cancelledCard).join('') || '<p class="hint">موردی برای این بازه ثبت نشده است.</p>'}</div></section>
            <p class="hint">صف با رویدادهای زنده به‌روز می‌شود؛ برای بررسی فوری از دکمهٔ «تازه‌سازی صف» استفاده کنید.</p>`;

        __westoViewContext.main.querySelectorAll('[data-kds-action]').forEach((button) => button.addEventListener('click', () => {
          if (kdsActionsNeedRefresh) {
            __westoViewContext.showToast('صف به‌روز نیست؛ پیش از هر تغییر، صف را تازه کنید.', 'error');
            return;
          }
          const card = button.closest('.kds-card');
          if (!card || card.dataset.kdsActionBusy === '1') return;
          card.dataset.kdsActionBusy = '1';
          card.setAttribute('aria-busy', 'true');
          card.querySelectorAll('[data-kds-action]').forEach((control) => { control.disabled = true; });
          const releaseCard = () => {
            if (!card.isConnected) return;
            card.dataset.kdsActionBusy = '0';
            card.removeAttribute('aria-busy');
            card.querySelectorAll('[data-kds-action]').forEach((control) => { control.disabled = kdsActionsNeedRefresh; });
          };
          __westoViewContext.runBusy(button, async () => {
            const payload = __westoViewContext.adminKitchenActionPayload(button.dataset);
            if (!payload) throw new Error('این عملیات یا شناسهٔ قلم معتبر نیست؛ صف را تازه کنید.');
            try {
              await __westoViewContext.sendAdminKitchenAction(button.dataset.kdsTicketId, payload);
            } catch (error) {
              const refreshed = await paint().catch(() => null);
              if (refreshed?.ok && String(refreshed.branchId) === String(requestedBranchId)) {
                const currentTicket = refreshed.tickets.find((ticket) => String(ticket.id) === String(button.dataset.kdsTicketId));
                if (__westoViewContext.adminKitchenActionApplied(currentTicket, payload)) {
                  __westoViewContext.showToast('پاسخ درخواست کامل نرسید، اما نتیجهٔ این اقدام در صف تازه از سرور تأیید شد.', 'success', 3600);
                } else if (refreshed.cancelledTickets.some((ticket) => String(ticket.id) === String(button.dataset.kdsTicketId))) {
                  __westoViewContext.showToast('سفارش اکنون در فهرست لغوشده‌هاست؛ لغو از آشپزخانه انجام نمی‌شود. وضعیت اقلام را با مسئول شیفت بررسی کنید.', 'error', 5200);
                } else {
                  __westoViewContext.showToast(`${__westoViewContext.adminKitchenActionErrorMessage(error)} صف تازه شد؛ وضعیت فعلی را بررسی کنید و فقط در صورت نیاز دوباره اقدام کنید.`, 'error', 5200);
                }
              } else {
                __westoViewContext.showToast('پاسخ اقدام و وضعیت تازهٔ سفارش مشخص نشد؛ دکمه‌های تغییر غیرفعال‌اند. ابتدا صف را با موفقیت تازه‌سازی کنید.', 'error', 5200);
              }
              return;
            }
            const success = ({
              start_ticket: 'آماده‌سازی شروع شد.',
              complete_item: 'تکمیل این قلم ثبت شد.',
              undo_item: 'همین قلم به آماده‌سازی برگشت.',
              complete_ticket: 'سفارش آمادهٔ تحویل شد.',
            })[payload.action];
            __westoViewContext.showToast(success, 'success', 1400);
            await paint();
          }).catch((error) => __westoViewContext.showToast(error.message, 'error')).finally(releaseCard);
        }));
        __westoViewContext.main.querySelectorAll('[data-calldone]').forEach((b) => b.addEventListener('click', () => __westoViewContext.runBusy(b, async () => {
          const callId = String(b.dataset.calldone || '');
          try {
            const result = await __westoViewContext.api(`/api/kitchen/calls/${encodeURIComponent(callId)}${__westoViewContext.branchQs()}`, { method:'PATCH', body:JSON.stringify({ status:'done' }) });
            if (result?.ok !== true) throw new Error('پاسخ سرور انجام فراخوان را تأیید نکرد.');
            __westoViewContext.showToast('فراخوان انجام‌شده ثبت شد.', 'success', 1800);
            await paint();
          } catch (error) {
            const refreshed = await paint().catch(() => null);
            if (refreshed?.ok && !refreshed.callsError && !refreshed.calls.some((call) => String(call.id) === callId)) {
              __westoViewContext.showToast('پاسخ درخواست کامل نرسید، اما فراخوان از فهرست بازها حذف شده و انجام آن از سرور تأیید شد.', 'success', 3600);
            } else if (refreshed?.ok && !refreshed.callsError) {
              __westoViewContext.showToast(`${error.message || 'ثبت انجام فراخوان تأیید نشد.'} · فراخوان هنوز باز است؛ پس از بررسی دوباره تلاش کنید.`, 'error', 4800);
            } else {
              __westoViewContext.showToast('نتیجهٔ انجام فراخوان مشخص نشد؛ فهرست فراخوان‌ها به‌روز نیست. پیش از تلاش دوباره، آن را تازه کنید.', 'error', 4800);
            }
          }
        }, 'ثبت…').catch((e) => __westoViewContext.showToast(e.message, 'error'))));
        __westoViewContext.main.querySelector('[data-kds-refresh]')?.addEventListener('click', (event) => __westoViewContext.runBusy(event.currentTarget, () => paint(), 'در حال دریافت…').catch((e) => __westoViewContext.showToast(e.message, 'error')));
        __westoViewContext.main.querySelector('[data-kds-calls-retry]')?.addEventListener('click', (event) => __westoViewContext.runBusy(event.currentTarget, () => paint(), 'در حال تلاش…').catch((e) => __westoViewContext.showToast(e.message, 'error')));
        return {
          ok: true,
          branchId: requestedBranchId,
          tickets,
          cancelledTickets,
          calls: callsRes.calls || [],
          callsError: Boolean(callsError),
        };
      };
      __westoViewContext.kitchenPaint = paint;
      await paint();
      __westoViewContext.stopKitchenPoll();
    }
}['kitchen'];
});
/*westo-view:end:kitchen*/

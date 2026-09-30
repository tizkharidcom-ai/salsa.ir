/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:delivery*/
window.WestoAdminModules.defineView('delivery', 'delivery', function(__westoViewContext) {
return {
async delivery() {
      __westoViewContext.setActiveTab('delivery');
      const [zoneData, paymentData] = await Promise.all([
        __westoViewContext.api(`/api/admin/delivery-zones${__westoViewContext.branchQs()}`),
        __westoViewContext.api(`/api/admin/payments${__westoViewContext.branchQs()}`),
      ]);
      const zones = zoneData.zones || [];
      const payments = paymentData.payments || [];
      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head">
          <div><p class="eyebrow">عملیات تحویل</p><h1>پیک، تحویل و پرداخت</h1><p class="lead">هزینه و حداقل سفارش هر محدوده در همین شعبه کنترل می‌شود. پرداخت آنلاین فعلاً در حالت ${__westoViewContext.esc(__westoViewContext.paymentModeLabel(paymentData.provider?.mode))} است.</p></div>
          <div class="row-actions"><a class="btn btn-sm btn-ghost" href="${__westoViewContext.financeWorkspaceHref('sales_bank')}">تطبیق پرداخت و بانک</a><a class="btn btn-sm btn-ghost" href="/order" target="_blank" rel="noopener">پیش‌نمایش ثبت سفارش</a></div>
        </div>
        <section class="section-box">
          <div class="ops-panel__head"><div><p class="eyebrow">محدوده‌های ارسال</p><h2>قیمت‌گذاری پیک بر اساس محدوده</h2></div><span class="hint">شعبهٔ فعال: ${__westoViewContext.esc(__westoViewContext.currentBranch()?.name || '—')}</span></div>
          <div class="delivery-zone-grid">
            ${zones.map((zone) => `<article class="delivery-zone-card" data-zone="${zone.id}">
              <header><strong>${__westoViewContext.esc(zone.name)}</strong><label class="switch"><input type="checkbox" data-zone-active ${zone.active !== false ? 'checked' : ''} /><span>فعال</span></label></header>
              <div class="grid-3">
                ${__westoViewContext.field('نام محدوده', `zone-${zone.id}-name`, zone.name)}
                ${__westoViewContext.field('حداقل سفارش (تومان)', `zone-${zone.id}-minimum`, String(zone.minOrder || 0), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('هزینه ارسال (تومان)', `zone-${zone.id}-fee`, String(zone.fee || 0), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('زمان تقریبی (دقیقه)', `zone-${zone.id}-eta`, String(zone.etaMinutes || 0), { ltr: true, type: 'number' })}
              </div>
              <div class="row-actions"><button class="btn btn-sm" data-zone-save="${zone.id}">ذخیره محدوده</button><button class="btn btn-sm btn-danger" data-zone-delete="${zone.id}">حذف</button></div>
            </article>`).join('') || '<p class="ops-empty">برای این شعبه هنوز محدوده‌ای تعریف نشده است.</p>'}
          </div>
          <details class="delivery-zone-new"><summary>افزودن محدوده جدید</summary>
            <div class="grid-3">
              ${__westoViewContext.field('نام محدوده', 'new-zone-name', '')}
              ${__westoViewContext.field('حداقل سفارش (تومان)', 'new-zone-minimum', '0', { ltr: true, type: 'number' })}
              ${__westoViewContext.field('هزینه ارسال (تومان)', 'new-zone-fee', '0', { ltr: true, type: 'number' })}
              ${__westoViewContext.field('زمان تقریبی (دقیقه)', 'new-zone-eta', '30', { ltr: true, type: 'number' })}
            </div>
            <button class="btn btn-sm" id="new-zone-save">افزودن محدوده</button>
          </details>
        </section>
        <section class="section-box">
          <div class="ops-panel__head"><div><p class="eyebrow">پرداخت</p><h2>آخرین تلاش‌های پرداخت</h2></div><span class="ops-provider-pill">${__westoViewContext.esc(__westoViewContext.paymentProviderLabel(paymentData.provider?.provider))} · ${__westoViewContext.esc(__westoViewContext.paymentModeLabel(paymentData.provider?.mode))}</span></div>
          <div class="payment-list">
            ${payments.map((payment) => `<div class="payment-row"><div><b>#${payment.id} · سفارش #${payment.orderId}</b><span>${__westoViewContext.fmtDateTime(payment.createdAt)}</span></div><strong>${__westoViewContext.fmtMoney(payment.amount)}</strong><em class="ops-status ops-status--${__westoViewContext.esc(payment.status)}">${__westoViewContext.esc({ pending: 'در انتظار', paid: 'موفق', failed: 'ناموفق', cancelled: 'لغو', refunded: 'بازپرداخت' }[payment.status] || payment.status)}</em></div>`).join('') || '<p class="ops-empty">تلاش پرداختی وجود ندارد.</p>'}
          </div>
        </section>`;

      const updateZone = async (id, patch) => {
        try {
          await __westoViewContext.api(`/api/admin/delivery-zones/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          __westoViewContext.showToast('محدوده ارسال ذخیره شد', 'success');
          __westoViewContext.tabs.delivery().catch((error) => __westoViewContext.showToast(error.message, 'error'));
        } catch (error) {
          __westoViewContext.showToast(error.message || 'خطا در ذخیره محدوده', 'error');
        }
      };
      __westoViewContext.main.querySelectorAll('[data-zone-save]').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.zoneSave;
          const name = document.getElementById(`zone-${id}-name`)?.value?.trim() || '';
          if (!name) {
            __westoViewContext.showToast('نام محدوده لازم است', 'error');
            return;
          }
          updateZone(id, {
            name,
            minOrder: __westoViewContext.parseInputNumber(document.getElementById(`zone-${id}-minimum`)?.value) || 0,
            fee: __westoViewContext.parseInputNumber(document.getElementById(`zone-${id}-fee`)?.value) || 0,
            etaMinutes: __westoViewContext.parseInputNumber(document.getElementById(`zone-${id}-eta`)?.value) || 0,
            active: __westoViewContext.main.querySelector(`[data-zone="${id}"] [data-zone-active]`)?.checked !== false,
          }).catch((error) => __westoViewContext.showToast(error.message, 'error'));
        });
      });
      __westoViewContext.main.querySelectorAll('[data-zone-active]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = input.closest('[data-zone]')?.dataset.zone;
          if (id) updateZone(id, { active: input.checked }).catch((error) => __westoViewContext.showToast(error.message, 'error'));
        });
      });
      __westoViewContext.main.querySelectorAll('[data-zone-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!window.confirm('این محدوده حذف شود؟')) return;
          try {
            await __westoViewContext.api(`/api/admin/delivery-zones/${button.dataset.zoneDelete}`, { method: 'DELETE' });
            __westoViewContext.showToast('محدوده حذف شد', 'success');
            __westoViewContext.tabs.delivery().catch((error) => __westoViewContext.showToast(error.message, 'error'));
          } catch (error) {
            __westoViewContext.showToast(error.message || 'خطا در حذف محدوده', 'error');
          }
        });
      });
      document.getElementById('new-zone-save')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('new-zone-name');
        const name = nameInput?.value?.trim() || '';
        if (!name) {
          __westoViewContext.showToast('نام محدوده لازم است', 'error');
          nameInput?.focus();
          return;
        }
        try {
          await __westoViewContext.api('/api/admin/delivery-zones', {
            method: 'POST',
            body: JSON.stringify({
              branchId: __westoViewContext.currentBranchId,
              name,
              minOrder: __westoViewContext.parseInputNumber(document.getElementById('new-zone-minimum')?.value) || 0,
              fee: __westoViewContext.parseInputNumber(document.getElementById('new-zone-fee')?.value) || 0,
              etaMinutes: __westoViewContext.parseInputNumber(document.getElementById('new-zone-eta')?.value) || 0,
            }),
          });
          __westoViewContext.showToast('محدوده جدید اضافه شد', 'success');
          __westoViewContext.tabs.delivery().catch((error) => __westoViewContext.showToast(error.message, 'error'));
        } catch (error) {
          __westoViewContext.showToast(error.message || 'خطا در ایجاد محدوده جدید', 'error');
        }
      });
    }
}['delivery'];
});
/*westo-view:end:delivery*/

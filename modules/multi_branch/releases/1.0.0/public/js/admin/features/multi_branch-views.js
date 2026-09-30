/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:branches*/
window.WestoAdminModules.defineView('multi_branch', 'branches', function(__westoViewContext) {
return {
async branches() {
      __westoViewContext.setActiveTab('branches');
      await __westoViewContext.loadBranches();
      const list = __westoViewContext.branchesCache;
      __westoViewContext.main.innerHTML = `
        <h1>شعبه‌ها</h1>
        <p class="lead">مدیریت چندشعبه — هر شعبه آدرس، تلفن، ساعت کاری و میزهای جدا دارد (مشابه سامانه‌های چندفروشگاهی منوی دیجیتال).</p>
        <div class="section-box">
          <h2>افزودن شعبه</h2>
          <div class="grid-2">
            ${__westoViewContext.field('نام شعبه', 'nb_name', '')}
            ${__westoViewContext.field('اسلاگ لاتین', 'nb_slug', '', { ltr: true })}
            ${__westoViewContext.field('آدرس', 'nb_address', '')}
            ${__westoViewContext.field('تلفن', 'nb_phone', '', { ltr: true })}
          </div>
          <button class="btn btn-sm" id="nb-add">ایجاد شعبه</button>
        </div>
        ${list
          .map(
            (b) => `
          <div class="section-box" data-bid="${b.id}">
            <h2>${__westoViewContext.esc(b.name)} <span class="hint ltr">#${b.id} · ${__westoViewContext.esc(b.slug)}</span></h2>
            <div class="grid-2">
              ${__westoViewContext.field('نام', `b${b.id}_name`, b.name)}
              ${__westoViewContext.field('اسلاگ', `b${b.id}_slug`, b.slug, { ltr: true })}
              ${__westoViewContext.field('آدرس', `b${b.id}_address`, b.address || '')}
              ${__westoViewContext.field('تلفن', `b${b.id}_phone`, b.phone || '', { ltr: true })}
            </div>
            <label class="chk" style="margin:0.75rem 0;display:inline-flex;"><input type="checkbox" id="b${b.id}_active" ${b.active !== false ? 'checked' : ''} /> فعال</label>
            <div class="row-actions">
              <span class="hint">ذخیره خودکار</span>
              <button class="btn btn-sm btn-ghost" data-bswitch="${b.id}">انتخاب در تاپ‌بار</button>
              <button class="btn btn-sm btn-danger" data-bdel="${b.id}" ${list.length <= 1 ? 'disabled' : ''}>حذف</button>
            </div>
          </div>`
          )
          .join('')}`;

      document.getElementById('nb-add')?.addEventListener('click', async () => {
        const name = document.getElementById('nb_name')?.value.trim() || '';
        if (!name) return __westoViewContext.showToast('نام شعبه لازم است', 'warn');
        try {
          await __westoViewContext.api('/api/admin/branches', {
            method: 'POST',
            body: JSON.stringify({
              name,
              slug: document.getElementById('nb_slug')?.value.trim() || undefined,
              address: document.getElementById('nb_address')?.value.trim() || '',
              phone: document.getElementById('nb_phone')?.value.trim() || '',
            }),
          });
          __westoViewContext.showToast('شعبه با موفقیت ایجاد شد', 'success');
          await __westoViewContext.loadBranches();
          __westoViewContext.tabs.branches();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ایجاد شعبه', 'error');
        }
      });
      list.forEach((b) => {
        const saveBranch = async () => {
          try {
            await __westoViewContext.api(`/api/admin/branches/${b.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: document.getElementById(`b${b.id}_name`)?.value || '',
                slug: document.getElementById(`b${b.id}_slug`)?.value || '',
                address: document.getElementById(`b${b.id}_address`)?.value || '',
                phone: document.getElementById(`b${b.id}_phone`)?.value || '',
                active: document.getElementById(`b${b.id}_active`)?.checked !== false,
              }),
            });
            await __westoViewContext.loadBranches();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ذخیره تغییرات شعبه', 'error');
          }
        };
        __westoViewContext.bindAutosave(__westoViewContext.main.querySelector(`[data-bid="${b.id}"]`), saveBranch);
      });
      __westoViewContext.main.querySelectorAll('[data-bswitch]').forEach((btn) =>
        btn.addEventListener('click', () => {
          __westoViewContext.currentBranchId = Number(btn.dataset.bswitch);
          localStorage.setItem('westo_admin_branch', String(__westoViewContext.currentBranchId));
          __westoViewContext.paintBranchSelect();
          __westoViewContext.showToast('شعبه فعال شد', 'info');
        })
      );
      __westoViewContext.main.querySelectorAll('[data-bdel]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('حذف شعبه؟ میزها به شعبه دیگر منتقل می‌شوند.')) return;
          try {
            await __westoViewContext.api(`/api/admin/branches/${btn.dataset.bdel}`, { method: 'DELETE' });
            __westoViewContext.showToast('شعبه با موفقیت حذف شد', 'success');
            await __westoViewContext.loadBranches();
            __westoViewContext.tabs.branches();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در حذف شعبه', 'error');
          }
        })
      );
    }
}['branches'];
});
/*westo-view:end:branches*/

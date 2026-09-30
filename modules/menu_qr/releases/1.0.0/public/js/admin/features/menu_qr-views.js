/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:printmenu*/
window.WestoAdminModules.defineView('menu_qr', 'printmenu', function(__westoViewContext) {
return {
async printmenu() {
      __westoViewContext.setActiveTab('printmenu');
      const d = await __westoViewContext.api('/api/admin/restaurant');
      const r = d.restaurant || {};
      __westoViewContext.main.innerHTML = `
        <h1>منوی چاپی و فایل پی‌دی‌اف</h1>
        <p class="lead">خروجی کاغذی از منوی زنده — مشابه ترکیب منوی دیجیتال و کاغذی در سامانه‌هایی مثل پرومنو. برای چاپ یا ذخیره فایل از پنجره چاپ مرورگر استفاده کنید.</p>
        <div class="section-box">
          <h2>${__westoViewContext.esc(r.name || 'وستو')}</h2>
          <p class="hint">${__westoViewContext.esc(r.tagline || '')}</p>
          <div class="row-actions" style="margin-top:1rem;">
            <a class="btn btn-sm" href="/menu-print" target="_blank" rel="noopener">باز کردن پیش‌نمایش چاپ</a>
            <button class="btn btn-sm btn-ghost" id="pm-window">باز کردن و چاپ فوری</button>
          </div>
          <ul class="hint" style="margin-top:1.25rem; line-height:1.7;">
            <li>می‌توانید ناموجودها، آلرژن‌ها و توضیحات را در صفحه چاپ روشن/خاموش کنید.</li>
            <li>در پنجره چاپ، مقصد را روی «ذخیره به‌صورت پی‌دی‌اف» بگذارید تا فایل بگیرید.</li>
            <li>قیمت‌ها و دسته‌ها همان لحظه از دیتابیس خوانده می‌شوند.</li>
          </ul>
        </div>
        <div class="section-box">
          <h2>میانبرها</h2>
          <div class="row-actions">
            <button class="btn btn-sm btn-ghost" data-tabjump="menu">ویرایش منو</button>
            <button class="btn btn-sm btn-ghost" data-tabjump="prices">مدیریت قیمت</button>
            <button class="btn btn-sm btn-ghost" data-tabjump="restaurant">اطلاعات مجموعه</button>
          </div>
        </div>`;
      document.getElementById('pm-window').addEventListener('click', () => {
        const w = window.open('/menu-print', '_blank');
        if (!w) return __westoViewContext.showToast('پاپ‌آپ مسدود شد');
        const t = setInterval(() => {
          try {
            if (w.document && w.document.getElementById('sheet')?.querySelector('.print-head')) {
              clearInterval(t);
              setTimeout(() => w.print(), 400);
            }
          } catch (_) {
            /* cross-check while loading */
          }
        }, 200);
        setTimeout(() => clearInterval(t), 8000);
      });
      __westoViewContext.main.querySelectorAll('[data-tabjump]').forEach((b) =>
        b.addEventListener('click', () => {
          const tab = b.dataset.tabjump;
          document.querySelector(`.admin-nav-item[data-tab="${tab}"]`)?.click();
        })
      );
    }
}['printmenu'];
});
/*westo-view:end:printmenu*/

/*westo-view:start:complements*/
window.WestoAdminModules.defineView('menu_qr', 'complements', function(__westoViewContext) {
return {
async complements() {
      __westoViewContext.setActiveTab('complements');
      const data = await __westoViewContext.api('/api/admin/menu-engineering');
      const categories = data.menuCategories || [];
      const items = data.menuItems || [];
      const complements = data.menuComplements || [];
      const rules = data.menuComplementRules || [];
      const imageSrc = (value) => !value ? '' : (/^https?:\/\//i.test(value) ? value : `/${String(value).replace(/^\//, '')}`);
      const checks = (list, attr, selected = [], label = (entry) => entry.name || entry.title) => {
        const active = new Set((selected || []).map(Number));
        return list.map((entry) => `<label class="me-chip"><input type="checkbox" ${attr}="${entry.id}" ${active.has(Number(entry.id)) ? 'checked' : ''}><span>${__westoViewContext.esc(label(entry))}</span></label>`).join('');
      };
      const itemChecks = (ruleId, selected = []) => `<label class="me-search"><span>محصول خاص</span><input type="search" data-me-item-search="${ruleId}" placeholder="جست‌وجوی محصول…"></label><div class="me-item-list" data-me-item-list="${ruleId}">${checks(items, 'data-me-item', selected)}</div>`;
      const scopeBlock = (ruleId, rule = {}) => `<div class="me-rule-scope"><section><h4>دسته‌های پایه</h4><div class="me-chip-grid">${checks(categories, 'data-me-category', rule.sourceCategoryIds)}</div></section><details><summary>هدف‌گیری محصول خاص <small>${__westoViewContext.fmtNum((rule.sourceItemIds || []).length)} انتخاب</small></summary>${itemChecks(ruleId, rule.sourceItemIds)}</details><section><h4>مکمل‌های پیشنهادی</h4><div class="me-chip-grid">${checks(complements, 'data-me-complement', rule.complementIds)}</div></section></div>`;
      const complementCard = (entry) => `<article class="me-complement-card" data-me-complement-card="${entry.id}"><div class="me-complement-preview">${entry.img ? `<img src="${__westoViewContext.esc(imageSrc(entry.img))}" alt="">` : '<span>بدون تصویر</span>'}<i>${entry.available !== false ? 'فعال در صندوق' : 'غیرفعال'}</i></div><div class="me-complement-fields"><label><span>نام مکمل</span><input data-me-name value="${__westoViewContext.esc(entry.name)}"></label><label><span>قیمت</span><input data-me-price type="number" min="0" value="${Number(entry.price || 0)}"></label><label><span>موجودی</span><input data-me-stock type="number" min="0" placeholder="نامحدود" value="${entry.stock == null ? '' : Number(entry.stock)}"></label><label><span>تصویر</span><input data-me-image type="text" value="${__westoViewContext.esc(entry.img || '')}"></label><label class="me-upload"><span>جایگزینی تصویر</span><input data-me-file type="file" accept="image/*"></label><label class="me-switch"><input data-me-available type="checkbox" ${entry.available !== false ? 'checked' : ''}><span>قابل فروش</span></label></div><footer><button class="btn btn-sm" type="button" data-me-save-complement="${entry.id}">ذخیره</button><button class="btn btn-sm btn-ghost" type="button" data-me-delete-complement="${entry.id}">حذف</button></footer></article>`;
      const ruleCard = (rule) => `<article class="me-rule-card" data-me-rule-card="${rule.id}"><header><div><span>قانون ${__westoViewContext.fmtNum(rule.id)}</span><input data-me-rule-name value="${__westoViewContext.esc(rule.name)}"></div><label class="me-switch"><input data-me-rule-active type="checkbox" ${rule.active !== false ? 'checked' : ''}><span>فعال</span></label></header><label class="me-prompt"><span>متن پیشنهاد صندوق</span><input data-me-rule-prompt value="${__westoViewContext.esc(rule.prompt || '')}"></label>${scopeBlock(rule.id, rule)}<footer><button class="btn btn-sm" type="button" data-me-save-rule="${rule.id}">ذخیره قانون</button><button class="btn btn-sm btn-ghost" type="button" data-me-delete-rule="${rule.id}">حذف</button></footer></article>`;

      __westoViewContext.main.innerHTML = `<div class="ops-page-head"><div><p class="eyebrow">مهندسی منو · صندوق فروش</p><h1>مکمل‌ها و فروش هوشمند</h1><p class="lead">مکمل‌ها در منوی عمومی دیده نمی‌شوند. بعد از لمس محصول پایه، صندوق آن‌ها را در یک لایه سریع پیشنهاد می‌دهد و انتخاب زیر همان محصول فاکتور ثبت می‌شود.</p></div><button class="btn btn-sm" id="me-preview-pos">پیش‌نمایش صندوق</button></div><div class="cards cards-dense"><div class="card accent"><div class="num">${__westoViewContext.fmtNum(complements.filter((entry) => entry.available !== false).length)}</div><div class="lbl">مکمل فعال</div></div><div class="card"><div class="num">${__westoViewContext.fmtNum(rules.filter((entry) => entry.active !== false).length)}</div><div class="lbl">قانون فعال</div></div><div class="card"><div class="num">${__westoViewContext.fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceCategoryIds || []).length, 0))}</div><div class="lbl">اتصال دسته‌ای</div></div><div class="card"><div class="num">${__westoViewContext.fmtNum(rules.reduce((sum, rule) => sum + (rule.sourceItemIds || []).length, 0))}</div><div class="lbl">اتصال محصولی</div></div></div><div class="me-layout"><section class="section-box me-library"><div class="me-section-head"><div><h2>کتابخانه مکمل‌ها</h2><p>اقلام فروش‌محور مثل کوکی یا نوشابه که لازم نیست در منوی مهمان باشند.</p></div><button class="btn btn-sm" id="me-new-toggle">+ مکمل جدید</button></div><form class="me-new-form" id="me-new-complement" hidden><label><span>نام</span><input id="me-new-name" required></label><label><span>قیمت</span><input id="me-new-price" type="number" min="0" required></label><label><span>تصویر</span><input id="me-new-file" type="file" accept="image/*"></label><button class="btn" type="submit">ساخت مکمل</button></form><div class="me-complement-list">${complements.map(complementCard).join('') || '<div class="empty">هنوز مکملی ساخته نشده است.</div>'}</div></section><section class="section-box me-rules"><div class="me-section-head"><div><h2>قوانین پیشنهاد</h2><p>برای هر قانون دسته‌ها یا محصولات پایه و مکمل‌های مرتبط را انتخاب کنید.</p></div><button class="btn btn-sm" id="me-new-rule-toggle">+ قانون جدید</button></div><form class="me-rule-card is-new" id="me-new-rule" hidden><header><div><span>قانون جدید</span><input id="me-new-rule-name" placeholder="مثلاً کنار قهوه"></div><label class="me-switch"><input id="me-new-rule-active" type="checkbox" checked><span>فعال</span></label></header><label class="me-prompt"><span>متن پیشنهاد صندوق</span><input id="me-new-rule-prompt" placeholder="کنار نوشیدنی چه چیزی میل دارید؟"></label>${scopeBlock('new', {})}<footer><button class="btn" type="submit">ساخت قانون</button></footer></form><div class="me-rule-list">${rules.map(ruleCard).join('') || '<div class="empty">قانون پیشنهادی وجود ندارد.</div>'}</div></section></div>`;

      const selectedIds = (root, attr) => [...root.querySelectorAll(`[${attr}]:checked`)].map((input) => Number(input.getAttribute(attr)));
      const uploadFrom = async (input, fallback = '') => {
        const file = input?.files?.[0];
        if (!file) return fallback;
        const body = new FormData(); body.append('file', file);
        const uploaded = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body });
        return uploaded.path || fallback;
      };
      const bindItemSearches = () => __westoViewContext.main.querySelectorAll('[data-me-item-search]').forEach((input) => input.addEventListener('input', () => {
        const list = __westoViewContext.main.querySelector(`[data-me-item-list="${input.dataset.meItemSearch}"]`);
        const query = input.value.trim().toLowerCase();
        list?.querySelectorAll('label').forEach((label) => { label.hidden = !!query && !label.textContent.toLowerCase().includes(query); });
      }));
      bindItemSearches();
      document.getElementById('me-preview-pos').onclick = () => { location.href = '/admin/cashier'; };
      document.getElementById('me-new-toggle').onclick = () => { const form = document.getElementById('me-new-complement'); form.hidden = !form.hidden; if (!form.hidden) document.getElementById('me-new-name').focus(); };
      document.getElementById('me-new-rule-toggle').onclick = () => { const form = document.getElementById('me-new-rule'); form.hidden = !form.hidden; if (!form.hidden) document.getElementById('me-new-rule-name').focus(); };
      document.getElementById('me-new-complement').onsubmit = async (event) => {
        event.preventDefault();
        try {
          const img = await uploadFrom(document.getElementById('me-new-file'));
          await __westoViewContext.api('/api/admin/menu-complements', { method: 'POST', body: JSON.stringify({ name: document.getElementById('me-new-name').value, price: __westoViewContext.parseInputNumber(document.getElementById('me-new-price').value), img, available: true }) });
          __westoViewContext.showToast('مکمل ساخته شد'); __westoViewContext.tabs.complements();
        } catch (error) { __westoViewContext.showToast(error.message); }
      };
      __westoViewContext.main.querySelectorAll('[data-me-save-complement]').forEach((button) => button.onclick = async () => {
        const card = button.closest('[data-me-complement-card]');
        try {
          await __westoViewContext.runBusy(button, async () => {
            const img = await uploadFrom(card.querySelector('[data-me-file]'), card.querySelector('[data-me-image]').value.trim());
            await __westoViewContext.api(`/api/admin/menu-complements/${button.dataset.meSaveComplement}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: card.querySelector('[data-me-name]')?.value,
                price: __westoViewContext.parseInputNumber(card.querySelector('[data-me-price]')?.value),
                stock: __westoViewContext.parseInputNumber(card.querySelector('[data-me-stock]')?.value),
                img,
                available: card.querySelector('[data-me-available]')?.checked,
              }),
            });
          });
          __westoViewContext.showToast('مکمل ذخیره شد'); __westoViewContext.tabs.complements();
        } catch (error) { __westoViewContext.showToast(error.message); }
      });
      __westoViewContext.main.querySelectorAll('[data-me-delete-complement]').forEach((button) => button.onclick = async () => {
        if (!confirm('این مکمل و اتصال‌هایش حذف شود؟')) return;
        try { await __westoViewContext.api(`/api/admin/menu-complements/${button.dataset.meDeleteComplement}`, { method: 'DELETE' }); __westoViewContext.showToast('مکمل حذف شد'); __westoViewContext.tabs.complements(); } catch (error) { __westoViewContext.showToast(error.message); }
      });
      const rulePayload = (root) => ({ name: root.querySelector('[data-me-rule-name]')?.value || document.getElementById('me-new-rule-name')?.value, prompt: root.querySelector('[data-me-rule-prompt]')?.value || document.getElementById('me-new-rule-prompt')?.value, active: root.querySelector('[data-me-rule-active]')?.checked ?? document.getElementById('me-new-rule-active')?.checked, sourceCategoryIds: selectedIds(root, 'data-me-category'), sourceItemIds: selectedIds(root, 'data-me-item'), complementIds: selectedIds(root, 'data-me-complement') });
      document.getElementById('me-new-rule').onsubmit = async (event) => {
        event.preventDefault();
        try { await __westoViewContext.api('/api/admin/menu-complement-rules', { method: 'POST', body: JSON.stringify(rulePayload(event.currentTarget)) }); __westoViewContext.showToast('قانون ساخته شد'); __westoViewContext.tabs.complements(); } catch (error) { __westoViewContext.showToast(error.message); }
      };
      __westoViewContext.main.querySelectorAll('[data-me-save-rule]').forEach((button) => button.onclick = async () => {
        try { await __westoViewContext.runBusy(button, () => __westoViewContext.api(`/api/admin/menu-complement-rules/${button.dataset.meSaveRule}`, { method: 'PUT', body: JSON.stringify(rulePayload(button.closest('[data-me-rule-card]'))) })); __westoViewContext.showToast('قانون ذخیره شد'); __westoViewContext.tabs.complements(); } catch (error) { __westoViewContext.showToast(error.message); }
      });
      __westoViewContext.main.querySelectorAll('[data-me-delete-rule]').forEach((button) => button.onclick = async () => {
        if (!confirm('این قانون پیشنهاد حذف شود؟')) return;
        try { await __westoViewContext.api(`/api/admin/menu-complement-rules/${button.dataset.meDeleteRule}`, { method: 'DELETE' }); __westoViewContext.showToast('قانون حذف شد'); __westoViewContext.tabs.complements(); } catch (error) { __westoViewContext.showToast(error.message); }
      });
    }
}['complements'];
});
/*westo-view:end:complements*/

/*westo-view:start:prices*/
window.WestoAdminModules.defineView('menu_qr', 'prices', function(__westoViewContext, fa = __westoViewContext.fmtNum) {
return {
async prices() {
      __westoViewContext.setActiveTab('prices');
      const d = await __westoViewContext.api('/api/menu?all=1');
      const cats = d.menuCategories || [];
      const items = d.menuItems || [];
      __westoViewContext.main.innerHTML = `
        <h1>مدیریت قیمت</h1>
        <p class="lead">ویرایش سریع و انبوه قیمت‌ها — به‌روزرسانی لحظه‌ای مثل پنل‌های منوی دیجیتال حرفه‌ای.</p>
        <div class="section-box">
          <h2>تغییر انبوه</h2>
          <div class="grid-2">
            <div class="field"><label>دسته</label>
              <select id="bp-cat"><option value="">همه دسته‌ها</option>${cats.map((c) => `<option value="${c.id}">${__westoViewContext.esc(c.title)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>نوع تغییر</label>
              <select id="bp-mode">
                <option value="percent">درصد (مثلاً ۱۰ = افزایش ۱۰٪)</option>
                <option value="delta">مقدار ثابت (+/− تومان)</option>
                <option value="set">تنظیم همه به یک قیمت</option>
              </select>
            </div>
            ${__westoViewContext.field('مقدار', 'bp-val', '10', { ltr: true, type: 'number' })}
          </div>
          <button class="btn btn-sm" id="bp-run">اعمال روی منو</button>
        </div>
        <div class="section-box">
          <h2>ویرایش تکی (${__westoViewContext.fmtNum(items.length)} محصول)</h2>
          <div class="field"><input id="price-search" placeholder="جستجوی نام…" /></div>
          <table class="tbl" id="price-tbl"><thead><tr><th>نام</th><th>دسته</th><th>قیمت</th><th>موجود</th></tr></thead>
          <tbody></tbody></table>
        </div>`;

      const catMap = Object.fromEntries(cats.map((c) => [c.id, c.title]));
      const tbody = __westoViewContext.main.querySelector('#price-tbl tbody');
      const paint = (list) => {
        tbody.innerHTML = list
          .map(
            (m) => `<tr>
              <td>${__westoViewContext.esc(m.name)}</td>
              <td>${__westoViewContext.esc(catMap[m.categoryId] || m.categoryId)}</td>
              <td><input class="ltr-input" dir="ltr" data-price="${m.id}" type="number" value="${m.price}" /></td>
              <td>${m.available === false ? '<span class="pill blocked">ناموجود</span>' : '<span class="pill ok">موجود</span>'}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4">محصولی یافت نشد</td></tr>';
        tbody.querySelectorAll('[data-price]').forEach((inp) => {
          const savePrice = async () => {
            try {
              await __westoViewContext.api(`/api/menu/${inp.dataset.price}`, {
                method: 'PUT',
                body: JSON.stringify({ price: __westoViewContext.parseInputNumber(inp.value) || 0 }),
              });
            } catch (e) {
              __westoViewContext.showToast(e.message || 'خطا در ذخیره قیمت', 'error');
            }
          };
          const run = __westoViewContext.autosave(savePrice, { debounceMs: 400, silent: true });
          inp.addEventListener('change', run);
          inp.addEventListener('blur', run);
        });
      };
      paint(items);
      document.getElementById('price-search').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        paint(items.filter((m) => !q || m.name.includes(q)));
      });
      document.getElementById('bp-run')?.addEventListener('click', async () => {
        if (!confirm('قیمت‌ها به‌صورت انبوه تغییر کنند؟')) return;
        const cat = document.getElementById('bp-cat')?.value;
        try {
          const d2 = await __westoViewContext.api('/api/admin/prices/bulk', {
            method: 'POST',
            body: JSON.stringify({
              mode: document.getElementById('bp-mode')?.value,
              value: __westoViewContext.parseInputNumber(document.getElementById('bp-val')?.value) || 0,
              categoryId: cat === '' ? null : Number(cat),
            }),
          });
          __westoViewContext.showToast(`${d2.updated} محصول به‌روز شد`, 'success');
          __westoViewContext.tabs.prices();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در اعمال تغییر انبوه قیمت', 'error');
        }
      });
    }
}['prices'];
});
/*westo-view:end:prices*/

/*westo-view:start:products*/
window.WestoAdminModules.defineView('menu_qr', 'products', function(__westoViewContext) {
return {
async products() {
      __westoViewContext.setActiveTab('products');
      const d = await __westoViewContext.api('/api/menu?all=1');
      let catList = (d.menuCategories || []).slice();
      const allItems = d.menuItems || [];
      let counts = __westoViewContext.itemCountsByCat(allItems);
      let totals = __westoViewContext.itemTotalByCat(allItems);

      const siteCats = () => catList.filter((c) => __westoViewContext.isOnCarousel(c, counts[c.id] || 0));

      const persistOrder = async (list) => {
        const r = await __westoViewContext.api('/api/menu/categories/order', {
          method: 'PUT',
          body: JSON.stringify({ order: list.map((c) => c.id) }),
        });
        catList = r.menuCategories || list;
        if (r.products) __westoViewContext.state.products = r.products;
        return r;
      };

      const paint = () => {
        counts = __westoViewContext.itemCountsByCat(allItems);
        totals = __westoViewContext.itemTotalByCat(allItems);
        const onSite = siteCats();
        const listEl = document.getElementById('cat-studio-list');
        const summaryEl = document.getElementById('cat-studio-summary');
        if (summaryEl) {
          summaryEl.textContent = `${__westoViewContext.fmtNum(onSite.length)} دسته در صفحه اصلی`;
        }
        if (!listEl) return;

        listEl.innerHTML =
          catList
            .map((c, idx) => {
              const n = counts[c.id] || 0;
              const total = totals[c.id] || 0;
              const covered = __westoViewContext.hasValidCover(c);
              const onCarousel = __westoViewContext.isOnCarousel(c, n);
              const slot = onCarousel ? onSite.findIndex((x) => x.id === c.id) + 1 : null;
              const countHint =
                total > n
                  ? `${__westoViewContext.fmtNum(n)} موجود از ${__westoViewContext.fmtNum(total)}`
                  : `${__westoViewContext.fmtNum(n)} غذای موجود`;
              return `
          <div class="menu-studio__cat-card" data-cid="${c.id}">
            <div class="menu-studio__cat-row">
              <span class="hint" style="min-width:2.5rem">${slot != null ? `#${__westoViewContext.fmtNum(slot)}` : '—'}</span>
              <input type="text" value="${__westoViewContext.esc(c.title)}" data-cat-title="${c.id}" aria-label="عنوان دسته" />
              <button type="button" class="btn btn-sm btn-ghost" data-cat-up="${c.id}" ${idx === 0 ? 'disabled' : ''} title="بالا">↑</button>
              <button type="button" class="btn btn-sm btn-ghost" data-cat-down="${c.id}" ${idx === catList.length - 1 ? 'disabled' : ''} title="پایین">↓</button>
              <button type="button" class="btn btn-sm btn-ghost" data-cat-menu="${c.id}" title="غذاهای این دسته">غذاها</button>
              <button type="button" class="btn btn-sm btn-danger" data-cat-del="${c.id}">حذف</button>
            </div>
            <div class="menu-studio__cat-cover" style="margin-top:0.55rem;display:flex;gap:0.75rem;align-items:flex-start">
              <div class="menu-studio__drop${covered ? ' has-img' : ''}" data-cat-drop="${c.id}" style="width:7.5rem;height:7.5rem;flex-shrink:0;cursor:pointer">
                ${
                  covered
                    ? `<img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(c.coverImg))}" alt="" />`
                    : `<div class="menu-studio__drop-hint">تصویر شاخص<br/><small>برای نمایش در صفحه اصلی الزامی است</small></div>`
                }
              </div>
              <div style="flex:1;min-width:0">
                <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-cat-file="${c.id}" />
                <div class="row-actions" style="flex-wrap:wrap;gap:0.35rem">
                  <button type="button" class="btn btn-sm" data-cat-cover-pick="${c.id}">بارگذاری تصویر</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-cat-cover-clear="${c.id}" ${covered ? '' : 'disabled'}>پاک کردن</button>
                </div>
                <p class="hint" style="margin:0.4rem 0 0">${__westoViewContext.siteStatusPill(c, n)} · ${countHint}</p>
                <p class="hint" style="margin:0.35rem 0 0">تصویر شاخص باید عکس غذا یا نوشیدنی روی پس‌زمینه مشکی باشد؛ نه بسته‌بندی یا محصول نامرتبط.</p>
              </div>
            </div>
            <div class="field" style="margin:0.45rem 0 0"><label>توضیح کوتاه صفحه اصلی</label>
              <textarea rows="2" data-cat-short="${c.id}">${__westoViewContext.esc(c.shortDesc || '')}</textarea></div>
            <div class="field" style="margin:0.45rem 0 0"><label>توضیح بلند</label>
              <textarea rows="2" data-cat-long="${c.id}">${__westoViewContext.esc(c.longDesc || '')}</textarea></div>
            <div class="menu-studio__cat-row" style="margin-top:0.45rem;justify-content:space-between">
              <label class="chip" style="cursor:pointer">
                <input type="checkbox" data-cat-hide="${c.id}" ${c.hiddenOnSite ? 'checked' : ''} />
                مخفی از صفحه اصلی
              </label>
              <span class="hint">ذخیره خودکار</span>
            </div>
          </div>`;
            })
            .join('') || '<p class="hint">دسته‌ای نیست — یکی اضافه کنید.</p>';

        const moveCat = async (id, dir) => {
          const i = catList.findIndex((c) => c.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= catList.length) return;
          const next = catList.slice();
          const tmp = next[i];
          next[i] = next[j];
          next[j] = tmp;
          try {
            await persistOrder(next);
            __westoViewContext.showToast('ترتیب ذخیره شد');
            paint();
          } catch (err) {
            __westoViewContext.showToast(err.message);
          }
        };

        const uploadCover = async (id, file) => {
          if (!file) return;
          const fd = new FormData();
          fd.append('file', file);
          const up = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body: fd });
          const path = up.path || '';
          if (!path) throw new Error('بارگذاری ناموفق');
          const r = await __westoViewContext.api(`/api/menu/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ coverImg: path }),
          });
          catList = r.menuCategories || catList;
          if (r.products) __westoViewContext.state.products = r.products;
          __westoViewContext.showToast('تصویر شاخص ذخیره شد');
          paint();
        };

        listEl.querySelectorAll('[data-cat-up]').forEach((b) =>
          b.addEventListener('click', () => moveCat(Number(b.dataset.catUp), -1))
        );
        listEl.querySelectorAll('[data-cat-down]').forEach((b) =>
          b.addEventListener('click', () => moveCat(Number(b.dataset.catDown), 1))
        );
        listEl.querySelectorAll('[data-cat-menu]').forEach((b) =>
          b.addEventListener('click', () => __westoViewContext.tabs.menu(Number(b.dataset.catMenu)).catch((e) => __westoViewContext.showToast(e.message)))
        );
        listEl.querySelectorAll('[data-cat-cover-pick]').forEach((b) => {
          b.addEventListener('click', () => {
            listEl.querySelector(`[data-cat-file="${b.dataset.catCoverPick}"]`)?.click();
          });
        });
        listEl.querySelectorAll('[data-cat-drop]').forEach((drop) => {
          drop.addEventListener('click', () => {
            listEl.querySelector(`[data-cat-file="${drop.dataset.catDrop}"]`)?.click();
          });
        });
        listEl.querySelectorAll('[data-cat-file]').forEach((inp) => {
          inp.addEventListener('change', async () => {
            try {
              await uploadCover(Number(inp.dataset.catFile), inp.files?.[0]);
            } catch (err) {
              __westoViewContext.showToast(err.message);
            }
            inp.value = '';
          });
        });
        listEl.querySelectorAll('[data-cat-cover-clear]').forEach((b) => {
          b.addEventListener('click', async () => {
            const id = Number(b.dataset.catCoverClear);
            const cat = catList.find((c) => c.id === id);
            if (!cat) return;
            if (!cat.hiddenOnSite) {
              return __westoViewContext.showToast('ابتدا دسته را مخفی کنید، سپس تصویر شاخص را پاک کنید');
            }
            try {
              const r = await __westoViewContext.api(`/api/menu/categories/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ coverImg: '' }),
              });
              catList = r.menuCategories || catList;
              if (r.products) __westoViewContext.state.products = r.products;
              __westoViewContext.setSyncStatus('idle');
              __westoViewContext.showToast('تصویر شاخص پاک شد');
              paint();
            } catch (err) {
              __westoViewContext.showToast(err.message);
            }
          });
        });

        const persistCatFields = async (id, { repaint = false } = {}) => {
          const title = listEl.querySelector(`[data-cat-title="${id}"]`)?.value.trim();
          if (!title) throw new Error('عنوان لازم است');
          const cat = catList.find((c) => c.id === id);
          const hiddenOnSite = !!listEl.querySelector(`[data-cat-hide="${id}"]`)?.checked;
          if (!hiddenOnSite && cat && !__westoViewContext.hasValidCover(cat)) {
            throw new Error('برای نمایش در صفحه اصلی باید تصویر شاخص بارگذاری شود');
          }
          const r = await __westoViewContext.api(`/api/menu/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
              title,
              shortDesc: listEl.querySelector(`[data-cat-short="${id}"]`)?.value || '',
              longDesc: listEl.querySelector(`[data-cat-long="${id}"]`)?.value || '',
              hiddenOnSite,
              coverImg: cat?.coverImg || '',
            }),
          });
          catList = r.menuCategories || catList;
          if (r.products) __westoViewContext.state.products = r.products;
          if (repaint) paint();
        };

        catList.forEach((c) => {
          const id = c.id;
          const saveDebounced = __westoViewContext.autosave(() => persistCatFields(id), { debounceMs: 400, silent: true });
          const saveNow = __westoViewContext.autosave(() => persistCatFields(id, { repaint: true }), { debounceMs: 0, silent: true });
          listEl.querySelector(`[data-cat-title="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-short="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-long="${id}"]`)?.addEventListener('input', saveDebounced);
          listEl.querySelector(`[data-cat-hide="${id}"]`)?.addEventListener('change', saveNow);
        });

        listEl.querySelectorAll('[data-cat-del]').forEach((b) => {
          b.addEventListener('click', async () => {
            if (!confirm('این دسته حذف شود؟')) return;
            try {
              const r = await __westoViewContext.api(`/api/menu/categories/${b.dataset.catDel}`, { method: 'DELETE' });
              catList = r.menuCategories || [];
              if (r.products) __westoViewContext.state.products = r.products;
              __westoViewContext.showToast('دسته حذف شد');
              paint();
            } catch (err) {
              __westoViewContext.showToast(err.message);
            }
          });
        });
      };

      __westoViewContext.main.innerHTML = `
        <h1>دسته‌ها و ترتیب نمایش</h1>
        <p class="lead">ترتیب دسته‌ها، تصویر شاخص، متن معرفی و نمایش در صفحه اصلی را از همین‌جا مدیریت کنید.</p>
        <div class="section-box">
          <div class="row-actions" style="margin-bottom:0.85rem;flex-wrap:wrap;gap:0.5rem;align-items:flex-end">
            <div class="field" style="margin:0;flex:1;min-width:12rem">
              <label for="cat-studio-new">دسته جدید</label>
              <input id="cat-studio-new" type="text" placeholder="مثلاً دسر" />
            </div>
            <button type="button" class="btn btn-sm" id="cat-studio-add">افزودن دسته</button>
            <button type="button" class="btn btn-sm btn-ghost" id="go-menu-studio">منوی غذا</button>
          </div>
          <p class="hint" id="cat-studio-summary" style="margin:0 0 0.75rem"></p>
          <div class="menu-studio__cat-mgr" id="cat-studio-list"></div>
        </div>`;

      document.getElementById('go-menu-studio').onclick = () => __westoViewContext.tabs.menu().catch((e) => __westoViewContext.showToast(e.message));
      document.getElementById('cat-studio-add').onclick = async () => {
        const title = document.getElementById('cat-studio-new')?.value.trim();
        if (!title) return __westoViewContext.showToast('عنوان دسته را وارد کنید');
        try {
          const r = await __westoViewContext.api('/api/menu/categories', {
            method: 'POST',
            body: JSON.stringify({ title, hiddenOnSite: true }),
          });
          catList = r.menuCategories || catList;
          if (r.products) __westoViewContext.state.products = r.products;
          document.getElementById('cat-studio-new').value = '';
          __westoViewContext.showToast('دسته اضافه شد؛ تصویر شاخص را بارگذاری کنید');
          paint();
        } catch (err) {
          __westoViewContext.showToast(err.message);
        }
      };

      paint();
    }
}['products'];
});
/*westo-view:end:products*/

/*westo-view:start:menu*/
window.WestoAdminModules.defineView('menu_qr', 'menu', function(__westoViewContext, fa = __westoViewContext.fmtNum) {
return {
async menu(catId, opts = {}) {
      __westoViewContext.setActiveTab('menu');
      const d = await __westoViewContext.api('/api/menu?all=1');
      const cats = d.menuCategories || [];
      const allergens = d.allergens || [];
      const dayparts = d.dayparts || [];
      const allItems = d.menuItems || [];
      if (!catId) catId = cats.length ? cats[0].id : 0;
      catId = Number(catId);
      const searchQ = (opts.q != null ? opts.q : __westoViewContext.state._menuSearch || '').trim();
      const dietaryFilter = (opts.dietary != null ? opts.dietary : __westoViewContext.state._menuDietary || 'all');
      __westoViewContext.state._menuSearch = searchQ;
      __westoViewContext.state._menuDietary = dietaryFilter;
      __westoViewContext.state._menuCats = cats;
      __westoViewContext.state._menuAllergens = allergens;
      __westoViewContext.state._menuDayparts = dayparts;
      __westoViewContext.state._menuAllItems = allItems;
      __westoViewContext.state.menuItems = allItems.filter((m) => m.categoryId === catId);

      // Fetch BCG Matrix & Recipe Costing data
      let engineeringMap = new Map();
      try {
        const engData = await __westoViewContext.api('/api/admin/finance/menu-engineering');
        if (Array.isArray(engData?.items)) {
          engData.items.forEach((it) => {
            engineeringMap.set(String(it.menuItemId || ''), it);
            if (it.name) engineeringMap.set(String(it.name), it);
          });
        }
      } catch (_) {}

      const DIETARY_TAGS = [
        { id: 'vegan', label: 'گیاه‌خواری', icon: '🌿', badgeClass: 'is-vegan' },
        { id: 'keto', label: 'کتوژنیک', icon: '🥑', badgeClass: 'is-keto' },
        { id: 'gluten_free', label: 'بدون گلوتن', icon: '🌾', badgeClass: 'is-gf' },
        { id: 'spicy', label: 'تند', icon: '🌶️', badgeClass: 'is-spicy' },
        { id: 'low_cal', label: 'کم‌کالری', icon: '🥗', badgeClass: 'is-lowcal' },
        { id: 'dairy_free', label: 'بدون لبنیات', icon: '🥛', badgeClass: 'is-dairyfree' },
      ];

      const imgSrc = (img) => {
        if (!img) return '';
        if (/^https?:\/\//i.test(img)) return img;
        return `/${String(img).replace(/^\//, '')}`;
      };

      const filtered = __westoViewContext.state.menuItems.filter((m) => {
        const matchSearch = !searchQ ||
          String(m.name || '').includes(searchQ) ||
          String(m.en || '').toLowerCase().includes(searchQ.toLowerCase()) ||
          String(m.desc || '').includes(searchQ);
        if (!matchSearch) return false;
        if (dietaryFilter === 'all') return true;
        if (dietaryFilter === 'cost_warn') {
          const eng = engineeringMap.get(String(m.id)) || engineeringMap.get(String(m.name));
          return eng && eng.foodCostPct > 38;
        }
        return Array.isArray(m.dietary) && m.dietary.includes(dietaryFilter);
      });

      const allergenBoxes = (m, key = m.id) =>
        `<div class="chip-grid" data-allergens-for="${key}">
          ${allergens
            .map(
              (a) =>
                `<label class="chip"><input type="checkbox" value="${__westoViewContext.esc(a.id)}" ${(m.allergens || []).includes(a.id) ? 'checked' : ''} /> ${__westoViewContext.esc(a.label)}</label>`
            )
            .join('')}
        </div>`;
      const dietaryBoxes = (m, key = m.id) =>
        `<div class="chip-grid" data-dietary-for="${key}">
          ${DIETARY_TAGS
            .map(
              (t) =>
                `<label class="chip"><input type="checkbox" value="${__westoViewContext.esc(t.id)}" ${(m.dietary || []).includes(t.id) ? 'checked' : ''} /> ${t.icon} ${__westoViewContext.esc(t.label)}</label>`
            )
            .join('')}
        </div>`;
      const daypartBoxes = (m, key = m.id) =>
        `<div class="chip-grid" data-dayparts-for="${key}">
          ${dayparts
            .map(
              (p) =>
                `<label class="chip"><input type="checkbox" value="${__westoViewContext.esc(p.id)}" ${(m.dayparts || ['all']).includes(p.id) ? 'checked' : ''} /> ${__westoViewContext.esc(p.label)}</label>`
            )
            .join('')}
        </div>`;

      const rowHtml = (m) => {
        const avail = m.available !== false;
        const eng = engineeringMap.get(String(m.id)) || engineeringMap.get(String(m.name)) || null;
        const thumb = m.img
          ? `<img src="${__westoViewContext.esc(imgSrc(m.img))}" alt="" loading="lazy" />`
          : `<span class="menu-studio__thumb-ph">بدون تصویر</span>`;

        const itemDietary = Array.isArray(m.dietary) ? m.dietary : [];
        const dietaryHtml = itemDietary.map((tagId) => {
          const tag = DIETARY_TAGS.find((t) => t.id === tagId);
          return tag ? `<span class="menu-dietary-pill ${tag.badgeClass}">${tag.icon} ${__westoViewContext.esc(tag.label)}</span>` : '';
        }).join('');

        let costHtml = '';
        if (eng && eng.foodCostPct != null) {
          const pct = Math.round(eng.foodCostPct);
          const costStatus = pct <= 30 ? 'is-good' : pct <= 38 ? 'is-warn' : 'is-danger';
          const bcgIcon = eng.category === 'star' ? '⭐ پدیده' : eng.category === 'plowhorse' ? '🐎 اسب کار' : eng.category === 'puzzle' ? '🧩 معما' : '🐶 بازنگری';
          costHtml = `<span class="menu-cost-pill ${costStatus}" title="${__westoViewContext.esc(eng.recommendation || '')}">
            <span>بهای خوراک: ٪${fa(pct)}</span>
            <span class="bcg-tag">${bcgIcon}</span>
          </span>`;
        } else {
          costHtml = `<span class="menu-cost-pill is-missing" data-quick-create-recipe="${m.id}" title="بدون آنالیز بهای خوراک — کلیک برای تعریف دستور تهیه">⚠️ بدون دستور تهیه</span>`;
        }

        const prepMin = m.prepTime || 15;
        const prepHtml = `<span class="menu-prep-pill">⏱️ ${fa(prepMin)} دقیقه</span>`;

        let stockHtml = '';
        if (m.stock !== null && m.stock !== undefined) {
          if (m.stock <= 0) {
            stockHtml = `<span class="menu-stock-pill is-out">اتمام موجودی</span>`;
          } else if (m.stock <= (m.lowStockAt ?? 5)) {
            stockHtml = `<span class="menu-stock-pill is-low">موجودی کم: ${fa(m.stock)}</span>`;
          } else {
            stockHtml = `<span class="menu-stock-pill is-ok">موجودی: ${fa(m.stock)}</span>`;
          }
        }

        return `
          <div class="menu-studio__row${!avail ? ' is-unavailable' : ''}" data-mid="${m.id}" role="button" tabindex="0">
            <div class="menu-studio__thumb">${thumb}</div>
            <div class="menu-studio__meta">
              <div class="menu-studio__name-line">
                <strong>${__westoViewContext.esc(m.name)}</strong>
                ${stockHtml}
                ${prepHtml}
              </div>
              <div class="menu-studio__chips-line">
                ${dietaryHtml}
                ${costHtml}
              </div>
              <div class="menu-studio__price-wrap" onclick="event.stopPropagation()">
                <span class="menu-price-display" data-quick-price-trigger="${m.id}" title="کلیک برای ویرایش سریع قیمت">${__westoViewContext.fmtMoney(m.price)}</span>
                <div class="inline-price-editor" data-inline-editor="${m.id}" style="display:none;">
                  <input type="number" class="inline-price-input" value="${m.price}" step="1000" />
                  <div class="inline-price-nudges">
                    <button type="button" class="btn-nudge" data-nudge="5000">+۵k</button>
                    <button type="button" class="btn-nudge" data-nudge="10000">+۱۰k</button>
                    <button type="button" class="btn-nudge" data-nudge="20000">+۲۰k</button>
                    <button type="button" class="btn-nudge" data-nudge="50000">+۵۰k</button>
                    <button type="button" class="btn-nudge" data-nudge="-10000">-۱۰k</button>
                  </div>
                  <button type="button" class="btn btn-sm btn-primary inline-price-save" data-inline-save="${m.id}">ذخیره</button>
                  <button type="button" class="btn btn-sm btn-ghost inline-price-cancel" data-inline-cancel="${m.id}">✕</button>
                </div>
              </div>
            </div>
            <div class="menu-studio__row-actions" onclick="event.stopPropagation()">
              <button type="button" class="btn btn-sm btn-ghost" data-quick-edit-price="${m.id}" title="تغییر سریع قیمت">✎ قیمت</button>
              <button type="button" class="btn btn-sm btn-ghost" data-mavail="${m.id}" data-val="${avail ? 'false' : 'true'}">${avail ? 'ناموجود' : 'موجود'}</button>
              <button type="button" class="btn btn-sm" data-medit="${m.id}">ویرایش</button>
            </div>
          </div>`;
      };

      const emptyDraft = () => ({
        id: null,
        categoryId: catId,
        name: '',
        en: '',
        ar: '',
        desc: '',
        descEn: '',
        descAr: '',
        price: 0,
        img: '',
        available: true,
        allergens: [],
        dietary: [],
        prepTime: 15,
        dayparts: ['all'],
        stock: null,
        lowStockAt: 5,
      });

      __westoViewContext.main.innerHTML = `
        <div class="menu-studio">
          <h1>منوی غذا و مهندسی منو</h1>
          <p class="lead">افزودن و ویرایش غذا، قیمت‌گذاری هوشمند، بهای تمام‌شده خوراک و رژیم‌های غذایی در یک صفحه یکپارچه.</p>
          <div class="section-box">
            <div class="menu-studio__toolbar">
              <div class="field"><label for="menu-search">جستجو</label>
                <input id="menu-search" type="search" placeholder="نام یا توضیح…" value="${__westoViewContext.esc(searchQ)}" />
              </div>
              <div class="menu-studio__toolbar-actions">
                <button type="button" class="btn btn-sm btn-ghost" id="menu-bulk-price">تنظیم گروهی قیمت‌ها</button>
                <button type="button" class="btn btn-sm btn-ghost" id="go-carousel-cats">دسته‌ها و ترتیب نمایش</button>
                <button type="button" class="btn btn-sm" id="menu-add">افزودن غذا</button>
              </div>
            </div>
            <div class="menu-filters-strip" role="group" aria-label="فیلترهای رژیمی و مالی">
              <button type="button" class="menu-filter-chip${dietaryFilter === 'all' ? ' is-active' : ''}" data-dfilter="all">همه (${fa(__westoViewContext.state.menuItems.length)})</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'vegan' ? ' is-active' : ''}" data-dfilter="vegan">🌿 گیاه‌خواری</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'spicy' ? ' is-active' : ''}" data-dfilter="spicy">🌶️ تند</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'keto' ? ' is-active' : ''}" data-dfilter="keto">🥑 کتو</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'gluten_free' ? ' is-active' : ''}" data-dfilter="gluten_free">🌾 بدون گلوتن</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'dairy_free' ? ' is-active' : ''}" data-dfilter="dairy_free">🥛 بدون لبنیات</button>
              <button type="button" class="menu-filter-chip${dietaryFilter === 'cost_warn' ? ' is-active' : ''}" data-dfilter="cost_warn">⚠️ بهای بالا (>۳۸٪)</button>
            </div>
            <div class="menu-studio__cats" id="menu-cats" role="tablist" aria-label="دسته‌ها">
              ${cats
                .map(
                  (c) =>
                    `<button type="button" class="menu-studio__cat${Number(catId) === c.id ? ' is-on' : ''}" data-cat="${c.id}" role="tab" aria-selected="${Number(catId) === c.id}">${__westoViewContext.esc(c.title)} (${fa(allItems.filter((m) => m.categoryId === c.id).length)})</button>`
                )
                .join('') || '<span class="hint">دسته‌ای نیست</span>'}
            </div>
          </div>
          <div class="section-box">
            <div class="menu-studio__list" id="menu-list">
              ${filtered.map(rowHtml).join('') || '<div class="menu-studio__empty">محصولی با این شرایط در این دسته نیست — «افزودن غذا» را بزنید.</div>'}
            </div>
          </div>
        </div>
        <div class="menu-studio__drawer-scrim" id="menu-drawer-scrim" hidden></div>
        <aside class="menu-studio__drawer" id="menu-drawer" hidden aria-hidden="true"></aside>`;

      const drawerEl = document.getElementById('menu-drawer');
      const scrimEl = document.getElementById('menu-drawer-scrim');
      const listEl = document.getElementById('menu-list');
      let draftImg = '';
      let editingId = null;
      let draftModifierGroups = [];

      const cloneModifierGroups = (groups) => (Array.isArray(groups) ? groups : []).slice(0, 8).map((group, groupIndex) => ({
        id: String(group?.id || `group-${groupIndex + 1}`),
        title: String(group?.title || group?.name || '').trim(),
        selection: group?.selection === 'single' ? 'single' : 'multiple',
        required: Boolean(group?.required),
        options: (Array.isArray(group?.options) ? group.options : []).slice(0, 16).map((option, optionIndex) => ({
          id: String(option?.id || `option-${groupIndex + 1}-${optionIndex + 1}`),
          name: String(option?.name || option?.title || '').trim(),
          price: Math.max(0, Math.round(Number(option?.price) || 0)),
          available: option?.available !== false,
        })),
      }));

      const suggestedModifierGroups = (categoryTitle = '') => {
        const text = String(categoryTitle || '').toLocaleLowerCase('fa-IR');
        const make = (id, title, options, selection = 'multiple') => ({ id, title, selection, required: false, options: options.map((raw, index) => { const option = typeof raw === 'string' ? { name: raw, price: 0 } : (raw || {}); return { id: String(option.id || `${id}-${index + 1}`), name: option.name || '', price: Math.max(0, Math.round(Number(option.price) || 0)), available: option.available !== false }; }) });
        if (/(چای|دمنوش|هربال)/u.test(text)) return [make('tea-flavor', 'طعم چای', ['دارچین', 'هل', 'زنجبیل', 'ساده'], 'single'), make('tea-sweetener', 'شیرین‌کننده', [{ name: 'شکر', price: 0 }, { name: 'عسل', price: 60000 }, 'بدون شیرین‌کننده'], 'single')];
        if (/(قهوه|کافئین|لاته|کاپوچینو|اسپرسو|موکا)/u.test(text)) return [make('coffee-milk', 'نوع شیر', [{ name: 'شیر معمولی', price: 0 }, { name: 'شیر جو دوسر', price: 90000 }, { name: 'شیر بادام', price: 90000 }, 'بدون شیر'], 'single'), make('coffee-sweetener', 'شیرین‌کننده', ['شکر', 'شکر قهوه‌ای', 'بدون شکر'], 'single')];
        if (/(نوشیدنی|بار سرد|لیموناد|اسموتی|آبمیوه|ماچا|سرد)/u.test(text)) return [make('cold-ice', 'یخ', ['یخ معمولی', 'یخ کمتر', 'بدون یخ'], 'single'), make('cold-sweetness', 'شیرینی نوشیدنی', ['شیرینی معمولی', 'کم‌شیرین', 'بدون شکر'], 'single')];
        if (/(سالاد)/u.test(text)) return [make('salad-dressing', 'سس سالاد', ['سس جدا', 'بدون سس', { name: 'سس اضافه', price: 60000 }], 'single'), make('salad-addons', 'افزودنی سالاد', [{ name: 'پنیر اضافه', price: 120000 }, { name: 'آووکادو اضافه', price: 180000 }])];
        if (/(سوشی|ماکی)/u.test(text)) return [make('sushi-sides', 'مخلفات سوشی', ['سس سویا', 'واسابی', 'زنجبیل', 'بدون واسابی'])];
        if (/(دسر|کیک|شیرینی|بستنی)/u.test(text)) return [make('dessert-serving', 'نحوه سرو', ['سرو معمولی', 'بسته‌بندی بیرون‌بر', 'گرم‌شده'], 'single')];
        return [make('kitchen-request', 'درخواست آشپزخانه', ['تند', 'بدون پیاز', 'سس جدا']), make('main-addons', 'افزودنی غذا', [{ name: 'پنیر اضافه', price: 120000 }, { name: 'سس اضافه', price: 60000 }])];
      };

      const preferenceEditorHtml = () => draftModifierGroups.map((group, groupIndex) => `
        <article class="menu-preference-group" data-pref-group="${groupIndex}">
          <div class="menu-preference-group__head">
            <div class="menu-preference-group__identity"><span class="menu-preference-group__index">${groupIndex + 1}</span><div><span class="menu-preference-group__eyebrow">گروه گزینه‌ها</span><input class="menu-preference-group__title" data-pref-field="title" value="${__westoViewContext.esc(group.title)}" aria-label="عنوان گروه ترجیح" /></div></div>
            <div class="menu-preference-group__controls">
              <label class="menu-preference-select"><span>انتخاب</span><select data-pref-field="selection" aria-label="نوع انتخاب"><option value="multiple" ${group.selection !== 'single' ? 'selected' : ''}>چند گزینه</option><option value="single" ${group.selection === 'single' ? 'selected' : ''}>یک گزینه</option></select></label>
              <label class="menu-preference-check"><input type="checkbox" data-pref-field="required" ${group.required ? 'checked' : ''} /> انتخاب الزامی</label>
              <button type="button" class="btn btn-sm btn-ghost" data-pref-action="remove-group" data-pref-group-index="${groupIndex}">حذف گروه</button>
            </div>
          </div>
          <div class="menu-preference-options">
            ${group.options.map((option, optionIndex) => `<div class="menu-preference-option" data-pref-option="${optionIndex}"><div class="menu-preference-option__field"><label>نام گزینه</label><input data-pref-field="option-name" value="${__westoViewContext.esc(option.name)}" aria-label="نام گزینه" placeholder="مثلاً بدون پیاز" /></div><div class="menu-preference-option__field menu-preference-option__price"><label>افزایش قیمت</label><div><input data-pref-field="option-price" inputmode="numeric" value="${Number(option.price || 0)}" aria-label="هزینه گزینه" /><span>تومان</span></div></div><button type="button" class="menu-preference-option__remove" data-pref-action="remove-option" data-pref-group-index="${groupIndex}" data-pref-option-index="${optionIndex}" aria-label="حذف گزینه">×</button></div>`).join('') || '<p class="menu-preference-empty-options">هنوز گزینه‌ای اضافه نشده است.</p>'}
          </div>
          <button type="button" class="menu-preference-add-option" data-pref-action="add-option" data-pref-group-index="${groupIndex}">+ افزودن گزینه به این گروه</button>
        </article>
      `).join('');

      const readChips = (sel) =>
        [...__westoViewContext.main.querySelectorAll(`${sel} input:checked`)].map((inp) => inp.value);

      const closeDrawer = () => {
        drawerEl.hidden = true;
        drawerEl.setAttribute('aria-hidden', 'true');
        scrimEl.hidden = true;
        document.body.classList.remove('menu-editor-open');
        editingId = null;
        listEl.querySelectorAll('.menu-studio__row.is-active').forEach((r) => r.classList.remove('is-active'));
      };

      const wireDaypartExclusive = (root) => {
        const grid = root.querySelector('[data-dayparts-for]');
        if (!grid) return;
        grid.addEventListener('change', (e) => {
          const inp = e.target;
          if (!(inp instanceof HTMLInputElement) || inp.type !== 'checkbox') return;
          if (inp.value === 'all' && inp.checked) {
            grid.querySelectorAll('input').forEach((i) => {
              if (i !== inp) i.checked = false;
            });
          } else if (inp.value !== 'all' && inp.checked) {
            const all = grid.querySelector('input[value="all"]');
            if (all) all.checked = false;
          }
        });
      };

      const patchRow = (item) => {
        const row = listEl.querySelector(`[data-mid="${item.id}"]`);
        if (!row) {
          if (item.categoryId === catId) {
            const empty = listEl.querySelector('.menu-studio__empty');
            if (empty) empty.remove();
            listEl.insertAdjacentHTML('afterbegin', rowHtml(item));
            wireListRow(listEl.querySelector(`[data-mid="${item.id}"]`));
          }
          return;
        }
        if (item.categoryId !== catId) {
          row.remove();
          if (!listEl.querySelector('.menu-studio__row')) {
            listEl.innerHTML = '<div class="menu-studio__empty">محصولی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
          }
          return;
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = rowHtml(item);
        const next = tmp.firstElementChild;
        row.replaceWith(next);
        wireListRow(next);
        if (editingId === item.id) next.classList.add('is-active');
      };

      const collectDrawerPayload = () => {
        const stockVal = document.getElementById('md_stock')?.value;
        const parsedStock = __westoViewContext.parseInputNumber(stockVal);
        return {
          categoryId: __westoViewContext.parseInputNumber(document.getElementById('md_cat')?.value) || catId,
          name: document.getElementById('md_name')?.value.trim() || '',
          en: document.getElementById('md_en')?.value || '',
          ar: document.getElementById('md_ar')?.value || '',
          desc: document.getElementById('md_desc')?.value || '',
          descEn: document.getElementById('md_descEn')?.value || '',
          descAr: document.getElementById('md_descAr')?.value || '',
          price: __westoViewContext.parseInputNumber(document.getElementById('md_price')?.value) || 0,
          prepTime: __westoViewContext.parseInputNumber(document.getElementById('md_prep')?.value) || 15,
          img: draftImg || '',
          stock: stockVal === '' || stockVal == null ? null : (parsedStock ?? 0),
          lowStockAt: __westoViewContext.parseInputNumber(document.getElementById('md_low')?.value) || 0,
          allergens: readChips('[data-allergens-for="draft"]'),
          dietary: readChips('[data-dietary-for="draft"]'),
          dayparts: readChips('[data-dayparts-for="draft"]'),
          modifierGroups: cloneModifierGroups(draftModifierGroups),
        };
      };

      const openDrawer = (item) => {
        const isNew = !item || item.id == null;
        editingId = isNew ? null : item.id;
        draftImg = item.img || '';
        const categoryTitle = cats.find((category) => Number(category.id) === Number(item.categoryId))?.title || '';
        draftModifierGroups = cloneModifierGroups(Array.isArray(item.modifierGroups) ? item.modifierGroups : suggestedModifierGroups(categoryTitle));
        listEl.querySelectorAll('.menu-studio__row.is-active').forEach((r) => r.classList.remove('is-active'));
        if (!isNew) {
          const row = listEl.querySelector(`[data-mid="${item.id}"]`);
          if (row) row.classList.add('is-active');
        }
        const hasImg = !!draftImg;
        const eng = engineeringMap.get(String(item.id)) || engineeringMap.get(String(item.name)) || null;
        const currentItemCost = eng?.unitFoodCost || Math.round((Number(item.price) || 0) * 0.3) || 0;

        drawerEl.innerHTML = `
          <div class="menu-studio__drawer-head">
            <div class="menu-editor-title"><span class="menu-editor-kicker">استودیو مدیریت غذا</span><h2>${isNew ? 'غذای تازه' : `ویرایش · ${__westoViewContext.esc(item.name)}`}</h2><p>هویت، تصویر، قیمت، سودآوری و ترجیحات سفارش در یک نما.</p></div>
            <div class="menu-editor-head-actions"><span class="menu-editor-status">${isNew ? 'پیش‌نویس جدید' : (item.available === false ? 'غیرفعال' : 'فعال')}</span><button type="button" class="menu-studio__drawer-close" id="md-close" aria-label="بستن">×</button></div>
          </div>
          <div class="menu-editor-scroll">
            <div class="menu-editor-commandbar">
              <div class="menu-editor-commandbar__copy"><strong>کنترل همه‌جانبه غذا</strong><span>از اطلاعات پایه تا حاشیه سود، زمان پخت و رژیم‌های غذایی.</span></div>
              <nav class="menu-editor-map" aria-label="بخش‌های ویرایش">
                <button type="button" class="is-active" data-editor-nav="identity"><span>۱</span>اطلاعات</button>
                <button type="button" data-editor-nav="simulator"><span>۲</span>شبیه‌ساز سود</button>
                <button type="button" data-editor-nav="preferences"><span>۳</span>ترجیحات سفارش</button>
                <button type="button" data-editor-nav="display"><span>۴</span>نمایش و رژیم</button>
                <button type="button" data-editor-nav="advanced"><span>۵</span>حرفه‌ای</button>
              </nav>
              <div class="menu-editor-health" id="md-health" aria-live="polite">
                <span data-health="name"><i>✓</i> نام</span><span data-health="price"><i>✓</i> قیمت</span><span data-health="preferences"><i>✓</i> ترجیحات</span>
              </div>
            </div>
            <div class="menu-editor-grid">
              <section class="menu-editor-card menu-editor-card--identity" id="md-section-identity" data-editor-section="identity">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۱ · اطلاعات اصلی</span><h3>غذا را واضح معرفی کنید</h3><p>نام، توضیح کوتاه، قیمت و دستهٔ منو را یک‌جا تنظیم کنید.</p></div><span class="menu-editor-card__icon">✦</span></div>
                ${__westoViewContext.field('نام غذا', 'md_name', item.name || '')}
                ${__westoViewContext.field('توضیح کوتاه برای مهمان', 'md_desc', item.desc || '', { textarea: true })}
                <div class="grid-2">
                  ${__westoViewContext.field('قیمت (تومان)', 'md_price', String(item.price ?? 0), { ltr: true, type: 'number' })}
                  <div class="field"><label for="md_cat">دسته منو</label><select id="md_cat">${cats.map((c) => `<option value="${c.id}" ${Number(item.categoryId) === c.id ? 'selected' : ''}>${__westoViewContext.esc(c.title)}</option>`).join('')}</select></div>
                </div>
              </section>
              <section class="menu-editor-card menu-editor-card--simulator" id="md-section-simulator" data-editor-section="simulator">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۲ · شبیه‌ساز سودآوری</span><h3>تحلیل بهای تمام‌شده و حاشیه سود</h3><p>بر اساس بهای تخمینی خوراک (${__westoViewContext.fmtMoney(currentItemCost)})، سود خالص و ضریب مارک‌آپ را محاسبه کنید.</p></div><span class="menu-editor-card__icon">📊</span></div>
                <div class="menu-simulator-grid">
                  <div class="menu-simulator-box">
                    <div class="sim-metric"><span class="sim-label">بهای خوراک (Food Cost)</span><strong class="sim-value" id="sim-cost-val">${__westoViewContext.fmtMoney(currentItemCost)}</strong></div>
                    <div class="sim-metric"><span class="sim-label">سود ناخالص هر پرس</span><strong class="sim-value is-profit" id="sim-profit-val">—</strong></div>
                    <div class="sim-metric"><span class="sim-label">درصد حاشیه سود</span><strong class="sim-value is-margin" id="sim-margin-val">—</strong></div>
                    <div class="sim-metric"><span class="sim-label">ضریب قیمت‌گذاری (Markup)</span><strong class="sim-value" id="sim-markup-val">—</strong></div>
                  </div>
                  <div class="menu-simulator-target">
                    <label class="sim-target-label"><span>درصد بهای خوراک مطلوب: <b id="sim-target-text">۲۸٪</b></span><input type="range" id="sim-target-slider" min="15" max="50" step="1" value="28" /></label>
                    <div class="sim-target-chips">
                      <button type="button" class="sim-target-chip" data-starget="25">۲۵٪ (پریمیوم)</button>
                      <button type="button" class="sim-target-chip is-active" data-starget="28">۲۸٪ (بهینه)</button>
                      <button type="button" class="sim-target-chip" data-starget="33">۳۳٪ (استاندارد)</button>
                      <button type="button" class="sim-target-chip" data-starget="38">۳۸٪ (اقتصادی)</button>
                    </div>
                    <div class="sim-suggested-card">
                      <div><small>قیمت فروش پیشنهادی برای هدف:</small><strong id="sim-suggested-val">—</strong></div>
                      <button type="button" class="btn btn-sm btn-primary" id="sim-apply-btn">اعمال این قیمت</button>
                    </div>
                  </div>
                </div>
              </section>
              <section class="menu-editor-card menu-editor-card--media">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">پیش‌نمایش</span><h3>غذا در منو این‌طور دیده می‌شود</h3><p>تصویر و متن نهایی را قبل از انتشار همین‌جا ببینید.</p></div><span class="menu-editor-card__icon">▧</span></div>
                <div class="menu-studio__drop${hasImg ? ' has-img' : ''}" id="md-drop">
                  ${hasImg ? `<img id="md-preview" src="${__westoViewContext.esc(imgSrc(draftImg))}" alt="پیش‌نمایش ${__westoViewContext.esc(item.name || 'غذا')}" />` : `<div class="menu-studio__drop-hint"><strong>یک تصویر اشتهابرانگیز اضافه کنید</strong><br/><small>JPG / PNG / WebP · تصویر افقی یا مربعی</small></div>`}
                  <div class="menu-studio__drop-actions"><label class="btn btn-sm" style="cursor:pointer">${hasImg ? 'تغییر تصویر' : 'انتخاب تصویر'}<input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden /></label>${hasImg ? '<button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>' : ''}</div>
                </div>
                <div class="menu-editor-live-card" aria-label="پیش‌نمایش کارت غذا"><div class="menu-editor-live-card__tag" id="md-live-category">${__westoViewContext.esc(categoryTitle || 'دسته منو')}</div><strong id="md-live-name">${__westoViewContext.esc(item.name || 'نام غذا')}</strong><p id="md-live-desc">${__westoViewContext.esc(item.desc || 'توضیح کوتاه غذا برای مهمان')}</p><div class="menu-editor-live-card__price"><b id="md-live-price">${__westoViewContext.fmtNum(item.price || 0)}</b><span>تومان</span></div></div>
              </section>
              <section class="menu-editor-card menu-editor-card--preferences" id="md-section-preferences" data-editor-section="preferences">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۳ · تجربه سفارش</span><h3>ترجیحات مخصوص همین غذا</h3><p>مهمان فقط گزینه‌های مرتبط با این غذا را می‌بیند؛ چای و پیتزا دیگر تنظیمات مشترک ندارند.</p></div><span class="menu-editor-card__icon">◈</span></div>
                <div class="menu-preferences-toolbar"><span><b id="md-pref-count">${__westoViewContext.fmtNum(draftModifierGroups.length)}</b> گروه فعال · گزینه‌ها هنگام ثبت سفارش نمایش داده می‌شوند و هزینهٔ افزوده‌شان شفاف محاسبه می‌شود.</span><div><button type="button" class="btn btn-sm btn-ghost" id="md-pref-suggest">پیشنهادهای این دسته</button><button type="button" class="btn btn-sm" id="md-pref-add-group">+ افزودن گروه</button></div></div>
                <div id="md-modifier-groups" class="menu-preferences-groups">${preferenceEditorHtml()}</div>
                <div id="md-pref-empty" class="menu-preference-empty-state" ${draftModifierGroups.length ? 'hidden' : ''}><strong>برای این غذا ترجیحی ثبت نشده</strong><span>اگر لازم است، یک گروه مثل «نوع شیر» یا «سس» اضافه کنید.</span></div>
              </section>
              <section class="menu-editor-card menu-editor-card--display" id="md-section-display" data-editor-section="display">
                <div class="menu-editor-card__head"><div><span class="menu-editor-eyebrow">۴ · نمایش، رژیم و زمان پخت</span><h3>غذا کجا، برای چه کسی و با چه سرعتی آماده شود؟</h3></div><span class="menu-editor-card__icon">◌</span></div>
                <div class="field"><label for="md_prep">زمان تخمینی پخت و آماده‌سازی (دقیقه)</label>
                  <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                    <input id="md_prep" type="number" min="1" max="180" value="${item.prepTime || 15}" style="width:7rem;" />
                    <div style="display:flex; gap:0.3rem;" id="md-prep-presets">
                      <button type="button" class="btn btn-sm btn-ghost" data-pset="10">۱۰ دقیقه</button>
                      <button type="button" class="btn btn-sm btn-ghost" data-pset="15">۱۵ دقیقه</button>
                      <button type="button" class="btn btn-sm btn-ghost" data-pset="20">۲۰ دقیقه</button>
                      <button type="button" class="btn btn-sm btn-ghost" data-pset="30">۳۰ دقیقه</button>
                    </div>
                  </div>
                </div>
                <div class="field"><label>رژیم‌ها و ترجیحات غذایی</label>${dietaryBoxes(item, 'draft')}</div>
                <div class="field"><label>آلرژن‌ها و مواد حساسیت‌زا</label>${allergenBoxes(item, 'draft')}</div>
                <div class="field"><label>وعده‌های نمایش</label>${daypartBoxes(item, 'draft')}</div>
              </section>
              <section class="menu-editor-card menu-editor-card--advanced" id="md-section-advanced" data-editor-section="advanced">
                <details class="menu-studio__advanced"><summary><span><span class="menu-editor-eyebrow">۵ · تنظیمات حرفه‌ای</span><b>ترجمه و موجودی</b></span><small>برای کنترل دقیق‌تر</small></summary>
                  <div class="menu-studio__links"><button type="button" data-goto="translate">ترجمه منو</button><button type="button" data-goto="inventory">موجودی انبار</button></div>
                  <div class="grid-2">${__westoViewContext.field('نام انگلیسی', 'md_en', item.en || '', { ltr: true })}${__westoViewContext.field('نام عربی', 'md_ar', item.ar || '', { ltr: true })}</div>
                  <div class="grid-2">${__westoViewContext.field('توضیح انگلیسی', 'md_descEn', item.descEn || '', { textarea: true, ltr: true })}${__westoViewContext.field('توضیح عربی', 'md_descAr', item.descAr || '', { textarea: true, ltr: true })}</div>
                  <div class="grid-2">${__westoViewContext.field('موجودی (خالی = نامحدود)', 'md_stock', item.stock === null || item.stock === undefined ? '' : String(item.stock), { ltr: true, type: 'number' })}${__westoViewContext.field('آستانه هشدار موجودی کم', 'md_low', String(item.lowStockAt ?? 5), { ltr: true, type: 'number' })}</div>
                </details>
              </section>
            </div>
          </div>
          <div class="menu-studio__drawer-footer"><div class="menu-editor-save-state"><span class="menu-editor-save-dot"></span><span id="md-sync-hint">${isNew ? 'پس از ایجاد، تغییرات ذخیره می‌شوند' : 'ذخیره خودکار فعال است'}</span></div><div class="menu-editor-footer-actions">${isNew ? '<button type="button" class="btn btn-lg" id="md-create">ایجاد و ذخیره غذا</button>' : `<button type="button" class="btn btn-sm btn-ghost" id="md-avail" data-val="${item.available === false}">${item.available === false ? 'موجود کن' : 'ناموجود کن'}</button><button type="button" class="btn btn-sm btn-danger" id="md-del">حذف غذا</button>`}</div></div>`;

        drawerEl.hidden = false;
        drawerEl.setAttribute('aria-hidden', 'false');
        scrimEl.hidden = false;
        document.body.classList.add('menu-editor-open');
        wireDaypartExclusive(drawerEl);

        document.getElementById('md-close').onclick = closeDrawer;
        scrimEl.onclick = closeDrawer;

        let simTargetPct = 28;

        const paintEditorOverview = () => {
          const name = document.getElementById('md_name')?.value.trim() || '';
          const price = __westoViewContext.parseInputNumber(document.getElementById('md_price')?.value) || 0;
          const category = cats.find((c) => Number(c.id) === Number(document.getElementById('md_cat')?.value));
          const setHealth = (key, ok, text) => {
            const node = drawerEl.querySelector(`[data-health="${key}"]`);
            if (!node) return;
            node.classList.toggle('is-ok', Boolean(ok));
            node.classList.toggle('is-pending', !ok);
            node.innerHTML = `<i>${ok ? '✓' : '!'}</i>${text}`;
          };
          const prefCount = drawerEl.querySelectorAll('.menu-preference-group').length;
          setHealth('name', Boolean(name), name ? 'نام آماده' : 'نام لازم است');
          setHealth('price', price > 0, price > 0 ? 'قیمت آماده' : 'قیمت لازم است');
          setHealth('preferences', prefCount > 0, prefCount > 0 ? `${__westoViewContext.fmtNum(prefCount)} گروه ترجیح` : 'بدون ترجیح');
          const liveName = drawerEl.querySelector('#md-live-name');
          const liveDesc = drawerEl.querySelector('#md-live-desc');
          const livePrice = drawerEl.querySelector('#md-live-price');
          const liveCategory = drawerEl.querySelector('#md-live-category');
          if (liveName) liveName.textContent = name || 'نام غذا';
          if (liveDesc) liveDesc.textContent = document.getElementById('md_desc')?.value.trim() || 'توضیح کوتاه غذا برای مهمان';
          if (livePrice) livePrice.textContent = __westoViewContext.fmtNum(price);
          if (liveCategory) liveCategory.textContent = category?.title || 'دسته منو';

          // Simulator live calculation
          const profit = Math.max(0, price - currentItemCost);
          const marginPct = price > 0 ? Math.round((profit / price) * 100) : 0;
          const markup = currentItemCost > 0 ? (price / currentItemCost).toFixed(1) : '1.0';
          const suggestedPrice = currentItemCost > 0 ? Math.round((currentItemCost / (simTargetPct / 100)) / 1000) * 1000 : price;

          const profitEl = drawerEl.querySelector('#sim-profit-val');
          const marginEl = drawerEl.querySelector('#sim-margin-val');
          const markupEl = drawerEl.querySelector('#sim-markup-val');
          const suggestedEl = drawerEl.querySelector('#sim-suggested-val');
          const targetTextEl = drawerEl.querySelector('#sim-target-text');

          if (profitEl) profitEl.textContent = __westoViewContext.fmtMoney(profit);
          if (marginEl) marginEl.textContent = `٪${fa(marginPct)}`;
          if (markupEl) markupEl.textContent = `${fa(markup)}x`;
          if (suggestedEl) suggestedEl.textContent = __westoViewContext.fmtMoney(suggestedPrice);
          if (targetTextEl) targetTextEl.textContent = `٪${fa(simTargetPct)}`;
        };

        drawerEl.querySelector('#sim-target-slider')?.addEventListener('input', (e) => {
          simTargetPct = Number(e.target.value) || 28;
          drawerEl.querySelectorAll('.sim-target-chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.starget) === simTargetPct));
          paintEditorOverview();
        });
        drawerEl.querySelectorAll('.sim-target-chip').forEach((c) => {
          c.addEventListener('click', () => {
            simTargetPct = Number(c.dataset.starget);
            const slider = drawerEl.querySelector('#sim-target-slider');
            if (slider) slider.value = simTargetPct;
            drawerEl.querySelectorAll('.sim-target-chip').forEach((chip) => chip.classList.toggle('is-active', chip === c));
            paintEditorOverview();
          });
        });
        drawerEl.querySelector('#sim-apply-btn')?.addEventListener('click', () => {
          const suggestedPrice = currentItemCost > 0 ? Math.round((currentItemCost / (simTargetPct / 100)) / 1000) * 1000 : 0;
          if (suggestedPrice > 0) {
            const priceInput = drawerEl.querySelector('#md_price');
            if (priceInput) {
              priceInput.value = suggestedPrice;
              paintEditorOverview();
              if (editingId != null) saveDebounced();
              __westoViewContext.showToast(`قیمت پیشنهادی (${__westoViewContext.fmtMoney(suggestedPrice)}) اعمال شد`);
            }
          }
        });
        drawerEl.querySelectorAll('#md-prep-presets button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const prepInput = drawerEl.querySelector('#md_prep');
            if (prepInput) {
              prepInput.value = btn.dataset.pset;
              if (editingId != null) saveDebounced();
            }
          });
        });

        drawerEl.querySelectorAll('[data-editor-nav]').forEach((button) => {
          button.addEventListener('click', () => {
            const target = drawerEl.querySelector(`[data-editor-section="${button.dataset.editorNav}"]`);
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            drawerEl.querySelectorAll('[data-editor-nav]').forEach((b) => b.classList.toggle('is-active', b === button));
          });
        });
        drawerEl.addEventListener('input', (event) => {
          if (event.target.matches('#md_name, #md_desc, #md_price, #md_cat, #md_prep')) paintEditorOverview();
        });
        drawerEl.addEventListener('change', (event) => {
          if (event.target.matches('#md_cat, #md_prep')) paintEditorOverview();
        });
        paintEditorOverview();

        drawerEl.querySelectorAll('[data-goto]').forEach((b) => {
          b.addEventListener('click', () => {
            closeDrawer();
            __westoViewContext.tabs[b.dataset.goto]().catch((e) => __westoViewContext.showToast(e.message));
          });
        });

        const applySavedItem = (updated) => {
          __westoViewContext.state._menuAllItems = (__westoViewContext.state._menuAllItems || []).map((x) => (x.id === updated.id ? updated : x));
          if (!(__westoViewContext.state._menuAllItems || []).some((x) => x.id === updated.id)) {
            __westoViewContext.state._menuAllItems = [...(__westoViewContext.state._menuAllItems || []), updated];
          }
          __westoViewContext.state.menuItems = (__westoViewContext.state._menuAllItems || []).filter((x) => x.categoryId === catId);
          patchRow(updated);
          return updated;
        };

        const persistDrawer = async ({ create = false } = {}) => {
          const payload = collectDrawerPayload();
          if (!payload.name) throw new Error('نام را وارد کنید');
          if (create || editingId == null) {
            const r = await __westoViewContext.api('/api/menu', { method: 'POST', body: JSON.stringify(payload) });
            const created = r.item;
            applySavedItem(created);
            openDrawer(created);
            return created;
          }
          const r = await __westoViewContext.api(`/api/menu/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
          const updated = r.item;
          applySavedItem(updated);
          if (updated.categoryId !== catId) closeDrawer();
          else {
            editingId = updated.id;
            draftImg = updated.img || '';
            const head = drawerEl.querySelector('.menu-studio__drawer-head h2');
            if (head) head.textContent = `ویرایش · ${updated.name}`;
          }
          return updated;
        };

        const saveDebounced = __westoViewContext.autosave(() => persistDrawer(), { debounceMs: 400, silent: true });
        const saveNow = __westoViewContext.autosave(() => persistDrawer(), { debounceMs: 0, silent: true });

        const renderPreferences = () => {
          const root = drawerEl.querySelector('#md-modifier-groups');
          if (root) root.innerHTML = preferenceEditorHtml();
          const empty = drawerEl.querySelector('#md-pref-empty');
          if (empty) empty.hidden = draftModifierGroups.length > 0;
          const count = drawerEl.querySelector('#md-pref-count');
          if (count) count.textContent = __westoViewContext.fmtNum(draftModifierGroups.length);
          paintEditorOverview();
        };
        const savePreferences = () => { if (editingId != null) saveDebounced(); };
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('input', (event) => {
          const target = event.target;
          const groupIndex = Number(target.closest('[data-pref-group]')?.dataset.prefGroup);
          const optionIndex = Number(target.closest('[data-pref-option]')?.dataset.prefOption);
          const group = draftModifierGroups[groupIndex];
          if (!group) return;
          if (target.dataset.prefField === 'title') group.title = target.value;
          if (target.dataset.prefField === 'option-name' && group.options[optionIndex]) group.options[optionIndex].name = target.value;
          if (target.dataset.prefField === 'option-price' && group.options[optionIndex]) group.options[optionIndex].price = Math.max(0, Math.round(__westoViewContext.parseInputNumber(target.value) || 0));
          savePreferences();
        });
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('change', (event) => {
          const target = event.target;
          const groupIndex = Number(target.closest('[data-pref-group]')?.dataset.prefGroup);
          const group = draftModifierGroups[groupIndex];
          if (!group) return;
          if (target.dataset.prefField === 'selection') group.selection = target.value === 'single' ? 'single' : 'multiple';
          if (target.dataset.prefField === 'required') group.required = target.checked;
          savePreferences();
        });
        drawerEl.querySelector('#md-modifier-groups')?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-pref-action]');
          if (!button) return;
          event.preventDefault();
          const action = button.dataset.prefAction;
          const groupIndex = Number(button.dataset.prefGroupIndex);
          const optionIndex = Number(button.dataset.prefOptionIndex);
          if (action === 'remove-group') draftModifierGroups.splice(groupIndex, 1);
          if (action === 'remove-option' && draftModifierGroups[groupIndex]) draftModifierGroups[groupIndex].options.splice(optionIndex, 1);
          if (action === 'add-option' && draftModifierGroups[groupIndex]) draftModifierGroups[groupIndex].options.push({ id: `option-${Date.now()}`, name: 'گزینه جدید', price: 0, available: true });
          renderPreferences();
          savePreferences();
        });
        drawerEl.querySelector('#md-pref-add-group')?.addEventListener('click', () => {
          draftModifierGroups.push({ id: `group-${Date.now()}`, title: 'گروه ترجیح جدید', selection: 'multiple', required: false, options: [{ id: `option-${Date.now()}`, name: 'گزینه جدید', price: 0, available: true }] });
          renderPreferences();
          savePreferences();
        });
        drawerEl.querySelector('#md-pref-suggest')?.addEventListener('click', () => {
          const selectedCategory = cats.find((category) => Number(category.id) === Number(document.getElementById('md_cat')?.value));
          draftModifierGroups = suggestedModifierGroups(selectedCategory?.title || '');
          renderPreferences();
          savePreferences();
          __westoViewContext.showToast('پیشنهادهای متناسب با دسته ساخته شد');
        });

        const paintDrop = () => {
          const drop = document.getElementById('md-drop');
          if (!drop) return;
          const has = !!draftImg;
          drop.classList.toggle('has-img', has);
          drop.innerHTML = has
            ? `<img id="md-preview" src="${__westoViewContext.esc(imgSrc(draftImg))}" alt="" />
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">تغییر تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden />
                 </label>
                 <button type="button" class="btn btn-sm btn-ghost" id="md-img-clear">حذف تصویر</button>
               </div>`
            : `<div class="menu-studio__drop-hint">تصویر غذا را انتخاب کنید<br/><small>JPG / PNG / WebP</small></div>
               <div class="menu-studio__drop-actions">
                 <label class="btn btn-sm" style="cursor:pointer">انتخاب تصویر
                   <input type="file" id="md-file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden />
                 </label>
               </div>`;
          document.getElementById('md-file')?.addEventListener('change', async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            try {
              __westoViewContext.setSyncStatus('saving');
              const fd = new FormData();
              fd.append('file', file);
              const up = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body: fd });
              draftImg = up.path || '';
              if (!draftImg) throw new Error('بارگذاری ناموفق');
              paintDrop();
              if (editingId != null) await saveNow();
              else __westoViewContext.setSyncStatus('idle');
              __westoViewContext.showToast('تصویر ذخیره شد');
            } catch (err) {
              __westoViewContext.setSyncStatus('error', err.message);
              __westoViewContext.showToast(err.message || 'خطای بارگذاری');
            }
          });
          document.getElementById('md-img-clear')?.addEventListener('click', async () => {
            draftImg = '';
            paintDrop();
            if (editingId != null) {
              try {
                await saveNow();
              } catch (_) {}
            }
          });
        };
        paintDrop();

        if (isNew) {
          document.getElementById('md-create').onclick = async () => {
            try {
              await __westoViewContext.autosave(() => persistDrawer({ create: true }), { debounceMs: 0, silent: false })();
            } catch (_) {}
          };
        } else {
          __westoViewContext.bindAutosave(drawerEl, () => persistDrawer(), { debounceMs: 400, silent: true });
          drawerEl.querySelectorAll('[data-allergens-for] input, [data-dietary-for] input, [data-dayparts-for] input').forEach((inp) => {
            inp.addEventListener('change', () => saveNow());
          });
        }

        document.getElementById('md-avail')?.addEventListener('click', async () => {
          const nextAvail = document.getElementById('md-avail').dataset.val === 'true';
          try {
            const r = await __westoViewContext.api(`/api/menu/${editingId}`, {
              method: 'PATCH',
              body: JSON.stringify({ available: nextAvail }),
            });
            __westoViewContext.showToast(nextAvail ? 'موجود شد' : 'ناموجود شد');
            patchRow(r.item);
            openDrawer(r.item);
          } catch (err) {
            __westoViewContext.showToast(err.message);
          }
        });

        document.getElementById('md-del')?.addEventListener('click', async () => {
          if (!confirm('این محصول حذف شود؟')) return;
          try {
            await __westoViewContext.api(`/api/menu/${editingId}`, { method: 'DELETE' });
            __westoViewContext.showToast('حذف شد');
            const id = editingId;
            __westoViewContext.state.menuItems = __westoViewContext.state.menuItems.filter((x) => x.id !== id);
            __westoViewContext.state._menuAllItems = (__westoViewContext.state._menuAllItems || []).filter((x) => x.id !== id);
            listEl.querySelector(`[data-mid="${id}"]`)?.remove();
            if (!listEl.querySelector('.menu-studio__row')) {
              listEl.innerHTML = '<div class="menu-studio__empty">محصولی در این دسته نیست — «افزودن غذا» را بزنید.</div>';
            }
            closeDrawer();
          } catch (err) {
            __westoViewContext.showToast(err.message);
          }
        });
      };

      function wireListRow(row) {
        if (!row) return;
        const id = Number(row.dataset.mid);
        const open = () => {
          const item = (__westoViewContext.state._menuAllItems || __westoViewContext.state.menuItems).find((m) => m.id === id);
          if (item) openDrawer(item);
        };
        row.addEventListener('click', (e) => {
          if (e.target.closest('.inline-price-editor, [data-quick-edit-price], [data-quick-price-trigger], [data-mavail], [data-quick-create-recipe]')) return;
          open();
        });
        row.addEventListener('keydown', (e) => {
          if (e.target.matches('input, select, textarea, button')) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          } else if (e.key.toLowerCase() === 'e') {
            e.preventDefault();
            open();
          } else if (e.key.toLowerCase() === 'p') {
            e.preventDefault();
            triggerQuickPrice();
          }
        });
        row.querySelector('[data-medit]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          open();
        });

        // Quick create recipe jump to inventory tab
        row.querySelector('[data-quick-create-recipe]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          __westoViewContext.tabs.inventory().then(() => {
            const item = (__westoViewContext.state._menuAllItems || __westoViewContext.state.menuItems).find((m) => m.id === id);
            if (item) {
              const modalBtn = document.querySelector('[data-inv-open-form="recipe"]');
              if (modalBtn) modalBtn.click();
              setTimeout(() => {
                const select = document.querySelector('#select-menu-item');
                if (select) {
                  select.value = item.id;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }, 150);
            }
          }).catch((err) => __westoViewContext.showToast(err.message));
        });

        // Inline Price Quick-Editor
        const priceDisplay = row.querySelector(`[data-quick-price-trigger="${id}"]`);
        const inlineEditor = row.querySelector(`[data-inline-editor="${id}"]`);
        const inlineInput = inlineEditor?.querySelector('.inline-price-input');

        const triggerQuickPrice = () => {
          if (!inlineEditor || !priceDisplay) return;
          priceDisplay.style.display = 'none';
          inlineEditor.style.display = 'inline-flex';
          if (inlineInput) {
            inlineInput.focus();
            inlineInput.select();
          }
        };

        const closeQuickPrice = () => {
          if (!inlineEditor || !priceDisplay) return;
          inlineEditor.style.display = 'none';
          priceDisplay.style.display = 'inline-block';
        };

        priceDisplay?.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerQuickPrice();
        });
        row.querySelector(`[data-quick-edit-price="${id}"]`)?.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerQuickPrice();
        });

        inlineEditor?.querySelectorAll('.btn-nudge').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const delta = Number(btn.dataset.nudge) || 0;
            const current = Number(inlineInput.value) || 0;
            inlineInput.value = Math.max(0, current + delta);
          });
        });

        const saveQuickPrice = async () => {
          const newPrice = Math.max(0, Math.round(Number(inlineInput.value) || 0));
          try {
            const r = await __westoViewContext.api(`/api/menu/${id}`, {
              method: 'PATCH',
              body: JSON.stringify({ price: newPrice }),
            });
            const updated = r.item;
            __westoViewContext.state._menuAllItems = (__westoViewContext.state._menuAllItems || []).map((x) => (x.id === updated.id ? updated : x));
            __westoViewContext.state.menuItems = __westoViewContext.state.menuItems.map((x) => (x.id === updated.id ? updated : x));
            patchRow(updated);
            const freshRow = listEl.querySelector(`[data-mid="${id}"]`);
            if (freshRow) {
              freshRow.classList.add('is-price-updated');
              setTimeout(() => freshRow.classList.remove('is-price-updated'), 1200);
            }
            __westoViewContext.showToast(`قیمت «${updated.name}» به ${__westoViewContext.fmtMoney(updated.price)} تغییر کرد`);
          } catch (err) {
            __westoViewContext.showToast(err.message || 'خطا در ذخیره قیمت');
            closeQuickPrice();
          }
        };

        inlineEditor?.querySelector('.inline-price-save')?.addEventListener('click', (e) => {
          e.stopPropagation();
          saveQuickPrice();
        });

        inlineEditor?.querySelector('.inline-price-cancel')?.addEventListener('click', (e) => {
          e.stopPropagation();
          closeQuickPrice();
        });

        inlineInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            saveQuickPrice();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeQuickPrice();
          }
        });

        row.querySelector('[data-mavail]')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          try {
            const r = await __westoViewContext.api(`/api/menu/${btn.dataset.mavail}`, {
              method: 'PATCH',
              body: JSON.stringify({ available: btn.dataset.val === 'true' }),
            });
            const updated = r.item;
            __westoViewContext.state._menuAllItems = (__westoViewContext.state._menuAllItems || []).map((x) => (x.id === updated.id ? updated : x));
            __westoViewContext.state.menuItems = __westoViewContext.state.menuItems.map((x) => (x.id === updated.id ? updated : x));
            patchRow(updated);
            __westoViewContext.showToast(updated.available === false ? 'ناموجود شد' : 'موجود شد');
          } catch (err) {
            __westoViewContext.showToast(err.message);
          }
        });
      }

      function openBulkPriceModal(activeCat) {
        let modalEl = document.getElementById('menu-bulk-modal');
        if (!modalEl) {
          modalEl = document.createElement('div');
          modalEl.id = 'menu-bulk-modal';
          modalEl.className = 'inv-modal-backdrop';
          document.body.appendChild(modalEl);
        }
        const items = __westoViewContext.state.menuItems || [];
        let selectedPct = 10;

        const renderModal = () => {
          const factor = 1 + (selectedPct / 100);
          const previewRows = items.map((m) => {
            const oldP = m.price || 0;
            const newP = Math.max(0, Math.round((oldP * factor) / 1000) * 1000);
            const diff = newP - oldP;
            const diffClass = diff >= 0 ? 'bulk-diff-up' : 'bulk-diff-down';
            const diffSign = diff > 0 ? '+' : '';
            return `<tr>
              <td><strong>${__westoViewContext.esc(m.name)}</strong></td>
              <td>${__westoViewContext.fmtMoney(oldP)}</td>
              <td><strong>${__westoViewContext.fmtMoney(newP)}</strong></td>
              <td class="${diffClass}">${diffSign}${__westoViewContext.fmtMoney(diff)}</td>
            </tr>`;
          }).join('');

          modalEl.innerHTML = `
            <div class="inv-modal bulk-price-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
              <div class="inv-modal__header">
                <div>
                  <span class="inv-eyebrow">تنظیم گروهی قیمت‌ها · ${__westoViewContext.esc(activeCat?.title || 'کل دسته')}</span>
                  <h2 id="bulk-title">تغییر درصدی قیمت‌های این دسته</h2>
                  <p>قیمت غذاها به ضریب انتخابی تغییر کرده و به نزدیک‌ترین ۱,۰۰۰ تومان رند می‌شود.</p>
                </div>
                <button type="button" class="inv-modal__close" id="bulk-close" aria-label="بستن">×</button>
              </div>
              <div class="inv-modal__body">
                <div class="bulk-price-options">
                  <button type="button" class="bulk-pct-chip${selectedPct === 5 ? ' is-active' : ''}" data-bpct="5">+۵٪</button>
                  <button type="button" class="bulk-pct-chip${selectedPct === 10 ? ' is-active' : ''}" data-bpct="10">+۱۰٪</button>
                  <button type="button" class="bulk-pct-chip${selectedPct === 15 ? ' is-active' : ''}" data-bpct="15">+۱۵٪</button>
                  <button type="button" class="bulk-pct-chip${selectedPct === 20 ? ' is-active' : ''}" data-bpct="20">+۲۰٪</button>
                  <button type="button" class="bulk-pct-chip${selectedPct === -5 ? ' is-active' : ''}" data-bpct="-5">-۵٪</button>
                  <button type="button" class="bulk-pct-chip${selectedPct === -10 ? ' is-active' : ''}" data-bpct="-10">-۱۰٪</button>
                </div>
                <div class="bulk-preview-table-wrap">
                  <table class="bulk-preview-table">
                    <thead>
                      <tr><th>غذا</th><th>قیمت فعلی</th><th>قیمت جدید</th><th>اختلاف</th></tr>
                    </thead>
                    <tbody>${previewRows || '<tr><td colspan="4" style="text-align:center;">محصولی برای نمایش نیست</td></tr>'}</tbody>
                  </table>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem;">
                  <span style="font-size:0.75rem; color:var(--p-text-dim);">تعداد اقلام: ${fa(items.length)}</span>
                  <div style="display:flex; gap:0.5rem;">
                    <button type="button" class="btn btn-sm btn-ghost" id="bulk-cancel">انصراف</button>
                    <button type="button" class="btn btn-sm btn-primary" id="bulk-confirm">تأیید و اعمال قیمت‌های جدید</button>
                  </div>
                </div>
              </div>
            </div>`;

          modalEl.style.display = 'grid';
          document.body.classList.add('inv-modal-open');

          modalEl.querySelector('#bulk-close').onclick = closeBulkModal;
          modalEl.querySelector('#bulk-cancel').onclick = closeBulkModal;
          modalEl.querySelectorAll('[data-bpct]').forEach((btn) => {
            btn.onclick = () => {
              selectedPct = Number(btn.dataset.bpct);
              renderModal();
            };
          });

          modalEl.querySelector('#bulk-confirm').onclick = async () => {
            const btn = modalEl.querySelector('#bulk-confirm');
            btn.disabled = true;
            btn.textContent = 'در حال ثبت…';
            try {
              const res = await __westoViewContext.api('/api/admin/menu/bulk-adjust-prices', {
                method: 'POST',
                body: JSON.stringify({
                  categoryId: catId,
                  percentChange: selectedPct,
                  roundToNearest: 1000,
                }),
              });
              closeBulkModal();
              __westoViewContext.showToast(`قیمت ${fa(res.updatedCount)} غذا بروزرسانی شد`);
              __westoViewContext.tabs.menu(catId, { q: searchQ });
            } catch (err) {
              __westoViewContext.showToast(err.message || 'خطا در تغییر گروهی قیمت');
              btn.disabled = false;
              btn.textContent = 'تأیید و اعمال قیمت‌های جدید';
            }
          };
        };

        const closeBulkModal = () => {
          modalEl.style.display = 'none';
          document.body.classList.remove('inv-modal-open');
        };

        renderModal();
      }

      listEl.querySelectorAll('.menu-studio__row').forEach(wireListRow);

      document.getElementById('menu-cats').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        __westoViewContext.tabs.menu(Number(btn.dataset.cat), { q: searchQ, dietary: dietaryFilter }).catch((err) => __westoViewContext.showToast(err.message));
      });

      let searchTimer = null;
      document.getElementById('menu-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const q = e.target.value;
        searchTimer = setTimeout(() => {
          __westoViewContext.tabs.menu(catId, { q, dietary: dietaryFilter }).catch((err) => __westoViewContext.showToast(err.message));
        }, 220);
      });

      document.querySelector('.menu-filters-strip')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.menu-filter-chip');
        if (!chip) return;
        const dfilter = chip.dataset.dfilter;
        __westoViewContext.tabs.menu(catId, { q: searchQ, dietary: dfilter }).catch((err) => __westoViewContext.showToast(err.message));
      });

      document.getElementById('menu-bulk-price')?.addEventListener('click', () => {
        const activeCat = cats.find((c) => c.id === catId);
        openBulkPriceModal(activeCat);
      });

      document.getElementById('menu-add').onclick = () => openDrawer(emptyDraft());
      document.getElementById('go-carousel-cats').onclick = () =>
        __westoViewContext.tabs.products().catch((e) => __westoViewContext.showToast(e.message));

      if (opts.openId) {
        const item = allItems.find((m) => m.id === Number(opts.openId));
        if (item) openDrawer(item);
      } else if (opts.openNew) {
        openDrawer(emptyDraft());
      }
    }
}['menu'];
});
/*westo-view:end:menu*/

/*westo-view:start:translate*/
window.WestoAdminModules.defineView('menu_qr', 'translate', function(__westoViewContext) {
return {
async translate() {
      __westoViewContext.setActiveTab('translate');
      const d = await __westoViewContext.api('/api/admin/i18n');
      const st = d.stats || {};
      const i18n = d.i18n || {};
      const menu = await __westoViewContext.api('/api/menu?all=1');
      const items = menu.menuItems || [];
      const missing = items.filter((m) => !String(m.en || '').trim() || (m.desc && !String(m.descEn || '').trim()));
      __westoViewContext.main.innerHTML = `
        <h1>ترجمه منو به انگلیسی و عربی</h1>
        <p class="lead">نام و توضیح محصولات را برای مهمانان انگلیسی و عربی آماده کنید. ترجمه انگلیسی با ${st.engine === 'openai' ? 'مترجم خودکار' : 'واژه‌نامه داخلی'} پیشنهاد می‌شود و متن عربی را می‌توانید بازبینی یا دستی وارد کنید.</p>
        <div class="cards">
          <div class="card"><div class="num">${__westoViewContext.fmtNum(st.total || 0)}</div><div class="lbl">کل محصولات</div></div>
          <div class="card accent"><div class="num">${__westoViewContext.fmtNum(st.withEn || 0)}</div><div class="lbl">دارای نام انگلیسی</div></div>
          <div class="card warn"><div class="num">${__westoViewContext.fmtNum(st.missingEn || 0)}</div><div class="lbl">بدون نام انگلیسی</div></div>
          <div class="card accent"><div class="num">${__westoViewContext.fmtNum(st.withAr || 0)}</div><div class="lbl">دارای نام عربی</div></div>
          <div class="card warn"><div class="num">${__westoViewContext.fmtNum(st.missingAr || 0)}</div><div class="lbl">بدون نام عربی</div></div>
        </div>
        <div class="section-box">
          <h2>تنظیمات مهمان</h2>
          <label class="chk" style="display:inline-flex;margin-bottom:0.75rem;"><input type="checkbox" id="i18n_enabled" ${i18n.guestLangEnabled !== false ? 'checked' : ''} /> نمایش سوییچ زبان در منوی عمومی</label>
          <div class="field" style="max-width:220px;">
            <label>زبان پیش‌فرض</label>
            <select id="i18n_default">
              <option value="fa" ${i18n.defaultLang === 'fa' || !i18n.defaultLang ? 'selected' : ''}>فارسی</option>
              <option value="en" ${i18n.defaultLang === 'en' ? 'selected' : ''}>انگلیسی</option>
              <option value="ar" ${i18n.defaultLang === 'ar' ? 'selected' : ''}>عربی</option>
            </select>
          </div>
          <div class="row-actions">
            <span class="hint">ذخیره خودکار تنظیمات</span>
            <button class="btn btn-sm" id="tr-missing">ترجمه موارد ناقص انگلیسی (${__westoViewContext.fmtNum(missing.length)})</button>
            <button class="btn btn-sm btn-ghost" id="tr-force">بازنویسی همه ترجمه‌های انگلیسی</button>
          </div>
        </div>
        <div class="section-box">
          <h2>بازبینی سریع</h2>
          <p class="hint">تغییر ردیف‌ها خودکار ذخیره می‌شود</p>
          <table class="tbl"><thead><tr><th>فارسی</th><th>انگلیسی</th><th>عربی</th><th>توضیح انگلیسی</th><th>توضیح عربی</th><th></th></tr></thead><tbody>
            ${items
              .slice(0, 40)
              .map(
                (m) => `<tr data-tid="${m.id}">
                  <td>${__westoViewContext.esc(m.name)}</td>
                  <td><input class="ltr-input tr-en" dir="ltr" value="${__westoViewContext.esc(m.en || '')}" /></td>
                  <td><input class="ltr-input tr-ar" dir="rtl" value="${__westoViewContext.esc(m.ar || '')}" /></td>
                  <td><input class="ltr-input tr-desc" dir="ltr" value="${__westoViewContext.esc(m.descEn || '')}" /></td>
                  <td><input class="ltr-input tr-desc-ar" dir="rtl" value="${__westoViewContext.esc(m.descAr || '')}" /></td>
                  <td><button class="btn btn-sm btn-ghost" data-trai="${m.id}">ترجمه خودکار</button></td>
                </tr>`
              )
              .join('') || '<tr><td colspan="6">محصولی یافت نشد</td></tr>'}
          </tbody></table>
        </div>`;

      const saveI18nSettings = async () => {
        try {
          await __westoViewContext.api('/api/admin/i18n', {
            method: 'PUT',
            body: JSON.stringify({
              guestLangEnabled: document.getElementById('i18n_enabled').checked,
              defaultLang: document.getElementById('i18n_default').value,
            }),
          });
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره تنظیمات زبان', 'error');
        }
      };
      document.getElementById('i18n_enabled')?.addEventListener('change', __westoViewContext.autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('i18n_default')?.addEventListener('change', __westoViewContext.autosave(saveI18nSettings, { debounceMs: 0, silent: true }));
      document.getElementById('tr-missing')?.addEventListener('click', async () => {
        __westoViewContext.showToast('در حال ترجمه…');
        try {
          const r = await __westoViewContext.api('/api/admin/translate/menu', {
            method: 'POST',
            body: JSON.stringify({ onlyMissing: true }),
          });
          __westoViewContext.showToast(`${r.count} محصول ترجمه شد (${r.engine})`);
          __westoViewContext.tabs.translate();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ترجمه منو', 'error');
        }
      });
      document.getElementById('tr-force')?.addEventListener('click', async () => {
        if (!confirm('همه ترجمه‌های انگلیسی بازنویسی شوند؟')) return;
        __westoViewContext.showToast('در حال بازنویسی…');
        try {
          const r = await __westoViewContext.api('/api/admin/translate/menu', {
            method: 'POST',
            body: JSON.stringify({ force: true, onlyMissing: false }),
          });
          __westoViewContext.showToast(`${r.count} محصول به‌روز شد`);
          __westoViewContext.tabs.translate();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در بازنویسی ترجمه‌ها', 'error');
        }
      });
      __westoViewContext.main.querySelectorAll('[data-trai]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            const r = await __westoViewContext.api(`/api/admin/translate/menu/${btn.dataset.trai}`, {
              method: 'POST',
              body: JSON.stringify({ force: true }),
            });
            const tr = btn.closest('tr');
            if (tr) {
              tr.querySelector('.tr-en').value = r.item.en || '';
              tr.querySelector('.tr-desc').value = r.item.descEn || '';
            }
            __westoViewContext.showToast('ترجمه شد');
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ترجمه خودکار', 'error');
          }
        })
      );
      __westoViewContext.main.querySelectorAll('tr[data-tid]').forEach((tr) => {
        const saveRow = async () => {
          try {
            await __westoViewContext.api(`/api/menu/${tr.dataset.tid}`, {
              method: 'PUT',
              body: JSON.stringify({
                en: tr.querySelector('.tr-en').value,
                ar: tr.querySelector('.tr-ar')?.value || '',
                descEn: tr.querySelector('.tr-desc').value,
                descAr: tr.querySelector('.tr-desc-ar')?.value || '',
              }),
            });
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ذخیره ترجمه سطر', 'error');
          }
        };
        const run = __westoViewContext.autosave(saveRow, { debounceMs: 400, silent: true });
        tr.querySelectorAll('input').forEach((inp) => {
          inp.addEventListener('input', run);
          inp.addEventListener('change', run);
        });
      });
    }
}['translate'];
});
/*westo-view:end:translate*/

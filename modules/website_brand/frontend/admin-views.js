/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:restaurant*/
window.WestoAdminModules.defineView('website_brand', 'restaurant', function(__westoViewContext) {
return {
async restaurant() {
      __westoViewContext.setActiveTab('restaurant');
      const d = await __westoViewContext.api('/api/admin/restaurant');
      const r = d.restaurant || {};
      __westoViewContext.main.innerHTML = `
        <h1>اطلاعات مجموعه</h1>
        <p class="lead">پروفایل کافه‌رستوران — نام، آدرس، تماس و معرفی (مشابه «اطلاعات مجموعه» در تاپ منو).</p>
        <div class="section-box">
          <div class="grid-2">
            ${__westoViewContext.field('نام مجموعه', 'r_name', r.name || '')}
            ${__westoViewContext.field('برند نمایشی', 'r_brand', r.brandName || '')}
            ${__westoViewContext.field('شعار', 'r_tag', r.tagline || '')}
            ${__westoViewContext.field('واحد پول', 'r_cur', r.currency || 'تومان')}
            ${__westoViewContext.field('آدرس', 'r_addr', r.address || '')}
            ${__westoViewContext.field('تلفن', 'r_phone', r.phone || '', { ltr: true })}
            ${__westoViewContext.field('اینستاگرام', 'r_ig', r.instagram || '', { ltr: true })}
            ${__westoViewContext.field('وب‌سایت', 'r_web', r.website || '', { ltr: true })}
            ${__westoViewContext.field('مالیات ٪', 'r_tax', String(r.taxPercent ?? 0), { ltr: true, type: 'number' })}
            ${__westoViewContext.field('سرویس ٪', 'r_svc', String(r.servicePercent ?? 0), { ltr: true, type: 'number' })}
          </div>
          ${__westoViewContext.field('درباره مجموعه', 'r_about', r.about || '', { textarea: true })}
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>`;
      const saveRestaurant = async () => {
        try {
          await __westoViewContext.api('/api/admin/restaurant', {
            method: 'PUT',
            body: JSON.stringify({
              restaurant: {
                name: document.getElementById('r_name')?.value || '',
                brandName: document.getElementById('r_brand')?.value || '',
                tagline: document.getElementById('r_tag')?.value || '',
                address: document.getElementById('r_addr')?.value || '',
                phone: document.getElementById('r_phone')?.value || '',
                instagram: document.getElementById('r_ig')?.value || '',
                website: document.getElementById('r_web')?.value || '',
                currency: document.getElementById('r_cur')?.value || '',
                about: document.getElementById('r_about')?.value || '',
                taxPercent: __westoViewContext.parseInputNumber(document.getElementById('r_tax')?.value) || 0,
                servicePercent: __westoViewContext.parseInputNumber(document.getElementById('r_svc')?.value) || 0,
              },
            }),
          });
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره اطلاعات مجموعه', 'error');
        }
      };
      __westoViewContext.bindAutosave(__westoViewContext.main, saveRestaurant);
    }
}['restaurant'];
});
/*westo-view:end:restaurant*/

/*westo-view:start:theme*/
window.WestoAdminModules.defineView('website_brand', 'theme', function(__westoViewContext) {
return {
async theme() {
      __westoViewContext.setActiveTab('theme');
      const d = await __westoViewContext.api('/api/admin/theme');
      const t = d.theme || {};
      const defaults = {
        accent: '#78d0d8',
        accentInk: '#0a1a1c',
        surface: '#111318',
        bg: '#08090b',
        fog: '#ece8e2',
        printPaper: '#f7f3ec',
        printInk: '#1a1714',
        printAccent: '#2a7a86',
        radius: 14,
        fontDisplay: 'Vazirmatn',
      };
      const v = { ...defaults, ...t };
      __westoViewContext.main.innerHTML = `
        <h1>ظاهر و هویت برند</h1>
        <p class="lead">رنگ پنل، منوی چاپی و هویت بصری مجموعه را یک‌جا تنظیم کنید.</p>
        <div class="section-box">
          <h2>پیش‌نمایش زنده</h2>
          <div class="theme-preview" id="theme-preview">
            <div class="theme-preview__bar">مرکز فرمان</div>
            <div class="theme-preview__card">
              <strong>نمونه کارت</strong>
              <button type="button" class="btn btn-sm" style="width:auto;margin-top:0.6rem;">دکمه نمونه</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>رنگ‌های پنل</h2>
          <div class="grid-2">
            ${__westoViewContext.colorField('رنگ تأکیدی', 'th_accent', v.accent)}
            ${__westoViewContext.colorField('متن روی رنگ تأکیدی', 'th_accentInk', v.accentInk)}
            ${__westoViewContext.colorField('سطح', 'th_surface', v.surface)}
            ${__westoViewContext.colorField('پس‌زمینه', 'th_bg', v.bg)}
            ${__westoViewContext.colorField('متن اصلی', 'th_fog', v.fog)}
            ${__westoViewContext.field('شعاع گوشه (پیکسل)', 'th_radius', String(v.radius), { ltr: true, type: 'number' })}
            ${__westoViewContext.field('قلم نمایشی', 'th_font', v.fontDisplay)}
          </div>
        </div>
        <div class="section-box">
          <h2>منوی چاپی</h2>
          <div class="grid-2">
            ${__westoViewContext.colorField('کاغذ', 'th_printPaper', v.printPaper)}
            ${__westoViewContext.colorField('مرکب', 'th_printInk', v.printInk)}
            ${__westoViewContext.colorField('رنگ تأکیدی چاپ', 'th_printAccent', v.printAccent)}
          </div>
        </div>
        <div class="row-actions">
          <span class="hint">ذخیره خودکار</span>
          <button class="btn btn-sm btn-ghost" id="th-reset">بازگشت به پیش‌فرض</button>
          <a class="btn btn-sm btn-ghost" href="/menu-print" target="_blank" rel="noopener" style="text-decoration:none;width:auto;">پیش‌نمایش چاپ</a>
        </div>`;

      const saveTheme = async () => {
        try {
          const theme = __westoViewContext.readThemeForm();
          await __westoViewContext.api('/api/admin/theme', { method: 'PUT', body: JSON.stringify({ theme }) });
          __westoViewContext.applyTheme(theme);
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره تنظیمات ظاهر', 'error');
        }
      };
      const themeAutosave = __westoViewContext.autosave(saveTheme, { debounceMs: 400, silent: true });

      ['th_accent', 'th_accentInk', 'th_surface', 'th_bg', 'th_fog', 'th_printPaper', 'th_printInk', 'th_printAccent'].forEach((id) => {
        __westoViewContext.wireColorPair(id);
        document.getElementById(id)?.addEventListener('input', themeAutosave);
        document.getElementById(`${id}_hex`)?.addEventListener('change', themeAutosave);
        document.getElementById(`${id}_hex`)?.addEventListener('input', themeAutosave);
      });
      document.getElementById('th_radius')?.addEventListener('input', () => {
        __westoViewContext.applyTheme(__westoViewContext.readThemeForm());
        themeAutosave();
      });
      document.getElementById('th_font')?.addEventListener('input', themeAutosave);
      __westoViewContext.applyTheme(v);

      document.getElementById('th-reset').addEventListener('click', async () => {
        await __westoViewContext.api('/api/admin/theme', { method: 'PUT', body: JSON.stringify({ theme: defaults }) });
        __westoViewContext.showToast('ظاهر پیش‌فرض اعمال شد');
        __westoViewContext.tabs.theme();
      });
    }
}['theme'];
});
/*westo-view:end:theme*/

/*westo-view:start:hours*/
window.WestoAdminModules.defineView('website_brand', 'hours', function(__westoViewContext) {
return {
async hours() {
      __westoViewContext.setActiveTab('hours');
      const d = await __westoViewContext.api(`/api/admin/restaurant${__westoViewContext.branchQs()}`);
      const hours = d.hours || {};
      const br = d.branch || __westoViewContext.currentBranch();
      
      const JS_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const todayKey = JS_DAYS[new Date().getDay()];
      const todayLabel = __westoViewContext.DAY_LABELS[todayKey] || 'امروز';
      const todayHours = hours[todayKey] || { open: '10:00', close: '23:30', closed: false };
      const isTodayClosed = Boolean(todayHours.closed);

      __westoViewContext.main.innerHTML = `
        <h1>ساعت کاری</h1>
        <p class="lead">زمان‌بندی هفتگی و وضعیت فعالیت مجموعه${br ? ` — <strong>${__westoViewContext.esc(br.name)}</strong>` : ''}.</p>
        
        <!-- Emergency & Quick Closure Control Card -->
        <div id="today-closure-box" class="card" style="margin-bottom: 1.25rem; padding: 1.15rem 1.25rem; border-radius: 14px; border: 1px solid var(--p-border, rgba(255,255,255,0.1)); background: ${isTodayClosed ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.06)'}; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="flex: 1; min-width: 260px;">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.35rem;">
              <span id="today-status-icon" style="font-size:1.3rem;">${isTodayClosed ? '⛔' : '🟢'}</span>
              <strong style="font-size:1.05rem;">وضعیت امروز (${todayLabel}): <span id="today-status-text" style="color: ${isTodayClosed ? '#f87171' : '#4ade80'};">${isTodayClosed ? 'تعطیل (عدم سرویس‌دهی)' : `باز است (${__westoViewContext.esc(todayHours.open)} تا ${__westoViewContext.esc(todayHours.close)})`}</span></strong>
            </div>
            <p class="hint" style="margin:0; font-size:0.85rem; color:var(--p-text-dim);">در صورت تعمیرات، تغییرات دکوراسیون، رویداد خصوصی یا تعطیلی اضطراری، با دکمه روبرو وضعیت امروز را تغییر دهید.</p>
          </div>
          <div>
            <button id="btn-toggle-today" class="btn ${isTodayClosed ? 'btn-primary' : 'btn-ghost'}" style="${isTodayClosed ? 'background:#10b981; color:#fff;' : 'border-color:#ef4444; color:#f87171;'} font-weight:800; padding:0.65rem 1.25rem; min-width:200px;" type="button">
              ${isTodayClosed ? '✅ بازگشایی امروز (برگشت به ساعت عادی)' : '⛔ تعطیل کردن مجموعه برای امروز'}
            </button>
          </div>
        </div>

        <div class="section-box">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.85rem;">
            <strong>جدول ساعات کاری هفتگی</strong>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button id="btn-close-all" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">تعطیل کردن تمام هفته</button>
              <button id="btn-open-all" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">بازگشایی تمام روزها</button>
              <button id="btn-reset-standard" class="btn btn-sm btn-ghost" type="button" style="font-size:0.78rem;">ساعت استاندارد (۱۰ تا ۲۳:۳۰)</button>
            </div>
          </div>

          <table class="tbl hours-tbl"><thead><tr><th>روز</th><th>باز</th><th>بسته</th><th>تعطیل</th></tr></thead><tbody>
            ${Object.keys(__westoViewContext.DAY_LABELS)
              .map((k) => {
                const h = hours[k] || { open: '10:00', close: '23:00', closed: false };
                const isCurrentDay = (k === todayKey);
                return `<tr data-day="${k}" style="${isCurrentDay ? 'background: rgba(120,208,216,0.08); font-weight: 600;' : ''}">
                  <td>
                    ${__westoViewContext.DAY_LABELS[k]}
                    ${isCurrentDay ? '<span class="pill sm" style="margin-right:0.4rem; background:rgba(120,208,216,0.2); color:var(--p-accent, #78d0d8); font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:6px;">امروز</span>' : ''}
                  </td>
                  <td><input class="h-open" type="time" value="${__westoViewContext.esc(h.open)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><input class="h-close" type="time" value="${__westoViewContext.esc(h.close)}" ${h.closed ? 'disabled' : ''} /></td>
                  <td><label class="chk"><input class="h-closed" type="checkbox" ${h.closed ? 'checked' : ''} /> تعطیل</label></td>
                </tr>`;
              })
              .join('')}
          </tbody></table>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار با هر تغییر</p>
        </div>`;

      const updateTodayBanner = (closed) => {
        const box = document.getElementById('today-closure-box');
        const icon = document.getElementById('today-status-icon');
        const text = document.getElementById('today-status-text');
        const btn = document.getElementById('btn-toggle-today');
        const todayTr = __westoViewContext.main.querySelector(`tr[data-day="${todayKey}"]`);
        const openTime = todayTr?.querySelector('.h-open')?.value || '10:00';
        const closeTime = todayTr?.querySelector('.h-close')?.value || '23:30';

        if (box) box.style.background = closed ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.06)';
        if (icon) icon.textContent = closed ? '⛔' : '🟢';
        if (text) {
          text.textContent = closed ? 'تعطیل (عدم سرویس‌دهی)' : `باز است (${openTime} تا ${closeTime})`;
          text.style.color = closed ? '#f87171' : '#4ade80';
        }
        if (btn) {
          btn.textContent = closed ? '✅ بازگشایی امروز (برگشت به ساعت عادی)' : '⛔ تعطیل کردن مجموعه برای امروز';
          btn.style.background = closed ? '#10b981' : '';
          btn.style.color = closed ? '#fff' : '#f87171';
          btn.style.borderColor = closed ? '' : '#ef4444';
          btn.className = `btn ${closed ? 'btn-primary' : 'btn-ghost'}`;
        }
      };

      const saveHours = async (showSuccessToast = false) => {
        const payload = {};
        __westoViewContext.main.querySelectorAll('tr[data-day]').forEach((tr) => {
          payload[tr.dataset.day] = {
            open: tr.querySelector('.h-open').value,
            close: tr.querySelector('.h-close').value,
            closed: tr.querySelector('.h-closed').checked,
          };
        });
        try {
          await __westoViewContext.api('/api/admin/hours', {
            method: 'PUT',
            body: JSON.stringify({ hours: payload, branchId: __westoViewContext.currentBranchId }),
          });
          if (showSuccessToast) {
            __westoViewContext.showToast('وضعیت ساعات کاری با موفقیت ذخیره شد.', 'success');
          }
        } catch (err) {
          __westoViewContext.showToast(err.message || 'خطا در ذخیره ساعات کاری', 'error');
        }
      };

      const hoursAutosave = __westoViewContext.autosave(() => saveHours(false), { debounceMs: 400, silent: true });

      // Toggle Today's status button
      const toggleTodayBtn = document.getElementById('btn-toggle-today');
      if (toggleTodayBtn) {
        toggleTodayBtn.addEventListener('click', async () => {
          const todayTr = __westoViewContext.main.querySelector(`tr[data-day="${todayKey}"]`);
          if (!todayTr) return;
          const cb = todayTr.querySelector('.h-closed');
          const isCurrentlyClosed = cb.checked;
          const nextClosed = !isCurrentlyClosed;
          
          cb.checked = nextClosed;
          todayTr.querySelectorAll('.h-open, .h-close').forEach((inp) => {
            inp.disabled = nextClosed;
          });

          updateTodayBanner(nextClosed);
          await saveHours(false);
          __westoViewContext.showToast(nextClosed ? 'وضعیت امروز به «تعطیل» تغییر یافت ⛔' : 'امروز مجدداً «باز» شد ✅', nextClosed ? 'info' : 'success');
        });
      }

      // Bulk close all days
      const btnCloseAll = document.getElementById('btn-close-all');
      if (btnCloseAll) {
        btnCloseAll.addEventListener('click', async () => {
          __westoViewContext.main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = true;
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = true; });
          });
          updateTodayBanner(true);
          await saveHours(true);
        });
      }

      // Bulk open all days
      const btnOpenAll = document.getElementById('btn-open-all');
      if (btnOpenAll) {
        btnOpenAll.addEventListener('click', async () => {
          __westoViewContext.main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = false;
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = false; });
          });
          updateTodayBanner(false);
          await saveHours(true);
        });
      }

      // Reset to standard hours (10:00 to 23:30)
      const btnResetStd = document.getElementById('btn-reset-standard');
      if (btnResetStd) {
        btnResetStd.addEventListener('click', async () => {
          __westoViewContext.main.querySelectorAll('tr[data-day]').forEach((tr) => {
            const cb = tr.querySelector('.h-closed');
            cb.checked = false;
            tr.querySelector('.h-open').value = '10:00';
            tr.querySelector('.h-close').value = '23:30';
            tr.querySelectorAll('.h-open, .h-close').forEach((inp) => { inp.disabled = false; });
          });
          updateTodayBanner(false);
          await saveHours(true);
        });
      }

      __westoViewContext.main.querySelectorAll('.h-closed').forEach((cb) => {
        cb.addEventListener('change', () => {
          const tr = cb.closest('tr');
          tr.querySelectorAll('.h-open, .h-close').forEach((inp) => {
            inp.disabled = cb.checked;
          });
          if (tr.dataset.day === todayKey) {
            updateTodayBanner(cb.checked);
          }
          hoursAutosave();
        });
      });

      __westoViewContext.main.querySelectorAll('.h-open, .h-close').forEach((inp) => {
        inp.addEventListener('change', () => {
          const tr = inp.closest('tr');
          if (tr && tr.dataset.day === todayKey) {
            const cb = tr.querySelector('.h-closed');
            updateTodayBanner(cb.checked);
          }
          hoursAutosave();
        });
        inp.addEventListener('input', hoursAutosave);
      });
    }
}['hours'];
});
/*westo-view:end:hours*/

/*westo-view:start:promoSlides*/
window.WestoAdminModules.defineView('website_brand', 'promoSlides', function(__westoViewContext) {
return {
async promoSlides() {
      __westoViewContext.setActiveTab('promoSlides');
      const d = await __westoViewContext.api('/api/admin/promo-slides');
      const slides = (d.slides || []).slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
      const branches = (d.branches || []).filter((b) => b && b.active !== false);
      const dtLocal = (value) => value ? String(value).slice(0, 16) : '';
      const option = (value, label, selected) => `<option value="${__westoViewContext.esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${__westoViewContext.esc(label)}</option>`;
      const kindOptions = [
        ['general', 'عمومی'], ['instagram', 'اینستاگرام'], ['chef-special', 'ویژه سرآشپز'],
        ['event', 'رویداد'], ['offer', 'پیشنهاد ویژه'], ['announcement', 'اطلاعیه'],
      ];
      const actionOptions = [
        ['none', 'بدون اقدام'], ['url', 'لینک خارجی'], ['instagram', 'اینستاگرام'],
        ['internal', 'صفحه داخلی'], ['category', 'دسته منو'], ['dish', 'غذا'],
      ];
      const placementOptions = [
        ['entrance', 'صفحه ورود — داخل بخش تجربه'],
      ];
      const slideCard = (slide) => {
        const ctr = Number(slide.impressions) > 0 ? ((Number(slide.clicks) || 0) * 100 / Number(slide.impressions)).toFixed(1) : '0.0';
        const live = slide.enabled !== false && slide.status !== 'draft';
        const stateLabel = live ? 'روی سایت' : (slide.status === 'draft' ? 'پیش‌نویس' : 'غیرفعال');
        return `<article class="section-box promo-slide-admin" draggable="true" data-promo-card="${slide.id}" data-promo-live="${live ? 'true' : 'false'}">
          <div class="row-actions" style="justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap">
            <div class="row-actions" style="margin:0"><strong>اسلاید #${slide.id}</strong><span class="promo-slide-admin__state ${live ? 'is-live' : 'is-draft'}">${stateLabel}</span></div>
            <span class="hint">نمایش ${Number(slide.impressions)||0} · کلیک ${Number(slide.clicks)||0} · نرخ کلیک ${ctr}٪</span>
          </div>
          <div class="promo-placement-note"><b>جایگاه نمایش:</b><span>صفحه ورود — داخل بخش تجربه</span><span>·</span><span>در چیدمان کارت‌های ورودی و پیش از دسترسی‌های سریع نمایش داده می‌شود.</span></div>
          <div class="grid-2">
            ${__westoViewContext.field('عنوان', `ps_title_${slide.id}`, slide.title || '')}
            ${__westoViewContext.field('زیرعنوان', `ps_subtitle_${slide.id}`, slide.subtitle || '')}
            ${__westoViewContext.field('برچسب کوتاه', `ps_badge_${slide.id}`, slide.badge || '')}
            ${__westoViewContext.field('متن دکمه', `ps_cta_${slide.id}`, slide.ctaLabel || '')}
            <div class="field"><label>نوع اسلاید</label><select id="ps_kind_${slide.id}">${kindOptions.map(([v,l]) => option(v,l,slide.kind)).join('')}</select></div>
            <div class="field"><label>جایگاه نمایش</label><select id="ps_placement_${slide.id}">${placementOptions.map(([v,l]) => option(v,l,'entrance')).join('')}</select></div>
            <div class="field"><label>نوع اقدام</label><select id="ps_action_${slide.id}">${actionOptions.map(([v,l]) => option(v,l,slide.actionType)).join('')}</select></div>
            ${__westoViewContext.field('نشانی یا شناسه اقدام', `ps_value_${slide.id}`, slide.actionValue || '', { ltr: true })}
            ${__westoViewContext.field('تصویر', `ps_image_${slide.id}`, slide.image || '', { ltr: true })}
            <div class="field"><label>بارگذاری تصویر</label><input type="file" id="ps_file_${slide.id}" accept=".png,.jpg,.jpeg,.webp" /></div>
            <div class="field"><label>شعبه</label><select id="ps_branch_${slide.id}"><option value="">همه شعب</option>${branches.map((b)=>option(b.id,b.name,slide.branchId)).join('')}</select></div>
            ${__westoViewContext.field('شروع نمایش', `ps_start_${slide.id}`, dtLocal(slide.startAt), { type: 'datetime-local', ltr: true })}
            ${__westoViewContext.field('پایان نمایش', `ps_end_${slide.id}`, dtLocal(slide.endAt), { type: 'datetime-local', ltr: true })}
            ${__westoViewContext.field('پخش خودکار (میلی‌ثانیه؛ صفر یعنی خاموش)', `ps_auto_${slide.id}`, Number(slide.autoplayMs)||0, { type: 'number', ltr: true })}
            <div class="field"><label>وضعیت انتشار</label><select id="ps_status_${slide.id}">${option('published','منتشرشده',slide.status)}${option('draft','پیش‌نویس',slide.status)}</select></div>
          </div>
          ${slide.image ? `<div class="logo-preview" style="margin:.65rem 0"><img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(slide.image))}" alt="" style="max-height:150px;object-fit:cover;border-radius:14px" /></div>` : ''}
          <div class="row-actions" style="margin-top:.55rem;gap:1rem;flex-wrap:wrap"><label class="check-row"><input type="checkbox" id="ps_enabled_${slide.id}" ${slide.enabled !== false ? 'checked' : ''} /> فعال</label><label class="check-row"><input type="checkbox" id="ps_share_${slide.id}" ${slide.shareEnabled !== false ? 'checked' : ''} /> دکمه اشتراک‌گذاری</label></div>
          <div class="row-actions" style="margin-top:.75rem">
            <button class="btn btn-sm" data-promo-save="${slide.id}">ذخیره تغییرات</button>
            <button class="btn btn-sm ${live ? 'btn-ghost' : ''}" data-promo-visibility="${slide.id}" data-live="${live ? 'true' : 'false'}">${live ? 'برداشتن از سایت' : 'انتشار روی سایت'}</button>
            <button class="btn btn-sm btn-ghost" data-promo-upload="${slide.id}">بارگذاری تصویر</button>
            <button class="btn btn-sm btn-ghost" data-promo-copy="${slide.id}">کپی</button>
            <button class="btn btn-sm btn-danger" data-promo-delete="${slide.id}">حذف</button>
            <span class="hint">برای تغییر ترتیب کارت را بکشید.</span>
          </div>
        </article>`;
      };

      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">محتوای تبلیغاتی وستو</p><h1>اسلایدر تبلیغاتی</h1><p class="lead">کارت‌های تبلیغاتی صفحه ورود؛ تصویر، اقدام، اشتراک‌گذاری، زمان‌بندی، شعبه و ترتیب را از همین‌جا مدیریت کنید.</p></div></div>
        <div class="cards cards-dense"><div class="card accent"><div class="num">${__westoViewContext.fmtNum(slides.filter((slide) => slide.enabled !== false && slide.status !== 'draft').length)}</div><div class="lbl">در حال نمایش</div></div><div class="card"><div class="num">${__westoViewContext.fmtNum(slides.filter((slide) => slide.status === 'draft').length)}</div><div class="lbl">پیش‌نویس</div></div><div class="card"><div class="num">${__westoViewContext.fmtNum(slides.length)}</div><div class="lbl">کل اسلایدها</div></div></div>
        <div class="section-box">
          <div class="row-actions"><button class="btn" id="promo-slide-add">+ اسلاید جدید</button><a class="btn btn-ghost" href="/" target="_blank" rel="noopener">پیش‌نمایش صفحه ورود</a></div>
          <p class="hint">برای نمایش روی سایت، اسلاید باید هم «منتشرشده» و هم «فعال» باشد. تصویر یا عنوان را وارد کنید؛ اقدام «دسته» و «غذا» از شناسه منوی فعلی استفاده می‌کند.</p>
        </div>
        <div id="promo-slides-list">${slides.map(slideCard).join('') || '<div class="section-box"><p class="hint">هنوز اسلایدی ساخته نشده است.</p></div>'}</div>`;

      const readSlide = (id) => ({
        title: document.getElementById(`ps_title_${id}`)?.value.trim() || '',
        subtitle: document.getElementById(`ps_subtitle_${id}`)?.value.trim() || '',
        badge: document.getElementById(`ps_badge_${id}`)?.value.trim() || '',
        ctaLabel: document.getElementById(`ps_cta_${id}`)?.value.trim() || '',
        kind: document.getElementById(`ps_kind_${id}`)?.value || 'general',
        placement: 'entrance',
        shareEnabled: Boolean(document.getElementById(`ps_share_${id}`)?.checked),
        actionType: document.getElementById(`ps_action_${id}`)?.value || 'none',
        actionValue: document.getElementById(`ps_value_${id}`)?.value.trim() || '',
        image: document.getElementById(`ps_image_${id}`)?.value.trim() || '',
        branchId: document.getElementById(`ps_branch_${id}`)?.value || null,
        startAt: window.ShamsiDatePicker?.getISOValue(document.getElementById(`ps_start_${id}`)) || document.getElementById(`ps_start_${id}`)?.dataset.isoDateTime || document.getElementById(`ps_start_${id}`)?.value || null,
        endAt: window.ShamsiDatePicker?.getISOValue(document.getElementById(`ps_end_${id}`)) || document.getElementById(`ps_end_${id}`)?.dataset.isoDateTime || document.getElementById(`ps_end_${id}`)?.value || null,
        autoplayMs: Math.max(0, __westoViewContext.parseInputNumber(document.getElementById(`ps_auto_${id}`)?.value) || 0),
        status: document.getElementById(`ps_status_${id}`)?.value || 'published',
        enabled: Boolean(document.getElementById(`ps_enabled_${id}`)?.checked),
      });

      const validateSlide = (payload, { forPublish = false } = {}) => {
        if (payload.startAt && payload.endAt && new Date(payload.startAt).getTime() >= new Date(payload.endAt).getTime()) return 'زمان پایان باید بعد از زمان شروع باشد.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && !payload.title && !payload.image) return 'برای انتشار، حداقل عنوان یا تصویر وارد کنید.';
        if ((forPublish || (payload.enabled && payload.status === 'published')) && payload.placement === 'entrance' && !payload.image) return 'اسلاید صفحه ورود باید تصویر داشته باشد.';
        if (['url','instagram'].includes(payload.actionType) && payload.actionValue && !/^https?:\/\//i.test(payload.actionValue)) return 'برای لینک خارجی/اینستاگرام، آدرس کامل با http یا https وارد کنید.';
        if (['category','dish'].includes(payload.actionType) && payload.actionValue && !/^\d+$/.test(payload.actionValue)) return 'برای اقدام دسته یا غذا، شناسه عددی معتبر وارد کنید.';
        return '';
      };

      document.getElementById('promo-slide-add')?.addEventListener('click', async () => {
        try {
          await __westoViewContext.api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify({ title: 'اسلاید جدید', placement: 'entrance', shareEnabled: true, status: 'draft', enabled: false }) });
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ایجاد اسلاید جدید', 'error');
        }
      });
      __westoViewContext.main.querySelectorAll('[data-promo-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoSave);
        const payload = readSlide(id); const invalid = validateSlide(payload);
        if (invalid) return __westoViewContext.showToast(invalid, 'error', 3600);
        try {
          await __westoViewContext.api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          __westoViewContext.showToast('اسلاید ذخیره شد', 'success');
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره اسلاید', 'error');
        }
      }));
      __westoViewContext.main.querySelectorAll('[data-promo-visibility]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoVisibility); const currentlyLive = btn.dataset.live === 'true';
        const payload = readSlide(id);
        if (!currentlyLive) {
          payload.status = 'published'; payload.enabled = true;
          const invalid = validateSlide(payload, { forPublish: true });
          if (invalid) return __westoViewContext.showToast(invalid, 'error', 3600);
        } else { payload.enabled = false; }
        try {
          await __westoViewContext.api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          __westoViewContext.showToast(currentlyLive ? 'اسلاید از سایت برداشته شد' : 'اسلاید منتشر شد', 'success');
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در تغییر وضعیت انتشار اسلاید', 'error');
        }
      }));
      __westoViewContext.main.querySelectorAll('[data-promo-upload]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoUpload);
        const file = document.getElementById(`ps_file_${id}`)?.files?.[0];
        if (!file) return __westoViewContext.showToast('اول یک تصویر انتخاب کنید', 'warn');
        try {
          const fd = new FormData(); fd.append('file', file);
          const up = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body: fd });
          document.getElementById(`ps_image_${id}`).value = up.path || '';
          await __westoViewContext.api(`/api/admin/promo-slides/${id}`, { method: 'PATCH', body: JSON.stringify(readSlide(id)) });
          __westoViewContext.showToast('تصویر بارگذاری و ذخیره شد', 'success');
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در بارگذاری تصویر اسلاید', 'error');
        }
      }));
      __westoViewContext.main.querySelectorAll('[data-promo-delete]').forEach((btn) => btn.addEventListener('click', async () => {
        if (!confirm('این اسلاید حذف شود؟')) return;
        try {
          await __westoViewContext.api(`/api/admin/promo-slides/${btn.dataset.promoDelete}`, { method: 'DELETE' });
          __westoViewContext.showToast('اسلاید حذف شد', 'success');
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در حذف اسلاید', 'error');
        }
      }));
      __westoViewContext.main.querySelectorAll('[data-promo-copy]').forEach((btn) => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.promoCopy); const payload = readSlide(id);
        payload.title = `${payload.title || 'اسلاید'} — کپی`; payload.status = 'draft'; payload.enabled = false;
        try {
          await __westoViewContext.api('/api/admin/promo-slides', { method: 'POST', body: JSON.stringify(payload) });
          __westoViewContext.showToast('کپی اسلاید ایجاد شد', 'success');
          __westoViewContext.tabs.promoSlides();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ایجاد کپی اسلاید', 'error');
        }
      }));

      const list = document.getElementById('promo-slides-list');
      let dragging = null;
      list?.querySelectorAll('[data-promo-card]').forEach((card) => {
        card.addEventListener('dragstart', () => { dragging = card; card.style.opacity = '.55'; });
        card.addEventListener('dragend', async () => {
          card.style.opacity = ''; dragging = null;
          const ids = [...list.querySelectorAll('[data-promo-card]')].map((el) => Number(el.dataset.promoCard));
          if (ids.length) {
            try {
              await __westoViewContext.api('/api/admin/promo-slides/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
              __westoViewContext.showToast('ترتیب ذخیره شد', 'success');
            } catch (e) {
              __westoViewContext.showToast(e.message || 'خطا در ذخیره ترتیب اسلایدها', 'error');
            }
          }
        });
        card.addEventListener('dragover', (event) => {
          event.preventDefault();
          if (!dragging || dragging === card) return;
          const rect = card.getBoundingClientRect();
          list.insertBefore(dragging, event.clientY < rect.top + rect.height / 2 ? card : card.nextSibling);
        });
      });
    }
}['promoSlides'];
});
/*westo-view:end:promoSlides*/

/*westo-view:start:content*/
window.WestoAdminModules.defineView('website_brand', 'content', function(__westoViewContext) {
return {
async content() {
      __westoViewContext.setActiveTab('content');
      const groups = [
        { title: 'نوار بالای سایت و منو', keys: ['nav.login', 'nav.menu', 'nav.contact', 'nav.sound_on', 'nav.sound_off', 'nav.link.gamme', 'nav.link.benefits', 'nav.link.faq', 'nav.link.newsletter', 'nav.copyright'] },
        { title: 'صفحه ورود — متن‌ها', keys: ['entrance.tagline', 'entrance.subtitle', 'entrance.storyLead', 'entrance.quote', 'entrance.cta', 'entrance.step.digitalMenu', 'entrance.step.onlineOrder', 'entrance.step.reserveTable', 'entrance.step.quickEntry'] },
        { title: 'بخش آغازین', keys: ['hero.scroll_hint'] },
        { title: 'بخش مواد — شکر', keys: ['ingredients.sugar.badge', 'ingredients.sugar.title1', 'ingredients.sugar.title2', 'ingredients.sugar.desc'] },
        { title: 'بخش مواد — طعم‌دهنده', keys: ['ingredients.aroma.badge', 'ingredients.aroma.title1', 'ingredients.aroma.title2', 'ingredients.aroma.desc'] },
        { title: 'بخش مواد — کافئین', keys: ['ingredients.caffeine.badge', 'ingredients.caffeine.title', 'ingredients.caffeine.desc'] },
        { title: 'بخش مواد — استویا', keys: ['ingredients.stevia.badge', 'ingredients.stevia.title', 'ingredients.stevia.desc'] },
        { title: 'سؤالات متداول (عنوان)', keys: ['faq.title1', 'faq.title2'] },
        { title: 'خبرنامه', keys: ['newsletter.title', 'newsletter.desc', 'newsletter.email_label', 'newsletter.submit', 'newsletter.consent', 'newsletter.privacy_link', 'newsletter.success', 'newsletter.error'] },
        { title: 'پایین صفحه', keys: ['footer.copyright', 'footer.legal', 'footer.cgu', 'footer.privacy', 'footer.tiktok', 'footer.instagram'] },
      ];
      const labels = {
        'nav.login': 'دکمه ورود', 'nav.menu': 'دکمه منو', 'nav.contact': 'دکمه تماس', 'nav.sound_on': 'صدا: روشن', 'nav.sound_off': 'صدا: خاموش',
        'nav.link.gamme': 'لینک محصولات', 'nav.link.benefits': 'لینک مزایا', 'nav.link.faq': 'لینک سؤالات', 'nav.link.newsletter': 'لینک خبرنامه', 'nav.copyright': 'حق نشر منو',
        'hero.scroll_hint': 'راهنمای پیمایش',
        'entrance.tagline': 'شعار کوتاه زیر لوگو', 'entrance.subtitle': 'زیرعنوان زبان انگلیسی', 'entrance.storyLead': 'متن آماده‌سازی', 'entrance.quote': 'جمله کوتاه', 'entrance.cta': 'متن دکمه ورود',
        'entrance.step.digitalMenu': 'مرحله ۱', 'entrance.step.onlineOrder': 'مرحله ۲', 'entrance.step.reserveTable': 'مرحله ۳', 'entrance.step.quickEntry': 'مرحله ۴',
        'ingredients.sugar.badge': 'برچسب کوتاه', 'ingredients.sugar.title1': 'عنوان اول', 'ingredients.sugar.title2': 'عنوان دوم', 'ingredients.sugar.desc': 'توضیحات',
        'ingredients.aroma.badge': 'برچسب کوتاه', 'ingredients.aroma.title1': 'عنوان اول', 'ingredients.aroma.title2': 'عنوان دوم', 'ingredients.aroma.desc': 'توضیحات',
        'ingredients.caffeine.badge': 'برچسب کوتاه', 'ingredients.caffeine.title': 'عنوان', 'ingredients.caffeine.desc': 'توضیحات',
        'ingredients.stevia.badge': 'برچسب کوتاه', 'ingredients.stevia.title': 'عنوان', 'ingredients.stevia.desc': 'توضیحات',
        'faq.title1': 'عنوان اول', 'faq.title2': 'عنوان دوم',
        'newsletter.title': 'عنوان خبرنامه', 'newsletter.desc': 'توضیح خبرنامه', 'newsletter.email_label': 'برچسب ایمیل', 'newsletter.submit': 'متن دکمه عضویت', 'newsletter.consent': 'متن رضایت', 'newsletter.privacy_link': 'متن لینک حریم خصوصی', 'newsletter.success': 'پیام موفقیت', 'newsletter.error': 'پیام خطا',
        'footer.copyright': 'حق نشر', 'footer.legal': 'اطلاعات حقوقی', 'footer.cgu': 'شرایط استفاده', 'footer.privacy': 'حریم خصوصی', 'footer.tiktok': 'عنوان تیک‌تاک', 'footer.instagram': 'عنوان اینستاگرام',
      };
      __westoViewContext.main.innerHTML = `
        <h1>محتوای سایت</h1>
        ${groups
          .map(
            (g) => `
          <div class="section-box">
            <h2>${__westoViewContext.esc(g.title)}</h2>
            <div class="grid-2">
              ${g.keys.map((k) => __westoViewContext.field(labels[k] || k, `c__${k}`, __westoViewContext.state.content[k] || '', { textarea: (__westoViewContext.state.content[k] || '').length > 60 })).join('')}
            </div>
          </div>`
          )
          .join('')}
        <p class="hint" style="margin:0.5rem 0 1rem">ذخیره خودکار هر فیلد</p>`;

      const saveContentField = async (el) => {
        try {
          const key = el.id.slice(3);
          const updates = { [key]: el.value };
          await __westoViewContext.api('/api/content', { method: 'PUT', body: JSON.stringify({ content: updates }) });
          Object.assign(__westoViewContext.state.content, updates);
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره محتوا', 'error');
        }
      };
      __westoViewContext.main.querySelectorAll('[id^="c__"]').forEach((el) => {
        const run = __westoViewContext.autosave(() => saveContentField(el), { debounceMs: 400, silent: true });
        el.addEventListener('input', run);
        el.addEventListener('change', run);
      });
    }
}['content'];
});
/*westo-view:end:content*/

/*westo-view:start:media*/
window.WestoAdminModules.defineView('website_brand', 'media', function(__westoViewContext) {
return {
async media() {
      __westoViewContext.setActiveTab('media');
      const up = await __westoViewContext.api('/api/admin/uploads');
      __westoViewContext.main.innerHTML = `
        <h1>لوگو و رسانه</h1>
        <div class="section-box">
          <h2>لوگوی سفید <small>(نوار بالای سایت و پایین صفحه)</small></h2>
          <div class="grid-2">
            <div class="logo-preview"><img src="${__westoViewContext.esc(__westoViewContext.state.content['logo.white'])}" /></div>
            <div>
              <div class="field"><label>بارگذاری تصویر جدید</label><input type="file" id="file-white" accept=".svg,.png,.jpg,.webp" /></div>
              <button class="btn btn-sm" data-logo="logo.white" data-file="file-white">بارگذاری و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی مشکی</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background: repeating-conic-gradient(#ddd 0% 25%, #bbb 0% 50%) 0 / 24px 24px;"><img src="${__westoViewContext.esc(__westoViewContext.state.content['logo.black'])}" /></div>
            <div>
              <div class="field"><label>بارگذاری تصویر جدید</label><input type="file" id="file-black" accept=".svg,.png,.jpg,.webp" /></div>
              <button class="btn btn-sm" data-logo="logo.black" data-file="file-black">بارگذاری و جایگزینی</button>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>لوگوی نشانه صفحه ورود</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(__westoViewContext.state.content['entrance.logo'] || 'assets/images/brand/westo-mark.png?v=brandCyan2'))}" /></div>
            <div><div class="field"><label>تصویر باکیفیت و شفاف</label><input type="file" id="file-entrance-logo" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.logo" data-file="file-entrance-logo">بارگذاری لوگوی ورود</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>نوشتار برند صفحه ورود — زمینه تیره</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014"><img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(__westoViewContext.state.content['entrance.wordmark.dark'] || 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1'))}" /></div>
            <div><div class="field"><label>نوشتار روشن روی زمینه تیره</label><input type="file" id="file-entrance-wordmark-dark" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.dark" data-file="file-entrance-wordmark-dark">بارگذاری نوشتار روشن</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>نوشتار برند صفحه ورود — زمینه روشن</h2>
          <div class="grid-2">
            <div class="logo-preview" style="background:#f6f4ef"><img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(__westoViewContext.state.content['entrance.wordmark.light'] || 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1'))}" /></div>
            <div><div class="field"><label>نوشتار تیره روی زمینه روشن</label><input type="file" id="file-entrance-wordmark-light" accept=".svg,.png,.jpg,.webp" /></div><button class="btn btn-sm" data-logo="entrance.wordmark.light" data-file="file-entrance-wordmark-light">بارگذاری نوشتار تیره</button></div>
          </div>
        </div>
        <div class="section-box">
          <h2>الگوی زمینه صفحه ورود</h2>
          <p class="hint">این تصویر فقط در صفحه ورود وستو استفاده می‌شود و ساختار لوگو را تغییر نمی‌دهد. تصویر با پس‌زمینه شفاف بهترین نتیجه را می‌دهد.</p>
          <div class="grid-2">
            <div class="logo-preview" style="background:#061014;min-height:180px;overflow:hidden;"><img src="${__westoViewContext.esc(__westoViewContext.adminImgSrc(__westoViewContext.state.content['entrance.pattern'] || 'assets/images/entrance/westo-pattern.webp'))}" style="width:100%;height:180px;object-fit:contain;" alt="پیش‌نمایش الگوی زمینه صفحه ورود" /></div>
            <div>
              <div class="field"><label>بارگذاری الگوی جدید</label><input type="file" id="file-entrance-pattern" accept=".png,.jpg,.jpeg,.webp,.gif" /></div>
              <div class="row-actions"><button class="btn btn-sm" data-pattern="entrance.pattern" data-file="file-entrance-pattern">بارگذاری و جایگزینی الگوی ورود</button><button class="btn btn-sm btn-ghost" type="button" data-pattern-reset>بازگشت به الگوی پیش‌فرض</button></div>
              <p class="hint">پس از ذخیره، در بارگذاری بعدی صفحه اول اعمال می‌شود.</p>
            </div>
          </div>
        </div>
        <div class="section-box">
          <h2>فایل‌های بارگذاری‌شده</h2>
          <table class="tbl"><thead><tr><th>مسیر</th><th>حجم</th></tr></thead><tbody>
            ${up.files.map((f) => `<tr><td class="ltr"><a href="/${__westoViewContext.esc(f.path)}" target="_blank">${__westoViewContext.esc(f.path)}</a></td><td>${__westoViewContext.fmtNum((f.size / 1024).toFixed(1))} کیلوبایت</td></tr>`).join('') || '<tr><td colspan="2">فایلی بارگذاری نشده است</td></tr>'}
          </tbody></table>
        </div>`;

      __westoViewContext.main.querySelectorAll('button[data-logo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input?.files?.[0]) return __westoViewContext.showToast('اول یک فایل انتخاب کنید');
          try {
            const fd = new FormData();
            fd.append('file', input.files[0]);
            const d = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body: fd });
            await __westoViewContext.api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [btn.dataset.logo]: d.path } }) });
            __westoViewContext.state.content[btn.dataset.logo] = d.path;
            __westoViewContext.showToast('رسانه جایگزین شد');
            __westoViewContext.tabs.media();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در بارگذاری رسانه', 'error');
          }
        });
      });

      __westoViewContext.main.querySelectorAll('button[data-pattern]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const input = document.getElementById(btn.dataset.file);
          if (!input?.files?.[0]) return __westoViewContext.showToast('ابتدا یک فایل برای الگوی زمینه انتخاب کنید');
          try {
            const fd = new FormData();
            fd.append('file', input.files[0]);
            const d = await __westoViewContext.api('/api/admin/upload', { method: 'POST', body: fd });
            const key = btn.dataset.pattern;
            await __westoViewContext.api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { [key]: d.path } }) });
            __westoViewContext.state.content[key] = d.path;
            __westoViewContext.showToast('الگوی زمینه صفحه ورود جایگزین شد');
            __westoViewContext.tabs.media();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در بارگذاری الگوی زمینه', 'error');
          }
        });
      });

      __westoViewContext.main.querySelector('[data-pattern-reset]')?.addEventListener('click', async () => {
        try {
          const path = 'assets/images/entrance/westo-pattern.webp';
          await __westoViewContext.api('/api/content', { method: 'PUT', body: JSON.stringify({ content: { 'entrance.pattern': path } }) });
          __westoViewContext.state.content['entrance.pattern'] = path;
          __westoViewContext.showToast('الگوی پیش‌فرض صفحه ورود بازیابی شد');
          __westoViewContext.tabs.media();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در بازیابی الگوی پیش‌فرض', 'error');
        }
      });
    }
}['media'];
});
/*westo-view:end:media*/

/*westo-view:start:faq*/
window.WestoAdminModules.defineView('website_brand', 'faq', function(__westoViewContext) {
return {
async faq() {
      __westoViewContext.setActiveTab('faq');
      if (!Array.isArray(__westoViewContext.state.faq)) __westoViewContext.state.faq = [];
      __westoViewContext.main.innerHTML = `
        <h1>سؤالات متداول</h1>
        ${__westoViewContext.state.faq
          .map(
            (f, i) => `
          <div class="section-box" data-fid="${f.id}">
            <h2>سؤال ${i + 1}</h2>
            ${__westoViewContext.field('سؤال', `f${f.id}_q`, f.q)}
            ${__westoViewContext.field('پاسخ', `f${f.id}_a`, f.a, { textarea: true })}
            <div class="row-actions">
              <span class="hint">ذخیره خودکار</span>
              <button class="btn btn-sm btn-ghost" data-fup="${f.id}" ${i === 0 ? 'disabled' : ''}>بالا</button>
              <button class="btn btn-sm btn-ghost" data-fdown="${f.id}" ${i === __westoViewContext.state.faq.length - 1 ? 'disabled' : ''}>پایین</button>
              <button class="btn btn-sm btn-danger" data-fdel="${f.id}">حذف</button>
            </div>
          </div>`
          )
          .join('')}
        <div class="section-box">
          <h2>افزودن سؤال جدید</h2>
          ${__westoViewContext.field('سؤال', 'new_q', '')}
          ${__westoViewContext.field('پاسخ', 'new_a', '', { textarea: true })}
          <button class="btn btn-sm" id="f-add">افزودن</button>
        </div>`;

      __westoViewContext.state.faq.forEach((f) => {
        const saveFaq = async () => {
          try {
            const d = await __westoViewContext.api(`/api/faq/${f.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                q: document.getElementById(`f${f.id}_q`)?.value || '',
                a: document.getElementById(`f${f.id}_a`)?.value || '',
              }),
            });
            const item = __westoViewContext.state.faq.find((x) => x.id === f.id);
            if (item && d.item) Object.assign(item, d.item);
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ذخیره سؤال', 'error');
          }
        };
        __westoViewContext.bindAutosave(__westoViewContext.main.querySelector(`[data-fid="${f.id}"]`), saveFaq);
      });
      __westoViewContext.main.querySelectorAll('[data-fdel]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('این سؤال حذف شود؟')) return;
          try {
            await __westoViewContext.api(`/api/faq/${b.dataset.fdel}`, { method: 'DELETE' });
            __westoViewContext.state.faq = __westoViewContext.state.faq.filter((f) => f.id !== Number(b.dataset.fdel));
            __westoViewContext.showToast('سؤال با موفقیت حذف شد', 'success');
            __westoViewContext.tabs.faq();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در حذف سؤال', 'error');
          }
        })
      );
      const move = async (id, dir) => {
        const ids = __westoViewContext.state.faq.map((f) => f.id);
        const i = ids.indexOf(Number(id));
        const j = i + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        try {
          const d = await __westoViewContext.api('/api/faq-order', { method: 'PUT', body: JSON.stringify({ order: ids }) });
          __westoViewContext.state.faq = Array.isArray(d.faq) ? d.faq : __westoViewContext.state.faq;
          __westoViewContext.tabs.faq();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در جابه‌جایی سؤال', 'error');
        }
      };
      __westoViewContext.main.querySelectorAll('[data-fup]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fup, -1)));
      __westoViewContext.main.querySelectorAll('[data-fdown]').forEach((b) => b.addEventListener('click', () => move(b.dataset.fdown, 1)));
      document.getElementById('f-add')?.addEventListener('click', async () => {
        const q = document.getElementById('new_q')?.value.trim() || '';
        const a = document.getElementById('new_a')?.value.trim() || '';
        if (!q) return __westoViewContext.showToast('متن سؤال را وارد کنید', 'warn');
        try {
          const d = await __westoViewContext.api('/api/faq', { method: 'POST', body: JSON.stringify({ q, a }) });
          if (d.item) __westoViewContext.state.faq.push(d.item);
          __westoViewContext.showToast('سؤال جدید با موفقیت اضافه شد', 'success');
          __westoViewContext.tabs.faq();
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ثبت سؤال جدید', 'error');
        }
      });
    }
}['faq'];
});
/*westo-view:end:faq*/

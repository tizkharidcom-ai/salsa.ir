/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:reservations*/
window.WestoAdminModules.defineView('reservations', 'reservations', function(__westoViewContext) {
return {
async reservations() {
      __westoViewContext.setActiveTab('reservations');
      const d = await __westoViewContext.api(`/api/admin/reservations${__westoViewContext.branchQs()}`);
      const settings = d.settings || {};
      const labels = { pending:'در انتظار', confirmed:'تأیید شده', seated:'نشسته‌اند', completed:'پایان‌یافته', cancelled:'لغو', no_show:'نیامدند' };
      const branchName = (id) => __westoViewContext.branchesCache.find((b) => b.id === id)?.name || `#${id}`;
      const canConfigure = __westoViewContext.hasCapability('admin.access');
      const today = new Date().toISOString().slice(0,10);
      const slotsToday = (d.slotLoad || []).filter((row) => row.date === today);
      const peak = slotsToday.reduce((best,row) => !best || row.percent > best.percent ? row : best, null);
      __westoViewContext.main.innerHTML = `
        <div class="ops-page-head"><div><p class="eyebrow">مدیریت سالن</p><h1>رزرو میز</h1><p class="lead">رزروهای نزدیک اول نمایش داده می‌شوند. وضعیت، تعداد نفر و یادداشت مهمان را از همین صفحه مدیریت کنید.</p></div><a class="btn btn-sm btn-ghost" href="/reserve" target="_blank" rel="noopener">مشاهده صفحه رزرو</a></div>
        <div class="cards cards-dense">
          <div class="card"><div class="num">${__westoViewContext.fmtNum(d.summary?.today || 0)}</div><div class="lbl">رزرو فعال امروز</div></div>
          <div class="card"><div class="num">${__westoViewContext.fmtNum(d.summary?.todayCovers || 0)}</div><div class="lbl">نفر امروز</div></div>
          <div class="card warn"><div class="num">${__westoViewContext.fmtNum(d.summary?.pending || 0)}</div><div class="lbl">منتظر تأیید</div></div>
          <div class="card accent"><div class="num">${__westoViewContext.fmtNum(d.summary?.confirmed || 0)}</div><div class="lbl">تأیید شده</div></div>
          <div class="card"><div class="num">${__westoViewContext.fmtNum(d.summary?.seated || 0)}</div><div class="lbl">نشسته‌اند</div></div>
          <div class="card ${d.summary?.noShowToday ? 'is-danger' : ''}"><div class="num">${__westoViewContext.fmtNum(d.summary?.noShowToday || 0)}</div><div class="lbl">عدم مراجعه امروز</div></div>
        </div>
        ${slotsToday.length ? `<section class="section-box"><div class="ops-panel__head"><div><p class="eyebrow">بار شیفت امروز</p><h2>ظرفیت نوبت‌های رزرو</h2></div>${peak ? `<span class="hint">شلوغ‌ترین: ${__westoViewContext.esc(peak.time)} · ${__westoViewContext.fmtNum(peak.percent)}٪</span>` : ''}</div><div class="reservation-slot-load">${slotsToday.map((row)=>`<div class="reservation-slot"><header><b>${__westoViewContext.esc(row.time)}</b><span>${__westoViewContext.fmtNum(row.covers)}/${__westoViewContext.fmtNum(row.maxCovers)} نفر</span></header><div class="reservation-slot__bar"><i style="width:${Math.min(100,row.percent)}%"></i></div><small>${__westoViewContext.fmtNum(row.parties)} رزرو · ${__westoViewContext.fmtNum(row.percent)}٪ ظرفیت</small></div>`).join('')}</div></section>` : ''}
        ${canConfigure ? `<details class="section-box admin-config-panel"><summary><strong>تنظیمات ظرفیت رزرو</strong><span>برای مدیر سیستم</span></summary><div class="grid-2 admin-config-grid"><label class="chk"><input type="checkbox" id="rs_en" ${settings.enabled !== false ? 'checked' : ''} /> رزرو آنلاین فعال</label>${__westoViewContext.field('فاصله نوبت‌ها (دقیقه)','rs_slot',String(settings.slotMinutes ?? 30),{ltr:true,type:'number'})}${__westoViewContext.field('حداکثر نفرات هر رزرو','rs_party',String(settings.maxParty ?? 12),{ltr:true,type:'number'})}${__westoViewContext.field('ظرفیت هر نوبت (نفر)','rs_covers',String(settings.maxCoversPerSlot ?? 24),{ltr:true,type:'number'})}${__westoViewContext.field('روزهای پیشِ‌رو','rs_adv',String(settings.advanceDays ?? 21),{ltr:true,type:'number'})}${__westoViewContext.field('حداقل ساعت تا رزرو','rs_min',String(settings.minHoursAhead ?? 1),{ltr:true,type:'number'})}</div><p class="hint">تغییرات این بخش ذخیره خودکار دارند.</p></details>` : ''}
        <section class="section-box">
          <div class="res-shift-filters" id="res-shift-bar">
            <button class="res-shift-btn is-active" data-shift="all" type="button">همه نوبت‌ها</button>
            <button class="res-shift-btn" data-shift="lunch" type="button">ناهار (۱۲:۰۰ تا ۱۶:۳۰)</button>
            <button class="res-shift-btn" data-shift="afternoon" type="button">عصرانه (۱۶:۳۰ تا ۱۹:۳۰)</button>
            <button class="res-shift-btn" data-shift="dinner" type="button">شام (۱۹:۳۰ به بعد)</button>
          </div>
          <div class="ops-filters admin-filter-row">
            <label><span>جست‌وجو</span><input id="res-search" type="search" placeholder="نام، تلفن، میز یا یادداشت…" /></label>
            <label><span>تاریخ</span><input id="res-date" type="text" class="shamsi-date-picker" data-shamsi-picker placeholder="فیلتر تاریخ شمسی..." /></label>
            <label><span>وضعیت</span><select id="res-status"><option value="">همه</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
            <span class="ops-filter-count" id="res-count"></span>
          </div>
          <table class="tbl admin-dense-table"><thead><tr><th>زمان</th><th>مهمان</th><th>نفر</th><th>میز</th><th>شعبه</th><th>وضعیت</th><th>اقدام سریع</th><th>یادداشت</th></tr></thead><tbody id="reservation-body">
          ${(d.reservations || []).map((r)=>`<tr data-reservation-row="${r.id}" data-status="${__westoViewContext.esc(r.status)}" data-date="${__westoViewContext.esc(r.date)}" data-time="${__westoViewContext.esc(r.time || '')}" data-search="${__westoViewContext.esc(`${r.name} ${r.phone} ${r.note||''} ${r.tableNo||''}`.toLowerCase())}">
            <td>
              <strong>${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateLong(r.date) : __westoViewContext.esc(r.date)}</strong>
              <small class="admin-cell-sub">${__westoViewContext.esc(r.time)}</small>
              ${r.occasion ? `<div style="margin-top:0.2rem;"><span class="res-occasion-badge">🎉 ${__westoViewContext.esc(r.occasion)}</span></div>` : ''}
            </td>
            <td><strong>${__westoViewContext.esc(r.name)}</strong><small class="admin-cell-sub ltr">${__westoViewContext.esc(r.phone)}</small></td>
            <td><input class="admin-compact-number" type="number" min="1" max="${Number(settings.maxParty)||12}" value="${Number(r.partySize)||1}" data-rparty="${r.id}" aria-label="تعداد نفر ${__westoViewContext.esc(r.name)}" /></td>
            <td><input class="res-table-select" type="text" data-rtable="${r.id}" value="${__westoViewContext.esc(r.tableNo || '')}" placeholder="میز…" style="width:55px; text-align:center;" aria-label="شماره میز ${__westoViewContext.esc(r.name)}" /></td>
            <td>${__westoViewContext.esc(branchName(r.branchId))}</td>
            <td><select data-rstatus="${r.id}">${Object.keys(labels).map((k)=>`<option value="${k}" ${r.status===k?'selected':''}>${labels[k]}</option>`).join('')}</select></td>
            <td>
              <div class="res-actions-wrap">
                ${r.status === 'pending' ? `<button class="res-action-btn res-btn--confirm" data-quick-status="${r.id}" data-target-status="confirmed" type="button">تأیید</button>` : ''}
                ${r.status === 'confirmed' ? `<button class="res-action-btn res-btn--seat" data-quick-status="${r.id}" data-target-status="seated" type="button">نشاندن مهمان</button>` : ''}
                ${r.status === 'seated' ? `<button class="res-action-btn res-btn--complete" data-quick-status="${r.id}" data-target-status="completed" type="button">پایان رزرو</button>` : ''}
                ${r.status !== 'no_show' && r.status !== 'cancelled' && r.status !== 'completed' ? `<button class="res-action-btn res-btn--noshow" data-quick-status="${r.id}" data-target-status="no_show" type="button" title="عدم مراجعه">نیامد</button>` : ''}
              </div>
            </td>
            <td><input class="admin-note-input" data-rnote="${r.id}" value="${__westoViewContext.esc(r.note||'')}" placeholder="یادداشت مهمان…" /></td>
          </tr>`).join('') || '<tr><td colspan="8">رزروی ثبت نشده است.</td></tr>'}</tbody></table>
        </section>`;

      const saveSettings = async () => {
        try {
          await __westoViewContext.api('/api/admin/reservation-settings', {
            method: 'PUT',
            body: JSON.stringify({
              settings: {
                enabled: document.getElementById('rs_en')?.checked !== false,
                slotMinutes: __westoViewContext.parseInputNumber(document.getElementById('rs_slot')?.value) || 30,
                maxParty: __westoViewContext.parseInputNumber(document.getElementById('rs_party')?.value) || 12,
                maxCoversPerSlot: __westoViewContext.parseInputNumber(document.getElementById('rs_covers')?.value) || 24,
                advanceDays: __westoViewContext.parseInputNumber(document.getElementById('rs_adv')?.value) || 21,
                minHoursAhead: __westoViewContext.parseInputNumber(document.getElementById('rs_min')?.value) || 0,
              },
            }),
          });
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره تنظیمات رزرو', 'error');
        }
      };
      if (canConfigure) __westoViewContext.bindAutosave(__westoViewContext.main.querySelector('.admin-config-panel'), saveSettings);

      let currentShift = 'all';
      const matchesShift = (time, shift) => {
        if (!shift || shift === 'all') return true;
        if (!time) return true;
        if (shift === 'lunch') return time >= '11:30' && time < '16:30';
        if (shift === 'afternoon') return time >= '16:30' && time < '19:30';
        if (shift === 'dinner') return time >= '19:30' || time < '04:00';
        return true;
      };

      const applyResFilter = () => {
        const q=String(document.getElementById('res-search')?.value||'').trim().toLowerCase(), date=document.getElementById('res-date')?.dataset?.isoDate || document.getElementById('res-date')?.value||'', status=document.getElementById('res-status')?.value||'';
        let n=0; __westoViewContext.main.querySelectorAll('[data-reservation-row]').forEach((row)=>{ const ok=(!q||row.dataset.search.includes(q))&&(!date||row.dataset.date===date)&&(!status||row.dataset.status===status)&&matchesShift(row.dataset.time, currentShift); row.hidden=!ok; if(ok)n++; });
        const el=document.getElementById('res-count'); if(el)el.textContent=`${__westoViewContext.fmtNum(n)} رزرو`;
      };
      ['res-search','res-date','res-status'].forEach((id)=>document.getElementById(id)?.addEventListener(id==='res-search'?'input':'change',applyResFilter)); applyResFilter();
      if (window.ShamsiDatePicker) window.ShamsiDatePicker.autoInit(__westoViewContext.main);

      __westoViewContext.main.querySelectorAll('.res-shift-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          __westoViewContext.main.querySelectorAll('.res-shift-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          currentShift = btn.dataset.shift || 'all';
          applyResFilter();
        });
      });

      __westoViewContext.main.querySelectorAll('[data-rstatus]').forEach((sel)=>sel.addEventListener('change', async()=>{
        const next=sel.value; if ((next==='cancelled'||next==='no_show') && !window.confirm(next==='cancelled'?'این رزرو لغو شود؟':'مهمان به‌عنوان «نیامد» ثبت شود؟')) { await __westoViewContext.tabs.reservations(); return; }
        try { await __westoViewContext.api(`/api/admin/reservations/${sel.dataset.rstatus}`,{method:'PATCH',body:JSON.stringify({status:next})}); __westoViewContext.showToast('وضعیت رزرو به‌روز شد','success',1400); }
        catch(e){ __westoViewContext.showToast(e.message,'error'); await __westoViewContext.tabs.reservations(); }
      }));
      __westoViewContext.main.querySelectorAll('[data-quick-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const next = btn.dataset.targetStatus;
          const id = btn.dataset.quickStatus;
          if (next === 'no_show' && !window.confirm('مهمان به‌عنوان «نیامد» ثبت شود؟')) return;
          try {
            await __westoViewContext.api(`/api/admin/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
            __westoViewContext.showToast('وضعیت رزرو به‌روز شد', 'success', 1400);
            await __westoViewContext.tabs.reservations();
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در تغییر وضعیت', 'error');
          }
        });
      });
      __westoViewContext.main.querySelectorAll('[data-rtable]').forEach((input) => {
        const save = __westoViewContext.autosave(() => __westoViewContext.api(`/api/admin/reservations/${input.dataset.rtable}`, { method: 'PATCH', body: JSON.stringify({ tableNo: input.value.trim() }) }), { debounceMs: 400, silent: true });
        input.addEventListener('change', save);
        input.addEventListener('blur', save);
      });
      __westoViewContext.main.querySelectorAll('[data-rparty]').forEach((input)=>input.addEventListener('change', async()=>{
        try {
          const partySize = __westoViewContext.parseInputNumber(input.value) || 1;
          await __westoViewContext.api(`/api/admin/reservations/${input.dataset.rparty}`,{method:'PATCH',body:JSON.stringify({partySize})});
          __westoViewContext.showToast('تعداد نفر ذخیره شد','success',1300);
        } catch(e){__westoViewContext.showToast(e.message,'error');}
      }));
      __westoViewContext.main.querySelectorAll('[data-rnote]').forEach((input)=>{ const save=__westoViewContext.autosave(()=>__westoViewContext.api(`/api/admin/reservations/${input.dataset.rnote}`,{method:'PATCH',body:JSON.stringify({note:input.value})}),{debounceMs:500,silent:true}); input.addEventListener('change',save); input.addEventListener('blur',save); });
    }
}['reservations'];
});
/*westo-view:end:reservations*/

/* WESTO Command Center Professional UX v4 — progressive enhancement only. */
(() => {
  'use strict';
  const body = document.body;
  const main = document.getElementById('main');
  const sidebar = document.getElementById('admin-sidebar');
  const topbar = document.querySelector('.admin-topbar');
  if (!body?.classList.contains('admin-app') || !main || !sidebar || !topbar) return;

  const tabName = () => document.querySelector('.admin-nav-item[data-tab].active')?.dataset.tab || 'dashboard';
  const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const NAV_ICONS = {
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
    receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>',
    kitchen: '<svg viewBox="0 0 24 24"><path d="M4 12h16M6 12a6 6 0 0 1 12 0M12 6V4M4 19h16"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="m4 12 8-8h7v7l-8 8-7-7Z"/><circle cx="16" cy="7" r="1"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c.7-4 2.7-6 6-6s5.3 2 6 6M16 5a3 3 0 0 1 0 6M17 14c2.3.4 3.6 2.4 4 5"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h5v4h-5a2 2 0 1 1 0-4Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.7Z"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m4 17 5-5 4 4 2-2 5 4"/></svg>',
    building: '<svg viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14M8 9h2M14 9h2M8 13h2M14 13h2M10 21v-4h4v4"/></svg>',
  };
  const NAV_ICON_BY_TAB = {
    dashboard:'grid',orders:'receipt',kitchen:'kitchen',reservations:'calendar',delivery:'truck',menu:'menu',prices:'tag',inventory:'box',costControl:'chart',products:'box',translate:'menu',promotions:'tag',promoSlides:'image',printmenu:'menu',tables:'grid',club:'users',analytics:'chart',reports:'chart',finance:'wallet',content:'menu',media:'image',faq:'menu',restaurant:'building',branches:'building',hours:'calendar',theme:'image',users:'users',settings:'settings'
  };

  function installNavIcons() {
    sidebar.querySelectorAll('.admin-nav-item[data-tab]').forEach((item) => {
      if (item.querySelector('.admin-nav-icon')) return;
      const icon = document.createElement('span');
      icon.className = 'admin-nav-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = NAV_ICONS[NAV_ICON_BY_TAB[item.dataset.tab] || 'menu'];
      item.prepend(icon);
    });
  }

  function installSidebarSearch() {
    if (document.getElementById('admin-nav-search')) return;
    const wrap = document.createElement('label');
    wrap.className = 'admin-nav-search-wrap';
    wrap.innerHTML = '<span class="sr-only">جست‌وجوی بخش‌های مرکز فرمان</span><input id="admin-nav-search" class="admin-nav-search" type="search" autocomplete="off" placeholder="پیدا کردن بخش…" />';
    document.querySelector('.admin-theme-switch')?.insertAdjacentElement('afterend', wrap);
    const input = wrap.querySelector('input');
    input?.addEventListener('input', () => {
      const q = text(input.value).toLocaleLowerCase('fa');
      sidebar.querySelectorAll('.nav-workspace').forEach((group) => {
        let count = 0;
        group.querySelectorAll('.admin-nav-item[data-tab]').forEach((item) => {
          if (item.hidden) return;
          const hay = `${text(item.textContent)} ${text(item.title)}`.toLocaleLowerCase('fa');
          const hide = Boolean(q) && !hay.includes(q);
          item.dataset.searchHidden = hide ? 'true' : 'false';
          if (!hide) count += 1;
        });
        group.dataset.searchEmpty = q && count === 0 ? 'true' : 'false';
        if (q && count) group.open = true;
      });
    });
  }

  function installTopbarTools() {
    if (!document.getElementById('admin-connection-state')) {
      const state = document.createElement('span');
      state.id = 'admin-connection-state';
      state.className = 'admin-connection-state';
      document.getElementById('admin-user-chip')?.appendChild(state);
    }
    const state = document.getElementById('admin-connection-state');
    if (state) {
      const sync = () => {
        const online = navigator.onLine;
        body.classList.toggle('admin-offline', !online);
        state.textContent = online ? 'متصل' : 'آفلاین';
        state.setAttribute('aria-label', online ? 'متصل' : 'آفلاین');
      };
      addEventListener('online', sync); addEventListener('offline', sync); sync();
    }
  }

  function persistFilters(root = main) {
    const tab = tabName();
    root.querySelectorAll('.admin-filter-row').forEach((row, rowIndex) => {
      const controls = [...row.querySelectorAll('input,select')].filter((el) => el.id);
      if (!controls.length) return;
      let filtered = false;
      controls.forEach((el) => {
        const key = `westo:admin:filter:${tab}:${el.id}`;
        const stored = sessionStorage.getItem(key);
        if (stored != null && el.value !== stored) {
          el.value = stored;
          el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        }
        if (el.value) filtered = true;
        if (el.dataset.adminFilterBound) return;
        el.dataset.adminFilterBound = '1';
        const save = () => { sessionStorage.setItem(key, el.value); row.classList.toggle('is-filtered', controls.some((c) => Boolean(c.value))); };
        el.addEventListener('input', save); el.addEventListener('change', save);
      });
      row.classList.toggle('is-filtered', filtered);
      if (!row.querySelector('.admin-filter-reset')) {
        const reset = document.createElement('button');
        reset.type = 'button'; reset.className = 'btn btn-sm btn-ghost admin-filter-reset'; reset.textContent = 'پاک‌کردن فیلتر';
        reset.addEventListener('click', () => {
          controls.forEach((el) => { el.value = ''; sessionStorage.removeItem(`westo:admin:filter:${tab}:${el.id}`); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
          row.classList.remove('is-filtered');
        });
        row.appendChild(reset);
      }
      row.dataset.filterRowIndex = String(rowIndex);
    });
  }

  function enhanceTables(root = main) {
    root.querySelectorAll('table.tbl').forEach((table) => {
      const headers = [...table.querySelectorAll('thead th')].map((th) => text(th.textContent));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => { if (headers[i] && !td.dataset.label) td.dataset.label = headers[i]; });
      });
    });
  }

  function enhanceFields(root = main) {
    root.querySelectorAll('input,textarea,select').forEach((el) => {
      if (el.dataset.adminValidityBound) return;
      el.dataset.adminValidityBound = '1';
      const sync = () => {
        // Reading validity avoids re-triggering the native `invalid` event from
        // inside its own handler, which otherwise causes a recursive stack overflow.
        const invalid = Boolean(el.validity && !el.validity.valid);
        el.classList.toggle('is-invalid', invalid);
        if (!invalid) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true');
      };
      el.addEventListener('invalid', () => { sync(); el.scrollIntoView({ block:'center', behavior:'smooth' }); });
      el.addEventListener('input', sync); el.addEventListener('change', sync);
    });
  }

  function normalizeEmptyStates(root = main) {
    root.querySelectorAll('.ops-empty').forEach((el) => el.classList.add('admin-empty-state'));
  }

  function enhanceWorkspace() {
    persistFilters();
    enhanceTables();
    enhanceFields();
    normalizeEmptyStates();
  }

  function installKeyboard() {
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (!typing && event.key === '/') {
        const search = [...main.querySelectorAll('input[type="search"]')].find((el) => !el.disabled && el.offsetParent !== null) || document.getElementById('admin-nav-search');
        if (search) { event.preventDefault(); search.focus(); search.select?.(); }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (typing && target.tagName === 'TEXTAREA') return;
        const saves = [...main.querySelectorAll('button')].filter((btn) => !btn.disabled && btn.offsetParent !== null && /^ذخیره/.test(text(btn.textContent)));
        if (saves.length === 1) { event.preventDefault(); saves[0].click(); }
      }
    });
  }

  installNavIcons();
  installSidebarSearch();
  installTopbarTools();
  installKeyboard();
  enhanceWorkspace();

  const observer = new MutationObserver(() => requestAnimationFrame(enhanceWorkspace));
  observer.observe(main, { childList:true, subtree:true });
})();

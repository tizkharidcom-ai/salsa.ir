(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  const i18n = () => window.westoI18n || null;
  const lang = () => i18n()?.lang || 'fa';
  const tr = (key, vars) => i18n()?.t?.(key, vars) || key;
  const localeTag = () => (lang() === 'fa' ? 'fa-IR' : lang() === 'ar' ? 'ar-SA' : 'en-US');
  const fmtNumber = (value, options = {}) => window.WestoPersianFormat?.number(value, { ...options, locale: localeTag() }) ?? Number(value || 0).toLocaleString(localeTag(), options);
  const fmtMoney = (value) => `${fmtNumber(value)} ${tr('currency.toman')}`;
  const fmtNum = (value) => fmtNumber(value);
  const itemName = (item) => i18n()?.itemName?.(item) || String(item?.name || '');
  const itemDesc = (item) => i18n()?.itemDesc?.(item) || String(item?.desc || '');
  const categoryTitle = (category) => i18n()?.catTitle?.(category) || String(category?.title || category?.name || '');
  const localizedName = (obj) =>
    i18n()?.pickLocalized?.(obj, 'name', 'nameEn', 'nameAr') || String(obj?.name || '');
  const imageSrc = (value) =>
    /^https?:\/\//i.test(String(value || ''))
      ? String(value)
      : `/${String(value || '').replace(/^\//, '')}`;
  const normalizeDigits = (value) =>
    String(value || '')
      .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
      .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  const qrContext = () => {
    const params = new URLSearchParams(location.search);
    const tableNo = normalizeDigits(params.get('table') || '').replace(/\D/g, '').slice(0, 20);
    const rawBranch = normalizeDigits(params.get('branch') || params.get('branchId') || '').replace(/\D/g, '');
    const branchId = rawBranch ? Number(rawBranch) : null;
    return { tableNo, branchId };
  };

  const state = {
    categories: [],
    items: [],
    itemById: new Map(),
    itemsByCategory: new Map(),
    cart: new Map(),
    branchId: null,
    zones: [],
    quote: null,
    submitting: false,
    idempotencyKey: '',
    booted: false,
    booting: false,
  };

  let quoteTimer = 0;
  let quoteController = null;
  let quoteGeneration = 0;
  let metaController = null;
  let metaGeneration = 0;
  let bootController = null;
  let bootGeneration = 0;
  let listenersBound = false;

  function abortController(controller) {
    try {
      controller?.abort();
    } catch (_) { }
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  async function api(url, options = {}) {
    const {
      signal: outerSignal,
      timeoutMs = 12000,
      headers: providedHeaders,
      ...fetchOptions
    } = options;

    const controller = new AbortController();
    let timeout = 0;
    let detachOuterAbort = null;

    if (outerSignal) {
      if (outerSignal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        outerSignal.addEventListener('abort', onAbort, { once: true });
        detachOuterAbort = () => outerSignal.removeEventListener('abort', onAbort);
      }
    }

    if (timeoutMs > 0) {
      timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    }

    const headers = fetchOptions.body
      ? { 'Content-Type': 'application/json', ...(providedHeaders || {}) }
      : providedHeaders;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: 'same-origin',
        headers,
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || tr('checkout.serverError'));
      }
      return body;
    } finally {
      if (timeout) window.clearTimeout(timeout);
      detachOuterAbort?.();
    }
  }

  function activeFulfillment() {
    return document.querySelector('input[name="fulfillment"]:checked')?.value || 'dine_in';
  }

  function lineItems() {
    return [...state.cart.entries()].map(([menuItemId, qty]) => ({ menuItemId, qty }));
  }

  function cartLines() {
    const lines = [];
    for (const [menuItemId, qty] of state.cart.entries()) {
      const item = state.itemById.get(Number(menuItemId));
      if (item) lines.push({ menuItemId, qty, item });
    }
    return lines;
  }

  function rebuildIndexes() {
    state.itemById.clear();
    state.itemsByCategory.clear();

    for (const item of state.items) {
      const itemId = Number(item.id);
      const categoryId = Number(item.categoryId);
      state.itemById.set(itemId, item);
      if (!state.itemsByCategory.has(categoryId)) {
        state.itemsByCategory.set(categoryId, []);
      }
      state.itemsByCategory.get(categoryId).push(item);
    }
  }

  function setMessage(text = '', kind = '') {
    const message = $('checkout-message');
    if (!message) return;
    if (message.textContent !== text) message.textContent = text;
    const nextClass = `msg${text ? ` ${kind}` : ''}`;
    if (message.className !== nextClass) message.className = nextClass;
  }

  function setHidden(element, hidden) {
    if (element && element.hidden !== hidden) element.hidden = hidden;
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function renderCategories(selected = null) {
    const nav = $('checkout-categories');
    if (!nav) return;

    const categories = state.categories.filter((category) => {
      const items = state.itemsByCategory.get(Number(category.id));
      return Array.isArray(items) && items.length > 0;
    });

    if (!categories.some((category) => Number(category.id) === Number(selected))) {
      selected = categories[0]?.id || null;
    }

    nav.dataset.selected = selected || '';
    nav.innerHTML = categories
      .map(
        (category) =>
          `<button type="button" class="checkout-category ${Number(category.id) === Number(selected) ? 'is-active' : ''}" data-category="${category.id}">${esc(categoryTitle(category))}</button>`,
      )
      .join('');

    renderItems(selected);
  }

  function renderItems(categoryId) {
    const nav = $('checkout-categories');
    const itemsRoot = $('checkout-items');
    if (!nav || !itemsRoot) return;

    const selected = Number(categoryId || nav.dataset.selected);
    nav.dataset.selected = String(selected || '');

    nav.querySelectorAll('[data-category]').forEach((button) => {
      button.classList.toggle(
        'is-active',
        Number(button.dataset.category) === selected,
      );
    });

    const items = state.itemsByCategory.get(selected) || [];
    itemsRoot.innerHTML =
      items
        .map(
          (item) => `
      <article class="checkout-item">
        <div class="checkout-item__image">${item.img ? `<img src="${esc(imageSrc(item.img))}" alt="${esc(itemName(item))}" loading="lazy" decoding="async" />` : ''}</div>
        <div class="checkout-item__body"><h2>${esc(itemName(item))}</h2><p>${esc(itemDesc(item))}</p><div class="checkout-item__bottom"><b>${fmtMoney(item.price)}</b><button class="checkout-add" type="button" data-add="${item.id}" aria-label="${esc(tr('checkout.addItem', { name: itemName(item) }))}">+</button></div></div>
      </article>`,
        )
        .join('') || `<p class="checkout-cart-empty">${esc(tr('checkout.emptyCategory'))}</p>`;
  }

  function adjust(id, delta) {
    const itemId = Number(id);
    if (!state.itemById.has(itemId)) return;

    const next = Math.max(
      0,
      Math.min(99, Number(state.cart.get(itemId) || 0) + Number(delta || 0)),
    );

    if (next) state.cart.set(itemId, next);
    else state.cart.delete(itemId);

    renderCart();
    refreshQuote();
  }

  function renderCart() {
    const cartRoot = $('checkout-cart');
    const count = $('cart-count');
    if (!cartRoot || !count) return;

    const lines = cartLines();
    setText(
      count,
      tr('cart.itemsCount', { n: fmtNum(lines.reduce((sum, line) => sum + line.qty, 0)) }),
    );

    cartRoot.innerHTML =
      lines
        .map(
          (line) =>
            `<div class="checkout-cart-line"><div><b>${esc(itemName(line.item))}</b><small>${fmtMoney(line.item.price)} · ${fmtNum(line.qty)} ${esc(tr('checkout.qtyUnit'))}</small></div><div class="checkout-cart-line__actions"><button type="button" data-subtract="${line.menuItemId}" aria-label="${esc(tr('cart.dec'))}">−</button><b>${fmtNum(line.qty)}</b><button type="button" data-add="${line.menuItemId}" aria-label="${esc(tr('cart.inc'))}">+</button></div></div>`,
        )
        .join('') || `<p class="checkout-cart-empty">${esc(tr('checkout.emptyCart'))}</p>`;

    renderTotals(lines);
  }

  function renderTotals(lines = cartLines()) {
    const totals = $('checkout-totals');
    const submitButton = $('checkout-submit');
    if (!totals || !submitButton) return;

    const subtotal = lines.reduce(
      (sum, line) => sum + Number(line.item.price || 0) * line.qty,
      0,
    );
    const quote = state.quote?.ok ? state.quote : null;
    const deliveryFee = quote?.deliveryFee || 0;
    const tierDiscount = quote?.tierDiscountToman || 0;
    const pointsDiscount = quote?.pointsDiscountToman || 0;
    const total = quote?.total ?? Math.max(0, subtotal + deliveryFee - (tierDiscount + pointsDiscount));

    let html = `<div><span>${esc(tr('checkout.subtotal'))}</span><b>${fmtMoney(subtotal)}</b></div>`;
    if (tierDiscount) {
      html += `<div style="color:#a855f7;"><span>تخفیف باشگاه (${esc(quote?.tier?.name || 'وفاداری')}):</span><b>-${fmtMoney(tierDiscount)}</b></div>`;
    }
    if (pointsDiscount) {
      html += `<div style="color:#f59e0b;"><span>کسر امتیاز باشگاه (${fmtNum(quote?.pointsRedeemed || 0)} امتیاز):</span><b>-${fmtMoney(pointsDiscount)}</b></div>`;
    }
    if (deliveryFee) {
      html += `<div><span>${esc(tr('checkout.deliveryFee'))}</span><b>${fmtMoney(deliveryFee)}</b></div>`;
    }
    html += `<div class="is-total"><span>${esc(tr('checkout.payable'))}</span><b>${fmtMoney(total)}</b></div>`;

    totals.innerHTML = html;
    submitButton.disabled = !state.cart.size || state.submitting;
  }

  function syncFulfillmentFields() {
    const fulfillment = activeFulfillment();
    setHidden($('checkout-table-wrap'), fulfillment !== 'dine_in');
    setHidden($('checkout-zone-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-address-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-instructions-wrap'), fulfillment !== 'delivery');
    setHidden($('checkout-saved-addresses-wrap'), fulfillment !== 'delivery' || !(state.userAddresses?.length));

    if (fulfillment === 'delivery' && state.userAddresses?.length) {
      renderCheckoutAddresses();
    }

    const submit = $('checkout-submit');
    const payment = $('checkout-payment');
    if (submit && payment) {
      setText(
        submit,
        payment.value === 'online' ? tr('checkout.continuePayment') : tr('cart.submit'),
      );
    }

    refreshQuote();
  }

  function renderCheckoutAddresses() {
    const wrap = $('checkout-saved-addresses-wrap');
    const list = $('checkout-addresses-list');
    if (!wrap || !list) return;

    const fulfillment = activeFulfillment();
    const addresses = state.userAddresses || [];

    if (fulfillment !== 'delivery' || !addresses.length) {
      setHidden(wrap, true);
      return;
    }

    setHidden(wrap, false);
    list.innerHTML = addresses.map((addr, idx) => {
      const isDef = !!addr.isDefault || idx === 0;
      const fullAddr = [
        addr.city,
        addr.district,
        addr.address,
        addr.plaque ? `پلاک ${addr.plaque}` : '',
        addr.unit ? `واحد ${addr.unit}` : '',
      ].filter(Boolean).join('، ');

      return `
        <label class="checkout-addr-option ${isDef ? 'is-default' : ''}">
          <input type="radio" name="selected_checkout_addr" value="${esc(addr.id)}" ${isDef ? 'checked' : ''} style="margin-top:0.2rem;" />
          <div style="flex:1; font-size:0.78rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <b class="checkout-addr-title">${esc(addr.title || '📍 نشانی')}</b>
              ${addr.isDefault ? '<span class="pill" style="font-size:0.65rem; background:#10b981; color:#fff; padding:0 0.35rem;">پیش‌فرض</span>' : ''}
            </div>
            <div class="checkout-addr-full" style="margin-top:0.15rem; line-height:1.35;">${esc(fullAddr)}</div>
          </div>
        </label>
      `;
    }).join('') + `
      <label class="checkout-addr-option is-custom">
        <input type="radio" name="selected_checkout_addr" value="custom" style="margin-top:0;" />
        <span class="checkout-addr-custom-text" style="font-size:0.75rem;">✍️ آدرس جدید یا دستی (وارد کردن در کادر زیر)</span>
      </label>
    `;

    // Automatically fill the default address if empty
    const addrField = $('checkout-address');
    if (!addrField?.value) {
      const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
      if (defaultAddr) applyAddressToFields(defaultAddr);
    }

    list.querySelectorAll('input[name="selected_checkout_addr"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        list.querySelectorAll('.checkout-addr-option').forEach(o => {
          o.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        radio.closest('.checkout-addr-option').style.borderColor = '#10b981';

        if (radio.value === 'custom') {
          if (addrField) {
            addrField.value = '';
            addrField.focus();
          }
        } else {
          const chosen = addresses.find((a) => a.id === radio.value);
          if (chosen) applyAddressToFields(chosen);
        }
      });
    });
  }

  function applyAddressToFields(addr) {
    const fullAddr = [
      addr.city,
      addr.district,
      addr.address,
      addr.plaque ? `پلاک ${addr.plaque}` : '',
      addr.floor ? `طبقه ${addr.floor}` : '',
      addr.unit ? `واحد ${addr.unit}` : '',
    ].filter(Boolean).join('، ');

    const addrField = $('checkout-address');
    const noteField = $('checkout-instructions');
    if (addrField) addrField.value = fullAddr;
    if (noteField && addr.note) noteField.value = addr.note;
  }

  function initCheckoutAddressModal() {
    const modal = $('address-modal');
    if (!modal) return;

    $('checkout-add-addr-btn')?.addEventListener('click', () => {
      $('#modal-addr-id').value = '';
      $('#modal-addr-title').value = '🏠 منزل';
      document.querySelectorAll('.addr-title-pill').forEach(pill => {
        pill.classList.toggle('is-active', pill.dataset.title === '🏠 منزل');
      });
      $('#modal-addr-city').value = 'مشهد';
      $('#modal-addr-district').value = '';
      $('#modal-addr-street').value = '';
      $('#modal-addr-plaque').value = '';
      $('#modal-addr-floor').value = '';
      $('#modal-addr-unit').value = '';
      $('#modal-addr-receiver-name').value = $('checkout-name')?.value || state.user?.name || '';
      $('#modal-addr-receiver-phone').value = $('checkout-phone')?.value || state.user?.phone || '';
      $('#modal-addr-note').value = '';
      $('#modal-addr-default').checked = true;

      const msgEl = $('#modal-addr-msg');
      if (msgEl) msgEl.textContent = '';

      modal.style.display = 'flex';
    });

    $('#close-address-modal-btn')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    document.querySelectorAll('.addr-title-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.addr-title-pill').forEach(p => {
          p.style.color = 'var(--text-muted)';
          p.classList.remove('is-active');
        });
        pill.classList.add('is-active');
        pill.style.color = '#10b981';
        $('#modal-addr-title').value = pill.dataset.title;
      });
    });

    $('#save-address-modal-btn')?.addEventListener('click', async () => {
      const street = $('#modal-addr-street').value.trim();
      const msgEl = $('#modal-addr-msg');
      if (!street) {
        if (msgEl) {
          msgEl.className = 'msg error';
          msgEl.textContent = 'لطفاً نشانی پستی دقیق (خیابان، کوچه) را وارد کنید.';
        }
        return;
      }

      const btn = $('#save-address-modal-btn');
      btn.disabled = true;
      btn.textContent = 'در حال ذخیره…';

      try {
        const res = await fetch('/api/user/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            title: $('#modal-addr-title').value.trim(),
            city: $('#modal-addr-city').value.trim(),
            district: $('#modal-addr-district').value.trim(),
            address: street,
            plaque: $('#modal-addr-plaque').value.trim(),
            floor: $('#modal-addr-floor').value.trim(),
            unit: $('#modal-addr-unit').value.trim(),
            receiverName: $('#modal-addr-receiver-name').value.trim(),
            receiverPhone: $('#modal-addr-receiver-phone').value.trim(),
            note: $('#modal-addr-note').value.trim(),
            isDefault: $('#modal-addr-default').checked,
          }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          state.userAddresses = data.addresses || [];
          renderCheckoutAddresses();
          if (data.address) applyAddressToFields(data.address);
          modal.style.display = 'none';
        } else {
          if (msgEl) {
            msgEl.className = 'msg error';
            msgEl.textContent = data.error || 'خطا در ذخیره نشانی';
          }
        }
      } catch (_) {
        if (msgEl) {
          msgEl.className = 'msg error';
          msgEl.textContent = 'خطای اتصال به سرور';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 ذخیره نشانی';
      }
    });
  }

  async function loadUserAddresses() {
    try {
      const res = await api('/api/auth/me');
      if (res && res.user) {
        state.user = res.user;
        const nameInput = $('checkout-name');
        const phoneInput = $('checkout-phone');
        if (nameInput && !nameInput.value) nameInput.value = res.user.name || '';
        if (phoneInput && !phoneInput.value) phoneInput.value = res.user.phone || '';

        const addresses = Array.isArray(res.user.addresses) ? res.user.addresses : [];
        state.userAddresses = addresses;
        if (activeFulfillment() === 'delivery') {
          renderCheckoutAddresses();
        }
      }
    } catch (_) {}
    initCheckoutAddressModal();
  }

  async function loadCheckoutMeta(requestedBranchId = state.branchId) {
    const generation = ++metaGeneration;
    abortController(metaController);
    metaController = new AbortController();

    const query = requestedBranchId ? `?branchId=${Number(requestedBranchId)}` : '';
    const meta = await api(`/api/checkout/meta${query}`, {
      signal: metaController.signal,
      timeoutMs: 10000,
    });

    if (generation !== metaGeneration || metaController.signal.aborted) {
      throw new DOMException('Stale checkout meta response', 'AbortError');
    }

    const branch = $('checkout-branch');
    const zone = $('checkout-zone');
    if (!branch || !zone) return meta;

    const branches = Array.isArray(meta.branches) ? meta.branches : [];
    const requested = Number(requestedBranchId || 0);
    const selectedBranch =
      branches.find((item) => Number(item.id) === requested) || branches[0] || null;

    branch.innerHTML = branches
      .map(
        (item) =>
          `<option value="${item.id}" ${Number(item.id) === Number(selectedBranch?.id) ? 'selected' : ''}>${esc(localizedName(item))}</option>`,
      )
      .join('');

    state.branchId = Number(branch.value) || Number(selectedBranch?.id) || null;
    state.zones = Array.isArray(meta.deliveryZones) ? meta.deliveryZones : [];

    zone.innerHTML =
      state.zones
        .map(
          (item) =>
            `<option value="${item.id}">${esc(localizedName(item))} · ${fmtMoney(item.fee)} · ${esc(tr('checkout.minimum'))} ${fmtMoney(item.minOrder)}</option>`,
        )
        .join('') || `<option value="">${esc(tr('checkout.noZone'))}</option>`;

    return meta;
  }

  function currentQuoteSignature() {
    return JSON.stringify({
      items: lineItems(),
      fulfillment: activeFulfillment(),
      branchId: state.branchId,
      tableNo: $('checkout-table')?.value || '',
      deliveryZoneId: $('checkout-zone')?.value || '',
    });
  }

  function cancelQuoteWork({ cancelTimer = true } = {}) {
    if (cancelTimer && quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;
    quoteGeneration += 1;
  }

  function refreshQuote() {
    if (quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;

    const generation = ++quoteGeneration;

    quoteTimer = window.setTimeout(async () => {
      quoteTimer = 0;

      if (!state.cart.size) {
        state.quote = null;
        renderTotals();
        return;
      }

      const signature = currentQuoteSignature();
      const controller = new AbortController();
      quoteController = controller;
      setText($('checkout-live'), tr('checkout.calculating'));

      try {
        const quote = await api('/api/checkout/quote', {
          method: 'POST',
          body: JSON.stringify({
            items: lineItems(),
            fulfillment: activeFulfillment(),
            branchId: state.branchId,
            tableNo: $('checkout-table')?.value || '',
            deliveryZoneId: $('checkout-zone')?.value || '',
            phone: $('checkout-phone')?.value.trim() || '',
            redeemPoints: state.redeemPoints || 0,
          }),
          signal: controller.signal,
          timeoutMs: 10000,
        });

        if (
          generation !== quoteGeneration ||
          controller.signal.aborted ||
          signature !== currentQuoteSignature()
        ) {
          return;
        }

        state.quote = quote;
        setText(
          $('checkout-live'),
          quote.etaMinutes ? tr('checkout.eta', { n: fmtNum(quote.etaMinutes) }) : tr('checkout.ready'),
        );
        setText(
          $('checkout-note-text'),
          quote.fulfillment === 'delivery'
            ? tr('checkout.deliverySummary', { zone: localizedName(quote.zone) || tr('checkout.selectedZone'), n: fmtNum(quote.etaMinutes) })
            : quote.fulfillment === 'pickup'
              ? tr('checkout.pickupSummary')
              : tr('checkout.dineSummary'),
        );
      } catch (error) {
        if (
          isAbortError(error) ||
          generation !== quoteGeneration ||
          controller.signal.aborted
        ) {
          return;
        }
        state.quote = null;
        setText($('checkout-live'), tr('checkout.needsReview'));
        setText($('checkout-note-text'), error.message);
      } finally {
        if (quoteController === controller) quoteController = null;
      }

      renderTotals();
    }, 220);
  }

  function makeIdempotencyKey() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  function showSuccess(order, payment = null) {
    const form = $('checkout-form');
    const success = $('checkout-success');
    const sandbox = $('sandbox-confirm');
    const badge = $('checkout-order-badge');

    state.submitting = false;
    state.cart.clear();
    renderCart();
    renderTotals();

    setHidden(form, true);
    setHidden(success, false);

    if (badge) {
      badge.textContent = order.orderNo || `W-${order.id}`;
    }

    const isOnlinePending = payment?.status === 'pending';
    setText(
      $('checkout-success-title'),
      isOnlinePending
        ? 'ثبت اولیه سفارش (در انتظار پرداخت آنلاین)'
        : 'سفارش با موفقیت به آشپزخانه ارسال شد',
    );

    let summaryText = `سفارش شما به مبلغ ${fmtMoney(order.total)} با موفقیت در سیستم ثبت گردید.`;
    if (order.fulfillment === 'delivery') {
      summaryText += ` زمان تقریبی ارسال پیک: حدود ${fmtNum(order.delivery?.etaMinutes || 35)} دقیقه.`;
    } else if (order.fulfillment === 'dine_in') {
      summaryText += ` شماره میز: ${esc(order.tableNo)}.`;
    }
    setText($('checkout-success-body'), summaryText);

    if (!sandbox) return;
    sandbox.onclick = null;
    sandbox.disabled = false;
    sandbox.hidden = !(
      payment?.provider === 'sandbox' &&
      payment?.status === 'pending' &&
      payment.sandboxToken
    );

    if (!sandbox.hidden) {
      sandbox.onclick = async () => {
        if (sandbox.disabled) return;
        sandbox.disabled = true;
        sandbox.textContent = 'در حال اعتبارسنجی پرداخت…';

        try {
          const result = await api(
            `/api/checkout/payments/${payment.id}/sandbox-confirm`,
            {
              method: 'POST',
              body: JSON.stringify({ token: payment.sandboxToken }),
              timeoutMs: 15000,
            },
          );
          setText($('checkout-success-title'), 'پرداخت آنلاین با موفقیت تأیید شد');
          setText(
            $('checkout-success-body'),
            `سفارش شماره ${result.order?.orderNo || result.order?.id} با موفقیت تسویه و امتیاز باشگاه برای شما منظور گردید.`,
          );
          sandbox.hidden = true;
        } catch (error) {
          sandbox.disabled = false;
          sandbox.textContent = '✓ تأیید پرداخت آنلاین';
          setText($('checkout-success-body'), error.message);
        }
      };
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!state.cart.size || state.submitting) return;

    state.submitting = true;
    cancelQuoteWork();
    renderTotals();
    setMessage(tr('checkout.submitting'));

    const payload = {
      items: lineItems(),
      branchId: state.branchId,
      fulfillment: activeFulfillment(),
      tableNo: $('checkout-table')?.value.trim() || '',
      deliveryZoneId: $('checkout-zone')?.value || '',
      deliveryAddress: $('checkout-address')?.value.trim() || '',
      deliveryInstructions: $('checkout-instructions')?.value.trim() || '',
      name: $('checkout-name')?.value.trim() || '',
      phone: $('checkout-phone')?.value.trim() || '',
      paymentMethod: $('checkout-payment')?.value || 'online',
      redeemPoints: state.redeemPoints || 0,
      note: $('checkout-note')?.value.trim() || '',
    };

    try {
      if (!state.idempotencyKey) state.idempotencyKey = makeIdempotencyKey();

      const result = await api('/api/checkout/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': state.idempotencyKey },
        body: JSON.stringify(payload),
        timeoutMs: 30000,
      });

      setMessage('');
      showSuccess(result.order, result.payment);
    } catch (error) {
      setMessage(
        isAbortError(error) ? tr('checkout.timeout') : error.message,
        'error',
      );
      state.submitting = false;
      renderTotals();
      refreshQuote();
    }
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;

    $('checkout-categories')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      renderItems(Number(button.dataset.category));
    });

    $('checkout-items')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-add]');
      if (!button) return;
      adjust(Number(button.dataset.add), 1);
    });

    $('checkout-cart')?.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add]');
      if (add) {
        adjust(Number(add.dataset.add), 1);
        return;
      }
      const subtract = event.target.closest('[data-subtract]');
      if (subtract) adjust(Number(subtract.dataset.subtract), -1);
    });

    document.querySelectorAll('input[name="fulfillment"]').forEach((input) => {
      input.addEventListener('change', syncFulfillmentFields);
    });

    $('checkout-branch')?.addEventListener('change', async () => {
      const branch = $('checkout-branch');
      const previousBranchId = state.branchId;
      const requestedBranchId = Number(branch?.value) || null;
      if (!requestedBranchId) return;

      try {
        await loadCheckoutMeta(requestedBranchId);
        setMessage('');
        syncFulfillmentFields();
      } catch (error) {
        if (isAbortError(error)) return;
        if (branch && previousBranchId) branch.value = String(previousBranchId);
        setMessage(error.message, 'error');
      }
    });

    $('checkout-zone')?.addEventListener('change', refreshQuote);
    $('checkout-table')?.addEventListener('input', refreshQuote);
    $('checkout-payment')?.addEventListener('change', syncFulfillmentFields);
    $('checkout-form')?.addEventListener('submit', submit);

    document.addEventListener('westo:langchange', () => {
      document.title = tr('checkout.documentTitle');
      renderCategories(Number($('checkout-categories')?.dataset.selected) || null);
      renderCart();
      syncFulfillmentFields();
      if (state.branchId) loadCheckoutMeta(state.branchId).catch(() => {});
    });
  }

  async function boot() {
    if (state.booted || state.booting) return;
    state.booting = true;
    document.title = tr('checkout.documentTitle');

    const generation = ++bootGeneration;
    abortController(bootController);
    bootController = new AbortController();
    const context = qrContext();

    try {
      const [content] = await Promise.all([
        api('/api/content', {
          signal: bootController.signal,
          timeoutMs: 12000,
        }),
        loadCheckoutMeta(context.branchId || undefined),
      ]);

      if (generation !== bootGeneration || bootController.signal.aborted) return;

      state.categories = Array.isArray(content.menuCategories)
        ? content.menuCategories
        : [];
      state.items = (Array.isArray(content.menuItems) ? content.menuItems : []).filter(
        (item) => item.available !== false,
      );
      rebuildIndexes();

      bindListeners();
      loadUserAddresses();
      if (context.tableNo) {
        const dineIn = document.querySelector('input[name="fulfillment"][value="dine_in"]');
        if (dineIn) dineIn.checked = true;
        const table = $('checkout-table');
        if (table) {
          table.value = context.tableNo;
          table.dataset.qrPrefilled = '1';
          table.setAttribute('aria-describedby', 'checkout-qr-hint');
        }
        const tableWrap = $('checkout-table-wrap');
        if (tableWrap && !document.getElementById('checkout-qr-hint')) {
          const hint = document.createElement('small');
          hint.id = 'checkout-qr-hint';
          hint.className = 'checkout-qr-hint';
          hint.textContent = tr('cart.qrPrefilled');
          tableWrap.appendChild(hint);
        }
      }
      renderCategories();
      try {
        const reorderRaw = sessionStorage.getItem('westo_reorder_items');
        if (reorderRaw) {
          sessionStorage.removeItem('westo_reorder_items');
          const items = JSON.parse(reorderRaw);
          if (Array.isArray(items)) {
            items.forEach(it => {
              const mId = it.menuItemId || it.id;
              if (mId && (it.qty || it.quantity)) {
                state.cart.set(mId, Number(it.qty || it.quantity) || 1);
              }
            });
          }
        }
      } catch (_) {}
      renderCart();
      syncFulfillmentFields();

      state.booted = true;
      state.booting = false;
    } catch (error) {
      state.booting = false;
      if (isAbortError(error)) return;
      const itemsRoot = $('checkout-items');
      if (itemsRoot) {
        itemsRoot.innerHTML = `<p class="checkout-cart-empty">${esc(error.message || tr('checkout.loadFail'))}</p>`;
      }
    }
  }

  window.addEventListener('pagehide', () => {
    if (quoteTimer) {
      window.clearTimeout(quoteTimer);
      quoteTimer = 0;
    }
    abortController(quoteController);
    quoteController = null;
    abortController(metaController);
    metaController = null;

    if (!state.booted) {
      abortController(bootController);
      bootController = null;
      state.booting = false;
      bootGeneration += 1;
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;

    if (!state.booted) {
      boot();
      return;
    }

    // Preserve the current UI immediately after bfcache restore, then refresh
    // the derived quote in the background so totals cannot remain stale.
    if (state.cart.size && !$('checkout-form')?.hidden) refreshQuote();
  });

  boot();
})();

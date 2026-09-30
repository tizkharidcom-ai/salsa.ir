'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const profile = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
const profileCss = fs.readFileSync(path.join(root, 'css', 'profile-dashboard.css'), 'utf8');

function extractRenderer() {
  const start = profile.indexOf('function renderAllOrderHistory(');
  const end = profile.indexOf('// 12 — Reorder Helper', start);
  assert.ok(start >= 0 && end > start, 'full customer order-history renderer exists');
  const source = profile.slice(start, end);
  return new Function('$', 'safeFormatShamsiDate', `${source}; return renderAllOrderHistory;`);
}

test('customer can expand the complete loaded order history instead of being sent back to the menu', () => {
  assert.match(profile, /id="view-all-orders-btn" aria-expanded="false" aria-controls="full-order-history"/);
  assert.match(profile, /id="full-order-history" hidden/);
  assert.match(profile, /id="all-orders-history-list"/);

  const start = profile.indexOf("$('#view-all-orders-btn')?.addEventListener('click'");
  const end = profile.indexOf('// Settings Sheet Open', start);
  assert.ok(start >= 0 && end > start, 'history button handler exists');
  const handler = profile.slice(start, end);
  assert.match(handler, /renderAllOrderHistory\(ordersData\)/);
  assert.match(handler, /history\.hidden = !isOpening/);
  assert.match(handler, /setAttribute\('aria-expanded', String\(isOpening\)\)/);
  assert.match(handler, /scrollIntoView/);
  assert.doesNotMatch(handler, /location\.href/);
});

test('history renders more than the three recent orders and keeps payment, fulfillment, and delivery acceptance distinct', () => {
  let markup = '';
  const rendererFactory = extractRenderer();
  const render = rendererFactory((selector) => selector === '#all-orders-history-list'
    ? { set innerHTML(value) { markup = value; } }
    : null, (value) => String(value || ''));

  render([
    { id: 1, orderNo: 'W-1', status: 'preparing', statusLabel: 'در حال آماده‌سازی', paymentStatus: 'paid', fulfillment: 'dine_in', total: 120000, items: [{ name: 'سوپ' }] },
    { id: 2, status: 'awaiting_confirmation', fulfillment: 'delivery', total: 220000, items: [] },
    { id: 3, status: 'cancelled', paymentStatus: 'refunded', fulfillment: 'pickup', total: 50000, items: [] },
    { id: '<4>', status: 'ready', paymentStatus: 'pending', fulfillment: 'delivery', deliveryAcceptance: { status: 'accepted' }, total: 300000, items: [{ name: '<img src=x onerror=alert(1)>' }] },
  ]);

  assert.equal((markup.match(/class="v1-order-history-card"/g) || []).length, 4);
  assert.match(markup, /پرداخت‌شده/);
  assert.match(markup, /بازپرداخت‌شده/);
  assert.match(markup, /اطلاعات پرداخت در این پاسخ سفارش موجود نیست/);
  assert.match(markup, /صرف در سالن/);
  assert.match(markup, /ارسال با پیک/);
  assert.match(markup, /وضعیت پذیرش رستوران در دسترس نیست/);
  assert.match(markup, /پذیرش‌شده/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
});

test('order-history expansion has responsive, theme-token-based card styling', () => {
  assert.match(profileCss, /\.v1-order-history-card\s*\{/);
  assert.match(profileCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(profileCss, /var\(--w-surface\)/);
  assert.match(profileCss, /var\(--w-text-secondary\)/);
});

test('cached order status is explicitly marked stale and can be refreshed without overwriting it on API failure', () => {
  assert.match(profile, /id="order-history-freshness"[^>]*hidden/);
  assert.match(profile, /این وضعیت از نسخهٔ ذخیره‌شده است و ممکن است به‌روز نباشد/);
  assert.match(profile, /id="retry-order-history-btn"/);
  assert.match(profile, /const orderHistoryFresh = Array\.isArray\(ordJson\?\.orders\)/);
  assert.match(profile, /if \(orderHistoryFresh\) \{[\s\S]*?westo_guest_profile_snapshot/);
  assert.match(profile, /setOrderHistoryStale\(true\)/);
});

test('cached profile data never presents stale loyalty as current or fabricates zero balances', () => {
  const fallbackStart = profile.indexOf('if (cached && cached.user)');
  const fallbackEnd = profile.indexOf("showToast('اطلاعات ذخیره‌شده حساب بارگذاری شد.')", fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'cached profile fallback exists');
  const fallback = profile.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /renderMembership\(userData, null\)/);
  assert.match(fallback, /renderAchievements\(null, false\)/);
  assert.match(fallback, /renderNextReward\(null\)/);
  assert.doesNotMatch(fallback, /loyaltyData = cached\.loyalty/);
  assert.match(profile, /const balanceLabel = Number\.isFinite\(bal\)[\s\S]*?\?[^;]*: '—'/);
});

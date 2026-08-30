'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Persian guest surfaces avoid unnecessary English interface copy', () => {
  const i18n = read('js/i18n.js');
  const index = read('index.html');
  const about = read('about.html');
  const feedback = read('feedback.html');
  const profile = read('profile.html');

  assert.match(i18n, /'site\.documentTitle': \{ fa: 'وستو — منوی کافه و رستوران'/);
  assert.match(i18n, /'profile\.documentTitle': \{ fa: 'پروفایل — وستو'/);
  assert.match(i18n, /'feedback\.nps': \{ fa: 'احتمال پیشنهاد به دوستان \(۰ تا ۱۰\)'/);
  assert.match(i18n, /'nav\.aboutHint': \{[\s\S]*?fa: 'درباره ما'/);
  assert.match(index, /data-admin-content="entrance\.subtitle">کافه و رستوران<\/p>/);
  assert.match(index, /id="eg-lang-fa">فا<\/button>/);
  assert.match(index, /id="eg-lang-en" dir="ltr">اِن<\/button>/);
  assert.match(index, /id="eg-lang-ar" dir="rtl">عر<\/button>/);
  assert.doesNotMatch(about, />About Us<\/p>/);
  assert.doesNotMatch(feedback, /امتیاز NPS/);
  assert.match(feedback, /\.fb-brand img \{[^}]*width: min\(180px, 70vw\)/);
  assert.match(feedback, /westo-fa-wordmark-dark\.png\?v=feedbackPersian1/);
  assert.doesNotMatch(profile, /پروفایل — Westo/);
});

test('admin entrance copy remains editable but legacy English default is localized in Persian', () => {
  const overrides = read('js/content-overrides.js');
  const entranceRuntime = read('js/animations.js');
  assert.match(overrides, /key === 'entrance\.subtitle' && lang === 'fa'/);
  assert.match(overrides, /value = 'کافه و رستوران'/);
  assert.match(overrides, /siteTitle\.replace\(\/\^Westo\\b\/i, 'وستو'\)/);
  assert.match(entranceRuntime, /const localizedAdminCopy = \(key, value\) =>/);
  assert.match(entranceRuntime, /key === 'entrance\.subtitle' && i18n\(\)\?\.lang === 'fa'/);
  assert.match(entranceRuntime, /return tr\('eg\.subtitleEn'\)/);
});

test('guest pages request the current shared language asset', () => {
  for (const file of ['about.html', 'feedback.html', 'login.html', 'menu.html', 'order.html', 'profile.html', 'reserve.html']) {
    assert.match(read(file), /js\/i18n\.js\?v=logic10-persian2/, `${file} uses stale i18n asset`);
  }
});

test('menu calls the basket a basket and keeps QR table context separate from item count', () => {
  const i18n = read('js/i18n.js');
  const menu = read('menu.html');
  const cart = read('js/table-cart.js');
  const catalogueCss = read('css/classic-menu-catalogue-v2.css');

  assert.match(i18n, /'cart\.title': \{ fa: 'سبد'/);
  assert.match(i18n, /'cm\.add': \{ fa: 'افزودن به سبد'/);
  assert.doesNotMatch(menu, />تیبل</);
  assert.match(menu, /id="cm-order-context"/);
  assert.match(cart, /tr\('cart\.qrContext', \{ n: tableNo \}\)/);
  assert.match(cart, /n \? `\$\{contextLabel\}، \$\{shown\} قلم` : contextLabel/);
  assert.match(catalogueCss, /\.cm-order-context/);
});

test('standalone checkout stays inside a mobile viewport and localizes QR context', () => {
  const checkoutCss = read('css/checkout.css');
  const checkoutJs = read('js/checkout.js');
  const order = read('order.html');

  assert.match(checkoutCss, /\.checkout-menu, \.checkout-side \{ min-width: 0; \}/);
  assert.match(checkoutJs, /hint\.textContent = tr\('cart\.qrPrefilled'\)/);
  assert.doesNotMatch(checkoutJs, /شماره میز از QR/);
  assert.match(order, /css\/checkout\.css\?v=logic10/);
  assert.match(order, /js\/checkout\.js\?v=logic10/);
});

test('all installable guest pages share the current service-worker release', () => {
  for (const file of ['about.html', 'cgu.html', 'feedback.html', 'login.html', 'menu.html', 'mentions-legales.html', 'order.html', 'politique-de-confidentialite.html', 'profile.html', 'reserve.html']) {
    const source = read(file);
    assert.match(source, /manifest\.webmanifest\?v=release14uf1d28-webp-only/, `${file} has stale manifest release`);
    assert.match(source, /pwa-bootstrap\.js\?v=release14uf1d28-webp-only/, `${file} has stale worker bootstrap release`);
  }
});

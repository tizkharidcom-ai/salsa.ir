'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const html = read('prototype/index.html');
const app = read('prototype/js/app.js');
const appShell = read('prototype/js/godmode/components/app-shell.js');
const store = read('prototype/js/store.js');
const banner = read('prototype/js/components/provenance-banner.js');
const tenantWizard = read('prototype/js/views/gm05-tenant-new.js');
const section = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `source section exists: ${startText}`);
  return source.slice(start, end);
};
const appBanner = section(app, 'updateProvenanceBanner() {', '// Reset Mock Data');
const shellBanner = section(appShell, 'updateProvenanceBanner() {', 'bindGlobalEvents() {');
const storeProvenance = section(store, 'getProvenance(viewId =', '\n  save() {');

test('every GODMODE shell identifies the isolated fixture environment as non-operational', () => {
  for (const source of [html, appBanner, shellBanner, storeProvenance, banner]) {
    assert.match(source, /پیش‌نمایش ایزوله|پیش‌نمایش محلی/);
    assert.match(source, /ساختگی|fixture/);
  }
  assert.doesNotMatch(html, /ناوگان فعال: چندمستأجری/);
  assert.doesNotMatch(appBanner, /محیط عملیاتی|آماده استقرار و بهره‌برداری VPS/);
  assert.doesNotMatch(shellBanner, /Production Live|متصل به سرور کنترل پلن/);
  assert.doesNotMatch(banner, /اکوسیستم عملیاتی|داده‌های عملیاتی زنده/);
  assert.doesNotMatch(storeProvenance, /badge: 'محیط عملیاتی وستو'|source: 'پایگاه داده عملیاتی وستو'/);
  assert.doesNotMatch(tenantWizard, /آماده استقرار پروداکشن/);
  assert.match(tenantWizard, /استقرار پروداکشن هنوز تأیید نشده/);
});

test('demo reset and keyboard-help buttons are absent from the platform header', () => {
  assert.doesNotMatch(html, /id="btn-clean-data"|id="btn-shortcuts-help"/);
});

test('bridge check cannot report success without a real health check', () => {
  assert.match(app, /اتصال عملیاتی در این پیش‌نمایش برقرار نیست/);
  assert.match(banner, /اتصال به هستهٔ عملیاتی در این پیش‌نمایش برقرار نیست/);
});

console.log('GODMODE provenance truth checks passed.');

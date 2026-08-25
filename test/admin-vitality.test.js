'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('admin.html');
const adminJs = read('js/admin.js');
const shellJs = read('js/admin-professional-v4.js');
const themeJs = read('js/theme.js');
const vitalityCss = read('css/admin-vitality-v5.css');

test('admin vitality system is the final visual layer and defaults to an isolated light theme', () => {
  const vitalityIndex = admin.indexOf('css/admin-vitality-v5.css');
  assert.ok(vitalityIndex > admin.indexOf('css/design-logic-v13.css'));
  assert.match(admin, /admin-vitality-v5\.css\?v=adminVitality\d+/);
  assert.match(themeJs, /IS_ADMIN\s*\?\s*'westo_admin_theme'\s*:\s*'westo_theme'/);
  assert.match(themeJs, /IS_ADMIN\s*\?\s*'light'\s*:\s*'system'/);
});

test('every visible admin destination still has a native renderer', () => {
  const tabs = [...admin.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(tabs).size, 29);
  for (const tab of new Set(tabs)) {
    assert.match(adminJs, new RegExp(`async\\s+${tab}\\s*\\(`), `missing renderer for ${tab}`);
  }
});

test('dashboard uses real operational surfaces and the sidebar receives consistent icons', () => {
  assert.match(adminJs, /class="vital-dashboard"/);
  assert.match(adminJs, /api\(`\/api\/admin\/command-center/);
  assert.match(adminJs, /api\(`\/api\/admin\/v2\/overview/);
  assert.doesNotMatch(adminJs, /vital-task-list[\s\S]{0,500}type="checkbox"/);
  assert.match(shellJs, /installNavIcons\(\)/);
  assert.match(shellJs, /const NAV_ICONS\s*=\s*\{/);
});

test('shared admin surfaces, tables, focus states and responsive layouts are covered', () => {
  for (const selector of ['.section-box', '.card', '.tbl', '.table-scroll', '.kds-card', '.admin-settings-nav', '.admin-qr-preview__stage']) {
    assert.ok(vitalityCss.includes(selector), `missing visual coverage for ${selector}`);
  }
  assert.match(vitalityCss, /:focus-visible/);
  assert.match(vitalityCss, /@media \(max-width: 680px\)/);
  assert.match(vitalityCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(vitalityCss, /table\.tbl\s*\{[^}]*min-width:\s*42rem/s);
});

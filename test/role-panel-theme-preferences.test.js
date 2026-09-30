'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'role-panel.js'), 'utf8');
const roleCss = fs.readFileSync(path.join(root, 'css', 'role-panel.css'), 'utf8');
const floorCss = fs.readFileSync(path.join(root, 'css', 'waiter-floor-plan.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'role-panel.html'), 'utf8');

test('cashier and waiter share a locally saved light, dark, or system theme preference', () => {
  assert.match(source, /const STAFF_THEME_STORAGE_KEY = 'westo_staff_theme'/);
  assert.match(source, /role === 'cashier' \|\| role === 'waiter'/);
  assert.match(source, /applyStaffTheme\(staffThemePreference\)/);
  assert.match(source, /localStorage\.setItem\(STAFF_THEME_STORAGE_KEY, JSON\.stringify\(staffThemePreference\)\)/);
  assert.match(source, /systemColorPreference\?\.addEventListener/);
  assert.match(source, /event\.key !== STAFF_THEME_STORAGE_KEY/);
  assert.match(source, /syncOpenStaffThemeControl\(applyStaffTheme\(preference\)\)/);
});

test('account dialog exposes accessible theme choices and explains cross-workspace sync', () => {
  assert.match(source, /<legend>شخصی‌سازی ظاهر<\/legend>/);
  assert.match(source, /role="radiogroup" aria-label="انتخاب تم پنل"/);
  assert.match(source, /\['dark', 'تیره', '🌙'\]/);
  assert.match(source, /این انتخاب روی صندوق و صفحهٔ گارسون همین دستگاه ذخیره و همگام می‌شود/);
  assert.match(source, /applyStaffTheme\(input\.value, true\)/);
});

test('dark account dialog and theme choices use accessible theme tokens', () => {
  assert.match(roleCss, /html\[data-theme='dark'\] \.role-dialog__sheet\s*\{[^}]*background: var\(--rp-surface\)/s);
  assert.match(roleCss, /html\[data-theme='dark'\] \.role-danger\s*\{[^}]*background: rgba\(248, 113, 113, \.12\)/s);
  assert.match(roleCss, /html\[data-theme='dark'\] \.is-cashier-workspace \.pos-catalog\s*\{[^}]*background: var\(--rp-bg\)/s);
  assert.match(roleCss, /html\[data-theme='dark'\] \.is-cashier-workspace \.pos-check,/);
  assert.match(roleCss, /html\[data-theme='dark'\] \.is-cashier-workspace \.pos-floor__map/);
  assert.match(roleCss, /html\[data-theme='dark'\] \.is-cashier-workspace \.pos-toolbar__actions button:not\(\.pos-ghost\)/);
  assert.match(floorCss, /\.role-user-theme__option\s*\{[^}]*min-height:\s*46px/s);
  assert.match(floorCss, /\.role-user-theme__option:has\(input:checked\)/);
  assert.match(floorCss, /\.role-user-theme__option:focus-within/);
});

test('role workspace assets are cache-busted for the new theme controls', () => {
  assert.match(html, /role-panel\.css\?v=[^"\n]*cashier-dark-surfaces-v2/);
  assert.match(html, /waiter-floor-plan\.css\?v=[^"\n]*staff-theme-20260928/);
  assert.match(html, /role-panel\.js\?v=[^"\n]*staff-theme-cross-tab-v2/);
});

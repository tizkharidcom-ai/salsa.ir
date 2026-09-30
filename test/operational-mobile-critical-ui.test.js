'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const roleCss = fs.readFileSync(path.join(root, 'css', 'role-panel.css'), 'utf8');
const kdsCss = fs.readFileSync(path.join(root, 'css', 'kitchen-kds.css'), 'utf8');
const financeCss = fs.readFileSync(path.join(root, 'css', 'admin-accounting.css'), 'utf8');
const roleHtml = fs.readFileSync(path.join(root, 'role-panel.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('cashier mobile controls preserve 44px targets and keep status toasts clear of bottom navigation', () => {
  const mobileOverride = roleCss.slice(roleCss.lastIndexOf('/* Operational mobile controls stay comfortably tappable'));
  assert.match(mobileOverride, /\.role-toast\s*\{[^}]*bottom:\s*calc\(72px\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\)/s);
  assert.match(mobileOverride, /\.is-pos-station \.pos-product-card__customize\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
  assert.match(mobileOverride, /\.is-pos-station \.pos-check__tabs button\s*\{\s*min-height:\s*44px/s);
  assert.match(mobileOverride, /\.is-pos-station \.pos-send\s*\{\s*min-height:\s*44px/s);
  assert.match(roleHtml, /role-panel\.css\?v=ops-mobile-touch-floor-v17/);
});

test('KDS all-day lookup detail wraps and has a readable minimum font size', () => {
  const mobileOverride = kdsCss.slice(kdsCss.lastIndexOf('/* All-day tally is an operational lookup'));
  assert.match(mobileOverride, /\.kds-all-day-row\s*\{[^}]*min-height:\s*60px/s);
  assert.match(mobileOverride, /\.kds-all-day-row__body b small,[\s\S]*font-size:\s*12px/);
  assert.match(mobileOverride, /\.kds-all-day-row__body em\s*\{[^}]*white-space:\s*normal/);
  assert.match(roleHtml, /kitchen-kds\.css\?v=kds-all-day-readable-v6/);
});

test('mobile finance refund and operation history metadata stays readable and cache-busted', () => {
  const mobileOverride = financeCss.slice(financeCss.lastIndexOf('@media (max-width: 720px)'));
  assert.match(mobileOverride, /\.fin-operation-list small,[\s\S]*font-size:\s*\.82rem/);
  assert.match(adminHtml, /admin-accounting\.css\?v=finance-v2-tax-setup-v1-20260924/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shamsi = require('../js/shamsi-core');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('known Nowruz boundaries and Jalali round trips remain exact', () => {
  assert.equal(shamsi.formatShamsiDate('2025-03-21'), '۱۴۰۴/۰۱/۰۱');
  assert.equal(shamsi.formatShamsiDate('2026-03-21'), '۱۴۰۵/۰۱/۰۱');
  assert.equal(shamsi.formatShamsiDate('2026-08-25'), '۱۴۰۵/۰۶/۰۳');
  assert.deepEqual(shamsi.jalaliToGregorian(1405, 6, 3), { gy: 2026, gm: 8, gd: 25 });
});

test('date picker enhances dynamic date and datetime inputs while retaining ISO values', () => {
  const picker = read('js/shamsi-datepicker.js');
  assert.match(picker, /new MutationObserver/);
  assert.match(picker, /input\[type="date"\], input\[type="datetime-local"\]/);
  assert.match(picker, /dataset\.isoDateTime/);
  assert.match(picker, /function getISOValue/);
  assert.match(picker, /aria-haspopup/);
});

test('all current date consumers use the ISO bridge and all native date pages load the Jalali picker', () => {
  const adminHtml = read('admin.html');
  const reserveHtml = read('reserve.html');
  const finance = read('js/admin-accounting.js');
  const admin = read('js/admin.js');

  assert.match(adminHtml, /shamsi-datepicker\.js\?v=shamsi2-20260825/);
  assert.match(reserveHtml, /shamsi-datepicker\.js\?v=shamsi2-20260825/);
  assert.match(finance, /ShamsiDatePicker\?\.getISOValue\(fromInput\)/);
  assert.match(admin, /ShamsiDatePicker\?\.getISOValue\(document\.getElementById\(`ps_start_/);
  assert.match(reserveHtml, /ShamsiDatePicker\?\.getISOValue\(\$\('date'\)\)/);
});

test('role panel uses the exported Persian time formatter', () => {
  assert.match(read('js/role-panel.js'), /ShamsiCore\.formatShamsiTime\(date\)/);
});

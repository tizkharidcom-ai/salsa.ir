'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/persian-format.js'), 'utf8');

test('Persian amount formatter uses Persian digits and the requested grouping mark', () => {
  const context = { window: {}, Intl };
  vm.createContext(context);
  vm.runInContext(source, context);
  const formatter = context.window.WestoPersianFormat;

  assert.equal(formatter.number(1234567, { locale: 'fa-IR' }), '۱٫۲۳۴٫۵۶۷');
  assert.equal(formatter.amount(125000, { locale: 'fa-IR' }), '۱۲۵٫۰۰۰ تومان');
  assert.equal(formatter.number('۱٫۲۳۴٫۵۶۷', { locale: 'fa-IR' }), '۱٫۲۳۴٫۵۶۷');
  assert.equal(formatter.number(1234567, { locale: 'en-US' }), '1,234,567');
});

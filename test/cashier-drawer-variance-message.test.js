'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const start = source.indexOf('  function cashDrawerVarianceMessage(variance) {');
const end = source.indexOf('\n  function cashDrawerMovementFingerprint(', start);
assert.ok(start >= 0 && end > start, 'cash variance presenter exists');
const presentVariance = new Function('money', `${source.slice(start, end)}\nreturn cashDrawerVarianceMessage;`)((amount) => `${amount} تومان`);

test('cash drawer close summary distinguishes balanced count, surplus, shortage, and missing response data', () => {
  assert.match(presentVariance(0), /تطبیق دارد/);
  assert.match(presentVariance(18000), /اضافه صندوق.*۱۸?000 تومان|اضافه صندوق.*18000 تومان/u);
  assert.match(presentVariance(-25000), /کسری صندوق.*25000 تومان/);
  assert.match(presentVariance(undefined), /مغایرت دریافت نشد.*بررسی کنید/);
  assert.match(presentVariance(null), /مغایرت دریافت نشد.*بررسی کنید/);
  assert.match(presentVariance(''), /مغایرت دریافت نشد.*بررسی کنید/);
  assert.match(presentVariance(1.5), /مغایرت دریافت نشد.*بررسی کنید/);
});

test('cashier shows the variance returned by the durable closeout response', () => {
  const closeHandlerStart = source.indexOf("document.getElementById('drawer-close').addEventListener('click'");
  const closeHandlerEnd = source.indexOf('\n    });', closeHandlerStart);
  const handler = source.slice(closeHandlerStart, closeHandlerEnd);
  assert.match(handler, /closeResult = await api\('\/api\/cashier\/drawer\/close'/);
  assert.match(handler, /closeResult\?\.totals\?\.variance/);
  assert.match(handler, /cashDrawerVarianceMessage\(/);
});

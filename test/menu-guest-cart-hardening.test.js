'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const cartSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'table-cart.js'), 'utf8');

function floatingWaiterMarkupRule() {
  const escapeStart = cartSource.indexOf('  function escapeHtml(s) {');
  const escapeEnd = cartSource.indexOf('\n  let scrollLockDepth', escapeStart);
  const markupStart = cartSource.indexOf('  function floatingWaiterTableMarkup(tableNo) {');
  const markupEnd = cartSource.indexOf('\n  function initFloatingWaiterCall', markupStart);
  assert.ok(escapeStart >= 0 && escapeEnd > escapeStart, 'the shared HTML escaper remains available');
  assert.ok(markupStart >= 0 && markupEnd > markupStart, 'waiter table markup is isolated as a pure formatter');

  const isolated = { module: { exports: {} } };
  vm.runInNewContext(
    `${cartSource.slice(escapeStart, escapeEnd)}\n${cartSource.slice(markupStart, markupEnd)}\nmodule.exports = floatingWaiterTableMarkup;`,
    isolated,
    { filename: 'floating-waiter-table-markup.js' },
  );
  return isolated.module.exports;
}

test('QR table values are escaped in every floating waiter-call HTML context', () => {
  const render = floatingWaiterMarkupRule();
  const attack = '7"><img src=x onerror=alert(1)>&';
  const markup = render(attack);

  for (const value of Object.values(markup)) {
    assert.match(value, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(value, /&quot;/);
    assert.match(value, /&amp;/);
    assert.doesNotMatch(value, /<img\b/i, 'guest-controlled table text must never become an HTML element');
  }

  const start = cartSource.indexOf('  function initFloatingWaiterCall() {');
  const end = cartSource.indexOf('\n  if (document.readyState', start);
  assert.ok(start >= 0 && end > start, 'the floating waiter-call setup remains independently inspectable');
  const initializer = cartSource.slice(start, end);
  assert.match(initializer, /const tableMarkup = floatingWaiterTableMarkup\(tableNo\)/);
  assert.match(initializer, /title="\$\{tableMarkup\.title\}"/);
  assert.match(initializer, /\$\{tableMarkup\.badge\}/);
  assert.match(initializer, /\$\{tableMarkup\.heading\}/);
  assert.doesNotMatch(initializer, /\$\{tableNo\}/, 'raw QR context is not interpolated into generated HTML');
});

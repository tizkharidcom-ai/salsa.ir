'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

test('waiter status toast clears stale success text after it is hidden', () => {
  const timerBody = source.match(/toastTimer\s*=\s*setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*3200\)/);
  assert.ok(timerBody, 'toast dismissal timer should be present');
  assert.match(timerBody[1], /toast\.className\s*=\s*['"]role-toast['"]/);
  assert.match(timerBody[1], /toast\.textContent\s*=\s*['"]['"]/,
    'hidden live-region text must not remain stale in the accessibility tree');
});

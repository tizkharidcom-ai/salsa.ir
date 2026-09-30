'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('SuperAdmin team card and table use theme-aware surface, text, and border tokens', () => {
  const settings = read('prototype/js/godmode/pages/settings/settings.js');
  const start = settings.indexOf('<!-- Section 1: Team Members -->');
  const end = settings.indexOf('<!-- Section 2:', start);
  assert.ok(start >= 0 && end > start, 'team section exists');
  const team = settings.slice(start, end);

  assert.match(team, /background: var\(--muted\); color: var\(--foreground\)/);
  assert.match(team, /border-bottom: 1px solid var\(--border\)/);
  assert.match(team, /color: var\(--muted-foreground\)/);
  assert.doesNotMatch(team, /background:\s*#[\da-f]{3,8}|color:\s*#(?:666|555)|border-bottom:\s*1px solid #/i);
});

test('operations alert card uses theme-aware muted colors in dark mode', () => {
  const operations = read('prototype/js/godmode/pages/operations/operations.js');
  const start = operations.indexOf('<!-- Section: Action Inbox -->');
  const end = operations.indexOf('<!-- Section:', start + 1);
  assert.ok(start >= 0 && end > start, 'action inbox section exists');
  const inbox = operations.slice(start, end);

  assert.match(inbox, /background: var\(--muted\); color: var\(--foreground\)/);
  assert.match(inbox, /border-bottom: 1px solid var\(--border\)/);
  assert.match(inbox, /color: var\(--muted-foreground\)/);
  assert.doesNotMatch(inbox, /background:\s*#[\da-f]{3,8}|color:\s*#(?:666|555)/i);
});

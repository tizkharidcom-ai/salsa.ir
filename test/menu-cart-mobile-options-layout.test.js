'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tableCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'table.css'), 'utf8');

test('cart option summary and edit action stack on standard mobile widths', () => {
  const mobileStart = tableCss.indexOf('@media (min-width: 361px) and (max-width: 480px) {');
  const mobileEnd = tableCss.indexOf('\n}', mobileStart);

  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart,
    'the cart option row has a dedicated responsive rule from 361px through 480px');
  const mobileRule = tableCss.slice(mobileStart, mobileEnd);
  assert.match(mobileRule, /\.table-line__modifier-row\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(mobileRule, /\.table-line__edit-options\s*\{[^}]*align-self:\s*flex-start/s);
  assert.match(tableCss, /\.table-line__edit-options\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/s,
    'the edit action keeps a practical touch target after stacking');
  assert.match(tableCss, /\.table-line__modifier-row\s+\.table-line__modifiers\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    'long option summaries can wrap instead of pushing the action off-screen');
});

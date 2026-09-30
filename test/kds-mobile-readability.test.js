'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'kitchen-kds.css'), 'utf8');
const roleHtml = fs.readFileSync(path.join(__dirname, '..', 'role-panel.html'), 'utf8');
const handheldStart = css.lastIndexOf('@media (max-width: 700px)');
const narrowStart = css.lastIndexOf('@media (max-width: 380px)');
const inventoryStart = css.indexOf('/* Inventory is a document-like workflow', handheldStart);
assert.ok(handheldStart >= 0 && narrowStart > handheldStart && inventoryStart > narrowStart);
const handheld = css.slice(handheldStart, narrowStart);
const narrow = css.slice(narrowStart, inventoryStart);

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('handheld KDS uses a single readable queue column with large item and action targets', () => {
  assert.match(handheld, /\.is-kitchen-workspace \.role-app\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*min-width:\s*0/s);
  assert.match(handheld, /\.is-kitchen-workspace \.role-nav,[\s\S]*?\.is-kitchen-workspace \.role-main\s*\{[^}]*min-width:\s*0/s);
  assert.match(handheld, /\.kds-ticket-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*overflow-y:\s*auto/s);
  assert.match(handheld, /\.kds-item\s*\{[^}]*min-height:\s*48px/s);
  assert.match(handheld, /\.kds-item__body b\s*\{[^}]*font-size:\s*15px/s);
  assert.match(handheld, /\.kds-item__body small\s*\{[^}]*font-size:\s*12px/s);
  const heldLineRule = [...css.matchAll(/\.kds-item\.is-held\s*\{([^}]*)\}/g)].at(-1);
  const heldNoteLabelRule = [...css.matchAll(/\.kds-note\.is-held-course b\s*\{([^}]*)\}/g)].at(-1);
  assert.match(heldLineRule?.[1] || '', /min-height:\s*48px/,
    'later shared rules must not shrink held-course rows below the handheld target');
  assert.ok(css.lastIndexOf('.kds-item.is-held {') > handheldStart,
    'the held-course row target is reapplied after the general overrides');
  assert.match(heldNoteLabelRule?.[1] || '', /font-size:\s*12px/,
    'the final held-course label rule stays readable on mobile');
  assert.ok(css.lastIndexOf('.kds-note.is-held-course b {') > handheldStart,
    'the held-course label override wins after the shared 9px rule');
  assert.match(handheld, /\.kds-note,\s*\.kds-note\.is-held-course\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*1\.5/s);
  assert.match(handheld, /\.kds-note b,\s*\.kds-note\.is-held-course b\s*\{[^}]*font-size:\s*12px/s);
  assert.match(handheld, /\.kds-ticket__footer\s*\{[^}]*min-height:\s*48px/s);
  assert.match(handheld, /\.kds-ticket__footer > button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(handheld, /\.kds-command__actions label,\s*\.kds-command__actions > button\s*\{[^}]*height:\s*44px;\s*min-height:\s*44px/s,
    'mobile search and command actions retain the minimum touch target');
  assert.match(css, /\.kds-all-day__head,\.kds-all-day button\s*\{[^}]*min-height:\s*48px/s,
    'all-day drill-in controls remain touch-sized outside the ticket footer');
  assert.match(css, /body\.is-kitchen-workspace :is\(button,a,input,select\):focus-visible\s*\{[^}]*outline:\s*3px solid #f1b638/s);
  assert.match(css, /body\.is-kitchen-workspace button:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  assert.match(handheld, /\.is-kitchen-workspace \.role-nav button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(handheld, /\.is-kitchen-workspace \.role-icon-button,[\s\S]*?\.is-kitchen-workspace \.role-user\s*\{[^}]*width:\s*44px;\s*flex:\s*0 0 44px/s);
  assert.match(handheld, /\.kds-undo button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(handheld, /\.kds-all-day-drawer__head > button\s*\{[^}]*width:\s*44px;\s*height:\s*44px/s);
});

test('large-text mode keeps handheld item details and kitchen notes at the readable mobile minimum', () => {
  const largeTextSelector = '.kds-shell.is-text-large .kds-item__body small';
  const largeNoteSelector = '.kds-shell.is-text-large .kds-note';
  const heldNoteLabelSelector = '.kds-shell.is-text-large .kds-note.is-held-course b';
  const largeTextMobileRule = handheld.match(/\.kds-shell\.is-text-large \.kds-item__body small,\s*\.kds-shell\.is-text-large \.kds-note,\s*\.kds-shell\.is-text-large \.kds-note b,\s*\.kds-shell\.is-text-large \.kds-note\.is-held-course b\s*\{([^}]*)\}/);
  assert.ok(largeTextMobileRule, 'the override is inside the handheld media block');
  assert.match(largeTextMobileRule[1], /font-size:\s*12px/);

  const baseLargeTextRule = css.match(/\.kds-shell\.is-text-large \.kds-item__body small,\s*\.kds-shell\.is-text-large \.kds-note\s*\{([^}]*)\}/);
  assert.ok(baseLargeTextRule, 'desktop large-text rule remains present');
  assert.match(baseLargeTextRule[1], /font-size:\s*8px/);
  for (const selector of [largeTextSelector, largeNoteSelector]) {
    assert.ok(css.lastIndexOf(selector) > css.indexOf(selector), `${selector} mobile override wins the equal-specificity desktop rule`);
  }

  const classCount = (selector) => (selector.match(/\.[\w-]+/g) || []).length;
  const laterHeldNoteLabelRule = [...css.matchAll(/\.kds-note\.is-held-course b\s*\{([^}]*)\}/g)].at(-1);
  assert.ok(laterHeldNoteLabelRule, 'the later held-course label rule remains covered');
  assert.match(laterHeldNoteLabelRule[1], /font-size:\s*12px/);
  assert.ok(css.lastIndexOf(heldNoteLabelSelector) < css.lastIndexOf('.kds-note.is-held-course b'));
  assert.ok(
    classCount(heldNoteLabelSelector) > classCount('.kds-note.is-held-course b'),
    'large-text mobile selector outranks the later held-course label rule by specificity',
  );
});

test('mobile KDS queue filters, pagination and cancellation jump remain touch-sized and reachable', () => {
  assert.match(handheld, /\.kds-fulfillment button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(handheld, /\.kds-pager button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
  assert.match(handheld, /\.kds-cancelled-jump\s*\{[^}]*min-height:\s*44px/s);
  assert.match(handheld, /\.kds-cancelled-ticket\s*\{[^}]*font-size:\s*12px/s);
  assert.match(handheld, /\.kds-cancelled-ticket header\s*\{[^}]*flex-wrap:\s*wrap[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(narrow, /\.kds-subbar\s*\{[^}]*grid-template-rows:\s*44px 44px/s);
  assert.match(narrow, /\.kds-subbar__end\s*\{[^}]*grid-row:\s*2/s);
});

test('rail preference cannot override the vertical handheld ticket queue', () => {
  const desktopRailRule = css.match(/\.kds-shell\.is-rail \.kds-ticket-grid\s*\{([^}]*)\}/);
  assert.ok(desktopRailRule, 'desktop rail layout remains available');
  assert.match(desktopRailRule[1], /grid-auto-flow:\s*column/);

  const mobileRailRule = handheld.match(/\.kds-ticket-grid,\s*\.kds-shell\.is-rail \.kds-ticket-grid\s*\{([^}]*)\}/);
  assert.ok(mobileRailRule, 'mobile cascade must explicitly override the more-specific rail selector');
  assert.match(mobileRailRule[1], /grid-auto-flow:\s*row/);
  assert.match(mobileRailRule[1], /grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
});

test('KDS handheld layout uses a fresh stylesheet URL so installed devices do not reuse the clipped grid', () => {
  assert.match(roleHtml, /css\/kitchen-kds\.css\?v=kds-all-day-readable-v6/);
});

test('KDS dark canvas, ticket palette, and cancellation lane retain readable text contrast', () => {
  const variableColor = (name) => {
    const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(match, `expected ${name} to define a color`);
    return match[1];
  };
  const foreground = '#081012';
  const ticketAccents = [
    variableColor('--kds-cyan'),
    variableColor('--kds-yellow'),
    variableColor('--kds-red'),
    variableColor('--kds-purple'),
    variableColor('--kds-orange'),
    '#55bed9',
    '#10b981',
  ];

  assert.match(css, /body\.is-kitchen-workspace\s*\{[^}]*--kds-bg:\s*#070b0c/s);
  assert.match(css, /\.kds-ticket\s*\{[^}]*background:\s*var\(--kds-paper\);[^}]*color:\s*var\(--kds-ink\)/s);
  assert.match(css, /\.kds-ticket__head\s*\{[^}]*color:\s*#081012/s);
  assert.match(css, /\.kds-cancelled-lane\s*\{[^}]*background:\s*#1b1517;[^}]*color:\s*#f3eeee/s);
  for (const accent of ticketAccents) assert.ok(contrastRatio(foreground, accent) >= 4.5, `${accent} needs readable ticket-header text`);
  assert.ok(contrastRatio('#f3eeee', '#1b1517') >= 7, 'cancellation lane text stays high contrast');
  assert.ok(contrastRatio(variableColor('--kds-ink'), variableColor('--kds-paper')) >= 12, 'ticket content stays readable against its paper surface');
});

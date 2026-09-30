'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const roleSource = fs.readFileSync(path.join(root, 'js', 'role-panel.js'), 'utf8');
const floorCss = fs.readFileSync(path.join(root, 'css', 'waiter-floor-plan.css'), 'utf8');

function extractFunction(name, nextName) {
  const start = roleSource.indexOf(`  function ${name}(`);
  const end = roleSource.indexOf(`\n  function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} helper exists`);
  return new Function(`${roleSource.slice(start, end)}\nreturn ${name};`)();
}

test('waiter zone names use the same canonical labels as the floor studio', () => {
  const normalize = extractFunction('normalizeRoleFloorZoneName', 'roleFloorFixtureInsideZone');

  assert.equal(normalize(' سالن اصلی '), 'سالن');
  assert.equal(normalize('main hall'), 'سالن');
  assert.equal(normalize('تراس و فضای باز'), 'تراس');
  assert.equal(normalize('VIP'), 'ویژه');
  assert.equal(normalize('سالن اختصاصی ویژه'), 'ویژه');
  assert.equal(normalize('کافه بار'), 'کافه بار');
  assert.equal(normalize(''), 'بدون بخش');
});

test('zone-scoped fixture visibility is based on the configured zone bounds', () => {
  const containsFixture = extractFunction('roleFloorFixtureInsideZone', 'statusLabel');
  const zone = { x: 10, y: 20, w: 30, h: 40 };

  assert.equal(containsFixture({ x: 15, y: 25, w: 10, h: 10 }, zone), true);
  assert.equal(containsFixture({ x: 35, y: 25, w: 10, h: 10 }, zone), true, 'center on zone edge remains visible');
  assert.equal(containsFixture({ x: 60, y: 25, w: 10, h: 10 }, zone), false);
  assert.equal(containsFixture({ x: 'invalid', y: 25, w: 10, h: 10 }, zone), false);
});

test('the shared floor renderer filters zone outlines and fixtures without stretching stored geometry', () => {
  const start = roleSource.indexOf('  function buildPlanCanvasHtml(');
  const end = roleSource.indexOf('\n  function setupFloorCanvasPanZoom(', start);
  assert.ok(start >= 0 && end > start, 'shared floor renderer exists');
  const renderer = roleSource.slice(start, end);

  assert.match(renderer, /const focusedDynamicZones = dynamicZones\.filter\(/);
  assert.match(renderer, /zonesMarkup = focusedDynamicZones\.map\(/);
  assert.match(renderer, /dynamicFixtures\.filter\(\(fixture\) => focusedDynamicZones\.some\(\(zone\) => roleFloorFixtureInsideZone\(fixture, zone\)\)\)/);
  assert.match(renderer, /style="left:\$\{z\.x\}%; top:\$\{z\.y\}%; width:\$\{z\.w\}%; height:\$\{z\.h\}%;"/);
  assert.doesNotMatch(renderer, /plan-zone--dynamic[^\n]*is-full-view/);
});

test('the mobile waiter header removes the heavy shadow and restores the dark logo contrast', () => {
  assert.match(floorCss, /@media \(max-width: 768px\)[\s\S]*?body\.is-waiter-floor-app \.role-header\s*\{[^}]*box-shadow:\s*none\s*!important/);
  assert.match(floorCss, /html\[data-theme='dark'\] body\.is-waiter-floor-app \.role-brand img\s*\{\s*filter:\s*brightness\(0\) invert\(1\)/);
});

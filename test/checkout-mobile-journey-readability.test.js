'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('css/checkout.css', 'utf8');
const html = fs.readFileSync('order.html', 'utf8');
const stepperRule = css.lastIndexOf('.checkout-stepper { overflow: visible; }');
const mobileStart = css.lastIndexOf('@media (max-width: 560px)', stepperRule);
const mobileEnd = css.indexOf('\n}', stepperRule);
const mobile = stepperRule >= 0 && mobileStart >= 0 && mobileEnd > stepperRule
  ? css.slice(mobileStart, mobileEnd)
  : '';
const tabletStart = css.lastIndexOf('@media (min-width: 561px) and (max-width: 760px) {');
const tabletEnd = css.indexOf('\n}', tabletStart);
const tablet = tabletStart >= 0 && tabletEnd > tabletStart ? css.slice(tabletStart, tabletEnd) : '';

test('narrow checkout shows all four journey steps without a horizontal stepper scroll', () => {
  assert.match(mobile, /\.checkout-stepper\s*\{\s*overflow:\s*visible\s*;/);
  assert.match(mobile, /\.checkout-stepper__list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobile, /\.checkout-stepper__list\s*\{[^}]*min-width:\s*0/);
  for (const stage of ['basket', 'fulfillment', 'customer', 'review']) {
    assert.match(html, new RegExp(`id="checkout-step-${stage}"`), `${stage} stage is available in the checkout stepper`);
  }
});

test('mobile checkout steps keep readable labels and touch-friendly height', () => {
  assert.match(mobile, /\.checkout-stepper__list span\s*\{[^}]*min-height:\s*48px/);
  assert.match(mobile, /\.checkout-stepper__list span\s*\{[^}]*font-size:\s*\.82rem/);
  assert.match(mobile, /\.checkout-stepper__list span\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('compact tablet widths show every checkout stage without a clipped horizontal stepper', () => {
  const baseStepper = css.indexOf('.checkout-stepper { overflow-x: auto;');
  const baseList = css.indexOf('.checkout-stepper__list { display: grid;');
  assert.ok(tabletStart > baseStepper && tabletStart > baseList,
    'tablet overrides must follow the desktop min-width and overflow rules in the cascade');
  assert.match(tablet, /\.checkout-stepper\s*\{\s*overflow:\s*visible\s*;/);
  assert.match(tablet, /\.checkout-stepper__list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*min-width:\s*0/s);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const {
  validateOrderLineInput,
  validateWaiterCourseFire,
} = require('../server/waiter-order-invariants');

const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const handlerStart = source.indexOf('const handleEditOrder = async');
const handlerEnd = source.indexOf("app.patch('/api/cashier/orders/:id'", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'shared cashier/waiter edit handler exists');
const handler = source.slice(handlerStart, handlerEnd);
const creatorStart = source.indexOf('async function createCheckoutOrder(');
const creatorEnd = source.indexOf('async function createAndPersistCheckoutOrder(', creatorStart);
assert.ok(creatorStart >= 0 && creatorEnd > creatorStart, 'canonical checkout/staff order creator exists');
const creator = source.slice(creatorStart, creatorEnd);
const pricingStart = source.indexOf('function calculateCheckoutPricing(');
const pricingEnd = source.indexOf('\nasync function createCheckoutOrder(', pricingStart);
assert.ok(pricingStart >= 0 && pricingEnd > pricingStart, 'canonical checkout pricing validator exists');
const pricing = source.slice(pricingStart, pricingEnd);
const staffCreateStart = source.indexOf("app.post('/api/staff/orders'");
const staffCreateEnd = source.indexOf('const handleEditOrder', staffCreateStart);
assert.ok(staffCreateStart >= 0 && staffCreateEnd > staffCreateStart, 'staff order creation route exists');
const staffCreateRoute = source.slice(staffCreateStart, staffCreateEnd);
const orderLinesStart = source.indexOf('function orderLinesFromRequest(');
const orderLinesEnd = source.indexOf('\nfunction orderInventorySnapshot(', orderLinesStart);
assert.ok(orderLinesStart >= 0 && orderLinesEnd > orderLinesStart, 'canonical order-line normalizer exists');
const orderLines = source.slice(orderLinesStart, orderLinesEnd);

test('waiter/cashier edits validate submitted lines against server-canonical prices before committing inventory', () => {
  const normalization = handler.indexOf('const normalized = orderLinesFromRequest');
  const validation = handler.indexOf('const waiterValidation =');
  const inventoryCommit = handler.indexOf('adjustOrderInventory(normalized.lines, -1');
  assert.ok(normalization >= 0 && validation > normalization && inventoryCommit > validation);
  assert.match(handler, /validateWaiterOrderEdit\(order, req\.body\?\.items, \{ canonicalLines: normalized\.lines \}\)/);
  assert.match(handler, /validateWaiterKitchenSend\(order, req\.body\?\.items, \{ canonicalLines: normalized\.lines \}\)/);
});

test('rejected order edits restore the temporary inventory snapshot and return a safe validation error', () => {
  const validation = handler.indexOf('if (!waiterValidation.ok)');
  const restore = handler.indexOf('restoreOrderInventorySnapshot(snapshot)', validation);
  const response = handler.indexOf('return res.status(conflictErrors.has(waiterValidation.error) ? 409 : 400)', validation);
  const inventoryCommit = handler.indexOf('adjustOrderInventory(normalized.lines, -1');
  assert.ok(validation >= 0 && restore > validation && response > restore && inventoryCommit > response);
});

test('staff order creation validates submitted lines against canonical server lines before reserving stock', () => {
  const canonicalLines = creator.indexOf('const lineResult = orderLinesFromRequest(input.items');
  const validation = creator.indexOf('const addValidation = validateWaiterOrderAdd(input.items');
  const stockMutation = creator.indexOf('// Deduct stock only after validating the current server-side quote.');
  assert.ok(canonicalLines >= 0 && validation > canonicalLines && stockMutation > validation);
  assert.match(creator, /canonicalLines:\s*lineResult\.lines/);
  assert.match(creator, /sendToKitchen:\s*input\.sendToKitchen === true/);
  assert.match(creator, /course_already_served/);
});

test('untrusted checkout lines are shape-validated before quantity normalization, pricing, or stock checks', () => {
  const shapeValidation = orderLines.indexOf('const lineShape = validateOrderLineInput(line, lineIndex)');
  const quantityNormalization = orderLines.indexOf('const qty = Math.min(99, Math.max(1, Math.round(Number(line.qty || line.count) || 1)))');
  const canonicalPricing = orderLines.indexOf('calculateModifierLinePrice(');
  assert.ok(shapeValidation >= 0 && shapeValidation < quantityNormalization && shapeValidation < canonicalPricing,
    'malformed quantities and option structures must be rejected before being rounded or priced');
  assert.match(orderLines, /complement_selection_invalid/);
  assert.match(orderLines, /complement_unavailable/);
  assert.match(orderLines, /entry\.stock == null \|\| Number\(entry\.stock\) > 0/,
    'a complement with zero stock cannot be reserved merely because its availability flag is stale');
  assert.doesNotMatch(orderLines, /line\.complements\)\s*\?\s*line\.complements\s*:\s*\[\]\)\.slice\(0,\s*8\)/,
    'invalid or excess add-ons must not be silently truncated');
});

test('malformed order quantities and complement collections fail closed at the line boundary', () => {
  assert.equal(validateOrderLineInput({ menuItemId: 7, qty: 2 }).ok, true);
  assert.equal(validateOrderLineInput({ menuItemId: 7 }).error, 'quantity_required');
  for (const qty of [0, -1, 1.5, 100, 'not-a-number', true]) {
    assert.equal(validateOrderLineInput({ menuItemId: 7, qty }).error, 'quantity_invalid', String(qty));
  }
  const tooManyComplements = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, qty: 1 }));
  assert.equal(validateOrderLineInput({ menuItemId: 7, qty: 1, complements: tooManyComplements }).error, 'too_many_complements');
  assert.equal(validateOrderLineInput({ menuItemId: 7, qty: 1, complements: 'invalid' }).error, 'options_invalid');
});

test('staff order route preserves validation status and reports idempotent replay as HTTP 200', () => {
  assert.match(staffCreateRoute, /if \(result\.error\) return res\.status\(result\.status \|\| 400\)\.json\(result\)/);
  assert.match(staffCreateRoute, /res\.status\(result\.idempotent \? 200 : 201\)/);
  assert.match(staffCreateRoute, /req\.get\('Idempotency-Key'\) \|\| req\.body\?\.idempotencyKey/);
  assert.match(staffCreateRoute, /NODE_ENV === 'production' && !idempotencyKey/);
  assert.match(staffCreateRoute, /req\.body\?\.sendToKitchen === true/);
  assert.doesNotMatch(creator, /sendToKitchen:\s*Boolean\(input\.sendToKitchen\)/);
  assert.match(creator, /input\.sendToKitchen === true/);
  assert.match(pricing, /parseOrderTomanAmount\(input\.discount\)/);
  assert.match(pricing, /requestedManualDiscount > subtotal/);
  assert.match(pricing, /discount_exceeds_subtotal/);
  const pricingValidation = creator.indexOf('const pricing = calculateCheckoutPricing(');
  const inventoryMutation = creator.indexOf('buildOrderInventoryReservationSnapshot(');
  assert.ok(pricingValidation >= 0 && inventoryMutation > pricingValidation,
    'discount validation completes before inventory reservation or order persistence');
});

test('waiter edits reject fractional or over-subtotal discounts before persisting a non-integer total', () => {
  assert.match(handler, /parseOrderTomanAmount\(req\.body\.discount\)/);
  assert.match(handler, /discount > normalized\.subtotal/);
  assert.match(handler, /Number\.isSafeInteger\(nextTotal\)/);
});

test('course release fails closed for unpaid gateway attempts and accepts only kitchen-eligible states', () => {
  const heldOrder = {
    id: 51,
    status: 'pay_at_cashier',
    fulfillment: 'dine_in',
    paymentMethod: 'cashier',
    paymentStatus: 'unpaid',
    items: [{ course: 'entrees', courseStatus: 'hold' }],
  };
  assert.deepEqual(validateWaiterCourseFire(heldOrder, 'entrees'), {
    ok: true, course: 'entrees', firedCount: 1, idempotent: false,
  });
  assert.equal(validateWaiterCourseFire({
    ...heldOrder, status: 'pending_online', paymentMethod: 'online', paymentStatus: 'pending',
  }, 'entrees').error, 'course_fire_locked');
  assert.equal(validateWaiterCourseFire({
    ...heldOrder, paymentMethod: 'online', paymentStatus: 'pending',
  }, 'entrees').error, 'payment_not_confirmed');
  assert.equal(validateWaiterCourseFire({
    ...heldOrder, status: 'awaiting_confirmation',
  }, 'entrees').error, 'course_fire_locked');
  assert.equal(validateWaiterCourseFire(heldOrder, 'not-a-course').error, 'course_invalid');
  assert.equal(validateWaiterCourseFire(heldOrder, 'dessert').error, 'course_not_found');
});

test('course release replay is idempotent and its route validates before any mutation', () => {
  const routeStart = source.indexOf("app.patch('/api/waiter/orders/:id/fire-course'");
  const routeEnd = source.indexOf("app.post('/api/waiter/orders/:id/split'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'course release route exists');
  const route = source.slice(routeStart, routeEnd);
  const validationAt = route.indexOf('validateWaiterCourseFire(order, course)');
  const snapshotAt = route.indexOf('snapshotFinanceMutationState()');
  const writeAt = route.indexOf("item.courseStatus = 'fired'");
  assert.ok(validationAt >= 0 && snapshotAt > validationAt && writeAt > snapshotAt,
    'payment/lifecycle validation runs before snapshot and course mutation');
  const replayAt = route.indexOf('if (courseValidation.idempotent)');
  assert.ok(replayAt > validationAt && replayAt < snapshotAt);
  assert.match(route.slice(replayAt, snapshotAt), /idempotent: true/);
  assert.match(route, /res\.json\(\{ ok: true, order: operationalOrderResponse\(order, req\.user\), firedCount, course \}\)/);

  const alreadyFired = validateWaiterCourseFire({
    status: 'sent_to_kitchen', paymentStatus: 'unpaid',
    items: [{ course: 'entrees', courseStatus: 'fired' }],
  }, 'entrees');
  assert.equal(alreadyFired.ok, true);
  assert.equal(alreadyFired.idempotent, true);
  assert.equal(alreadyFired.firedCount, 0);
});

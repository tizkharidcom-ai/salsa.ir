'use strict';

const { hasAcceptedDelivery, normalizeFulfillment } = require('./command-center');

const MAX_COVERS = 99;
const MAX_LINE_QUANTITY = 99;
const MAX_SEAT = 99;
const MAX_COMPLEMENT_QUANTITY = 20;
const MAX_COMPLEMENTS_PER_LINE = 8;

const EDITABLE_ORDER_STATUSES = new Set([
  'pay_at_cashier',
  'awaiting_confirmation',
  'sent_to_kitchen',
]);
const TERMINAL_ORDER_STATUSES = new Set([
  'cancelled',
  'done',
  'delivered',
  'picked_up',
]);
const LOCKED_PAYMENT_STATUSES = new Set([
  'partial',
  'pending',
  'paid',
  'cancelled',
  'refunded',
  'unknown',
]);
const VALID_PAYMENT_STATUSES = new Set([
  'unpaid',
  'partial',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'unknown',
]);
const VALID_COURSES = new Set(['straight_fire', 'starters', 'entrees', 'dessert']);
const VALID_COURSE_STATUSES = new Set(['hold', 'fired', 'served']);

function parseInteger(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value === 'string') {
    if (!/^\d+$/u.test(value.trim())) return null;
  } else if (typeof value !== 'number') {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseId(value) {
  return parseInteger(value, { min: 1 });
}

function parseMoney(value) {
  return parseInteger(value, { min: 0 });
}

function highestAssignedSeat(items) {
  return (Array.isArray(items) ? items : []).reduce((max, line) => {
    const seat = parseInteger(line?.seat, { min: 0, max: MAX_SEAT });
    return seat === null ? max : Math.max(max, seat);
  }, 0);
}

function validateCoversForItems(coversValue, items) {
  const covers = parseInteger(coversValue, { min: 1, max: MAX_COVERS });
  if (covers === null) return { ok: false, error: 'covers_invalid' };
  if (!Array.isArray(items)) return { ok: false, error: 'items_invalid' };
  for (let index = 0; index < items.length; index += 1) {
    const line = items[index];
    if (!line || typeof line !== 'object' || Array.isArray(line)) return fail('items_invalid', index);
    if (line.seat !== undefined && parseInteger(line.seat, { min: 0, max: MAX_SEAT }) === null) {
      return { ok: false, error: 'seat_invalid' };
    }
  }
  if (highestAssignedSeat(items) > covers) {
    return { ok: false, error: 'seat_exceeds_covers' };
  }
  return { ok: true, covers };
}

function fail(error, index) {
  return index === undefined ? { ok: false, error } : { ok: false, error, index };
}

function readLineQuantity(line, index) {
  const hasQty = line.qty !== undefined;
  const hasCount = line.count !== undefined;
  if (!hasQty && !hasCount) return fail('quantity_required', index);
  const qty = parseInteger(hasQty ? line.qty : line.count, { min: 1, max: MAX_LINE_QUANTITY });
  if (qty === null) return fail('quantity_invalid', index);
  if (hasQty && hasCount) {
    const count = parseInteger(line.count, { min: 1, max: MAX_LINE_QUANTITY });
    if (count === null) return fail('quantity_invalid', index);
    if (count !== qty) return fail('quantity_conflict', index);
  }
  return { ok: true, qty };
}

function readModifierSelections(value, index) {
  if (value === undefined) return { ok: true, selections: [] };
  if (!Array.isArray(value)) return fail('options_invalid', index);
  const seen = new Set();
  const selections = [];
  for (const modifier of value) {
    if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) return fail('option_invalid', index);
    const groupId = String(modifier.groupId ?? '').trim();
    const optionId = String(modifier.id ?? modifier.optionId ?? '').trim();
    if (!groupId || !optionId) return fail('option_identity_invalid', index);
    const identity = `${groupId}\u0000${optionId}`;
    if (seen.has(identity)) return fail('duplicate_option', index);
    seen.add(identity);
    if (modifier.price !== undefined && parseMoney(modifier.price) === null) return fail('option_price_invalid', index);
    selections.push({ identity, price: modifier.price === undefined ? null : parseMoney(modifier.price) });
  }
  selections.sort((a, b) => a.identity.localeCompare(b.identity));
  return { ok: true, selections };
}

function readComplements(value, index) {
  if (value === undefined) return { ok: true, complements: [] };
  if (!Array.isArray(value)) return fail('options_invalid', index);
  if (value.length > MAX_COMPLEMENTS_PER_LINE) return fail('too_many_complements', index);
  const quantities = new Map();
  const prices = new Map();
  for (const complement of value) {
    if (!complement || typeof complement !== 'object' || Array.isArray(complement)) return fail('option_invalid', index);
    const id = parseId(complement.complementId ?? complement.id);
    const qty = parseInteger(complement.qty, { min: 1, max: MAX_COMPLEMENT_QUANTITY });
    if (id === null || qty === null) return fail('complement_invalid', index);
    if (complement.price !== undefined && parseMoney(complement.price) === null) return fail('complement_price_invalid', index);
    const totalQty = (quantities.get(id) || 0) + qty;
    if (totalQty > MAX_COMPLEMENT_QUANTITY) return fail('complement_quantity_invalid', index);
    quantities.set(id, totalQty);
    if (complement.price !== undefined) {
      const price = parseMoney(complement.price);
      if (prices.has(id) && prices.get(id) !== price) return fail('complement_price_conflict', index);
      prices.set(id, price);
      if (complement.lineTotal !== undefined) {
        const lineTotal = parseMoney(complement.lineTotal);
        if (lineTotal === null || lineTotal !== price * qty || !Number.isSafeInteger(price * qty)) {
          return fail('complement_total_mismatch', index);
        }
      }
    }
  }
  const complements = [...quantities.entries()]
    .map(([id, qty]) => ({ id, qty, price: prices.has(id) ? prices.get(id) : null }))
    .sort((a, b) => a.id - b.id);
  return { ok: true, complements };
}

function readLine(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return fail('line_invalid', index);
  const menuItemId = parseId(line.menuItemId ?? line.id);
  if (menuItemId === null) return fail('menu_item_invalid', index);
  const quantity = readLineQuantity(line, index);
  if (!quantity.ok) return quantity;
  const seat = line.seat === undefined ? 0 : parseInteger(line.seat, { min: 0, max: MAX_SEAT });
  if (seat === null) return fail('seat_invalid', index);
  const modifiers = readModifierSelections(line.modifiers, index);
  if (!modifiers.ok) return modifiers;
  const complements = readComplements(line.complements, index);
  if (!complements.ok) return complements;

  const amounts = {};
  for (const field of ['price', 'unitTotal', 'lineTotal']) {
    if (line[field] === undefined) continue;
    amounts[field] = parseMoney(line[field]);
    if (amounts[field] === null) return fail('price_invalid', index);
  }
  for (const field of ['course', 'courseStatus']) {
    if (line[field] === undefined) continue;
    const allowed = field === 'course' ? VALID_COURSES : VALID_COURSE_STATUSES;
    if (!allowed.has(String(line[field]).trim().toLowerCase())) return fail(`${field}_invalid`, index);
  }

  if (amounts.price !== undefined && amounts.unitTotal !== undefined
      && modifiers.selections.every((selection) => selection.price !== null)) {
    const expectedUnitTotal = amounts.price + modifiers.selections.reduce((sum, selection) => sum + selection.price, 0);
    if (!Number.isSafeInteger(expectedUnitTotal) || amounts.unitTotal !== expectedUnitTotal) {
      return fail('unit_price_mismatch', index);
    }
  }
  if (amounts.unitTotal !== undefined && amounts.lineTotal !== undefined
      && complements.complements.every((entry) => entry.price !== null)) {
    const complementTotal = complements.complements.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
    const expectedLineTotal = amounts.unitTotal * quantity.qty + complementTotal;
    if (!Number.isSafeInteger(complementTotal) || !Number.isSafeInteger(expectedLineTotal)
        || amounts.lineTotal !== expectedLineTotal) {
      return fail('line_total_mismatch', index);
    }
  }

  return {
    ok: true,
    value: {
      menuItemId,
      qty: quantity.qty,
      seat,
      modifiers: modifiers.selections,
      complements: complements.complements,
      amounts,
      course: String(line.course || 'starters').trim().toLowerCase(),
      courseStatus: String(line.courseStatus || 'fired').trim().toLowerCase(),
      note: String(line.note || '').trim(),
    },
  };
}

// Validate untrusted order-line shape before any route canonicalizes values.
// This is intentionally line-local: public carts may contain repeated lines,
// while staff edit rules apply their own duplicate-line invariant later.
function validateOrderLineInput(line, index = 0) {
  return readLine(line, index);
}

function lineFingerprint(line) {
  return JSON.stringify({
    menuItemId: line.menuItemId,
    seat: line.seat,
    modifiers: line.modifiers.map((selection) => selection.identity),
    complements: line.complements.map(({ id, qty }) => [id, qty]),
    course: line.course,
    courseStatus: line.courseStatus,
    note: line.note,
  });
}

function compareWithCanonical(input, canonical, index) {
  const expected = readLine(canonical, index);
  if (!expected.ok) return fail('canonical_line_invalid', index);
  const left = input.value;
  const right = expected.value;
  if (left.menuItemId !== right.menuItemId) return fail('menu_item_mismatch', index);
  if (left.qty !== right.qty) return fail('quantity_mismatch', index);
  if (left.seat !== right.seat) return fail('seat_mismatch', index);
  if (left.course !== right.course) return fail('course_mismatch', index);
  if (left.courseStatus !== right.courseStatus) return fail('course_status_mismatch', index);
  if (JSON.stringify(left.modifiers.map((entry) => entry.identity))
      !== JSON.stringify(right.modifiers.map((entry) => entry.identity))) return fail('options_mismatch', index);
  if (JSON.stringify(left.complements.map(({ id, qty }) => [id, qty]))
      !== JSON.stringify(right.complements.map(({ id, qty }) => [id, qty]))) return fail('options_mismatch', index);
  for (const [inputField, canonicalField] of [
    ['price', 'price'],
    ['unitTotal', 'unitTotal'],
    ['lineTotal', 'lineTotal'],
  ]) {
    if (left.amounts[inputField] === undefined) continue;
    const canonicalAmount = parseMoney(canonical?.[canonicalField]);
    if (canonicalAmount === null || left.amounts[inputField] !== canonicalAmount) return fail('price_mismatch', index);
  }
  for (const selected of left.modifiers) {
    if (selected.price === null) continue;
    const expectedOption = right.modifiers.find((option) => option.identity === selected.identity);
    if (!expectedOption || selected.price !== expectedOption.price) return fail('price_mismatch', index);
  }
  for (const selected of left.complements) {
    if (selected.price === null) continue;
    const expectedComplement = right.complements.find((entry) => entry.id === selected.id);
    if (!expectedComplement || selected.price !== expectedComplement.price) return fail('price_mismatch', index);
  }
  return { ok: true };
}

/**
 * Validate waiter line input before mutating an order. When canonicalLines are
 * supplied, price and option identities are checked against server-priced lines;
 * submitted prices are never treated as authoritative by this module.
 */
function validateWaiterOrderLines(lines, { canonicalLines, requireCanonical = false } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return fail('order_items_required');
  if (requireCanonical && canonicalLines === undefined) return fail('canonical_lines_required');
  if (canonicalLines !== undefined
      && (!Array.isArray(canonicalLines) || canonicalLines.length !== lines.length)) {
    return fail('canonical_lines_mismatch');
  }
  const seen = new Set();
  let quantity = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = readLine(lines[index], index);
    if (!parsed.ok) return parsed;
    if (canonicalLines === undefined) {
      const line = lines[index];
      const hasUnverifiedPrice = ['price', 'unitTotal', 'lineTotal'].some((field) => line[field] !== undefined)
        || (line.modifiers || []).some((entry) => entry?.price !== undefined)
        || (line.complements || []).some((entry) => entry?.price !== undefined);
      const hasUnverifiedOptions = (line.modifiers || []).length > 0 || (line.complements || []).length > 0;
      if (hasUnverifiedPrice || hasUnverifiedOptions) return fail('canonical_lines_required', index);
    }
    const fingerprint = lineFingerprint(parsed.value);
    if (seen.has(fingerprint)) return fail('duplicate_line', index);
    seen.add(fingerprint);
    quantity += parsed.value.qty;
    if (!Number.isSafeInteger(quantity)) return fail('quantity_total_unsafe', index);
    if (canonicalLines !== undefined) {
      const comparison = compareWithCanonical(parsed, canonicalLines[index], index);
      if (!comparison.ok) return comparison;
    }
  }
  return { ok: true, lineCount: lines.length, quantity };
}

function receivedAmount(order) {
  const amountPaid = Number(order?.amountPaid);
  const partialTotal = (Array.isArray(order?.partialPayments) ? order.partialPayments : [])
    .reduce((sum, payment) => {
      const amount = Number(payment?.amount);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);
  return Math.max(Number.isFinite(amountPaid) && amountPaid > 0 ? amountPaid : 0, partialTotal);
}

function paymentDataIsValid(order) {
  if (order?.amountPaid !== undefined && order.amountPaid !== null && parseMoney(order.amountPaid) === null) return false;
  if (order?.partialPayments !== undefined && order.partialPayments !== null && !Array.isArray(order.partialPayments)) return false;
  let partialTotal = 0;
  for (const payment of Array.isArray(order?.partialPayments) ? order.partialPayments : []) {
    const amount = parseMoney(payment?.amount);
    if (amount === null || amount === 0) return false;
    partialTotal += amount;
    if (!Number.isSafeInteger(partialTotal)) return false;
  }
  return true;
}

function resolvedPaymentStatus(order) {
  const rawPaymentStatus = order?.paymentStatus;
  if (rawPaymentStatus !== undefined && rawPaymentStatus !== null && String(rawPaymentStatus).trim() !== '') {
    const paymentStatus = String(rawPaymentStatus).trim().toLowerCase();
    return VALID_PAYMENT_STATUSES.has(paymentStatus) ? paymentStatus : null;
  }
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  if (orderStatus === 'pending_online') return 'pending';
  if (['paid', 'sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled'].includes(orderStatus)) {
    return 'unknown';
  }
  return 'unpaid';
}

function invoiceIsClosed(order) {
  const invoiceStatus = String(order?.invoiceStatus || '').trim().toLowerCase();
  return order?.closed === true
    || order?.invoiceClosed === true
    || Boolean(order?.closedAt || order?.invoiceClosedAt)
    || ['closed', 'settled', 'paid', 'cancelled', 'canceled', 'void', 'refunded'].includes(invoiceStatus)
    || TERMINAL_ORDER_STATUSES.has(String(order?.status || '').trim().toLowerCase());
}

/**
 * Delivery acceptance is a restaurant decision, not a client-supplied flag.
 * Callers must pass the persisted order representation with an attributable
 * event. The actor is required so an accepted ticket can be audited later.
 */
function validateDeliveryAcceptance(order) {
  if (String(order?.fulfillment || '').trim().toLowerCase() !== 'delivery') {
    return { ok: true, applicable: false };
  }

  const acceptanceRecord = order?.deliveryAcceptance;
  const acceptance = String(
    typeof acceptanceRecord === 'string' ? acceptanceRecord : acceptanceRecord?.status || '',
  ).trim().toLowerCase();
  if (acceptance === 'rejected') return fail('delivery_acceptance_rejected');
  if (acceptance !== 'accepted') return fail('delivery_acceptance_required');

  // This is the single restaurant-acceptance contract used by both waiter
  // workflow guards and the acceptance route. Keep the event on the order;
  // a parallel provenance object is not authoritative.
  const provenance = acceptanceRecord;
  const source = typeof provenance?.source === 'string' ? provenance.source : '';
  const reference = typeof provenance?.reference === 'string' ? provenance.reference : '';
  const acceptedAt = typeof provenance?.acceptedAt === 'string' ? provenance.acceptedAt : '';
  const acceptedBy = provenance?.acceptedBy;
  const actorId = typeof acceptedBy?.phone === 'string' ? acceptedBy.phone.trim() : '';
  const actorRole = String(acceptedBy?.role || '').trim().toLowerCase();
  if (source !== 'restaurant'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(reference)
      || !actorId || actorId.length > 64
      || !['owner', 'manager', 'cashier'].includes(actorRole)
      || /[\u0000-\u001f\u007f]/u.test(actorId)) {
    return fail('delivery_acceptance_provenance_invalid');
  }

  // Route replay, waiter, cashier, and KDS all share the same timestamp and
  // chronology policy; no parallel source can certify a late acceptance.
  // `hasAcceptedDelivery` is shared with the status machine, whose legacy
  // fulfillment normalizer is intentionally strict/case-sensitive. Pass a
  // canonical projection here so ` DELIVERY ` cannot be mistaken for pickup.
  if (!hasAcceptedDelivery({ ...order, fulfillment: 'delivery' })) {
    return fail('delivery_acceptance_provenance_invalid');
  }

  return { ok: true, applicable: true, reference, actorId, acceptedAt };
}

function isKitchenOrderPaymentEligible(order, paymentStatus) {
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  const normalizedPaymentStatus = String(paymentStatus || '').trim().toLowerCase();
  if (!['sent_to_kitchen', 'preparing', 'ready', 'paid'].includes(orderStatus)) return false;
  if (!['unpaid', 'partial', 'failed', 'paid'].includes(normalizedPaymentStatus)) return false;
  if (!validateDeliveryAcceptance(order).ok) return false;
  return orderStatus !== 'paid' || normalizedPaymentStatus === 'paid';
}

function validateWaiterOrderAdd(lines, options = {}) {
  const validation = validateWaiterOrderLines(lines, { ...options, requireCanonical: true });
  if (!validation.ok) return validation;
  const alreadyServedIndex = lines.findIndex((line) => String(line?.courseStatus || 'fired').trim().toLowerCase() === 'served');
  if (alreadyServedIndex >= 0) return fail('course_already_served', alreadyServedIndex);
  if (options.sendToKitchen && !lines.some((line) => String(line?.courseStatus || 'fired').trim().toLowerCase() === 'fired')) {
    return fail('kitchen_course_empty');
  }
  return validation;
}

function validateWaiterOrderEdit(order, lines, options = {}) {
  if (!order || typeof order !== 'object') return fail('order_not_found');
  const status = String(order.status || '').trim().toLowerCase();
  if (invoiceIsClosed(order)) return fail('invoice_closed');
  if (order.startedAt || order.paymentMethod === 'online' || !EDITABLE_ORDER_STATUSES.has(status)) {
    return fail('order_edit_locked');
  }
  const paymentStatus = resolvedPaymentStatus(order);
  if (!paymentDataIsValid(order) || paymentStatus === null) return fail('order_payment_state_invalid');
  if (LOCKED_PAYMENT_STATUSES.has(paymentStatus)
      || receivedAmount(order) > 0) return fail('order_edit_payment_locked');
  return validateWaiterOrderLines(lines, { ...options, requireCanonical: true });
}

function validateWaiterKitchenSend(order, lines, options = {}) {
  if (!order || typeof order !== 'object') return fail('order_not_found');
  const status = String(order.status || '').trim().toLowerCase();
  if (invoiceIsClosed(order)) return fail('invoice_closed');
  if (!['pay_at_cashier', 'awaiting_confirmation', 'pending_online', 'paid', 'sent_to_kitchen'].includes(status)) {
    return fail('kitchen_send_locked');
  }
  const acceptance = validateDeliveryAcceptance(order);
  if (!acceptance.ok) return acceptance;
  const paymentStatus = resolvedPaymentStatus(order);
  if (!paymentStatus || !['unpaid', 'partial', 'failed', 'paid'].includes(paymentStatus)
      || status === 'pending_online'
      || (status === 'paid' && paymentStatus !== 'paid')) return fail('payment_not_confirmed');
  const validation = validateWaiterOrderLines(lines, { ...options, requireCanonical: true });
  if (!validation.ok) return validation;
  if (!lines.some((line) => String(line?.courseStatus || 'fired').trim().toLowerCase() === 'fired')) {
    return fail('kitchen_course_empty');
  }
  return { ...validation, idempotent: status === 'sent_to_kitchen' };
}

function validateWaiterCourseFire(order, course) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return fail('order_not_found');
  const normalizedCourse = String(course || '').trim().toLowerCase();
  if (!VALID_COURSES.has(normalizedCourse)) return fail('course_invalid');
  if (invoiceIsClosed(order)) return fail('invoice_closed');

  const status = String(order.status || '').trim().toLowerCase();
  if (!['pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing'].includes(status)) {
    return fail('course_fire_locked');
  }
  const acceptance = validateDeliveryAcceptance(order);
  if (!acceptance.ok) return acceptance;
  const paymentStatus = resolvedPaymentStatus(order);
  if (!paymentDataIsValid(order) || !paymentStatus
      || !['unpaid', 'partial', 'failed', 'paid'].includes(paymentStatus)
      || (status === 'paid' && paymentStatus !== 'paid')) {
    return fail('payment_not_confirmed');
  }

  const matchingItems = (Array.isArray(order.items) ? order.items : [])
    .filter((item) => String(item?.course || 'starters').trim().toLowerCase() === normalizedCourse);
  if (!matchingItems.length) return fail('course_not_found');
  for (const item of matchingItems) {
    if (!VALID_COURSE_STATUSES.has(String(item?.courseStatus || 'fired').trim().toLowerCase())) {
      return fail('course_state_invalid');
    }
  }
  const firedCount = matchingItems
    .filter((item) => String(item?.courseStatus || 'fired').trim().toLowerCase() === 'hold').length;
  return { ok: true, course: normalizedCourse, firedCount, idempotent: firedCount === 0 };
}

function validateWaiterSettlementTiming(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return fail('order_not_found');
  const fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
  const status = String(order.status || '').trim().toLowerCase();
  if (fulfillment !== 'dine_in' || !['done', 'completed'].includes(status)) {
    return fail('waiter_service_not_complete');
  }
  return { ok: true };
}

module.exports = {
  highestAssignedSeat,
  validateCoversForItems,
  validateOrderLineInput,
  validateWaiterOrderLines,
  validateWaiterOrderAdd,
  validateWaiterOrderEdit,
  validateWaiterKitchenSend,
  validateWaiterCourseFire,
  validateWaiterSettlementTiming,
  validateDeliveryAcceptance,
  isKitchenOrderPaymentEligible,
  invoiceIsClosed,
};

'use strict';

const { hasAcceptedDelivery } = require('../../platform_core/server/command-center.js');

const ACTIVE_KITCHEN_COLUMNS = new Set(['new', 'preparing', 'ready']);
const KITCHEN_COLUMNS = new Set([...ACTIVE_KITCHEN_COLUMNS, 'cancelled']);
const ACTIVE_ORDER_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready']);
const KITCHEN_PAYMENT_STATUSES = new Set(['unpaid', 'partial', 'paid']);
const KITCHEN_NON_ONLINE_PAYMENT_METHODS = new Set(['cashier', 'cash', 'manual_card', 'wallet', 'in_store_staff']);
const KITCHEN_LOCAL_TENDERS = new Set(['cash', 'manual_card', 'wallet', 'in_store_staff']);

const ACTION_TRANSITIONS = Object.freeze({
  start_ticket: Object.freeze({ from: 'new', to: 'preparing', idempotentAt: 'preparing' }),
  complete_ticket: Object.freeze({ from: 'preparing', to: 'ready', idempotentAt: 'ready' }),
  recall_ticket: Object.freeze({ from: 'ready', to: 'preparing', idempotentAt: 'preparing' }),
});

function ticketColumn(ticket) {
  const status = String(ticket?.status || '').trim().toLowerCase();
  if (status) {
    if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
    if (['new', 'sent_to_kitchen', 'paid'].includes(status)) return 'new';
    if (['preparing', 'ready'].includes(status)) return status;
    // When a canonical order state exists, never let a stale or caller-supplied
    // display column override it. Unknown states fail closed for KDS actions.
    return null;
  }

  const explicitColumn = String(ticket?.column || '').trim().toLowerCase();
  if (explicitColumn) return explicitColumn === 'canceled' ? 'cancelled' : explicitColumn;
  return null;
}

function compareActiveTickets(a, b) {
  // Priority is a deliberate boolean operator action, not an arbitrary numeric
  // weight that can jump tickets ahead through malformed/imported data.
  const priorityDifference = Number(b?.kds?.priority === true) - Number(a?.kds?.priority === true);
  if (priorityDifference) return priorityDifference;
  const timestamp = (value) => {
    if (value == null || value === '') return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };
  const createdA = timestamp(a?.createdAt);
  const createdB = timestamp(b?.createdAt);
  // Missing/corrupt timestamps must not masquerade as the Unix epoch and jump
  // ahead of every real ticket. Keep them visible, but after dated work.
  if (createdA == null && createdB == null) return 0;
  if (createdA == null) return 1;
  if (createdB == null) return -1;
  return createdA - createdB;
}

function compareCancelledTickets(a, b) {
  const time = (ticket) => {
    for (const value of [ticket?.cancelledAt, ticket?.updatedAt, ticket?.createdAt]) {
      if (value == null || value === '') continue;
      try {
        const parsed = new Date(value).getTime();
        if (Number.isFinite(parsed)) return parsed;
      } catch {
        // Malformed legacy timestamps should fall through to the next usable field.
      }
    }
    return null;
  };
  const timeA = time(a);
  const timeB = time(b);
  // Keep records with no usable timestamp visible, but after cancellations
  // that can be ordered reliably. Returning zero for both preserves input order.
  if (timeA == null && timeB == null) return 0;
  if (timeA == null) return 1;
  if (timeB == null) return -1;
  return timeB - timeA;
}

function deliveryAcceptanceEligibility(ticket) {
  if (String(ticket?.fulfillment || '').trim().toLowerCase() !== 'delivery') {
    return { eligible: true };
  }

  const rawAcceptance = ticket?.deliveryAcceptance;
  const acceptance = String(rawAcceptance && typeof rawAcceptance === 'object' && !Array.isArray(rawAcceptance)
    ? rawAcceptance.status || ''
    : rawAcceptance || '').trim().toLowerCase();
  if (acceptance === 'rejected') {
    return { eligible: false, reason: 'acceptanceRejected' };
  }
  if (acceptance !== 'accepted') {
    return { eligible: false, reason: ['unrecorded', 'pending', 'awaiting'].includes(acceptance) || !acceptance
      ? 'acceptanceRequired'
      : 'acceptanceProvenanceInvalid' };
  }
  return hasAcceptedDelivery(ticket)
    ? { eligible: true }
    : { eligible: false, reason: 'acceptanceProvenanceInvalid' };
}

function sameIdentity(left, right) {
  return left != null && right != null && String(left).trim() !== '' && String(left) === String(right);
}

function paymentTenderProjectionEligibility(ticket, allowedTenders) {
  if (ticket?.paymentTender != null) {
    const tender = typeof ticket.paymentTender === 'string' ? ticket.paymentTender.trim().toLowerCase() : '';
    if (!allowedTenders.has(tender)) return { eligible: false, reason: 'paymentProvenanceInvalid' };
  }

  if (ticket?.paymentTenders != null) {
    if (!Array.isArray(ticket.paymentTenders)
      || ticket.paymentTenders.some((value) => typeof value !== 'string'
        || !allowedTenders.has(value.trim().toLowerCase()))) {
      return { eligible: false, reason: 'paymentProvenanceInvalid' };
    }
  }

  return { eligible: true };
}

function onlineAttemptEligibility(ticket) {
  const orderId = ticket?.id;
  const expectedAttemptId = ticket?.paymentAttemptId;
  const attempts = [];

  if (ticket?.paymentAttempt && typeof ticket.paymentAttempt === 'object' && !Array.isArray(ticket.paymentAttempt)) {
    attempts.push(ticket.paymentAttempt);
  }
  if (Array.isArray(ticket?.paymentAttempts)) {
    attempts.push(...ticket.paymentAttempts.filter((attempt) => attempt && typeof attempt === 'object' && !Array.isArray(attempt)));
  }

  if (attempts.length) {
    const linked = attempts.filter((attempt) => sameIdentity(attempt.orderId, orderId)
      && (expectedAttemptId == null || sameIdentity(attempt.id, expectedAttemptId)));
    if (linked.length !== 1) return { eligible: false, reason: 'paymentProvenanceInvalid' };
    const attempt = linked[0];
    if (!sameIdentity(attempt.id, expectedAttemptId ?? attempt.id)
      || String(attempt.status || '').trim().toLowerCase() !== 'paid'
      || [attempt.tender, attempt.paymentMethod, attempt.method].some((method) => method != null
        && String(method).trim().toLowerCase() !== 'online')
      || (attempt.branchId != null && ticket.branchId != null && !sameIdentity(attempt.branchId, ticket.branchId))) {
      return { eligible: false, reason: 'paymentProvenanceInvalid' };
    }
    return { eligible: true };
  }

  // The live order projection records the paymentAttemptId in the status
  // history when a verified gateway result advances the order. Accept that
  // canonical linkage when the KDS projection does not carry the attempt row.
  const references = new Set((Array.isArray(ticket?.statusHistory) ? ticket.statusHistory : [])
    .map((entry) => entry?.paymentAttemptId ?? entry?.meta?.paymentAttemptId)
    .filter((value) => value != null && String(value).trim() !== '')
    .map(String));
  if (expectedAttemptId != null && references.size === 1 && references.has(String(expectedAttemptId))) {
    return { eligible: true };
  }
  return { eligible: false, reason: 'paymentProvenanceInvalid' };
}

function kitchenPaymentEligibility(ticket) {
  const paymentStatus = String(ticket?.paymentStatus || '').trim().toLowerCase();
  const rawMethod = ticket?.paymentMethod;
  const paymentMethod = typeof rawMethod === 'string' ? rawMethod.trim().toLowerCase() : '';

  if (paymentStatus === 'failed') return { eligible: false, reason: 'paymentAttemptFailed' };
  if (paymentStatus === 'pending' || paymentStatus === 'unknown' || paymentStatus === 'reconciliation_required') {
    return { eligible: false, reason: 'paymentNotSettled' };
  }
  if (paymentStatus && !KITCHEN_PAYMENT_STATUSES.has(paymentStatus)) {
    return { eligible: false, reason: 'paymentStatusInvalid' };
  }

  // Preserve old projection-only tickets for read compatibility. New orders
  // carry paymentMethod; an explicitly present but unrecognized method is
  // ambiguous and must not be treated as cash/COD.
  if (!paymentMethod) {
    return !Object.hasOwn(ticket || {}, 'paymentMethod')
      ? { eligible: true, legacy: true }
      : { eligible: false, reason: 'paymentMethodAmbiguous' };
  }

  if (paymentMethod === 'online') {
    if (paymentStatus !== 'paid') return { eligible: false, reason: 'paymentNotSettled' };
    const tenderProjection = paymentTenderProjectionEligibility(ticket, new Set(['online']));
    if (!tenderProjection.eligible) return tenderProjection;
    return onlineAttemptEligibility(ticket);
  }

  if (!KITCHEN_NON_ONLINE_PAYMENT_METHODS.has(paymentMethod)) {
    return { eligible: false, reason: 'paymentMethodAmbiguous' };
  }
  return paymentTenderProjectionEligibility(ticket, KITCHEN_LOCAL_TENDERS);
}

function incompleteTicketLines(ticket) {
  // Keep the state-only helper contract for older callers, but when a ticket
  // carries an item snapshot it must be complete before it can be marked ready.
  const hasItemSnapshot = Object.hasOwn(ticket, 'items') || Object.hasOwn(ticket, 'heldCourseItems');
  if (!hasItemSnapshot) return null;

  // A malformed projection is not proof that every course was completed.
  if ((Object.hasOwn(ticket, 'items') && !Array.isArray(ticket.items))
    || (Object.hasOwn(ticket, 'heldCourseItems') && !Array.isArray(ticket.heldCourseItems))) {
    return ['ticket'];
  }

  const items = Array.isArray(ticket.items) ? ticket.items : [];
  const heldItems = Array.isArray(ticket.heldCourseItems) ? ticket.heldCourseItems : [];
  const keyFor = (item, index) => String(item?.key ?? item?.lineKey ?? index);
  const incomplete = items.flatMap((item, index) => {
    const held = String(item?.courseStatus || '').trim().toLowerCase() === 'hold';
    const completedAt = item?.completedAt;
    const hasValidCompletionTime = typeof completedAt === 'string'
      && completedAt.trim() !== ''
      && Number.isFinite(Date.parse(completedAt));
    return held || !hasValidCompletionTime ? [keyFor(item, index)] : [];
  });
  incomplete.push(...heldItems.map(keyFor));

  // An explicitly empty/malformed snapshot is not evidence that the kitchen
  // finished the ticket. The server's KDS contract requires at least one line.
  if (!items.length && !heldItems.length) incomplete.push('ticket');
  return [...new Set(incomplete)];
}

function buildDeliveryAcceptanceReviewTicket(order = {}) {
  const rawAcceptance = order?.deliveryAcceptance;
  const acceptanceStatus = rawAcceptance && typeof rawAcceptance === 'object' && !Array.isArray(rawAcceptance)
    ? rawAcceptance.status
    : rawAcceptance;
  return {
    id: order?.id ?? null,
    branchId: order?.branchId ?? null,
    status: String(order?.status || ''),
    fulfillment: 'delivery',
    paymentStatus: String(order?.paymentStatus || ''),
    deliveryAcceptance: acceptanceStatus == null ? null : { status: String(acceptanceStatus) },
  };
}

function positiveBranchId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const branchId = Number(normalized);
  return Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
}

/**
 * Prepare recognized kitchen states for one optional branch. Cancelled tickets
 * remain visible in their acknowledgement lane. A legacy ticket with no
 * payment field can remain visible for reconciliation, but mutation routes
 * must reject it until payment is resolved.
 */
function prepareKitchenQueue(tickets = [], options = {}) {
  const activeTickets = [];
  const cancelledTickets = [];
  const blockedReasons = {
    acceptanceRequired: 0,
    acceptanceRejected: 0,
    acceptanceProvenanceInvalid: 0,
  };
  const hasBranchScope = options.branchId !== undefined && options.branchId !== null;
  const expectedBranchId = hasBranchScope ? positiveBranchId(options.branchId) : null;
  // Only an omitted branch is unscoped. An explicitly empty or malformed
  // branch must not silently widen a branch-specific queue to every tenant.
  const validExpectedBranchId = !hasBranchScope || expectedBranchId !== null;

  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket) || !validExpectedBranchId) continue;
    if (expectedBranchId !== null && positiveBranchId(ticket.branchId) !== expectedBranchId) continue;

    const orderStatus = String(ticket.status || '').trim().toLowerCase();
    const explicitColumn = String(ticket.column || '').trim().toLowerCase();
    const column = ticketColumn(ticket);
    if (column === 'cancelled') {
      cancelledTickets.push({ ...ticket, column: 'cancelled' });
      continue;
    }

    const deliveryAcceptance = deliveryAcceptanceEligibility(ticket);
    if (!deliveryAcceptance.eligible) {
      blockedReasons[deliveryAcceptance.reason] += 1;
      continue;
    }

    if (!orderStatus) {
      // Preserve pre-canonical helper callers. The live API filters on the
      // canonical order status before calling this formatter.
      if (!explicitColumn || ACTIVE_KITCHEN_COLUMNS.has(column)) activeTickets.push(ticket);
      continue;
    }

    if (!ACTIVE_KITCHEN_COLUMNS.has(column)) continue;

    if (!ACTIVE_ORDER_STATUSES.has(orderStatus)) continue;

    const payment = kitchenPaymentEligibility(ticket);
    if (!payment.eligible) {
      blockedReasons[payment.reason] = (blockedReasons[payment.reason] || 0) + 1;
      continue;
    }
    const paymentStatus = String(ticket.paymentStatus || '').trim().toLowerCase();
    if (orderStatus === 'paid' && paymentStatus !== 'paid') continue;
    activeTickets.push(ticket);
  }

  activeTickets.sort(compareActiveTickets);
  cancelledTickets.sort(compareCancelledTickets);

  const counts = {
    new: activeTickets.filter((ticket) => ticketColumn(ticket) === 'new').length,
    preparing: activeTickets.filter((ticket) => ticketColumn(ticket) === 'preparing').length,
    ready: activeTickets.filter((ticket) => ticketColumn(ticket) === 'ready').length,
    cancelled: cancelledTickets.length,
  };
  const blocked = Object.values(blockedReasons).reduce((sum, count) => sum + count, 0);
  if (blocked) {
    counts.blocked = blocked;
    counts.blockedReasons = blockedReasons;
  }

  return {
    tickets: activeTickets,
    cancelledTickets,
    counts,
  };
}

/**
 * Pure KDS state transition guard. The caller remains responsible for
 * authorization, persistence, audit logging, and publishing any events.
 */
function transitionKitchenTicket(ticket, action) {
  const current = ticketColumn(ticket);
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket) || !KITCHEN_COLUMNS.has(current)) {
    return { ok: false, error: 'kitchen_state_invalid', current: current || null };
  }

  const normalizedAction = String(action || '').trim();
  const transition = ACTION_TRANSITIONS[normalizedAction];
  if (!transition) {
    return {
      ok: false,
      error: 'kitchen_action_invalid',
      current,
      allowed: Object.entries(ACTION_TRANSITIONS)
        .filter(([, rule]) => (Array.isArray(rule.from) ? rule.from : [rule.from]).includes(current))
        .map(([name]) => name),
    };
  }

  if (ACTIVE_KITCHEN_COLUMNS.has(current)) {
    const acceptance = deliveryAcceptanceEligibility(ticket);
    if (!acceptance.eligible) {
      const error = {
        acceptanceRequired: 'delivery_acceptance_required',
        acceptanceRejected: 'delivery_acceptance_rejected',
        acceptanceProvenanceInvalid: 'delivery_acceptance_provenance_invalid',
      }[acceptance.reason];
      return { ok: false, error, current };
    }
    const payment = kitchenPaymentEligibility(ticket);
    if (!payment.eligible) {
      return { ok: false, error: 'kitchen_payment_not_eligible', current, reason: payment.reason };
    }
  }

  if (normalizedAction === 'complete_ticket') {
    const incomplete = incompleteTicketLines(ticket);
    if (incomplete?.length) {
      return { ok: false, error: 'kds_ticket_incomplete', current, incomplete };
    }
  }

  if (current === transition.idempotentAt) {
    return { ok: true, idempotent: true, ticket };
  }

  const allowedFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
  if (!allowedFrom.includes(current)) {
    return {
      ok: false,
      error: 'kitchen_transition_invalid',
      current,
      action: normalizedAction,
      allowed: Object.entries(ACTION_TRANSITIONS)
        .filter(([, rule]) => (Array.isArray(rule.from) ? rule.from : [rule.from]).includes(current))
        .map(([name]) => name),
    };
  }

  const nextTicket = { ...ticket, column: transition.to };
  if (Object.hasOwn(ticket, 'status')) nextTicket.status = transition.to;
  return { ok: true, idempotent: false, ticket: nextTicket };
}

module.exports = { buildDeliveryAcceptanceReviewTicket, kitchenPaymentEligibility, prepareKitchenQueue, transitionKitchenTicket };

(function attachOrderPaymentState(root) {
  'use strict';

  const ORDER_STATUSES = Object.freeze([
    'pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen',
    'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled',
  ]);
  const PAYMENT_STATUSES = Object.freeze([
    'unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'unknown',
  ]);
  const FULFILLMENTS = Object.freeze(['dine_in', 'pickup', 'delivery']);
  const DELIVERY_ACCEPTANCE_STATUSES = Object.freeze(['not_applicable', 'unrecorded', 'accepted', 'rejected']);
  const ORDER_STATUS_SET = new Set(ORDER_STATUSES);
  const PAYMENT_STATUS_SET = new Set(PAYMENT_STATUSES);
  const FULFILLMENT_SET = new Set(FULFILLMENTS);
  const DELIVERY_ACCEPTANCE_SET = new Set(DELIVERY_ACCEPTANCE_STATUSES);

  function failure(error) {
    return { ok: false, error };
  }

  const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

  function exactIntegerAmount(value, { allowZero = true } = {}) {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0 && (allowZero || value > 0) ? value : null;
    }
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!/^[+]?\d+$/u.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) && amount >= 0 && (allowZero || amount > 0) ? amount : null;
  }

  function settlementReferenceIdentity(value) {
    if (value == null) return { ok: true, identity: null };
    let raw;
    if (typeof value === 'string') raw = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) raw = String(value);
    else return { ok: false };
    if (raw.length > 120 || /[\p{Cc}\p{Cf}]/u.test(raw)) return { ok: false };
    const normalized = raw.trim().replace(/\s+/gu, ' ');
    return {
      ok: true,
      identity: normalized ? normalized.normalize('NFKC').toLocaleUpperCase('en-US') : null,
    };
  }

  function inspectPaymentHistory(payments) {
    if (!Array.isArray(payments)) return { ok: false, error: 'payment_history_invalid' };
    let amount = 0;
    const ids = new Set();
    const idempotencyKeys = new Set();
    const references = new Set();
    for (const payment of payments) {
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
        return { ok: false, error: 'payment_history_invalid' };
      }
      const grossAmount = exactIntegerAmount(payment.amount, { allowZero: false });
      const refundedAmount = payment.refundedAmount == null
        ? 0
        : exactIntegerAmount(payment.refundedAmount);
      if (grossAmount === null || refundedAmount === null || refundedAmount > grossAmount) {
        return { ok: false, error: 'payment_history_invalid' };
      }

      if (payment.id !== null && payment.id !== undefined) {
        const rawId = String(payment.id);
        if ((typeof payment.id !== 'string' && !(Number.isSafeInteger(payment.id) && payment.id > 0))
          || !rawId.trim() || rawId.trim().length > 120 || /[\p{Cc}\p{Cf}]/u.test(rawId)) {
          return { ok: false, error: 'payment_history_invalid' };
        }
        const id = rawId.trim();
        if (ids.has(id)) return { ok: false, error: 'payment_history_duplicate_id' };
        ids.add(id);
      }
      if (payment.idempotencyKey !== null && payment.idempotencyKey !== undefined) {
        if (typeof payment.idempotencyKey !== 'string'
          || !IDEMPOTENCY_KEY_PATTERN.test(payment.idempotencyKey)) {
          return { ok: false, error: 'payment_history_invalid' };
        }
        if (idempotencyKeys.has(payment.idempotencyKey)) {
          return { ok: false, error: 'payment_history_duplicate_idempotency_key' };
        }
        idempotencyKeys.add(payment.idempotencyKey);
      }
      if (payment.reference !== null && payment.reference !== undefined) {
        const reference = settlementReferenceIdentity(payment.reference);
        if (!reference.ok) return { ok: false, error: 'payment_history_invalid' };
        if (reference.identity) {
          if (references.has(reference.identity)) {
            return { ok: false, error: 'payment_history_duplicate_reference' };
          }
          references.add(reference.identity);
        }
      }

      const netAmount = grossAmount - refundedAmount;
      if (netAmount > Number.MAX_SAFE_INTEGER - amount) {
        return { ok: false, error: 'payment_history_invalid' };
      }
      amount += netAmount;
    }
    return { ok: true, amount };
  }

  function normalizedEnum(value, allowed) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    return allowed.has(normalized) ? normalized : '';
  }

  function isValidTimestamp(value) {
    if (typeof value !== 'string') return false;
    const timestamp = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(timestamp);
    if (!match || !Number.isFinite(Date.parse(timestamp))) return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
      && hour <= 23 && minute <= 59 && second <= 59;
  }

  function normalizeProvenance(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = typeof value.source === 'string' ? value.source.trim() : '';
    const reference = typeof value.reference === 'string' ? value.reference.trim() : '';
    if (!source || source.length > 48 || !reference || reference.length > 160
        || /[\u0000-\u001f\u007f]/u.test(source + reference)) return null;
    const provenance = { source, reference };
    if (value.actorId !== undefined) {
      if (typeof value.actorId !== 'string' || value.actorId.trim().length > 120
          || /[\u0000-\u001f\u007f]/u.test(value.actorId)) return null;
      provenance.actorId = value.actorId.trim() || null;
    }
    if (value.occurredAt !== undefined) {
      if (typeof value.occurredAt !== 'string' || !value.occurredAt.trim()
          || value.occurredAt.length > 64 || /[\u0000-\u001f\u007f]/u.test(value.occurredAt)) return null;
      provenance.occurredAt = value.occurredAt.trim();
    }
    if (value.acceptedAt !== undefined) {
      if (!isValidTimestamp(value.acceptedAt)) return null;
      provenance.acceptedAt = value.acceptedAt.trim();
    }
    return Object.freeze(provenance);
  }

  function validateState(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('state_invalid');
    const orderStatus = normalizedEnum(input.orderStatus, ORDER_STATUS_SET);
    if (!orderStatus) return failure('order_status_invalid');
    const paymentStatus = normalizedEnum(input.paymentStatus, PAYMENT_STATUS_SET);
    if (!paymentStatus) return failure('payment_status_invalid');
    const fulfillment = normalizedEnum(input.fulfillment, FULFILLMENT_SET);
    if (!fulfillment) return failure('fulfillment_invalid');

    const requiredFulfillment = {
      dispatched: 'delivery',
      delivered: 'delivery',
      picked_up: 'pickup',
      done: 'dine_in',
    }[orderStatus];
    if (requiredFulfillment && requiredFulfillment !== fulfillment) {
      return failure('fulfillment_order_state_mismatch');
    }

    const deliveryAcceptance = input.deliveryAcceptance === undefined
      ? (fulfillment === 'delivery' ? 'unrecorded' : 'not_applicable')
      : normalizedEnum(input.deliveryAcceptance, DELIVERY_ACCEPTANCE_SET);
    if (!deliveryAcceptance) return failure('delivery_acceptance_invalid');
    if (fulfillment !== 'delivery' && deliveryAcceptance !== 'not_applicable') {
      return failure('delivery_acceptance_not_applicable');
    }
    if (fulfillment === 'delivery' && deliveryAcceptance === 'not_applicable') {
      return failure('delivery_acceptance_required');
    }

    const rawProvenance = input.provenance;
    if (!rawProvenance || typeof rawProvenance !== 'object' || Array.isArray(rawProvenance)) {
      return failure('provenance_invalid');
    }
    const orderProvenance = normalizeProvenance(rawProvenance.order);
    if (!orderProvenance) return failure('order_provenance_required');
    const paymentProvenance = normalizeProvenance(rawProvenance.payment);
    if (!paymentProvenance) return failure('payment_provenance_required');
    let deliveryAcceptanceProvenance = null;
    if (rawProvenance.deliveryAcceptance !== undefined && rawProvenance.deliveryAcceptance !== null) {
      deliveryAcceptanceProvenance = normalizeProvenance(rawProvenance.deliveryAcceptance);
      if (!deliveryAcceptanceProvenance) return failure('delivery_acceptance_provenance_invalid');
    }
    let reconciliationProvenance = null;
    if (rawProvenance.reconciliation !== undefined && rawProvenance.reconciliation !== null) {
      reconciliationProvenance = normalizeProvenance(rawProvenance.reconciliation);
      if (!reconciliationProvenance || reconciliationProvenance.source.toLowerCase() !== 'reconciliation') {
        return failure('payment_reconciliation_provenance_invalid');
      }
    }
    let reconciles = null;
    if (rawProvenance.reconciles !== undefined && rawProvenance.reconciles !== null) {
      if (typeof rawProvenance.reconciles !== 'string' || !rawProvenance.reconciles.trim()
          || rawProvenance.reconciles.trim().length > 160
          || /[\u0000-\u001f\u007f]/u.test(rawProvenance.reconciles)) {
        return failure('payment_reconciliation_provenance_invalid');
      }
      reconciles = rawProvenance.reconciles.trim();
    }
    if (Boolean(reconciliationProvenance) !== Boolean(reconciles)
        || (reconciliationProvenance && (
          !['paid', 'failed', 'cancelled'].includes(paymentStatus)
          || reconciliationProvenance.reference === reconciles
          || paymentProvenance.reference !== reconciles
        ))) {
      return failure('payment_reconciliation_provenance_invalid');
    }
    if (['accepted', 'rejected'].includes(deliveryAcceptance) && !deliveryAcceptanceProvenance) {
      return failure('delivery_acceptance_provenance_required');
    }
    if (deliveryAcceptanceProvenance
        && (deliveryAcceptanceProvenance.source.toLowerCase() !== 'restaurant'
          || !deliveryAcceptanceProvenance.actorId
          || !deliveryAcceptanceProvenance.acceptedAt)) {
      return failure('delivery_acceptance_provenance_invalid');
    }
    if (!['accepted', 'rejected'].includes(deliveryAcceptance) && deliveryAcceptanceProvenance) {
      return failure('delivery_acceptance_provenance_invalid');
    }
    if (fulfillment !== 'delivery' && deliveryAcceptanceProvenance) {
      return failure('delivery_acceptance_provenance_invalid');
    }

    return {
      ok: true,
      state: Object.freeze({
        orderStatus,
        paymentStatus,
        fulfillment,
        deliveryAcceptance,
        provenance: Object.freeze({
          order: orderProvenance,
          payment: paymentProvenance,
          deliveryAcceptance: deliveryAcceptanceProvenance,
          reconciliation: reconciliationProvenance,
          reconciles,
        }),
      }),
    };
  }

  function createOrderPaymentState(input) {
    return validateState(input);
  }

  function orderTargets(state) {
    if (state.fulfillment === 'delivery'
        && ['pending_online', 'awaiting_confirmation', 'pay_at_cashier'].includes(state.orderStatus)) {
      return state.deliveryAcceptance === 'accepted' ? ['sent_to_kitchen'] : [];
    }
    const fixed = {
      pending_online: ['paid'],
      awaiting_confirmation: ['paid'],
      pay_at_cashier: ['paid', 'sent_to_kitchen'],
      sent_to_kitchen: ['preparing'],
      paid: ['preparing'],
      preparing: ['ready'],
      dispatched: ['delivered'],
      picked_up: [],
      delivered: [],
      done: [],
      cancelled: [],
    };
    if (state.orderStatus === 'ready') {
      const handoff = { delivery: 'dispatched', pickup: 'picked_up', dine_in: 'done' }[state.fulfillment];
      return [handoff];
    }
    return fixed[state.orderStatus] || [];
  }

  function withStateChange(state, changes, provenanceChanges) {
    return Object.freeze({
      ...state,
      ...changes,
      provenance: Object.freeze({ ...state.provenance, ...provenanceChanges }),
    });
  }

  function transitionOrderPaymentState(input, event) {
    const checked = validateState(input);
    if (!checked.ok) return checked;
    const state = checked.state;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return failure('event_invalid');
    const provenance = normalizeProvenance(event.provenance);
    if (!provenance) {
      return failure(event.type === 'delivery.acceptance'
        ? 'delivery_acceptance_provenance_invalid'
        : 'event_provenance_required');
    }

    if (event.type === 'order.transition') {
      const status = normalizedEnum(event.status, ORDER_STATUS_SET);
      if (!status) return failure('order_status_invalid');
      if (status === state.orderStatus) {
        return provenance.source === state.provenance.order.source
          && provenance.reference === state.provenance.order.reference
          ? { ok: true, idempotent: true, state }
          : failure('order_event_reference_conflict');
      }
      if (state.fulfillment === 'delivery' && status === 'paid') {
        return failure('delivery_order_status_independent');
      }
      if (state.fulfillment === 'delivery'
          && ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(status)) {
        if (state.deliveryAcceptance === 'rejected') return failure('delivery_acceptance_rejected');
        if (state.deliveryAcceptance !== 'accepted') return failure('delivery_acceptance_required');
      }
      if (!orderTargets(state).includes(status) && status !== 'cancelled') {
        return failure('order_transition_invalid');
      }
      if ([
        'sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done',
      ].includes(status) && !['unpaid', 'partial', 'failed', 'paid'].includes(state.paymentStatus)) {
        return failure('payment_not_confirmed');
      }
      if (status === 'paid' && state.paymentStatus !== 'paid') {
        return failure('payment_not_confirmed');
      }
      if (['sent_to_kitchen', 'preparing'].includes(status)) {
        const kitchenPaymentStates = new Set(['unpaid', 'partial', 'failed', 'paid']);
        if (!kitchenPaymentStates.has(state.paymentStatus)) return failure('payment_not_confirmed');
        if (state.deliveryAcceptance === 'rejected') return failure('delivery_acceptance_rejected');
        if (state.fulfillment === 'delivery' && state.deliveryAcceptance !== 'accepted') {
          return failure('delivery_acceptance_required');
        }
      }
      if (status === 'cancelled') {
        if (['paid', 'partial'].includes(state.paymentStatus) || state.orderStatus === 'paid') {
          return failure('order_refund_required');
        }
        if (!['unpaid', 'failed'].includes(state.paymentStatus)) {
          return failure('payment_reconciliation_required');
        }
        if (!orderTargets(state).includes('cancelled') && ![
          'pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen',
          'preparing', 'ready', 'dispatched',
        ].includes(state.orderStatus)) return failure('order_transition_invalid');
      }
      return {
        ok: true,
        idempotent: false,
        state: withStateChange(state, { orderStatus: status }, { order: provenance }),
      };
    }

    if (event.type === 'payment.outcome') {
      const status = normalizedEnum(event.status, PAYMENT_STATUS_SET);
      if (!status) return failure('payment_status_invalid');
      if (status === 'refunded') return failure('payment_refund_requires_reversal');
      if (status === state.paymentStatus) {
        const samePaymentEvent = provenance.source === state.provenance.payment.source
          && provenance.reference === state.provenance.payment.reference;
        if (samePaymentEvent) return { ok: true, idempotent: true, state };
        if (status === 'paid') return failure('payment_duplicate_conflict');
        if (['pending', 'unknown', 'failed', 'cancelled'].includes(status)) {
          return failure('payment_attempt_conflict');
        }
        if (status === 'partial') return failure('payment_partial_history_required');
        return failure('payment_event_reference_conflict');
      }
      if (state.paymentStatus === 'unknown') return failure('payment_reconciliation_required');
      if (state.paymentStatus === 'paid') return failure('payment_paid_terminal');
      if (state.paymentStatus === 'refunded') return failure('payment_terminal_conflict');
      const sameAttempt = provenance.source === state.provenance.payment.source
        && provenance.reference === state.provenance.payment.reference;
      if (sameAttempt && (
        (state.paymentStatus === 'failed' && ['partial', 'pending', 'paid'].includes(status))
        || (state.paymentStatus === 'partial' && status === 'paid')
        || state.paymentStatus === 'cancelled'
      )) {
        return failure('payment_attempt_reference_reused');
      }
      const paymentTargets = {
        unpaid: ['partial', 'pending', 'paid', 'failed', 'cancelled', 'unknown'],
        partial: ['paid', 'unknown'],
        pending: ['paid', 'failed', 'cancelled', 'unknown'],
        failed: ['partial', 'pending', 'paid', 'unknown'],
        // A confirmed-cancelled attempt can be retried only as a new attempt;
        // unknown outcomes still require reconciliation before any retry.
        cancelled: ['partial', 'pending', 'paid', 'failed'],
      };
      if (!(paymentTargets[state.paymentStatus] || []).includes(status)) {
        return failure('payment_transition_invalid');
      }
      if (state.orderStatus === 'cancelled' && ['partial', 'pending', 'paid'].includes(status)) {
        return failure('cancelled_order_payment_conflict');
      }
      return {
        ok: true,
        idempotent: false,
        state: withStateChange(state, { paymentStatus: status }, { payment: provenance }),
      };
    }

    if (event.type === 'payment.reconciled') {
      const status = normalizedEnum(event.status, PAYMENT_STATUS_SET);
      if (!status) return failure('payment_status_invalid');
      const reconciles = typeof event.reconciles === 'string' ? event.reconciles.trim() : '';
      if (state.paymentStatus !== 'unknown') {
        const prior = state.provenance.reconciliation;
        if (status === state.paymentStatus && prior
            && prior.source === provenance.source && prior.reference === provenance.reference
            && state.provenance.reconciles === reconciles) {
          return { ok: true, idempotent: true, state };
        }
        return failure('payment_reconciliation_invalid');
      }
      if (!['paid', 'failed', 'cancelled'].includes(status)) {
        return failure('payment_reconciliation_invalid');
      }
      if (provenance.source.toLowerCase() !== 'reconciliation'
          || !reconciles
          || reconciles !== state.provenance.payment.reference
          || reconciles === provenance.reference) {
        return failure('payment_reconciliation_provenance_invalid');
      }
      // Reconciliation records provider truth; it never reopens the order.
      // A late capture on a cancelled order must remain visible so the caller
      // can run the separate refund/reversal flow instead of losing evidence.
      return {
        ok: true,
        idempotent: false,
        state: withStateChange(state, { paymentStatus: status }, {
          reconciliation: provenance,
          reconciles,
        }),
      };
    }

    if (event.type === 'payment.refund') {
      if (state.paymentStatus === 'refunded') {
        return state.provenance.payment.source === provenance.source
          && state.provenance.payment.reference === provenance.reference
          ? { ok: true, idempotent: true, state }
          : failure('payment_refund_terminal');
      }
      if (state.paymentStatus !== 'paid') return failure('payment_refund_requires_paid');
      if (state.provenance.payment.reference === provenance.reference) {
        return failure('payment_refund_reference_conflict');
      }
      return {
        ok: true,
        idempotent: false,
        state: withStateChange(state, { paymentStatus: 'refunded' }, { payment: provenance }),
      };
    }

    if (event.type === 'delivery.acceptance') {
      const status = normalizedEnum(event.status, new Set(['accepted', 'rejected']));
      if (!status) return failure('delivery_acceptance_invalid');
      if (state.fulfillment !== 'delivery') return failure('delivery_acceptance_not_applicable');
      if (provenance.source.toLowerCase() !== 'restaurant' || !provenance.actorId || !provenance.acceptedAt) {
        return failure('delivery_acceptance_provenance_invalid');
      }
      if (status === state.deliveryAcceptance) {
        const prior = state.provenance.deliveryAcceptance;
        return prior && prior.source === provenance.source && prior.reference === provenance.reference
          && prior.actorId === provenance.actorId
          ? { ok: true, idempotent: true, state }
          : failure('delivery_acceptance_event_conflict');
      }
      if (state.deliveryAcceptance !== 'unrecorded') return failure('delivery_acceptance_terminal');
      if (!['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(state.orderStatus)) {
        return failure('delivery_acceptance_window_closed');
      }
      return {
        ok: true,
        idempotent: false,
        state: withStateChange(
          state,
          { deliveryAcceptance: status },
          { deliveryAcceptance: provenance },
        ),
      };
    }

    return failure('event_type_invalid');
  }

  function getOrderPaymentAmounts(order, fallbackTotal = 0) {
    const input = order && typeof order === 'object' && !Array.isArray(order) ? order : {};
    const rawTotal = input.total === undefined || input.total === null || input.total === ''
      ? fallbackTotal
      : input.total;
    const total = exactIntegerAmount(rawTotal);
    if (total === null) return { total: null, paid: null, due: null };

    const hasPaid = input.amountPaid !== undefined && input.amountPaid !== null;
    const paidProjection = hasPaid ? exactIntegerAmount(input.amountPaid) : null;
    if (hasPaid && paidProjection === null) return { total, paid: null, due: null };

    const hasPayments = input.partialPayments !== undefined && input.partialPayments !== null;
    let recordedPaid = 0;
    if (hasPayments) {
      const history = inspectPaymentHistory(input.partialPayments);
      if (!history.ok) return { total, paid: null, due: null };
      recordedPaid = history.amount;
      if (hasPaid && paidProjection !== recordedPaid) return { total, paid: null, due: null };
    }

    const paid = hasPaid ? paidProjection : hasPayments ? recordedPaid : 0;
    if (paid > total) return { total, paid: null, due: null };
    return { total, paid, due: total - paid };
  }

  const ORDER_STATUS_VALUES = new Set(ORDER_STATUSES);
  const PAYMENT_STATUS_VALUES = new Set(PAYMENT_STATUSES);
  const SETTLEABLE_ORDER_STATUSES = new Set([
    'pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'preparing', 'ready',
    'done', 'picked_up', 'delivered',
  ]);
  const COMPLETED_ORDER_STATUSES = new Set(['picked_up', 'delivered', 'done']);

  function normalizedState(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  function deriveOrderPaymentWorkflow(order) {
    const input = order && typeof order === 'object' ? order : {};
    const orderStatus = normalizedState(input.status);
    const rawPaymentStatus = normalizedState(input.paymentStatus);
    const issueCodes = [];
    const knownOrderStatus = ORDER_STATUS_VALUES.has(orderStatus);
    if (!knownOrderStatus) issueCodes.push('order_status_unknown');
    const fulfillment = normalizedState(input.fulfillment);
    if (input.fulfillment !== undefined && input.fulfillment !== null && input.fulfillment !== ''
        && !FULFILLMENT_SET.has(fulfillment)) {
      issueCodes.push('fulfillment_invalid');
    }
    const requiredFulfillment = {
      dispatched: 'delivery',
      delivered: 'delivery',
      picked_up: 'pickup',
      done: 'dine_in',
    }[orderStatus];
    if (requiredFulfillment && requiredFulfillment !== fulfillment) {
      issueCodes.push('fulfillment_order_state_mismatch');
    }

    let paymentStatus = rawPaymentStatus;
    if (!paymentStatus) {
      if (orderStatus === 'pending_online') paymentStatus = 'pending';
      else if (['pay_at_cashier', 'awaiting_confirmation'].includes(orderStatus)) paymentStatus = 'unpaid';
      else paymentStatus = 'unknown';
    }
    if (!PAYMENT_STATUS_VALUES.has(paymentStatus)) {
      issueCodes.push('payment_status_invalid');
      paymentStatus = 'unknown';
    } else if (paymentStatus === 'unknown') issueCodes.push(rawPaymentStatus ? 'payment_status_unknown' : 'payment_status_missing');

    const finiteAmount = exactIntegerAmount;
    const parsedTotal = finiteAmount(input.total, { allowZero: false });
    const total = parsedTotal === null ? Number(input.total) : parsedTotal;
    let amountsValid = parsedTotal !== null;
    let paidFromField = 0;
    let hasPaidField = input.amountPaid !== undefined && input.amountPaid !== null;
    if (hasPaidField) {
      const parsedPaid = finiteAmount(input.amountPaid);
      if (parsedPaid === null) amountsValid = false;
      else paidFromField = parsedPaid;
    }

    const hasPartialPayments = input.partialPayments !== undefined && input.partialPayments !== null;
    let partialPaymentsTotal = 0;
    if (hasPartialPayments) {
      if (!Array.isArray(input.partialPayments)) amountsValid = false;
      else {
        const history = inspectPaymentHistory(input.partialPayments);
        if (!history.ok) amountsValid = false;
        else partialPaymentsTotal = history.amount;
      }
    }

    if (!amountsValid) issueCodes.push('payment_amount_invalid');
    if (amountsValid && hasPaidField && hasPartialPayments
        && paidFromField !== partialPaymentsTotal) {
      issueCodes.push('paid_amount_sources_disagree');
    }

    const paid = amountsValid
      ? (hasPaidField ? paidFromField : hasPartialPayments ? partialPaymentsTotal : 0)
      : null;
    const overpaid = amountsValid && paid > total;
    if (overpaid) issueCodes.push('payment_amount_exceeds_total');

    if (amountsValid && !overpaid) {
      const hasReceivedMoney = paid > 0;
      if (paymentStatus === 'paid' && paid !== total) issueCodes.push('paid_amount_mismatch');
      if (paymentStatus === 'partial' && (!hasReceivedMoney || paid >= total)) issueCodes.push('partial_amount_mismatch');
      if (['unpaid', 'pending', 'failed', 'cancelled'].includes(paymentStatus) && hasReceivedMoney) {
        issueCodes.push('payment_status_amount_mismatch');
      }
      // Failed or cancelled provider attempts leave the order retryable.
      if (orderStatus === 'pending_online' && ['paid', 'partial', 'refunded'].includes(paymentStatus)) {
        issueCodes.push('online_order_payment_mismatch');
      }
      if (orderStatus === 'paid' && paymentStatus !== 'paid') {
        issueCodes.push('paid_order_payment_mismatch');
      }
      if (orderStatus === 'cancelled' && ['paid', 'partial', 'pending'].includes(paymentStatus)) {
        issueCodes.push('cancelled_order_payment_mismatch');
      }
    }

    const uniqueIssues = [...new Set(issueCodes)];
    const requiresReconciliation = uniqueIssues.length > 0;
    const isConsistent = uniqueIssues.length === 0;
    const safeAmounts = amountsValid && !overpaid && isConsistent
      ? { total, paid, due: total - paid }
      : { total: Number.isFinite(total) && total > 0 ? total : null, paid: null, due: null };
    const settled = isConsistent && paymentStatus === 'paid' && safeAmounts.due === 0;

    const states = {
      registration: knownOrderStatus ? 'completed' : 'blocked',
      online_payment: orderStatus !== 'pending_online'
        ? 'not_applicable'
        : !isConsistent || ['unknown', 'paid', 'partial', 'refunded'].includes(paymentStatus)
          ? 'blocked'
          : 'current',
      acceptance_preparation: 'upcoming',
      ready_delivery: 'upcoming',
      partial_payment: paymentStatus === 'partial'
        ? 'current'
        : paymentStatus === 'paid' && partialPaymentsTotal > 0 ? 'completed' : 'not_applicable',
      reconciliation: requiresReconciliation ? 'current' : 'not_required',
      settlement: 'upcoming',
      cancellation: orderStatus === 'cancelled' && isConsistent ? 'completed' : 'available',
    };
    if (paymentStatus === 'partial' && requiresReconciliation) states.partial_payment = 'blocked';

    if (['awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing'].includes(orderStatus)) {
      states.acceptance_preparation = 'current';
    } else if (['ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(orderStatus)) {
      states.acceptance_preparation = 'completed';
    }
    if (['ready', 'dispatched'].includes(orderStatus)) states.ready_delivery = 'current';
    else if (COMPLETED_ORDER_STATUSES.has(orderStatus)) states.ready_delivery = 'completed';

    if (settled) states.settlement = 'completed';
    else if (!isConsistent || ['pending', 'unknown'].includes(paymentStatus)) states.settlement = 'blocked';
    else if (orderStatus === 'pending_online') states.settlement = 'blocked';
    else if (['cancelled', 'refunded'].includes(paymentStatus) || orderStatus === 'cancelled') {
      states.settlement = paymentStatus === 'refunded' ? 'reversed' : 'not_applicable';
    } else if (paymentStatus === 'partial') states.settlement = 'current';
    else if (SETTLEABLE_ORDER_STATUSES.has(orderStatus) && ['unpaid', 'failed'].includes(paymentStatus)) {
      states.settlement = 'current';
    }

    if (orderStatus === 'cancelled' && isConsistent) states.cancellation = 'completed';
    else if (!knownOrderStatus || !isConsistent || ['paid', 'partial', 'pending', 'unknown', 'refunded'].includes(paymentStatus)
        || COMPLETED_ORDER_STATUSES.has(orderStatus)) states.cancellation = 'blocked';

    let currentStageId = null;
    if (requiresReconciliation) currentStageId = 'reconciliation';
    else if (orderStatus === 'cancelled') currentStageId = 'cancellation';
    else if (orderStatus === 'pending_online') currentStageId = 'online_payment';
    else if (states.acceptance_preparation === 'current') currentStageId = 'acceptance_preparation';
    else if (states.ready_delivery === 'current') currentStageId = 'ready_delivery';
    else if (states.partial_payment === 'current') currentStageId = 'partial_payment';
    else if (states.settlement === 'current' || states.settlement === 'completed') currentStageId = 'settlement';

    const labels = {
      registration: 'ثبت سفارش',
      online_payment: 'پرداخت آنلاین',
      acceptance_preparation: 'پذیرش و آماده‌سازی',
      ready_delivery: 'آماده‌سازی و تحویل',
      partial_payment: 'پرداخت جزئی',
      reconciliation: 'بررسی و تطبیق پرداخت',
      settlement: 'تسویه‌حساب',
      cancellation: 'لغو سفارش',
    };
    const stages = Object.keys(labels).map((id) => ({ id, label: labels[id], state: states[id] }));

    return {
      status: requiresReconciliation ? 'reconciliation_required' : 'consistent',
      isConsistent,
      requiresReconciliation,
      issueCodes: uniqueIssues,
      orderStatus,
      paymentStatus,
      currentStageId,
      settled,
      amounts: safeAmounts,
      stages,
    };
  }

  function normalizeSettlementIntent(intent = {}) {
    const numeric = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    return {
      orderId: String(intent.orderId ?? ''),
      branchId: String(intent.branchId ?? ''),
      actor: String(intent.actor ?? ''),
      actorRole: String(intent.actorRole ?? ''),
      tender: String(intent.tender ?? ''),
      paymentAmount: numeric(intent.paymentAmount),
      amountTendered: numeric(intent.amountTendered),
      paymentReference: String(intent.paymentReference ?? '').trim() || null,
    };
  }

  function settlementIntentFingerprint(intent = {}) {
    const value = JSON.stringify(normalizeSettlementIntent(intent));
    let first = 2166136261;
    let second = 3339675911;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 16777619);
    }
    return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }

  function settlementIntentStorageKey(intent = {}) {
    const normalized = normalizeSettlementIntent(intent);
    const scope = [normalized.branchId, normalized.orderId]
      .map((value) => encodeURIComponent(value || '_')).join(':');
    return `westo:settlement-intents:v1:${scope}`;
  }

  function storageOrNull(storage) {
    if (storage !== undefined) return storage;
    try { return root.sessionStorage || null; } catch (_) { return null; }
  }

  function newSettlementIdempotencyKey() {
    const nonce = root.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `settle-${nonce}`;
  }

  function settlementIdempotencyStorageError(cause) {
    return Object.assign(new Error('کلید یکتای تسویه ذخیره نشد؛ برای جلوگیری از ثبت دوباره، درخواست به سرور ارسال نشد.'), {
      code: 'settlement_idempotency_storage_unavailable',
      notSent: true,
      ...(cause ? { cause } : {}),
    });
  }

  function getSettlementIdempotencyKey(intent, storage) {
    const target = storageOrNull(storage);
    if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function') {
      throw settlementIdempotencyStorageError();
    }
    const fingerprint = settlementIntentFingerprint(intent);
    const key = settlementIntentStorageKey(intent);
    let records = {};
    try {
      const raw = target.getItem(key);
      records = raw ? JSON.parse(raw) : {};
    } catch (error) {
      throw settlementIdempotencyStorageError(error);
    }
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      throw settlementIdempotencyStorageError();
    }
    for (const record of Object.values(records)) {
      if (!record || typeof record !== 'object'
        || typeof record.key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(record.key)
        || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
        throw settlementIdempotencyStorageError();
      }
    }
    const existing = records[fingerprint];
    if (existing) return existing.key;
    const idempotencyKey = newSettlementIdempotencyKey();
    records[fingerprint] = { key: idempotencyKey, createdAt: Date.now() };
    records = Object.fromEntries(Object.entries(records)
      .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
      .slice(0, 32));
    try {
      target.setItem(key, JSON.stringify(records));
      const saved = JSON.parse(target.getItem(key) || '{}');
      if (saved?.[fingerprint]?.key !== idempotencyKey) throw new Error('Idempotency key was not persisted.');
    } catch (error) {
      throw settlementIdempotencyStorageError(error);
    }
    return idempotencyKey;
  }

  function clearSettlementIdempotencyKey(intent, idempotencyKey, storage) {
    const target = storageOrNull(storage);
    if (!target || !idempotencyKey) return false;
    const key = settlementIntentStorageKey(intent);
    const fingerprint = settlementIntentFingerprint(intent);
    try {
      const records = JSON.parse(target.getItem(key) || '{}') || {};
      if (!records || typeof records !== 'object' || Array.isArray(records)) return false;
      if (records[fingerprint]?.key !== idempotencyKey) return false;
      delete records[fingerprint];
      if (Object.keys(records).length) target.setItem(key, JSON.stringify(records));
      else target.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  const api = Object.freeze({
    ORDER_STATUSES,
    PAYMENT_STATUSES,
    FULFILLMENTS,
    DELIVERY_ACCEPTANCE_STATUSES,
    createOrderPaymentState,
    transitionOrderPaymentState,
    getOrderPaymentAmounts,
    deriveOrderPaymentWorkflow,
    normalizeSettlementIntent,
    settlementIntentFingerprint,
    getSettlementIdempotencyKey,
    clearSettlementIdempotencyKey,
  });
  root.WestoOrderPaymentState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

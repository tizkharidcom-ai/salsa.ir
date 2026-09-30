'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/kitchen/orders', __westoModuleContext.requireKitchen, (req, res) => {
  // Only confirmed orders reach the kitchen. Cash collection, cancellation and
  // fulfilment remain cashier/manager actions and cannot be bypassed from KDS.
  const active = ['sent_to_kitchen', 'paid', 'preparing', 'ready'];
  const bid = __westoModuleContext.requestedKdsBranch(req);
  if (!bid) return res.status(400).json({ error: 'branch_invalid' });
  const now = Date.now();
  const branchOrders = (__westoModuleContext.db.orders || []).filter((order) => Number(order.branchId) === Number(bid));
  const queuePaymentEligible = (order) => {
    if (__westoModuleContext.normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo }) === 'delivery' && !__westoModuleContext.hasAcceptedDelivery(order)) return false;
    return __westoModuleContext.isKdsPaymentEligible(order);
  };
  const activeTickets = branchOrders
    .filter((o) => active.includes(o.status) && queuePaymentEligible(o))
    .filter((o) => __westoModuleContext.kitchenLines(o).length > 0 || __westoModuleContext.kitchenLines(o, { onlyHeld: true }).length > 0)
    .map((o) => __westoModuleContext.kitchenTicket(o, now));
  // Keep active legacy deliveries visible as aggregate blockers, without
  // putting their customer/order details into the kitchen ticket list.
  const acceptanceReviewTickets = branchOrders
    .filter((order) => active.includes(order.status)
      && __westoModuleContext.normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo }) === 'delivery'
      && !__westoModuleContext.hasAcceptedDelivery(order))
    .map((order) => ({
      id: order.id,
      branchId: order.branchId,
      status: order.status,
      fulfillment: 'delivery',
      paymentStatus: __westoModuleContext.paymentStatusFor(order),
      deliveryAcceptance: {
        status: String(order.deliveryAcceptance?.status || 'pending').trim().toLowerCase(),
      },
    }));

  // A cancellation is visible to KDS only if the order had entered a state
  // that the active kitchen queue accepts. Keep the review window explicit;
  // undated legacy cancellations remain visible but are labelled as unknown.
  const cancellationCutoff = now - 24 * 60 * 60 * 1000;
  const cancelledTicketsForQueue = branchOrders
    .filter((order) => String(order.status || '').toLowerCase() === 'cancelled')
    .filter((order) => (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) => active.includes(String(entry?.status || '').toLowerCase())))
      || !!(order.startedAt || order.readyAt))
    .map((order) => {
      const cancellationEvent = [...(Array.isArray(order.statusHistory) ? order.statusHistory : [])]
        .reverse()
        .find((entry) => String(entry?.status || '').toLowerCase() === 'cancelled');
      const statusCancelledAt = order.statusAt ? new Date(order.statusAt).getTime() : NaN;
      const eventCancelledAt = cancellationEvent?.at ? new Date(cancellationEvent.at).getTime() : NaN;
      const parsedCancelledAt = Number.isFinite(statusCancelledAt) ? statusCancelledAt : eventCancelledAt;
      const isRecent = Number.isFinite(parsedCancelledAt)
        ? parsedCancelledAt >= cancellationCutoff && parsedCancelledAt <= now
        : true;
      if (!isRecent) return null;

      // kitchenTicket/ensureKdsState normalizes KDS state. Clone this terminal
      // order's KDS shell so a read of the cancellation lane never mutates db.
      const snapshot = {
        ...order,
        kds: {
          ...(order.kds && typeof order.kds === 'object' ? order.kds : {}),
          itemStates: { ...(order.kds?.itemStates && typeof order.kds.itemStates === 'object' ? order.kds.itemStates : {}) },
        },
      };
      const ticket = __westoModuleContext.kitchenTicket(snapshot, now);
      const items = [...(ticket.items || []), ...(ticket.heldCourseItems || [])];
      if (!items.length) return null;
      return {
        id: order.id,
        orderNo: order.orderNo || `#${order.id}`,
        branchId: order.branchId,
        fulfillment: order.fulfillment || (order.tableNo ? 'dine_in' : 'pickup'),
        tableNo: order.tableNo || null,
        createdAt: order.createdAt || null,
        cancelledAt: Number.isFinite(parsedCancelledAt) ? new Date(parsedCancelledAt).toISOString() : null,
        note: order.note || '',
        kitchenNote: order.kitchenNote || '',
        items,
        column: 'cancelled',
      };
    })
    .filter(Boolean);

  const queue = __westoModuleContext.prepareKitchenQueue([...activeTickets, ...acceptanceReviewTickets, ...cancelledTicketsForQueue], { branchId: bid });
  const { tickets, cancelledTickets, counts } = queue;
  const allDayMap = new Map();
  for (const ticket of tickets.filter((entry) => entry.column !== 'ready')) {
    for (const item of ticket.items.filter((entry) => !entry.completedAt)) {
      const key = `${item.station}:${item.name}`;
      const current = allDayMap.get(key) || { name: item.name, station: item.station, qty: 0, tickets: [] };
      current.qty += Math.max(1, Number(item.qty) || 1);
      current.tickets.push(ticket.id);
      allDayMap.set(key, current);
    }
  }
  const stationCounts = Object.fromEntries(__westoModuleContext.KDS_STATIONS.filter((entry) => entry.id !== 'expo').map((entry) => [entry.id, 0]));
  tickets.filter((entry) => entry.column !== 'ready').forEach((ticket) => ticket.items.filter((item) => !item.completedAt).forEach((item) => { stationCounts[item.station] = Number(stationCounts[item.station] || 0) + Math.max(1, Number(item.qty) || 1); }));
  res.json({
    tickets,
    cancelledTickets,
    cancellationWindowHours: 24,
    counts,
    paymentReview: __westoModuleContext.summarizeKdsPaymentReview(branchOrders, bid),
    stations: __westoModuleContext.KDS_STATIONS.map((entry) => ({ ...entry, count: entry.id === 'expo' ? tickets.filter((ticket) => ticket.column !== 'ready').length : Number(stationCounts[entry.id] || 0) })),
    allDay: [...allDayMap.values()].sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'fa')),
    availability: (__westoModuleContext.db.menuItems || [])
      .filter((item) => __westoModuleContext.menuItemBelongsToBranch(item, bid))
      .map((item) => __westoModuleContext.kdsMenuAvailabilityPayload(item, bid))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa')),
    performance: __westoModuleContext.kdsPerformance((__westoModuleContext.db.orders || []).filter((order) => Number(order.branchId) === Number(bid)), now),
    summary: {
      oldestAgeSec: tickets.reduce((m, t) => Math.max(m, Number(t.ageSec) || 0), 0),
      delayed: tickets.filter((t) => t.column !== 'ready' && Number(t.ageSec) >= 1200).length,
      warning: tickets.filter((t) => t.column !== 'ready' && Number(t.ageSec) >= 600 && Number(t.ageSec) < 1200).length,
      itemUnits: tickets.reduce((sum, t) => sum + (t.items || []).reduce((n, item) => n + Math.max(1, Number(item.qty) || 1), 0), 0),
    },
    branchId: bid,
    serverTime: new Date().toISOString(),
  });
});
};

'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.patch('/api/waiter/orders/:id/fire-course', __westoModuleContext.requireCapability('orders.course.manage'), __westoModuleContext.serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (__westoModuleContext.db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    __westoModuleContext.assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (__westoModuleContext.normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery' && !__westoModuleContext.hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'پیش از ارسال دورهٔ سفارش، پذیرش رستوران را ثبت کنید.' });
  }
  const course = String(req.body?.course || '').trim().toLowerCase();
  if (!course) return res.status(400).json({ error: 'course_required' });
  const courseValidation = __westoModuleContext.validateWaiterCourseFire(order, course);
  if (!courseValidation.ok) {
    const status = ['order_not_found', 'course_not_found'].includes(courseValidation.error)
      ? 404
      : ['course_invalid'].includes(courseValidation.error)
        ? 400
        : 409;
    return res.status(status).json({ error: courseValidation.error, current: order.status });
  }
  if (courseValidation.idempotent) {
    return res.json({ ok: true, idempotent: true, order: __westoModuleContext.operationalOrderResponse(order, req.user), firedCount: 0, course: courseValidation.course });
  }
  const snapshot = __westoModuleContext.snapshotFinanceMutationState();
  const now = new Date().toISOString();
  let firedCount = 0;
  (order.items || []).forEach((item) => {
    if (String(item.course || '').toLowerCase() === course && item.courseStatus === 'hold') {
      item.courseStatus = 'fired';
      item.firedAt = now;
      firedCount++;
    }
  });
  if (firedCount > 0 && order.status === 'pay_at_cashier' && __westoModuleContext.canTransitionOrder(order, 'sent_to_kitchen')) {
    __westoModuleContext.appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'waiter-fire', course });
  }
  __westoModuleContext.recordAudit(req, 'order.course_fired', 'order', order.id, { course, firedCount }, order.branchId);
  try {
    await __westoModuleContext.persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'course_persistence_failed', message: 'ارسال مرحلهٔ سفارش پایدار نشد؛ وضعیت را تازه کنید و دوباره بررسی کنید.' });
  }
  try { __westoModuleContext.publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, courseFired: course }); }
  catch (eventError) { console.error('[waiter-course] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: __westoModuleContext.operationalOrderResponse(order, req.user), firedCount, course });
}));
};

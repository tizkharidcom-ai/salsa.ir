'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

function findChangePlanRoute(router) {
  const layer = router.stack.find(entry => entry.route?.path === '/subscriptions/:id/change-plan');
  assert.ok(layer, 'change-plan endpoint is registered');
  return layer.route;
}

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const routeCases = [
  {
    name: 'active Control Plane route',
    routerPath: '../server/salsa/control-plane/routes/billing-routes',
    paymentPath: '../server/salsa/control-plane/billing/payment-service',
    pricingPath: '../server/salsa/control-plane/billing/pricing-service'
  },
  {
    name: 'legacy SuperAdmin backend route',
    routerPath: '../superadmin/backend/routes/billing-routes',
    paymentPath: '../superadmin/backend/billing/payment-service',
    pricingPath: '../superadmin/backend/billing/pricing-service'
  }
];

for (const routeCase of routeCases) {
  test(`${routeCase.name} refuses plan changes until financial policy is defined`, async () => {
    const router = require(routeCase.routerPath);
    const paymentService = require(routeCase.paymentPath);
    const pricingService = require(routeCase.pricingPath);
    const route = findChangePlanRoute(router);
    const handler = route.stack.at(-1).handle;
    const originalGetSubscription = paymentService.getSubscription;
    const originalGetPlan = pricingService.getPlan;
    const calls = [];
    const subscriptionsBefore = structuredClone([...paymentService.inMemorySubscriptions.entries()]);

    paymentService.getSubscription = async (...args) => { calls.push(['getSubscription', args]); return originalGetSubscription?.(...args); };
    pricingService.getPlan = async (...args) => { calls.push(['getPlan', args]); return originalGetPlan?.(...args); };

    try {
      const req = {
        params: { id: 'subscription-a' },
        body: { newPlanId: 'growth', tenantId: 'tenant-a', reason: 'requested upgrade', expectedVersion: 1 },
        platformPrincipal: { id: 'platform-principal-a', role: 'platform_owner' }
      };
      const res = responseHarness();
      await handler(req, res);

      assert.equal(res.statusCode, 501);
      assert.equal(res.body.success, false);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, 'SUBSCRIPTION_PLAN_CHANGE_POLICY_REQUIRED');
      assert.match(res.body.error.message, /سیاست مالی و زمان اثرگذاری/);
      assert.match(res.body.error.message, /اشتراک تغییری نکرده است/);
      assert.deepEqual(calls, [], 'request is rejected before service reads or mutation calls');
      assert.deepEqual([...paymentService.inMemorySubscriptions.entries()], subscriptionsBefore, 'subscription state remains unchanged');
    } finally {
      paymentService.getSubscription = originalGetSubscription;
      pricingService.getPlan = originalGetPlan;
    }
  });
}

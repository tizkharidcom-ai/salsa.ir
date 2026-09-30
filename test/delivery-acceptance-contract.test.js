'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateDeliveryAcceptance } = require('../server/waiter-order-invariants');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const acceptedByRestaurant = (reference = 'accept-policy-0001') => ({
  status: 'accepted',
  source: 'restaurant',
  acceptedAt: new Date().toISOString(),
  acceptedBy: { phone: '09123456789', role: 'manager' },
  reference,
});

test('waiter acceptance validator enforces the canonical actor/source/reference/timestamp contract', () => {
  const order = { fulfillment: 'delivery', deliveryAcceptance: acceptedByRestaurant() };
  assert.deepEqual(validateDeliveryAcceptance(order), {
    ok: true,
    applicable: true,
    reference: order.deliveryAcceptance.reference,
    actorId: '09123456789',
    acceptedAt: order.deliveryAcceptance.acceptedAt,
  });
  assert.equal(validateDeliveryAcceptance({ fulfillment: 'pickup' }).ok, true);

  for (const acceptance of [
    { status: 'accepted' },
    { ...acceptedByRestaurant(), acceptedBy: undefined },
    { ...acceptedByRestaurant(), acceptedBy: { phone: '09123456789', role: 'kitchen' } },
    { ...acceptedByRestaurant(), source: 'platform' },
    { ...acceptedByRestaurant(), reference: 'short' },
    { ...acceptedByRestaurant(), reference: ' accept-policy-0001 ' },
    { ...acceptedByRestaurant(), acceptedAt: 'not-a-time' },
    { ...acceptedByRestaurant(), acceptedAt: new Date(Date.now() + 60_000).toISOString() },
  ]) {
    assert.equal(validateDeliveryAcceptance({ fulfillment: 'delivery', deliveryAcceptance: acceptance }).ok, false);
  }

  assert.equal(validateDeliveryAcceptance({
    fulfillment: 'delivery',
    deliveryAcceptance: { status: 'accepted' },
    provenance: { deliveryAcceptance: acceptedByRestaurant() },
  }).ok, false, 'a parallel provenance object cannot substitute for the persisted event');

  const lateAcceptance = acceptedByRestaurant('accept-policy-0002');
  const earlierKitchenStart = new Date(Date.parse(lateAcceptance.acceptedAt) - 1).toISOString();
  assert.equal(validateDeliveryAcceptance({
    fulfillment: 'delivery', status: 'preparing', startedAt: earlierKitchenStart,
    deliveryAcceptance: lateAcceptance,
  }).ok, false, 'restaurant acceptance must predate kitchen handoff');
});

test('restaurant acceptance route validates provenance and idempotency key before replay success', () => {
  const start = server.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const end = server.indexOf("app.patch('/api/admin/orders/:id'", start);
  assert.ok(start >= 0 && end > start, 'acceptance route must precede general order status routes');
  const route = server.slice(start, end);
  assert.match(route, /requireCapability\('delivery\.manage'\)/);
  assert.match(route, /assertUserBranchAccess\(req\.user, initialBranchId\)/);

  const retryStart = route.indexOf("if (order.deliveryAcceptance?.status === 'accepted')");
  const idempotentReply = 'return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });';
  const retryEnd = route.indexOf(idempotentReply, retryStart);
  const retry = route.slice(retryStart, retryEnd + idempotentReply.length);
  assert.match(retry, /validateDeliveryAcceptance\(order\)/);
  assert.match(retry, /if \(!acceptance\.ok\)[\s\S]*delivery_acceptance_provenance_invalid/);
  assert.match(retry, /acceptance\.reference !== idempotencyKey/);
  assert.ok(retry.indexOf('validateDeliveryAcceptance(order)') < retry.indexOf(idempotentReply));

  assert.match(route, /delivery_acceptance_idempotency_conflict/);
  assert.match(route, /delivery_acceptance_idempotency_required/);
  assert.match(route, /delivery_acceptance_after_kitchen_start/);
  assert.match(route, /recordAudit\(req, 'delivery\.order_accepted'/);
  assert.match(route, /persistFinanceMutation\(snapshot\)/);
});

test('route and waiter use the same canonical acceptance validator and persisted event shape', () => {
  const start = server.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const route = server.slice(start, server.indexOf("app.patch('/api/admin/orders/:id'", start));
  assert.match(server.slice(0, start), /validateDeliveryAcceptance,[\s\S]{0,220}isKitchenOrderPaymentEligible/);
  assert.match(route, /const deliveryAcceptance = \{\s*status: 'accepted'/);
  assert.match(route, /acceptedBy: \{ phone: String\(req\.user\.phone \|\| ''\), role: effectiveRole\(req\.user\) \}/);
  assert.match(route, /source: 'restaurant'/);
  assert.match(route, /reference,/);
  assert.match(route, /acceptedAt,/);
  assert.match(route, /validateDeliveryAcceptance\(\{ fulfillment: 'delivery', deliveryAcceptance \}\)/);
});

test('synthetic acceptance review tickets contain only kitchen blocker fields', () => {
  const start = server.indexOf("app.get('/api/kitchen/orders'");
  const end = server.indexOf("app.patch('/api/kitchen/orders/:id'", start);
  const route = server.slice(start, end);
  const reviewStart = route.indexOf('const acceptanceReviewTickets');
  const reviewEnd = route.indexOf('const cancellationCutoff', reviewStart);
  const reviewMapper = route.slice(reviewStart, reviewEnd);
  assert.match(reviewMapper, /id: order\.id,[\s\S]{0,160}branchId: order\.branchId/);
  assert.match(reviewMapper, /status: order\.status/);
  assert.match(reviewMapper, /fulfillment: 'delivery'/);
  assert.match(reviewMapper, /paymentStatus: paymentStatusFor\(order\)/);
  assert.match(reviewMapper, /deliveryAcceptance: \{\s*status: String\(order\.deliveryAcceptance\?\.status \|\| 'pending'\)/);
  assert.doesNotMatch(reviewMapper, /order\.deliveryAcceptance \|\||acceptedBy|acceptedAt|reference|phone|address|name|items|note/);
});

test('platform operator identities cannot be promoted or authenticated as tenant owners', () => {
  const migrationStart = server.indexOf('function migrateDb(data)');
  const migrationEnd = server.indexOf('const defaultDb = loadDb()', migrationStart);
  const migration = server.slice(migrationStart, migrationEnd);
  assert.match(migration, /filter\(\(phone\) => phone && !PLATFORM_ONLY_PHONE_IDENTITIES\.has\(phone\)\)/);
  assert.match(migration, /if \(isPlatformOnlyIdentity\(user\)\) user\.role = 'guest'/);
  assert.doesNotMatch(migration, /superAdmin\.role = 'owner'|09374333028/);

  const roleStart = server.indexOf('function effectiveRole(user)');
  const roleEnd = server.indexOf('function requireAuth', roleStart);
  const roleFunctions = server.slice(roleStart, roleEnd);
  assert.match(roleFunctions, /isPlatformOnlyIdentity\(user\)/);
  assert.doesNotMatch(roleFunctions, /09374333028|09120000000/);

  const verifyStart = server.indexOf("app.post('/api/auth/verify-otp'");
  const verifyEnd = server.indexOf("app.get('/api/auth/me'", verifyStart);
  const verifyRoute = server.slice(verifyStart, verifyEnd);
  assert.match(verifyRoute, /PLATFORM_ONLY_PHONE_IDENTITIES\.has\(phone\)[\s\S]*separate_platform_account_required/);
  assert.match(verifyRoute, /principalType === 'platform_admin'/);
  assert.match(server, /if \(!user \|\| user\.blocked \|\| isPlatformOnlyIdentity\(user\)\) return null/);

  const settingsStart = server.indexOf("app.put('/api/admin/settings'");
  const settingsEnd = server.indexOf('/* ---- Loyalty club ---- */', settingsStart);
  const settingsRoute = server.slice(settingsStart, settingsEnd);
  assert.match(settingsRoute, /PLATFORM_ONLY_PHONE_IDENTITIES\.has\(phone\)/);
  assert.match(settingsRoute, /platform_identity_cannot_be_tenant_owner/);
});

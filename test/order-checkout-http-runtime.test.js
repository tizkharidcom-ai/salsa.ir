'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

function waitForReady(child, diagnostics, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`isolated checkout server startup timed out\n${diagnostics()}`)), timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      reject(new Error(`isolated checkout server exited before readiness (code=${code}, signal=${signal})\n${diagnostics()}`));
    };
    const onMessage = (message) => {
      if (message?.type === 'ready' && Number.isSafeInteger(message.port) && message.port > 0) {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('exit', onExit);
        resolve(message.port);
      } else if (message?.type === 'startup-error') {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('exit', onExit);
        const error = new Error(`isolated checkout server failed to start: ${message.message}\n${diagnostics()}`);
        error.code = message.code;
        reject(error);
      }
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', (error) => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      reject(error);
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function jsonRequest(baseUrl, route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  return { response, payload };
}

function sendChildCommand(child, command) {
  return new Promise((resolve, reject) => {
    const acknowledgment = `${command.type}:ack`;
    const timeout = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`isolated server did not acknowledge ${command.type}`));
    }, 5000);
    const onMessage = (message) => {
      if (message?.type !== acknowledgment) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      resolve(message);
    };
    child.on('message', onMessage);
    child.send(command);
  });
}

test('isolated HTTP guest, waiter, kitchen, and cashier journeys preserve roles, handoffs, idempotency, and ledger persistence', { timeout: 45000 }, async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-checkout-http-'));
  const isolatedDbPath = path.join(temporaryDirectory, 'db.json');
  const isolatedSecretPath = path.join(temporaryDirectory, 'secret.key');
  const productionDbPath = path.resolve(__dirname, '../server/data/db.json');
  const productionDbHash = crypto.createHash('sha256').update(fs.readFileSync(productionDbPath)).digest('hex');
  const currentUtcYear = new Date().getUTCFullYear();
  const ownerPhone = '09121234567';
  const branchManagerPhone = '09122223333';
  const waiterPhone = '09123334444';
  const kitchenPhone = '09124445555';

  const seed = structuredClone(require('../server/seed.js'));
  seed.settings.adminPhones = [ownerPhone];
  seed.users = (Array.isArray(seed.users) ? seed.users : []).filter((user) =>
    ![branchManagerPhone, waiterPhone, kitchenPhone].includes(user.phone));
  seed.users.push({
    phone: branchManagerPhone, name: 'مدیر شعبهٔ آزمون', role: 'manager',
    allowedBranchIds: [702], blocked: false,
  }, {
    phone: waiterPhone, name: 'ویتر آزمون', role: 'waiter',
    allowedBranchIds: [701], blocked: false,
  }, {
    phone: kitchenPhone, name: 'آشپز آزمون', role: 'kitchen',
    allowedBranchIds: [701], blocked: false,
  });
  seed.restaurant = { name: 'Checkout Integration Fixture', slug: 'checkout-http-test' };
  seed.tenantIdentity = { tenantId: 'checkout-http-test' };
  seed.branches = [
    { id: 701, slug: 'checkout-test', name: 'شعبه آزمون ۱', active: true, address: 'محیط آزمون' },
    { id: 702, slug: 'checkout-test-2', name: 'شعبه آزمون ۲', active: true, address: 'محیط آزمون' },
  ];
  seed.tables = [
    { id: 1701, label: 'میز آزمون', seats: 2, active: true, branchId: 701 },
    { id: 1702, label: 'میز آزمون', seats: 2, active: true, branchId: 702 },
  ];
  seed.menuCategories = [{ id: 7701, name: 'آزمون سفارش', active: true }];
  seed.menuItems = [{
    id: 8701, categoryId: 7701, name: 'غذای آزمون', price: 125000, available: true,
    featured: false, allergens: [], dayparts: ['all'], stock: 5, modifierGroups: [],
  }];
  seed.menuComplements = [];
  seed.menuComplementRules = [];
  seed.accounting = { ...(seed.accounting || {}), taxSettings: {
    defaultCategory: 'checkout-http-fixture',
    deliveryFeeTaxCategory: 'checkout-http-fixture',
    categories: [{ code: 'checkout-http-fixture', name: 'آزمون', exempt: false }],
    rules: [701, 702].map((branchId) => ({
      id: `checkout-http-${branchId}`, code: `CHECKOUT_HTTP_${branchId}`,
      taxCategory: 'checkout-http-fixture', rate: 0.1, status: 'active', version: 1,
      inclusive: true, locationId: branchId, fulfillmentType: null,
      effectiveFrom: `${currentUtcYear}-01-01`, effectiveTo: null,
      legalSource: 'test fixture only; not a production tax source',
    })),
  } };
  seed.deliveryZones = [{
    id: 9701, branchId: 701, name: 'منطقهٔ آزمون', active: true,
    minOrder: 0, fee: 15000, etaMinutes: 35,
  }];
  seed.orders = [];
  seed.paymentAttempts = [];
  seed.checkoutIdempotency = {};
  seed.paymentProvider = { mode: 'sandbox', provider: 'sandbox', enabled: true };
  seed.financeV2 = {
    schemaVersion: 2,
    mode: 'shadow',
    settings: { requireOpenPeriod: true },
    fiscalPeriods: [{
      id: 'checkout-http-test-period',
      name: 'دورهٔ باز آزمون',
      startDate: `${currentUtcYear}-01-01`,
      endDate: `${currentUtcYear}-12-31`,
      branchId: 701,
      status: 'open',
    }],
  };
  fs.writeFileSync(isolatedDbPath, JSON.stringify(seed), { mode: 0o600 });
  fs.writeFileSync(isolatedSecretPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });

  const serverPath = path.resolve(__dirname, '../server/server.js');
  const bootstrap = `
    const service = require(${JSON.stringify(serverPath)});
    process.on('message', (command) => {
      if (command?.type === 'set-payment-provider') {
        service.db.paymentProvider = command.config;
        process.send({ type: 'set-payment-provider:ack' });
      }
      if (command?.type === 'fail-next-durable-write') {
        service.stateStore.enabled = true;
        let shouldFail = true;
        service.stateStore.write = async () => {
          if (shouldFail) { shouldFail = false; return false; }
          return true;
        };
        process.send({ type: 'fail-next-durable-write:ack' });
      }
      if (command?.type === 'corrupt-ready-kds') {
        const order = service.db.orders.find((entry) => Number(entry.id) === Number(command.orderId));
        if (order) {
          order.status = 'ready';
          order.kds = { ...(order.kds || {}), itemStates: {} };
        }
        process.send({ type: 'corrupt-ready-kds:ack', found: Boolean(order) });
      }
    });
    service.startServer()
      .then((server) => process.send({ type: 'ready', port: server.address().port }))
      .catch((error) => {
        console.error(error);
        process.send({ type: 'startup-error', message: error.message, code: error.code });
        process.exit(1);
      });
  `;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      OTP_DEMO_MODE: 'true',
      HOST: '127.0.0.1',
      PORT: '0',
      WESTO_DB_PATH: isolatedDbPath,
      WESTO_SECRET_PATH: isolatedSecretPath,
      WESTO_ALLOW_TEST_DB_WRITE: 'true',
      WESTO_POSTGRES_REQUIRED: 'false',
      DATABASE_URL: '',
      SALSA_CONTROL_DATABASE_URL: '',
      NEEM_CONTROL_DATABASE_URL: '',
      SALSA_TENANT_DB_POSTGRES_URL: '',
      NEEM_TENANT_DB_POSTGRES_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-12000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
  const diagnostics = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
  t.after(async () => {
    await stopChild(child);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  let port;
  try {
    port = await waitForReady(child, diagnostics);
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('The sandbox denies local loopback sockets; run this isolated HTTP acceptance test with local-network permission.');
      return;
    }
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  const meta = await jsonRequest(baseUrl, '/api/checkout/meta');
  assert.equal(meta.response.status, 200);
  assert.equal(meta.payload.payment.onlineEnabled, true);
  assert.deepEqual(meta.payload.branches.map((branch) => branch.id), [701, 702]);

  const menu = await jsonRequest(baseUrl, '/api/menu?branchId=701');
  assert.equal(menu.response.status, 200);
  assert.deepEqual(menu.payload.menuItems.map((item) => item.id), [8701]);

  const invalidFulfillment = await jsonRequest(baseUrl, '/api/checkout/quote', {
    method: 'POST', body: { branchId: 701, fulfillment: 'delivery-ish', paymentMethod: 'cashier', items: [{ menuItemId: 8701, qty: 1 }] },
  });
  assert.equal(invalidFulfillment.response.status, 400);
  assert.equal(invalidFulfillment.payload.code, 'fulfillment_invalid');

  const invalidPaymentMethod = await jsonRequest(baseUrl, '/api/checkout/quote', {
    method: 'POST', body: { branchId: 701, fulfillment: 'pickup', paymentMethod: 'cryptocurrency', items: [{ menuItemId: 8701, qty: 1 }] },
  });
  assert.equal(invalidPaymentMethod.response.status, 400);
  assert.equal(invalidPaymentMethod.payload.code, 'payment_method_invalid');

  await sendChildCommand(child, { type: 'set-payment-provider', config: { mode: 'live', provider: 'gateway-unwired', enabled: true } });
  const unavailableLiveQuote = await jsonRequest(baseUrl, '/api/checkout/quote', {
    method: 'POST', body: {
      branchId: 701, fulfillment: 'pickup', paymentMethod: 'online', phone: '09123456789',
      items: [{ menuItemId: 8701, qty: 1, modifiers: [], complements: [] }],
    },
  });
  assert.equal(unavailableLiveQuote.response.status, 503);
  assert.equal(unavailableLiveQuote.payload.error, 'payment_provider_not_ready');
  await sendChildCommand(child, { type: 'set-payment-provider', config: { mode: 'sandbox', provider: 'sandbox', enabled: true } });

  const orderIntent = {
    branchId: 701,
    fulfillment: 'pickup',
    paymentMethod: 'online',
    phone: '09123456789',
    name: 'مهمان آزمون',
    items: [{ menuItemId: 8701, qty: 1, modifiers: [], complements: [] }],
  };
  const quoteResult = await jsonRequest(baseUrl, '/api/checkout/quote', { method: 'POST', body: orderIntent });
  assert.equal(quoteResult.response.status, 200, JSON.stringify(quoteResult.payload));
  assert.equal(quoteResult.payload.subtotal, 125000);
  assert.equal(quoteResult.payload.total, quoteResult.payload.subtotal - quoteResult.payload.discount);
  assert.equal(quoteResult.payload.branchId, 701);
  assert.equal(quoteResult.payload.tax.inclusive, true);
  assert.ok(Number.isSafeInteger(quoteResult.payload.tax.totalTaxIrr));

  const duplicateTableQuote = await jsonRequest(baseUrl, '/api/checkout/quote', {
    method: 'POST',
    body: {
      ...orderIntent,
      branchId: 702,
      fulfillment: 'dine_in',
      tableNo: 'میز آزمون',
      paymentMethod: 'cashier',
    },
  });
  assert.equal(duplicateTableQuote.response.status, 200, JSON.stringify(duplicateTableQuote.payload));
  assert.equal(duplicateTableQuote.payload.branchId, 702);

  const idempotencyKey = '0123456789abcdef0123456789abcdef';
  const idempotencyHash = crypto.createHmac('sha256', fs.readFileSync(isolatedSecretPath, 'utf8').trim())
    .update(`westo:guest-checkout-receipt:v1:${idempotencyKey}`)
    .digest('hex');
  const submitBody = { ...orderIntent, quoteToken: quoteResult.payload.quoteToken };
  const emptyGuestName = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST',
    body: { ...submitBody, name: '   ' },
    headers: { 'Idempotency-Key': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  });
  assert.equal(emptyGuestName.response.status, 400);
  assert.equal(emptyGuestName.payload.code, 'name_required');
  assert.equal(JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8')).orders.length, 0,
    'a public guest order without recipient name must not be persisted');
  const invalidOrderSelection = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST',
    body: { ...submitBody, paymentMethod: 'cryptocurrency' },
    headers: { 'Idempotency-Key': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(invalidOrderSelection.response.status, 400);
  assert.equal(invalidOrderSelection.payload.code, 'payment_method_invalid');

  const wrongBranchReplay = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST',
    body: { ...submitBody, branchId: 702 },
    headers: { 'Idempotency-Key': 'cccccccccccccccccccccccccccccccc' },
  });
  assert.equal(wrongBranchReplay.response.status, 409);
  assert.equal(wrongBranchReplay.payload.code, 'checkout_quote_stale');

  await sendChildCommand(child, { type: 'fail-next-durable-write' });
  const failedCommit = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST', body: submitBody, headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(failedCommit.response.status, 503);
  assert.equal(failedCommit.payload.error, 'persistence_unconfirmed');
  const afterRollback = JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8'));
  assert.equal(afterRollback.orders.length, 0, 'a failed durable commit must not survive in the JSON snapshot');
  assert.equal(afterRollback.paymentAttempts.length, 0);
  assert.equal(Object.hasOwn(afterRollback.checkoutIdempotency, idempotencyHash), false);
  assert.equal(afterRollback.menuItems.find((item) => item.id === 8701).stock, 5);

  const submitted = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST', body: submitBody, headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
  assert.deepEqual(Object.keys(submitted.payload.order).sort(), ['fulfillment', 'id', 'orderNo', 'paymentStatus', 'status', 'tax', 'total']);
  assert.equal(submitted.payload.order.phone, undefined);
  assert.equal(submitted.payload.order.name, undefined);
  assert.equal(submitted.payload.order.items, undefined);
  assert.equal(submitted.payload.order.statusHistory, undefined);
  assert.equal(submitted.payload.order.total, quoteResult.payload.total);
  assert.equal(submitted.payload.order.tax.inclusive, true);
  assert.equal(submitted.payload.order.tax.totalTaxIrr, quoteResult.payload.tax.totalTaxIrr);
  assert.equal(submitted.payload.order.paymentStatus, 'pending');
  assert.equal(submitted.payload.payment.status, 'pending');
  assert.ok(submitted.payload.payment.sandboxToken);

  const replay = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST', body: submitBody, headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.idempotent, true);
  assert.equal(replay.payload.order.id, submitted.payload.order.id);
  assert.equal(replay.payload.payment.id, submitted.payload.payment.id);

  const malformedRecovery = await jsonRequest(baseUrl, '/api/checkout/recovery', {
    method: 'POST', body: { receiptCode: 'not-a-receipt-code' },
  });
  assert.equal(malformedRecovery.response.status, 400);
  const recovered = await jsonRequest(baseUrl, '/api/checkout/recovery', {
    method: 'POST', body: { receiptCode: idempotencyKey },
  });
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.payload));
  assert.deepEqual(Object.keys(recovered.payload.order).sort(), ['fulfillment', 'id', 'orderNo', 'paymentStatus', 'status', 'tax', 'total']);
  assert.equal(recovered.payload.order.tax.totalTaxIrr, submitted.payload.order.tax.totalTaxIrr);
  for (const forbidden of ['name', 'phone', 'address', 'notes', 'note', 'paymentReference', 'paymentAttemptId', 'sandboxToken']) {
    assert.equal(Object.hasOwn(recovered.payload.order, forbidden), false, `recovery response must not expose ${forbidden}`);
  }
  assert.equal(JSON.stringify(recovered.payload).includes(idempotencyKey), false, 'the server must not echo the bearer code');
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8')).checkoutIdempotency, idempotencyHash), true,
    'only the server-derived HMAC key is persisted');
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8'))).includes(idempotencyKey), false,
    'the raw receipt code must not appear in the durable fixture');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const missing = await jsonRequest(baseUrl, '/api/checkout/recovery', {
      method: 'POST', body: { receiptCode: 'ffffffffffffffffffffffffffffffff' },
    });
    assert.equal(missing.response.status, 404, `unknown receipt ${attempt + 1} remains generic`);
  }
  const rateLimitedRecovery = await jsonRequest(baseUrl, '/api/checkout/recovery', {
    method: 'POST', body: { receiptCode: 'ffffffffffffffffffffffffffffffff' },
  });
  assert.equal(rateLimitedRecovery.response.status, 429, 'malformed and lookup attempts share the recovery abuse guard');

  const rejectedToken = await jsonRequest(baseUrl, `/api/checkout/payments/${submitted.payload.payment.id}/sandbox-confirm`, {
    method: 'POST', body: { token: 'not-the-issued-token' },
  });
  assert.equal(rejectedToken.response.status, 403);
  assert.equal(rejectedToken.payload.error, 'payment_token_invalid');

  const omittedStatus = await jsonRequest(baseUrl, `/api/checkout/payments/${submitted.payload.payment.id}/sandbox-confirm`, {
    method: 'POST', body: { token: submitted.payload.payment.sandboxToken },
  });
  assert.equal(omittedStatus.response.status, 400);
  assert.equal(omittedStatus.payload.error, 'payment_status_required');

  const invalidStatus = await jsonRequest(baseUrl, `/api/checkout/payments/${submitted.payload.payment.id}/sandbox-confirm`, {
    method: 'POST', body: { token: submitted.payload.payment.sandboxToken, status: 'mystery' },
  });
  assert.equal(invalidStatus.response.status, 400);
  assert.equal(invalidStatus.payload.error, 'payment_status_invalid');

  const omittedWebhookStatus = await jsonRequest(baseUrl, '/api/payments/webhook/sandbox', {
    method: 'POST', body: {
      paymentAttemptId: submitted.payload.payment.id,
      token: submitted.payload.payment.sandboxToken,
      amount: submitted.payload.payment.amount,
    },
  });
  assert.equal(omittedWebhookStatus.response.status, 400);
  assert.equal(omittedWebhookStatus.payload.error, 'payment_status_required');

  const confirmation = await jsonRequest(baseUrl, `/api/checkout/payments/${submitted.payload.payment.id}/sandbox-confirm`, {
    method: 'POST', body: { token: submitted.payload.payment.sandboxToken, status: 'paid' },
  });
  assert.equal(confirmation.response.status, 200, JSON.stringify(confirmation.payload));
  assert.equal(confirmation.payload.payment.status, 'paid');
  assert.equal(confirmation.payload.order.paymentStatus, 'paid');
  assert.equal(confirmation.payload.order.phone, undefined);
  assert.equal(confirmation.payload.order.statusHistory, undefined);

  const duplicateConfirmation = await jsonRequest(baseUrl, `/api/checkout/payments/${submitted.payload.payment.id}/sandbox-confirm`, {
    method: 'POST', body: { token: submitted.payload.payment.sandboxToken, status: 'paid' },
  });
  assert.equal(duplicateConfirmation.response.status, 200);
  assert.equal(duplicateConfirmation.payload.idempotent, true);

  // Exercise the operator journey over real HTTP using only the disposable
  // JSON snapshot above: guest delivery checkout -> restaurant acceptance ->
  // KDS eligibility -> split cash/manual-card settlement.
  const otpRequested = await jsonRequest(baseUrl, '/api/auth/request-otp', {
    method: 'POST', body: { phone: ownerPhone },
  });
  assert.equal(otpRequested.response.status, 200, JSON.stringify(otpRequested.payload));
  assert.equal(otpRequested.payload.demo, true);
  const ownerLogin = await jsonRequest(baseUrl, '/api/auth/verify-otp', {
    method: 'POST', body: { phone: ownerPhone, code: otpRequested.payload.code },
  });
  assert.equal(ownerLogin.response.status, 200, JSON.stringify(ownerLogin.payload));
  const ownerHeaders = { Authorization: `Bearer ${ownerLogin.payload.token}` };
  const loginStaff = async (phone) => {
    const requested = await jsonRequest(baseUrl, '/api/auth/request-otp', {
      method: 'POST', body: { phone },
    });
    assert.equal(requested.response.status, 200, JSON.stringify(requested.payload));
    const verified = await jsonRequest(baseUrl, '/api/auth/verify-otp', {
      method: 'POST', body: { phone, code: requested.payload.code },
    });
    assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
    return { Authorization: `Bearer ${verified.payload.token}` };
  };
  const otherBranchHeaders = await loginStaff(branchManagerPhone);
  const waiterHeaders = await loginStaff(waiterPhone);
  const kitchenHeaders = await loginStaff(kitchenPhone);

  const deliveryIntent = {
    branchId: 701,
    fulfillment: 'delivery',
    deliveryZoneId: 9701,
    deliveryAddress: 'نشانی آزمایشی، بدون دادهٔ واقعی',
    paymentMethod: 'cashier',
    phone: '09123456789',
    name: 'مهمان تحویل آزمون',
    items: [{ menuItemId: 8701, qty: 1, modifiers: [], complements: [] }],
  };
  const deliveryQuote = await jsonRequest(baseUrl, '/api/checkout/quote', {
    method: 'POST', body: deliveryIntent,
  });
  assert.equal(deliveryQuote.response.status, 200, JSON.stringify(deliveryQuote.payload));
  assert.equal(deliveryQuote.payload.subtotal, 125000);
  assert.equal(deliveryQuote.payload.deliveryFee, 15000);
  assert.equal(deliveryQuote.payload.total, deliveryQuote.payload.subtotal + deliveryQuote.payload.deliveryFee - deliveryQuote.payload.discount);
  const deliverySubmitted = await jsonRequest(baseUrl, '/api/checkout/orders', {
    method: 'POST',
    body: { ...deliveryIntent, quoteToken: deliveryQuote.payload.quoteToken },
    headers: { 'Idempotency-Key': '11111111111111111111111111111111' },
  });
  assert.equal(deliverySubmitted.response.status, 201, JSON.stringify(deliverySubmitted.payload));
  assert.equal(deliverySubmitted.payload.order.phone, undefined);
  assert.equal(deliverySubmitted.payload.order.name, undefined);
  assert.equal(deliverySubmitted.payload.order.delivery.address, undefined);
  assert.equal(deliverySubmitted.payload.order.delivery.instructions, undefined);
  assert.ok(Number.isSafeInteger(deliverySubmitted.payload.order.delivery.etaMinutes));
  const deliveryOrderId = deliverySubmitted.payload.order.id;
  assert.equal(deliverySubmitted.payload.order.status, 'awaiting_confirmation');
  assert.equal(deliverySubmitted.payload.order.paymentStatus, 'unpaid');

  const crossBranchAcceptance = await jsonRequest(baseUrl, `/api/delivery/orders/${deliveryOrderId}/accept`, {
    method: 'POST', headers: { ...otherBranchHeaders, 'Idempotency-Key': 'http-cross-branch-accept-001' }, body: {},
  });
  assert.equal(crossBranchAcceptance.response.status, 403);
  assert.equal(crossBranchAcceptance.payload.error, 'branch_access_denied');

  const beforeAcceptanceKds = await jsonRequest(baseUrl, '/api/kitchen/orders?branchId=701', {
    headers: ownerHeaders,
  });
  assert.equal(beforeAcceptanceKds.response.status, 200, JSON.stringify(beforeAcceptanceKds.payload));
  assert.equal(beforeAcceptanceKds.payload.tickets.some((ticket) => Number(ticket.id) === Number(deliveryOrderId)), false,
    'unaccepted delivery must not become a kitchen ticket');

  const acceptanceKey = 'http-delivery-acceptance-001';
  const acceptance = await jsonRequest(baseUrl, `/api/delivery/orders/${deliveryOrderId}/accept`, {
    method: 'POST', headers: { ...ownerHeaders, 'Idempotency-Key': acceptanceKey }, body: {},
  });
  assert.equal(acceptance.response.status, 200, JSON.stringify(acceptance.payload));
  assert.equal(acceptance.payload.order.deliveryAcceptance.status, 'accepted');
  assert.equal(acceptance.payload.order.status, 'sent_to_kitchen');
  assert.equal(acceptance.payload.order.paymentStatus, 'unpaid',
    'restaurant acceptance is durable and independent of payment');
  const acceptanceReplay = await jsonRequest(baseUrl, `/api/delivery/orders/${deliveryOrderId}/accept`, {
    method: 'POST', headers: { ...ownerHeaders, 'Idempotency-Key': acceptanceKey }, body: {},
  });
  assert.equal(acceptanceReplay.response.status, 200, JSON.stringify(acceptanceReplay.payload));
  assert.equal(acceptanceReplay.payload.idempotent, true);
  const conflictingAcceptanceReplay = await jsonRequest(baseUrl, `/api/delivery/orders/${deliveryOrderId}/accept`, {
    method: 'POST', headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-acceptance-002' }, body: {},
  });
  assert.equal(conflictingAcceptanceReplay.response.status, 409);
  assert.equal(conflictingAcceptanceReplay.payload.error, 'delivery_acceptance_idempotency_conflict');

  const acceptedKds = await jsonRequest(baseUrl, '/api/kitchen/orders?branchId=701', {
    headers: ownerHeaders,
  });
  assert.equal(acceptedKds.response.status, 200, JSON.stringify(acceptedKds.payload));
  const acceptedTicket = acceptedKds.payload.tickets.find((ticket) => Number(ticket.id) === Number(deliveryOrderId));
  assert.ok(acceptedTicket, 'accepted unpaid delivery must enter the KDS queue');
  assert.equal(acceptedTicket.paymentStatus, 'unpaid');

  const kitchenStarted = await jsonRequest(baseUrl, `/api/kitchen/orders/${deliveryOrderId}?branchId=701`, {
    method: 'PATCH', headers: ownerHeaders, body: { action: 'start_ticket' },
  });
  assert.equal(kitchenStarted.response.status, 200, JSON.stringify(kitchenStarted.payload));
  assert.equal(kitchenStarted.payload.order.status, 'preparing');

  const crossBranchSettlement = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST',
    headers: { ...otherBranchHeaders, 'Idempotency-Key': 'http-cross-branch-cash-001' },
    body: { branchId: 701, tender: 'cash', paymentAmount: 1000, amountTendered: 1000 },
  });
  assert.equal(crossBranchSettlement.response.status, 403);
  assert.equal(crossBranchSettlement.payload.error, 'branch_access_denied');

  const drawerWithoutShift = await jsonRequest(baseUrl, '/api/cashier/drawer/open', {
    method: 'POST', headers: ownerHeaders, body: { branchId: 701, openingAmount: 0 },
  });
  assert.equal(drawerWithoutShift.response.status, 409, JSON.stringify(drawerWithoutShift.payload));
  assert.equal(drawerWithoutShift.payload.error, 'staff_shift_not_open');
  const openedShift = await jsonRequest(baseUrl, '/api/staff/shifts/open', {
    method: 'POST', headers: ownerHeaders, body: { branchId: 701 },
  });
  assert.equal(openedShift.response.status, 201, JSON.stringify(openedShift.payload));
  const drawerOpened = await jsonRequest(baseUrl, '/api/cashier/drawer/open', {
    method: 'POST', headers: ownerHeaders, body: { branchId: 701, openingAmount: 0 },
  });
  assert.equal(drawerOpened.response.status, 201, JSON.stringify(drawerOpened.payload));
  const missingTender = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST', headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-missing-tender-001' },
    body: { branchId: 701, paymentAmount: 1_000, amountTendered: 1_000 },
  });
  assert.equal(missingTender.response.status, 400, JSON.stringify(missingTender.payload));
  assert.equal(missingTender.payload.error, 'settlement_tender_required');
  const orderAfterMissingTender = JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8')).orders
    .find((order) => Number(order.id) === Number(deliveryOrderId));
  assert.equal((Array.isArray(orderAfterMissingTender.partialPayments) ? orderAfterMissingTender.partialPayments : []).length, 0,
    'the server must not invent a cash tender for an incomplete collection request');
  const firstLegAmount = Math.floor(deliverySubmitted.payload.order.total / 2);
  const cashLeg = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST',
    headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-cash-leg-001' },
    body: { branchId: 701, tender: 'cash', paymentAmount: firstLegAmount, amountTendered: firstLegAmount },
  });
  assert.equal(cashLeg.response.status, 200, JSON.stringify(cashLeg.payload));
  assert.equal(cashLeg.payload.order.paymentStatus, 'partial');
  assert.equal(cashLeg.payload.order.status, 'preparing');
  const cashLegReplay = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST',
    headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-cash-leg-001' },
    body: { branchId: 701, tender: 'cash', paymentAmount: firstLegAmount, amountTendered: firstLegAmount },
  });
  assert.equal(cashLegReplay.response.status, 200, JSON.stringify(cashLegReplay.payload));
  assert.equal(cashLegReplay.payload.idempotent, true);
  assert.equal(cashLegReplay.payload.order.partialPayments.length, 1);

  const cardLeg = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST',
    headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-card-leg-001' },
    body: {
      branchId: 701,
      tender: 'manual_card',
      paymentAmount: deliverySubmitted.payload.order.total - firstLegAmount,
      paymentReference: 'CARD-TEST-9701',
    },
  });
  assert.equal(cardLeg.response.status, 200, JSON.stringify(cardLeg.payload));
  assert.equal(cardLeg.payload.order.paymentStatus, 'paid');
  assert.equal(cardLeg.payload.order.amountPaid, deliverySubmitted.payload.order.total);
  assert.deepEqual(cardLeg.payload.order.partialPayments.map((payment) => payment.tender), ['cash', 'manual_card']);
  const cardLegReplay = await jsonRequest(baseUrl, `/api/cashier/orders/${deliveryOrderId}/settle`, {
    method: 'POST',
    headers: { ...ownerHeaders, 'Idempotency-Key': 'http-delivery-card-leg-001' },
    body: {
      branchId: 701,
      tender: 'manual_card',
      paymentAmount: deliverySubmitted.payload.order.total - firstLegAmount,
      paymentReference: 'CARD-TEST-9701',
    },
  });
  assert.equal(cardLegReplay.response.status, 200, JSON.stringify(cardLegReplay.payload));
  assert.equal(cardLegReplay.payload.idempotent, true);
  assert.equal(cardLegReplay.payload.order.partialPayments.length, 2);

  // The dine-in waiter flow uses its own limited capabilities: the waiter
  // creates and sends the ticket, kitchen owns preparation, waiter records
  // table service, and only an allowed non-cash collection may be recorded
  // from the waiter workspace.
  const waiterOrder = await jsonRequest(baseUrl, '/api/staff/orders', {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-order-001' },
    body: {
      branchId: 701,
      fulfillment: 'dine_in',
      tableNo: 'میز آزمون',
      paymentMethod: 'cashier',
      sendToKitchen: true,
      items: [{ menuItemId: 8701, qty: 1, seat: 0, modifiers: [], complements: [] }],
    },
  });
  assert.equal(waiterOrder.response.status, 201, JSON.stringify(waiterOrder.payload));
  const waiterOrderId = waiterOrder.payload.order.id;
  assert.ok(!waiterOrder.payload.order.name, 'staff/POS orders remain allowed to omit a guest recipient name');
  assert.equal(waiterOrder.payload.order.status, 'sent_to_kitchen');
  assert.equal(waiterOrder.payload.order.paymentStatus, 'unpaid');
  const waiterEarlySettlement = await jsonRequest(baseUrl, `/api/staff/orders/${waiterOrderId}/settle`, {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-early-card-001' },
    body: {
      branchId: 701,
      tender: 'manual_card',
      paymentAmount: waiterOrder.payload.order.total,
      paymentReference: 'WAITER-CARD-TOO-EARLY',
    },
  });
  assert.equal(waiterEarlySettlement.response.status, 409, JSON.stringify(waiterEarlySettlement.payload));
  assert.equal(waiterEarlySettlement.payload.error, 'waiter_service_not_complete');
  const waiterOrderBeforeService = JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8')).orders
    .find((order) => Number(order.id) === Number(waiterOrderId));
  assert.equal(Number(waiterOrderBeforeService.amountPaid) || 0, 0);
  assert.equal((Array.isArray(waiterOrderBeforeService.partialPayments) ? waiterOrderBeforeService.partialPayments : []).length, 0,
    'the server-side delivery gate rejects premature waiter collection before any receipt is persisted');
  const waiterKitchenMutation = await jsonRequest(baseUrl, `/api/kitchen/orders/${waiterOrderId}?branchId=701`, {
    method: 'PATCH', headers: waiterHeaders, body: { action: 'start_ticket' },
  });
  assert.equal(waiterKitchenMutation.response.status, 403);
  assert.equal(waiterKitchenMutation.payload.error, 'forbidden');

  const waiterKdsQueue = await jsonRequest(baseUrl, '/api/kitchen/orders?branchId=701', {
    headers: kitchenHeaders,
  });
  assert.equal(waiterKdsQueue.response.status, 200, JSON.stringify(waiterKdsQueue.payload));
  assert.ok(waiterKdsQueue.payload.tickets.some((ticket) => Number(ticket.id) === Number(waiterOrderId)));
  const waiterTicketStarted = await jsonRequest(baseUrl, `/api/kitchen/orders/${waiterOrderId}?branchId=701`, {
    method: 'PATCH', headers: kitchenHeaders, body: { action: 'start_ticket' },
  });
  assert.equal(waiterTicketStarted.response.status, 200, JSON.stringify(waiterTicketStarted.payload));
  const waiterLineKey = waiterTicketStarted.payload.order.items[0].key;
  assert.ok(waiterLineKey);
  const waiterTicketReady = await jsonRequest(baseUrl, `/api/kitchen/orders/${waiterOrderId}?branchId=701`, {
    method: 'PATCH', headers: kitchenHeaders, body: { action: 'complete_item', lineKey: waiterLineKey },
  });
  assert.equal(waiterTicketReady.response.status, 200, JSON.stringify(waiterTicketReady.payload));
  assert.equal(waiterTicketReady.payload.order.status, 'ready');

  let served;
  try {
    served = await jsonRequest(baseUrl, `/api/waiter/orders/${waiterOrderId}/status`, {
      method: 'PATCH', headers: waiterHeaders, body: { status: 'done' },
    });
  } catch (error) {
    throw new Error(`waiter service completion request failed: ${error.message}\n${diagnostics()}`, { cause: error });
  }
  assert.equal(served.response.status, 200, JSON.stringify(served.payload));
  assert.equal(served.payload.order.status, 'done');
  const waiterCashierRoute = await jsonRequest(baseUrl, `/api/cashier/orders/${waiterOrderId}/settle`, {
    method: 'POST', headers: waiterHeaders, body: { branchId: 701, tender: 'manual_card' },
  });
  assert.equal(waiterCashierRoute.response.status, 403);
  assert.equal(waiterCashierRoute.payload.error, 'forbidden');
  const waiterCashCollection = await jsonRequest(baseUrl, `/api/staff/orders/${waiterOrderId}/settle`, {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-cash-001' },
    body: { branchId: 701, tender: 'cash', paymentAmount: waiterOrder.payload.order.total, amountTendered: waiterOrder.payload.order.total },
  });
  assert.equal(waiterCashCollection.response.status, 403);
  assert.equal(waiterCashCollection.payload.error, 'cash_collection_forbidden');
  const waiterCardWithoutReference = await jsonRequest(baseUrl, `/api/staff/orders/${waiterOrderId}/settle`, {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-card-missing-ref-001' },
    body: { branchId: 701, tender: 'manual_card', paymentAmount: waiterOrder.payload.order.total },
  });
  assert.equal(waiterCardWithoutReference.response.status, 400);
  assert.equal(waiterCardWithoutReference.payload.error, 'settlement_reference_required');
  const waiterCardSettlement = await jsonRequest(baseUrl, `/api/staff/orders/${waiterOrderId}/settle`, {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-card-leg-001' },
    body: {
      branchId: 701,
      tender: 'manual_card',
      paymentAmount: waiterOrder.payload.order.total,
      paymentReference: 'WAITER-CARD-TEST-1',
    },
  });
  assert.equal(waiterCardSettlement.response.status, 200, JSON.stringify(waiterCardSettlement.payload));
  assert.equal(waiterCardSettlement.payload.order.paymentStatus, 'paid');
  assert.equal(waiterCardSettlement.payload.order.status, 'done');
  assert.equal(waiterCardSettlement.payload.order.partialPayments[0].tender, 'manual_card');
  const waiterCardReplay = await jsonRequest(baseUrl, `/api/staff/orders/${waiterOrderId}/settle`, {
    method: 'POST',
    headers: { ...waiterHeaders, 'Idempotency-Key': 'http-waiter-card-leg-001' },
    body: {
      branchId: 701,
      tender: 'manual_card',
      paymentAmount: waiterOrder.payload.order.total,
      paymentReference: 'WAITER-CARD-TEST-1',
    },
  });
  assert.equal(waiterCardReplay.response.status, 200, JSON.stringify(waiterCardReplay.payload));
  assert.equal(waiterCardReplay.payload.idempotent, true);
  assert.equal(waiterCardReplay.payload.order.partialPayments.length, 1);

  const persisted = JSON.parse(fs.readFileSync(isolatedDbPath, 'utf8'));
  assert.equal(persisted.orders.length, 3);
  const persistedGuestOrder = persisted.orders.find((order) => Number(order.id) === Number(submitted.payload.order.id));
  assert.equal(persistedGuestOrder.paymentStatus, 'paid');
  assert.equal(persistedGuestOrder.taxSnapshot.totalTaxIrr, submitted.payload.order.tax.totalTaxIrr);
  const persistedDeliveryOrder = persisted.orders.find((order) => Number(order.id) === Number(deliveryOrderId));
  assert.equal(persistedDeliveryOrder.paymentStatus, 'paid');
  assert.equal(persistedDeliveryOrder.deliveryAcceptance.status, 'accepted');
  assert.deepEqual(persistedDeliveryOrder.partialPayments.map((payment) => payment.tender), ['cash', 'manual_card']);
  const persistedWaiterOrder = persisted.orders.find((order) => Number(order.id) === Number(waiterOrderId));
  assert.equal(persistedWaiterOrder.status, 'done');
  assert.equal(persistedWaiterOrder.paymentStatus, 'paid');
  assert.equal(persistedWaiterOrder.partialPayments[0].tender, 'manual_card');
  assert.equal(persisted.paymentAttempts.length, 1);
  assert.equal(persisted.paymentAttempts[0].status, 'paid');
  assert.equal(Object.keys(persisted.checkoutIdempotency).length, 3);
  assert.equal(persisted.financeV2.journalEntries.filter((entry) => entry.sourceId === String(submitted.payload.order.id) && entry.status === 'posted').length, 1);
  assert.equal(persisted.financeV2.journalEntries.filter((entry) => entry.sourceId === String(deliveryOrderId) && entry.status === 'posted').length, 1);
  assert.equal(persisted.financeV2.journalEntries.filter((entry) => entry.sourceId === String(waiterOrderId) && entry.status === 'posted').length, 1);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(productionDbPath)).digest('hex'), productionDbHash,
    'the isolated HTTP journey must not mutate the operator checkout database');

  const corruptKds = await sendChildCommand(child, { type: 'corrupt-ready-kds', orderId: waiterOrderId });
  assert.equal(corruptKds.found, true);
  const invalidReadyReplay = await jsonRequest(baseUrl, `/api/kitchen/orders/${waiterOrderId}?branchId=701`, {
    method: 'PATCH', headers: kitchenHeaders, body: { action: 'complete_ticket' },
  });
  assert.equal(invalidReadyReplay.response.status, 409, JSON.stringify(invalidReadyReplay.payload));
  assert.equal(invalidReadyReplay.payload.error, 'kds_ticket_incomplete');
  assert.ok(invalidReadyReplay.payload.incomplete.length > 0,
    'the live KDS route must not acknowledge a ready snapshot with missing item completion');
});

'use strict';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const router = require('../server/salsa/control-plane/routes/automation-routes');
const outboxWorker = require('../server/salsa/control-plane/automation/outbox-worker');
const auditService = require('../server/salsa/control-plane/audit/audit-service');

const flushRoute = router.stack.find(layer => layer.route
  && Array.isArray(layer.route.path)
  && layer.route.path.includes('/events/flush'));
assert.ok(flushRoute, 'canonical outbox flush route is registered');
const flushHandler = flushRoute.route.stack.at(-1).handle;
const tickRoute = router.stack.find(layer => layer.route && layer.route.path === '/tick');
assert.ok(tickRoute, 'manual outbox tick route is registered');
const tickHandler = tickRoute.route.stack.at(-1).handle;

async function invokeRoute(handler, { batchSize = '3', workerId = 'test-flush' } = {}) {
  let responseBody;
  let responseStatus = 200;
  const response = {
    status(status) { responseStatus = status; return this; },
    json(body) { responseBody = body; return this; }
  };
  await handler({
    body: { batchSize, workerId },
    platformPrincipal: { id: 'platform-operator-test', role: 'platform_operations' }
  }, response);
  return { body: responseBody, statusCode: responseStatus };
}

test('outbox flush API and audit report delivered, failed, partial, retryable, and pending outcomes truthfully', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  const originalRecordEvent = auditService.recordEvent;
  let workerResult;
  let workerArguments;
  let queueRows = [];
  let queueQuery;
  const auditEvents = [];

  outboxWorker.processBatch = async args => {
    workerArguments = args;
    return workerResult;
  };
  outboxWorker.db = {
    async query(sql, params) {
      queueQuery = { sql, params };
      return { rows: queueRows };
    }
  };
  auditService.recordEvent = async event => {
    auditEvents.push(event);
    return { id: `audit-${auditEvents.length}` };
  };
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
    auditService.recordEvent = originalRecordEvent;
  });

  const cases = [
    {
      name: 'all acknowledged',
      result: {
        batchProcessedCount: 2,
        processed: [{ status: 'acknowledged' }, { status: 'acknowledged_deduped' }]
      },
      status: 'succeeded', ok: true, processedCount: 2, succeededCount: 2, failedCount: 0, retryableCount: 0
    },
    {
      name: 'mixed acknowledged and scheduled retry',
      result: {
        batchProcessedCount: 2,
        processed: [{ status: 'acknowledged' }, { status: 'retry_scheduled' }]
      },
      status: 'partial', ok: false, processedCount: 2, succeededCount: 1, failedCount: 1, retryableCount: 1
    },
    {
      name: 'retryable work with no acknowledged delivery',
      result: { batchProcessedCount: 1, processed: [{ status: 'retry_scheduled' }] },
      status: 'retryable', ok: false, processedCount: 1, succeededCount: 0, failedCount: 1, retryableCount: 1
    },
    {
      name: 'dead-letter failure',
      result: { batchProcessedCount: 1, processed: [{ status: 'dead_letter' }] },
      status: 'failed', ok: false, processedCount: 1, succeededCount: 0, failedCount: 1, retryableCount: 0
    },
    {
      name: 'legacy aggregate reports failures and retryable work',
      result: { processedCount: 4, failedCount: 2, retryableCount: 1 },
      status: 'partial', ok: false, processedCount: 4, succeededCount: 2, failedCount: 2, retryableCount: 1
    },
    {
      name: 'worker-reported partial status is never promoted to success',
      result: { status: 'partial', batchProcessedCount: 0, processed: [] },
      status: 'partial', ok: false, processedCount: 0, succeededCount: 0, failedCount: 0, retryableCount: 0
    },
    {
      name: 'worker-reported retryable status remains visible without an aggregate count',
      result: { status: 'retryable', processedCount: 1 },
      status: 'retryable', ok: false, processedCount: 1, succeededCount: 0, failedCount: 0, retryableCount: 0,
      hasRetryableWork: true
    },
    {
      name: 'unprocessed backlog',
      result: { batchProcessedCount: 1, processed: [{ status: 'acknowledged' }], remainingCount: 3 },
      status: 'partial', ok: false, processedCount: 1, succeededCount: 1, failedCount: 0, retryableCount: 0
    },
    {
      name: 'unknown per-item outcome fails closed',
      result: { batchProcessedCount: 1, processed: [{ status: 'unexpected_worker_state' }] },
      status: 'unresolved', ok: false, processedCount: 1, succeededCount: 0, failedCount: 0, retryableCount: 0
    },
    {
      name: 'empty batch is explicitly no work, not a delivery success',
      result: { batchProcessedCount: 0, processed: [] },
      status: 'no_work', ok: true, processedCount: 0, succeededCount: 0, failedCount: 0, retryableCount: 0
    }
  ];

  for (const scenario of cases) {
    workerResult = scenario.result;
    queueRows = [];
    const { body, statusCode } = await invokeRoute(flushHandler);
    assert.equal(statusCode, 200, `${scenario.name}: worker outcome is not an HTTP handler exception`);
    assert.equal(workerArguments.batchSize, 3, `${scenario.name}: effective batch size is passed to worker`);
    assert.equal(workerArguments.workerId, 'test-flush');
    assert.equal(body.ok, scenario.ok, `${scenario.name}: top-level API success reflects delivery outcome`);
    assert.equal(body.data.status, scenario.status, `${scenario.name}: status`);
    assert.equal(body.data.fullySucceeded, scenario.status === 'succeeded', `${scenario.name}: full-success flag`);
    assert.equal(body.data.processedCount, scenario.processedCount, `${scenario.name}: processed count`);
    assert.equal(body.data.succeededCount, scenario.succeededCount, `${scenario.name}: acknowledged count`);
    assert.equal(body.data.failedCount, scenario.failedCount, `${scenario.name}: failed count`);
    assert.equal(body.data.retryableCount, scenario.retryableCount, `${scenario.name}: retryable count`);
    assert.equal(body.data.hasRetryableWork, scenario.hasRetryableWork ?? scenario.retryableCount > 0,
      `${scenario.name}: retryable-work flag`);
    assert.equal(body.data.queueDepthAvailable, true);
    assert.equal(body.data.queueDepthExact, true);
    assert.equal(body.data.remainingCount, 0);
    assert.equal(body.data.fullySucceeded, scenario.status === 'succeeded', `${scenario.name}: empty queue full-success flag`);
    assert.match(queueQuery.sql, /^\s*SELECT\s+status\s+FROM\s+neem_automation_outbox/i);
    assert.match(queueQuery.sql, /WHERE\s+status\s+IN\s*\('pending',\s*'processing'\)\s+LIMIT\s+\$1/i);
    assert.deepEqual(queueQuery.params, [501], 'queue-depth read is capped at the sample limit plus one');
    assert.doesNotMatch(queueQuery.sql, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i, 'queue-depth check is read-only');

    const event = auditEvents.at(-1);
    assert.equal(event.action, 'automation.outbox.flush');
    assert.equal(event.metadata.status, body.data.status, `${scenario.name}: audit status matches API`);
    assert.equal(event.metadata.fullySucceeded, body.data.fullySucceeded, `${scenario.name}: audit full-success flag matches API`);
    assert.equal(event.metadata.processedCount, body.data.processedCount);
    assert.equal(event.metadata.succeededCount, body.data.succeededCount);
    assert.equal(event.metadata.failedCount, body.data.failedCount);
    assert.equal(event.metadata.retryableCount, body.data.retryableCount);
    assert.equal(event.metadata.hasRetryableWork, body.data.hasRetryableWork);
    assert.equal(event.metadata.partialDelivery, body.data.partialDelivery);
    assert.equal(event.metadata.batchSize, 3);
    assert.equal(event.metadata.queueDepthAvailable, true);
    assert.equal(event.metadata.remainingCount, 0);
  }
});

test('flush remains partial when an acknowledged batch leaves pending and active processing rows', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  const originalRecordEvent = auditService.recordEvent;
  let auditEvent;
  let queryCount = 0;
  outboxWorker.processBatch = async () => ({
    batchProcessedCount: 1,
    processed: [{ status: 'acknowledged' }]
  });
  outboxWorker.db = {
    async query(sql, params) {
      queryCount += 1;
      assert.match(sql, /LIMIT\s+\$1/i);
      assert.deepEqual(params, [501]);
      return { rows: [
        { status: 'pending' },
        { status: 'pending' },
        { status: 'processing' }
      ] };
    }
  };
  auditService.recordEvent = async event => { auditEvent = event; };
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
    auditService.recordEvent = originalRecordEvent;
  });

  const { body } = await invokeRoute(flushHandler);
  assert.equal(queryCount, 1, 'the bounded queue-depth read runs after batch processing');
  assert.equal(body.ok, false);
  assert.equal(body.data.status, 'partial');
  assert.equal(body.data.succeededCount, 1);
  assert.equal(body.data.pendingQueueCount, 2);
  assert.equal(body.data.processingQueueCount, 1);
  assert.equal(body.data.remainingCount, 3);
  assert.equal(body.data.queueDepthAvailable, true);
  assert.equal(body.data.queueDepthExact, true);
  assert.equal(body.data.fullySucceeded, false);
  assert.equal(auditEvent.metadata.status, 'partial');
  assert.equal(auditEvent.metadata.remainingCount, 3);
});

test('flush queue-depth query failure reports unknown rather than full success', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  const originalRecordEvent = auditService.recordEvent;
  outboxWorker.processBatch = async () => ({
    batchProcessedCount: 1,
    processed: [{ status: 'acknowledged' }]
  });
  outboxWorker.db = { async query() { throw new Error('database unavailable'); } };
  auditService.recordEvent = async () => {};
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
    auditService.recordEvent = originalRecordEvent;
  });

  const { body } = await invokeRoute(flushHandler);
  assert.equal(body.ok, false);
  assert.equal(body.data.status, 'unresolved');
  assert.equal(body.data.succeededCount, 1);
  assert.equal(body.data.queueDepthAvailable, false);
  assert.equal(body.data.remainingCount, null);
  assert.equal(body.data.fullySucceeded, false);
});

test('flush caps queue sampling and labels the remaining count as a lower bound', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  const originalRecordEvent = auditService.recordEvent;
  outboxWorker.processBatch = async () => ({
    batchProcessedCount: 1,
    processed: [{ status: 'acknowledged' }]
  });
  outboxWorker.db = { async query(_sql, params) {
    assert.deepEqual(params, [501]);
    return { rows: Array.from({ length: 501 }, (_, index) => ({ status: index % 2 ? 'pending' : 'processing' })) };
  } };
  auditService.recordEvent = async () => {};
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
    auditService.recordEvent = originalRecordEvent;
  });

  const { body } = await invokeRoute(flushHandler);
  assert.equal(body.ok, false);
  assert.equal(body.data.status, 'partial');
  assert.equal(body.data.remainingCount, 500);
  assert.equal(body.data.queueDepthAvailable, true);
  assert.equal(body.data.queueDepthExact, false);
  assert.equal(body.data.queueDepthCapped, true);
  assert.equal(body.data.remainingCountIsLowerBound, true);
  assert.equal(body.data.fullySucceeded, false);
});

test('audit failure does not turn a retrying outbox batch into a successful delivery', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  const originalRecordEvent = auditService.recordEvent;
  outboxWorker.processBatch = async () => ({
    batchProcessedCount: 1,
    processed: [{ status: 'retry_scheduled' }]
  });
  outboxWorker.db = { async query() { return { rows: [] }; } };
  auditService.recordEvent = async () => { throw new Error('audit unavailable'); };
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
    auditService.recordEvent = originalRecordEvent;
  });

  const { body } = await invokeRoute(flushHandler);
  assert.equal(body.ok, false);
  assert.equal(body.data.status, 'retryable');
  assert.equal(body.data.failedCount, 1);
  assert.equal(body.data.retryableCount, 1);
  assert.equal(body.data.fullySucceeded, false);
});

test('manual /tick uses the same truthful outbox outcome contract for retry, dead-letter, and unresolved work', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  let workerResult;
  let workerArguments;
  let queueDepthQueries = 0;
  let queueRows = [];
  outboxWorker.processBatch = async args => {
    workerArguments = args;
    return workerResult;
  };
  outboxWorker.db = { async query() { queueDepthQueries += 1; return { rows: queueRows }; } };
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
  });

  const cases = [
    {
      name: 'retry scheduled', result: { ok: true, batchProcessedCount: 1, workerId: 'worker-a', processed: [{ status: 'retry_scheduled' }] },
      status: 'retryable', failedCount: 1, retryableCount: 1, unresolvedCount: 0
    },
    {
      name: 'dead letter', result: { batchProcessedCount: 1, processed: [{ status: 'dead_letter' }] },
      status: 'failed', failedCount: 1, retryableCount: 0, unresolvedCount: 0
    },
    {
      name: 'superseded lease outcome', result: { batchProcessedCount: 1, processed: [{ status: 'superseded' }] },
      status: 'unresolved', failedCount: 0, retryableCount: 0, unresolvedCount: 1
    },
    {
      name: 'acknowledged batch with queued remainder',
      result: { batchProcessedCount: 1, processed: [{ status: 'acknowledged' }] },
      queueRows: [{ status: 'pending' }, { status: 'processing' }],
      status: 'partial', batchStatus: 'succeeded', failedCount: 0, retryableCount: 0, unresolvedCount: 0
    }
  ];

  for (const scenario of cases) {
    workerResult = scenario.result;
    queueRows = scenario.queueRows || [];
    const { body, statusCode } = await invokeRoute(tickHandler, { batchSize: 4, workerId: 'operator-tick' });
    assert.equal(statusCode, 200, `${scenario.name}: tick executes and reports the worker outcome`);
    assert.equal(workerArguments.batchSize, 4, `${scenario.name}: tick batch size is unchanged`);
    assert.equal(workerArguments.workerId, 'operator-tick');
    assert.equal(body.ok, false, `${scenario.name}: failed/unresolved work is not reported as success`);
    assert.equal(body.data.ok, false, `${scenario.name}: nested worker flags cannot override the truthful summary`);
    assert.equal(body.data.status, scenario.status);
    assert.equal(body.data.batchStatus, scenario.batchStatus || scenario.status);
    assert.equal(body.data.fullySucceeded, false);
    assert.equal(body.data.failedCount, scenario.failedCount);
    assert.equal(body.data.retryableCount, scenario.retryableCount);
    assert.equal(body.data.unresolvedCount, scenario.unresolvedCount);
    assert.equal(body.data.queueDepthAvailable, true);
    assert.deepEqual(body.data.processed, scenario.result.processed, 'tick preserves per-item worker details');
  }
  assert.equal(queueDepthQueries, cases.length, '/tick checks queue depth after each batch');
});

test('/tick reports queue depth unknown rather than full success when its adapter read fails', async t => {
  const originalProcessBatch = outboxWorker.processBatch;
  const originalDatabase = outboxWorker.db;
  outboxWorker.processBatch = async () => ({
    batchProcessedCount: 1,
    processed: [{ status: 'acknowledged' }]
  });
  outboxWorker.db = { async query() { throw new Error('database unavailable'); } };
  t.after(() => {
    outboxWorker.processBatch = originalProcessBatch;
    outboxWorker.db = originalDatabase;
  });

  const { body } = await invokeRoute(tickHandler);
  assert.equal(body.ok, false);
  assert.equal(body.data.status, 'unresolved');
  assert.equal(body.data.batchStatus, 'succeeded');
  assert.equal(body.data.queueDepthAvailable, false);
  assert.equal(body.data.remainingCount, null);
  assert.equal(body.data.fullySucceeded, false);
});

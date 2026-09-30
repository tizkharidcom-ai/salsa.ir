// server/salsa/control-plane/routes/automation-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const ruleEngine = require('../automation/rule-engine');
const schedulerService = require('../automation/scheduler-service');
const outboxWorker = require('../automation/outbox-worker');
const syncStateService = require('../automation/sync-state-service');
const auditService = require('../audit/audit-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const { InMemoryTestAdapter } = require('../db/database');

router.use(authenticatePlatform);

const OUTBOX_ACKNOWLEDGED_STATUSES = new Set(['acknowledged', 'acknowledged_deduped', 'delivered', 'succeeded']);
const OUTBOX_RETRYABLE_STATUSES = new Set(['retry_scheduled', 'retryable']);
const OUTBOX_FAILED_STATUSES = new Set(['failed', 'dead_letter', 'rejected']);
const OUTBOX_QUEUE_DEPTH_SAMPLE_LIMIT = 500;

function nonNegativeCount(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function summarizeFlushResult(result) {
  const processed = Array.isArray(result?.processed) ? result.processed : [];
  const statuses = processed.map(item => typeof item?.status === 'string' ? item.status.trim().toLowerCase() : 'unknown');
  const count = (...values) => Math.max(0, ...values.map(nonNegativeCount).filter(value => value !== null));
  const processedCount = count(result?.processedCount, result?.batchProcessedCount, processed.length);
  const failedCount = count(result?.failedCount, statuses.filter(status =>
    OUTBOX_FAILED_STATUSES.has(status) || OUTBOX_RETRYABLE_STATUSES.has(status)).length);
  const retryableCount = count(result?.retryableCount, statuses.filter(status => OUTBOX_RETRYABLE_STATUSES.has(status)).length);
  const acknowledgedCount = statuses.filter(status => OUTBOX_ACKNOWLEDGED_STATUSES.has(status)).length;
  const unknownCount = statuses.filter(status => !OUTBOX_ACKNOWLEDGED_STATUSES.has(status)
    && !OUTBOX_FAILED_STATUSES.has(status) && !OUTBOX_RETRYABLE_STATUSES.has(status) && status !== 'superseded').length;
  const unresolvedCount = count(result?.unresolvedCount, unknownCount, statuses.filter(status => status === 'superseded').length);
  const pendingCount = count(result?.pendingCount, result?.remainingCount, result?.unprocessedCount);
  const workerStatus = String(result?.status || '').trim().toLowerCase();
  const workerReportsFailure = ['failed', 'failure', 'error', 'dead_letter'].includes(workerStatus) || result?.ok === false;
  const hasRetryableWork = retryableCount > 0 || result?.hasRetryableWork === true || result?.retryable === true
    || ['retryable', 'retry_scheduled'].includes(workerStatus);
  const hasPendingWork = pendingCount > 0 || result?.hasMore === true || ['pending', 'queued'].includes(workerStatus);
  const explicitlyPartial = result?.partial === true
    || result?.partialDelivery === true
    || workerStatus === 'partial';
  const knownWorkerStatuses = new Set(['succeeded', 'success', 'completed', 'synced', 'acknowledged', 'no_work', 'idle']);
  const unrecognizedWorkerStatus = Boolean(workerStatus) && !knownWorkerStatuses.has(workerStatus)
    && !workerReportsFailure && !hasRetryableWork && !hasPendingWork && !explicitlyPartial;
  const retryableStateUnquantified = hasRetryableWork && retryableCount === 0;
  const inferredSucceededCount = processed.length === 0 && !workerReportsFailure && !retryableStateUnquantified
    && !hasPendingWork && !explicitlyPartial && !unrecognizedWorkerStatus
    ? Math.max(0, processedCount - Math.max(failedCount, retryableCount) - unresolvedCount)
    : 0;
  const succeededCount = Math.max(count(result?.succeededCount, result?.successCount, result?.deliveredCount), acknowledgedCount, inferredSucceededCount);

  let status;
  if (succeededCount > 0) {
    status = failedCount > 0 || hasRetryableWork || unresolvedCount > 0 || hasPendingWork || explicitlyPartial
      ? 'partial'
      : 'succeeded';
  } else if (explicitlyPartial) {
    status = 'partial';
  } else if (hasRetryableWork) {
    status = 'retryable';
  } else if (failedCount > 0 || workerReportsFailure) {
    status = 'failed';
  } else if (unresolvedCount > 0 || unrecognizedWorkerStatus) {
    status = 'unresolved';
  } else if (hasPendingWork) {
    status = 'pending';
  } else if (processedCount === 0) {
    status = 'no_work';
  } else {
    // An outcome shape the route does not understand must never default to success.
    status = 'unresolved';
  }

  return {
    status,
    processedCount,
    succeededCount,
    failedCount,
    retryableCount,
    unresolvedCount,
    pendingCount,
    hasRetryableWork,
    partialDelivery: status === 'partial',
    fullySucceeded: status === 'succeeded'
  };
}

async function readOutboxQueueDepth() {
  const database = outboxWorker?.db;
  if (!database || database instanceof InMemoryTestAdapter || database.isInMemory || typeof database.query !== 'function') {
    return { available: false, exact: false, pendingCount: null, processingCount: null, remainingCount: null, capped: false };
  }

  try {
    const result = await database.query(
      `SELECT status
       FROM neem_automation_outbox
       WHERE status IN ('pending', 'processing')
       LIMIT $1`,
      [OUTBOX_QUEUE_DEPTH_SAMPLE_LIMIT + 1]
    );
    if (!Array.isArray(result?.rows)) throw new Error('OUTBOX_QUEUE_DEPTH_INVALID_RESULT');
    if (result.rows.length > OUTBOX_QUEUE_DEPTH_SAMPLE_LIMIT + 1) throw new Error('OUTBOX_QUEUE_DEPTH_UNBOUNDED_RESULT');

    const sampledRows = result.rows;
    if (sampledRows.some(row => !['pending', 'processing'].includes(row?.status))) {
      throw new Error('OUTBOX_QUEUE_DEPTH_INVALID_STATUS');
    }

    const capped = sampledRows.length > OUTBOX_QUEUE_DEPTH_SAMPLE_LIMIT;
    const countedRows = sampledRows.slice(0, OUTBOX_QUEUE_DEPTH_SAMPLE_LIMIT);
    const pendingCount = countedRows.filter(row => row.status === 'pending').length;
    const processingCount = countedRows.filter(row => row.status === 'processing').length;
    return {
      available: true,
      exact: !capped,
      pendingCount,
      processingCount,
      remainingCount: pendingCount + processingCount,
      capped
    };
  } catch (_) {
    return { available: false, exact: false, pendingCount: null, processingCount: null, remainingCount: null, capped: false };
  }
}

function applyQueueDepth(summary, queueDepth) {
  let status = summary.status;
  if (!queueDepth.available) {
    if (status === 'succeeded' || status === 'no_work') status = 'unresolved';
  } else if (queueDepth.remainingCount > 0) {
    if (summary.succeededCount > 0) status = 'partial';
    else if (status === 'succeeded' || status === 'no_work') status = 'pending';
  }

  return {
    ...summary,
    status,
    batchStatus: summary.status,
    pendingQueueCount: queueDepth.pendingCount,
    processingQueueCount: queueDepth.processingCount,
    remainingCount: queueDepth.remainingCount,
    queueDepthAvailable: queueDepth.available,
    queueDepthExact: queueDepth.exact,
    queueDepthCapped: queueDepth.capped,
    remainingCountIsLowerBound: queueDepth.available && !queueDepth.exact,
    fullySucceeded: status === 'succeeded' && queueDepth.available && queueDepth.exact && queueDepth.remainingCount === 0
  };
}

// --- 1. Rules CRUD & Versions (GM-16) ---

router.get('/rules', async (req, res) => {
  try {
    const rules = await ruleEngine.listRules();
    res.json({ ok: true, data: rules });
  } catch (err) {
    res.status(err.status || (err.code === 'TASK_NOT_RETRYABLE' ? 409 : 500)).json({
      ok: false,
      error: err.code || 'AUTOMATION_RETRY_FAILED',
      message: err.message
    });
  }
});

router.get('/rules/:id', async (req, res) => {
  try {
    const rule = await ruleEngine.getRuleById(req.params.id);
    if (!rule) {
      return res.status(404).json({ ok: false, error: `Rule '${req.params.id}' not found.` });
    }
    const versions = await ruleEngine.getRuleVersions(req.params.id);
    res.json({ ok: true, data: { ...rule, versions } });
  } catch (err) {
    res.status(err.status || (err.code === 'TASK_NOT_CANCELLABLE' ? 409 : 500)).json({
      ok: false,
      error: err.code || 'AUTOMATION_CANCEL_FAILED',
      message: err.message
    });
  }
});

router.post('/rules', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const id = req.body.id || req.body.rule_id;
    const name = req.body.name;
    const description = req.body.description;
    const triggerKind = req.body.triggerKind || req.body.trigger_type;
    const conditions = req.body.conditions || req.body.condition || {};
    const actionPayload = req.body.actionPayload || req.body.action || {};
    const scheduleWindow = req.body.scheduleWindow || req.body.schedule_window;
    const scheduleCron = req.body.scheduleCron || req.body.schedule_cron;
    const priority = req.body.priority !== undefined ? req.body.priority : 10;

    const rule = await ruleEngine.createOrUpdateRule({
      id,
      name,
      description,
      triggerKind,
      conditions,
      actionPayload,
      scheduleWindow,
      scheduleCron,
      priority,
      actorId: req.platformPrincipal.id
    });
    res.status(201).json({ ok: true, data: rule });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/rules/:id/pause', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const isPaused = req.body.isPaused !== undefined ? Boolean(req.body.isPaused) : (req.body.pause !== undefined ? Boolean(req.body.pause) : true);
    const rule = await ruleEngine.pauseRuleVersion(req.params.id, isPaused, req.platformPrincipal.id);
    if (!rule) {
      return res.status(404).json({ ok: false, error: `Rule '${req.params.id}' not found.` });
    }
    res.json({ ok: true, data: rule });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- 2. Explainable Simulation (GM-16 Preview) ---

router.post('/simulate', async (req, res) => {
  try {
    const ruleId = req.body.ruleId || req.body.rule_id;
    const tenantId = req.body.tenantId || req.body.tenant_id;
    const tenantStatus = req.body.tenantStatus || 'active';
    const override = req.body.state_override || {};
    const trialExpired = req.body.trialExpired ?? override.trial_expired ?? override.trialExpired ?? false;
    const hasActivePaidSubscription = req.body.hasActivePaidSubscription ?? override.has_paid_entitlement ?? override.hasActivePaidSubscription ?? false;
    const hasPaidGrant = req.body.hasPaidGrant ?? override.has_paid_grant ?? override.hasPaidGrant ?? false;
    const clock = req.body.clock || override.clock;

    const sim = await ruleEngine.simulateRule({
      ruleId,
      tenantId,
      tenantStatus,
      trialExpired,
      hasActivePaidSubscription,
      hasPaidGrant,
      clock: clock ? new Date(clock) : new Date()
    });
    res.json({ ok: true, data: sim });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- 3. Scheduler Execution & Timeline (GM-16) ---

router.post('/scheduler/run', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { clock, targetTenantId, dryRun } = req.body || {};
    const result = await schedulerService.runSchedulerTick({
      clock: clock ? new Date(clock) : new Date(),
      targetTenantId,
      dryRun: Boolean(dryRun),
      actorId: req.platformPrincipal.id
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/executions', async (req, res) => {
  try {
    const { tenantId, ruleId, status, limit } = req.query;
    const executions = await schedulerService.listExecutions({
      tenantId,
      ruleId,
      status,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ ok: true, data: executions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- 4. Outbox Worker, Queue & Actions (GM-25) ---

router.get('/outbox', async (req, res) => {
  try {
    const { tenantId, status, limit } = req.query;
    const tasks = await outboxWorker.listTasks({
      tenantId,
      status,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ ok: true, data: tasks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/outbox/enqueue', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, targetCell, eventName, payload, idempotencyKey, delaySeconds } = req.body;
    const task = await outboxWorker.enqueueTask({
      tenantId,
      targetCell,
      eventName,
      payload,
      idempotencyKey,
      delaySeconds
    });
    res.status(201).json({ ok: true, data: task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/outbox/:id/retry', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const task = await outboxWorker.retryTask(req.params.id, req.platformPrincipal.id);
    if (!task) {
      return res.status(404).json({ ok: false, error: `Task '${req.params.id}' not found.` });
    }
    res.json({ ok: true, data: task });
  } catch (err) {
    res.status(err.status || (err.code === 'TASK_NOT_RETRYABLE' ? 409 : 500)).json({
      ok: false,
      error: err.code || 'AUTOMATION_RETRY_FAILED',
      message: err.message
    });
  }
});

router.post('/outbox/:id/cancel', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const task = await outboxWorker.cancelTask(req.params.id, reason, req.platformPrincipal.id);
    if (!task) {
      return res.status(404).json({ ok: false, error: `Task '${req.params.id}' not found.` });
    }
    res.json({ ok: true, data: task });
  } catch (err) {
    res.status(err.status || (err.code === 'TASK_NOT_CANCELLABLE' ? 409 : 500)).json({
      ok: false,
      error: err.code || 'AUTOMATION_CANCEL_FAILED',
      message: err.message
    });
  }
});

router.post('/tick', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { batchSize, workerId } = req.body || {};
    const effectiveBatchSize = batchSize || 10;
    const result = await outboxWorker.processBatch({
      batchSize: effectiveBatchSize,
      workerId
    });
    const summary = applyQueueDepth(summarizeFlushResult(result), await readOutboxQueueDepth());
    res.json({
      ok: summary.status === 'succeeded' || summary.status === 'no_work',
      data: {
        ...result,
        ...summary,
        ok: summary.status === 'succeeded' || summary.status === 'no_work',
        batchSize: effectiveBatchSize
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /events/flush & /api/control/events/flush (Phase 1.5: Outbox Flush Canonical Operation)
router.post(['/events/flush', '/flush'], requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { batchSize = 50, workerId = 'operator-flush' } = req.body || {};
    const effectiveBatchSize = parseInt(batchSize, 10) || 50;
    const result = await outboxWorker.processBatch({
      batchSize: effectiveBatchSize,
      workerId
    });
    const summary = applyQueueDepth(summarizeFlushResult(result), await readOutboxQueueDepth());

    try {
      await auditService.recordEvent({
        action: 'automation.outbox.flush',
        actorId: req.platformPrincipal?.id || 'unknown',
        actorRole: req.platformPrincipal?.role || 'platform_operations',
        targetType: 'automation_outbox',
        targetId: workerId,
        metadata: {
          batchSize: effectiveBatchSize,
          ...summary
        }
      });
    } catch (_) {}

    res.json({
      // `ok` describes delivery outcome, not merely that the HTTP handler ran.
      ok: summary.status === 'succeeded' || summary.status === 'no_work',
      data: {
        ...summary,
        batchSize: effectiveBatchSize,
        flushedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- 5. Sync States & Operational Incidents (GM-25) ---

router.get('/sync-status/:tenantId', async (req, res) => {
  try {
    const status = await syncStateService.getSyncStatus(req.params.tenantId);
    res.json({ ok: true, data: status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/incidents', async (req, res) => {
  try {
    const { tenantId, cellId, status } = req.query;
    const incidents = await syncStateService.getIncidents({ tenantId, cellId, status });
    res.json({ ok: true, data: incidents });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/incidents/:id/resolve', requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { resolutionNotes } = req.body || {};
    const resolved = await syncStateService.resolveIncident(req.params.id, resolutionNotes, req.platformPrincipal.id);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: `Incident '${req.params.id}' not found.` });
    }
    res.json({ ok: true, data: resolved });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

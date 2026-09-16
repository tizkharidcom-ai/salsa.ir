// server/neem/control-plane/routes/automation-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const ruleEngine = require('../automation/rule-engine');
const schedulerService = require('../automation/scheduler-service');
const outboxWorker = require('../automation/outbox-worker');
const syncStateService = require('../automation/sync-state-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

router.use(authenticatePlatform);

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
    const result = await outboxWorker.processBatch({
      batchSize: batchSize || 10,
      workerId
    });
    res.json({ ok: true, data: result });
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

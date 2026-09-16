// server/neem/control-plane/routes/tenant-provisioning-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const provisioningRunner = require('../tenant/provisioning-runner');
const invitationService = require('../tenant/invitation-service');
const migrationRestoreHarness = require('../tenant/migration-restore-harness');
const templateService = require('../tenant/template-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

// Public endpoint to accept tenant invitations (guest/new owner flow)
router.post('/invitations/accept', async (req, res) => {
  try {
    const { rawToken, newPassword } = req.body || {};
    if (!rawToken || !newPassword) {
      return res.status(422).json({
        success: false,
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'rawToken and newPassword are required.' }
      });
    }
    const result = await invitationService.acceptInvitation(rawToken, newPassword);
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      ok: false,
      error: err.message,
      errorDetail: { code: 'INVITATION_ACCEPT_FAILED', message: err.message }
    });
  }
});

// Helper guard: rejects restaurant sessions and enforces platform authentication
function platformGuard(req, res, next) {
  if (req.cookies && req.cookies.westo_session) {
    return res.status(401).json({
      success: false,
      ok: false,
      error: {
        code: 'RESTAURANT_IDENTITY_REJECTED',
        message: 'Direct access with restaurant identity session is strictly prohibited on Control Plane.'
      }
    });
  }
  return authenticatePlatform(req, res, next);
}

// List available zero-data templates (GM-07)
router.get('/templates', platformGuard, (req, res) => {
  res.json({
    success: true,
    ok: true,
    data: templateService.listTemplates()
  });
});

// Template inspection without leaking credentials
router.get('/template', platformGuard, (req, res) => {
  const templateCode = req.query.code || 'empty';
  res.json({
    success: true,
    ok: true,
    data: {
      template: templateService.getTemplate(templateCode),
      checksum: templateService.getTemplateChecksum(templateCode),
      ddl: templateService.getCanonicalDDL(templateCode)
    }
  });
});

// List all provisioning jobs
router.get('/jobs', platformGuard, async (req, res) => {
  try {
    const jobs = await provisioningRunner.listJobs(req.query.tenantId || null);
    res.json({ success: true, ok: true, data: jobs });
  } catch (err) {
    res.status(500).json({
      success: false,
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

router.post(['/provision', '/jobs'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, displayName, cellId, planCode, canonicalDomain, ownerEmail, templateCode } = req.body;
    const idempotencyKey = req.body.idempotencyKey || req.headers['idempotency-key'] || null;

    if (!tenantId || !displayName || !ownerEmail) {
      return res.status(422).json({
        success: false,
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'tenantId, displayName, and ownerEmail are required.' }
      });
    }

    const result = await provisioningRunner.startProvisioningJob({
      tenantId,
      displayName,
      cellId: cellId || 'cell-teh-01',
      planCode: planCode || 'starter',
      canonicalDomain,
      ownerEmail,
      templateCode: templateCode || 'empty',
      idempotencyKey,
      initiatedBy: req.platformPrincipal.id
    });

    const statusCode = result.isDuplicate ? 200 : 201;
    res.status(statusCode).json({ success: true, ok: true, data: result });
  } catch (err) {
    let status = 400;
    if (err.code === 'VALIDATION_ERROR') status = 422;
    if (err.code === 'TENANT_ALREADY_EXISTS') status = 409;
    if (err.code === 'ZERO_DATA_VIOLATION') status = 422;

    res.status(status).json({
      success: false,
      ok: false,
      error: { code: err.code || 'PROVISIONING_FAILED', message: err.message }
    });
  }
});

// Query Provisioning Job details (GM-06)
router.get(['/provision/:jobId', '/jobs/:jobId'], platformGuard, async (req, res) => {
  try {
    const job = await provisioningRunner.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        ok: false,
        error: { code: 'NOT_FOUND', message: `Provisioning job '${req.params.jobId}' not found.` }
      });
    }
    res.json({ success: true, ok: true, data: job });
  } catch (err) {
    res.status(500).json({
      success: false,
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

router.post(['/provision/:jobId/retry', '/jobs/:jobId/retry'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const result = await provisioningRunner.retryJob(req.params.jobId, req.platformPrincipal.id);
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({
      success: false,
      ok: false,
      error: { code: err.code || 'RETRY_FAILED', message: err.message }
    });
  }
});

router.post(['/provision/:jobId/quarantine', '/jobs/:jobId/quarantine'], platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const reason = req.body.reason || 'Operator manual quarantine';
    const result = await provisioningRunner.quarantineJob(req.params.jobId, reason, req.platformPrincipal.id);
    res.json({ success: true, ok: true, data: result });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({
      success: false,
      ok: false,
      error: { code: err.code || 'QUARANTINE_FAILED', message: err.message }
    });
  }
});

// Comprehensive Tenant Readiness Inspector (GM-07)
router.get('/tenants/:tenantId/readiness', platformGuard, async (req, res) => {
  try {
    const readiness = await provisioningRunner.inspectTenantReadiness(req.params.tenantId);
    res.json({ success: true, ok: true, data: readiness });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      ok: false,
      error: { code: err.code || 'READINESS_CHECK_FAILED', message: err.message }
    });
  }
});

// Tenant Invitations list
router.get('/:tenantId/invitations', platformGuard, async (req, res) => {
  try {
    const list = await invitationService.listInvitations(req.params.tenantId);
    res.json({ success: true, ok: true, data: list });
  } catch (err) {
    res.status(500).json({
      success: false,
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

router.post('/:tenantId/invitations', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { email, phone, role, expiryHours } = req.body;
    if (!email) {
      return res.status(422).json({
        success: false,
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email is required for invitation.' }
      });
    }
    const result = await invitationService.createInvitation({
      tenantId: req.params.tenantId,
      email,
      phone,
      role,
      createdBy: req.platformPrincipal.id,
      expiryHours
    });
    res.status(201).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(400).json({
      success: false,
      ok: false,
      error: { code: 'INVITATION_CREATION_FAILED', message: err.message }
    });
  }
});

router.post('/backup', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { tenantId, backupKind } = req.body;
    const result = await migrationRestoreHarness.createBackupSnapshot({
      tenantId,
      backupKind,
      actorId: req.platformPrincipal.id
    });
    res.status(201).json({ success: true, ok: true, data: result });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      ok: false,
      error: { code: err.code || 'BACKUP_FAILED', message: err.message }
    });
  }
});

router.post('/restore-test', platformGuard, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const { backupId, targetSandbox } = req.body;
    const result = await migrationRestoreHarness.runRestoreTest({
      backupId,
      targetSandbox,
      actorId: req.platformPrincipal.id
    });
    res.status(200).json({ success: true, ok: true, data: result });
  } catch (err) {
    const status = err.status || (err.message.includes('FAIL_CLOSED_SAFETY') ? 403 : 400);
    res.status(status).json({
      success: false,
      ok: false,
      error: err.message,
      errorDetail: { code: err.code || 'RESTORE_TEST_FAILED', message: err.message }
    });
  }
});

module.exports = router;

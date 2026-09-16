// server/neem/control-plane/routes/support-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const supportService = require('../support/support-service');
const { ApprovalRateLimitService } = require('../support/approval-rate-limit-service');
const cryptoPii = require('../support/crypto-pii');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

// Persistent Control Plane instances share the limiter through PostgreSQL;
// test/ephemeral modes use the same bounded algorithm in process memory.
const approvalRateLimitService = new ApprovalRateLimitService({ db: supportService.db });

function approvalTokenFromRequest(req) {
  return String(req.body?.approvalToken || req.body?.approval_token || '');
}

async function rateLimitTenantApproval(req, res, next) {
  try {
    const result = await approvalRateLimitService.consume({
      ip: String(req.ip || req.socket?.remoteAddress || 'unknown'),
      token: approvalTokenFromRequest(req)
    });
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        error: 'SUPPORT_APPROVAL_RATE_LIMITED',
        retryAfterSeconds: result.retryAfterSeconds
      });
    }
    return next();
  } catch (_error) {
    // Never downgrade a persistent deployment to an unbounded approval
    // endpoint if its shared limiter is unavailable.
    return res.status(503).json({
      ok: false,
      error: 'SUPPORT_APPROVAL_RATE_LIMIT_UNAVAILABLE'
    });
  }
}

// Tenant-owner approval is a one-time bearer workflow delivered out of band
// to the tenant. It intentionally sits before platform authentication: the
// approval token is the tenant-side proof, while the service still verifies
// tenant membership, expiry, single-use state, and records an audit event.
router.post('/sessions/tenant-approval', rateLimitTenantApproval, async (req, res) => {
  try {
    const result = await supportService.decideTenantApproval({
      approvalToken: approvalTokenFromRequest(req),
      tenantId: req.body?.tenantId || req.body?.tenant_id,
      decision: req.body?.decision,
      approverIdentityId: req.body?.approverIdentityId || req.body?.approver_identity_id,
      approverEmail: req.body?.approverEmail || req.body?.approver_email,
      reason: req.body?.reason
    });
    return res.status(200).json({ ok: true, data: result });
  } catch (err) {
    const status = err.message.includes('REQUIRED') || err.message.includes('INVALID') || err.message.includes('DECISION')
      ? 422
      : err.message.includes('NOT_AUTHORIZED') || err.message.includes('TENANT_ISOLATION')
        ? 403
        : err.message.includes('EXPIRED') || err.message.includes('ALREADY_DECIDED')
          ? 409
          : 400;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

router.use(authenticatePlatform);

// =========================================================================
// 1. CANONICAL TICKETING & CONVERSATION THREADS (GM-21)
// =========================================================================

// Create Ticket
router.post(['/tickets', '/support/tickets'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support', 'platform_operations']), async (req, res) => {
  try {
    const tenantId = req.body.tenantId || req.body.tenant_id;
    const title = req.body.title || req.body.subject;
    const subject = req.body.subject || req.body.title;
    const description = req.body.description;
    const priority = req.body.priority || req.body.severity;
    const category = req.body.category || 'general';
    const creatorEmail = req.body.creatorEmail || req.body.creator_email || req.platformPrincipal.email;
    const attachments = req.body.attachments;

    const ticket = await supportService.createTicket({
      tenantId,
      title,
      subject,
      description,
      priority,
      category,
      creatorEmail,
      requesterId: req.platformPrincipal.id,
      attachments
    });
    res.status(201).json({ ok: true, data: ticket, ticket });
  } catch (err) {
    const status = err.message.includes('ATTACHMENT') || err.message.includes('TICKET_ERROR') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// List Tickets (with tenant scoping and filters)
router.get(['/tickets', '/support/tickets'], async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.query.tenant_id;
    const { status, priority } = req.query;
    const tickets = await supportService.listTickets(tenantId || null, { status, priority });
    res.json({ ok: true, data: tickets, tickets });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Tenant-scoped Tickets or Specific Ticket lookup
router.get(['/tickets/:tenantId', '/support/tickets/:tenantId'], async (req, res) => {
  try {
    const param = req.params.tenantId;
    if (param.startsWith('tkt_') || param.startsWith('TIC-') || param.startsWith('tic_')) {
      const details = await supportService.getTicketDetails(param);
      if (!details) return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
      return res.json({ ok: true, data: details, ticket: details.ticket, messages: details.messages });
    }
    const tickets = await supportService.listTickets(param);
    res.json({ ok: true, data: tickets, tickets });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Ticket Details with Messages & Attachments
router.get(['/ticket-details/:id', '/tickets/:id/details', '/support/tickets/:id', '/support/tickets/:id/details'], async (req, res) => {
  try {
    const details = await supportService.getTicketDetails(req.params.id);
    if (!details) return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
    res.json({ ok: true, data: details, ticket: details.ticket, messages: details.messages });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add Message to Ticket Conversation Thread
router.post(['/tickets/:id/messages', '/support/tickets/:id/messages'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support', 'platform_operations']), async (req, res) => {
  try {
    const messageBody = req.body.messageBody || req.body.body;
    const isInternal = req.body.isInternal !== undefined ? req.body.isInternal : (req.body.is_internal !== undefined ? req.body.is_internal : false);
    const attachments = req.body.attachments;
    const message = await supportService.addMessageToTicket({
      ticketId: req.params.id,
      senderId: req.platformPrincipal.id,
      senderType: 'platform_support',
      isInternal: Boolean(isInternal),
      messageBody,
      attachments
    });
    res.status(201).json({ ok: true, data: message, message });
  } catch (err) {
    const status = err.message.includes('ATTACHMENT') || err.message.includes('MESSAGE_ERROR') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// Update Ticket Status/Priority/Assignee
router.patch(['/tickets/:id/status', '/support/tickets/:id/status'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support', 'platform_operations']), async (req, res) => {
  try {
    const { status, assignedTo, priority } = req.body;
    const updated = await supportService.updateTicketStatus({
      ticketId: req.params.id,
      status,
      assignedTo,
      priority,
      actorId: req.platformPrincipal.id
    });
    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// =========================================================================
// 2. SUPPORT SESSIONS & VIEW-AS-USER (GM-21)
// =========================================================================

// Create Support Session (Strictly requires ticketId + tenantId + reason, max 120m)
router.post(['/sessions', '/support/sessions'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support', 'platform_operations']), async (req, res) => {
  try {
    const ticketId = req.body.ticketId || req.body.ticket_id;
    const tenantId = req.body.tenantId || req.body.tenant_id;
    const viewAsUserId = req.body.viewAsUserId || req.body.view_as_user_id;
    const sessionScope = req.body.sessionScope || req.body.session_scope || 'read_only';
    const reason = req.body.reason;
    const durationMinutes = req.body.durationMinutes || req.body.duration_minutes || 30;
    const isWriteAllowed = req.body.isWriteAllowed !== undefined ? req.body.isWriteAllowed : (req.body.scoped_write !== undefined ? req.body.scoped_write : false);
    const writeJustification = req.body.writeJustification || req.body.scoped_write_reason || req.body.write_justification;
    const scopedActions = req.body.scopedActions || req.body.scoped_actions || [];

    const session = await supportService.createSupportSession({
      ticketId,
      tenantId,
      supportPrincipalId: req.platformPrincipal ? req.platformPrincipal.id : 'usr_platform_owner',
      actorRole: req.platformPrincipal ? req.platformPrincipal.role : 'platform_owner',
      viewAsUserId,
      sessionScope,
      reason,
      durationMinutes,
      isWriteAllowed,
      writeJustification,
      scopedActions
    });

    res.status(201).json({ ok: true, data: session, session });
  } catch (err) {
    const status = err.message.includes('REASON_REQUIRED') ||
                   err.message.includes('TICKET_REQUIRED') ||
                   err.message.includes('WRITE_JUSTIFICATION') ||
                   err.message.includes('DURATION_ERROR') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// Validate Support Session Token (returns 401 if expired or revoked)
router.post(['/sessions/validate', '/support/sessions/validate'], async (req, res) => {
  try {
    const { rawToken } = req.body;
    const session = await supportService.validateSupportSession(rawToken);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'SESSION_INVALID_OR_EXPIRED' });
    }
    res.json({ ok: true, data: session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// List Active Support Sessions
router.get(['/sessions', '/support/sessions', '/sessions/active', '/support/sessions/active'], async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.query.tenant_id;
    const sessions = await supportService.listActiveSessions(tenantId || null);
    res.json({ ok: true, data: sessions, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Immediate Revocation of Single Session
router.post(['/sessions/:id/revoke', '/support/sessions/:id/revoke', '/support/sessions/:id/end'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support', 'platform_operations']), async (req, res) => {
  try {
    const result = await supportService.revokeSession(req.params.id, req.platformPrincipal.id);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Bulk Revoke All Active Sessions
router.post(['/sessions/revoke-all', '/support/sessions/revoke-all'], requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res) => {
  try {
    const tenantId = req.body?.tenantId || req.body?.tenant_id;
    const result = await supportService.revokeAllSessions(tenantId, req.platformPrincipal.id);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =========================================================================
// 3. TENANT CUSTOMER DIRECTORY & CONTROLLED PII (GM-17)
// =========================================================================

// Search Customers Directory (Masked output by default)
router.post(['/data/customers/search', '/customers/search'], async (req, res) => {
  try {
    const tenantId = req.body.tenantId || req.body.tenant_id;
    const query = req.body.query || req.body.phone;
    const searchType = req.body.searchType || (req.body.phone ? 'exact_phone' : 'all');
    const limit = req.body.limit;
    if (!tenantId) {
      return res.status(422).json({ ok: false, error: 'TENANT_REQUIRED: tenantId is mandatory for customer search.' });
    }
    const customers = await supportService.searchCustomers({ tenantId, query, searchType, limit });
    res.json({ ok: true, data: customers, customers });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// List Customers (Masked by default)
router.get(['/data/customers', '/customers'], async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.query.tenant_id;
    if (!tenantId) {
      return res.status(422).json({ ok: false, error: 'TENANT_REQUIRED: tenantId is mandatory for customer listing.' });
    }
    const query = req.query.query || req.query.phone;
    const searchType = req.query.phone ? 'exact_phone' : 'all';
    const customers = await supportService.searchCustomers({ tenantId, query, searchType, limit: 100 });
    res.json({ ok: true, data: customers, customers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Controlled Phone Reveal (Requires documented reason, records audit)
router.post(['/data/customers/:id/reveal', '/customers/:id/reveal'], requirePlatformRole(['platform_owner', 'platform_support']), async (req, res) => {
  try {
    const tenantId = req.body.tenantId || req.body.tenant_id;
    const reason = req.body.reason;
    const sessionId = req.body.sessionId || req.body.session_id;
    const result = await supportService.revealCustomerPhone({
      customerId: req.params.id,
      tenantId,
      reason,
      actorId: req.platformPrincipal.id,
      actorRole: req.platformPrincipal.role,
      sessionId
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    const status = err.message.includes('REASON_REQUIRED') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// Minimal Watermarked Export (GM-26)
router.all(['/data/customers/export', '/exports/customers'], requirePlatformRole(['platform_owner', 'platform_admin', 'platform_support']), async (req, res) => {
  try {
    const tenantId = req.body?.tenantId || req.body?.tenant_id || req.query.tenantId || req.query.tenant_id;
    if (!tenantId) {
      return res.status(422).json({ ok: false, error: 'TENANT_REQUIRED: tenantId is mandatory for customer export.' });
    }
    const reason = req.body?.reason || req.query.reason || 'Support audit export';
    const sessionId = req.body?.sessionId || req.body?.session_id || req.query.sessionId;
    const format = req.body?.format || req.query.format || 'json';
    const result = await supportService.exportCustomers({
      tenantId,
      reason,
      actorId: req.platformPrincipal.id,
      sessionId
    });
    if (format === 'csv') {
      const header = 'id,tenant_id,full_name,phone_masked,loyalty_tier,created_at\n';
      const rows = (result.records || []).map(r => `"${r.id}","${r.tenant_id}","${r.full_name || ''}","${r.phone_masked || ''}","${r.loyalty_tier || ''}","${r.created_at || ''}"`).join('\n');
      result.csv = header + rows;
    }
    res.json({ ok: true, data: result });
  } catch (err) {
    const status = err.message.includes('EXPORT_ERROR') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// PII Encryption utility
router.post('/pii/encrypt', (req, res) => {
  try {
    const { plaintext, fieldType = 'phone' } = req.body;
    const ciphertext = cryptoPii.encrypt(plaintext);
    let masked = '***';
    if (fieldType === 'phone') masked = cryptoPii.maskPhone(plaintext);
    if (fieldType === 'card') masked = cryptoPii.maskCard(plaintext);
    if (fieldType === 'national_id') masked = cryptoPii.maskNationalId(plaintext);
    if (fieldType === 'email') masked = cryptoPii.maskEmail(plaintext);

    res.json({ ok: true, data: { ciphertext, masked } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Controlled PII Reveal (Legacy endpoint compatibility)
router.post('/pii/reveal', requirePlatformRole(['platform_owner', 'platform_support']), async (req, res) => {
  try {
    const { ciphertext, reason, tenantId } = req.body;
    const result = await supportService.revealPii({
      ciphertext,
      reason,
      actorId: req.platformPrincipal.id,
      tenantId: tenantId || 'global'
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    const status = err.message.includes('REASON_REQUIRED') ? 422 : 400;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// =========================================================================
// 4. SCOPED READ-ONLY DIAGNOSTICS (GM-27)
// =========================================================================

router.get(['/diagnostics', '/support/diagnostics'], async (req, res) => {
  try {
    const { tenantId } = req.query;
    const report = await supportService.runScopedDiagnostics({
      tenantId: tenantId || null,
      actorId: req.platformPrincipal.id
    });
    res.json({ ok: true, data: report, diagnostics: report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =========================================================================
// 5. KEYRING ROTATION & BATCH RE-ENCRYPTION (GM-27)
// =========================================================================

// Keyring Status (Zero secret keys exposed)
router.get(['/crypto/keyring-status', '/support/crypto/keyring-status', '/keyring/status', '/support/keyring/status'], (req, res) => {
  try {
    const status = cryptoPii.getKeyringStatus();
    const payload = {
      ...status,
      active_version: status.currentVersion,
      current_version: status.currentVersion,
      total_versions: status.totalKeys,
      available_versions: status.versions
    };
    res.json({ ok: true, data: payload, keyring: payload });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rotate Master Key Version
router.post(['/crypto/rotate-key', '/support/crypto/rotate-key', '/keyring/rotate', '/support/keyring/rotate'], requirePlatformRole(['platform_owner']), async (req, res) => {
  try {
    const { newVersion, ciphertext, targetVersion } = req.body || {};
    if (ciphertext) {
      const rotated = cryptoPii.rotateCiphertext(ciphertext, targetVersion || 'v2');
      return res.json({ ok: true, data: { rotatedCiphertext: rotated, targetVersion: targetVersion || 'v2' } });
    }
    const result = await supportService.rotateKeyring({
      newVersion: newVersion || targetVersion,
      actorId: req.platformPrincipal.id
    });
    const payload = {
      ...result,
      active_version: result.currentVersion,
      current_version: result.currentVersion,
      total_versions: result.totalKeys,
      available_versions: result.versions
    };
    res.json({ ok: true, data: payload, keyring: payload });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Gradual Batch Re-encryption with Cursor
router.post(['/crypto/reencrypt-batch', '/support/crypto/reencrypt-batch', '/keyring/reencrypt', '/support/keyring/reencrypt'], requirePlatformRole(['platform_owner']), async (req, res) => {
  try {
    const targetVersion = req.body?.targetVersion || req.body?.target_version;
    const batchSize = req.body?.batchSize || req.body?.batch_size;
    const cursor = req.body?.cursor;
    const result = await supportService.reencryptCustomerBatch({
      targetVersion,
      batchSize,
      cursor,
      actorId: req.platformPrincipal.id
    });
    res.json({ ok: true, data: result, job: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Re-encryption jobs list
router.get(['/crypto/reencrypt-jobs', '/support/crypto/reencrypt-jobs', '/keyring/reencrypt/jobs', '/support/keyring/reencrypt/jobs'], async (req, res) => {
  try {
    const jobsRes = await supportService.db.query('SELECT * FROM neem_reencryption_jobs ORDER BY created_at DESC');
    res.json({ ok: true, data: jobsRes.rows, jobs: jobsRes.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =========================================================================
// 6. BIDIRECTIONAL AUDIT TRAILS (GM-26)
// =========================================================================

// PII Access Audit Logs (GM-26)
router.get(['/audit/pii-logs', '/support/audit/pii-logs', '/audit/pii', '/support/audit/pii'], async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.query.tenant_id;
    const logs = await supportService.listPiiAudits(tenantId || null);
    res.json({ ok: true, data: logs, audit_logs: logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Support Session Audit Logs (GM-26)
router.get(['/audit/sessions', '/support/audit/sessions', '/sessions/audit'], async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.query.tenant_id;
    const resSessions = await supportService.db.query('SELECT * FROM neem_support_sessions ORDER BY created_at DESC');
    let rows = resSessions.rows;
    if (tenantId) rows = rows.filter(s => s.tenant_id === tenantId);
    res.json({ ok: true, data: rows, sessions: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

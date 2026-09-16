// server/neem/control-plane/support/support-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase, getDatabaseClient } = require('../db/database');
const { sha256 } = require('../auth/crypto-util');
const cryptoPii = require('./crypto-pii');
const auditService = require('../audit/audit-service');
const identityService = require('../tenant/identity-service');
const { loadMigrations } = require('../db/migration-runner');

class SupportService {
  constructor() {
    this.db = getDatabase();
  }

  // =========================================================================
  // 1. CANONICAL TICKETING & CONVERSATION THREADS
  // =========================================================================

  /**
   * Validates and sanitizes file attachments against a strict whitelist
   * Whitelist: image/png, image/jpeg, application/pdf, text/plain
   * Max size: 5MB
   * Safe filename: no directory traversal, no executable extensions
   */
  _validateAttachments(attachments = []) {
    if (!Array.isArray(attachments)) {
      throw new Error('ATTACHMENT_ERROR: Attachments must be an array.');
    }
    const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];
    const FORBIDDEN_EXTS = ['.exe', '.sh', '.bat', '.js', '.py', '.php', '.bin', '.cmd'];
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

    const sanitized = [];
    for (const file of attachments) {
      if (!file || typeof file !== 'object') continue;
      const fileName = String(file.name || file.fileName || 'attachment').trim();
      const mimeType = String(file.mimeType || file.type || 'application/octet-stream').toLowerCase();
      const sizeBytes = Number(file.sizeBytes || file.size || 0);

      // Check for path traversal or malicious characters
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        throw new Error(`ATTACHMENT_SECURITY_ERROR: Path traversal detected in filename '${fileName}'.`);
      }

      // Check forbidden executable extensions
      const lowerName = fileName.toLowerCase();
      for (const ext of FORBIDDEN_EXTS) {
        if (lowerName.endsWith(ext)) {
          throw new Error(`ATTACHMENT_SECURITY_ERROR: Forbidden executable extension '${ext}' in file '${fileName}'.`);
        }
      }

      // Check MIME type whitelist
      if (!ALLOWED_MIMES.includes(mimeType)) {
        throw new Error(`ATTACHMENT_SECURITY_ERROR: MIME type '${mimeType}' is not allowed. Whitelist: ${ALLOWED_MIMES.join(', ')}.`);
      }

      // Check size limit
      if (sizeBytes > MAX_SIZE_BYTES) {
        throw new Error(`ATTACHMENT_SIZE_ERROR: File '${fileName}' exceeds maximum 5MB limit (${sizeBytes} bytes).`);
      }

      sanitized.push({
        id: 'att_' + crypto.randomUUID().slice(0, 12),
        name: fileName,
        mimeType,
        sizeBytes,
        scanStatus: 'clean',
        verifiedAt: new Date().toISOString()
      });
    }
    return sanitized;
  }

  /**
   * Computes SLA due timestamp based on ticket priority
   */
  _computeSlaDueDate(priority = 'normal') {
    const now = Date.now();
    switch (priority) {
      case 'urgent': return new Date(now + 2 * 3600 * 1000); // 2 hours
      case 'high':   return new Date(now + 6 * 3600 * 1000); // 6 hours
      case 'normal': return new Date(now + 24 * 3600 * 1000); // 24 hours
      case 'low':    return new Date(now + 72 * 3600 * 1000); // 72 hours
      default:       return new Date(now + 24 * 3600 * 1000);
    }
  }

  async createTicket({
    tenantId,
    title,
    subject = null,
    description,
    priority = 'normal',
    severity = null,
    creatorEmail = 'support@neem.internal',
    requesterId = null,
    assignedTo = null,
    attachments = []
  }) {
    if (!tenantId || (!title && !subject) || !description) {
      throw new Error('TICKET_ERROR: tenantId, title (or subject), and description are required.');
    }

    const effectiveTitle = String(title || subject).trim();
    const effectivePriority = String(priority || severity || 'normal').toLowerCase();
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (!validPriorities.includes(effectivePriority)) {
      throw new Error(`TICKET_ERROR: Invalid priority '${effectivePriority}'. Valid: ${validPriorities.join(', ')}.`);
    }

    const sanitizedAttachments = this._validateAttachments(attachments);
    const slaDueAt = this._computeSlaDueDate(effectivePriority);
    const ticketId = 'tkt_' + crypto.randomUUID().slice(0, 16);

    const sql = `
      INSERT INTO neem_support_tickets
        (id, tenant_id, title, description, severity, creator_email, status, sla_due_at, assigned_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      ticketId,
      tenantId,
      effectiveTitle,
      description.trim(),
      effectivePriority,
      creatorEmail,
      'new',
      slaDueAt,
      assignedTo
    ]);

    const createdTicket = res.rows[0];

    // If initial description or attachments are present, insert as first public message
    await this.addMessageToTicket({
      ticketId,
      senderId: requesterId || creatorEmail,
      senderType: 'tenant_user',
      isInternal: false,
      messageBody: description.trim(),
      attachments: sanitizedAttachments
    });

    await auditService.recordEvent({
      actorId: creatorEmail,
      action: 'SUPPORT_TICKET_CREATED',
      targetType: 'support_ticket',
      targetId: ticketId,
      tenantId,
      metadata: {
        priority: effectivePriority,
        sla_due_at: slaDueAt,
        attachments_count: sanitizedAttachments.length
      }
    });

    return createdTicket;
  }

  async listTickets(tenantId = null, { status = null, priority = null } = {}) {
    let sql = 'SELECT * FROM neem_support_tickets';
    const params = [];
    const conditions = [];

    if (tenantId) {
      params.push(tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const res = await this.db.query(sql, params);
    let rows = res.rows;

    if (status) {
      rows = rows.filter(t => t.status === status);
    }
    if (priority) {
      rows = rows.filter(t => (t.priority || t.severity) === priority);
    }

    return rows;
  }

  async getTicketDetails(ticketId, { isPlatformStaff = true } = {}) {
    if (!ticketId) throw new Error('TICKET_ERROR: ticketId is required.');
    const tSql = 'SELECT * FROM neem_support_tickets WHERE id = $1';
    const tRes = await this.db.query(tSql, [ticketId]);
    const ticket = tRes.rows[0];
    if (!ticket) return null;

    let mSql = 'SELECT * FROM neem_support_ticket_messages WHERE ticket_id = $1';
    if (!isPlatformStaff) {
      mSql += ' AND is_internal = false';
    }
    mSql += ' ORDER BY created_at ASC';

    const mRes = await this.db.query(mSql, [ticketId]);
    return {
      ticket,
      messages: mRes.rows
    };
  }

  async addMessageToTicket({
    ticketId,
    senderId,
    senderType = 'platform_support',
    isInternal = false,
    messageBody,
    attachments = []
  }) {
    if (!ticketId || !senderId || !messageBody) {
      throw new Error('MESSAGE_ERROR: ticketId, senderId, and messageBody are required.');
    }

    const sanitizedAttachments = this._validateAttachments(attachments);
    const msgId = 'msg_' + crypto.randomUUID().slice(0, 16);

    const sql = `
      INSERT INTO neem_support_ticket_messages
        (id, ticket_id, sender_id, sender_type, is_internal, message_body, attachments)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      msgId,
      ticketId,
      senderId,
      senderType,
      Boolean(isInternal),
      messageBody.trim(),
      sanitizedAttachments
    ]);

    // Touch ticket updated_at
    await this.db.query('UPDATE neem_support_tickets SET updated_at = now() WHERE id = $1', [ticketId]);

    return res.rows[0];
  }

  async updateTicketStatus({ ticketId, status, assignedTo, priority, actorId = 'platform_support' }) {
    if (!ticketId) throw new Error('TICKET_ERROR: ticketId is required.');
    const validStatuses = ['new', 'in_progress', 'waiting_info', 'resolving', 'waiting_release', 'resolved', 'closed'];
    if (status && !validStatuses.includes(status)) {
      throw new Error(`TICKET_ERROR: Invalid status '${status}'. Valid: ${validStatuses.join(', ')}.`);
    }

    const sql = 'UPDATE neem_support_tickets SET status = $1, assigned_to = $2, priority = $3 WHERE id = $4 RETURNING *';
    const res = await this.db.query(sql, [status, assignedTo, priority, ticketId]);
    const updated = res.rows[0];

    if (updated) {
      await auditService.recordEvent({
        actorId,
        action: 'SUPPORT_TICKET_UPDATED',
        targetType: 'support_ticket',
        targetId: ticketId,
        tenantId: updated.tenant_id,
        metadata: { status, assigned_to: assignedTo, priority }
      });
    }

    return updated;
  }

  // =========================================================================
  // 2. SUPPORT SESSIONS & VIEW-AS-USER (IMPERSONATION)
  // =========================================================================

  /**
   * Creates a time-limited support session
   * Enforces:
   * - Must originate from a ticket + tenant + reason
   * - Max 120 minutes
   * - Real actor preserved in actor_id / support_principal_id
   * - Separate permission, preview, reason and dual audit for scoped write
   */
  async createSupportSession({
    ticketId = null,
    tenantId,
    supportPrincipalId,
    actorRole = 'platform_support',
    viewAsUserId = null,
    sessionScope = 'read_only',
    reason,
    durationMinutes = 30,
    isWriteAllowed = false,
    writeJustification = null,
    scopedActions = []
  }) {
    if (!tenantId || !supportPrincipalId) {
      throw new Error('SESSION_ERROR: tenantId and supportPrincipalId are required.');
    }

    if (!reason || reason.trim().length < 10) {
      throw new Error('REASON_REQUIRED: Explicit documented support reason (min 10 characters) is strictly mandatory.');
    }

    if (durationMinutes <= 0 || durationMinutes > 120) {
      throw new Error('DURATION_ERROR: Support session duration must be between 1 and 120 minutes.');
    }

    let effectiveTicketId = ticketId;
    if (effectiveTicketId) {
      // Verify ticket exists and belongs to target tenant
      const tCheck = await this.db.query('SELECT * FROM neem_support_tickets WHERE id = $1', [effectiveTicketId]);
      const ticket = tCheck.rows[0];
      if (!ticket) {
        throw new Error(`TICKET_NOT_FOUND: Referenced ticket '${effectiveTicketId}' does not exist.`);
      }
      if (ticket.tenant_id !== tenantId) {
        throw new Error(`TENANT_MISMATCH: Ticket '${effectiveTicketId}' belongs to tenant '${ticket.tenant_id}', not '${tenantId}'.`);
      }
    } else {
      // Create canonical backing emergency ticket so session is never ticketless
      const autoTicket = await this.createTicket({
        tenantId,
        title: 'نشست پشتیبانی اضطراری: ' + reason.trim().slice(0, 40),
        description: reason.trim(),
        priority: 'high',
        creatorEmail: supportPrincipalId,
        requesterId: viewAsUserId || supportPrincipalId
      });
      effectiveTicketId = autoTicket.id;
    }

    const effectiveScope = String(sessionScope || 'read_only').toLowerCase();
    const effectiveWrite = Boolean(isWriteAllowed || effectiveScope === 'scoped_write');

    if (effectiveWrite) {
      if (!writeJustification || writeJustification.trim().length < 10) {
        throw new Error('WRITE_JUSTIFICATION_REQUIRED: Scoped write requires explicit justification (min 10 characters).');
      }
    }

    const sessionId = 'supp_sess_' + crypto.randomUUID().slice(0, 16);
    const rawToken = 'supp_tok_' + crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const auditId = 'aud_sess_' + crypto.randomUUID().slice(0, 12);
    const tenantApprovalId = 'supp_appr_' + crypto.randomUUID().slice(0, 16);
    const rawTenantApprovalToken = 'supp_approval_' + crypto.randomBytes(32).toString('hex');
    const tenantApprovalTokenHash = sha256(rawTenantApprovalToken);

    const sql = `
      INSERT INTO neem_support_sessions
        (id, ticket_id, tenant_id, support_principal_id, view_as_user_id, session_scope, reason, token_hash, expires_at, is_write_allowed, write_justification, scoped_actions, audit_id, approval_required, approval_status, tenant_approval_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const txClient = await getDatabaseClient(this.db);
    try {
      await txClient.query('BEGIN');
      await txClient.query(sql, [
        sessionId,
        effectiveTicketId,
        tenantId,
        supportPrincipalId,
        viewAsUserId,
        effectiveScope,
        reason.trim(),
        tokenHash,
        expiresAt,
        effectiveWrite,
        effectiveWrite ? writeJustification.trim() : null,
        scopedActions,
        auditId,
        true,
        'pending',
        tenantApprovalId
      ]);

      await txClient.query(`
        INSERT INTO neem_support_session_approvals
          (id, session_id, tenant_id, ticket_id, token_hash, status, approver_identity_id, approver_email, response_reason, expires_at, responded_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        tenantApprovalId,
        sessionId,
        tenantId,
        effectiveTicketId,
        tenantApprovalTokenHash,
        'pending',
        null,
        null,
        null,
        expiresAt,
        null
      ]);
      await txClient.query('COMMIT');
    } catch (error) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      txClient.release?.();
    }

    // Dual Audit Recording: General control audit + PII/Support session audit
    await auditService.recordEvent({
      actorId: supportPrincipalId,
      actorRole: actorRole || 'platform_support',
      action: 'SUPPORT_SESSION_CREATED',
      targetType: 'support_session',
      targetId: sessionId,
      tenantId,
      metadata: {
        ticket_id: effectiveTicketId,
        session_scope: effectiveScope,
        is_write_allowed: effectiveWrite,
        view_as_user_id: viewAsUserId,
        expires_at: expiresAt,
        duration_minutes: durationMinutes,
        reason: reason.trim(),
        audit_id: auditId
      }
    });

    return {
      sessionId,
      tenantId,
      ticketId: effectiveTicketId,
      sessionScope: effectiveScope,
      isWriteAllowed: effectiveWrite,
      rawToken,
      expiresAt,
      viewAsUserId,
      actorId: supportPrincipalId,
      approvalRequired: true,
      approvalStatus: 'pending',
      tenantApprovalId,
      tenantApprovalToken: rawTenantApprovalToken,
      tenantApprovalExpiresAt: expiresAt
    };
  }

  async validateSupportSession(rawToken) {
    if (!rawToken) return null;
    const tokenHash = sha256(rawToken);
    const sql = 'SELECT * FROM neem_support_sessions WHERE token_hash = $1';
    const res = await this.db.query(sql, [tokenHash]);
    const session = res.rows[0];

    if (!session) return null;
    if (session.revoked_at) return null;
    const now = new Date();
    if (now > new Date(session.expires_at)) {
      if (session.approval_required !== false && session.approval_status === 'pending') {
        await this._expirePendingApproval(session);
      }
      return null;
    }
    if (session.approval_required !== false && session.approval_status !== 'approved') return null;

    return session;
  }

  async _expirePendingApproval(session) {
    const now = new Date();
    if (session.tenant_approval_id) {
      await this.db.query(
        `UPDATE neem_support_session_approvals
         SET status = $1, approver_identity_id = $2, approver_email = $3,
             response_reason = $4, responded_at = $5
         WHERE id = $6 AND status = 'pending'
         RETURNING *`,
        ['expired', null, null, 'Approval window expired before a tenant decision.', now, session.tenant_approval_id]
      );
    }
    await this.db.query(
      `UPDATE neem_support_sessions
       SET approval_status = $1, approval_rejected_at = $3
       WHERE id = $2 RETURNING *`,
      ['expired', session.id, now]
    );
  }

  /**
   * Approves or rejects a pending support session using the one-time token
   * issued to the target tenant. The tenant owner/manager membership is
   * checked before the approval is committed and the token is never logged.
   */
  async decideTenantApproval({
    approvalToken,
    tenantId,
    decision = 'approve',
    approverIdentityId,
    approverEmail = null,
    reason
  }) {
    if (!approvalToken || !tenantId || !approverIdentityId) {
      throw new Error('APPROVAL_ERROR: approvalToken, tenantId, and approverIdentityId are required.');
    }
    if (!reason || String(reason).trim().length < 5) {
      throw new Error('APPROVAL_REASON_REQUIRED: Tenant approval/rejection requires a documented reason (min 5 characters).');
    }

    const normalizedDecision = String(decision || 'approve').toLowerCase();
    const status = ['approve', 'approved', 'allow'].includes(normalizedDecision)
      ? 'approved'
      : ['reject', 'rejected', 'deny', 'denied'].includes(normalizedDecision)
        ? 'rejected'
        : null;
    if (!status) throw new Error('APPROVAL_DECISION_INVALID: decision must be approve or reject.');

    const membership = await identityService.getMembership(tenantId, approverIdentityId);
    if (!membership || !['owner', 'manager'].includes(membership.role) || membership.status !== 'active' || membership.identity_status !== 'active') {
      throw new Error('TENANT_APPROVER_NOT_AUTHORIZED: Only an active tenant owner or manager may decide this approval.');
    }

    const tokenHash = sha256(approvalToken);
    const approvalRes = await this.db.query(
      'SELECT * FROM neem_support_session_approvals WHERE token_hash = $1',
      [tokenHash]
    );
    const approval = approvalRes.rows?.[0];
    if (!approval) throw new Error('SUPPORT_APPROVAL_INVALID: Approval token is invalid or already consumed.');
    if (approval.tenant_id !== tenantId) throw new Error('TENANT_ISOLATION: Approval token does not belong to the requested tenant.');
    if (approval.status !== 'pending') throw new Error(`SUPPORT_APPROVAL_ALREADY_DECIDED: Approval is already ${approval.status}.`);

    const now = new Date();
    if (now > new Date(approval.expires_at)) {
      await this._expirePendingApproval({ id: approval.session_id, tenant_approval_id: approval.id });
      throw new Error('SUPPORT_APPROVAL_EXPIRED: Approval token has expired.');
    }

    // A decision must never consume the one-time approval token without also
    // changing the corresponding support session. Keep both writes on the
    // same client so PostgreSQL (and the in-memory transaction adapter used
    // by tests) can roll them back together if either write fails.
    const txClient = await getDatabaseClient(this.db);
    let committed = false;
    try {
      await txClient.query('BEGIN');
      const updatedApproval = await txClient.query(
        `UPDATE neem_support_session_approvals
         SET status = $1, approver_identity_id = $2, approver_email = $3,
             response_reason = $4, responded_at = $5
         WHERE id = $6 AND status = 'pending'
         RETURNING *`,
        [status, approverIdentityId, approverEmail || membership.email || null, String(reason).trim(), now, approval.id]
      );
      if (!updatedApproval.rows?.[0]) {
        throw new Error('SUPPORT_APPROVAL_ALREADY_DECIDED: Approval was consumed by another request.');
      }

      const updatedSession = await txClient.query(
        `UPDATE neem_support_sessions
         SET approval_status = $1,
             approved_at = CASE WHEN $1 = 'approved' THEN $3 ELSE NULL END,
             approval_rejected_at = CASE WHEN $1 = 'rejected' THEN $3 ELSE NULL END
         WHERE id = $2 RETURNING *`,
        [status, approval.session_id, now]
      );
      if (!updatedSession.rows?.[0]) {
        throw new Error('SUPPORT_APPROVAL_SESSION_NOT_FOUND: Support session is unavailable for approval.');
      }

      await txClient.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) await txClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      txClient.release?.();
    }

    await auditService.recordEvent({
      actorId: approverIdentityId,
      actorRole: membership.role === 'owner' ? 'tenant_owner' : 'tenant_manager',
      action: status === 'approved' ? 'SUPPORT_SESSION_TENANT_APPROVED' : 'SUPPORT_SESSION_TENANT_REJECTED',
      targetType: 'support_session',
      targetId: approval.session_id,
      tenantId,
      metadata: {
        approval_id: approval.id,
        approver_email: approverEmail || membership.email || null,
        decision: status,
        reason: String(reason).trim()
      }
    });

    return {
      approvalId: approval.id,
      sessionId: approval.session_id,
      tenantId,
      status,
      approverIdentityId,
      respondedAt: now,
      expiresAt: approval.expires_at
    };
  }

  async revokeSession(sessionId, actorId = 'platform_system') {
    if (!sessionId) throw new Error('SESSION_ERROR: sessionId is required.');
    const sql = 'UPDATE neem_support_sessions SET revoked_at = now() WHERE id = $1 RETURNING *';
    const res = await this.db.query(sql, [sessionId]);
    const session = res.rows[0];

    if (session) {
      await auditService.recordEvent({
        actorId,
        action: 'SUPPORT_SESSION_REVOKED',
        targetType: 'support_session',
        targetId: sessionId,
        tenantId: session.tenant_id,
        metadata: {
          session_id: sessionId,
          revoked_at: new Date()
        }
      });
    }

    return { revoked: Boolean(session), sessionId };
  }

  async revokeAllSessions(tenantId = null, actorId = 'platform_system') {
    let sql = 'UPDATE neem_support_sessions SET revoked_at = now() WHERE revoked_at IS NULL';
    const params = [];
    if (tenantId) {
      sql += ' AND tenant_id = $1';
      params.push(tenantId);
    }
    sql += ' RETURNING *';
    const res = await this.db.query(sql, params);

    await auditService.recordEvent({
      actorId,
      action: 'SUPPORT_ALL_SESSIONS_REVOKED',
      targetType: 'support_session',
      targetId: tenantId || 'global',
      tenantId,
      metadata: { revoked_count: res.rows.length }
    });

    return { revokedCount: res.rows.length };
  }

  async listActiveSessions(tenantId = null) {
    const res = await this.db.query('SELECT * FROM neem_support_sessions');
    const now = new Date();
    let rows = res.rows.filter(s =>
      !s.revoked_at &&
      new Date(s.expires_at) > now &&
      (s.approval_required === false || s.approval_status === 'approved')
    );
    if (tenantId) {
      rows = rows.filter(s => s.tenant_id === tenantId);
    }
    return rows.map(s => ({
      id: s.id,
      ticket_id: s.ticket_id,
      tenant_id: s.tenant_id,
      support_principal_id: s.support_principal_id,
      actor_id: s.actor_id || s.support_principal_id,
      view_as_user_id: s.view_as_user_id,
      session_scope: s.session_scope,
      is_write_allowed: s.is_write_allowed,
      approval_required: s.approval_required !== false,
      approval_status: s.approval_status || 'pending',
      reason: s.reason,
      expires_at: s.expires_at,
      created_at: s.created_at,
      remainingMinutes: Math.max(0, Math.round((new Date(s.expires_at) - now) / 60000))
    }));
  }

  // =========================================================================
  // 3. TENANT CUSTOMER DIRECTORY & CONTROLLED PII ACCESS (GM-17)
  // =========================================================================

  /**
   * Search customer directory with strict tenant isolation and default masking
   */
  async searchCustomers({ tenantId, query = null, searchType = 'all', limit = 50 }) {
    if (!tenantId) throw new Error('TENANT_REQUIRED: Customer search requires explicit tenantId.');

    let sql = 'SELECT * FROM neem_tenant_customers WHERE tenant_id = $1';
    const params = [tenantId];

    if (searchType === 'exact_phone' && query) {
      const phoneHash = cryptoPii.computePhoneHash(query);
      sql += ' AND phone_hash = $2';
      params.push(phoneHash);
    } else if (searchType === 'last4' && query) {
      const cleanLast4 = String(query).replace(/\D/g, '').slice(-4);
      sql += ' AND phone_last4 = $2';
      params.push(cleanLast4);
    }

    const res = await this.db.query(sql, params);
    let rows = res.rows;

    if (searchType === 'name' && query) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(c => c.full_name && c.full_name.toLowerCase().includes(q));
    } else if (searchType === 'all' && query) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(c =>
        (c.full_name && c.full_name.toLowerCase().includes(q)) ||
        (c.id && c.id.toLowerCase().includes(q)) ||
        (c.phone_last4 && c.phone_last4.includes(q))
      );
    }

    // Mask phone numbers by default! Plaintext phone is NEVER returned here!
    return rows.slice(0, limit).map(c => {
      let maskedPhone = '***';
      try {
        const plain = cryptoPii.decrypt(c.phone_encrypted);
        maskedPhone = cryptoPii.maskPhone(plain);
      } catch (e) {
        maskedPhone = '09***' + (c.phone_last4 || '****');
      }

      return {
        id: c.id,
        tenant_id: c.tenant_id,
        full_name: c.full_name,
        phone_masked: maskedPhone,
        phone_last4: c.phone_last4,
        loyalty_tier: c.loyalty_tier || 'standard',
        orders_count: c.orders_count || 0,
        total_spend: c.total_spend || 0,
        last_interaction_at: c.last_interaction_at,
        created_at: c.created_at
      };
    });
  }

  /**
   * Controlled PII Reveal with mandatory reason and append-only audit
   */
  async revealCustomerPhone({ customerId, tenantId, reason, actorId, actorRole = 'platform_support', sessionId = null }) {
    if (!customerId) {
      throw new Error('PARAM_ERROR: customerId is required.');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('REASON_REQUIRED: Documented reason (min 5 characters) is strictly mandatory for unmasking PII.');
    }

    const res = await this.db.query('SELECT * FROM neem_tenant_customers WHERE id = $1', [customerId]);
    const customer = res.rows[0];
    if (!customer) {
      throw new Error(`CUSTOMER_NOT_FOUND: Customer '${customerId}' does not exist.`);
    }
    const effectiveTenantId = tenantId || customer.tenant_id;
    if (customer.tenant_id !== effectiveTenantId) {
      throw new Error('TENANT_ISOLATION: Customer does not belong to the requested tenant.');
    }

    const plainPhone = cryptoPii.decrypt(customer.phone_encrypted);
    const maskedPhone = cryptoPii.maskPhone(plainPhone);
    const auditId = 'pii_aud_' + crypto.randomUUID().slice(0, 16);

    // Record in dedicated PII access audit table
    await this.db.query(`
      INSERT INTO neem_pii_access_audit
        (id, actor_id, support_actor_id, tenant_id, session_id, target_resource, action, reason, masked_before, masked_after)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      auditId,
      actorId,
      sessionId ? actorId : null,
      tenantId,
      sessionId,
      `customer:${customerId}:phone`,
      'REVEAL',
      reason.trim(),
      maskedPhone,
      maskedPhone
    ]);

    // Record in immutable platform audit events
    await auditService.recordEvent({
      actorId,
      actorRole: actorRole || 'platform_support',
      action: 'PII_REVEALED',
      targetType: 'customer_phone',
      targetId: customerId,
      tenantId,
      metadata: {
        reason: reason.trim(),
        session_id: sessionId,
        audit_id: auditId
      }
    });

    return {
      customerId,
      tenantId,
      fullPhone: plainPhone,
      maskedPreview: maskedPhone,
      revealedAt: new Date().toISOString(),
      auditId
    };
  }

  /**
   * Legacy wrapper for revealPii
   */
  async revealPii({ ciphertext, reason, actorId, actorRole = 'platform_support', tenantId }) {
    if (!ciphertext || !reason || reason.trim().length < 5) {
      throw new Error('REASON_REQUIRED: Explicit documented reason (min 5 chars) is mandatory for unmasking PII.');
    }

    const plaintext = cryptoPii.decrypt(ciphertext);

    await auditService.recordEvent({
      actorId,
      actorRole: actorRole || 'platform_support',
      action: 'PII_REVEALED',
      targetType: 'pii_data',
      targetId: sha256(ciphertext).slice(0, 16),
      tenantId,
      metadata: { reason: reason.trim() }
    });

    return {
      plaintext,
      maskedPreview: cryptoPii.maskPhone(plaintext),
      revealedAt: new Date().toISOString()
    };
  }

  /**
   * Scoped Minimal Export with watermark and manifest (GM-26)
   */
  async exportCustomers({ tenantId, reason, actorId, sessionId = null }) {
    if (!tenantId || !reason || reason.trim().length < 5) {
      throw new Error('EXPORT_ERROR: tenantId and documented reason (min 5 characters) are required.');
    }

    const customers = await this.searchCustomers({ tenantId, limit: 1000 });
    const exportId = 'exp_' + crypto.randomUUID().slice(0, 16);
    const auditId = 'aud_exp_' + crypto.randomUUID().slice(0, 12);
    const exportTimestamp = new Date().toISOString();

    const watermark = `خروجی محرمانه پلتفرم NEEM — اپراتور: ${actorId} — مستأجر: ${tenantId} — زمان: ${exportTimestamp} — شناسه پیگیری: ${auditId}`;

    const manifest = {
      exportId,
      auditId,
      tenantId,
      requestedBy: actorId,
      sessionId,
      reason: reason.trim(),
      recordCount: customers.length,
      watermark,
      generatedAt: exportTimestamp,
      sha256Digest: sha256(JSON.stringify(customers))
    };

    // Record in dedicated PII access audit table
    await this.db.query(`
      INSERT INTO neem_pii_access_audit
        (id, actor_id, support_actor_id, tenant_id, session_id, target_resource, action, reason, watermark_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      auditId,
      actorId,
      sessionId ? actorId : null,
      tenantId,
      sessionId,
      `tenant:${tenantId}:customers_export`,
      'EXPORT',
      reason.trim(),
      exportId
    ]);

    await auditService.recordEvent({
      actorId,
      action: 'PII_EXPORT_GENERATED',
      targetType: 'customer_export',
      targetId: exportId,
      tenantId,
      metadata: manifest
    });

    return {
      manifest,
      data: customers
    };
  }

  // =========================================================================
  // 4. SCOPED READ-ONLY DIAGNOSTICS (GM-27)
  // =========================================================================

  /**
   * Runs scoped, read-only diagnostic checks
   * Absolutely NO mutating or vague "fix-all" operations
   */
  async runScopedDiagnostics({ tenantId = null, actorId = 'platform_support' } = {}) {
    const checks = {};

    // 1. Database connectivity and query responsiveness
    const dbStart = Date.now();
    try {
      await this.db.query('SELECT 1');
      checks.database_connectivity = {
        status: 'healthy',
        latencyMs: Date.now() - dbStart,
        message: 'اتصال فعال و پاسخگویی پایگاه داده تایید شد.'
      };
    } catch (e) {
      checks.database_connectivity = {
        status: 'failed',
        error: e.message
      };
    }

    // 2. Migration Schema Consistency. A missing/unreadable ledger is a
    // failed diagnostic, never a healthy fallback with a fabricated count.
    try {
      const migRes = await this.db.query('SELECT version, checksum_sha256 FROM neem_control_migrations');
      const migrations = loadMigrations();
      const applied = new Map((migRes.rows || []).map((row) => [String(row.version).padStart(3, '0'), row]));
      const missing = migrations
        .filter((migration) => !applied.has(migration.version))
        .map((migration) => migration.version);
      const checksumDrift = migrations
        .filter((migration) => {
          const row = applied.get(migration.version);
          return row?.checksum_sha256 && row.checksum_sha256 !== migration.checksumSha256;
        })
        .map((migration) => migration.version);
      const latest = migrations[migrations.length - 1];
      checks.schema_migrations = {
        status: missing.length === 0 && checksumDrift.length === 0 ? 'healthy' : 'failed',
        appliedMigrationsCount: applied.size,
        requiredMigrationsCount: migrations.length,
        latestRequired: latest?.version || null,
        latestApplied: [...applied.keys()].sort().pop() || null,
        missingMigrations: missing,
        checksumDrift
      };
    } catch (e) {
      checks.schema_migrations = {
        status: 'failed',
        appliedMigrationsCount: 0,
        requiredMigrationsCount: loadMigrations().length,
        error: 'MIGRATION_LEDGER_UNREADABLE',
        detail: e.message
      };
    }

    // 3. Outbox and Sync State
    try {
      const obRes = await this.db.query('SELECT * FROM neem_automation_outbox');
      const pendingCount = (obRes.rows || []).filter(o => o.status === 'pending').length;
      checks.outbox_queue_lag = {
        status: pendingCount > 100 ? 'degraded' : 'healthy',
        pendingTasks: pendingCount,
        message: pendingCount === 0 ? 'صف آتباکس کاملاً تخلیه و به‌روز است.' : `تعداد ${pendingCount} تسک در صف انتظار است.`
      };
    } catch (e) {
      checks.outbox_queue_lag = {
        status: 'failed',
        pendingTasks: null,
        error: 'OUTBOX_QUEUE_UNREADABLE',
        detail: e.message
      };
    }

    // 4. Keyring Health
    try {
      const kStatus = cryptoPii.getKeyringStatus();
      checks.keyring_security = {
        status: kStatus.totalKeys > 0 ? 'healthy' : 'failed',
        currentVersion: kStatus.currentVersion,
        totalKeys: kStatus.totalKeys,
        algorithm: kStatus.algorithm
      };
    } catch (e) {
      checks.keyring_security = { status: 'failed', error: e.message };
    }

    // 5. Tenant Quota Status (if tenantId supplied)
    if (tenantId) {
      try {
        const qRes = await this.db.query('SELECT * FROM neem_billing_quotas WHERE tenant_id = $1', [tenantId]);
        checks.tenant_quotas = {
          status: 'healthy',
          meters: qRes.rows || []
        };
      } catch (e) {
        checks.tenant_quotas = { status: 'unknown' };
      }
    }

    const isAllHealthy = Object.values(checks).every(c => c.status === 'healthy');

    await auditService.recordEvent({
      actorId,
      action: 'DIAGNOSTICS_EXECUTED',
      targetType: 'system_diagnostics',
      targetId: tenantId || 'platform_global',
      tenantId: tenantId || 'global',
      metadata: {
        overall_health: isAllHealthy ? 'healthy' : 'degraded',
        checked_modules: Object.keys(checks)
      }
    });

    return {
      overallStatus: isAllHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      tenantId: tenantId || 'platform_global',
      checks
    };
  }

  // =========================================================================
  // 5. KEYRING ROTATION & GRADUAL RE-ENCRYPTION
  // =========================================================================

  async rotateKeyring({ newVersion = null, newKeyHex = null, actorId = 'platform_owner' } = {}) {
    let effectiveVersion = newVersion;
    if (!effectiveVersion) {
      const current = cryptoPii.getCurrentVersion() || 'v1';
      const num = parseInt(current.replace(/\D/g, ''), 10) || 1;
      effectiveVersion = `v${num + 1}`;
    }
    const result = cryptoPii.rotateKeyring(effectiveVersion, newKeyHex);

    await auditService.recordEvent({
      actorId,
      action: 'KEYRING_ROTATED',
      targetType: 'pii_keyring',
      targetId: newVersion,
      tenantId: 'global',
      metadata: {
        active_version: result.currentVersion,
        total_keys: result.totalKeys
      }
    });

    return result;
  }

  async reencryptCustomerBatch({ targetVersion = null, batchSize = 10, cursor = 0, actorId = 'platform_owner' }) {
    const custRes = await this.db.query('SELECT * FROM neem_tenant_customers');
    const items = custRes.rows || [];

    const batchResult = cryptoPii.reencryptBatch({
      items,
      targetVersion: targetVersion || cryptoPii.getCurrentVersion(),
      batchSize: Number(batchSize) || 10,
      cursor: Number(cursor) || 0
    });

    // Persist re-encrypted records
    for (const res of batchResult.results) {
      if (res.success && res.newCipher) {
        await this.db.query('UPDATE neem_tenant_customers SET phone_encrypted = $1 WHERE id = $2', [
          res.newCipher,
          res.id
        ]);
      }
    }

    const jobId = 'reenc_job_' + crypto.randomUUID().slice(0, 12);
    await this.db.query(`
      INSERT INTO neem_keyring_reencrypt_jobs
        (id, current_key_version, target_key_version, total_records, reencrypted_records, failed_records, cursor_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      jobId,
      cryptoPii.getCurrentVersion(),
      batchResult.targetVersion,
      batchResult.totalRecords,
      batchResult.reencrypted,
      batchResult.failed,
      batchResult.nextCursor,
      batchResult.isComplete ? 'completed' : 'in_progress'
    ]);

    await auditService.recordEvent({
      actorId,
      action: 'PII_BATCH_REENCRYPTED',
      targetType: 'reencrypt_job',
      targetId: jobId,
      tenantId: 'global',
      metadata: {
        reencrypted: batchResult.reencrypted,
        failed: batchResult.failed,
        cursor: batchResult.currentCursor,
        next_cursor: batchResult.nextCursor,
        is_complete: batchResult.isComplete
      }
    });

    return {
      jobId,
      ...batchResult
    };
  }

  async listPiiAudits(tenantId = null) {
    let sql = 'SELECT * FROM neem_pii_access_audit';
    const params = [];
    if (tenantId) {
      sql += ' WHERE tenant_id = $1';
      params.push(tenantId);
    }
    sql += ' ORDER BY created_at DESC';
    const res = await this.db.query(sql, params);
    return res.rows;
  }
}

module.exports = new SupportService();

// server/salsa/control-plane/tenant/invitation-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { sha256 } = require('../auth/crypto-util');
const auditService = require('../audit/audit-service');

class InvitationService {
  constructor({ db = getDatabase(), audit = auditService } = {}) {
    this.db = db;
    this.audit = audit;
  }

  async createInvitation({
    tenantId,
    email,
    phone = null,
    role = 'owner',
    createdBy = 'platform_system',
    expiryHours = 48
  }) {
    if (!tenantId || !email) {
      throw new Error('Validation Error: tenantId and email are required.');
    }

    const rawToken = 'inv_' + crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);

    const sql = `
      INSERT INTO neem_tenant_invitations
        (id, tenant_id, email, phone, role, token_hash, status, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      inviteId,
      tenantId,
      email.toLowerCase().trim(),
      phone,
      role,
      tokenHash,
      'pending',
      expiresAt,
      createdBy
    ]);

    await this.audit.recordEvent({
      actorId: createdBy,
      action: 'TENANT_INVITATION_CREATED',
      targetType: 'tenant_invitation',
      targetId: inviteId,
      tenantId,
      metadata: { email, role, expires_at: expiresAt }
    });

    return {
      invitationId: inviteId,
      tenantId,
      email,
      role,
      rawToken, // Sent to user via secure channel, NOT persisted in DB
      expiresAt
    };
  }

  async acceptInvitation(rawToken, newPassword) {
    if (!rawToken) {
      throw new Error('Validation Error: rawToken is required.');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      throw new Error('Validation Error: newPassword must be at least 12 characters.');
    }

    // The current tenant schema has no durable credential hash or membership
    // activation transaction. Consuming a valid token and returning "accepted"
    // here would claim a login was provisioned when it was not. Keep the token
    // pending until credential + membership activation is implemented together.
    const error = new Error(
      'Invitation acceptance is unavailable until tenant credentials and the verified membership session are provisioned atomically.'
    );
    error.code = 'INVITATION_ACCOUNT_PROVISIONING_UNAVAILABLE';
    error.status = 503;
    throw error;
  }

  async listInvitations(tenantId) {
    if (!tenantId) return [];
    const sql = 'SELECT id, tenant_id, email, phone, role, status, expires_at, created_at, accepted_at FROM neem_tenant_invitations WHERE tenant_id = $1 ORDER BY created_at DESC';
    const res = await this.db.query(sql, [tenantId]);
    return res.rows;
  }
}

const invitationService = new InvitationService();
invitationService.InvitationService = InvitationService;

module.exports = invitationService;

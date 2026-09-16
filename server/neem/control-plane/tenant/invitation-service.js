// server/neem/control-plane/tenant/invitation-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { sha256 } = require('../auth/crypto-util');
const auditService = require('../audit/audit-service');

class InvitationService {
  constructor() {
    this.db = getDatabase();
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

    await auditService.recordEvent({
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
    const tokenHash = sha256(rawToken);

    const sql = `
      SELECT * FROM neem_tenant_invitations 
      WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
    `;
    const res = await this.db.query(sql, [tokenHash]);
    const invite = res.rows[0];

    if (!invite) {
      throw new Error('INVITATION_INVALID_OR_EXPIRED: Token does not exist, has already been used, or has expired.');
    }

    // Mark as accepted
    await this.db.query(
      `UPDATE neem_tenant_invitations SET status = 'accepted', accepted_at = now() WHERE id = $1`,
      [invite.id]
    );

    await auditService.recordEvent({
      actorId: invite.email,
      action: 'TENANT_INVITATION_ACCEPTED',
      targetType: 'tenant_invitation',
      targetId: invite.id,
      tenantId: invite.tenant_id,
      metadata: { email: invite.email, role: invite.role }
    });

    return {
      accepted: true,
      tenantId: invite.tenant_id,
      email: invite.email,
      role: invite.role
    };
  }

  async listInvitations(tenantId) {
    if (!tenantId) return [];
    const sql = 'SELECT id, tenant_id, email, phone, role, status, expires_at, created_at, accepted_at FROM neem_tenant_invitations WHERE tenant_id = $1 ORDER BY created_at DESC';
    const res = await this.db.query(sql, [tenantId]);
    return res.rows;
  }
}

module.exports = new InvitationService();

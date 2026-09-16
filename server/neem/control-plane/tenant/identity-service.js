// server/neem/control-plane/tenant/identity-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

const VALID_ROLES = ['owner', 'manager', 'accountant', 'cashier', 'kitchen', 'waiter', 'support'];
const VALID_MEMBERSHIP_STATUSES = ['active', 'suspended', 'revoked'];
const VALID_IDENTITY_TYPES = ['platform_operator', 'restaurant_staff', 'guest'];

class IdentityService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * List memberships for a tenant with optional filtering
   */
  async listMemberships(tenantId, filters = {}) {
    if (!tenantId) {
      throw new Error('VALIDATION_ERROR: tenantId is required.');
    }

    const sql = `
      SELECT m.*, i.display_name, i.email, i.phone, i.identity_type, i.mfa_enabled, i.status AS identity_status
      FROM neem_tenant_memberships m
      JOIN neem_tenant_identities i ON m.identity_id = i.id
      WHERE m.tenant_id = $1
      ORDER BY m.created_at ASC
    `;

    const res = await this.db.query(sql, [tenantId]);
    let items = res.rows || [];

    if (filters.status && VALID_MEMBERSHIP_STATUSES.includes(filters.status)) {
      items = items.filter(m => m.status === filters.status);
    }

    if (filters.role && VALID_ROLES.includes(filters.role)) {
      items = items.filter(m => m.role === filters.role);
    }

    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      items = items.filter(m => 
        (m.display_name && m.display_name.toLowerCase().includes(q)) ||
        (m.email && m.email.toLowerCase().includes(q)) ||
        (m.phone && m.phone.includes(q)) ||
        (m.identity_id && m.identity_id.toLowerCase().includes(q))
      );
    }

    return items;
  }

  /**
   * Get single membership detail by ID or identityId
   */
  async getMembership(tenantId, idOrIdentityId) {
    if (!tenantId || !idOrIdentityId) {
      throw new Error('VALIDATION_ERROR: tenantId and idOrIdentityId are required.');
    }

    const sql = `
      SELECT m.*, i.display_name, i.email, i.phone, i.identity_type, i.mfa_enabled, i.status AS identity_status
      FROM neem_tenant_memberships m
      JOIN neem_tenant_identities i ON m.identity_id = i.id
      WHERE m.tenant_id = $1 AND (m.id = $2 OR m.identity_id = $2)
      LIMIT 1
    `;

    const res = await this.db.query(sql, [tenantId, idOrIdentityId]);
    return res.rows && res.rows.length > 0 ? res.rows[0] : null;
  }

  /**
   * Invite / create new tenant member
   */
  async createMembership({
    tenantId,
    email,
    displayName,
    phone = null,
    role = 'cashier',
    branchScope = '*',
    activeSessions = 1,
    identityType = 'restaurant_staff',
    mfaEnabled = false,
    metadata = {},
    actorId = 'system'
  }) {
    if (!tenantId || !email || !displayName) {
      const err = new Error('VALIDATION_ERROR: tenantId, email, and displayName are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const normalizedRole = (role || 'cashier').toLowerCase().trim();
    if (!VALID_ROLES.includes(normalizedRole)) {
      const err = new Error(`VALIDATION_ERROR: Role '${role}' is invalid. Allowed: ${VALID_ROLES.join(', ')}`);
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Find or create Identity
    let identityRes = await this.db.query(
      `SELECT * FROM neem_tenant_identities WHERE LOWER(email) = $1 LIMIT 1`,
      [normalizedEmail]
    );

    let identity = identityRes.rows && identityRes.rows[0];
    if (!identity) {
      const identityId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const insertIdentitySql = `
        INSERT INTO neem_tenant_identities
          (id, display_name, email, phone, identity_type, status, mfa_enabled, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
        RETURNING *
      `;
      const createdIdentRes = await this.db.query(insertIdentitySql, [
        identityId,
        displayName.trim(),
        normalizedEmail,
        phone,
        VALID_IDENTITY_TYPES.includes(identityType) ? identityType : 'restaurant_staff',
        'active',
        Boolean(mfaEnabled),
        JSON.stringify(metadata)
      ]);
      identity = createdIdentRes.rows[0];
    }

    // 2. Check if membership already exists
    const existingMem = await this.getMembership(tenantId, identity.id);
    if (existingMem) {
      const err = new Error(`MEMBERSHIP_ALREADY_EXISTS: Identity '${identity.email}' already has a membership in tenant '${tenantId}'.`);
      err.code = 'MEMBERSHIP_ALREADY_EXISTS';
      throw err;
    }

    // 3. Create Membership
    const membershipId = 'mem_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const insertMemSql = `
      INSERT INTO neem_tenant_memberships
        (id, tenant_id, identity_id, role, branch_scope, status, active_sessions, invited_at, accepted_at, invited_by, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8, $9, now(), now())
      RETURNING *
    `;

    const createdMemRes = await this.db.query(insertMemSql, [
      membershipId,
      tenantId,
      identity.id,
      normalizedRole,
      branchScope || '*',
      'active',
      activeSessions || 1,
      actorId,
      JSON.stringify(metadata)
    ]);

    const created = createdMemRes.rows[0];

    // 4. Immutable Audit Log
    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_CREATED',
      targetType: 'tenant_membership',
      targetId: membershipId,
      tenantId,
      metadata: {
        identityId: identity.id,
        email: identity.email,
        role: normalizedRole,
        branchScope: branchScope || '*'
      }
    });

    return created;
  }

  /**
   * Update role and/or branch scope for a membership
   */
  async updateRole({ tenantId, identityId, role, branchScope = '*', actorId = 'system' }) {
    if (!tenantId || !identityId || !role) {
      const err = new Error('VALIDATION_ERROR: tenantId, identityId, and role are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const normalizedRole = role.toLowerCase().trim();
    if (!VALID_ROLES.includes(normalizedRole)) {
      const err = new Error(`VALIDATION_ERROR: Role '${role}' is invalid. Allowed: ${VALID_ROLES.join(', ')}`);
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(tenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const previousRole = current.role;
    const previousScope = current.branch_scope;

    const sql = `
      UPDATE neem_tenant_memberships
      SET role = $1, branch_scope = $2, updated_at = now()
      WHERE tenant_id = $3 AND (id = $4 OR identity_id = $4)
      RETURNING *
    `;

    const res = await this.db.query(sql, [normalizedRole, branchScope || '*', tenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_ROLE_UPDATED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId,
      metadata: {
        identityId: current.identity_id,
        previousRole,
        newRole: normalizedRole,
        previousScope,
        newScope: branchScope || '*'
      }
    });

    return updated;
  }

  /**
   * Suspend a tenant membership
   */
  async suspendMembership({ tenantId, identityId, reason = 'Operator suspension', actorId = 'system' }) {
    if (!tenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(tenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, ['suspended', tenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_SUSPENDED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId,
      metadata: {
        identityId: current.identity_id,
        reason
      }
    });

    return updated;
  }

  /**
   * Reactivate a suspended membership
   */
  async reactivateMembership({ tenantId, identityId, actorId = 'system' }) {
    if (!tenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(tenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, ['active', tenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_REACTIVATED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId,
      metadata: {
        identityId: current.identity_id
      }
    });

    return updated;
  }

  /**
   * Immediately revoke membership and terminate sessions
   */
  async revokeMembership({ tenantId, identityId, reason = 'Operator revocation', actorId = 'system' }) {
    if (!tenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(tenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = 'revoked', revoked_at = now(), revoked_by = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, [actorId, tenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_REVOKED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId,
      metadata: {
        identityId: current.identity_id,
        reason,
        revokedBy: actorId
      }
    });

    return updated;
  }

  /**
   * Delete membership / remove invitation
   */
  async deleteMembership({ tenantId, identityId, actorId = 'system' }) {
    if (!tenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(tenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${tenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    await this.db.query(
      `DELETE FROM neem_tenant_memberships WHERE id = $1 AND tenant_id = $2`,
      [current.id, tenantId]
    );

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_DELETED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId,
      metadata: {
        identityId: current.identity_id
      }
    });

    return { success: true, deleted: true };
  }
}

module.exports = new IdentityService();

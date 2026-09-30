// server/salsa/control-plane/tenant/identity-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');
const { normalizeTenantId } = require('../../tenant-context');

const VALID_ROLES = ['owner', 'manager', 'accountant', 'cashier', 'kitchen', 'waiter', 'support'];
const VALID_MEMBERSHIP_STATUSES = ['active', 'suspended', 'revoked'];
const BRANCH_SCOPE_KEY_PATTERN = /^br_[a-z0-9][a-z0-9_-]{0,58}$/;

function membershipError(code, message, status = 409) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.status = status;
  return error;
}

function requireCanonicalTenantId(value) {
  const tenantId = normalizeTenantId(value);
  if (!tenantId) {
    throw membershipError('TENANT_CONTEXT_INVALID', 'A canonical tenant id is required.', 400);
  }
  return tenantId;
}

function normalizeBranchScope(role, branchScope) {
  if (typeof branchScope !== 'string' || !branchScope.trim()) {
    throw membershipError('BRANCH_SCOPE_REQUIRED', 'An explicit tenant branch scope is required.', 422);
  }

  const scope = branchScope.trim().toLowerCase();
  if (scope === '*') {
    throw membershipError(
      'BRANCH_SCOPE_REQUIRES_ASSIGNMENT',
      'All-branches access is disabled until the platform branch-scope policy is confirmed; assign one explicit branch.',
      422,
    );
  }

  if (!BRANCH_SCOPE_KEY_PATTERN.test(scope)) {
    throw membershipError(
      'BRANCH_SCOPE_INVALID',
      'Branch scope must be an explicit canonical branch key such as br_central.',
      422,
    );
  }
  return scope;
}

/**
 * Turn a currently active membership into a runtime-safe branch grant. The
 * registry is supplied by a trusted tenant adapter; request values are never
 * accepted as a branch-id mapping. Control Plane IDs do not equal WESTO's
 * numeric branch IDs unless this mapping proves that they do.
 */
function resolveMembershipAccess(membership, {
  tenantId,
  identityId,
  membershipId,
  branchRegistry,
} = {}) {
  const expectedTenant = normalizeTenantId(tenantId);
  const actualTenant = normalizeTenantId(membership?.tenant_id);
  if (!expectedTenant || actualTenant !== expectedTenant) {
    throw membershipError('TENANT_BOUNDARY_VIOLATION', 'Membership is not bound to the resolved tenant.', 403);
  }
  if (String(membership?.identity_id || '') !== String(identityId || '')
    || String(membership?.id || '') !== String(membershipId || '')) {
    throw membershipError('MEMBERSHIP_BINDING_MISMATCH', 'Session identity and membership do not match.', 401);
  }
  if (membership.status !== 'active') {
    throw membershipError('MEMBERSHIP_INACTIVE', 'Tenant membership is not active.', 403);
  }
  if (membership.identity_status !== 'active') {
    throw membershipError('IDENTITY_INACTIVE', 'Tenant identity is not active.', 403);
  }
  if (membership.identity_type !== 'restaurant_staff') {
    throw membershipError('IDENTITY_TYPE_CONFLICT', 'Only restaurant staff identities may access a tenant.', 403);
  }

  const role = String(membership.role || '').trim().toLowerCase();
  if (!VALID_ROLES.includes(role)) {
    throw membershipError('MEMBERSHIP_ROLE_INVALID', 'Membership role is not recognized.', 403);
  }
  const scope = normalizeBranchScope(role, membership.branch_scope);
  const registry = Array.isArray(branchRegistry) ? branchRegistry : null;
  if (!registry) {
    throw membershipError('BRANCH_SCOPE_MAPPING_UNAVAILABLE', 'A trusted tenant branch mapping is required.', 503);
  }

  const tenantBranches = registry.filter((branch) =>
    String(branch?.tenantId || '').trim().toLowerCase() === expectedTenant);
  if (tenantBranches.some((branch) => typeof branch.active !== 'boolean')) {
    throw membershipError('BRANCH_SCOPE_MAPPING_UNAVAILABLE', 'Tenant branch mapping must include an explicit active state.', 503);
  }
  const activeTenantBranches = tenantBranches.filter((branch) => branch.active === true);
  const toRuntimeId = (branch) => {
    const runtimeBranchId = Number(branch?.runtimeBranchId);
    return Number.isSafeInteger(runtimeBranchId) && runtimeBranchId > 0 ? runtimeBranchId : null;
  };
  const activeScopeKeys = activeTenantBranches.map((branch) => String(branch?.scopeKey || '').trim().toLowerCase());
  const activeRuntimeIds = activeTenantBranches.map(toRuntimeId);
  if (activeScopeKeys.some((key) => !BRANCH_SCOPE_KEY_PATTERN.test(key))
    || activeRuntimeIds.some((id) => !id)
    || new Set(activeScopeKeys).size !== activeScopeKeys.length
    || new Set(activeRuntimeIds).size !== activeRuntimeIds.length) {
    throw membershipError('BRANCH_SCOPE_MAPPING_UNAVAILABLE', 'Tenant branch mapping is incomplete or ambiguous.', 503);
  }

  if (!BRANCH_SCOPE_KEY_PATTERN.test(scope)) {
    throw membershipError('BRANCH_SCOPE_INVALID', 'Membership has no explicit valid branch assignment.', 403);
  }
  const matches = activeTenantBranches.filter((branch) => String(branch?.scopeKey || '').trim().toLowerCase() === scope);
  if (matches.length !== 1 || !toRuntimeId(matches[0])) {
    throw membershipError('BRANCH_SCOPE_MAPPING_UNAVAILABLE', 'The assigned branch has no unique verified runtime mapping.', 503);
  }
  const allowedBranchIds = [toRuntimeId(matches[0])];

  return Object.freeze({
    tenantId: expectedTenant,
    identityId: String(membership.identity_id),
    membershipId: String(membership.id),
    role,
    branchScope: scope,
    allowedBranchIds: Object.freeze(allowedBranchIds),
  });
}

class IdentityService {
  constructor({ db = getDatabase(), audit = auditService } = {}) {
    this.db = db;
    this.audit = audit;
  }

  /**
   * List memberships for a tenant with optional filtering
   */
  async listMemberships(tenantId, filters = {}) {
    const canonicalTenantId = requireCanonicalTenantId(tenantId);

    const sql = `
      SELECT m.*, i.display_name, i.email, i.phone, i.identity_type, i.mfa_enabled, i.status AS identity_status
      FROM neem_tenant_memberships m
      JOIN neem_tenant_identities i ON m.identity_id = i.id
      WHERE m.tenant_id = $1
      ORDER BY m.created_at ASC
    `;

    const res = await this.db.query(sql, [canonicalTenantId]);
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
    const canonicalTenantId = requireCanonicalTenantId(tenantId);
    if (!idOrIdentityId) {
      throw new Error('VALIDATION_ERROR: tenantId and idOrIdentityId are required.');
    }

    const sql = `
      SELECT m.*, i.display_name, i.email, i.phone, i.identity_type, i.mfa_enabled, i.status AS identity_status
      FROM neem_tenant_memberships m
      JOIN neem_tenant_identities i ON m.identity_id = i.id
      WHERE m.tenant_id = $1 AND (m.id = $2 OR m.identity_id = $2)
      LIMIT 1
    `;

    const res = await this.db.query(sql, [canonicalTenantId, idOrIdentityId]);
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
    branchScope,
    activeSessions = 1,
    identityType = 'restaurant_staff',
    mfaEnabled = false,
    metadata = {},
    actorId = 'system'
  }) {
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId || typeof email !== 'string' || !email.trim()
      || typeof displayName !== 'string' || !displayName.trim()) {
      const err = new Error('VALIDATION_ERROR: tenantId, email, and displayName are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const normalizedRole = typeof role === 'string' ? role.toLowerCase().trim() : '';
    if (!VALID_ROLES.includes(normalizedRole)) {
      const err = new Error(`VALIDATION_ERROR: Role '${role}' is invalid. Allowed: ${VALID_ROLES.join(', ')}`);
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const normalizedBranchScope = normalizeBranchScope(normalizedRole, branchScope);

    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw membershipError('VALIDATION_ERROR', 'A valid email address is required.', 422);
    }
    if (identityType !== 'restaurant_staff') {
      const err = new Error('IDENTITY_TYPE_CONFLICT: tenant memberships may only use restaurant_staff identities.');
      err.code = 'IDENTITY_TYPE_CONFLICT';
      throw err;
    }

    // 1. Find or create Identity
    let identityRes = await this.db.query(
      `SELECT * FROM neem_tenant_identities WHERE LOWER(email) = $1 LIMIT 1`,
      [normalizedEmail]
    );

    let identity = identityRes.rows && identityRes.rows[0];
    if (identity && identity.identity_type !== 'restaurant_staff') {
      throw membershipError(
        'IDENTITY_TYPE_CONFLICT',
        'Platform and guest identities cannot be attached to a restaurant membership.',
      );
    }
    if (identity) {
      throw membershipError(
        'IDENTITY_LINK_REQUIRES_VERIFICATION',
        'An existing account cannot be linked by email alone; require verified account ownership first.',
      );
    }

    if (!identity) {
      const identityId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const insertIdentitySql = `
        INSERT INTO neem_tenant_identities
          (id, display_name, email, phone, identity_type, status, mfa_enabled, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
        RETURNING *
      `;
      let createdIdentRes;
      try {
        createdIdentRes = await this.db.query(insertIdentitySql, [
          identityId,
          displayName.trim(),
          normalizedEmail,
          phone,
          'restaurant_staff',
          'active',
          Boolean(mfaEnabled),
          JSON.stringify(metadata)
        ]);
      } catch (error) {
        if (error.code === '23505') {
          throw membershipError(
            'IDENTITY_LINK_REQUIRES_VERIFICATION',
            'An account with this email was created concurrently; verified account ownership is required before linking.',
          );
        }
        throw error;
      }
      identity = createdIdentRes.rows[0];
      if (!identity || identity.id !== identityId) {
        throw membershipError(
          'IDENTITY_LINK_REQUIRES_VERIFICATION',
          'The email resolved to a different account; verified account ownership is required before linking.',
        );
      }
    }

    if (identity.identity_type !== 'restaurant_staff') {
      const err = new Error('IDENTITY_TYPE_CONFLICT: platform and guest identities cannot join a restaurant tenant.');
      err.code = 'IDENTITY_TYPE_CONFLICT';
      throw err;
    }

    // 2. Check if membership already exists
    const existingMem = await this.getMembership(canonicalTenantId, identity.id);
    if (existingMem) {
      const err = new Error(`MEMBERSHIP_ALREADY_EXISTS: Identity '${identity.email}' already has a membership in tenant '${canonicalTenantId}'.`);
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
      canonicalTenantId,
      identity.id,
      normalizedRole,
      normalizedBranchScope,
      'active',
      activeSessions || 1,
      actorId,
      JSON.stringify(metadata)
    ]);

    const created = createdMemRes.rows[0];

    // 4. Immutable Audit Log
    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_CREATED',
      targetType: 'tenant_membership',
      targetId: membershipId,
      tenantId: canonicalTenantId,
      metadata: {
        identityId: identity.id,
        email: identity.email,
        role: normalizedRole,
        branchScope: normalizedBranchScope
      }
    });

    return created;
  }

  /**
   * Update role and/or branch scope for a membership
   */
  async updateRole({ tenantId, identityId, role, branchScope, actorId = 'system' }) {
    const canonicalTenantId = requireCanonicalTenantId(tenantId);
    if (!identityId || typeof role !== 'string' || !role.trim()) {
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

    const current = await this.getMembership(canonicalTenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${canonicalTenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const nextBranchScope = normalizeBranchScope(
      normalizedRole,
      branchScope === undefined ? current.branch_scope : branchScope,
    );

    const previousRole = current.role;
    const previousScope = current.branch_scope;

    const sql = `
      UPDATE neem_tenant_memberships
      SET role = $1, branch_scope = $2, updated_at = now()
      WHERE tenant_id = $3 AND (id = $4 OR identity_id = $4)
      RETURNING *
    `;

    const res = await this.db.query(sql, [normalizedRole, nextBranchScope, canonicalTenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_ROLE_UPDATED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId: canonicalTenantId,
      metadata: {
        identityId: current.identity_id,
        previousRole,
        newRole: normalizedRole,
        previousScope,
        newScope: nextBranchScope
      }
    });

    return updated;
  }

  /** Resolve the current, exact identity+membership tuple before issuing or validating a session. */
  async resolveSessionMembership({ tenantId, identityId, membershipId, branchRegistry } = {}) {
    if (!identityId || !membershipId) {
      throw membershipError('MEMBERSHIP_BINDING_REQUIRED', 'tenantId, identityId, and membershipId are required.', 401);
    }
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId) {
      throw membershipError('TENANT_CONTEXT_INVALID', 'A canonical tenant id is required.', 401);
    }
    const sql = `
      SELECT m.*, i.identity_type, i.status AS identity_status
      FROM neem_tenant_memberships m
      JOIN neem_tenant_identities i ON i.id = m.identity_id
      WHERE m.tenant_id = $1 AND m.identity_id = $2 AND m.id = $3
      LIMIT 1
    `;
    const result = await this.db.query(sql, [canonicalTenantId, identityId, membershipId]);
    const membership = result.rows && result.rows[0];
    if (!membership) {
      throw membershipError('MEMBERSHIP_NOT_FOUND', 'The tenant membership bound to this session was not found.', 401);
    }
    return resolveMembershipAccess(membership, { tenantId: canonicalTenantId, identityId, membershipId, branchRegistry });
  }

  /**
   * Suspend a tenant membership
   */
  async suspendMembership({ tenantId, identityId, reason = 'Operator suspension', actorId = 'system' }) {
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(canonicalTenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${canonicalTenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, ['suspended', canonicalTenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_SUSPENDED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId: canonicalTenantId,
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
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(canonicalTenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${canonicalTenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, ['active', canonicalTenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_REACTIVATED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId: canonicalTenantId,
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
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(canonicalTenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${canonicalTenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const sql = `
      UPDATE neem_tenant_memberships
      SET status = 'revoked', revoked_at = now(), revoked_by = $1, updated_at = now()
      WHERE tenant_id = $2 AND (id = $3 OR identity_id = $3)
      RETURNING *
    `;

    const res = await this.db.query(sql, [actorId, canonicalTenantId, identityId]);
    const updated = res.rows && res.rows[0];

    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_REVOKED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId: canonicalTenantId,
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
    const canonicalTenantId = normalizeTenantId(tenantId);
    if (!canonicalTenantId || !identityId) {
      const err = new Error('VALIDATION_ERROR: tenantId and identityId are required.');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const current = await this.getMembership(canonicalTenantId, identityId);
    if (!current) {
      const err = new Error(`NOT_FOUND: Membership for identity '${identityId}' in tenant '${canonicalTenantId}' not found.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    await this.db.query(
      `DELETE FROM neem_tenant_memberships WHERE id = $1 AND tenant_id = $2`,
      [current.id, canonicalTenantId]
    );

    await this.audit.recordEvent({
      actorId,
      action: 'TENANT_MEMBERSHIP_DELETED',
      targetType: 'tenant_membership',
      targetId: current.id,
      tenantId: canonicalTenantId,
      metadata: {
        identityId: current.identity_id
      }
    });

    return { success: true, deleted: true };
  }
}

const identityService = new IdentityService();
identityService.IdentityService = IdentityService;
identityService.normalizeBranchScope = normalizeBranchScope;
identityService.resolveMembershipAccess = resolveMembershipAccess;

module.exports = identityService;

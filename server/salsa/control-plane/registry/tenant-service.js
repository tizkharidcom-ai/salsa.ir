// server/salsa/control-plane/registry/tenant-service.js
'use strict';

const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

class TenantRegistryService {
  constructor() {
    this.db = getDatabase();
  }

  // 1. List Tenants (Metadata Only - Zero PII / Zero Orders)
  async listTenants() {
    const sql = `
      SELECT 
        tenant_id, 
        display_name, 
        status, 
        plan_code, 
        cell_id, 
        canonical_domain, 
        created_at, 
        updated_at,
        metadata
      FROM neem_tenants
      ORDER BY created_at DESC
    `;
    const result = await this.db.query(sql);
    return result.rows.map(this.sanitizeTenantView);
  }

  // 2. Get Single Tenant Detail
  async getTenant(tenantId) {
    if (!tenantId) return null;
    const sql = `
      SELECT 
        tenant_id, 
        display_name, 
        status, 
        plan_code, 
        cell_id, 
        canonical_domain, 
        created_at, 
        updated_at,
        metadata
      FROM neem_tenants
      WHERE tenant_id = $1
    `;
    const result = await this.db.query(sql, [tenantId.trim().toLowerCase()]);
    if (!result.rows[0]) return null;
    return this.sanitizeTenantView(result.rows[0]);
  }

  // 3. Create Draft Tenant (Metadata Registration Only)
  async createDraftTenant({
    tenantId,
    displayName,
    planCode = 'starter',
    cellId = 'cell-teh-01',
    canonicalDomain = null,
    metadata = {},
    actorId = 'system'
  }) {
    if (!tenantId || !displayName) {
      throw new Error('Validation Error: tenantId and displayName are mandatory.');
    }

    const cleanId = tenantId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-_]{1,62}$/.test(cleanId)) {
      throw new Error('Validation Error: tenantId must be lowercase alphanumeric with hyphens or underscores, 2-63 characters.');
    }

    const domain = canonicalDomain || `${cleanId}.demo.neem.ir`;
    const dbName = `tenant_${cleanId.replace(/-/g, '_')}`;

    // Clean commercial metadata only (ensure NO order or customer PII is included)
    const commercialMetadata = {
      organization: metadata.organization || displayName,
      branchesCount: Number(metadata.branchesCount || 1),
      templateCode: metadata.templateCode || 'tpl-blank-cafe-v1'
    };

    const sql = `
      INSERT INTO neem_tenants
        (tenant_id, display_name, status, plan_code, cell_id, database_name, database_provider, canonical_domain, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const params = [
      cleanId,
      displayName.trim(),
      'provisioning',
      planCode,
      cellId,
      dbName,
      'postgres',
      domain,
      commercialMetadata
    ];

    const result = await this.db.query(sql, params);
    const created = result.rows[0];

    // Audit Event
    await auditService.recordEvent({
      actorId,
      action: 'TENANT_DRAFT_CREATED',
      targetType: 'tenant',
      targetId: cleanId,
      tenantId: cleanId,
      metadata: { plan_code: planCode, cell_id: cellId }
    });

    return this.sanitizeTenantView(created);
  }

  // 4. Update Lifecycle Status with Reason and Auditing
  async updateLifecycleStatus({ tenantId, status, reason, actorId = 'system' }) {
    if (!tenantId || !status) {
      throw new Error('Validation Error: tenantId and status are required.');
    }
    const cleanId = tenantId.trim().toLowerCase();
    const allowedStatuses = ['active', 'suspended', 'archived', 'provisioning'];
    if (!allowedStatuses.includes(status)) {
      throw new Error(`Validation Error: invalid status '${status}'. Allowed: ${allowedStatuses.join(', ')}`);
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new Error('Validation Error: a clear reason (min 3 characters) is required for lifecycle transitions.');
    }

    const current = await this.getTenant(cleanId);
    if (!current) {
      throw new Error(`Tenant '${cleanId}' not found.`);
    }

    const sql = `
      UPDATE neem_tenants
      SET 
        status = $1,
        updated_at = NOW(),
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{lifecycle}',
          jsonb_build_object(
            'lastReason', $2::text,
            'changedBy', $3::text,
            'changedAt', NOW()::text,
            'previousStatus', $4::text
          )
        )
      WHERE tenant_id = $5
      RETURNING *
    `;

    const result = await this.db.query(sql, [status, reason.trim(), actorId, current.status, cleanId]);
    const updated = result.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'TENANT_LIFECYCLE_CHANGED',
      targetType: 'tenant',
      targetId: cleanId,
      tenantId: cleanId,
      metadata: {
        oldStatus: current.status,
        newStatus: status,
        reason: reason.trim()
      }
    });

    return this.sanitizeTenantView(updated);
  }

  // Strict Sanitizer to guarantee Zero PII / Zero Operational leakage
  sanitizeTenantView(raw) {
    if (!raw) return null;
    return {
      id: raw.tenant_id,
      tenantId: raw.tenant_id,
      displayName: raw.display_name,
      status: raw.status,
      planCode: raw.plan_code,
      cellId: raw.cell_id,
      canonicalDomain: raw.canonical_domain,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      metadata: {
        organization: raw.metadata?.organization || raw.display_name,
        branchesCount: raw.metadata?.branchesCount || 1
      }
    };
  }
}

module.exports = new TenantRegistryService();

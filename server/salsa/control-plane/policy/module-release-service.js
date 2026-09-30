'use strict';

const runtime = require('../../../../modules/runtime');
const auditService = require('../audit/audit-service');
const database = require('../db/database');

function metadataFor(row) {
  const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('TENANT_METADATA_INVALID');
  return metadata;
}
function releaseError(code, status) { return Object.assign(new Error(code), { code, status }); }

class ModuleReleaseService {
  constructor({ getDatabase = database.getDatabase, getClient = database.getDatabaseClient,
    audit = auditService, releases = runtime } = {}) {
    this.getDatabase = getDatabase;
    this.getClient = getClient;
    this.audit = audit;
    this.releases = releases;
  }

  async getTenantReleases(tenantId) {
    const result = await this.getDatabase().query('SELECT tenant_id, metadata FROM neem_tenants WHERE tenant_id = $1', [tenantId]);
    if (!result.rows?.[0]) throw releaseError('TENANT_NOT_FOUND', 404);
    const metadata = metadataFor(result.rows[0]);
    const selections = this.releases.validateSelections(metadata.moduleVersions || {});
    return { tenantId, revision: metadata.moduleReleaseRevision || 0,
      moduleVersions: { ...this.releases.defaultVersions(), ...selections },
      modules: this.releases.catalog(selections) };
  }

  async assign({ tenantId, moduleKey, version, expectedRevision, reason, actorId }) {
    if (!tenantId || !actorId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || typeof reason !== 'string' || reason.trim().length < 5) throw releaseError('MODULE_RELEASE_INPUT_INVALID', 422);
    this.releases.getRelease(moduleKey, version);
    const integrity = this.releases.verifyRelease(moduleKey, version);
    if (!integrity.valid) throw releaseError('MODULE_RELEASE_INTEGRITY_FAILED', 503);
    const client = await this.getClient();
    let open = false;
    try {
      await client.query('BEGIN'); open = true;
      const result = await client.query('SELECT tenant_id, metadata FROM neem_tenants WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
      if (!result.rows?.[0]) throw releaseError('TENANT_NOT_FOUND', 404);
      const metadata = metadataFor(result.rows[0]);
      const revision = metadata.moduleReleaseRevision || 0;
      if (revision !== expectedRevision) throw releaseError('MODULE_RELEASE_REVISION_CONFLICT', 409);
      const previousVersion = metadata.moduleVersions?.[moduleKey] || this.releases.defaultVersions()[moduleKey];
      const moduleVersions = { ...this.releases.defaultVersions(), ...metadata.moduleVersions, [moduleKey]: version };
      this.releases.validateSelections(moduleVersions);
      const updated = { ...metadata, moduleVersions, moduleReleaseRevision: revision + 1 };
      const saved = await client.query('UPDATE neem_tenants SET metadata = $2::jsonb, updated_at = now() WHERE tenant_id = $1 RETURNING tenant_id', [tenantId, JSON.stringify(updated)]);
      if (saved.rows?.[0]?.tenant_id !== tenantId) throw releaseError('MODULE_RELEASE_PERSISTENCE_UNCONFIRMED', 503);
      await this.audit.recordEvent({ actorId, action: 'TENANT_MODULE_RELEASE_ASSIGNED',
        targetType: 'module_release', targetId: `${moduleKey}@${version}`, tenantId,
        metadata: { previousVersion, version, moduleKey, reason: reason.trim(), revision: revision + 1 }, database: client });
      await client.query('COMMIT'); open = false;
      return { tenantId, moduleKey, version, previousVersion, revision: revision + 1,
        applied: true, delivery: 'authoritative_host_resolution_on_next_request',
        entitlementChanged: false, dataRetained: true };
    } catch (error) {
      if (open) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

module.exports = { ModuleReleaseService, metadataFor };

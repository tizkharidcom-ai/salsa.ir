'use strict';

const crypto = require('crypto');
const { normalizeTenantId } = require('./tenant-config');

const SYNC_SCHEMA_VERSION = 1;

function stableEventId({ tenantId, entity, entityId, revision = '' } = {}) {
  const tenant = normalizeTenantId(tenantId);
  const raw = [tenant, String(entity || ''), String(entityId || ''), String(revision || '')].join('|');
  return `neem-${tenant}-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

function buildSyncEnvelope({
  tenantId,
  eventId,
  entity,
  operation = 'upsert',
  entityId,
  payload = {},
  source = 'westo-edge',
  occurredAt = new Date().toISOString(),
  sequence = null,
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedEntity = String(entity || '').trim().toLowerCase();
  if (!normalizedEntity || !entityId) throw new Error('A sync envelope requires entity and entityId.');
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    eventId: String(eventId || stableEventId({ tenantId: normalizedTenantId, entity: normalizedEntity, entityId, revision: occurredAt })),
    tenantId: normalizedTenantId,
    source: String(source || 'westo-edge').slice(0, 80),
    entity: normalizedEntity,
    operation: String(operation || 'upsert').slice(0, 32),
    entityId: String(entityId).slice(0, 160),
    sequence: sequence == null ? null : Number(sequence),
    occurredAt,
    payload,
  };
}

function validateSyncEnvelope(value) {
  const envelope = value && typeof value === 'object' ? value : null;
  const errors = [];
  if (Number(envelope?.schemaVersion) !== SYNC_SCHEMA_VERSION) errors.push('schemaVersion');
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(String(envelope?.tenantId || ''))) errors.push('tenantId');
  if (!String(envelope?.eventId || '').trim()) errors.push('eventId');
  if (!String(envelope?.entity || '').trim()) errors.push('entity');
  if (!String(envelope?.entityId || '').trim()) errors.push('entityId');
  if (!envelope?.occurredAt || Number.isNaN(new Date(envelope.occurredAt).getTime())) errors.push('occurredAt');
  return { ok: errors.length === 0, errors };
}

module.exports = { SYNC_SCHEMA_VERSION, stableEventId, buildSyncEnvelope, validateSyncEnvelope };

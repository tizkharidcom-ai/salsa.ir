'use strict';

const crypto = require('crypto');
const { validateSyncEnvelope } = require('./sync-contract');

const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function syncEventFingerprint(envelope) {
  return crypto.createHash('sha256').update(JSON.stringify({
    tenantId: envelope?.tenantId,
    source: envelope?.source,
    eventId: envelope?.eventId,
    entity: envelope?.entity,
    entityId: envelope?.entityId,
    operation: envelope?.operation,
    sequence: envelope?.sequence,
    occurredAt: envelope?.occurredAt,
    payload: envelope?.payload,
  })).digest('hex');
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || '').trim(), 'utf8');
  const b = Buffer.from(String(right || '').trim(), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyBridgeSignature({ rawBody, timestamp, signature, secret, now = Date.now(), maxClockSkewMs = DEFAULT_MAX_CLOCK_SKEW_MS } = {}) {
  const body = String(rawBody || '');
  const key = String(secret || '');
  const sentAt = Number(timestamp);
  if (!body || !key || !Number.isFinite(sentAt) || !signature) {
    return { ok: false, reason: 'signature_input_missing' };
  }
  if (Math.abs(Number(now) - sentAt) > Math.max(1000, Number(maxClockSkewMs) || DEFAULT_MAX_CLOCK_SKEW_MS)) {
    return { ok: false, reason: 'signature_expired' };
  }
  const expected = crypto.createHmac('sha256', key).update(`${sentAt}.${body}`).digest('hex');
  return timingSafeHexEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_invalid' };
}

function validateIncomingEnvelope(envelope, { expectedTenantId = null } = {}) {
  const result = validateSyncEnvelope(envelope);
  if (!result.ok) return result;
  if (expectedTenantId && String(envelope.tenantId) !== String(expectedTenantId)) {
    return { ok: false, errors: ['tenantId'], reason: 'tenant_mismatch' };
  }
  return { ok: true, errors: [] };
}

function classifySequence(envelope, lastSequence = null) {
  const sequence = envelope?.sequence == null ? null : Number(envelope.sequence);
  if (sequence == null || !Number.isFinite(sequence)) return { duplicate: false, nextSequence: lastSequence };
  if (lastSequence != null && sequence <= Number(lastSequence)) {
    return { duplicate: true, nextSequence: Number(lastSequence) };
  }
  return { duplicate: false, nextSequence: sequence };
}

function classifyReplay(envelope, existing = null) {
  if (!existing) return { duplicate: false, conflict: false, fingerprint: syncEventFingerprint(envelope) };
  const fingerprint = syncEventFingerprint(envelope);
  const same = String(existing.payload_hash || existing.payloadHash || '') === fingerprint;
  return {
    duplicate: same,
    conflict: !same,
    fingerprint,
    reason: same ? 'already_received' : 'event_identity_conflict',
  };
}

module.exports = {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  verifyBridgeSignature,
  validateIncomingEnvelope,
  classifySequence,
  syncEventFingerprint,
  classifyReplay,
};

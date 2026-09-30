'use strict';

const crypto = require('crypto');

const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const MAX_TOKEN_LENGTH = 4096;
const MAX_FUTURE_CLOCK_SKEW_MS = 30_000;
const TENANT_PRINCIPAL_TYPE = 'tenant_user';
const MEMBERSHIP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function normalizeTenantId(value) {
  const tenantId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TENANT_ID_PATTERN.test(tenantId) ? tenantId : null;
}

function tokenSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function normalizeMembershipId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return MEMBERSHIP_ID_PATTERN.test(id) ? id : null;
}

function createSessionToken({
  phone,
  tenantId,
  identityId,
  membershipId,
  principalType = TENANT_PRINCIPAL_TYPE,
  issuedAtMs = Date.now(),
}, secret) {
  if (!secret) throw new TypeError('A session-token signing secret is required.');
  if (principalType !== TENANT_PRINCIPAL_TYPE) {
    throw new TypeError('Tenant session tokens cannot represent platform identities.');
  }
  const cleanPhone = String(phone || '').trim();
  const cleanTenantId = normalizeTenantId(tenantId);
  const hasIdentityId = identityId !== undefined && identityId !== null;
  const hasMembershipId = membershipId !== undefined && membershipId !== null;
  if (hasIdentityId !== hasMembershipId) {
    throw new TypeError('A tenant session must bind both identityId and membershipId.');
  }
  const cleanIdentityId = hasIdentityId ? normalizeMembershipId(identityId) : null;
  const cleanMembershipId = hasMembershipId ? normalizeMembershipId(membershipId) : null;
  if (hasIdentityId && (!cleanIdentityId || !cleanMembershipId)) {
    throw new TypeError('A valid identityId and membershipId are required for a membership-bound session.');
  }
  const timestamp = Number(issuedAtMs);
  if ((!cleanPhone && !cleanIdentityId) || cleanPhone.length > 64) throw new TypeError('A valid session identity is required.');
  if (!cleanTenantId) throw new TypeError('A canonical tenant id is required.');
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new TypeError('A valid session issue time is required.');
  }
  const claims = {
    tenantId: cleanTenantId,
    principalType: TENANT_PRINCIPAL_TYPE,
    ts: timestamp,
  };
  if (cleanPhone) claims.phone = cleanPhone;
  if (cleanIdentityId) {
    claims.identityId = cleanIdentityId;
    claims.membershipId = cleanMembershipId;
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${tokenSignature(payload, secret)}`;
}

function createMembershipSessionToken({ tenantId, identityId, membershipId, phone = null, issuedAtMs = Date.now() }, secret) {
  if (!identityId || !membershipId) {
    throw new TypeError('A membership-bound tenant session requires identityId and membershipId.');
  }
  return createSessionToken({
    tenantId,
    identityId,
    membershipId,
    phone,
    issuedAtMs,
  }, secret);
}

function readSessionToken(token, secret) {
  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !secret) return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;
  const payload = token.slice(0, dotIndex);
  const supplied = Buffer.from(token.slice(dotIndex + 1));
  const expected = Buffer.from(tokenSignature(payload, secret));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const hasIdentityId = Object.prototype.hasOwnProperty.call(parsed, 'identityId');
    const hasMembershipId = Object.prototype.hasOwnProperty.call(parsed, 'membershipId');
    if (hasIdentityId !== hasMembershipId) return null;
    if (hasIdentityId && (!normalizeMembershipId(parsed.identityId) || !normalizeMembershipId(parsed.membershipId))) return null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'phone')
      && (typeof parsed.phone !== 'string' || !parsed.phone.trim() || parsed.phone.length > 64)) return null;
    if (!hasIdentityId && !parsed.phone) return null;
    if (!Number.isSafeInteger(parsed.ts) || parsed.ts <= 0) return null;
    if (parsed.ts > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS) return null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'tenantId') && !normalizeTenantId(parsed.tenantId)) return null;
    if (Object.prototype.hasOwnProperty.call(parsed, 'principalType')
      && parsed.principalType !== TENANT_PRINCIPAL_TYPE) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sessionTokenMatchesTenant(claims, expectedTenantId) {
  const expected = normalizeTenantId(expectedTenantId);
  if (!claims || !expected) return false;
  // Tenant identity and principal type are both mandatory. An opt-out here
  // would make a legacy unbound token usable in every restaurant tenant.
  if (claims.principalType !== TENANT_PRINCIPAL_TYPE) return false;
  const claim = normalizeTenantId(claims.tenantId);
  if (!claim) return false;
  return claim === expected;
}

function sessionTokenMatchesMembership(claims, { tenantId, identityId, membershipId } = {}) {
  if (!sessionTokenMatchesTenant(claims, tenantId)) return false;
  const expectedIdentityId = normalizeMembershipId(identityId);
  const expectedMembershipId = normalizeMembershipId(membershipId);
  if (!expectedIdentityId || !expectedMembershipId) return false;
  return normalizeMembershipId(claims.identityId) === expectedIdentityId
    && normalizeMembershipId(claims.membershipId) === expectedMembershipId;
}

module.exports = {
  createSessionToken,
  createMembershipSessionToken,
  readSessionToken,
  sessionTokenMatchesTenant,
  sessionTokenMatchesMembership,
  normalizeMembershipId,
  MAX_TOKEN_LENGTH,
  MAX_FUTURE_CLOCK_SKEW_MS,
  TENANT_PRINCIPAL_TYPE,
};

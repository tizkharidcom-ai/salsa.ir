'use strict';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function identityPart(value, code) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
    throw Object.assign(new Error('tenant and order identities must be strings or safe integers.'), { code });
  }
  const raw = String(value);
  const normalized = raw.trim();
  if (!normalized || raw.length > 120 || /[\p{Cc}\p{Cf}]/u.test(raw)) {
    throw Object.assign(new Error('tenant and order identities must be bounded and visible.'), { code });
  }
  return normalized;
}

function createSettlementInFlightKey({ tenantId, branchId, orderId, idempotencyKey } = {}) {
  const normalizedTenantId = identityPart(tenantId, 'settlement_lock_identity_required');
  const normalizedOrderId = identityPart(orderId, 'settlement_lock_identity_required');
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw Object.assign(new Error('tenant, order, and idempotency identities are required for settlement coordination.'), {
      code: 'settlement_lock_identity_required',
    });
  }

  let normalizedBranchId = null;
  if (branchId !== null && branchId !== undefined && String(branchId).trim() !== '') {
    const rawBranchId = typeof branchId === 'number' ? branchId : /^\d+$/u.test(String(branchId).trim()) ? Number(String(branchId).trim()) : NaN;
    if (!Number.isSafeInteger(rawBranchId) || rawBranchId <= 0) {
      throw Object.assign(new Error('branch identity must be a positive safe integer.'), { code: 'settlement_lock_branch_identity_invalid' });
    }
    normalizedBranchId = String(rawBranchId);
  }

  return JSON.stringify([
    normalizedTenantId,
    normalizedBranchId,
    normalizedOrderId,
    idempotencyKey,
  ]);
}

module.exports = { createSettlementInFlightKey };

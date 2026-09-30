'use strict';

const CLOSED_ORDER_STATUSES = new Set(['cancelled', 'done', 'delivered', 'picked_up']);
const DEFAULT_CLOSED_ORDER_CACHE_LIMIT = 500;

function orderTimestamp(order) {
  const timestamp = new Date(order?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function orderId(order) {
  const id = Number(order?.id);
  return Number.isSafeInteger(id) ? id : 0;
}

/**
 * Preserve every non-terminal order for operations while bounding only the
 * in-memory cache of closed tickets. Durable order history belongs in the
 * normalized order store; this cache limit must never evict actionable work.
 */
function retainOperationalOrders(orders, closedLimit = DEFAULT_CLOSED_ORDER_CACHE_LIMIT) {
  const source = Array.isArray(orders) ? orders : [];
  const limit = Number.isFinite(Number(closedLimit))
    ? Math.max(0, Math.floor(Number(closedLimit)))
    : DEFAULT_CLOSED_ORDER_CACHE_LIMIT;
  const actionable = [];
  const closed = [];

  for (const order of source) {
    const status = String(order?.status || '').trim().toLowerCase();
    if (order && typeof order === 'object' && CLOSED_ORDER_STATUSES.has(status)) closed.push(order);
    else actionable.push(order);
  }

  closed.sort((left, right) => orderTimestamp(right) - orderTimestamp(left)
    || orderId(right) - orderId(left));
  return [...actionable, ...closed.slice(0, limit)];
}

function mergeActionableOrders(snapshotOrders, recoveredOrders) {
  const current = Array.isArray(snapshotOrders) ? snapshotOrders : [];
  const knownIds = new Set(current.map((order) => Number(order?.id)).filter(Number.isSafeInteger));
  const missing = (Array.isArray(recoveredOrders) ? recoveredOrders : [])
    .filter((order) => Number.isSafeInteger(Number(order?.id)) && !knownIds.has(Number(order.id)));
  return {
    orders: retainOperationalOrders([...current, ...missing]),
    restoredCount: missing.length,
  };
}

function normalizePersistedOperationalOrder(row) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  let order = source.data;
  if (typeof order === 'string') {
    try { order = JSON.parse(order); } catch { return null; }
  }
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;

  const parsePositiveId = (value) => {
    if (typeof value === 'string' && !/^\d+$/u.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const hasRowId = source.id !== undefined && source.id !== null;
  const hasPayloadId = order.id !== undefined && order.id !== null;
  const rowId = hasRowId ? parsePositiveId(source.id) : null;
  const payloadId = hasPayloadId ? parsePositiveId(order.id) : null;
  if ((hasRowId && rowId === null) || (hasPayloadId && payloadId === null)
      || (rowId !== null && payloadId !== null && rowId !== payloadId)) return null;
  const id = rowId ?? payloadId;
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const hasRowBranch = Object.hasOwn(source, 'branch_id');
  const hasPayloadBranch = order.branchId !== undefined && order.branchId !== null;
  const rowBranchId = hasRowBranch ? parsePositiveId(source.branch_id) : null;
  const payloadBranchId = hasPayloadBranch ? parsePositiveId(order.branchId) : null;
  if ((hasRowBranch && rowBranchId === null) || (hasPayloadBranch && payloadBranchId === null)
      || (rowBranchId !== null && payloadBranchId !== null && rowBranchId !== payloadBranchId)) return null;
  const branchId = rowBranchId ?? payloadBranchId;
  if (!Number.isSafeInteger(branchId) || branchId <= 0) return null;

  // SQL history ordering and keyset cursors use the canonical table column.
  // Never return a JSON timestamp that disagrees with that ordering (including
  // when created_at is NULL and the query uses the epoch fallback).
  let createdAt;
  if (Object.hasOwn(source, 'created_at')) {
    if (source.created_at instanceof Date) createdAt = source.created_at.toISOString();
    else createdAt = source.created_at == null ? null : String(source.created_at);
  } else {
    createdAt = order.createdAt || null;
  }
  const status = String(source.status ?? order.status ?? '').trim();
  if (!status) return null;
  return {
    ...order,
    id,
    branchId,
    status,
    createdAt,
  };
}

module.exports = { retainOperationalOrders, mergeActionableOrders, normalizePersistedOperationalOrder };

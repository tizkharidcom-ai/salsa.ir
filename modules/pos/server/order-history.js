'use strict';

const CLOSED_STATUSES = new Set(['cancelled', 'done', 'delivered', 'picked_up']);
const MAX_HISTORY_PAGE_SIZE = 100;
const UTC_TIMESTAMP_CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;

function historyTimestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedUtcCursorTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = UTC_TIMESTAMP_CURSOR_RE.exec(value);
  if (!match) return null;
  const wholeSecond = new Date(`${match[1]}Z`);
  if (!Number.isFinite(wholeSecond.getTime()) || wholeSecond.toISOString().slice(0, 19) !== match[1]) return null;
  return value;
}

function historyTimestampMicros(value) {
  if (typeof value === 'string') {
    const match = UTC_TIMESTAMP_CURSOR_RE.exec(value);
    if (match) {
      const wholeSecond = new Date(`${match[1]}Z`).getTime();
      if (Number.isFinite(wholeSecond)) {
        const fractionalMicros = BigInt((match[2] || '').padEnd(6, '0') || '0');
        return BigInt(wholeSecond) * 1000n + fractionalMicros;
      }
    }
  }
  return BigInt(Math.trunc(historyTimestamp(value))) * 1000n;
}

function normalizeOrderHistoryCursor(value) {
  if (value == null || value === '') return null;
  let cursor = value;
  if (typeof value === 'string') {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw Object.assign(new Error('Invalid order history cursor.'), { code: 'order_history_cursor_invalid', status: 400 });
    }
    try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch {
      throw Object.assign(new Error('Invalid order history cursor.'), { code: 'order_history_cursor_invalid', status: 400 });
    }
  }
  const id = Number(cursor?.id);
  const createdAt = normalizedUtcCursorTimestamp(cursor?.createdAt);
  if (!cursor || typeof cursor !== 'object' || !Number.isSafeInteger(id) || id <= 0
      || !createdAt) {
    throw Object.assign(new Error('Invalid order history cursor.'), { code: 'order_history_cursor_invalid', status: 400 });
  }
  return { createdAt, id };
}

function encodeOrderHistoryCursor(row) {
  const id = Number(row?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const rawTimestamp = row.createdAtCursor ?? row.created_at_cursor ?? row.createdAt ?? row.created_at;
  const createdAt = normalizedUtcCursorTimestamp(rawTimestamp)
    || new Date(historyTimestamp(rawTimestamp)).toISOString();
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function historyPageSize(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, Math.floor(parsed)))
    : 30;
}

function paginateCachedClosedOrders(orders, { branchId = null, cursor = null, limit = 30 } = {}) {
  const normalizedCursor = normalizeOrderHistoryCursor(cursor);
  const pageSize = historyPageSize(limit);
  const branch = branchId == null ? null : Number(branchId);
  const rows = (Array.isArray(orders) ? orders : [])
    .filter((order) => CLOSED_STATUSES.has(String(order?.status || '').trim().toLowerCase()))
    .filter((order) => branch == null || Number(order.branchId) === branch)
    .slice()
    .sort((left, right) => {
      const leftTimestamp = historyTimestampMicros(left.createdAt);
      const rightTimestamp = historyTimestampMicros(right.createdAt);
      if (leftTimestamp !== rightTimestamp) return rightTimestamp > leftTimestamp ? 1 : -1;
      return Number(right.id || 0) - Number(left.id || 0);
    })
    .filter((order) => {
      if (!normalizedCursor) return true;
      const timestamp = historyTimestampMicros(order.createdAt);
      const cursorTimestamp = historyTimestampMicros(normalizedCursor.createdAt);
      return timestamp < cursorTimestamp || (timestamp === cursorTimestamp && Number(order.id) < normalizedCursor.id);
    });
  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  return {
    orders: page,
    hasMore,
    nextCursor: hasMore ? encodeOrderHistoryCursor(page[page.length - 1]) : null,
    limit: pageSize,
  };
}

module.exports = {
  MAX_HISTORY_PAGE_SIZE,
  normalizeOrderHistoryCursor,
  encodeOrderHistoryCursor,
  historyPageSize,
  paginateCachedClosedOrders,
};

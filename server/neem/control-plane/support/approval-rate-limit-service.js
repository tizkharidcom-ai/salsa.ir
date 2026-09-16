'use strict';

const crypto = require('crypto');
const config = require('../config');
const { getDatabase, getDatabaseClient } = require('../db/database');

const APPROVAL_RATE_WINDOW_MS = 10 * 60 * 1000;
const APPROVAL_RATE_MAX_PER_IP = 60;
const APPROVAL_RATE_MAX_PER_TOKEN = 5;
const APPROVAL_RATE_MAX_KEYS = 10_000;

function hashKey(scope, value) {
  return crypto.createHash('sha256').update(`${scope}:${String(value)}`, 'utf8').digest('hex');
}

function createRateLimitedResult(now, windowStart) {
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + APPROVAL_RATE_WINDOW_MS - now) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/**
 * Approval limiter with two storage modes:
 * - persistent Control Plane PostgreSQL: shared across service instances and
 *   committed atomically for the IP and token-fingerprint buckets;
 * - test/explicit ephemeral development: bounded process-local fallback.
 *
 * Raw IPs and approval tokens never enter the durable table or its errors.
 */
class ApprovalRateLimitService {
  constructor({ db = getDatabase(), clock = () => Date.now(), persistent = null } = {}) {
    this.db = db;
    this.clock = clock;
    this.persistent = persistent === null
      ? !config.isTest && typeof db?.connect === 'function'
      : Boolean(persistent);
    this.localAttempts = new Map();
    this.localLastPruneAt = 0;
  }

  async consume({ ip = 'unknown', token = '' } = {}) {
    return this.persistent
      ? this._consumePersistent({ ip, token })
      : this._consumeLocal({ ip, token });
  }

  _keys(ip, token) {
    return [
      { scope: 'ip', keyHash: hashKey('ip', ip), maxAttempts: APPROVAL_RATE_MAX_PER_IP },
      { scope: 'token', keyHash: hashKey('token', token || 'missing'), maxAttempts: APPROVAL_RATE_MAX_PER_TOKEN }
    ];
  }

  _consumeLocal({ ip, token }) {
    const now = this.clock();
    const cutoff = now - APPROVAL_RATE_WINDOW_MS;
    if (now - this.localLastPruneAt >= APPROVAL_RATE_WINDOW_MS) {
      for (const [key, timestamps] of this.localAttempts) {
        const active = timestamps.filter((timestamp) => timestamp > cutoff);
        if (active.length) this.localAttempts.set(key, active);
        else this.localAttempts.delete(key);
      }
      this.localLastPruneAt = now;
    }

    const keys = this._keys(ip, token).map((item) => ({
      ...item,
      timestamps: (this.localAttempts.get(`${item.scope}:${item.keyHash}`) || [])
        .filter((timestamp) => timestamp > cutoff)
    }));
    const newKeys = keys.filter((item) => !this.localAttempts.has(`${item.scope}:${item.keyHash}`));
    if (this.localAttempts.size + newKeys.length > APPROVAL_RATE_MAX_KEYS) {
      return createRateLimitedResult(now, Math.floor(now / APPROVAL_RATE_WINDOW_MS) * APPROVAL_RATE_WINDOW_MS);
    }

    const limited = keys.find((item) => item.timestamps.length >= item.maxAttempts);
    if (limited) {
      return createRateLimitedResult(now, limited.timestamps[0]);
    }

    for (const item of keys) {
      this.localAttempts.set(`${item.scope}:${item.keyHash}`, [...item.timestamps, now]);
    }
    return { allowed: true };
  }

  async _consumePersistent({ ip, token }) {
    const now = this.clock();
    const windowStartMs = Math.floor(now / APPROVAL_RATE_WINDOW_MS) * APPROVAL_RATE_WINDOW_MS;
    const windowStart = new Date(windowStartMs);
    const keys = this._keys(ip, token);
    const client = await getDatabaseClient(this.db);
    let committed = false;

    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM neem_support_approval_rate_limits WHERE window_started_at < $1',
        [windowStart]
      );

      const existing = await client.query(
        `SELECT scope, key_hash
           FROM neem_support_approval_rate_limits
          WHERE window_started_at = $1
            AND scope = ANY($2::text[])
            AND key_hash = ANY($3::text[])
          FOR UPDATE`,
        [windowStart, keys.map((item) => item.scope), keys.map((item) => item.keyHash)]
      );
      const existingKeys = new Set((existing.rows || []).map((row) => `${row.scope}:${row.key_hash}`));
      const countResult = await client.query(
        'SELECT COUNT(*)::int AS key_count FROM neem_support_approval_rate_limits WHERE window_started_at = $1',
        [windowStart]
      );
      const keyCount = Number(countResult.rows?.[0]?.key_count || 0);
      if (keyCount + keys.filter((item) => !existingKeys.has(`${item.scope}:${item.keyHash}`)).length > APPROVAL_RATE_MAX_KEYS) {
        await client.query('ROLLBACK');
        return createRateLimitedResult(now, windowStartMs);
      }

      const counts = [];
      for (const item of keys) {
        const result = await client.query(
          `INSERT INTO neem_support_approval_rate_limits
             (scope, key_hash, window_started_at, attempt_count, updated_at)
           VALUES ($1, $2, $3, 1, now())
           ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE SET
             attempt_count = neem_support_approval_rate_limits.attempt_count + 1,
             updated_at = now()
           RETURNING attempt_count`,
          [item.scope, item.keyHash, windowStart]
        );
        counts.push(Number(result.rows?.[0]?.attempt_count || 0));
      }

      const limitedIndex = counts.findIndex((count, index) => count > keys[index].maxAttempts);
      if (limitedIndex >= 0) {
        await client.query('ROLLBACK');
        return createRateLimitedResult(now, windowStartMs);
      }

      await client.query('COMMIT');
      committed = true;
      return { allowed: true };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release?.();
    }
  }
}

module.exports = {
  ApprovalRateLimitService,
  APPROVAL_RATE_WINDOW_MS,
  APPROVAL_RATE_MAX_PER_IP,
  APPROVAL_RATE_MAX_PER_TOKEN,
  APPROVAL_RATE_MAX_KEYS,
  hashKey
};

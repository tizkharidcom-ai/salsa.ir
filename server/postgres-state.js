/* Optional PostgreSQL state store.
 *
 * The current application is JSON-backed. This adapter makes PostgreSQL the
 * durable source when DATABASE_URL is configured while retaining a safe local
 * fallback for local development and a reversible rollout.
 *
 * Runtime notes:
 * - schema creation is guarded by one shared promise, so concurrent callers do
 *   not race the CREATE TABLE / CREATE INDEX batch;
 * - full-state writes are serialized and queued writes collapse to the newest
 *   state while an earlier PostgreSQL write is in flight. This prevents a slow
 *   database from building an unbounded backlog of large JSONB snapshots;
 * - audit inserts remain independent and are never coalesced.
 */
'use strict';

const { normalizedSchemaAvailable, syncFinanceState } = require('./finance-postgres-repository');
const { ensureTenantMetadata } = require('./salsa/tenant-metadata');
const { normalizePersistedOperationalOrder } = require('./operational-order-retention');
const { normalizeOrderHistoryCursor, encodeOrderHistoryCursor, historyPageSize } = require('./order-history');

function stateSummary(state = {}) {
  return {
    menuCategories: Array.isArray(state.menuCategories) ? state.menuCategories.length : 0,
    menuItems: Array.isArray(state.menuItems) ? state.menuItems.length : 0,
    orders: Array.isArray(state.orders) ? state.orders.length : 0,
    reservations: Array.isArray(state.reservations) ? state.reservations.length : 0,
    users: Array.isArray(state.users) ? state.users.length : 0,
  };
}

// Values used to reconcile a JSON snapshot with PostgreSQL before a staged
// cutover. They are intentionally small, deterministic aggregates rather
// than a second copy of business data.
function reconciliationSummary(state = {}) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const reservations = Array.isArray(state.reservations) ? state.reservations : [];
  const items = Array.isArray(state.menuItems) ? state.menuItems : [];
  const payments = Array.isArray(state.paymentAttempts) ? state.paymentAttempts : [];
  return {
    ...stateSummary(state),
    finiteStockItems: items.filter((item) => typeof item.stock === 'number').length,
    finiteStockUnits: items.reduce((sum, item) => sum + (typeof item.stock === 'number' ? Math.max(0, Number(item.stock) || 0) : 0), 0),
    orderGrossTotal: orders.reduce((sum, order) => sum + Math.max(0, Number(order.total) || 0), 0),
    paidOrderTotal: orders
      .filter((order) => order.paymentStatus !== 'unpaid' && order.paymentStatus !== 'pending' && (order.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(order.status)))
      .reduce((sum, order) => sum + Math.max(0, Number(order.total) || 0), 0),
    activeReservations: reservations.filter((item) => !['cancelled', 'no_show'].includes(item.status)).length,
    paymentAttempts: payments.length,
    paidPayments: payments.filter((item) => item.status === 'paid').length,
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeState(fallback, stored) {
  const source = isPlainObject(stored) ? stored : {};
  // New code can always expect fields added after the first migration while
  // existing production data remains authoritative for populated fields.
  // Merge plain objects recursively, but keep arrays atomic: an empty array in
  // PostgreSQL is an authoritative empty collection and must not be filled
  // from the fallback snapshot.
  const merge = (base, override) => {
    if (!isPlainObject(base) || !isPlainObject(override)) return override;
    const result = { ...base };
    for (const key of Object.keys(override)) {
      result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
        ? merge(base[key], override[key])
        : override[key];
    }
    return result;
  };
  return merge(isPlainObject(fallback) ? fallback : {}, source);
}

function sslOptions(env = process.env) {
  if (env.DATABASE_SSL === 'false') return false;
  if (env.DATABASE_SSL === 'true' || env.NODE_ENV === 'production') {
    const rejectUnauthorized = env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
    const options = { rejectUnauthorized };
    if (env.DATABASE_SSL_CA) options.ca = String(env.DATABASE_SSL_CA).replace(/\n/g, '\n');
    return options;
  }
  return undefined;
}

function createDisabledStore({ required = false, reason = 'postgres_disabled' } = {}) {
  return {
    enabled: false,
    required,
    async hydrate(fallback) {
      return { state: fallback, source: 'json' };
    },
    async write() {
      return false;
    },
    async loadActionableOrders() {
      return { available: false, reason, orders: [] };
    },
    async listClosedOrders() {
      return { available: false, reason, orders: [], hasMore: false, nextCursor: null, invalidRows: 0 };
    },
    async appendAudit() {
      return false;
    },
    financeStatus() {
      return { available: false, required, reason };
    },
    poolMetrics() {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 };
    },
    async ping() {
      return { ok: false, reason };
    },
    async close() {},
  };
}

function createPostgresStateStore({
  connectionString = process.env.DATABASE_URL,
  required = process.env.WESTO_POSTGRES_REQUIRED === 'true',
  logger = console,
  Pool,
  tenantConfig = null,
  requireTenantMetadata = process.env.NEEM_REQUIRE_TENANT_METADATA === 'true',
} = {}) {
  if (!connectionString) return createDisabledStore({ required, reason: required ? 'database_url_required' : 'postgres_disabled' });

  let PgPool = Pool;
  if (!PgPool) {
    // Keep local development operable if dependencies were intentionally not
    // installed; production fails loudly through the startup log instead.
    try {
      PgPool = require('pg').Pool;
    } catch (error) {
      logger.warn?.('[postgres] `pg` is unavailable; using JSON fallback', error.message);
      return createDisabledStore({ required, reason: required ? 'pg_driver_required' : 'postgres_disabled' });
    }
  }

  const pool = new PgPool({
    connectionString,
    ssl: sslOptions(),
    max: Math.max(2, Number(process.env.DATABASE_POOL_MAX) || 10),
    idleTimeoutMillis: Math.max(5000, Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000),
  });

  // Guard against unhandled idle client errors terminating the Node.js process
  if (typeof pool.on === 'function') {
    pool.on('error', (error) => {
      logger.error?.('[postgres] unexpected idle client error:', error?.message || error);
    });
  }

  let initialized = false;
  let schemaPromise = null;
  let closed = false;
  let closePromise = null;
  let normalizedFinance = { available: false, reason: 'not_checked' };
  let loadedVersion = null;

  // At most one full JSON state write is sent to PostgreSQL at a time. If more
  // saves arrive while it is in flight, only the newest state needs to become
  // the next durable snapshot. Every caller still gets a promise that settles
  // when the batch containing its request has completed.
  let pendingWrite = null;
  let drainPromise = null;

  async function ensureSchema() {
    if (initialized) return;
    if (schemaPromise) return schemaPromise;
    if (closed) throw new Error('PostgreSQL state store is closed');

    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS westo_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          data JSONB NOT NULL,
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS westo_audit_events (
          id UUID PRIMARY KEY,
          at TIMESTAMPTZ NOT NULL,
          actor JSONB,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          branch_id BIGINT,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX IF NOT EXISTS westo_audit_events_at_idx ON westo_audit_events (at DESC);
        CREATE INDEX IF NOT EXISTS westo_audit_events_branch_idx ON westo_audit_events (branch_id, at DESC);
      `);
      if (requireTenantMetadata) {
        if (!tenantConfig?.tenantId) {
          const error = new Error('Tenant metadata is required, but no tenant configuration was supplied.');
          error.code = 'tenant_config_required';
          throw error;
        }
        await ensureTenantMetadata(pool, tenantConfig, { required: true });
      }
      initialized = true;
    })();

    try {
      await schemaPromise;
    } finally {
      // A failed initialization must be retryable on the next operation.
      schemaPromise = null;
    }
  }

  async function persistState(state) {
    await ensureSchema();
    const encodedState = JSON.stringify(state);
    const encodedSummary = JSON.stringify(stateSummary(state));
    const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
    try {
      await client.query('BEGIN');
      normalizedFinance = await syncFinanceState(client, state.financeV2, { checkSchema: true, operationalState: state });
      if (required && normalizedFinance.available !== true) {
        const error = new Error('Finance PostgreSQL schema is required before persistent writes.');
        error.code = normalizedFinance.reason || 'finance_schema_required';
        throw error;
      }
      let written;
      if (loadedVersion == null) {
        written = await client.query(
          `INSERT INTO westo_state (id, data, summary, version, updated_at)
           VALUES (1, $1::jsonb, $2::jsonb, 1, now())
           ON CONFLICT (id) DO NOTHING
           RETURNING version`,
          [encodedState, encodedSummary],
        );
      } else {
        written = await client.query(
          `UPDATE westo_state
           SET data = $1::jsonb, summary = $2::jsonb,
               version = version + 1, updated_at = now()
           WHERE id = 1 AND version = $3
           RETURNING version`,
          [encodedState, encodedSummary, loadedVersion],
        );
      }
      if (written.rowCount !== 1) {
        const conflict = new Error('PostgreSQL state changed in another process; reload before retrying the financial mutation.');
        conflict.code = 'postgres_state_write_conflict';
        conflict.status = 409;
        throw conflict;
      }
      const nextVersion = Number(written.rows?.[0]?.version) || (loadedVersion == null ? 1 : loadedVersion + 1);
      await client.query('COMMIT');
      loadedVersion = nextVersion;
      return true;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      normalizedFinance = { available: false, reason: 'finance_sync_failed', error: error.message };
      throw error;
    } finally {
      if (client !== pool && typeof client.release === 'function') client.release();
    }
  }

  function settleBatch(batch, error, value) {
    for (const waiter of batch.waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve(value);
    }
  }

  function startDrain() {
    if (drainPromise) return drainPromise;

    drainPromise = (async () => {
      while (pendingWrite) {
        const batch = pendingWrite;
        pendingWrite = null;
        try {
          const value = await persistState(batch.state);
          settleBatch(batch, null, value);
        } catch (error) {
          settleBatch(batch, error);
        }
      }
    })().finally(() => {
      drainPromise = null;
      // A write may have been queued between the loop's final condition and
      // the finally callback. Start one more drain rather than leaving it idle.
      if (pendingWrite && !closed) startDrain();
    });

    return drainPromise;
  }

  function queueWrite(state) {
    if (closed) return Promise.reject(new Error('PostgreSQL state store is closed'));
    // Snapshot at enqueue time so later in-memory mutations cannot change a
    // write that is already waiting behind a slower database operation.
    const snapshot = JSON.parse(JSON.stringify(state));

    return new Promise((resolve, reject) => {
      if (pendingWrite) {
        // Latest-state-wins for the next snapshot; all queued callers are tied
        // to that same durable write instead of creating a backlog.
        pendingWrite.state = snapshot;
        pendingWrite.waiters.push({ resolve, reject });
      } else {
        pendingWrite = {
          state: snapshot,
          waiters: [{ resolve, reject }],
        };
      }
      startDrain();
    });
  }

  const store = {
    enabled: true,
    required,
    async hydrate(fallback) {
      if (closed) throw new Error('PostgreSQL state store is closed');
      await ensureSchema();
      if (required) {
        const financeSchemaReady = await normalizedSchemaAvailable(pool);
        if (!financeSchemaReady) {
          normalizedFinance = { available: false, required: true, reason: 'finance_schema_required' };
          const error = new Error('Finance PostgreSQL schema is required before startup.');
          error.code = 'finance_schema_required';
          throw error;
        }
        normalizedFinance = { available: true, required: true, reason: 'schema_available_not_synced' };
      }
      const existing = await pool.query('SELECT data, version FROM westo_state WHERE id = 1');
      if (!existing.rowCount) {
        try {
          await queueWrite(fallback);
          logger.info?.('[postgres] seeded state from JSON', stateSummary(fallback));
          return { state: fallback, source: 'json-seeded' };
        } catch (error) {
          if (error.code !== 'postgres_state_write_conflict') throw error;
          const winner = await pool.query('SELECT data, version FROM westo_state WHERE id = 1');
          if (!winner.rowCount) throw error;
          loadedVersion = Number(winner.rows[0].version);
          return { state: mergeState(fallback, winner.rows[0].data), source: 'postgres' };
        }
      }
      loadedVersion = Number(existing.rows[0].version);
      return { state: mergeState(fallback, existing.rows[0].data), source: 'postgres' };
    },

    async write(state) {
      return queueWrite(state);
    },

    async loadActionableOrders() {
      if (closed) throw new Error('PostgreSQL state store is closed');
      await ensureSchema();
      const table = await pool.query("SELECT to_regclass('public.unified_orders') AS tbl");
      if (!table.rows[0]?.tbl) return { available: false, reason: 'operational_order_store_missing', orders: [] };
      const result = await pool.query(`
        SELECT id, branch_id, status, created_at, data
        FROM unified_orders
        WHERE lower(status) NOT IN ('cancelled', 'done', 'delivered', 'picked_up')
        ORDER BY created_at ASC, id ASC
      `);
      const orders = [];
      let invalidRows = 0;
      for (const row of result.rows || []) {
        const order = normalizePersistedOperationalOrder(row);
        if (!order) { invalidRows += 1; continue; }
        orders.push(order);
      }
      return { available: true, orders, invalidRows };
    },

    async listClosedOrders({ branchId = null, cursor = null, limit = 30 } = {}) {
      if (closed) throw new Error('PostgreSQL state store is closed');
      await ensureSchema();
      const table = await pool.query("SELECT to_regclass('public.unified_orders') AS tbl");
      if (!table.rows[0]?.tbl) {
        return { available: false, reason: 'operational_order_store_missing', orders: [], hasMore: false, nextCursor: null, invalidRows: 0 };
      }
      const branch = branchId == null ? null : Number(branchId);
      if (branch != null && (!Number.isSafeInteger(branch) || branch <= 0)) {
        throw Object.assign(new Error('Invalid branch for order history.'), { code: 'branch_invalid', status: 400 });
      }
      const normalizedCursor = normalizeOrderHistoryCursor(cursor);
      const pageSize = historyPageSize(limit);
      const params = [branch];
      let cursorClause = '';
      if (normalizedCursor) {
        params.push(normalizedCursor.createdAt, normalizedCursor.id);
        cursorClause = `AND (COALESCE(created_at, 'epoch'::timestamptz), id) < ($2::timestamptz, $3::bigint)`;
      }
      params.push(pageSize + 1);
      const result = await pool.query(`
        SELECT id, branch_id, status, created_at,
          to_char(COALESCE(created_at, 'epoch'::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
          data
        FROM unified_orders
        WHERE lower(status) IN ('cancelled', 'done', 'delivered', 'picked_up')
          AND ($1::bigint IS NULL OR branch_id = $1)
          ${cursorClause}
        ORDER BY COALESCE(created_at, 'epoch'::timestamptz) DESC, id DESC
        LIMIT $${params.length}
      `, params);
      const rows = result.rows || [];
      const pageRows = rows.slice(0, pageSize);
      const orders = [];
      let invalidRows = 0;
      for (const row of pageRows) {
        const order = normalizePersistedOperationalOrder(row);
        if (!order) { invalidRows += 1; continue; }
        orders.push(order);
      }
      return {
        available: true,
        orders,
        hasMore: rows.length > pageSize,
        nextCursor: rows.length > pageSize && pageRows.length
          ? encodeOrderHistoryCursor(pageRows[pageRows.length - 1]) : null,
        limit: pageSize,
        invalidRows,
      };
    },

    async appendAudit(entry) {
      if (closed) throw new Error('PostgreSQL state store is closed');
      await ensureSchema();
      await pool.query(
        `INSERT INTO westo_audit_events
          (id, at, actor, action, target_type, target_id, branch_id, meta)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.id,
          entry.at,
          JSON.stringify(entry.actor),
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.branchId,
          JSON.stringify({ ...(entry.meta || {}), tenantId: entry.tenantId || entry.meta?.tenantId || null }),
        ],
      );
      return true;
    },

    financeStatus() {
      return { required, snapshotVersion: loadedVersion, ...normalizedFinance };
    },

    get pool() {
      return pool;
    },

    poolMetrics() {
      return {
        totalCount: typeof pool.totalCount === 'number' ? pool.totalCount : null,
        idleCount: typeof pool.idleCount === 'number' ? pool.idleCount : null,
        waitingCount: typeof pool.waitingCount === 'number' ? pool.waitingCount : null,
      };
    },

    async ping() {
      if (closed) return { ok: false, reason: 'store_closed' };
      const started = Date.now();
      try {
        await pool.query('SELECT 1');
        return { ok: true, latencyMs: Math.max(0, Date.now() - started) };
      } catch (error) {
        return { ok: false, error: error.message, code: error.code };
      }
    },

    async close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        // Flush anything that had already been accepted before close().
        if (drainPromise) await drainPromise;
        if (pendingWrite) {
          // startDrain() normally owns this path; this branch protects a tiny
          // scheduling window during shutdown.
          const batch = pendingWrite;
          pendingWrite = null;
          try {
            const value = await persistState(batch.state);
            settleBatch(batch, null, value);
          } catch (error) {
            settleBatch(batch, error);
          }
        }
        await pool.end();
      })();
      return closePromise;
    },
  };

  return store;
}

module.exports = { createPostgresStateStore, stateSummary, reconciliationSummary, mergeState };

-- server/salsa/control-plane/migrations/027_siem_audit_export_cursor.sql
-- Migration 027: Durable SIEM audit export cursor

BEGIN;

CREATE TABLE IF NOT EXISTS neem_audit_export_cursors (
  id TEXT PRIMARY KEY,
  last_exported_occurred_at TIMESTAMPTZ,
  last_exported_id TEXT,
  last_batch_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

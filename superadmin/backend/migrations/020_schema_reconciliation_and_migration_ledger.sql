-- server/salsa/control-plane/migrations/020_schema_reconciliation_and_migration_ledger.sql
-- Migration 020: Reconcile pre-011 baseline tables and retain migration evidence

-- This repair is safe for both a fresh database and a database that reached
-- 019 before the compatibility fixes landed. Every operation is additive or
-- an explicit normalization of values that the newer services already use.

ALTER TABLE neem_control_migrations
    ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS source_file TEXT,
    ADD COLUMN IF NOT EXISTS execution_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE neem_releases
    ADD COLUMN IF NOT EXISTS version VARCHAR(32),
    ADD COLUMN IF NOT EXISTS manifest_checksum VARCHAR(64),
    ADD COLUMN IF NOT EXISTS git_commit_sha VARCHAR(40),
    ADD COLUMN IF NOT EXISTS min_compatible_edge_version VARCHAR(32),
    ADD COLUMN IF NOT EXISTS release_notes TEXT;

UPDATE neem_releases
SET version = release_version
WHERE version IS NULL;

ALTER TABLE neem_releases ALTER COLUMN artifact_ref SET DEFAULT 'legacy:unverified';
ALTER TABLE neem_releases DROP CONSTRAINT IF EXISTS neem_releases_status_check;
UPDATE neem_releases SET status = 'draft' WHERE status = 'prepared';
UPDATE neem_releases SET status = 'promoted' WHERE status = 'released';
ALTER TABLE neem_releases
    ADD CONSTRAINT neem_releases_status_check
    CHECK (status IN ('draft', 'canary', 'promoted', 'rolled_back', 'deprecated'));
CREATE UNIQUE INDEX IF NOT EXISTS neem_releases_version_uidx ON neem_releases(version);

CREATE OR REPLACE FUNCTION neem_sync_release_identifiers()
RETURNS TRIGGER AS $$
BEGIN
    NEW.release_version := COALESCE(NEW.release_version, NEW.version);
    NEW.version := COALESCE(NEW.version, NEW.release_version);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_neem_sync_release_identifiers ON neem_releases;
CREATE TRIGGER trg_neem_sync_release_identifiers
BEFORE INSERT OR UPDATE OF release_version, version ON neem_releases
FOR EACH ROW EXECUTE FUNCTION neem_sync_release_identifiers();

ALTER TABLE neem_support_sessions
    ALTER COLUMN id TYPE VARCHAR(64) USING id::text,
    ALTER COLUMN actor_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS ticket_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS support_principal_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS view_as_user_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS session_scope VARCHAR(32) NOT NULL DEFAULT 'read_only',
    ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS is_write_allowed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS write_justification TEXT,
    ADD COLUMN IF NOT EXISTS scoped_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS audit_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_neem_supp_sess_token ON neem_support_sessions(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS neem_releases_version_uidx ON neem_releases(version);

-- server/neem/control-plane/migrations/011_releases_canary_and_incidents.sql
-- Migration 011: Release Management, Progressive Canary Rollout Waves & Automated Incident Rollback

-- 001 creates a minimal neem_releases table with release_version as its
-- identifier. Reconcile it before creating the rollout FK that targets the
-- canonical version column. CREATE TABLE IF NOT EXISTS is not a migration.
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

CREATE TABLE IF NOT EXISTS neem_releases (
    version VARCHAR(32) PRIMARY KEY,
    manifest_checksum VARCHAR(64) NOT NULL,
    git_commit_sha VARCHAR(40) NOT NULL,
    min_compatible_edge_version VARCHAR(32) NOT NULL,
    release_notes TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'canary', 'promoted', 'rolled_back', 'deprecated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_rollout_waves (
    id VARCHAR(64) PRIMARY KEY,
    version VARCHAR(32) NOT NULL REFERENCES neem_releases(version),
    wave_number INT NOT NULL,
    target_cohort VARCHAR(32) NOT NULL CHECK (target_cohort IN ('internal_canary', 'pilot_tenants', 'general_fleet')),
    target_tenants JSONB NOT NULL DEFAULT '[]'::jsonb,
    healthy_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 95.0,
    error_budget_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 2.0,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'aborted', 'rolled_back')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_incidents (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(256) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('sev1_critical', 'sev2_major', 'sev3_minor')),
    status VARCHAR(32) NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'mitigated', 'resolved')),
    affected_scope VARCHAR(64) NOT NULL,
    trigger_event VARCHAR(128),
    root_cause TEXT,
    mitigation_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

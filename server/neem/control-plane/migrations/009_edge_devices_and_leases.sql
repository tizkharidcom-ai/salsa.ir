-- server/neem/control-plane/migrations/009_edge_devices_and_leases.sql
-- Migration 009: Edge POS Terminals, Offline Leases, Sequence Fencing & Sync Conflicts

CREATE TABLE IF NOT EXISTS neem_edge_devices (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    branch_id VARCHAR(64) NOT NULL,
    device_name VARCHAR(128) NOT NULL,
    device_kind VARCHAR(32) NOT NULL DEFAULT 'pos_station' CHECK (device_kind IN ('pos_station', 'kds_screen', 'waiter_handheld', 'edge_server')),
    pairing_code VARCHAR(32),
    device_secret_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'paired' CHECK (status IN ('pending_pair', 'paired', 'fenced', 'decommissioned')),
    fencing_epoch INT NOT NULL DEFAULT 1,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_edge_dev_tenant ON neem_edge_devices(tenant_id);

CREATE TABLE IF NOT EXISTS neem_edge_leases (
    id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL REFERENCES neem_edge_devices(id),
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    lease_token_hash VARCHAR(64) NOT NULL UNIQUE,
    lease_epoch INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_edge_lease_token ON neem_edge_leases(lease_token_hash);

CREATE TABLE IF NOT EXISTS neem_edge_sync_conflicts (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    device_id VARCHAR(64) NOT NULL,
    entity_kind VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    conflict_policy VARCHAR(32) NOT NULL DEFAULT 'quarantine' CHECK (conflict_policy IN ('lww', 'merge', 'quarantine', 'manual_resolved')),
    cloud_state JSONB NOT NULL,
    edge_state JSONB NOT NULL,
    resolution_status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_edge_packages (
    version VARCHAR(32) PRIMARY KEY,
    package_url VARCHAR(512) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    signature_hex VARCHAR(256) NOT NULL,
    release_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

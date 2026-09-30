-- server/salsa/control-plane/migrations/012_capacity_observability_and_pilot.sql
-- Migration 012: Multi-Cell Capacity Management, Observability Telemetry & Pilot Topology

CREATE TABLE IF NOT EXISTS neem_cell_capacities (
    cell_id VARCHAR(64) PRIMARY KEY,
    region VARCHAR(32) NOT NULL,
    max_tenants INT NOT NULL DEFAULT 100,
    current_tenants INT NOT NULL DEFAULT 0,
    cpu_allocation_cores INT NOT NULL DEFAULT 16,
    ram_allocation_gb INT NOT NULL DEFAULT 64,
    db_pool_max_connections INT NOT NULL DEFAULT 50,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draining', 'saturated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_observability_metrics (
    id BIGSERIAL PRIMARY KEY,
    metric_name VARCHAR(64) NOT NULL,
    scope_tenant_id VARCHAR(64),
    cell_id VARCHAR(64),
    metric_value NUMERIC(14,4) NOT NULL,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_metric_name_time ON neem_observability_metrics(metric_name, recorded_at);

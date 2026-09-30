-- Migration 026: Durable Edge order receipts and replay protection

CREATE TABLE IF NOT EXISTS neem_edge_order_receipts (
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    order_id VARCHAR(128) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    receipt_number VARCHAR(128),
    payload_hash VARCHAR(64) NOT NULL,
    order_payload JSONB NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_neem_edge_order_receipts_device
    ON neem_edge_order_receipts(tenant_id, device_id, accepted_at);

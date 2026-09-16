-- server/neem/control-plane/migrations/008_infrastructure_domains_and_tls.sql
-- Migration 008: Infrastructure, Custom Domains, TLS ACME Challenges & Host Routing

CREATE TABLE IF NOT EXISTS neem_infrastructure_domains (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES neem_tenants(tenant_id),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    domain_kind VARCHAR(32) NOT NULL DEFAULT 'custom_domain' CHECK (domain_kind IN ('neem_subdomain', 'custom_domain', 'alias')),
    dns_verification_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (dns_verification_status IN ('pending', 'verified', 'failed')),
    expected_cname VARCHAR(255) NOT NULL,
    current_cname VARCHAR(255),
    tls_mode VARCHAR(32) NOT NULL DEFAULT 'managed_acme' CHECK (tls_mode IN ('managed_acme', 'custom_cert', 'none')),
    tls_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (tls_status IN ('pending', 'issuing', 'issued', 'failed', 'expired')),
    tls_error_reason TEXT,
    brand_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_neem_infra_domain_tenant ON neem_infrastructure_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_neem_infra_domain_name ON neem_infrastructure_domains(domain_name);

CREATE TABLE IF NOT EXISTS neem_infrastructure_certificates (
    id VARCHAR(64) PRIMARY KEY,
    domain_id VARCHAR(64) NOT NULL REFERENCES neem_infrastructure_domains(id),
    provider VARCHAR(32) NOT NULL DEFAULT 'arvan_acme',
    certificate_serial VARCHAR(128),
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'renewing', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neem_infrastructure_probes (
    probe_id VARCHAR(64) PRIMARY KEY,
    target_node VARCHAR(64) NOT NULL,
    probe_kind VARCHAR(32) NOT NULL CHECK (probe_kind IN ('http', 'tcp', 'dns', 'tls', 'intranet')),
    status VARCHAR(32) NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'offline')),
    latency_ms INT NOT NULL DEFAULT 0,
    is_internal_intranet BOOLEAN NOT NULL DEFAULT true,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

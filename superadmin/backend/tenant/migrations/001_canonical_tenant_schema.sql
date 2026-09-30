-- Migration 001: Canonical Tenant Zero-Data Schema
CREATE TABLE IF NOT EXISTS tenant_metadata (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_branches (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) NOT NULL UNIQUE,
    address TEXT,
    phone VARCHAR(32),
    is_main BOOLEAN DEFAULT false,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    role VARCHAR(32) NOT NULL,
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_tables (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    table_number VARCHAR(32) NOT NULL,
    capacity INT DEFAULT 4,
    status VARCHAR(32) DEFAULT 'available',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_menu_items (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    category_id VARCHAR(64),
    title VARCHAR(255) NOT NULL,
    price_cents BIGINT NOT NULL DEFAULT 0,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_orders (
    id VARCHAR(64) PRIMARY KEY,
    branch_id VARCHAR(64) REFERENCES tenant_branches(id),
    order_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    total_amount_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_ledger (
    id VARCHAR(64) PRIMARY KEY,
    account_code VARCHAR(32) NOT NULL,
    debit_cents BIGINT NOT NULL DEFAULT 0,
    credit_cents BIGINT NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

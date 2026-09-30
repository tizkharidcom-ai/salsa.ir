-- Migration 002: Tenant Menu Categories and Rich Menu Columns
CREATE TABLE IF NOT EXISTS tenant_menu_categories (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(255),
    display_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS price BIGINT DEFAULT 0;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS en VARCHAR(255);
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS ar VARCHAR(255);
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS desc_en TEXT;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS desc_ar TEXT;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS img TEXT;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS available BOOLEAN DEFAULT true;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS stock INT;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS low_stock_at INT DEFAULT 5;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS dayparts JSONB DEFAULT '["all"]'::jsonb;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS modifier_groups JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tenant_menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tenant_menu_items_category ON tenant_menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_tenant_menu_items_available ON tenant_menu_items(available);

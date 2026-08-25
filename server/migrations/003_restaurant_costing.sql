BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Normalized restaurant-costing layer. JSON recipe/PO lines from migration 002
-- remain readable during shadow migration, but all new writes target these rows.
CREATE TABLE IF NOT EXISTS finance_units (
  code TEXT PRIMARY KEY,
  title_fa TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('mass','volume','count')),
  base_factor NUMERIC(18,6) NOT NULL CHECK (base_factor > 0),
  is_base BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO finance_units (code, title_fa, dimension, base_factor, is_base) VALUES
  ('g', 'گرم', 'mass', 1, true),
  ('kg', 'کیلوگرم', 'mass', 1000, false),
  ('ml', 'میلی لیتر', 'volume', 1, true),
  ('l', 'لیتر', 'volume', 1000, false),
  ('count', 'عدد', 'count', 1, true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance_inventory_items_v2 (
  id TEXT PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  base_unit_code TEXT NOT NULL REFERENCES finance_units(code),
  costing_method TEXT NOT NULL DEFAULT 'weighted_average' CHECK (costing_method IN ('weighted_average','fifo')),
  reorder_point_base NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (reorder_point_base >= 0),
  safety_stock_base NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (safety_stock_base >= 0),
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, sku)
);

CREATE TABLE IF NOT EXISTS finance_item_unit_conversions (
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id) ON DELETE RESTRICT,
  from_unit_code TEXT NOT NULL REFERENCES finance_units(code),
  to_unit_code TEXT NOT NULL REFERENCES finance_units(code),
  multiplier NUMERIC(18,9) NOT NULL CHECK (multiplier > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, from_unit_code, to_unit_code),
  CHECK (from_unit_code <> to_unit_code)
);

CREATE TABLE IF NOT EXISTS finance_inventory_lots (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id),
  lot_no TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  expires_on DATE,
  received_quantity_base NUMERIC(18,6) NOT NULL CHECK (received_quantity_base > 0),
  remaining_quantity_base NUMERIC(18,6) NOT NULL CHECK (remaining_quantity_base >= 0),
  unit_cost_irr BIGINT NOT NULL CHECK (unit_cost_irr >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','quarantined','expired','depleted')),
  source_receipt_id UUID REFERENCES finance_goods_receipts(id),
  UNIQUE (branch_id, item_id, lot_no),
  CHECK (remaining_quantity_base <= received_quantity_base)
);

CREATE TABLE IF NOT EXISTS finance_inventory_balances (
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id),
  on_hand_base NUMERIC(18,6) NOT NULL DEFAULT 0,
  reserved_base NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (reserved_base >= 0),
  quarantined_base NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (quarantined_base >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, item_id),
  CHECK (on_hand_base >= 0),
  CHECK (reserved_base + quarantined_base <= on_hand_base)
);

CREATE TABLE IF NOT EXISTS finance_recipe_ingredients (
  id UUID PRIMARY KEY,
  recipe_version_id UUID NOT NULL REFERENCES finance_recipe_versions(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id),
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  unit_code TEXT NOT NULL REFERENCES finance_units(code),
  quantity_basis TEXT NOT NULL DEFAULT 'usable' CHECK (quantity_basis IN ('raw','usable')),
  yield_percent NUMERIC(7,4) NOT NULL DEFAULT 100 CHECK (yield_percent > 0 AND yield_percent <= 100),
  UNIQUE (recipe_version_id, line_no),
  UNIQUE (recipe_version_id, item_id)
);

ALTER TABLE finance_recipe_versions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_recipe_version_status_check') THEN
    ALTER TABLE finance_recipe_versions
      ADD CONSTRAINT finance_recipe_version_status_check CHECK (status IN ('draft','approved','retired'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_recipe_version_effective_no_overlap') THEN
    ALTER TABLE finance_recipe_versions
      ADD CONSTRAINT finance_recipe_version_effective_no_overlap
      EXCLUDE USING gist (
        branch_id WITH =,
        recipe_id WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
      ) WHERE (status IN ('approved'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS finance_production_batches (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  recipe_version_id UUID NOT NULL REFERENCES finance_recipe_versions(id),
  planned_yield NUMERIC(18,6) NOT NULL CHECK (planned_yield > 0),
  actual_yield NUMERIC(18,6) CHECK (actual_yield IS NULL OR actual_yield >= 0),
  status TEXT NOT NULL CHECK (status IN ('planned','in_progress','completed','cancelled')),
  produced_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_purchase_order_lines (
  id UUID PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES finance_purchase_orders(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id),
  ordered_quantity NUMERIC(18,6) NOT NULL CHECK (ordered_quantity > 0),
  unit_code TEXT NOT NULL REFERENCES finance_units(code),
  unit_price_irr BIGINT NOT NULL CHECK (unit_price_irr >= 0),
  tax_irr BIGINT NOT NULL DEFAULT 0 CHECK (tax_irr >= 0),
  discount_irr BIGINT NOT NULL DEFAULT 0 CHECK (discount_irr >= 0),
  line_total_irr BIGINT NOT NULL CHECK (line_total_irr >= 0),
  UNIQUE (purchase_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS finance_goods_receipt_lines (
  id UUID PRIMARY KEY,
  goods_receipt_id UUID NOT NULL REFERENCES finance_goods_receipts(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NOT NULL REFERENCES finance_purchase_order_lines(id),
  received_quantity NUMERIC(18,6) NOT NULL CHECK (received_quantity > 0),
  accepted_quantity NUMERIC(18,6) NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  unit_code TEXT NOT NULL REFERENCES finance_units(code),
  lot_id UUID REFERENCES finance_inventory_lots(id),
  UNIQUE (goods_receipt_id, purchase_order_line_id),
  CHECK (accepted_quantity + rejected_quantity = received_quantity)
);

CREATE TABLE IF NOT EXISTS finance_vendor_invoice_lines (
  id UUID PRIMARY KEY,
  vendor_invoice_id UUID NOT NULL REFERENCES finance_vendor_invoices(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  purchase_order_line_id UUID REFERENCES finance_purchase_order_lines(id),
  goods_receipt_line_id UUID REFERENCES finance_goods_receipt_lines(id),
  item_id TEXT NOT NULL REFERENCES finance_inventory_items_v2(id),
  invoiced_quantity NUMERIC(18,6) NOT NULL CHECK (invoiced_quantity > 0),
  unit_code TEXT NOT NULL REFERENCES finance_units(code),
  unit_price_irr BIGINT NOT NULL CHECK (unit_price_irr >= 0),
  tax_irr BIGINT NOT NULL DEFAULT 0 CHECK (tax_irr >= 0),
  discount_irr BIGINT NOT NULL DEFAULT 0 CHECK (discount_irr >= 0),
  line_total_irr BIGINT NOT NULL CHECK (line_total_irr >= 0),
  quantity_variance NUMERIC(18,6),
  price_variance_irr BIGINT,
  UNIQUE (vendor_invoice_id, line_no)
);

CREATE TABLE IF NOT EXISTS finance_order_item_cost_snapshots (
  id UUID PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES unified_orders(id),
  order_line_key TEXT NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  recipe_version_id UUID REFERENCES finance_recipe_versions(id),
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  net_sales_irr BIGINT NOT NULL CHECK (net_sales_irr >= 0),
  theoretical_cogs_irr BIGINT CHECK (theoretical_cogs_irr IS NULL OR theoretical_cogs_irr >= 0),
  captured_at TIMESTAMPTZ NOT NULL,
  calculation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (order_id, order_line_key)
);

CREATE TABLE IF NOT EXISTS finance_restaurant_cost_plans (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id),
  name TEXT NOT NULL,
  behavior TEXT NOT NULL CHECK (behavior IN ('fixed','variable','semi_variable')),
  amount_irr BIGINT NOT NULL CHECK (amount_irr >= 0),
  driver TEXT,
  driver_rate_irr BIGINT CHECK (driver_rate_irr IS NULL OR driver_rate_irr >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE IF NOT EXISTS finance_break_even_snapshots (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id),
  fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods_v2(id),
  calculated_at TIMESTAMPTZ NOT NULL,
  fixed_costs_irr BIGINT NOT NULL CHECK (fixed_costs_irr >= 0),
  net_sales_irr BIGINT NOT NULL CHECK (net_sales_irr >= 0),
  variable_costs_irr BIGINT NOT NULL CHECK (variable_costs_irr >= 0),
  contribution_margin_ratio NUMERIC(12,9) NOT NULL CHECK (contribution_margin_ratio > 0 AND contribution_margin_ratio <= 1),
  break_even_sales_irr BIGINT NOT NULL CHECK (break_even_sales_irr >= 0),
  gap_irr BIGINT NOT NULL CHECK (gap_irr >= 0),
  source_hash TEXT NOT NULL,
  calculation_payload JSONB NOT NULL,
  UNIQUE (branch_id, fiscal_period_id, source_hash),
  CHECK (variable_costs_irr <= net_sales_irr)
);

CREATE INDEX IF NOT EXISTS finance_inventory_lots_expiry_idx
  ON finance_inventory_lots (branch_id, expires_on, status)
  WHERE status IN ('available','quarantined');
CREATE INDEX IF NOT EXISTS finance_recipe_ingredients_item_idx
  ON finance_recipe_ingredients (item_id, recipe_version_id);
CREATE INDEX IF NOT EXISTS finance_purchase_order_lines_item_idx
  ON finance_purchase_order_lines (item_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS finance_order_cost_snapshot_branch_at_idx
  ON finance_order_item_cost_snapshots (branch_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS finance_cost_plan_period_idx
  ON finance_restaurant_cost_plans (branch_id, fiscal_period_id, behavior, status);

CREATE OR REPLACE FUNCTION finance_guard_inventory_movement_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements_are_immutable_use_reversal';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_inventory_movement_immutable_guard ON finance_inventory_movements;
CREATE TRIGGER finance_inventory_movement_immutable_guard
  BEFORE UPDATE OR DELETE ON finance_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION finance_guard_inventory_movement_immutable();

COMMIT;

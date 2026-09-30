BEGIN;

-- Finance V2 keeps branch_id on both sides of several relationships.  The
-- original single-column foreign keys only proved that the referenced row
-- existed; they did not prove that it belonged to the same branch.  This
-- migration closes that gap without rewriting any existing data.  The
-- preflight checks intentionally abort the whole transaction when historical
-- data is already inconsistent, so an operator can repair it with evidence
-- before enabling the hard constraints.

DO $$
DECLARE violation_count BIGINT;
BEGIN
  SELECT count(*) INTO violation_count
    FROM finance_payments p JOIN unified_orders o ON o.id = p.order_id
   WHERE p.branch_id IS DISTINCT FROM o.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:payments_orders:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM journal_entries_v2 j JOIN fiscal_periods_v2 p ON p.id = j.period_id
   WHERE p.branch_id IS NOT NULL AND p.branch_id IS DISTINCT FROM j.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:journal_periods:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM journal_lines_v2 l JOIN journal_entries_v2 j ON j.id = l.journal_entry_id
   WHERE l.branch_id IS DISTINCT FROM j.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:journal_lines:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_order_item_cost_snapshots s JOIN unified_orders o ON o.id = s.order_id
   WHERE s.branch_id IS DISTINCT FROM o.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:cost_snapshots_orders:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_order_item_cost_snapshots s JOIN finance_recipe_versions r ON r.id = s.recipe_version_id
   WHERE s.branch_id IS DISTINCT FROM r.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:cost_snapshots_recipes:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_goods_receipts g JOIN finance_purchase_orders p ON p.id = g.purchase_order_id
   WHERE g.branch_id IS DISTINCT FROM p.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:goods_receipts_purchase_orders:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_vendor_invoices i JOIN finance_purchase_orders p ON p.id = i.purchase_order_id
   WHERE i.branch_id IS DISTINCT FROM p.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:vendor_invoices_purchase_orders:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_purchase_order_lines l
    JOIN finance_purchase_orders p ON p.id = l.purchase_order_id
    JOIN finance_inventory_items_v2 i ON i.id = l.item_id
   WHERE p.branch_id IS DISTINCT FROM i.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:purchase_lines_items:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_inventory_lots l JOIN finance_inventory_items_v2 i ON i.id = l.item_id
   WHERE l.branch_id IS DISTINCT FROM i.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:inventory_lots_items:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_inventory_balances b JOIN finance_inventory_items_v2 i ON i.id = b.item_id
   WHERE b.branch_id IS DISTINCT FROM i.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:inventory_balances_items:%', violation_count USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO violation_count
    FROM finance_production_batches b JOIN finance_recipe_versions r ON r.id = b.recipe_version_id
   WHERE b.branch_id IS DISTINCT FROM r.branch_id;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:production_batches_recipes:%', violation_count USING ERRCODE = '23514';
  END IF;
END;
$$;

-- A primary key on id is not enough for a branch-aware foreign key.  These
-- unique indexes are harmless for existing rows and are valid FK targets.
CREATE UNIQUE INDEX IF NOT EXISTS unified_orders_id_branch_unique
  ON unified_orders (id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_v2_id_branch_unique
  ON journal_entries_v2 (id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS finance_purchase_orders_id_branch_unique
  ON finance_purchase_orders (id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS finance_inventory_items_v2_id_branch_unique
  ON finance_inventory_items_v2 (id, branch_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_payments_order_branch_fkey') THEN
    ALTER TABLE finance_payments
      ADD CONSTRAINT finance_payments_order_branch_fkey
      FOREIGN KEY (order_id, branch_id)
      REFERENCES unified_orders (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_entry_branch_fkey') THEN
    ALTER TABLE journal_lines_v2
      ADD CONSTRAINT journal_lines_entry_branch_fkey
      FOREIGN KEY (journal_entry_id, branch_id)
      REFERENCES journal_entries_v2 (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_cost_snapshot_order_branch_fkey') THEN
    ALTER TABLE finance_order_item_cost_snapshots
      ADD CONSTRAINT finance_cost_snapshot_order_branch_fkey
      FOREIGN KEY (order_id, branch_id)
      REFERENCES unified_orders (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_goods_receipt_purchase_order_branch_fkey') THEN
    ALTER TABLE finance_goods_receipts
      ADD CONSTRAINT finance_goods_receipt_purchase_order_branch_fkey
      FOREIGN KEY (purchase_order_id, branch_id)
      REFERENCES finance_purchase_orders (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_vendor_invoice_purchase_order_branch_fkey') THEN
    ALTER TABLE finance_vendor_invoices
      ADD CONSTRAINT finance_vendor_invoice_purchase_order_branch_fkey
      FOREIGN KEY (purchase_order_id, branch_id)
      REFERENCES finance_purchase_orders (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_inventory_lot_item_branch_fkey') THEN
    ALTER TABLE finance_inventory_lots
      ADD CONSTRAINT finance_inventory_lot_item_branch_fkey
      FOREIGN KEY (item_id, branch_id)
      REFERENCES finance_inventory_items_v2 (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_inventory_balance_item_branch_fkey') THEN
    ALTER TABLE finance_inventory_balances
      ADD CONSTRAINT finance_inventory_balance_item_branch_fkey
      FOREIGN KEY (item_id, branch_id)
      REFERENCES finance_inventory_items_v2 (id, branch_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

-- Global fiscal periods (branch_id IS NULL) remain valid fallbacks.  A
-- branch-specific period, however, may only be used by that branch.  The
-- trigger also protects the parent from being retagged after it is referenced.
CREATE OR REPLACE FUNCTION finance_guard_journal_period_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE period_branch BIGINT;
BEGIN
  IF NEW.period_id IS NULL THEN RETURN NEW; END IF;
  SELECT branch_id INTO period_branch FROM fiscal_periods_v2 WHERE id = NEW.period_id;
  IF FOUND AND period_branch IS NOT NULL AND period_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:journal_period' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_journal_period_branch_guard ON journal_entries_v2;
CREATE TRIGGER finance_journal_period_branch_guard
  BEFORE INSERT OR UPDATE OF period_id, branch_id ON journal_entries_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_journal_period_branch();

CREATE OR REPLACE FUNCTION finance_guard_fiscal_period_branch_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND EXISTS (
    SELECT 1 FROM journal_entries_v2 WHERE period_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'finance_fiscal_period_branch_immutable_when_referenced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_fiscal_period_branch_update_guard ON fiscal_periods_v2;
CREATE TRIGGER finance_fiscal_period_branch_update_guard
  BEFORE UPDATE OF branch_id ON fiscal_periods_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_fiscal_period_branch_update();

-- These relationships carry no branch_id column on the child, so a small
-- trigger is safer than adding a duplicated, drift-prone column during the
-- live rollout.  Parent branch changes are blocked when such a child exists.
CREATE OR REPLACE FUNCTION finance_guard_cost_snapshot_recipe_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE recipe_branch BIGINT;
BEGIN
  IF NEW.recipe_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT branch_id INTO recipe_branch FROM finance_recipe_versions WHERE id = NEW.recipe_version_id;
  IF FOUND AND recipe_branch IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'finance_branch_scope_violation:cost_snapshot_recipe' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finance_cost_snapshot_recipe_branch_guard ON finance_order_item_cost_snapshots;
CREATE TRIGGER finance_cost_snapshot_recipe_branch_guard
  BEFORE INSERT OR UPDATE OF recipe_version_id, branch_id ON finance_order_item_cost_snapshots
  FOR EACH ROW EXECUTE FUNCTION finance_guard_cost_snapshot_recipe_branch();

CREATE OR REPLACE FUNCTION finance_guard_costing_procurement_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_branch BIGINT; item_branch BIGINT; recipe_branch BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'finance_purchase_order_lines' THEN
    SELECT branch_id INTO parent_branch FROM finance_purchase_orders WHERE id = NEW.purchase_order_id;
    SELECT branch_id INTO item_branch FROM finance_inventory_items_v2 WHERE id = NEW.item_id;
    IF FOUND AND parent_branch IS DISTINCT FROM item_branch THEN
      RAISE EXCEPTION 'finance_branch_scope_violation:purchase_line_item' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'finance_recipe_ingredients' THEN
    SELECT branch_id INTO parent_branch FROM finance_recipe_versions WHERE id = NEW.recipe_version_id;
    SELECT branch_id INTO item_branch FROM finance_inventory_items_v2 WHERE id = NEW.item_id;
    IF FOUND AND parent_branch IS DISTINCT FROM item_branch THEN
      RAISE EXCEPTION 'finance_branch_scope_violation:recipe_ingredient_item' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'finance_production_batches' THEN
    IF NEW.recipe_version_id IS NOT NULL THEN
      SELECT branch_id INTO recipe_branch FROM finance_recipe_versions WHERE id = NEW.recipe_version_id;
      IF FOUND AND recipe_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'finance_branch_scope_violation:production_recipe' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.output_item_id IS NOT NULL THEN
      SELECT branch_id INTO item_branch FROM finance_inventory_items_v2 WHERE id = NEW.output_item_id;
      IF FOUND AND item_branch IS DISTINCT FROM NEW.branch_id THEN
        RAISE EXCEPTION 'finance_branch_scope_violation:production_output_item' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_purchase_line_branch_guard ON finance_purchase_order_lines;
CREATE TRIGGER finance_purchase_line_branch_guard
  BEFORE INSERT OR UPDATE OF purchase_order_id, item_id ON finance_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION finance_guard_costing_procurement_branch();
DROP TRIGGER IF EXISTS finance_recipe_ingredient_branch_guard ON finance_recipe_ingredients;
CREATE TRIGGER finance_recipe_ingredient_branch_guard
  BEFORE INSERT OR UPDATE OF recipe_version_id, item_id ON finance_recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION finance_guard_costing_procurement_branch();
DROP TRIGGER IF EXISTS finance_production_batch_branch_guard ON finance_production_batches;
CREATE TRIGGER finance_production_batch_branch_guard
  BEFORE INSERT OR UPDATE OF branch_id, recipe_version_id, output_item_id ON finance_production_batches
  FOR EACH ROW EXECUTE FUNCTION finance_guard_costing_procurement_branch();

CREATE OR REPLACE FUNCTION finance_guard_branch_parent_retag() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    IF TG_TABLE_NAME = 'finance_inventory_items_v2' AND (
      EXISTS (SELECT 1 FROM finance_recipe_ingredients WHERE item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_purchase_order_lines WHERE item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_inventory_lots WHERE item_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_inventory_balances WHERE item_id = OLD.id)
    ) THEN
      RAISE EXCEPTION 'finance_inventory_item_branch_immutable_when_referenced' USING ERRCODE = '23514';
    ELSIF TG_TABLE_NAME = 'finance_recipe_versions' AND (
      EXISTS (SELECT 1 FROM finance_recipe_ingredients WHERE recipe_version_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_order_item_cost_snapshots WHERE recipe_version_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_production_batches WHERE recipe_version_id = OLD.id)
    ) THEN
      RAISE EXCEPTION 'finance_recipe_branch_immutable_when_referenced' USING ERRCODE = '23514';
    ELSIF TG_TABLE_NAME = 'finance_purchase_orders' AND (
      EXISTS (SELECT 1 FROM finance_purchase_order_lines WHERE purchase_order_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_goods_receipts WHERE purchase_order_id = OLD.id)
      OR EXISTS (SELECT 1 FROM finance_vendor_invoices WHERE purchase_order_id = OLD.id)
    ) THEN
      RAISE EXCEPTION 'finance_purchase_order_branch_immutable_when_referenced' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_inventory_item_branch_retag_guard ON finance_inventory_items_v2;
CREATE TRIGGER finance_inventory_item_branch_retag_guard
  BEFORE UPDATE OF branch_id ON finance_inventory_items_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_branch_parent_retag();
DROP TRIGGER IF EXISTS finance_recipe_branch_retag_guard ON finance_recipe_versions;
CREATE TRIGGER finance_recipe_branch_retag_guard
  BEFORE UPDATE OF branch_id ON finance_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION finance_guard_branch_parent_retag();
DROP TRIGGER IF EXISTS finance_purchase_order_branch_retag_guard ON finance_purchase_orders;
CREATE TRIGGER finance_purchase_order_branch_retag_guard
  BEFORE UPDATE OF branch_id ON finance_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION finance_guard_branch_parent_retag();

COMMIT;

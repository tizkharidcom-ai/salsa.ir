BEGIN;

ALTER TABLE finance_recipe_versions
  ADD COLUMN IF NOT EXISTS menu_item_name TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS output_item_id TEXT REFERENCES finance_inventory_items_v2(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_id UUID REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by TEXT,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE finance_recipe_versions DROP CONSTRAINT IF EXISTS finance_recipe_version_status_check;
ALTER TABLE finance_recipe_versions
  ADD CONSTRAINT finance_recipe_version_status_check
  CHECK (status IN ('draft','pending_approval','approved','retired','rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS finance_recipe_versions_approval_uq
  ON finance_recipe_versions (approval_id) WHERE approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_recipe_versions_menu_effective_idx
  ON finance_recipe_versions (branch_id, menu_item_id, effective_from DESC);

CREATE OR REPLACE FUNCTION finance_guard_recipe_version_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD.recipe_id IS DISTINCT FROM NEW.recipe_id
    OR OLD.menu_item_id IS DISTINCT FROM NEW.menu_item_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.branch_id IS DISTINCT FROM NEW.branch_id
    OR OLD.yield_quantity IS DISTINCT FROM NEW.yield_quantity
    OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
    OR OLD.ingredients IS DISTINCT FROM NEW.ingredients
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.approval_id IS DISTINCT FROM NEW.approval_id
    OR OLD.output_item_id IS DISTINCT FROM NEW.output_item_id
    OR OLD.menu_item_name IS DISTINCT FROM NEW.menu_item_name
    OR OLD.name IS DISTINCT FROM NEW.name THEN
    RAISE EXCEPTION 'finance_recipe_version_core_immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status IN ('draft','pending_approval') AND NEW.status IN ('pending_approval','approved','rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'retired')
  ) THEN
    RAISE EXCEPTION 'finance_recipe_version_transition_invalid';
  END IF;

  IF OLD.effective_to IS DISTINCT FROM NEW.effective_to
    AND NOT (OLD.status = 'approved' AND NEW.status = 'retired' AND NEW.effective_to > NEW.effective_from) THEN
    RAISE EXCEPTION 'finance_recipe_effective_to_invalid';
  END IF;

  IF NEW.status = 'approved' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'finance_recipe_approval_audit_required';
  END IF;
  IF NEW.status = 'rejected' AND (NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL) THEN
    RAISE EXCEPTION 'finance_recipe_rejection_audit_required';
  END IF;
  IF NEW.status = 'retired' AND (NEW.retired_by IS NULL OR NEW.retired_at IS NULL OR NEW.effective_to IS NULL) THEN
    RAISE EXCEPTION 'finance_recipe_retirement_audit_required';
  END IF;
  IF NEW.status IN ('approved','rejected') AND NEW.created_by IN (NEW.approved_by, NEW.rejected_by) THEN
    RAISE EXCEPTION 'finance_recipe_segregation_of_duties';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_recipe_version_lifecycle_guard ON finance_recipe_versions;
CREATE TRIGGER finance_recipe_version_lifecycle_guard
BEFORE UPDATE ON finance_recipe_versions
FOR EACH ROW EXECUTE FUNCTION finance_guard_recipe_version_lifecycle();

CREATE OR REPLACE FUNCTION finance_guard_recipe_ingredient_append_only() RETURNS trigger AS $$
DECLARE recipe_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'finance_recipe_ingredient_immutable';
  END IF;
  SELECT status INTO recipe_status FROM finance_recipe_versions WHERE id = NEW.recipe_version_id FOR UPDATE;
  IF recipe_status NOT IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'finance_recipe_ingredient_requires_pending_recipe';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_recipe_ingredient_append_only_guard ON finance_recipe_ingredients;
CREATE TRIGGER finance_recipe_ingredient_append_only_guard
BEFORE INSERT OR UPDATE OR DELETE ON finance_recipe_ingredients
FOR EACH ROW EXECUTE FUNCTION finance_guard_recipe_ingredient_append_only();

CREATE OR REPLACE FUNCTION finance_guard_recipe_version_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finance_recipe_version_delete_forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_recipe_version_delete_guard ON finance_recipe_versions;
CREATE TRIGGER finance_recipe_version_delete_guard
BEFORE DELETE ON finance_recipe_versions
FOR EACH ROW EXECUTE FUNCTION finance_guard_recipe_version_delete();

COMMIT;

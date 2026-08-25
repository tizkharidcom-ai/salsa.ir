BEGIN;

-- Operational kitchen/warehouse facts are immutable. Financial valuation is
-- stored in a sidecar so a later trusted cost never rewrites the physical row.
ALTER TABLE finance_inventory_movements
  ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES finance_inventory_movements(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS finance_inventory_movement_single_reversal_idx
  ON finance_inventory_movements (reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_inventory_movement_valuations (
  id UUID PRIMARY KEY,
  movement_id UUID NOT NULL UNIQUE REFERENCES finance_inventory_movements(id) ON DELETE RESTRICT,
  unit_cost_irr BIGINT NOT NULL CHECK (unit_cost_irr >= 0),
  total_cost_irr BIGINT NOT NULL CHECK (total_cost_irr >= 0),
  valuation_source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy recipe identifiers are textual. During shadow migration a production
-- batch may therefore point either to a normalized UUID or its source id.
ALTER TABLE finance_production_batches
  ALTER COLUMN recipe_version_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS recipe_source_id TEXT,
  ADD COLUMN IF NOT EXISTS output_item_id TEXT,
  ADD COLUMN IF NOT EXISTS finance_event_id UUID UNIQUE REFERENCES finance_events(id) ON DELETE RESTRICT;

UPDATE finance_production_batches
SET recipe_source_id = recipe_version_id::text
WHERE recipe_source_id IS NULL AND recipe_version_id IS NOT NULL;

ALTER TABLE finance_production_batches
  ALTER COLUMN recipe_source_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_production_recipe_reference_check') THEN
    ALTER TABLE finance_production_batches
      ADD CONSTRAINT finance_production_recipe_reference_check
      CHECK (recipe_version_id IS NOT NULL OR length(trim(recipe_source_id)) > 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION finance_guard_inventory_valuation_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movement_valuations_are_immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_inventory_valuation_immutable_guard ON finance_inventory_movement_valuations;
CREATE TRIGGER finance_inventory_valuation_immutable_guard
  BEFORE UPDATE OR DELETE ON finance_inventory_movement_valuations
  FOR EACH ROW EXECUTE FUNCTION finance_guard_inventory_valuation_immutable();

CREATE OR REPLACE FUNCTION finance_guard_production_batch_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'production_batches_are_immutable_use_reversal';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_production_batch_immutable_guard ON finance_production_batches;
CREATE TRIGGER finance_production_batch_immutable_guard
  BEFORE UPDATE OR DELETE ON finance_production_batches
  FOR EACH ROW EXECUTE FUNCTION finance_guard_production_batch_immutable();

COMMIT;

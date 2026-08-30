BEGIN;

CREATE TABLE IF NOT EXISTS finance_branch_rollouts (
  id UUID PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES unified_branches(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','active','rejected')),
  approval_id UUID NOT NULL UNIQUE REFERENCES finance_approvals(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  activated_by TEXT,
  activated_at TIMESTAMPTZ,
  readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_at_activation JSONB,
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (
    (status = 'pending_approval' AND decided_by IS NULL AND decided_at IS NULL AND activated_by IS NULL AND activated_at IS NULL AND readiness_at_activation IS NULL)
    OR (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND activated_by IS NULL AND activated_at IS NULL AND readiness_at_activation IS NULL)
    OR (status = 'active' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND activated_by = decided_by AND activated_at = decided_at AND readiness_at_activation IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_branch_rollout_one_active_request
  ON finance_branch_rollouts(branch_id)
  WHERE status IN ('pending_approval','active');

CREATE INDEX IF NOT EXISTS finance_branch_rollout_history_idx
  ON finance_branch_rollouts(branch_id, requested_at DESC);

CREATE OR REPLACE FUNCTION finance_branch_rollout_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('active','rejected') THEN
    RAISE EXCEPTION 'finance_branch_rollout_history_is_immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending_approval' AND NEW.status NOT IN ('pending_approval','active','rejected') THEN
      RAISE EXCEPTION 'invalid_finance_branch_rollout_transition';
    ELSIF OLD.status IN ('active','rejected') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'final_finance_branch_rollout_is_immutable';
    END IF;
    IF OLD.status IN ('active','rejected') AND (
      NEW.branch_id IS DISTINCT FROM OLD.branch_id
      OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
      OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
      OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
      OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
      OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.readiness_snapshot IS DISTINCT FROM OLD.readiness_snapshot
      OR NEW.readiness_at_activation IS DISTINCT FROM OLD.readiness_at_activation
    ) THEN
      RAISE EXCEPTION 'finance_branch_rollout_history_is_immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS finance_branch_rollout_immutable_trigger ON finance_branch_rollouts;
CREATE TRIGGER finance_branch_rollout_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_branch_rollouts
  FOR EACH ROW EXECUTE FUNCTION finance_branch_rollout_immutable_guard();

COMMIT;

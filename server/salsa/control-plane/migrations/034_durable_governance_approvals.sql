-- Migration 034: Durable, immutable four-eyes approvals for critical platform actions

BEGIN;

CREATE TABLE IF NOT EXISTS neem_platform_governance_approvals (
  id UUID PRIMARY KEY,
  action_type TEXT NOT NULL CHECK (length(btrim(action_type)) BETWEEN 3 AND 100),
  target_resource TEXT NOT NULL CHECK (length(btrim(target_resource)) BETWEEN 1 AND 240),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64 AND payload_digest ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'consumed')),
  requested_by UUID NOT NULL REFERENCES neem_platform_principals(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_by UUID REFERENCES neem_platform_principals(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  confirmation_note TEXT,
  rejected_by UUID REFERENCES neem_platform_principals(id) ON DELETE RESTRICT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  consumed_by UUID REFERENCES neem_platform_principals(id) ON DELETE RESTRICT,
  consumed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT neem_platform_governance_approvals_four_eyes_ck
    CHECK (confirmed_by IS NULL OR confirmed_by <> requested_by),
  CONSTRAINT neem_platform_governance_approvals_confirmation_ck
    CHECK (status NOT IN ('approved', 'consumed') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT neem_platform_governance_approvals_rejection_ck
    CHECK (status <> 'rejected' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL)),
  CONSTRAINT neem_platform_governance_approvals_consumption_ck
    CHECK (status <> 'consumed' OR (consumed_by IS NOT NULL AND consumed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS neem_platform_governance_approvals_queue_idx
  ON neem_platform_governance_approvals (status, requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS neem_platform_governance_approvals_expiry_idx
  ON neem_platform_governance_approvals (expires_at)
  WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS neem_platform_governance_approvals_binding_idx
  ON neem_platform_governance_approvals (action_type, target_resource, payload_digest, status);

-- Action identity, target, payload digest, rationale, requester, and both expiry
-- boundaries cannot be rewritten after the request has been created.
CREATE OR REPLACE FUNCTION neem_guard_governance_approval_binding_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.action_type,
    NEW.target_resource,
    NEW.payload,
    NEW.payload_digest,
    NEW.reason,
    NEW.metadata,
    NEW.requested_by,
    NEW.requested_at,
    NEW.expires_at
  ) IS DISTINCT FROM ROW(
    OLD.action_type,
    OLD.target_resource,
    OLD.payload,
    OLD.payload_digest,
    OLD.reason,
    OLD.metadata,
    OLD.requested_by,
    OLD.requested_at,
    OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'GOVERNANCE_APPROVAL_BINDING_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS neem_platform_governance_approval_binding_immutable
  ON neem_platform_governance_approvals;
CREATE TRIGGER neem_platform_governance_approval_binding_immutable
  BEFORE UPDATE ON neem_platform_governance_approvals
  FOR EACH ROW EXECUTE FUNCTION neem_guard_governance_approval_binding_update();

COMMIT;

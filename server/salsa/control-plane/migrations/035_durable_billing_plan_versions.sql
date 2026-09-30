-- Migration 035: Durable versioned billing plans and checkout price provenance.
-- Backfills only the current persisted catalog rows; it does not infer earlier prices.

ALTER TABLE neem_billing_plans
  ALTER COLUMN version TYPE VARCHAR(32);

CREATE TABLE IF NOT EXISTS neem_billing_plan_versions (
  plan_code VARCHAR(32) NOT NULL REFERENCES neem_billing_plans(plan_code) ON DELETE RESTRICT,
  version VARCHAR(32) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  is_custom BOOLEAN NOT NULL DEFAULT false,
  custom_tenant_id VARCHAR(64),
  name_fa VARCHAR(128) NOT NULL,
  description_fa TEXT NOT NULL DEFAULT '',
  base_price_monthly_rials BIGINT NOT NULL CHECK (base_price_monthly_rials >= 0),
  included_branches INT NOT NULL CHECK (included_branches > 0),
  included_devices INT NOT NULL CHECK (included_devices > 0),
  included_users INT NOT NULL CHECK (included_users > 0),
  included_features JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(included_features) = 'array'),
  quotas JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quotas) = 'object'),
  published_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  created_by VARCHAR(128),
  updated_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, version),
  UNIQUE (plan_code, version, custom_tenant_id),
  CHECK ((is_custom AND custom_tenant_id IS NOT NULL) OR (NOT is_custom AND custom_tenant_id IS NULL)),
  CHECK ((state = 'draft' AND published_at IS NULL AND effective_from IS NULL AND effective_to IS NULL)
      OR (state = 'published' AND published_at IS NOT NULL AND effective_from IS NOT NULL
          AND (effective_to IS NULL OR effective_to > effective_from)))
);

CREATE INDEX IF NOT EXISTS idx_neem_billing_plan_versions_effective
  ON neem_billing_plan_versions(plan_code, effective_from DESC)
  WHERE state = 'published';
CREATE INDEX IF NOT EXISTS idx_neem_billing_plan_versions_custom_tenant
  ON neem_billing_plan_versions(custom_tenant_id, plan_code)
  WHERE is_custom = true;
CREATE INDEX IF NOT EXISTS idx_neem_billing_plan_versions_drafts
  ON neem_billing_plan_versions(plan_code, updated_at DESC)
  WHERE state = 'draft';

-- Preserve each current catalog row as a single version. No missing history is fabricated.
INSERT INTO neem_billing_plan_versions (
  plan_code, version, state, is_custom, custom_tenant_id, name_fa, description_fa,
  base_price_monthly_rials, included_branches, included_devices, included_users,
  included_features, quotas, published_at, effective_from, created_at, updated_at
)
SELECT p.plan_code, p.version,
       CASE WHEN p.is_draft THEN 'draft' ELSE 'published' END,
       p.is_custom, p.custom_tenant_id, p.name_fa, COALESCE(p.description_fa, ''),
       p.base_price_monthly_rials, p.included_branches, p.included_devices,
       p.included_users, COALESCE(p.features, '[]'::jsonb), COALESCE(p.quotas, '{}'::jsonb),
       CASE WHEN p.is_draft THEN NULL ELSE COALESCE(p.published_at, p.effective_from, p.created_at, now()) END,
       CASE WHEN p.is_draft THEN NULL ELSE COALESCE(p.effective_from, p.published_at, p.created_at, now()) END,
       p.created_at, now()
  FROM neem_billing_plans p
ON CONFLICT (plan_code, version) DO NOTHING;

ALTER TABLE neem_billing_subscriptions
  ADD COLUMN IF NOT EXISTS plan_version VARCHAR(32);
UPDATE neem_billing_subscriptions s
   SET plan_version = p.version
  FROM neem_billing_plans p
 WHERE s.plan_code = p.plan_code AND s.plan_version IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM neem_billing_subscriptions WHERE plan_version IS NULL) THEN
    RAISE EXCEPTION 'Cannot version billing subscriptions: one or more plan codes have no persisted plan row.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM neem_billing_subscriptions s
      JOIN neem_billing_plan_versions v ON v.plan_code = s.plan_code AND v.version = s.plan_version
     WHERE s.status IN ('trial', 'active', 'past_due', 'grace_period') AND v.state = 'draft'
  ) THEN
    RAISE EXCEPTION 'Cannot version billing subscriptions: an active subscription references a draft plan; reconcile its effective published price first.';
  END IF;
  ALTER TABLE neem_billing_subscriptions ALTER COLUMN plan_version SET NOT NULL;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_neem_subscription_plan_version'
  ) THEN
    ALTER TABLE neem_billing_subscriptions
      ADD CONSTRAINT fk_neem_subscription_plan_version
      FOREIGN KEY (plan_code, plan_version)
      REFERENCES neem_billing_plan_versions(plan_code, version)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE neem_billing_invoices
  ADD COLUMN IF NOT EXISTS plan_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS plan_version VARCHAR(32);
UPDATE neem_billing_invoices i
   SET plan_code = s.plan_code, plan_version = s.plan_version
  FROM neem_billing_subscriptions s
 WHERE i.subscription_id = s.id AND i.plan_code IS NULL AND i.plan_version IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_neem_invoice_plan_version_pair') THEN
    ALTER TABLE neem_billing_invoices
      ADD CONSTRAINT ck_neem_invoice_plan_version_pair
      CHECK ((plan_code IS NULL) = (plan_version IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_neem_invoice_plan_version') THEN
    ALTER TABLE neem_billing_invoices
      ADD CONSTRAINT fk_neem_invoice_plan_version
      FOREIGN KEY (plan_code, plan_version)
      REFERENCES neem_billing_plan_versions(plan_code, version)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM neem_billing_subscriptions s
      JOIN neem_billing_plan_versions v ON v.plan_code = s.plan_code AND v.version = s.plan_version
     WHERE v.is_custom = true AND v.custom_tenant_id IS DISTINCT FROM s.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cannot enable tenant-scoped custom plans: an existing subscription points to another tenant custom plan.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM neem_billing_invoices i
      JOIN neem_billing_plan_versions v ON v.plan_code = i.plan_code AND v.version = i.plan_version
     WHERE v.is_custom = true AND v.custom_tenant_id IS DISTINCT FROM i.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cannot enable tenant-scoped custom plans: an existing invoice points to another tenant custom plan.';
  END IF;
END $$;

-- A custom plan can only be attached to billing records owned by its tenant.
CREATE OR REPLACE FUNCTION neem_enforce_billing_plan_tenant_scope()
RETURNS TRIGGER AS $$
DECLARE
  plan_is_custom BOOLEAN;
  plan_owner_tenant_id VARCHAR(64);
BEGIN
  IF NEW.plan_code IS NULL AND NEW.plan_version IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.plan_code IS NULL OR NEW.plan_version IS NULL THEN
    RAISE EXCEPTION 'Plan code and version must be supplied together.';
  END IF;
  SELECT is_custom, custom_tenant_id
    INTO plan_is_custom, plan_owner_tenant_id
    FROM neem_billing_plan_versions
   WHERE plan_code = NEW.plan_code AND version = NEW.plan_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing plan version does not exist.';
  END IF;
  IF plan_is_custom AND plan_owner_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Custom billing plan belongs to a different tenant.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_neem_subscription_plan_tenant_scope ON neem_billing_subscriptions;
CREATE TRIGGER trg_neem_subscription_plan_tenant_scope
BEFORE INSERT OR UPDATE OF tenant_id, plan_code, plan_version ON neem_billing_subscriptions
FOR EACH ROW EXECUTE FUNCTION neem_enforce_billing_plan_tenant_scope();

DROP TRIGGER IF EXISTS trg_neem_invoice_plan_tenant_scope ON neem_billing_invoices;
CREATE TRIGGER trg_neem_invoice_plan_tenant_scope
BEFORE INSERT OR UPDATE OF tenant_id, plan_code, plan_version ON neem_billing_invoices
FOR EACH ROW EXECUTE FUNCTION neem_enforce_billing_plan_tenant_scope();

-- Durable idempotency makes admin retries safe across process restarts and replicas.
CREATE TABLE IF NOT EXISTS neem_billing_plan_operations (
  operation_key CHAR(64) PRIMARY KEY,
  operation_type TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_neem_billing_plan_operations_created
  ON neem_billing_plan_operations(created_at DESC);

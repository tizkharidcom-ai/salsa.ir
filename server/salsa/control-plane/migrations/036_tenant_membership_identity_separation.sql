-- Migration 036: prevent platform and guest identities from receiving tenant memberships

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM neem_tenant_memberships m
    JOIN neem_tenant_identities i ON i.id = m.identity_id
    WHERE i.identity_type <> 'restaurant_staff'
  ) THEN
    RAISE EXCEPTION 'IDENTITY_TYPE_SEPARATION_VIOLATION: tenant memberships contain non-restaurant identities';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION neem_enforce_restaurant_identity_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  member_identity_type TEXT;
BEGIN
  SELECT identity_type
    INTO member_identity_type
    FROM neem_tenant_identities
   WHERE id = NEW.identity_id
   -- Serialize membership creation with identity_type changes. KEY SHARE is
   -- compatible with the NO KEY UPDATE lock used by an identity_type update,
   -- so concurrent insert/promotion transactions could otherwise both pass.
   FOR SHARE;

  IF member_identity_type IS DISTINCT FROM 'restaurant_staff' THEN
    RAISE EXCEPTION 'IDENTITY_TYPE_SEPARATION_VIOLATION: tenant membership requires restaurant_staff identity'
      USING ERRCODE = '23514', CONSTRAINT = 'tenant_membership_restaurant_identity_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION neem_prevent_membership_identity_promotion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.identity_type IS DISTINCT FROM OLD.identity_type
     AND NEW.identity_type <> 'restaurant_staff'
     AND EXISTS (
       SELECT 1 FROM neem_tenant_memberships m WHERE m.identity_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'IDENTITY_TYPE_SEPARATION_VIOLATION: a tenant member identity cannot become a platform or guest identity'
      USING ERRCODE = '23514', CONSTRAINT = 'identity_type_membership_separation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_membership_restaurant_identity_only ON neem_tenant_memberships;
CREATE TRIGGER trg_tenant_membership_restaurant_identity_only
BEFORE INSERT OR UPDATE ON neem_tenant_memberships
FOR EACH ROW EXECUTE FUNCTION neem_enforce_restaurant_identity_membership();

DROP TRIGGER IF EXISTS trg_identity_type_membership_separation ON neem_tenant_identities;
CREATE TRIGGER trg_identity_type_membership_separation
BEFORE UPDATE OF identity_type ON neem_tenant_identities
FOR EACH ROW EXECUTE FUNCTION neem_prevent_membership_identity_promotion();

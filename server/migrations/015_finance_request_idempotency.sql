BEGIN;

CREATE TABLE IF NOT EXISTS finance_idempotency_requests (
  idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) BETWEEN 8 AND 200),
  operation TEXT NOT NULL CHECK (length(trim(operation)) BETWEEN 3 AND 240),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_kind TEXT NOT NULL CHECK (length(trim(outcome_kind)) BETWEEN 2 AND 120),
  outcome_id TEXT NOT NULL CHECK (length(trim(outcome_id)) BETWEEN 1 AND 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_idempotency_requests_created_idx
  ON finance_idempotency_requests(created_at DESC);

CREATE OR REPLACE FUNCTION finance_idempotency_request_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finance_idempotency_requests_are_immutable';
END;
$$;

DROP TRIGGER IF EXISTS finance_idempotency_request_immutable_trigger ON finance_idempotency_requests;
CREATE TRIGGER finance_idempotency_request_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_idempotency_requests
  FOR EACH ROW EXECUTE FUNCTION finance_idempotency_request_immutable_guard();

COMMIT;

BEGIN;

-- 002 installed a journal-line trigger that treated any UPDATE preserving the
-- row id as a replay. That left posted line amounts/account/branch mutable.
-- Replace it additively so already-applied migration checksums remain intact.
CREATE OR REPLACE FUNCTION finance_guard_posted_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted','reversed') THEN
      RAISE EXCEPTION 'posted_journal_is_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN
      RETURN NEW;
    END IF;

    IF OLD.status IN ('posted','reversed') THEN
      RAISE EXCEPTION 'posted_journal_is_immutable_use_reversal';
    END IF;

    -- Posting/finalizing a draft may set only its period and posting metadata.
    -- All source identity, branch, and financial amounts must already be fixed.
    IF NEW.status IN ('posted','reversed') THEN
      IF OLD.status NOT IN ('draft','pending_approval')
        OR ROW(OLD.id,OLD.number,OLD.finance_event_id,OLD.source,OLD.source_id,
          OLD.entry_at,OLD.description,OLD.debit_irr,OLD.credit_irr,OLD.branch_id,
          OLD.reversal_of_id,OLD.created_by,OLD.created_at)
          IS DISTINCT FROM
          ROW(NEW.id,NEW.number,NEW.finance_event_id,NEW.source,NEW.source_id,
          NEW.entry_at,NEW.description,NEW.debit_irr,NEW.credit_irr,NEW.branch_id,
          NEW.reversal_of_id,NEW.created_by,NEW.created_at) THEN
        RAISE EXCEPTION 'posted_journal_identity_is_immutable';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_journal_immutable_guard ON journal_entries_v2;
CREATE TRIGGER finance_journal_immutable_guard
  BEFORE UPDATE OR DELETE ON journal_entries_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_posted_immutable();

CREATE OR REPLACE FUNCTION finance_guard_posted_lines_immutable() RETURNS trigger AS $$
DECLARE target_id UUID; target_status TEXT; same_line BOOLEAN; existing_line BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The repository replays immutable posted lines with an ON CONFLICT
    -- no-op. Permit only an exact duplicate identity; the subsequent UPDATE
    -- trigger independently enforces that it changes no fields.
    SELECT ROW(journal_entry_id,line_no,account_code,debit_irr,credit_irr,branch_id,
      cost_center,counterparty_id,payment_method,item_id,recipe_version_id,memo)
      IS NOT DISTINCT FROM
      ROW(NEW.journal_entry_id,NEW.line_no,NEW.account_code,NEW.debit_irr,NEW.credit_irr,NEW.branch_id,
      NEW.cost_center,NEW.counterparty_id,NEW.payment_method,NEW.item_id,NEW.recipe_version_id,NEW.memo)
      INTO same_line
      FROM journal_lines_v2
      WHERE id = NEW.id
      FOR UPDATE;
    existing_line := FOUND;
    IF existing_line AND NOT same_line THEN
      RAISE EXCEPTION 'posted_journal_lines_are_immutable_use_reversal';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id THEN
    RAISE EXCEPTION 'journal_line_parent_is_immutable';
  END IF;

  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;

  -- Serialize line writes with the parent journal's transition to a final
  -- state. If posting wins the lock, this writer sees the final status and is
  -- rejected; if this writer wins, posting validates the committed line set.
  SELECT status INTO target_status
    FROM journal_entries_v2
    WHERE id = target_id
    FOR UPDATE;

  IF target_status IN ('posted','reversed') THEN
    IF TG_OP = 'INSERT' AND existing_line AND same_line THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'posted_journal_lines_are_immutable_use_reversal';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_journal_lines_immutable_guard ON journal_lines_v2;
CREATE TRIGGER finance_journal_lines_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines_v2
  FOR EACH ROW EXECUTE FUNCTION finance_guard_posted_lines_immutable();

COMMIT;

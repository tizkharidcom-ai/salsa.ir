-- server/salsa/control-plane/migrations/022_release_wave_invariants.sql
-- Migration 022: Prevent duplicate rollout waves for the same release/number.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM neem_rollout_waves
        GROUP BY version, wave_number
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'CONTROL_PLANE_RELEASE_WAVE_DUPLICATES: resolve duplicate version/wave_number rows before applying migration 022';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS neem_rollout_waves_version_number_uidx
    ON neem_rollout_waves(version, wave_number);

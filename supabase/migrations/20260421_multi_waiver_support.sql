-- scripts/migrate-waivers.sql
-- Multi-waiver support migration
--
-- HOW TO RUN:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Paste and run this entire script
-- 3. Verify with the SELECT statements at the bottom
--
-- SAFETY: This script does NOT drop old columns. They are kept for backward
-- compatibility until the new code has been deployed and verified in production.
-- Drop them only after running Task 11 (cleanup) from the implementation plan.

-- ── events table: add waivers JSONB array ────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS waivers jsonb NOT NULL DEFAULT '[]';

-- Migrate existing single-waiver data (waiver_enabled = true) to the array format.
-- Only updates rows that haven't already been migrated (waivers still empty).
UPDATE events
SET waivers = jsonb_build_array(
    jsonb_build_object(
        'id',          'w_migrated_' || id::text,
        'title',       COALESCE(waiver_title, ''),
        'content',     COALESCE(waiver_content, ''),
        'contentHash', COALESCE(waiver_content_hash, ''),
        'required',    true,
        'order',       0
    )
)
WHERE waiver_enabled = true
  AND (waiver_title IS NOT NULL OR waiver_content IS NOT NULL)
  AND waivers = '[]';

-- ── registrations table: add signature_records JSONB array ───────────────────

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS signature_records jsonb NOT NULL DEFAULT '[]';

-- Migrate existing single signature_record to the array format.
-- Handles the case where signature_record might be stored as JSON or string.
UPDATE registrations
SET signature_records = jsonb_build_array(
    signature_record || jsonb_build_object(
        'waiverId', 'w_migrated_' || event_id::text,
        'declined', false
    )
)
WHERE signature_record IS NOT NULL
  AND signature_record != 'null'::jsonb
  AND (signature_record->>'signed')::boolean = true
  AND signature_records = '[]';

-- ── Verification queries (run after migration to confirm correct results) ─────

-- Check events: how many were migrated?
SELECT
    COUNT(*) FILTER (WHERE waiver_enabled = true AND waivers != '[]') AS events_migrated,
    COUNT(*) FILTER (WHERE waiver_enabled = true AND waivers = '[]')  AS events_skipped,
    COUNT(*) FILTER (WHERE waiver_enabled = false)                    AS events_no_waiver
FROM events;

-- Spot-check a few migrated events
SELECT id, title, json_array_length(waivers) AS waiver_count, waivers
FROM events
WHERE waiver_enabled = true
LIMIT 5;

-- Check registrations: how many were migrated?
SELECT
    COUNT(*) FILTER (WHERE signature_record IS NOT NULL AND signature_records != '[]') AS regs_migrated,
    COUNT(*) FILTER (WHERE signature_record IS NOT NULL AND signature_records = '[]')  AS regs_skipped,
    COUNT(*) FILTER (WHERE signature_record IS NULL)                                   AS regs_no_sig
FROM registrations;

-- Spot-check a few migrated registrations
SELECT id, event_id, json_array_length(signature_records) AS record_count, signature_records
FROM registrations
WHERE signature_record IS NOT NULL
LIMIT 5;

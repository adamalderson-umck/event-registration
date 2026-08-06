-- ── events table: add waivers JSONB array ────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS waivers jsonb NOT NULL DEFAULT '[]';

-- Migrate existing single-waiver data (waiver_enabled = true) to the array format.
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
  AND signature_records = '[]';;

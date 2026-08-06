-- Add nullable slug column to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT;

-- Enforce uniqueness per-org (two orgs can have events with the same slug)
CREATE UNIQUE INDEX IF NOT EXISTS events_org_id_slug_idx
  ON events (org_id, slug)
  WHERE slug IS NOT NULL;;

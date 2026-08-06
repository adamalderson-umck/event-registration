-- Add header image and theme columns to events
ALTER TABLE events ADD COLUMN header_image_url TEXT;
ALTER TABLE events ADD COLUMN theme JSONB;

-- Add org-level defaults for header image and theme
ALTER TABLE organizations ADD COLUMN default_header_image_url TEXT;
ALTER TABLE organizations ADD COLUMN default_theme JSONB;;

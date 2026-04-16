# Header Image Upload & Theme Color Choice

## Overview

Add per-event header image upload and theme color selection to the event registration system, with organization-level defaults that events can override.

## Decisions Made (Brainstorming)

| Decision | Choice |
|---|---|
| Scope | Org-level default, event-level override |
| Theme colors | 8-10 curated presets + custom hex picker |
| Aspect ratio | Soft 16:9 constraint — any ratio accepted, displayed as 16:9 letterboxed, warning if non-conforming |
| File size | 5MB max (Supabase free tier allows 50MB/file, 1GB total) |
| Fallback | Gradient-only header colored by theme choice when no image |

## Architecture

### Data Model

**`events` table** — add two columns:
- `header_image_url TEXT` — public URL of uploaded image (nullable)
- `theme JSONB` — `{ "preset": "ocean" | "forest" | ... | "custom", "primaryColor": "#hex", "accentColor": "#hex" }` (nullable, falls back to org default → system default)

**`organizations` table** — add two columns:
- `default_header_image_url TEXT` — org-wide default banner (nullable)
- `default_theme JSONB` — org-wide default theme (nullable)

### Storage

Create a **public** Supabase Storage bucket: `event-images`

Path convention: `{org_id}/{event_id}/{filename}` for event images, `{org_id}/org-header.{ext}` for org defaults.

RLS policy: authenticated users who are org members can upload/delete; public read for all.

### Theme Presets

| Preset | Primary | Accent | Visual |
|---|---|---|---|
| Default Blue | `#2563eb` | `#8b5cf6` | Current system colors |
| Ocean | `#0891b2` | `#06b6d4` | Teal/cyan |
| Forest | `#059669` | `#34d399` | Green |
| Sunset | `#ea580c` | `#f59e0b` | Orange/amber |
| Berry | `#c026d3` | `#e879f9` | Magenta/pink |
| Slate | `#475569` | `#94a3b8` | Neutral/professional |
| Ruby | `#dc2626` | `#f87171` | Red |
| Indigo | `#4f46e5` | `#818cf8` | Deep purple-blue |

Custom: admin provides primary hex, accent auto-suggested (lighter tint) or manually set.

### Resolution Order (Theme)

`event.theme` → `organization.default_theme` → system default (`#2563eb` / `#8b5cf6`)

### Resolution Order (Header Image)

`event.header_image_url` → `organization.default_header_image_url` → gradient-only fallback

## Component Changes

### Admin: EventEditor.jsx
- New **"Appearance"** card section between Event Details and Capacity
- **Image upload area**: drag-and-drop or click-to-browse, preview thumbnail, remove button
- **Theme picker**: grid of preset color swatches + "Custom" option with hex input
- Aspect ratio warning if uploaded image isn't ~16:9

### Admin: OrgSettings (new or existing)
- Same image upload + theme picker UI, scoped to organization defaults
- Note: We'll add this to whatever org settings component exists (or flag for later)

### Public: EventRegistrationForm.jsx
- Header region: if image exists → show as `object-cover` background behind title (with dark overlay for text readability)
- If no image → current gradient header, but colored by resolved theme
- Apply `primaryColor` and `accentColor` as CSS custom properties scoped to the form container

### Public: EventCard.jsx
- Accent bar at top uses resolved theme color instead of hardcoded `from-primary to-accent`
- Optionally show a small header image thumbnail if available

### Public: EventLanding.jsx
- Calendar icon accent uses org default theme color

## Upload Flow

1. Admin selects image in EventEditor
2. Client-side validation: file type (jpg/png/webp/gif), size ≤ 5MB
3. Aspect ratio check: warn if not ~16:9 (tolerance ±15%)
4. Upload to `event-images` bucket via `supabase.storage.from('event-images').upload()`
5. Get public URL via `getPublicUrl()`
6. Store URL in event state, persisted on save
7. Previous image deleted on replace

## Verification Plan

### Browser Testing
- Create event with header image upload → verify image displays on public form
- Select each preset → verify colors apply to public form gradient and buttons
- Upload non-16:9 image → verify warning appears but upload succeeds
- Upload >5MB file → verify rejection with error message
- Remove image → verify fallback to gradient
- Set org default → create event without image → verify org default shows

### Manual Verification
- Open the public registration page in a browser and confirm the header image renders correctly at 16:9 with letterboxing
- Verify theme colors apply to the gradient header, buttons, and accent elements

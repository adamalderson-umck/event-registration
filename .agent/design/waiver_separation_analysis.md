# Separating Waivers: Architecture Analysis

## Current State

Today, a single event supports **exactly one waiver**. The data lives as flat columns on the `events` table:

| Column | Type | Purpose |
|---|---|---|
| `waiver_enabled` | `boolean` | Master toggle |
| `waiver_title` | `text` | e.g. "Liability Waiver" |
| `waiver_content` | `text` | Rich HTML body |
| `waiver_content_hash` | `text` | SHA-256 for integrity |

On the registrant side, `registrations.signature_record` is a single JSONB object:

```json
{
  "signed": true,
  "signedAt": "2026-04-20T...",
  "signerName": "John Doe",
  "signatureMethod": "draw",
  "signatureData": "data:image/png;base64,...",
  "waiverTitle": "Liability Waiver",
  "waiverContentHash": "a1b2c3...",
  "ipAddress": "...",
  "userAgent": "...",
  "consentToESign": true
}
```

### The Problem

A single event often needs **two+ legally distinct agreements**:

| Waiver | Purpose | Who needs it |
|---|---|---|
| **Liability / Hold Harmless** | Protects org from injury/damage claims | Everyone |
| **Media Release** | Authorizes photo/video use | Everyone (but declining should NOT block registration) |
| **Medical Authorization** | Permission for emergency medical treatment for minors | Parents/guardians of minors |
| **Background Check Consent** | For volunteers/leaders | Volunteers only |

These are **legally separate documents** — bundling them into one signature weakens enforceability because a registrant can later argue "I only meant to sign the waiver, not the media release."

---

## Strategy Options

### Option A: `waivers[]` — Array Column on Events Table

Replace the flat scalar columns with a single JSONB array column.

#### Events table

```diff
- waiver_enabled     boolean
- waiver_title       text
- waiver_content     text
- waiver_content_hash text
+ waivers            jsonb DEFAULT '[]'
```

Each element:
```json
{
  "id": "waiver_liability",
  "title": "Liability Waiver & Hold Harmless",
  "content": "<p>By signing this...</p>",
  "contentHash": "a1b2c3...",
  "required": true,
  "order": 0
}
```

#### Registrations table

```diff
- signature_record   jsonb
+ signature_records  jsonb DEFAULT '[]'
```

Each element:
```json
{
  "waiverId": "waiver_liability",
  "signed": true,
  "signedAt": "2026-04-20T...",
  "signerName": "John Doe",
  "signatureMethod": "draw",
  "signatureData": "data:image/png;base64,...",
  "waiverTitle": "Liability Waiver",
  "waiverContentHash": "a1b2c3...",
  "ipAddress": "...",
  "userAgent": "...",
  "consentToESign": true
}
```

> [!TIP]
> **Best for this project.** Minimal schema change, no new tables, no new RLS policies. The JSONB array is familiar — it's exactly the same pattern already used for `form_fields` and `notifications.organizers`.

#### Trade-offs

| ✅ Pros | ⚠️ Cons |
|---|---|
| Single migration, no new tables | Cannot independently query "show me all media release refusals" without `jsonb_array_elements` |
| Matches existing patterns (form_fields is also JSONB array) | Slightly larger document size per registration |
| Zero RLS policy changes | No relational integrity on waiver IDs |
| Admin UI is a natural extension of existing WaiverSection | |

---

### Option B: Separate `event_waivers` Table

Fully normalized: a new `event_waivers` table with a foreign key to events, plus a new `waiver_signatures` table.

```
events (unchanged)
  └── event_waivers (new)
        ├── id (uuid PK)
        ├── event_id (FK → events)
        ├── title
        ├── content (text/html)
        ├── content_hash
        ├── required (boolean)
        ├── order (int)
        └── created_at

registrations (unchanged)
  └── waiver_signatures (new)
        ├── id (uuid PK)
        ├── registration_id (FK → registrations)
        ├── waiver_id (FK → event_waivers)
        ├── signed (boolean)
        ├── signed_at (timestamptz)
        ├── signer_name
        ├── signature_method
        ├── signature_data
        ├── ip_address
        ├── user_agent
        └── consent_to_esign
```

#### Trade-offs

| ✅ Pros | ⚠️ Cons |
|---|---|
| Full relational queries — "list all unsigned media releases" is a simple `WHERE` | Two new tables + new RLS policies |
| Referential integrity via FKs | More complex admin save logic (upsert array → batch) |
| Easy to extend with archival/versioning | Registration submission becomes multi-table transaction |
| Clean reporting exports | Significantly more migration and UI work |

---

### Option C: Hybrid — `waivers[]` JSONB on Events, but Separate `waiver_signatures` Table

Keep the waiver *definitions* as a JSONB array on events (like `form_fields`), but store each *signature* as a separate row for query power.

```
events.waivers           JSONB[]  ← definitions live here (lightweight)
waiver_signatures        table    ← one row per waiver per registration (queryable)
```

#### Trade-offs

| ✅ Pros | ⚠️ Cons |
|---|---|
| Admin editing stays simple (JSONB array) | Still need a new table + RLS for signatures |
| Signatures are independently queryable | Waiver IDs aren't FK-backed (just string matching) |
| Good middle ground for reporting needs | Two paradigms in one system (JSONB for definition, rows for execution) |

---

## Recommendation: Option A

For the scale and context of this project (church/community events, <1000 registrations per event, admin-only reporting), **Option A** is the right call.

### Why

1. **Pattern consistency** — `form_fields` is already a JSONB array on events. Waivers are conceptually the same: admin-defined, order-sensitive, schema-driven.
2. **Scope** — No new tables, no new RLS policies, no multi-table transactions. The migration is a column rename/retype.
3. **Admin reporting** — The existing `SignatureViewer` and `RegistrationViewer` already iterate; extending to an array of signatures is trivial.
4. **PDF export** — The existing `generateSignedWaiverPdf` generates one page; extending to N pages (one per waiver) is a loop.
5. **Legal separation** — Each waiver gets its own consent checkbox, its own typed name, and its own signature canvas. They're stored as **distinct records**, satisfying the core legal requirement.

### Key Design Decisions

#### 1. Required vs Optional Waivers

```json
{ "id": "...", "title": "Media Release", "required": false, ... }
```

- **Required waivers** (e.g. liability): Registration cannot proceed without signature.
- **Optional waivers** (e.g. media release): Registrant can explicitly **decline**. The signature record stores `"signed": false, "declined": true` — the org knows the registrant saw it and chose not to sign.

> [!IMPORTANT]
> This is the critical distinction between liability and media release. A media release **should not block registration** — but the org needs to know who declined so photographers can respect it.

#### 2. Per-Waiver Signature vs Shared Signature

Two UX approaches:

| Approach | UX | Legal strength |
|---|---|---|
| **Shared signature** — One name + one draw/type, applied to all waivers | Faster for registrant | Weaker — "I only signed once, I didn't mean both" |
| **Per-waiver signature** — Each waiver gets its own consent + name + signature | More steps | Stronger — clear, independent acts of consent |

**Recommendation:** Per-waiver is safer. But for UX, auto-fill the signer name from the first waiver into subsequent ones (still requiring explicit consent checkbox and signature per waiver).

#### 3. Admin UI

The current `WaiverSection` becomes a **list of waiver cards** with Add/Remove/Reorder (reusing the same `@dnd-kit/sortable` pattern from `FormFieldBuilder`):

```
┌─────────────────────────────────────────┐
│ ☰ Waivers / E-Sign                     │
│                                         │
│  ┌─── Waiver 1 ──────────────────────┐  │
│  │ ⠿ Title: [Liability Waiver     ]  │  │
│  │   Required: ☑                     │  │
│  │   Content: [Rich text editor    ] │  │
│  │                          [Delete] │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌─── Waiver 2 ──────────────────────┐  │
│  │ ⠿ Title: [Media Release        ]  │  │
│  │   Required: ☐                     │  │
│  │   Content: [Rich text editor    ] │  │
│  │                          [Delete] │  │
│  └───────────────────────────────────┘  │
│                                         │
│  [+ Add Waiver]                         │
└─────────────────────────────────────────┘
```

#### 4. Migration Strategy

The migration needs to be **backward-compatible**:

```sql
-- 1. Add new column
ALTER TABLE events ADD COLUMN waivers jsonb DEFAULT '[]';

-- 2. Migrate existing data
UPDATE events
SET waivers = CASE
  WHEN waiver_enabled THEN jsonb_build_array(jsonb_build_object(
    'id', 'waiver_' || gen_random_uuid()::text,
    'title', COALESCE(waiver_title, ''),
    'content', COALESCE(waiver_content, ''),
    'contentHash', COALESCE(waiver_content_hash, ''),
    'required', true,
    'order', 0
  ))
  ELSE '[]'
END;

-- 3. Migrate signature records (singular → array)
ALTER TABLE registrations ADD COLUMN signature_records jsonb DEFAULT '[]';

UPDATE registrations
SET signature_records = CASE
  WHEN signature_record IS NOT NULL AND signature_record != 'null'::jsonb
  THEN jsonb_build_array(signature_record)
  ELSE '[]'
END;

-- 4. After verification, drop old columns
-- ALTER TABLE events DROP COLUMN waiver_enabled, ...
-- ALTER TABLE registrations DROP COLUMN signature_record;
```

> [!WARNING]
> The old columns should be kept during a transition period (read from new, write to both) until all edge functions and the frontend are updated. Drop them only after verification.

---

## Impact Summary

| Component | Change Required |
|---|---|
| [EventEditor.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/EventEditor.jsx) | `waiver: { enabled, title, content }` → `waivers: [{ id, title, content, required, order }]` |
| [WaiverSection.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/WaiverSection.jsx) | Becomes a list of sortable waiver cards |
| [WaiverSignatureStep.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/WaiverSignatureStep.jsx) | Renders N times (once per waiver), with per-waiver state |
| [EventRegistrationForm.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/EventRegistrationForm.jsx) | `waiverData` → `waiverDataMap: { [waiverId]: { consent, name, sig } }` |
| [SignatureViewer.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/SignatureViewer.jsx) | Iterate `signature_records[]` instead of single record |
| [RegistrationViewer.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/RegistrationViewer.jsx) | Show accordion of signed waivers |
| [FormPreviewPane.jsx](file:///e:/Coding%20Projects/event-registration-system/src/components/FormPreviewPane.jsx) | Map waivers array to preview |
| Database migration | Add `waivers` and `signature_records` columns, migrate data |
| Edge functions | Update any that reference `signature_record` → `signature_records` |

## Open Questions

1. **Should declining a media release require an explicit "I decline" action** (e.g. a radio: "I agree / I decline"), or is simply not signing sufficient? Explicit decline is stronger for photographer guidance.

2. **Should waiver templates be org-level?** E.g., the org configures a "standard liability waiver" once, and events inherit it. This would prevent re-typing the same legal text for every event but adds another layer of configuration.

3. **Is this something you want to implement now**, or is this analysis for future planning? If now, I'd create a feature branch and implementation plan.

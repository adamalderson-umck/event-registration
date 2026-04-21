# Technical Debt Backlog

## Hygiene / Refactor

### [DEFERRED] Legacy waiver column cleanup — post-production verification
**Source:** `feature/multi-waiver-support` merge (2026-04-21)
**Risk:** Structural / destructive — requires Supabase migration + verification
**Files affected:**
- `supabase/migrations/` — needs a follow-up migration to drop legacy columns once verified in production
- `events` table: columns `waiver_enabled`, `waiver_title`, `waiver_content`, `waiver_content_hash`
- `registrations` table: column `signature_record` (singular, legacy flat object)

**Why deferred:** The multi-waiver migration backfills data from these columns into the new `waivers[]` / `signature_records[]` JSONB arrays, but the old columns are still present. Dropping them requires:
1. Confirming all existing registrations have been read and verified correctly via `signature_records[]` in production
2. Confirming the admin panel no longer references any legacy column name
3. A new migration: `ALTER TABLE events DROP COLUMN waiver_enabled, DROP COLUMN waiver_title, DROP COLUMN waiver_content, DROP COLUMN waiver_content_hash;` and `ALTER TABLE registrations DROP COLUMN signature_record;`

**Prerequisite:** ~1 week of production soak time after `feature/multi-waiver-support` goes live.

---

### [DEFERRED] Turnstile domain configuration for localhost
**Source:** Bug investigation during `feature/multi-waiver-support` (2026-04-21)
**Risk:** Low — dev-only inconvenience
**Detail:** Cloudflare Turnstile site key `0x4AAAAAAC-oMn00WfpY7Mz-` is locked to the production domain. Localhost testing requires swapping to test key `1x00000000000000000000AA` in `.env.local` (documented inline). Consider adding `localhost` to the CF Turnstile allowlist in the Cloudflare dashboard to avoid the manual swap.

---

### [DEFERRED] TypeToSign does not emit signatureData
**Source:** Code review during `feature/multi-waiver-support` (2026-04-21)
**Risk:** Low — typed signatures pass validation correctly because the guard is `signatureMethod === 'draw' && !signatureData`, so typed sigs are never checked for signatureData
**Detail:** `TypeToSign.jsx` is purely presentational and does not call `onChange('signatureData', ...)`. The signature record for a typed signature will have `signatureData: null` and `signatureFont` set. This is intentional by design but should be documented explicitly in the component JSDoc to prevent future confusion.

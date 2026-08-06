# Supabase Migration Baseline Implementation Plan

> **For agentic workers:** Execute inline with the Supabase, test-driven-development, and verification-before-completion procedures. Do not delegate this plan without explicit user authorization.

**Goal:** Replace the incomplete historical SQL reconstruction with one reproducible schema baseline while preserving remote migration-version alignment.

**Architecture:** The first 35 applied migration files become comment-only compatibility markers. The latest applied version contains a sanitized schema baseline generated from the current linked database. The existing Tithe.ly migration remains the only forward migration.

**Tech Stack:** Supabase CLI 2.111.0, PostgreSQL 17, Node.js, Vitest, Docker Desktop.

---

### Task 1: Capture and audit the schema baseline

**Files:**
- Temporary, untracked schema dump
- Modify: `docs/superpowers/specs/2026-08-05-supabase-migration-reconciliation-design.md`

- [ ] Confirm the worktree contains only known issue #5 changes.
- [ ] Run `npx supabase db dump --linked --file <temporary-path>`; do not dump production data.
- [ ] Scan the temporary dump for project URLs, JWTs, Supabase secret keys, service-role credentials, and Vault values.
- [ ] Inventory application schemas, extensions, policies, functions, triggers, grants, publications, and required configuration data represented by the dump.
- [ ] Delete the temporary dump after its reviewed content is committed to the baseline.

### Task 2: Enforce the baseline migration shape

**Files:**
- Modify: `tools/check-supabase-migrations.test.mjs`
- Modify: `tools/check-supabase-migrations.mjs`

- [ ] Add a failing test requiring the first 35 applied files to be comment-only markers and the latest applied file to be non-empty SQL.
- [ ] Run `npx vitest run tools/check-supabase-migrations.test.mjs` and confirm the existing reconstructed files fail.
- [ ] Implement the minimal marker/baseline validation without parsing SQL semantics.
- [ ] Re-run the focused tests and confirm they pass once the migration files are converted.

### Task 3: Replace historical bodies with the baseline

**Files:**
- Modify: first 35 files in `supabase/migrations/`
- Replace: `supabase/migrations/20260806001553_require_verified_google_identity_email.sql`
- Preserve: `supabase/migrations/20260806054726_tithely_payment_flow.sql`

- [ ] Replace the first 35 applied migration bodies with `-- Applied remotely; represented by the schema baseline in 20260806001553.`
- [ ] Put the reviewed schema-only dump in the latest applied migration.
- [ ] Add only required local configuration data omitted by schema dump: inert webhook Vault placeholders, required cron/webhook setup, and the event-images bucket when verified necessary.
- [ ] Run `npm run check:migrations`, the focused Vitest file, and `git diff --check`.
- [ ] Commit the baseline conversion.

### Task 4: Prove clean local reproduction

**Files:** none unless the baseline has a demonstrated reproduction defect.

- [ ] Run `npx supabase db reset --local --no-seed` from an empty local database.
- [ ] Run `npx supabase migration list --local` and confirm all 37 versions are applied locally.
- [ ] Query PostgreSQL for application tables, RLS status, policies, functions, triggers, grants, storage bucket configuration, and the Tithe.ly `SECURITY INVOKER` contract.
- [ ] If a check fails, change the baseline rather than patching historical marker files, then repeat the reset.

### Task 5: Prove linked safety and application health

**Files:**
- Modify only if verification reveals a documented workflow error: `README.md`, `.github/workflows/ci.yml`

- [ ] Run `npx supabase migration list --linked`; require 37 aligned versions plus one local-only payment-ledger version.
- [ ] Run `npx supabase db push --linked --dry-run`; require only `20260806060759_registration_payment_ledger.sql`.
- [ ] Read the live ledger again and confirm it still has 37 rows with latest version `20260806054726`.
- [ ] Run serially: `npm run check:migrations`, focused validator tests, `npm run test:run`, `npm run lint`, and `npm run build`.
- [ ] Review `git status`, `git diff --check`, and the branch diff. Do not push, open a PR, merge, or close issue #5 without separate authorization.

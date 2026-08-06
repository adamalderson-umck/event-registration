# Supabase Migration Baseline Design

**Date:** 2026-08-06
**Issue:** [#5 — Reconcile repository Supabase migrations with the live migration ledger](https://github.com/adamalderson-umck/event-registration/issues/5)

## Decision

Adopt the existing Event Registration database through one sanitized schema baseline. Do not reconstruct the database by replaying SQL bodies from the production migration ledger.

The ledger is authoritative only for applied version identity. It is not a complete schema build log: the live database contains objects created outside its recorded migrations, and a clean replay of the recorded SQL fails because later entries depend on those objects.

## Migration Model

The committed migration directory has three roles:

1. The first 35 applied versions are timestamp markers. Their filenames preserve remote-history compatibility, and their bodies contain comments only.
2. Applied version `20260806001553_require_verified_google_identity_email.sql` is the baseline. It creates the current intended application schema from an empty local Supabase database, including required grants, policies, functions, triggers, extensions, storage configuration, and inert local webhook configuration.
3. Applied version `20260806054726_tithely_payment_flow.sql` records the exact forward migration already present in the hosted ledger.
4. `20260806060759_registration_payment_ledger.sql` is the single unapplied forward migration.

Supabase compares migration timestamps, not SQL bodies, when listing local and remote history. The markers therefore align with the existing production ledger without replaying incomplete historical implementation details.

## Baseline Source and Safety

Generate the baseline from a schema-only dump of the linked database into an untracked temporary file. Review and sanitize it before moving content into Git.

The baseline must not contain:

- production data;
- the production project URL;
- JWT-shaped values, secret keys, or service-role credentials;
- decrypted Vault values; or
- production-only identifiers that are not schema requirements.

Webhook Vault entries use inert local placeholders. Storage bucket setup and other required configuration data may be included only when necessary to reproduce application behavior locally.

## Production Boundary

This work must not run a real `db push`, `migration repair`, `db reset --linked`, or any production DDL/DML. The linked database is read-only throughout reconciliation.

## Verification

Completion requires all of the following:

- the migration validator accepts exactly 35 markers, one baseline, one applied forward migration, and one pending forward migration;
- a clean local `db reset --local --no-seed` succeeds;
- local schema checks confirm the expected application tables, RLS policies, functions, grants, triggers, and Tithe.ly contract;
- `migration list --linked` shows 37 aligned applied versions and one local-only pending version;
- `db push --linked --dry-run` proposes only the pending payment-ledger migration;
- the full application tests, lint, and build pass; and
- production remains at 37 applied migrations until the separately authorized payment-ledger push.

## Future Workflow

All future changes are forward-only migrations created with the pinned CLI. The baseline is immutable after adoption except for credential removal or a proven local-reproduction defect. Production schema changes require separate explicit authorization.

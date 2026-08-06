# Supabase Migration Reconciliation Design

**Date:** 2026-08-05
**Issue:** [#5 — Reconcile repository Supabase migrations with the live migration ledger](https://github.com/adamalderson-umck/event-registration/issues/5)

## Purpose

Make the repository's Supabase migration history canonical, reproducible, and safe to use with the live Event Registration project. The reconciliation must not change the production schema, production data, or production migration ledger.

## Current State

The live Event Registration Supabase project is healthy and records 36 applied migrations. The repository contains only nine migrations that correspond to applied live migrations, plus the unapplied Tithe.ly migration.

All nine applied repository migrations have version IDs that differ from the live ledger. Eight of their SQL bodies match the recorded live SQL when whitespace is ignored. The multi-waiver file contains the same schema and data changes as the live entry but also contains comments and post-migration verification queries that were not recorded in the ledger.

The repository is missing the first 27 live migrations and does not contain `supabase/config.toml`. The Supabase CLI is not currently installed as a project dependency.

The repository's `20260805200000_tithely_payment_flow.sql` migration is not recorded in the live ledger, and its Tithe.ly columns are not present in the live schema. It is a legitimate pending migration rather than an already-applied migration that needs repair. Its current timestamp precedes three later live admin-security migrations, so it must receive a new CLI-generated version after the latest applied live version. Moving the original SQL after those migrations without modification would recreate `mark_registration_paid` as `SECURITY DEFINER` and bypass the newer domain-aware authorization path, so the pending migration must integrate the later security contract.

One recorded historical migration, `20260323183121_create_email_webhook_triggers`, contains the live project URL and an anon-key JWT in calls that initialize Vault. Those environment-specific values must not be copied into Git.

## Scope

### Included

- Reconstruct all 36 applied live migrations under their live version IDs and names.
- Preserve the recorded SQL for each applied migration except for the credential sanitization described below.
- Replace the nine mismatched applied migration files with canonically named files.
- Generate a new version for the pending Tithe.ly migration after the latest applied live version and make its payment-verification RPC compatible with the later admin-security migrations.
- Add a project-local, pinned Supabase CLI dependency and commit its lockfile changes.
- Generate and commit `supabase/config.toml` through the Supabase CLI.
- Add an automated repository check for migration filename and credential safety.
- Document the supported local-development, migration-creation, linked-history inspection, and dry-run deployment workflow.
- Verify clean local schema reproduction and read-only alignment with the live project.

### Excluded

- Running `supabase db push` against any remote project.
- Running `supabase migration repair` against the live project.
- Applying the pending Tithe.ly migration.
- Changing production schema, data, Vault values, or migration-ledger rows.
- Addressing Supabase advisor findings unrelated to migration reconciliation.
- Changing application behavior or parking-pass presentation.

## Canonical History Model

The live `supabase_migrations.schema_migrations` ledger is authoritative for the identity and order of already-applied migrations. Each applied migration will be committed as:

```text
supabase/migrations/LIVE_VERSION_LIVE_NAME.sql
```

The file body will use the corresponding SQL recorded in the ledger. Version identity, name, ordering, and schema behavior are the compatibility contract. Byte equality is useful evidence but is not required by the Supabase CLI and cannot override credential-safety requirements.

The existing mismatched files will be removed after their canonical replacements are present. The multi-waiver replacement will contain the recorded migration body without the old dashboard instructions and verification `SELECT` statements.

The pending Tithe.ly migration will be recreated with `supabase migration new tithely_payment_flow`. Its new timestamp must sort after live version `20260806001553`, ensuring that a linked dry run recognizes it as the single next migration rather than an out-of-order historical migration.

Its event-column changes and payment behavior will remain intact, but its `mark_registration_paid` definition will incorporate the newer security contract:

- run as `SECURITY INVOKER`;
- authorize through `private.is_org_member(p_org_id)`;
- accept confirmed, pending registrations whose selected method is `tithely` or `in_person`;
- preserve the selected payment method while recording verification metadata; and
- remain unavailable to anonymous callers and executable by `authenticated` and `service_role`.

This is an intentional change from the unshipped migration body. It prevents the newly ordered migration from undoing live version `20260806001318_harden_remaining_admin_functions` when Tithe.ly is eventually applied.

## Credential-Bearing Historical Migration

Migration `20260323183121_create_email_webhook_triggers` will keep its canonical version, name, functions, triggers, and cron schedule. Its two Vault initialization values will be replaced with inert local placeholders:

- a local-only project URL that cannot target production; and
- a clearly nonfunctional local anon-key placeholder.

The committed SQL must not contain the live project URL, a JWT-shaped value, a Supabase secret-key value, or any service-role credential. Fresh environments will reproduce the intended database objects, but outbound email webhooks will remain inactive until an operator supplies environment-specific Vault values outside Git. The README will describe this prerequisite without including credentials.

No migration content will be fetched into a tracked file until it has passed the credential scan.

## Repository Components

### Supabase configuration

`supabase/config.toml` will be generated by the pinned CLI and committed. Generated temporary link and branch state will remain ignored. Secrets will not be added to the configuration file; environment references will be used if future configuration requires sensitive values.

### Pinned CLI

The Supabase CLI will be added as an exact development dependency, and `package-lock.json` will be updated. Repository documentation and scripts will invoke the project-local CLI through npm so all contributors use the same command behavior.

### Migration safety check

A repository script and package command will validate that:

- every migration filename starts with exactly 14 digits followed by an underscore;
- migration version IDs are unique and ordered;
- the legacy mismatched filenames are absent;
- migration SQL does not contain a project-specific `*.supabase.co` URL;
- migration SQL does not contain JWT-shaped values, `sb_secret_` keys, or service-role keys.

The check will run in CI alongside the existing gates so the repository cannot silently return to hand-authored short timestamps or committed database credentials.

### Workflow documentation

The README will document:

1. installing dependencies and meeting the Docker-compatible runtime prerequisite;
2. starting and resetting the local Supabase stack;
3. configuring local Vault values outside Git when webhook testing is needed;
4. creating every future migration with the pinned CLI;
5. linking explicitly to the intended project;
6. comparing local and remote history;
7. previewing a deployment with `db push --dry-run`; and
8. stopping when the history diverges instead of running `db push` or `migration repair` speculatively.

The documentation will state that production migration writes require separate explicit authorization.

## Data and Control Flow

1. Read the live migration ledger through authenticated, read-only Supabase access.
2. Export each migration body into an untracked staging location.
3. Scan staged SQL for environment-specific URLs and credential patterns.
4. Sanitize the known webhook migration and stop on any unexpected credential finding.
5. Commit the 36 canonical applied migrations.
6. Generate the new pending Tithe.ly migration version with the pinned CLI.
7. Replay all migrations against a disposable local Supabase stack.
8. Compare local and linked migration histories.
9. Run a linked `db push --dry-run` and confirm that no applied migration would replay.

The live project is read-only throughout this flow.

## Error Handling

- If an exported migration contains an unexpected credential or environment-specific value, stop before writing it to the tracked migration directory. Redact or parameterize it only after documenting the resulting behavioral difference.
- If an historical migration cannot replay locally, first correct CLI configuration or document the required local extension or environment prerequisite. Do not silently change its schema behavior to make the test pass.
- If local and remote version sets differ after reconstruction, do not run `db push` or `migration repair`. Re-inventory both histories and resolve the repository discrepancy.
- If the dry run proposes any of the 36 applied migrations, reconciliation has failed and no remote write may proceed.
- If the dry run proposes only the newly timestamped Tithe.ly migration, record it as intentionally pending and do not apply it in this work.

## Verification

Verification will run in this order:

1. Run the migration filename and credential-safety check.
2. Start a disposable local Supabase stack and run a clean `supabase db reset`.
3. Confirm that the local migration list contains all 36 canonical applied versions plus the pending Tithe.ly version.
4. Run `supabase migration list --linked` against the Event Registration project and confirm that all 36 applied version IDs align. Tithe.ly must appear local-only.
5. Run `supabase db push --dry-run` against the linked project. It may propose only the pending Tithe.ly migration and must not propose replaying an already-applied migration.
6. Inspect the pending Tithe.ly migration and confirm that `mark_registration_paid` is `SECURITY INVOKER`, calls `private.is_org_member`, supports `tithely` and `in_person`, and does not rewrite `payment_method`.
7. Run the existing application test suite, lint, and production build serially.
8. Review the final Git diff and confirm that it contains no application behavior change, credential, production mutation, or unrelated edit.

## Acceptance Criteria

- Git contains all 36 applied live migration versions under canonical filenames.
- The pending Tithe.ly migration sorts after all applied migrations and remains unapplied.
- The pending Tithe.ly payment-verification RPC preserves both Tithe.ly behavior and the later invoker-rights, domain-aware authorization contract.
- No tracked file contains a live project URL, JWT-shaped key, Supabase secret key, or service-role key.
- A clean local Supabase environment successfully replays the committed migration chain.
- Linked migration listing intentionally aligns all applied local and remote versions.
- A linked dry run proposes no replay of an already-applied migration.
- The supported CLI workflow and production safeguards are documented.
- Production schema, data, Vault values, and migration ledger are unchanged.

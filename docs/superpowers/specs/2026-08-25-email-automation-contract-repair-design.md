# Email Automation Contract Repair Design

## Problem

Registration confirmations and scheduled reminders have a false-green test contract. Production database automation calls `send-registration-email` with the legacy service-role JWT stored in Vault, while the deployed handler compares that header with the newer secret value exposed to the function runtime. The request reaches the function but returns `401 unauthorized` before any delivery is claimed.

Registration delivery has a second independent blocker. Its canonical record query selects `registrations.updated_at`, but that column does not exist in the migration-defined or production schema. The loader collapses database query errors and genuinely missing records into the same `null` result, so this blocking query failure would be reported as a benign `canonical_record_missing` skip.

The existing suite remains green because it tests isolated collaborators with mutually consistent fixture values:

- authentication tests inject the same synthetic service-role value into both request and handler;
- handler tests mock `loadCanonicalDelivery` and include a fictional `updated_at` property;
- migration tests assert SQL text patterns but do not validate the caller contract against function authentication;
- no test compares the Edge Function registration projection with the migration-defined table columns;
- query errors are intentionally indistinguishable from absent canonical records.

## Scope

The repair covers both automated email entrypoints:

- `send-registration-email` for confirmations, waitlists, promotions, cancellations, and organizer notifications;
- `send-event-reminders` for scheduled reminders.

The registration schema/query repair is specific to `send-registration-email`. Production deployment, credential provisioning, replay of missed mail, PR publication, merge, and cleanup remain separate authorization gates.

## Considered Approaches

### 1. Rely on legacy JWT verification

Remove the function's redundant equality check and rely on Supabase `verify_jwt`. This is the smallest change, but it preserves dependence on legacy keys that Supabase is deprecating and leaves automation authentication coupled to a database administration credential.

### 2. Dedicated automation secret

Use a purpose-specific secret shared only by the database callers and email handlers. This avoids ambiguity between legacy JWTs and newer Supabase secret keys, limits the credential's authority to invoking canonical email automation, and gives both functions one explicit contract. This is the selected approach.

### 3. New Supabase secret API key

Store a new `sb_secret_...` key in Vault and use it for function authentication. This follows Supabase's new API-key model but unnecessarily makes a full-privilege database API key double as an email invocation secret.

## Authentication Design

Provision the same high-entropy value in two protected locations:

- Supabase Vault under `email_automation_secret` for PostgreSQL triggers and cron;
- the Edge Function environment under `EMAIL_AUTOMATION_SECRET` for both handlers.

Database callers send the value in `x-email-automation-secret`. The handlers authenticate that header against `EMAIL_AUTOMATION_SECRET`. Supabase API credentials remain responsible only for the function's internal database client and are not reused as caller authentication.

Both email functions must share the same authentication helper and reject missing, empty, or mismatched secrets before parsing a request or reading canonical records. Their deployment configuration must permit the purpose-specific header to reach the handler rather than requiring a caller JWT.

No secret value may appear in source, migrations, test output, logs, commits, or deployment reports.

## Registration Schema and Error Design

The canonical registration projection must use only migration-defined columns. Initial confirmation and waitlist delivery keys continue to use `created_at`. Cancellation delivery keys use `cancelled_at`; promotion delivery keys use `promoted_at`. The nonexistent `updated_at` property is removed from the runtime type, query, and fixtures.

Canonical loading returns a discriminated result:

- `found` with the complete canonical record;
- `missing` when the registration or a required related record genuinely does not exist;
- `error` when a database query fails.

The handler preserves the sanitized `canonical_record_missing` skip for `missing`, but returns HTTP 500 with `canonical_load_failed` for `error`. Database error details remain server-side and must not expose registration or recipient data.

## Test and Verification Design

The repair is test-driven. Before production code changes, regression tests must fail for the two observed defects.

### Authentication contract tests

- Assert both handlers accept the dedicated header only when it exactly matches the dedicated automation secret.
- Assert ordinary bearer tokens, Supabase service-role values, missing headers, and mismatched secrets are rejected.
- Assert both entrypoints source caller authentication from `EMAIL_AUTOMATION_SECRET`, not `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`.
- Assert registration triggers, update triggers, and reminder cron read `email_automation_secret` and send `x-email-automation-secret`.
- Assert migration SQL no longer uses the service-role key as the email webhook credential.

### Schema contract tests

- Export or otherwise expose the canonical registration projection as one reviewable contract.
- Compare every selected registration column with the repository's migration-defined `registrations` schema.
- Invoke the real Edge Function entrypoint with an injected Supabase client and assert the loader executes the expected `from`, `select`, `eq`, and `maybeSingle` chain.
- Assert cancellation and promotion occurrence keys use `cancelled_at` and `promoted_at` respectively.
- Assert query failures produce `canonical_load_failed` and cannot pass as `canonical_record_missing`.

### Full verification

- Run the focused red-green tests for both functions and shared helpers.
- Run migration validation.
- Run the complete serial Vitest suite.
- Run lint and the production build.
- Confirm no credential values or temporary debug instrumentation are present in the diff.

## Deployment and Recovery Gates

Deployment requires separate authorization and must provision the dedicated secret before applying caller changes. The production sequence must avoid a window where callers and handlers use different credentials.

After deployment, verification must include:

1. a no-email database-to-function request with an intentionally invalid body, proving the exact Vault-to-handler authentication path reaches `invalid_request` rather than `unauthorized`;
2. a no-email canonical-loader probe using a nonexistent registration UUID, proving the database projection executes and returns `canonical_record_missing` rather than `canonical_load_failed`;
3. read-only confirmation that new delivery attempts create ledger rows and that no stale pending or failed rows are accumulating.

Replaying missed confirmations is not part of the repair deployment. It requires a separately reviewed recipient set, duplicate-risk analysis, controlled batching, and explicit production authorization.

## Success Criteria

- Both automated email functions use the same dedicated authentication contract.
- The database callers and handlers cannot drift without a failing test.
- Registration queries reference only real schema columns.
- Database failures cannot be reported as benign missing-record skips.
- Focused tests demonstrably fail before the repair and pass afterward.
- The full repository verification suite passes without exclusions or new lint suppressions.
- No production mutation, email replay, PR publication, merge, or deployment occurs without its separate authorization.

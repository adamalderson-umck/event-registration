# Registration email retry rollback

PR #37's polling-based retry enhancement is retired. Do not port its scheduler,
retry RPCs, `RETRY` request type, or admin retry/status UI into another system.
No replacement retry mechanism is implemented here.

The application and email function return to the PR #36 behavior. The earlier
confirmation, waitlist, cancellation, and email-automation fixes remain in place.
Normal registration-triggered mail and delivery-ledger idempotency remain; failed
mail is not automatically retried. Unrelated reminder scheduling is unchanged.

## Migration history and integration

`20260826122203_automatic_registration_email_retries.sql` is retained unchanged
because it was already applied. It is historical SQL, not an approved integration
recipe. It creates a five-minute polling job when executed.

`20260827120335_remove_registration_email_retries.sql` must follow it. The correction:

- Unschedules only `retry-registration-lifecycle-emails`, if present.
- Removes the two retry/status RPCs and their private lifecycle helper.
- Preserves registrations, delivery history, previous functions, and other jobs.
- Is safe when the job is already absent and when applied repeatedly.

For a fresh integration, complete the entire migration history before enabling
outbound email or exposing the application. Do not stop at or copy the historical
retry migration alone. Apply the history transactionally where supported; a
partially applied history can temporarily contain the retired job.

## Verification

The unit/handler suite includes rejection of a correctly authenticated obsolete
`RETRY` request before any database or email operation. Run it with:

```powershell
npm run test:run -- --maxWorkers=1
```

With the local Supabase stack running and migrated through PR #36 or later:

```powershell
node tools/validate-registration-email-retry-rollback.mjs
```

This validator targets only the local Docker container
`supabase_db_event-registration-system`. It executes the original retry migration
and the correction against real PostgreSQL, including the already-unscheduled and
repeat-application cases. It compares registration/delivery fixtures and snapshots
of unrelated jobs, functions, and registration triggers. Everything runs inside a
rolled-back transaction; registration dispatch triggers are disabled only in that
transaction, and no cron changes or email requests are committed.

To prove the check detects the unwanted scheduler, run with `--without-correction`;
it must fail with `Retry polling job must be absent after correction`. This is a
targeted migration-boundary test, not a full fresh Supabase bootstrap test.

## Production closeout is separate

A source rollback does not roll back deployed functions or the database. After
separate authorization for each applicable operation:

1. Keep the retry job unscheduled. Confirm it is absent before proceeding.
2. Publish/merge the rollback and verify the frontend deployment's exact commit.
3. Redeploy `send-registration-email` from that commit and read back its source.
4. Require the linked migration dry run to name only the corrective migration,
   then apply it and verify the job and all three retry-only functions are absent.
5. Confirm earlier functions and registration/delivery data remain intact.

Do not drop the delivery ledger or rewrite the historical migration to clean up.

# Automatic Registration Email Retry Design

## Context

Registration lifecycle emails use `public.email_deliveries` as an idempotency and audit ledger. A failed row may be reclaimed when the same logical delivery is invoked again, but production currently has no scheduler that performs that invocation. Confirmation, waitlist, promotion, and cancellation failures therefore require an operator to identify and replay them.

Event reminders already have an hourly retry contract and are not part of this change.

## Goals

- Retry failed registration lifecycle emails automatically with bounded backoff.
- Preserve the existing logical delivery key and audit row across every attempt.
- Never resend a delivery already recorded as sent.
- Stop retrying an email when a later registration lifecycle state makes it obsolete.
- Show the latest applicable lifecycle-email status in the existing View Registration screen.
- Make exhausted failures discoverable and manually retryable by authorized organization members.
- Keep recipient addresses, message bodies, credentials, and raw provider errors out of the delivery-status interface.

## Non-goals

- Retrying organizer notifications or event reminders.
- A general-purpose resend feature for sent emails or registrations with no delivery record.
- An organization-wide delivery dashboard or a separate email-delivery administration page.
- Editable email bodies, recipient addresses, or delivery keys.
- Claiming mathematically exact-once SMTP delivery. A provider may accept a message immediately before the function loses its response.

## Selected Architecture

The database schedules retries, while the existing `send-registration-email` Edge Function remains responsible for canonical loading, applicability checks, composition, SMTP delivery, and ledger transitions.

The handler gains a trusted exact-delivery request:

```json
{
  "type": "RETRY",
  "delivery_id": "<email-delivery-uuid>"
}
```

This request is accepted only through the existing dedicated automation-secret boundary. The handler loads the delivery row and canonical registration itself; it does not trust a caller-provided registration ID, kind, occurrence, recipient, or delivery key.

A five-minute database cron job selects due lifecycle deliveries and queues their delivery IDs through `pg_net`. Authenticated RPCs expose a safe status projection and queue a manual retry. No second delivery queue or duplicate audit row is introduced.

## Applicable Lifecycle Delivery

Only one lifecycle delivery is currently applicable to a registration:

| Current registration state | Applicable delivery | Occurrence |
|---|---|---|
| `waitlisted` | `registration_waitlist` | `registrations.created_at` |
| `confirmed` with no `promoted_at` | `registration_confirmation` | `registrations.created_at` |
| `confirmed` with `promoted_at` | `waitlist_promotion` | `registrations.promoted_at` |
| `cancelled` | `registration_cancellation` | `registrations.cancelled_at` |
| Any other or incomplete state | none | none |

The handler reconstructs the expected logical key from the canonical registration and compares it with the selected ledger row. A mismatch is obsolete or malformed and is not sent.

This rule prevents a failed waitlist notice from being delivered after promotion and prevents an earlier confirmation or promotion email from being delivered after cancellation. Obsolete ledger rows remain historical evidence but are excluded from automatic retry and from the latest applicable status.

## Retry Schedule and Exhaustion

`attempt_count` includes the original attempt.

| Current attempt count | Earliest automatic retry |
|---:|---:|
| 1 | 5 minutes after `attempted_at` |
| 2 | 30 minutes after `attempted_at` |
| 3 | 2 hours after `attempted_at` |
| 4 or more | exhausted; no automatic retry |

A `failed` delivery is due when its backoff interval has elapsed. A `pending` delivery is due only when both its backoff interval and the existing 15-minute pending lease have elapsed. This retains the current protection against reclaiming an in-flight attempt too quickly.

All sanitized lifecycle failure codes use the same bounded schedule. Configuration failures may become recoverable after an operator corrects configuration, while the four-attempt ceiling prevents permanent errors from looping indefinitely.

A manual retry may exceed four attempts. It increments the existing row's `attempt_count` and uses the same delivery key. A failed manual retry remains exhausted and does not start another automatic sequence.

## Retry Cron

Create one job named `retry-registration-lifecycle-emails` with schedule `*/5 * * * *`.

Each run:

1. Selects only currently applicable `registration_confirmation`, `registration_waitlist`, `waitlist_promotion`, and `registration_cancellation` rows.
2. Selects only due `failed` or stale `pending` rows with `attempt_count < 4`.
3. Orders oldest due work first.
4. Limits the batch to 10 deliveries.
5. Calls `send-registration-email` with the delivery ID, the dedicated Vault-backed automation secret, and a 30-second `pg_net` timeout.

The delivery ledger, not the `pg_net` HTTP response, determines send success. A client-side HTTP timeout does not by itself mark a delivery failed or trigger an immediate duplicate request.

Missing Vault configuration causes the cron invocation to queue nothing and leaves ledger rows unchanged.

## Exact-delivery Handler Behavior

For a retry request, `send-registration-email`:

1. Authenticates the dedicated automation secret.
2. Loads the named delivery row using the service-role client.
3. Rejects non-lifecycle kinds and already-sent rows.
4. Loads the canonical registration, event, and organization.
5. Reconstructs the currently applicable kind, occurrence, and logical delivery key.
6. Requires them to match the selected delivery row.
7. Reuses the existing claim, compose, send, complete, and fail operations.

The handler returns stable sanitized outcomes such as `sent`, `already_sent`, `in_progress`, `not_retryable`, and `not_applicable`. It never returns recipient data, message content, secrets, or raw SMTP errors.

## Administrator Data Boundary

Add two narrowly scoped authenticated RPCs:

### Event delivery status

An event-scoped status RPC accepts organization and event IDs and returns one safe latest-applicable projection per registration:

- registration ID
- delivery ID, when a matching ledger row exists
- delivery kind
- state
- attempt count
- sanitized failure code
- attempted and sent timestamps
- computed next retry timestamp
- computed exhausted flag

It returns no recipient, body, subject, delivery key, provider response, or credential material.

### Manual retry

A manual-retry RPC accepts organization, registration, and delivery IDs. Inside one authoritative database operation it verifies:

- the caller is authenticated and belongs to the organization;
- the registration, event, and delivery belong to that organization;
- the delivery is the latest applicable lifecycle delivery;
- the row is `failed` with `attempt_count >= 4`;
- no sent row exists for the logical delivery.

It then queues exactly that delivery ID through the same Vault-backed Edge Function request and returns a stable queued or rejected outcome.

Both functions use a fixed empty search path, explicitly check organization membership, revoke execution from `PUBLIC` and `anon`, and grant only `authenticated` and `service_role`. The underlying `email_deliveries` table remains inaccessible to browser roles.

The authorization boundary matches Registration Viewer: any authenticated organization member who may manage registrations may view delivery status and perform the explicit manual retry.

## Registration Viewer

The Registration Viewer loads the event-scoped delivery projection alongside registration records.

### List view

- Show an alert banner only when one or more applicable deliveries are exhausted.
- Add a filter for registrations requiring email intervention.
- Show a small `Email failed` badge on affected rows.
- Add `Retry failed email` to the registration Actions dropdown only for exhausted applicable failures.
- Selecting the action opens the existing View Registration screen and focuses the Email Delivery section.

The existing parking actions menu is generalized or shared so standard and parking registrations use the same accessible dropdown pattern without losing their current actions.

### View Registration

Add a separate Email Delivery card below Registration Details. It always shows the latest applicable lifecycle status:

- email type;
- `Sent`, `Retry scheduled`, `Sending`, `Failed - intervention required`, or `No delivery record`;
- total attempts;
- last attempt or successful-send time;
- next retry time when scheduled;
- sanitized human-readable failure explanation.

`No delivery record` is informational and has no resend action.

For an exhausted failure, show `Retry email now`. Selecting it reveals an inline confirmation in the card. Confirmation queues the exact delivery, changes the local presentation to `Sending`, and refreshes the safe RPC projection for a bounded interval until the ledger reports `sent` or `failed`. The interface does not infer success from queue acceptance.

## Concurrency and Failure Handling

- Existing unique delivery keys and conditional claims prevent concurrent cron and manual requests from sending a row already completed as sent.
- A fresh pending claim returns `in_progress` and is not reclaimed.
- The cron batch limit limits SMTP and Edge Function concurrency after a provider outage.
- Unauthorized, wrong-organization, wrong-kind, sent, non-exhausted, malformed, and obsolete requests queue no email.
- A failed manual attempt remains visible for further explicit intervention.
- Status-loading failure shows a stable admin-facing error without blocking registration data.
- Raw provider and database errors remain in server logs only when safe; the ledger retains only the existing sanitized failure codes.

## Test Strategy

Implementation follows test-driven development with serial Vitest execution.

### Shared and handler behavior

- Exact retry uses the original delivery key, kind, and occurrence.
- Confirmation, waitlist, promotion, and cancellation retries compose the correct canonical email.
- Sent, fresh-pending, obsolete, malformed, missing, organizer, and reminder rows do not send.
- Concurrent claims remain idempotent.
- A failed manual attempt remains exhausted.

### Retry policy and migration contract

- Eligibility boundaries are exactly 5 minutes, 30 minutes, and 2 hours.
- Automatic retry stops at four total attempts.
- Pending rows respect the 15-minute lease.
- Cron name, five-minute schedule, lifecycle-kind allowlist, oldest-first ordering, batch limit 10, dedicated secret, 30-second timeout, and exact function payload are locked by tests.
- RPCs enforce organization ownership and membership and expose only the approved fields.
- Function grants and revocations are explicit.

### Administrator interface

- Exhausted-count banner and intervention filter.
- Row badge and dropdown visibility.
- Latest sent, scheduled, sending, exhausted, and no-record states.
- Safe failure-message mapping.
- Inline retry confirmation, queued state, successful refresh, and repeated failure.
- Standard and parking registration actions remain available and keyboard accessible.

### Regression and deployment verification

- Existing confirmation, waitlist, promotion, cancellation, organizer, and reminder suites remain green.
- Migration checks run locally and against rollback-only SQL validation when the local Supabase bootstrap collision prevents a full reset.
- Before production migration, `supabase db push --linked --dry-run` must name exactly the intended migration.
- Edge Function deployment is limited to `send-registration-email` and requires separate authorization.
- Production completion requires migration-ledger verification, deployed-function readback, cron readback, and an authorized controlled failure/retry test. Merge, migration, function deployment, and production testing remain separate authorization gates.

## Success Criteria

- A newly failed lifecycle email retries no earlier than the approved backoff boundaries and stops after four total attempts.
- Successful deliveries are never resent by automatic or manual retry handling.
- Obsolete lifecycle emails are never delivered.
- An exhausted failure is visible from its event's registration list and View Registration screen.
- An authorized organization member can retry that exact failed delivery and see the authoritative result.
- Browser users cannot read the delivery ledger directly or invoke arbitrary sends.
- Organizer notifications and event reminders retain their existing behavior.

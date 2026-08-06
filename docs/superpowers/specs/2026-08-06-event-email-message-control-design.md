# Event Email Message Control Design

**Date:** 2026-08-06

**Status:** Approved

## Purpose

Bring the deployed registration-confirmation and event-reminder Edge Functions under source control, let each event creator customize the plain-text body of those two emails, and make email delivery authenticated, auditable, and resistant to duplicate sends.

Parking passes remain admin-produced and admin-distributed. The system must not invent pickup, printing, timing, location, or notification instructions. Event creators own all such process language through the event's customizable messages.

## Existing State

Supabase project `eonpdgufuewpqdjpshbc` currently has two active functions whose source is absent from `origin/main`:

- `send-registration-email`, deployed version 7, bundle hash `ade3a9d9e03ac124dd386cf1d44b599d6f7ad15fe48668ca030a2657d954b397`.
- `send-event-reminders`, deployed version 2, bundle hash `e439e792d708bb5bdf6910a8a7b363716773731016496f39bd55a8852ba25cd9`.

The registration function sends initial confirmation or waitlist email, cancellation email, waitlist-promotion email, and optional organizer notification. Its database trigger currently invokes it with the public anonymous key, while the function is deployed without JWT verification.

The reminder function runs hourly, finds active events whose one configured reminder is due, and emails confirmed registrants. The existing cron invocation uses the service-role key, but the function is also deployed without JWT verification. Its SMTP setup does not retrieve the organization's Vault-backed password in the same way as the other current email functions.

Both functions construct their email HTML internally. Neither has repository-owned focused tests.

## Goals

- Recover both deployed function sources into `supabase/functions/` and make Git the deployment authority.
- Give every event independent plain-text confirmation and reminder message fields.
- Keep email subjects, status facts, event facts, registration details, and cancellation links system-controlled.
- Require complete message configuration before an affected event becomes active.
- Show parking registrants their selected payment method and current payment status without adding system-owned process instructions.
- Read payment state again when a reminder is sent so the reminder can reflect a payment verified after registration.
- Authenticate database-triggered and cron-triggered function calls.
- Stop trusting webhook-provided registration content when canonical database records are available.
- Escape all dynamic content and preserve intentional plain-text paragraph breaks.
- Record delivery state and suppress duplicate successful sends.
- Preserve existing waitlist, cancellation, promotion, organizer-notification, reminder-schedule, parking-pass, and payment-authority behavior except where explicitly changed here.

## Non-goals

- Emailing, attaching, or letting registrants print parking passes.
- Customizing email subject lines.
- Supporting placeholder tokens inside administrator-authored messages.
- Allowing arbitrary HTML or rich-text email authoring.
- Multiple reminder schedules per event.
- Reusable cross-event templates, localization variants, or template revision history.
- Changing registration capacity, waitlist promotion, cancellation, payment verification, or parking-pass validity rules.
- Adding an administrator email-delivery dashboard or a general-purpose resend workflow.
- Customizing waitlist, cancellation, waitlist-promotion, or organizer-notification copy in this project.

## Event Data Model

Add two nullable `text` columns to `public.events`:

- `confirmation_message`
- `reminder_message`

These are dedicated columns rather than a JSON object or template table because each event has exactly one confirmation body and one reminder body. A separate template table becomes appropriate only if the product later introduces multiple schedules, reusable templates, localization, or revision history.

The migration backfills blank values as follows:

- Parking events receive `Thank you for registering for this parking event.` as confirmation starter text.
- Events with `reminder_hours_before` configured receive `This is a friendly reminder that your event is coming up soon!` as reminder starter text.
- Other existing events retain `null` messages.

Database checks enforce the active-event invariants with whitespace treated as blank:

- An active parking event must have a nonblank `confirmation_message`.
- An active event with `reminder_hours_before` configured must have a nonblank `reminder_message`.

Draft events may retain blank or incomplete messages. Standard events may leave `confirmation_message` blank and receive the system's generic confirmation fallback.

## Delivery Ledger

Add an internal `public.email_deliveries` table for delivery control, not content storage. It contains:

- A generated primary key.
- A unique logical `delivery_key`.
- Owning organization, event, and registration identifiers.
- Message kind: initial registration, cancellation, waitlist promotion, organizer notification, or reminder.
- Delivery state: `pending`, `sent`, or `failed`.
- Attempt count and created, updated, attempted, and sent timestamps.
- A sanitized failure summary that excludes credentials, recipient addresses, registration answers, and message bodies.

Row-level security is enabled. `anon` and `authenticated` receive no table privileges or policies; only trusted service-role function code may access it.

Delivery keys identify one logical email occurrence. Reminder keys include the event, registration, scheduled event start, and reminder offset so a genuinely rescheduled occurrence is distinct. A sent key is never sent again. Failed keys may be reclaimed for retry; successful recipients in a partially failed reminder batch are skipped on the next run.

The event's existing `reminder_sent_at` is updated only after every intended reminder delivery is either newly sent or already recorded as sent. Any failed intended delivery leaves the event eligible for the next hourly retry.

This ledger provides practical idempotency and operational evidence. It does not claim mathematically exact-once SMTP delivery because a provider may accept an email immediately before the function loses its response.

## Event Editor

The Event Editor adds two plain-text textareas:

### Confirmation Email Message

- Available for every event.
- New parking events receive the parking starter text.
- Standard events may leave it blank.
- Parking events may save a blank draft but cannot become active until it is nonblank.
- Helper text tells creators that the system adds confirmation status, event details, submitted registration details, cancellation link, and parking payment facts.
- Helper text tells parking-event creators to supply all pickup location, pickup timing, identification, and other process instructions here.

### Reminder Email Message

- Available when reminders are configured.
- Enabling a reminder supplies the reminder starter only when the field is currently blank; toggling reminder settings never overwrites authored text.
- Events may save a blank draft but cannot become active with a configured reminder until this field is nonblank.
- Helper text tells creators that the system adds event date, time, location, calendar link, and parking payment facts.

Both fields preserve ordinary text and line breaks. They offer no formatting toolbar, raw HTML, or placeholder syntax. Event title, date, time, location, and payment values remain separate system-rendered fields, so custom text cannot become stale through unresolved tokens.

The existing quick Draft/Active selector and the full Event Editor enforce the same validation. Database checks remain the final guard against bypass through another client.

## Frontend Data Flow

`EventEditor.jsx` loads and edits `confirmationMessage` and `reminderMessage`. The parking preset supplies its confirmation starter. Enabling reminders supplies the reminder starter without overwriting nonblank text.

`eventPayload.js` serializes the React fields as `confirmation_message` and `reminder_message`. Its active-event validation rejects:

- Active parking events with a blank confirmation message.
- Active reminder-enabled events with a blank reminder message.

Event create, edit, duplicate, and status-change paths preserve both values. Preview behavior is limited to editor guidance in this project; no full email-client rendering preview is added.

## Confirmation Email Composition

The subject remains system-controlled:

- Confirmed: `Registration Confirmed: [Event Title]`
- Waitlisted: `Waitlist Confirmation: [Event Title]`

For an initial confirmed registration, the body order is:

1. Event-title header and `Registration Confirmed` label.
2. Confirmed status badge.
3. Safely rendered `confirmation_message`, or the generic `Your registration has been confirmed!` fallback for a standard event whose field is blank.
4. Parking-only payment facts.
5. Event date and location when present.
6. Submitted form fields.
7. Cancellation link.
8. Automated-message footer.

The custom message applies only to the initial confirmed-registration email. Initial waitlist, cancellation, and waitlist-promotion emails retain their system-owned status-specific copy. Organizer notification copy also remains unchanged.

An active parking event with a missing custom message is an invariant violation. The handler records a failed delivery instead of silently substituting standard-event wording.

## Reminder Email Composition

The subject remains `Reminder: [Event Title] is coming up!`.

For each confirmed registration, the body order is:

1. Event-title header and `Event Reminder` label.
2. Safely rendered `reminder_message`.
3. Parking-only payment facts read from that registration at reminder send time.
4. Event date, time, and location when present.
5. Google Calendar link.
6. Registered-recipient footer.

The existing hourly schedule, `reminder_hours_before` threshold, confirmed-recipient restriction, and one-reminder-per-event model remain unchanged.

## Parking Payment Facts

Parking confirmation and reminder emails include two factual rows and no system-authored process text:

- `Payment method: Tithe.ly` or `Payment method: Pay in Person`
- `Payment status: Pending verification`, `Payment status: Partially paid`, or `Payment status: Verified`

The registration's selected method remains the displayed method even when an administrator later records a cash, check, or Tithe.ly ledger entry. The current registration payment projection remains authoritative for status:

- `pending` maps to `Pending verification`.
- `partial` maps to `Partially paid`.
- `paid` maps to `Verified`, including preserved legacy-paid registrations.

`not_required` is not expected for a valid parking registration. If encountered, it renders as `Not required` rather than inventing a process instruction.

The system never says a pass is printed, printable, ready, available, mailed, or waiting for pickup. Event creators may provide any accurate process language in the customizable message.

## Safe Plain-Text Rendering

Custom messages remain text at rest. The functions:

1. Normalize CRLF and CR line endings to LF.
2. HTML-escape the entire value.
3. Preserve paragraph breaks and single line breaks using generated safe markup.

Event title, location, form labels, form answers, payment labels, URLs, and all other dynamic values are escaped or constructed through narrow URL APIs before insertion into HTML. No administrator-authored HTML is executed.

Function dependency versions are pinned exactly in committed Deno configuration rather than using floating major-version imports.

## Invocation Security

Both functions accept `POST` only and deploy with JWT verification enabled.

The reminder cron retains its protected service-role authorization. The registration insert/update trigger is migrated from the anonymous key to the same protected service-role invocation mechanism. Each handler also validates that the bearer credential is the project service-role credential before reading a body or querying data; gateway verification alone is not treated as authorization because ordinary authenticated tokens must not invoke these jobs.

`send-registration-email` accepts only the minimum delivery identifiers and event kind from the webhook. It reloads the registration, event, and organization records using the service-role client and confirms that the canonical record matches the requested transition before composing or claiming a delivery. Form data, status, email address, event configuration, and payment facts come from those canonical records, not caller-supplied copies.

Secrets are read from Edge Function environment variables or the existing Vault-backed SMTP RPC. Service-role and SMTP credentials never enter response bodies or logs.

## Function Boundaries

Both deployed bundles are first recovered as repository evidence, then reorganized into testable units without changing unrelated behavior:

- A shared safe-text and email-shell module owns escaping and plain-text rendering.
- A shared SMTP module loads the organization's Vault-backed secret and sends HTML alternatives.
- A shared delivery module claims, completes, and fails logical deliveries.
- Registration-email composition owns confirmation, waitlist, cancellation, promotion, and organizer variants.
- Reminder selection and composition own due-event and recipient processing.
- Thin `index.ts` entrypoints own HTTP authorization, request parsing, orchestration, and responses.

Helpers use explicit inputs and return values so Deno tests can cover them without sending email or requiring a live Supabase project.

## Error Handling

- Unauthorized, non-POST, malformed, or unsupported requests are rejected before privileged database work.
- Missing canonical registration, event, organization, message configuration, registrant email, or SMTP configuration produces a sanitized failed delivery or explicit skipped result as appropriate.
- An SMTP failure marks only that logical delivery failed and does not expose credentials or registration content.
- Reminder batches continue across recipients, retain successful delivery records, and leave the event retryable when any intended delivery fails.
- Standard confirmation emails use the generic fallback only when allowed by the event invariant.
- Database constraints and server-side validation do not rely solely on the React editor.
- A deployment whose read-back hash does not match the reviewed bundle is treated as failed verification.

## Migration and Compatibility

The schema migration is additive before it becomes restrictive:

1. Add both message columns and the delivery ledger.
2. Backfill qualifying existing events with safe starter text.
3. Add active-event message checks using `coalesce(btrim(message), '')` so `null` cannot pass accidentally.
4. Update the registration webhook trigger to use protected service-role invocation.
5. Preserve existing cron timing, trigger timing, and registration status transitions.

Existing standard events without reminders remain unchanged. Existing active parking and reminder-enabled events satisfy the new checks through backfill and can be edited immediately after the updated application deploys.

## Testing

### Schema and security tests

- Message columns and delivery constraints exist.
- Whitespace-only text is rejected for affected active events.
- Drafts may remain incomplete.
- Standard confirmation fallback remains valid.
- The delivery table has RLS enabled and no `anon` or `authenticated` access.
- Registration triggers use protected invocation and never the anonymous key.
- Both function configurations require JWT verification.

### Editor and payload tests

- Parking presets and reminder enabling supply the approved starter text.
- Existing authored text is never overwritten by toggles or edits.
- Create, edit, duplicate, draft, active, and quick-status paths preserve and validate both fields.
- Snake-case persistence and camel-case editor state remain consistent.

### Function tests

- Only trusted service-role invocations are accepted.
- Webhook-provided PII or status cannot override canonical database records.
- Custom confirmation applies only to initial confirmed registrations.
- Waitlist, cancellation, promotion, and organizer variants retain their copy.
- Reminder custom text and current per-recipient payment facts render correctly.
- Every supported payment method and status maps to the approved label.
- HTML-sensitive content is escaped and plain-text line breaks are preserved.
- Sent delivery keys suppress duplicates.
- Failed reminder recipients retry without resending successful recipients.
- SMTP Vault lookup and failure handling are consistent across both functions.

### Repository and runtime verification

- Run focused Deno tests for both functions and shared modules.
- Run the full Vitest suite serially with `npx vitest run --dir src --maxWorkers=1`.
- Run lint and the production build.
- Confirm no function source, test, or configuration remains outside the repository-owned paths.
- Deploy schema, application, and functions in dependency order.
- Read back deployed function versions and hashes and compare them with the reviewed bundles.
- With an explicitly approved test recipient, send one controlled confirmation and one controlled reminder and inspect content, links, delivery states, payment freshness, and duplicate suppression.

## Rollout Order

1. Implement on a clean branch based on `origin/main`.
2. Apply the additive/backfill/constraint migration.
3. Deploy the application editor and validation changes.
4. Deploy the repository-controlled registration function.
5. Deploy the repository-controlled reminder function.
6. Read back function metadata and source hashes.
7. Run controlled end-to-end email verification using only an approved test address.
8. Publish a ready, non-draft PR when authorized and leave it unmerged until explicit merge approval.

## Success Criteria

- Both production email functions have reviewed, tested, repository-owned source.
- Every event can customize confirmation and reminder body text independently.
- Active parking and reminder-enabled events cannot omit their required message.
- Subjects and factual system fields remain consistent and trustworthy.
- Parking recipients see their selected payment method and current payment status in confirmations and reminders.
- No system-authored text makes a parking-pass process promise.
- Reminder payment status reflects changes made after registration.
- Function invocations reject untrusted callers and compose from canonical records.
- Successful logical deliveries are not resent during ordinary retry handling.
- Existing unrelated email and registration behavior remains intact.

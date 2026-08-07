# Repeat-Submission Warning Design

- **Date:** 2026-08-07
- **Status:** Design approved; written specification pending user review

## Goal

Prevent accidental repeat registrations without blocking legitimate registrations for another person or vehicle. A public registrant who reuses the same contact email for the same event within 10 minutes must receive a warning before a second registration is created. The warning directs corrections to the church office and permits an explicit additional registration.

The submission boundary must also be idempotent: retrying the same browser submission attempt must return the registration already created by that attempt instead of inserting another row, sending another confirmation email, or consuming capacity again.

## Evidence and Current Behavior

The current React form disables the submit button after its `submitting` state renders and guards the known Next-to-Submit button-position race. The trusted `submit-registration` Edge Function nevertheless treats every accepted request as a new insert. The `registrations` table has no submission-attempt identifier or recent-registration warning rule.

A privacy-limited production query found five likely repeat pairs for the current event. Each pair used the same normalized system email and was submitted 3.26 to 7.81 minutes apart. The earlier rows were subsequently cancelled and the later rows remain confirmed. The paired form payloads differed in one to nine fields, so the observed cases were not byte-for-byte network retries. No names, email addresses, phone numbers, IP addresses, or answer values were returned by the analysis.

This evidence calls for two related protections:

1. an email-based warning for a newly completed form submitted shortly after another registration; and
2. an attempt identifier for exact retries caused by repeated requests or an uncertain network response.

## Product Decisions

- The recent-registration window is 10 minutes.
- The match uses the normalized protected system email within the same organization and event.
- `pending`, `confirmed`, and `waitlisted` registrations count as active matches.
- Cancelled registrations do not trigger the warning.
- A recent match produces a warning, not a hard block.
- Corrections are not applied through resubmission. The warning instructs the registrant to contact the church office.
- The warning contains no office email address or phone number.
- A legitimate additional registration requires an explicit context-aware continuation action.
- IP addresses remain digital-signature evidence and are not duplicate-detection identifiers.

## Scope

### Included

- Public submissions through the existing `submit-registration` Edge Function.
- A server-side recent-registration check after request and Turnstile validation and before insertion.
- A client-generated submission-attempt UUID enforced as unique by the database.
- A warning dialog that preserves all entered values.
- Context-aware continuation wording for standard, parking, and future event types.
- Fresh Turnstile verification before an explicitly confirmed continuation.
- Unit, component, migration-contract, and integration coverage for the new behavior.

### Not included

- Automatically updating, replacing, merging, or cancelling an earlier registration.
- A registrant self-service correction flow.
- A new office contact setting or public office contact details.
- Matching on IP address, name, phone number, vehicle data, signatures, or arbitrary answer similarity.
- Preventing an intentional additional registration after the warning.
- Changing capacity, waitlist, payment, waiver, cancellation, or confirmation-email rules except that suppressed duplicate inserts produce none of their downstream side effects.
- Retrospective cleanup of existing registrations.

## Terminology

**Submission attempt** means one logical press of the public form's final submit action, including safe network retries and the continuation following a recent-registration warning. It is identified by `submissionAttemptId`.

**Recent registration** means an active registration in the same organization and event whose normalized protected system email matches the submitted email and whose `created_at` is within the preceding 10 minutes according to server/database time.

**Explicit override** means the registrant chose the context-aware continuation action after seeing the recent-registration warning. It is an intent signal, not an authorization mechanism.

## Architecture

The existing React form and `submit-registration` Edge Function remain the public boundary. The browser adds two server-validated request fields:

- `submissionAttemptId`: a UUID created when a fresh form session begins; and
- `recentDuplicateOverride`: a boolean that is `false` until the registrant explicitly continues from the warning.

The shared request parser continues to reject unknown top-level properties. It validates a supplied UUID and boolean and constructs a fresh trusted registration insert. A cached legacy browser may omit both new properties; the compatibility behavior for that case is defined under Rollout and Compatibility. The browser cannot supply database status, timestamps, email-normalization metadata, or previous-registration identifiers.

The Edge Function processes a request in this order:

1. Validate the origin, method, content type, body limits, and exact request shape.
2. Verify the Turnstile token against the configured hostname and action.
3. Load the event by both event and organization ID.
4. Revalidate the event, visible answers, payment selection, and waiver decisions and build the trusted insert.
5. Look for an existing registration with the same `submission_attempt_id`.
6. If that attempt already created a registration for the same organization and event, return the existing registration's current public result without inserting again.
7. If the attempt identifier is already associated with a different organization or event, reject the request as invalid.
8. Unless `recentDuplicateOverride` is true, query for an active same-event registration with the same normalized `system_email` and `created_at` at or after the server-calculated 10-minute cutoff.
9. If a recent registration exists, return the sanitized `recent_registration` outcome without inserting.
10. Otherwise, insert normally and return only `id`, `status`, `payment_status`, and `payment_method` as today.

The attempt lookup runs before the recent-registration lookup. Therefore, a request whose insert succeeded but whose response was lost receives its existing success result rather than a warning about itself.

The recent override deliberately remains simple. A caller can set the boolean directly because additional registrations are allowed; the value records explicit UI intent rather than granting privilege. Turnstile, server-side request reconstruction, event validation, and database permissions remain authoritative.

The warning check does not serialize two different attempt identifiers. If two genuinely distinct form sessions submit concurrently before either row exists, both can pass the recent check. This is an accepted tradeoff of the selected server-warning approach: the warning addresses the observed minutes-apart re-entry pattern, while the database attempt constraint prevents exact request retries. A database-atomic cooldown gate remains out of scope.

## Database Contract

Add `registrations.submission_attempt_id uuid NOT NULL DEFAULT gen_random_uuid()` and a named unique constraint. The default assigns identifiers to existing rows during migration and to trusted admin/CSV insert paths that do not provide one. The public Edge Function supplies the browser attempt UUID in its trusted insert.

The unique constraint is the final concurrency guard for the same attempt. The handler first performs a normal attempt lookup for retries. If two copies race after that lookup, only one insert can succeed. After an attempt-constraint insert error, the handler reloads that attempt by organization and event and returns the existing public result. It does not treat unrelated insert errors as idempotent success.

The recent-registration comparison uses the server-normalized `system_email` already produced by shared form validation. The lookup remains scoped by organization ID, event ID, active status, and cutoff time. No earlier row or answer is returned to the browser.

All public registrations created through the current event presets contain the protected `system_email` field. A malformed event/request combination that lacks its required system email fails existing request validation; the duplicate guard does not guess identity from names, arbitrary email fields, or signature data.

## Warning Interaction

When the Edge Function returns `recent_registration`, the form preserves its values, signature inputs, payment selection, and current page. It displays an accessible modal dialog with focus containment, Escape behavior equivalent to the safe action, and focus restoration when dismissed.

The standard-event warning is:

> **You recently registered**
>
> A registration using this email was submitted for this event within the last 10 minutes. To correct an existing registration, please contact the church office. If you are registering another person, you may continue.

The parking-event warning replaces the last sentence with: "If you are registering another vehicle, you may continue." An unknown future event type uses: "If you are submitting another registration, you may continue."

The safe/default action is **Return to form**. It closes the dialog without clearing or submitting anything.

The continuation action is:

- **Register another person** for a standard event;
- **Register another vehicle** for a parking event; or
- **Submit another registration** for an unknown future event type.

Choosing the continuation action records the override for this form session, closes the dialog, resets Turnstile, and moves focus to the security-verification container. Because Turnstile tokens are single-use, the token validated on the warning-producing request is never reused. When the Turnstile callback supplies a fresh token, the pending confirmed submission continues automatically. Managed verification may complete without another gesture; if Turnstile presents a challenge, the registrant completes it before the automatic continuation. The user does not need to re-enter form answers or press the registration submit button again.

Submit and continuation controls remain disabled while their corresponding request is in flight. The existing success screen and payment transition remain unchanged after creation.

The attempt UUID remains stable through validation errors, network uncertainty, the recent-registration warning, and its confirmed continuation. A new UUID is created only for a genuinely fresh form lifecycle, including the explicit post-success **Register Another** reset. If an attempt already created a registration, later edits using that same attempt do not create a correction; the existing result is returned and the office-correction instruction remains the governing policy.

## Error Handling

`recent_registration` is an expected, sanitized HTTP `409` outcome using the existing `{ error, requestId }` response envelope. The client recognizes only the exact `recent_registration` code as the warning path. It must not be logged as a server failure and must contain no earlier registration ID, timestamp, status, answer, email, signature, payment fact, or capacity fact.

Unexpected attempt lookup, recent lookup, or insert failures return the existing generic submission failure and correlation ID. The browser preserves all form values, resets Turnstile, and offers a retry. The server does not silently bypass the recent-registration check after a lookup failure.

An invalid or conflicting attempt UUID returns `invalid_request`. A recent-registration override affects only the warning gate; it does not bypass event availability, field, payment, waiver, Turnstile, or database validation.

No logs include the normalized email, form payload, IP address, signature data, or earlier registration identifiers. Existing safe request IDs and error codes remain sufficient for correlation.

## Privacy and Security

The recent check stays inside the existing Turnstile-protected submission endpoint. There is no public email-lookup endpoint. Turnstile is verified before the database reveals even the sanitized recent-registration outcome, limiting automated registration probing.

The browser receives only the fact that its submitted email recently registered for the selected event. It receives no data from the earlier row. The server already needs the submitted email to validate and store the registration; the design introduces no additional public registrant field.

Although waiver signature records retain the platform-derived request IP as signature evidence, IP addresses are explicitly excluded from duplicate matching. Shared networks can produce false matches, mobile networks can change addresses, events without waivers may have no signature IP, and repurposing signature evidence would unnecessarily broaden its privacy use.

The database migration preserves existing RLS and grants. The unique attempt constraint changes duplicate-attempt behavior but does not expose the column through a new public read path. Anonymous direct table inserts remain revoked.

## Testing Strategy

### Shared request and server tests

- Accept a valid UUID attempt ID and explicit boolean override.
- Accept the explicitly defined cached-legacy request shape with both new properties absent.
- Reject malformed or conflicting attempt identifiers, a lone override without an attempt identifier, and non-boolean overrides.
- Preserve the exact top-level key allowlist and all existing size limits.
- Treat email case and surrounding whitespace consistently through existing server normalization.
- Return `recent_registration` for `pending`, `confirmed`, and `waitlisted` matches inside 10 minutes.
- Exclude cancelled, older, different-event, and different-organization rows.
- Use the server clock for the cutoff boundary, including exact 10-minute boundary coverage.
- Allow an explicit override while retaining every other validation rule.
- Return an existing result for a repeated attempt without a second insert.
- Recover the existing result after a unique-attempt insert race.
- Reject an attempt reused across a different event or organization.
- Sanitize lookup failures and logs without PII.

### Database migration tests

- Add a non-null UUID attempt column with a generated default.
- Enforce uniqueness with a stable named constraint.
- Backfill existing registrations with distinct non-null UUIDs.
- Allow trusted admin/CSV inserts that omit the field to receive defaults.
- Preserve anonymous-insert revocation, member-scoped imports, existing RLS, triggers, capacity accounting, and email automation.

### React component tests

- Send one stable attempt UUID across a request, warning, and confirmed continuation.
- Preserve form, waiver, payment, and navigation state when warned.
- Render the approved correction instruction without contact details.
- Use person, vehicle, and fallback continuation labels by event type.
- Make **Return to form** the safe action and restore focus.
- Require a fresh Turnstile result before confirmed continuation.
- Prevent repeat clicks while submitting or continuing.
- Rotate the attempt UUID only for a genuinely fresh form lifecycle.
- Keep existing success, payment, waitlist, and generic-error behavior.

### Integration and regression verification

- Run focused Edge Function, shared validation, migration-contract, and form component suites.
- Run the complete Vitest suite serially if concurrent workers encounter the repository's known worker-start timeout behavior.
- Run lint, build, and migration-history validation.
- Verify that one simulated lost-response retry creates one database row and one confirmation-delivery trigger event.
- Verify that a recent second form receives a warning, Return creates nothing, and the explicit continuation creates exactly one additional row.
- Verify that cancelling a registration removes it from subsequent warning consideration.

A controlled production submission requires separate authorization and a designated test event because it creates a real registration, can consume capacity, and may trigger email and payment side effects.

## Rollout and Compatibility

Use this explicit rollout sequence:

1. Apply the additive database migration. Its generated default keeps the old Edge Function, admin inserts, and CSV imports compatible.
2. Deploy a backward-compatible Edge Function. When both `submissionAttemptId` and `recentDuplicateOverride` are absent, it treats the request as a cached legacy client: it generates a new attempt UUID, skips the recent-registration warning that the old browser cannot render, and proceeds through every existing Turnstile and registration validation. If either new property is present, the current-client contract requires a valid attempt UUID and explicit boolean override.
3. Deploy the browser that always sends both new properties and renders the warning.

The cached-client fallback remains intentionally narrow and is covered by tests. It does not weaken an authorization control because intentional additional registrations are allowed and current callers can explicitly override the warning. Exact idempotency and the warning are guaranteed for the new browser contract; a cached legacy request receives the pre-feature behavior until it refreshes.

Do not apply production migrations, deploy functions or hosting, or perform real registrations without separate authorization.

## Success Criteria

- An exact retry of one submission attempt creates one registration and one set of downstream side effects.
- A same-email, same-event active registration inside 10 minutes produces the approved warning before a second insert.
- The warning preserves entered data and tells registrants to contact the church office for corrections.
- A legitimate additional person or vehicle can be registered through an explicit context-aware continuation.
- Cancelled registrations, other events, other organizations, and registrations older than 10 minutes do not trigger the warning.
- No earlier registration details or registrant PII are exposed in responses or logs.
- IP addresses remain limited to their existing digital-signature evidence purpose.
- Existing validation, Turnstile, capacity, waitlist, payment, waiver, cancellation, email, admin, and CSV behaviors continue to pass their regression tests.

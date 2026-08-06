# Turnstile Siteverify Enforcement Design

**Date:** 2026-08-06
**Status:** Approved for implementation planning

## Decision

Route every public registration through a new Supabase Edge Function that verifies the Cloudflare Turnstile token before writing the registration. Remove direct `INSERT` access to `public.registrations` from browser roles so the verification boundary cannot be bypassed.

The registration path fails closed. A missing, invalid, expired, reused, or mismatched token, a Siteverify network failure, or a missing server secret prevents registration.

## Current Vulnerability

The browser currently checks only whether a Turnstile token string exists, then inserts directly into `public.registrations`. The token is never sent to Cloudflare's Siteverify endpoint.

Production also currently:

- grants `INSERT` on `public.registrations` to `anon` and `authenticated`; and
- applies `registrations_insert_valid` to all roles, allowing inserts when the referenced event is active.

An attacker can therefore skip the browser and Turnstile widget and submit directly through the Supabase Data API.

## Security Invariant

A public registration may be created only when all of the following are true:

1. a trusted server validates a fresh, single-use Turnstile token;
2. Siteverify reports `success: true`;
3. the verified hostname is exactly `events.kentmethodist.org` or `event-registration-b7840.web.app`;
4. the verified action is `event_registration`;
5. the requested organization and event exist, match each other, and the event is active and open for registration; and
6. the registration is inserted by the trusted server path rather than a browser database role.

No outage or verification error may weaken this invariant.

## Selected Architecture

### Browser

The Turnstile widget renders with action `event_registration`. On submit, the browser invokes a new `submit-registration` Edge Function with:

- `turnstileToken`;
- `eventId` and `orgId`;
- the visible form data;
- the selected payment method; and
- waiver signature decisions and signature data.

The browser does not send authoritative `status`, `payment_status`, IP address, or user agent values. It no longer inserts directly into `public.registrations` and no longer calls `capture-signer-ip` during registration.

The function returns only the fields the existing success and payment flows require: `id`, `status`, `payment_status`, and `payment_method`.

### Edge Function

`submit-registration` is a public function with `verify_jwt = false` because registration does not require a signed-in Supabase user. Public reachability is not authorization: every `POST` request must pass Siteverify before any database write.

The function accepts JSON bodies up to 1 MiB and Turnstile tokens up to Cloudflare's 2,048-character limit. It requires object-shaped form data and an array of signature records; it rejects unexpected top-level fields rather than silently treating them as authoritative.

The function:

1. accepts `OPTIONS` for browser CORS and rejects non-`POST` methods;
2. parses and bounds the request shape and Turnstile token length;
3. calls `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET`, the token, and the request IP when available;
4. fails closed unless the response satisfies the full security invariant;
5. loads the event with the server-side Supabase client and rechecks organization, active status, and registration closing time;
6. derives registration and payment status from the event configuration rather than trusting the browser;
7. permits only payment methods actually enabled for the event;
8. overwrites signature IP address and user agent metadata from request context; and
9. inserts with the server credential so existing capacity, waitlist, cancellation, and notification triggers continue to run.

The function uses these server-side environment values:

- `TURNSTILE_SECRET` for Siteverify;
- `TURNSTILE_HOSTNAMES=events.kentmethodist.org,event-registration-b7840.web.app`; and
- `TURNSTILE_ACTION=event_registration`.

Secrets are stored in Supabase Edge Function secrets and never committed or returned to the browser.

### Database

A forward-only migration:

- drops `registrations_insert_valid`;
- revokes `INSERT` on `public.registrations` from `anon` and `authenticated`; and
- leaves existing member `SELECT` and `UPDATE` policies unchanged.

The service role remains able to insert through the Edge Function. No public `SECURITY DEFINER` registration RPC is introduced.

## Error Contract

- Malformed payload: `400` with a generic invalid-request response.
- Invalid event relationship or event not accepting registrations: `409` with a stable registration-unavailable response.
- Missing or failed Turnstile verification, Siteverify outage, hostname mismatch, or action mismatch: `403` with `security_verification_failed`.
- Database or unexpected server failure: `500` with a generic submission-failed response.

Detailed Siteverify and database errors are logged server-side but are not exposed to callers. After any failed submission, the browser resets the widget to obtain a fresh token and displays an actionable retry message. CORS permits the public browser invocation but is not treated as an authorization control; Siteverify and removal of browser database writes enforce the boundary.

## Alternatives Rejected

### Siteverify in a Postgres RPC

Rejected because it would couple external HTTP availability and a third-party secret to database transaction execution. It would also require privileged database code without improving the enforcement boundary.

### Cloudflare Worker gateway

Rejected because it adds another deployed runtime, secret store, and operational boundary when Supabase Edge Functions already provide the required trusted server path next to the database.

### Edge Function without database lockdown

Rejected because direct Data API inserts would continue to bypass Siteverify.

## Testing and Proof

Implementation follows test-first development. Required proof includes:

- a failing then passing frontend test showing submission invokes `submit-registration` with the token and no longer calls direct table insert;
- Edge Function unit tests for valid verification, missing token, Siteverify rejection, network failure, hostname mismatch, action mismatch, expired or reused token response, invalid event, and invalid payment method;
- a migration assertion proving browser roles have neither an insert policy nor `INSERT` privilege;
- the complete application test suite, lint, migration validation, and production build;
- a production invalid-token request that returns `403` without inserting; and
- after database cutover, a direct anonymous Data API insert attempt that is denied.

A valid production browser submission is the final legitimate-control check. It must use an event selected for testing so capacity, email, and payment side effects are understood before submission. Until that check is performed, production validation is reported as partial rather than complete.

## Deployment Order

The platforms cannot be changed atomically, so cutover is ordered to avoid a new outage while minimizing the already-existing exposure window:

1. Configure the Turnstile secret and expected-hostname/action values in Supabase.
2. Deploy `submit-registration` while it is not yet used by production clients.
3. Publish the frontend change through the normal ready-PR and `main` deployment workflow.
4. Confirm the deployed frontend invokes the function and invalid tokens fail closed.
5. Immediately apply the database migration that removes browser insert access.
6. Prove direct anonymous insertion is denied and review Edge Function and database logs.
7. Perform the selected valid browser submission and confirm the expected registration result.

PR creation does not authorize merging. The repository PR remains unmerged until the user explicitly authorizes it.

## Rollback and Failure Handling

Before database lockdown, the frontend can be rolled back independently. After lockdown, do not restore public insert access merely to recover availability; that would reopen the vulnerability. Keep registration fail-closed while repairing or rolling back the frontend or Edge Function to a previously verified server-validation version.

## Non-Goals

- Replacing Turnstile with another bot-detection provider.
- Adding a general-purpose API gateway or third-party rate-limiting service.
- Changing capacity, waitlist, payment, waiver, cancellation, or notification product behavior except where server-side derivation is required to preserve it securely.
- Migrating unrelated Supabase functions or API keys.
- Supporting an additional production hostname without first adding it to both Cloudflare Hostname Management and `TURNSTILE_HOSTNAMES`. The dormant embed capability does not implicitly authorize `kentmethodist.org` or any other host.

# Tithe.ly Payment Flow Design

**Date:** 2026-08-05

**Status:** Approved

## Purpose

Replace PayPal with per-event Tithe.ly giving forms while preserving administratively verified payment state and the existing Pay in Person option. The change applies to every confirmed registration for a payment-enabled event, not only parking events.

Tithe.ly is an external giving system. Its hosted form does not confirm a completed gift back to this application. Opening or completing the form must therefore never mark a registration paid automatically. The application keeps the registration payment pending until an authenticated organization administrator verifies it.

## Goals

- Remove PayPal code, dependencies, environment configuration, tests, and documentation.
- Let each event supply its own Tithe.ly Giving Form URL and official embed code.
- Render the giving form inline with a direct-link fallback.
- Retain Pay in Person as an independently configurable payment method.
- Support payment-enabled standard and parking events consistently.
- Preserve the rule that a parking pass becomes valid only after payment is verified.
- Prevent arbitrary administrator-supplied HTML or JavaScript from executing on public registration pages.

## Non-goals

- Native Tithe.ly API access, Tithely.js tokenization, webhooks, or automatic gift reconciliation.
- Matching Tithe.ly donor records or transactions to registrations.
- Storing Tithe.ly API keys or other secrets.
- Changing waitlist promotion, cancellation, refunds, receipts, tax treatment, or accounting workflows.
- Reworking unrelated event, waiver, notification, export, or reporting behavior.

## Provider Contract

Tithe.ly currently supplies two values in the Giving Form dashboard:

- A Giving Form URL on `https://give.tithe.ly/` with a UUID-valued `formId` query parameter.
- Embed code containing one `button.tithely-give-button` whose `data-form` value is the same UUID and one deferred script whose source is exactly `https://static.tithely.com/give/give.js`.

Tithe.ly also documents placing the Giving Form URL directly in an iframe. The application will use that iframe approach for the inline form. It will parse the dashboard embed code only to validate the provider-owned structure and confirm that its form ID matches the Giving Form URL. It will not inject or execute the pasted button or script.

The accepted provider contract is deliberately narrow:

- URLs must use HTTPS.
- The Giving Form host must be exactly `give.tithe.ly` and the path must be `/`.
- The URL must contain one valid UUID `formId` value.
- The embed code must contain exactly the recognized Tithe.ly button and script structure.
- The embed script host and path must be exactly `https://static.tithely.com/give/give.js`.
- The button `data-form` and URL `formId` values must match.
- Extra executable elements, event-handler attributes, non-Tithe.ly scripts, and mismatched form IDs are rejected.

The normalized stored configuration is the full validated Giving Form URL plus a JSON object such as `{ "formId": "59b0fe48-e075-436e-a91e-88011a19d975" }`. The raw embed code is neither stored nor rendered.

## Event Data Model

Add nullable columns to `public.events`:

- `tithely_giving_url text`
- `tithely_embed_config jsonb`

Both columns default to `null`, leaving existing event records unchanged. They contain public provider configuration, never secrets.

The existing fields remain authoritative:

- `payment_enabled` determines whether the event has a payment flow.
- `payment_amount` is the event's displayed amount when it is positive. Standard donation-oriented events may leave it empty so the donor chooses an amount in Tithe.ly; parking events still require a positive amount.
- `allow_in_person_payment` determines whether Pay in Person is available.

An event has a usable Tithe.ly method only when both new fields form a valid matching pair. An active payment-enabled event is valid when at least one usable method exists:

1. valid Tithe.ly configuration; or
2. `allow_in_person_payment = true`.

Invalid or incomplete Tithe.ly configuration does not block activation when Pay in Person is enabled. It does disable Tithe.ly and produces a clear editor explanation. Activation is rejected only when payment is enabled and neither method is usable. Existing parking validation continues to require a positive payment amount and all protected parking fields and waiver content.

## Payment State Model

`payment_status` and `payment_method` have separate meanings:

- `payment_status` is `not_required`, `pending`, or `paid`.
- New payment-enabled registrations use `payment_method = 'tithely'` or `payment_method = 'in_person'`.
- Administrator verification changes only `payment_status` to `paid` and appends verification metadata to `payment_details`.
- Administrator verification does not rewrite the selected method.

Historical method values such as `paypal` and `in_person_verified` remain readable. The migration does not rewrite historical payment records.

The existing `mark_registration_paid` RPC will be generalized so an authenticated organization member can verify a confirmed, pending registration whose selected method is `tithely` or `in_person`. It remains organization-scoped, `SECURITY DEFINER`, schema-qualified, unavailable to anonymous users, and restricted to the `authenticated` role. It records `verifiedAt` and `verifiedBy` in `payment_details`.

## Administrator Configuration Flow

When Require payment is enabled, the Event Editor shows:

- Amount
- Tithe.ly Giving Form URL
- Tithe.ly Embed Code
- Allow payment in person

The editor parses both Tithe.ly values together. A successful parse displays a configured-state summary containing the form ID and does not retain the raw embed text after persistence. Editing a saved event reconstructs the configured state from the stored URL and normalized form ID. Replacing the configuration requires pasting the current official embed code again.

Validation messages distinguish these cases:

- Missing URL
- Missing embed code during initial configuration or replacement
- Non-HTTPS or non-Tithe.ly URL
- Missing or invalid form ID
- Unsupported embed structure or script source
- URL/embed form-ID mismatch
- No usable payment method

Draft events may retain incomplete input while an administrator is editing. Active events must satisfy the usable-method rule at save time.

## Registrant Flow

### Method choice

The payment method is chosen before registration submission so it can be stored in the initial anonymous insert. This avoids creating an anonymous payment-update endpoint.

- Tithe.ly and Pay in Person available: show a required method choice.
- Tithe.ly only: select `tithely` automatically.
- Pay in Person only: select `in_person` automatically.
- Neither: the active-event invariant has been violated; stop submission with a clear error.

The registration insert uses `payment_status = 'pending'` for payment-enabled events and `not_required` otherwise. It includes the selected method for payment-enabled events.

### Post-submission routing

Every confirmed, payment-enabled registration uses the selected method flow:

- `tithely`: show the Tithe.ly payment step.
- `in_person`: show registration confirmation with Pay in Person instructions.

Waitlisted and otherwise unconfirmed registrations skip the payment step, preserving current behavior. Their selected method remains recorded for later administrative handling; this project does not add a new waitlist-promotion notification or payment-reentry workflow.

### Tithe.ly step

The Tithe.ly step contains:

- The event amount, when configured, and an explanation that the gift remains pending until verified.
- A responsive iframe whose source is the validated Giving Form URL.
- An accessible iframe title containing the event name.
- An **Open Tithe.ly in a new tab** link using `target="_blank"` and `rel="noopener noreferrer"`.
- An **I've finished with Tithe.ly** button.

The completion button changes only local UI phase and advances to registration confirmation. It performs no database write and never claims that Tithe.ly confirmed the gift.

The direct link is always visible. This is required both as general failure recovery and because Tithe.ly documents browser limitations for embedded giving, including Safari login or confirmation-page problems.

## Component Boundaries

### `src/utils/tithelyEmbed.js`

A pure utility that:

- Parses and validates a Giving Form URL.
- Parses the official embed snippet with `DOMParser`.
- Rejects unrecognized elements, scripts, executable attributes, hosts, paths, or form IDs.
- Confirms matching form IDs.
- Returns normalized `{ givingUrl, embedConfig: { formId } }` data or a specific validation error.
- Revalidates persisted public event data before it is rendered.

### `src/components/TithelyGivingForm.jsx`

Renders the amount, pending-verification explanation, responsive iframe, fallback link, and local completion action. It does not import Supabase and cannot mutate payment state.

### `src/components/PaymentMethodChoice.jsx`

Renders only the usable methods and produces `tithely` or `in_person`. It has no persistence responsibility.

### `src/components/RegistrationPaymentStep.jsx`

Coordinates the selected post-registration method. PayPal capture and the current public `update_payment_status` call are removed. The component routes Tithe.ly completion to success without changing persisted status.

### Existing integration points

- `EventEditor.jsx` loads, edits, validates, and summarizes the provider configuration.
- `eventPayload.js` serializes normalized fields and enforces active-event payment-method availability.
- `EventRegistrationForm.jsx` shows method selection, writes the selected method during initial insertion, and routes every confirmed payment-enabled event.
- `RegistrationViewer.jsx` exposes **Mark Paid** for eligible standard registrations.
- `ParkingRegistrationTable.jsx` exposes **Mark Paid** for eligible Tithe.ly and in-person parking registrations.
- A shared predicate determines whether a registration can be marked paid so both admin tables follow the same rule.

## Error Handling

- Invalid persisted Tithe.ly data is treated as unavailable and never rendered.
- If Pay in Person is also configured, the registrant can continue using that method.
- If no method remains usable, submission stops with a configuration-error message; it does not silently create an unusable payment flow.
- The iframe and fallback link are independent. A blank or blocked iframe does not remove the direct link.
- Tithe.ly downtime or form failure leaves the registration pending.
- The local completion button remains available because the application cannot reliably observe activity inside the cross-origin iframe.
- An administrator verification failure leaves the registration pending and displays an actionable error.

## PayPal Removal

Remove:

- `@paypal/react-paypal-js` and its transitive lockfile entries.
- `VITE_PAYPAL_CLIENT_ID` from `.env.example` and all source references.
- PayPal provider/button/capture code and PayPal-specific tests.
- PayPal claims in `README.md`.

Historical database values containing `paypal` are preserved. Reports and detail views continue to display stored historical method text.

## Repository Hygiene

`.superpowers/` is already listed in `.gitignore`; retain that rule. No generated brainstorming state belongs in source control.

## Testing and Verification

### Parser tests

- Accept the current `give.tithe.ly` URL and matching `static.tithely.com` embed shape.
- Preserve safe custom-link query parameters in the validated URL.
- Reject HTTP, look-alike domains, alternate paths, missing or duplicate form IDs, malformed UUIDs, extra executable markup, inline event handlers, alternate scripts, and mismatched form IDs.
- Revalidate normalized stored data before rendering.

### Event validation tests

- Tithe.ly only, Pay in Person only, and both are valid.
- Neither method is invalid for an active payment-enabled event.
- Invalid Tithe.ly plus Pay in Person is valid and exposes only Pay in Person.
- Drafts may save incomplete configuration.
- Existing parking amount, required-field, and waiver validation remains intact.
- Event create, edit, duplicate, preview, and payload paths retain the normalized fields correctly.

### Registration tests

- Both methods require a choice before submission.
- Single available methods are selected automatically.
- Standard and parking confirmed registrations enter the appropriate flow.
- Waitlisted registrations skip payment.
- Tithe.ly completion reaches confirmation while stored status remains pending.
- Pay in Person reaches confirmation with pending status and the correct method.
- Payment-disabled events remain unchanged.

### Administrator and database tests

- Eligible pending Tithe.ly and in-person registrations can be marked paid by an authenticated member of the owning organization.
- Anonymous callers, non-members, cross-organization calls, cancelled/waitlisted registrations, already-paid registrations, and unsupported methods are rejected.
- Parking pass status becomes valid only after paid verification.
- Standard and parking admin tables expose the same eligibility rule.

### Removal and browser verification

- No PayPal dependency, environment variable, import, runtime script, documentation claim, or current test fixture remains.
- Run the full Vitest suite serially, followed by lint and production build.
- In a real browser, verify the inline form, fallback link, completion copy, standard and parking flows, narrow mobile layout, and Safari-compatible fallback behavior using the current UMCK Tithe.ly form.

## Success Criteria

- PayPal cannot load or be selected anywhere in the current application.
- Each event can configure its own validated Tithe.ly form.
- Registrants can use an inline form or direct link and can still choose Pay in Person when enabled.
- No client action marks a Tithe.ly gift paid.
- Authenticated administrators can verify either current method across standard and parking events.
- Existing waitlist behavior, parking pass authority, and payment-disabled registration flows remain intact.

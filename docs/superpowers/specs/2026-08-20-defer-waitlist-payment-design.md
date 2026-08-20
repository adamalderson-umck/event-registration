# Defer Waitlist Payment Design

## Goal

Prevent a registrant who is joining an event waitlist from choosing or being sent to an online payment flow. A waitlisted registration has no payment due until it is promoted to a confirmed spot. When promotion occurs, the promotion email supplies the event's configured online payment link and mentions Pay in Person when that option is enabled.

## Current Behavior

`EventRegistrationForm` derives whether an event is full from the event's public capacity counters. It still renders the event's normal payment methods, including Tithe.ly, while showing the waitlist notice. The submission Edge Function validates the selected payment method before inserting the registration. The `handle_new_registration` database trigger then locks the event row and makes the authoritative confirmed-versus-waitlisted decision.

The client already avoids the Tithe.ly handoff when the returned registration is waitlisted. However, a waitlisted row can still retain `payment_method = 'tithely'` and a pending payment state. This is also possible when the page initially showed an available spot but another submission took that spot first.

## Chosen Approach

Use a deferred-payment lifecycle enforced at all three relevant boundaries:

1. The browser communicates an explicit waitlist submission and does not offer a payment choice when its loaded event state is full.
2. The submission Edge Function accepts a missing payment method only for a plausible waitlist submission. Normal confirmed-registration payment validation remains unchanged.
3. The database trigger that atomically assigns registration status also normalizes the authoritative payment state. This protects direct requests and capacity races even when the browser's counters are stale.

UI-only filtering was rejected because it cannot protect direct requests or the last-spot race. Post-insert cleanup was rejected because insert-triggered consumers could observe and email an inconsistent payment state.

## Browser Behavior

When `capacity` is reached and `waitlist_enabled` is true:

- Keep the existing waitlist notice and `Join Waitlist` action.
- Do not render `PaymentMethodChoice`, even if the event normally supports Tithe.ly or Pay in Person.
- Clear any previously selected payment method if refreshed event state changes the form into the waitlist path.
- Submit `paymentMethod: null` and an explicit waitlist-intent field.
- Do not require a payment-method selection during final validation.
- Do not use a payment-oriented submit label or enter the post-registration Tithe.ly phase.

When the event is not full, current payment selection and Tithe.ly handoff behavior remain unchanged.

## Submission Contract and Race Handling

The request parser will accept one new boolean field representing waitlist intent. The Edge Function will load the capacity, registration count, and waitlist-enabled fields needed to validate that the intent is plausible. A caller cannot use waitlist intent to bypass payment on an event that has no waitlist path.

The database remains authoritative because it locks the event row during insertion:

- If the final assigned status is `waitlisted`, overwrite any supplied payment method with `null` and set the registration payment status to `not_required`.
- If the final assigned status is `confirmed`, a payment-enabled event must have a valid selected payment method. A stale browser that expected to join the waitlist but receives a newly opened spot must not create a confirmed registration without payment selection.
- Map that rare state-change rejection to a stable conflict response so the browser can tell the registrant that availability changed and that they should retry. Do not expose database error details.

This also covers the inverse race: if the browser selected Tithe.ly while a spot appeared available but the database assigns the registration to the waitlist, the trigger removes the method and payment requirement before the row becomes visible to insert-triggered consumers.

## Promotion Lifecycle

When an existing waitlisted registration is automatically promoted to `confirmed`:

- Change its payment status from `not_required` to `pending` when the event requires payment.
- Keep `payment_method` null because the registrant did not make a choice while waitlisted.
- Preserve the registration's expected-amount snapshot so later event price edits do not rewrite its obligation.
- Continue to allow administrators to record cash, check, or Tithe.ly ledger entries through the existing confirmed-registration payment workflow.

The migration must use the payment projection's guarded-write mechanism when changing projection fields during promotion. Events without payment enabled remain `not_required`.

## Promotion Email

The canonical email loader will include the event's payment configuration. The existing promotion email will add a payment section only when payment is enabled:

- If the stored Tithe.ly configuration is valid, include a safe HTTPS link to the configured `give.tithe.ly` form.
- If Pay in Person is enabled, state that the registrant may pay in person.
- If both are available, show both choices without preselecting either on the registration.
- Do not execute stored embed HTML or scripts in email.
- Do not mark an online payment paid or verified merely because the link was sent or opened.

The email continues to include the confirmed status and cancellation link.

## Data Compatibility

The migration changes behavior for new waitlisted registrations and future promotions. It will not rewrite historical waitlisted rows because existing entries may already have real payment history or operator corrections that must not be inferred away. Existing confirmed, cancelled, paid, partial, and legacy-payment records are unchanged.

## Error Handling

- Invalid or unsupported waitlist intent returns the existing sanitized invalid-request response.
- An atomic capacity outcome that conflicts with the submitted no-payment waitlist intent returns a sanitized conflict response and performs no insert.
- The browser shows an actionable availability-changed message and preserves the registrant's entered form data so they can retry.
- Promotion email delivery continues through the existing idempotent email-delivery ledger and failure handling.

## Testing

Add focused regression coverage for:

- A known-full event hides all payment choices, requires no payment selection, and submits null payment with waitlist intent.
- A normal available event retains existing Tithe.ly and Pay in Person selection behavior.
- The request parser accepts only a boolean waitlist-intent field.
- Server validation does not allow waitlist intent to bypass payment where waitlisting is unavailable.
- The database migration normalizes a race-lost registration to waitlisted with no payment method and `not_required` status.
- The database rejects a race-opened confirmed registration that lacks a required payment selection.
- Promotion changes a paid event's deferred status to pending without fabricating a selected method.
- Promotion email content includes only configured payment paths, uses the validated Tithe.ly URL, and does not claim payment completion.
- Existing no-payment and confirmed-payment paths remain green.

Run Vitest serially with `--maxWorkers=1`, plus the repository's migration contract checks, Deno lint/check for changed Edge Functions, ESLint, and the production build. No migration will be applied and no deployment will be performed without separate authorization.

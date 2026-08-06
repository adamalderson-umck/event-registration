# Tithe.ly Payment Step Repair Design

**Date:** 2026-08-06
**Status:** Approved

## Purpose

Repair the Tithe.ly registration experience so an event can use Tithe.ly's real giving URL and official button snippet without silently degrading to Pay in Person. A registrant who selects Tithe.ly submits the registration first and then advances to a dedicated payment page inside the existing application shell. Administrators continue to reconcile the payment through the payment ledger.

This design amends the Tithe.ly registration experience without changing the approved payment-ledger model.

## Current Failures

- The embed parser rejects Tithe.ly's official `data-location`, `data-fund`, `data-amount`, and `data-frequency` attributes.
- A valid giving URL is retained after an invalid embed is rejected, but the stored configuration is unusable. Tithe.ly then disappears from the registrant's available methods.
- If Pay in Person remains available, the event can save while silently degrading to that one method.
- The fallback is currently a plain URL link instead of the official Tithe.ly button.
- The post-registration payment page requires a local "I've finished with Tithe.ly" action even though it cannot verify payment.
- The administrator ledger uses "Tithe.ly transaction number" rather than Tithe.ly's administrator-facing term, "Transaction ID."

## Goals

- Accept the official Tithe.ly button and script supplied for the event.
- Use the validated Tithe.ly giving URL as the primary iframe source.
- Reconstruct a safe Tithe.ly button as the first fallback.
- Keep a plain giving-URL link as the final no-JavaScript fallback.
- Show Tithe.ly and Pay in Person choices whenever both are configured.
- Advance Tithe.ly registrants to a separate payment step after creating a pending registration.
- Keep the application's global header and footer around the payment step.
- Remove registrant-supplied Gift ID, Transaction ID, or other confirmation fields.
- Label the administrator ledger field "Transaction ID."
- Keep the Turnstile repair out of this changeset.

## Non-goals

- Tithe.ly API access, webhooks, or automatic payment verification.
- Collecting a Gift ID or Transaction ID from the registrant.
- Treating an iframe action or button click as proof of payment.
- Changing the payment-ledger schema or its generic `reference_number` column.
- Changing the ledger's pending, partial, paid, void, or duplicate-detection rules.
- Modifying Turnstile initialization or verification.

## Configuration Contract

### Required inputs

An event offers Tithe.ly only when it has both:

- A valid HTTPS `give.tithe.ly` URL.
- A valid official Tithe.ly button and deferred `give.js` script snippet.

If neither input is present, Tithe.ly is disabled. If either input is present, both must be present and valid. An incomplete or invalid Tithe.ly configuration blocks saving rather than silently degrading to Pay in Person.

A payment-enabled event must still provide at least one usable path: valid Tithe.ly configuration or Pay in Person.

### Giving URL

The URL remains the authoritative iframe target. Validation retains the current origin and form-ID restrictions and permits Tithe.ly's safe query parameters, including `locationId`, `fundId`, `amount`, and `frequency`.

### Official button snippet

The application parses the supplied snippet but never stores or executes the pasted HTML. The parser accepts exactly one Tithe.ly button and one deferred script whose source is `https://static.tithely.com/give/give.js`.

The button may provide these official attributes:

- `class="tithely-give-button"`
- `data-form`
- `data-location`
- `data-fund`
- `data-amount`
- `data-frequency`
- `style`

Event-handler attributes, nested elements, extra scripts, unexpected document elements, and unknown attributes remain rejected. The pasted style is validated as inert input but is not persisted or replayed; the application supplies its own accessible button styling.

The parser stores only structured fallback data in `tithely_embed_config`:

- `formId`
- `locationId`, when supplied
- `fundId`, when supplied
- `amount`, when supplied
- `frequency`, when supplied

Identifiers and values are format-validated before storage. Values represented in both the URL and button configuration must match so the iframe and fallback cannot direct a registrant to different forms, locations, funds, amounts, or frequencies.

Existing form-ID-only configurations remain readable. When possible, missing optional fallback attributes are derived from the validated giving URL. Re-saving the official snippet enriches the stored fallback configuration.

## Registrant Experience

### Final registration page

The final page displays the payment-method choice when more than one method is available.

- Tithe.ly selected: the primary action reads **Submit Registration & Continue to Tithe.ly**.
- Pay in Person selected: the primary action reads **Submit Registration**.

The selected method is stored on the registration and is never rewritten by reconciliation.

### Tithe.ly payment page

Submitting with Tithe.ly creates the registration with payment status `pending`, then replaces the form content with a dedicated payment step on the same route. The page does not append the iframe below the completed form.

The existing application shell remains visible:

1. Event Registration header.
2. Event title and **Complete your payment with Tithe.ly** heading.
3. **Registration received — payment pending** notice.
4. Amount due, when configured.
5. Tithe.ly iframe using the validated giving URL.
6. Official Tithe.ly fallback button reconstructed from structured configuration.
7. Plain **Open Tithe.ly in a new tab** URL fallback.
8. Application footer.

The payment page does not ask for a Gift ID, Transaction ID, or an "I've finished" confirmation. The registration already exists and remains pending until an administrator records payment.

### Pay in Person

Pay in Person creates the pending registration and proceeds directly to the normal confirmation state. No Tithe.ly iframe, button, link, or identifier field appears.

## Administrator Reconciliation

The existing Record Payment dialog and server-authoritative ledger behavior remain intact. When the administrator selects Tithe.ly:

- The identifier label is **Transaction ID**.
- Required-field messages use **Transaction ID**.
- Duplicate-reconciliation messages use **Transaction ID**.
- No value is prepopulated from the registration.

The database continues to store this value in `registration_payments.reference_number` because that column also represents check numbers.

## Security Boundaries

- Only a validated HTTPS `give.tithe.ly` URL may be used as the iframe or plain-link target.
- Raw administrator-pasted HTML and scripts are never stored or rendered.
- The application reconstructs the fallback button from validated structured values.
- The application loads the fixed Tithe.ly `give.js` URL once when the fallback button is present.
- Reconstructed button attributes are assigned by React rather than interpolated into HTML.
- Tithe.ly payment remains unverified until an authorized administrator records it through the ledger.

## Error Handling

- Invalid or incomplete Tithe.ly configuration produces a field-level error and blocks save.
- URL/button mismatches identify the conflicting configuration instead of silently discarding Tithe.ly.
- If the iframe cannot load, the official button and plain URL remain available.
- If the Tithe.ly script cannot load, the plain URL remains available.
- The registration remains pending regardless of iframe, button, or link activity.
- Ledger validation and duplicate Transaction ID enforcement remain server-authoritative.

## Testing

### Configuration tests

- Parse the exact official Tithe.ly snippet supplied for the parking event.
- Accept official location, fund, amount, frequency, and style attributes.
- Store only structured fallback values.
- Reject event handlers, unknown attributes, unsafe script sources, nested markup, and extra elements.
- Reject mismatches between URL and button form, location, fund, amount, or frequency.
- Block saving invalid or incomplete Tithe.ly configuration even when Pay in Person is enabled.
- Keep form-ID-only stored configurations readable.

### Registrant-flow tests

- Display both choices when Tithe.ly and Pay in Person are configured.
- Use **Submit Registration & Continue to Tithe.ly** for the Tithe.ly selection.
- Create the pending registration before showing the payment step.
- Render the payment step instead of the completed form.
- Keep the iframe URL unchanged.
- Render the reconstructed fallback button and plain URL link.
- Omit Gift ID, Transaction ID, and "I've finished" controls from the registrant payment step.
- Send Pay in Person directly to confirmation without Tithe.ly content.

### Administrator tests

- Label the Tithe.ly reference field **Transaction ID**.
- Require Transaction ID for Tithe.ly ledger entries.
- Preserve the existing check-number and cash behavior.
- Preserve duplicate Transaction ID handling and entered form values after an error.

### Verification

- Run focused Tithe.ly configuration, registration-flow, and ledger-dialog tests during development.
- Run the complete Vitest suite serially.
- Run lint.
- Run the production build.
- After the Turnstile repair is separately deployed, verify the complete flow in a real browser using the official URL and button snippet.

## Rollout

This repair requires no new database column or ledger migration. After deployment, the active parking event must be re-saved with the official Tithe.ly snippet so its structured fallback configuration is populated. Production acceptance must verify both Tithe.ly and Pay in Person paths without submitting a real donation.

## Success Criteria

- The official Tithe.ly snippet is accepted without weakening the parser's script-injection boundary.
- Invalid Tithe.ly configuration cannot silently turn into a Pay in Person-only event.
- Registrants can explicitly select Tithe.ly or Pay in Person when both are enabled.
- Tithe.ly registrants advance to a dedicated payment page within the existing header and footer.
- The iframe is primary, the official Tithe.ly button is the first fallback, and the plain URL is the final fallback.
- Registrants provide no payment identifier or unverified completion assertion.
- Administrators reconcile Tithe.ly payments using a field labeled **Transaction ID**.
- Turnstile code is unchanged by this repair.

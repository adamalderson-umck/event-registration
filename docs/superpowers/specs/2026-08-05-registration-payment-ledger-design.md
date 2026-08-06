# Registration Payment Ledger Design

**Date:** 2026-08-05

**Status:** Approved

## Purpose

Replace the current one-click paid/unpaid verification with an auditable payment ledger. Administrators must be able to reconcile cash, check, and Tithe.ly payments, including multiple or mixed payments for one registration, while retaining the existing registration payment summary and parking-pass validity rule.

This is a donation-friendly model. A configured event amount is the threshold for satisfying the registration, not a cap on what may be donated. Amounts above that threshold remain simply paid and are retained in full; there is no overpaid state.

## Goals

- Record each cash, check, or Tithe.ly payment separately.
- Require an amount and payment date for every payment.
- Require a check number for check payments and a Tithe.ly transaction number for Tithe.ly payments.
- Prevent the same active Tithe.ly transaction from being reconciled twice within one organization.
- Support multiple and mixed-method payments for one registration.
- Derive pending, partial, and paid summaries from active payment records.
- Preserve uncapped donation amounts without classifying them as overpayments.
- Preserve payment history through void-and-replace corrections rather than silent edits or deletion.
- Keep registration tables, exports, and parking-pass validity compatible with a concise registration-level payment summary.
- Preserve existing paid registrations without fabricating historical amounts or reference numbers.

## Non-goals

- Tithe.ly API access, webhooks, or automatic transaction import.
- Refund processing, chargebacks, returned-check workflows, or bank-deposit batching.
- Tax receipts, donor statements, or general-ledger accounting.
- Editing or deleting payment records in place.
- Capping donations at the configured event amount.
- Changing waitlist, cancellation, or registration-capacity behavior.
- Changing the payment method originally selected by the registrant.

## Chosen Approach

Use a normalized `registration_payments` table with one row per payment. This is preferred over storing a payment array in `registrations.payment_details` because database constraints, Tithe.ly transaction uniqueness, reporting, concurrent updates, and audit history all require independently addressable records. A full accounting ledger is intentionally out of scope because the registration system does not need double-entry bookkeeping, transfers, or refund accounting.

Payment rows are the authoritative financial history. Cached registration-level fields remain projections for efficient tables, exports, and parking-pass decisions; secured database operations update the ledger and projection atomically.

## Data Model

### Registration payment records

Add `public.registration_payments` with these logical fields:

- `id uuid`: primary key.
- `org_id uuid`: owning organization.
- `registration_id uuid`: owning registration.
- `method text`: `cash`, `check`, or `tithely`.
- `amount numeric`: positive amount received.
- `payment_date date`: administrator-entered date on which the payment occurred.
- `reference_number text`: null for cash, required check number for check, and required transaction number for Tithe.ly.
- `created_at timestamptz`: automatic recording timestamp.
- `created_by uuid`: authenticated administrator who recorded the payment.
- `voided_at timestamptz`: null while active.
- `voided_by uuid`: administrator who voided the payment.
- `void_reason text`: required when voided.

The database enforces the method set, positive amount, and method-specific reference rules. Cash records do not use a reference number. Check numbers are not unique. An expression-based partial unique index enforces organization-wide uniqueness for trimmed, case-normalized Tithe.ly transaction numbers while their records are active. Voiding a mistaken record releases its transaction number so a corrected record can attach it to the proper registration.

Payment dates default to the current date in the administrator form. Administrators may backdate them, but they may not record future payment dates. `created_at` and `created_by` always reflect when and by whom the record was entered, independent of the payment date.

Registrations with payment records cannot be physically deleted because doing so would destroy the approved audit trail. Cancellation remains available and preserves the registration and its payment history.

### Registration payment projection

Add or normalize these registration-level values:

- `payment_expected_amount numeric null`: immutable snapshot of the configured event amount when the registration was created. Null means there is no required amount.
- `payment_recorded_total numeric`: cached sum of active payment records, defaulting to zero.
- `payment_status text`: `not_required`, `pending`, `partial`, or `paid`.
- `legacy_payment_paid boolean`: identifies an existing paid registration whose underlying amount and reference information were never captured.

The registration's existing `payment_method` retains a separate meaning: it is the method selected by the registrant during registration (`tithely` or `in_person`). It is not rewritten during reconciliation and does not restrict the actual method an administrator records. Actual received methods live only in payment rows.

Existing `payment_details` remains readable for historical data but is not extended with new payment arrays.

### Status derivation

For payment-disabled registrations, the status is `not_required`.

For payment-enabled, non-legacy registrations:

- No active payment total: `pending`.
- Nonzero total below a non-null expected amount: `partial`.
- Total at or above a non-null expected amount: `paid`.
- Any positive total when the expected amount is null: `paid`.

There is no `overpaid` state. The active total always retains the complete amount received, even when it exceeds the expected amount.

A legacy-paid registration remains `paid` regardless of later ledger additions or voids because the amount underlying its historical paid state is unknown. Newly recorded payments still appear in its payment history and recorded total, but the interface distinguishes the preserved legacy state from fully itemized reconciliation.

## Registration-Time Snapshot

The database, rather than the anonymous browser payload, derives `payment_expected_amount` from the event when a registration is inserted:

- Positive configured event amount: snapshot that amount.
- Missing or nonpositive event amount: store null.
- Payment disabled: store null and use `not_required`.

Later event edits affect only new registrations. They do not retroactively change existing registrations from pending to partial or paid, or vice versa.

## Administrator Workflow

### Recording a payment

Replace **Mark Paid** with **Record Payment** for every confirmed, payment-enabled registration. The action remains available after the registration reaches paid because donations are not capped and additional payments may legitimately be recorded.

The dialog displays:

- Registrant and event.
- Expected amount, when present.
- Current active-payment total.
- Remaining amount only while a non-null expected amount has not been reached.
- Method selector: Cash, Check, or Tithe.ly.
- Positive amount.
- Payment date, defaulting to today.
- Check number when Check is selected.
- Tithe.ly transaction number when Tithe.ly is selected.

The form clears irrelevant reference values when the method changes and validates conditional requirements before submission. The server repeats all validation and remains authoritative.

Confirmed registrations may receive payments regardless of the method originally selected by the registrant. Waitlisted and cancelled registrations display existing history but cannot receive new payments.

### Reviewing and correcting payments

Registration details display:

- Payment summary and expected amount.
- Original registrant-selected method.
- Active recorded total.
- Remaining amount, when applicable.
- Payment history ordered by payment date and recording timestamp.
- Method, amount, payment date, reference number, recorded timestamp, and recorder for each entry.
- Clear styling and void metadata for voided entries.

Payment rows have no edit or delete action. An administrator corrects a mistake by choosing **Void Payment**, entering a required reason, and then recording the corrected payment. Voiding does not remove or obscure the original record.

## Secure Database Operations

Provide two organization-scoped operations:

- `record_registration_payment`
- `void_registration_payment`

Both operations require an authenticated member of the registration's organization. They verify that the registration and supplied organization agree, lock the registration for the duration of the transaction, mutate the ledger, recompute the active total, derive the summary status, and return the refreshed registration and payment data atomically.

`record_registration_payment` validates:

- Confirmed, payment-enabled registration.
- Supported method.
- Positive amount.
- Valid payment date that is not in the future.
- No reference for cash.
- Nonblank check number for check.
- Nonblank, organization-unique Tithe.ly transaction number for Tithe.ly.

`void_registration_payment` validates:

- The payment belongs to the supplied organization and registration.
- The payment is currently active.
- The reason is nonblank.

Direct browser insert, update, or delete access to `registration_payments` is prohibited. Direct client mutation of registration payment projections is also prohibited; projections change only through the registration-initialization path, the secured payment operations, and the controlled migration.

The current `mark_registration_paid` operation is retired and its browser execution permission removed. This also resolves the conflicting historical implementations that either generalized Tithe.ly verification or rewrote `payment_method` to `in_person_verified`: neither behavior remains part of the active contract.

## Concurrency and Failure Behavior

Registration locking prevents simultaneous payments or voids from producing a stale total or incorrect status. The Tithe.ly unique index is the final defense against two concurrent reconciliations of the same transaction.

All ledger and projection changes occur in one database transaction. Authorization failure, invalid input, duplicate Tithe.ly transaction, stale void attempt, or status-recalculation failure leaves both the payment rows and registration projection unchanged.

The interface provides specific messages for:

- Unauthorized organization access.
- Registration not eligible to receive a payment.
- Invalid or future payment date.
- Missing or invalid amount.
- Missing check number.
- Missing Tithe.ly transaction number.
- Tithe.ly transaction already reconciled.
- Payment already voided.
- Missing void reason.

## Registration Tables and Parking Passes

Standard and parking registration tables retain their approved column order. The existing Payment column uses concise summaries such as:

- `Pending - $0.00 recorded`
- `Partially Paid - $25.00 of $50.00`
- `Paid - $65.00 recorded`
- `Legacy paid - details unavailable`

The shared payment-summary formatter and action eligibility rules keep the standard and parking views consistent.

Parking pass validity continues to use the registration-level payment status. A confirmed parking registration becomes printable when its status is `paid`, including a preserved legacy-paid registration. Pending and partial registrations remain invalid for pass printing.

## Print and CSV Reporting

The existing registration CSV retains the approved ordering contract: configured form fields, Waiver, Media, Status, Payment, Submitted. Its Payment value becomes the concise registration-level summary rather than flattening an arbitrary number of transactions into columns.

Add a separate **Payment Ledger CSV** with one row per payment and these logical values:

- Event.
- Registrant identifying fields.
- Registration ID.
- Registration payment status.
- Expected amount.
- Active recorded total.
- Payment method.
- Payment amount.
- Payment date.
- Check or Tithe.ly reference number.
- Recorded at and recorded by.
- Void state, voided at, voided by, and void reason.

The ledger export includes voided records so it can serve as an audit and reconciliation artifact. It clearly distinguishes them so consumers do not count them as active receipts.

Individual printable registration reports include the summary and ordered payment history. Existing event-wide registration printouts retain their concise Payment column; detailed financial reconciliation belongs in the ledger CSV rather than an oversized table cell.

## Historical Migration

The migration does not fabricate financial details:

- Existing `paid` registrations set `legacy_payment_paid = true`, retain `payment_status = 'paid'`, and receive no synthetic payment row or invented amount.
- Existing payment-enabled registrations that are not paid snapshot the event's current positive configured amount, or null when none exists.
- Existing payment-disabled registrations remain `not_required`.
- Existing `payment_details` and historical `payment_method` values remain unchanged and readable.
- Existing paid registrations display **Legacy paid - details unavailable**.

After the migration, every new registration receives its server-derived amount snapshot. Every newly reconciled payment uses the normalized ledger.

## Component Boundaries

### Payment summary utility

A pure utility derives display labels, remaining amounts, and payment-action eligibility from the registration projection. It contains no persistence logic and is shared by standard registrations, parking registrations, print reports, and CSV summaries.

### Record payment dialog

A focused component owns payment-entry form state and conditional validation. It receives current registration context and submits a normalized cash, check, or Tithe.ly payment request. It does not calculate or optimistically assert the resulting summary status.

### Payment history

A focused component renders active and voided payment rows and initiates void requests. It receives server-returned data and does not mutate payment objects locally as the source of truth.

### Registration viewer

`RegistrationViewer.jsx` coordinates loading refreshed payment data, opening the record and void flows, and replacing the affected registration with the operation result. `ParkingRegistrationTable.jsx` remains presentation-focused and calls the same shared actions and summary rules.

### Database boundary

Supabase RPC functions own authorization, invariants, concurrency control, ledger mutation, and projection recalculation. React components never derive persisted payment status or totals independently.

## Testing and Verification

### Database and migration tests

- New registration snapshots a positive event amount and ignores later event amount edits.
- No-amount payment-enabled registration snapshots null.
- Payment-disabled registration remains `not_required`.
- Existing paid registrations become legacy-paid without synthetic ledger rows.
- Historical methods and details remain readable.
- Authenticated organization members may record and void payments in their organization.
- Anonymous, nonmember, and cross-organization operations fail.
- Cash, check, and Tithe.ly conditional constraints are enforced server-side.
- Tithe.ly transaction uniqueness is organization-wide, case-normalized, whitespace-normalized, and limited to active records.
- The same Tithe.ly number may be reused after the erroneous record is voided.
- Concurrent payment writes produce the correct total and status.
- Concurrent duplicate Tithe.ly writes accept only one record.
- Voiding an active record recalculates total and status in the same transaction.
- Re-voiding and direct payment-row mutation fail.

### Status tests

- Zero active total is pending.
- A nonzero total below the expected amount is partial.
- A total equal to or above the expected amount is paid.
- A positive total with no expected amount is paid.
- Multiple and mixed-method payments sum correctly.
- Amounts above the expected amount remain paid and retain the full total.
- No overpaid state is produced.
- Voids remove amounts from the active total.
- Legacy-paid registrations never downgrade because their original amount is unknown.

### Component tests

- Record Payment is available for confirmed payment-enabled registrations, including already-paid registrations.
- It is unavailable for waitlisted, cancelled, or payment-disabled registrations.
- Method changes show and require the correct reference field.
- Payment date defaults to today and accepts past dates.
- Duplicate Tithe.ly and other server failures retain the entered form values and show actionable errors.
- Payment history distinguishes active and voided rows.
- Voiding requires a reason and refreshes the displayed total and status.
- Standard and parking views use the same summaries and rules.
- Parking pass printing is unavailable for pending and partial registrations and available for paid and legacy-paid registrations.

### Reporting tests

- Registration CSV preserves the approved column order and concise Payment summary.
- Payment Ledger CSV emits one escaped row per active or voided payment with all reconciliation and audit fields.
- Individual print reports show ordered payment history and escape user-controlled values.
- Event-wide printouts retain concise payment summaries.

### End-to-end verification

- Run the full Vitest suite serially.
- Run lint and the production build after tests.
- In a real browser, record cash, check, and Tithe.ly payments; create a partial payment; add a donation beyond the configured amount; reconcile a no-amount donation; reject a duplicate Tithe.ly transaction; void and replace a payment; inspect the ledger CSV; and verify parking-pass validity transitions.
- Confirm unchanged registration behavior for payment-disabled standard events.

## Success Criteria

- Administrators can reconcile cash, check, and Tithe.ly receipts with the required method-specific information.
- Multiple and mixed payments form an auditable history for one registration.
- Totals below a configured amount are partial; totals at or above it are paid; positive no-amount donations are paid.
- Donation amounts are never capped and never classified as overpaid.
- Active Tithe.ly transaction numbers cannot be reconciled twice within one organization.
- Corrections preserve the original record, void metadata, and replacement entry.
- Existing paid registrations remain paid without fabricated financial data.
- Registration tables, exports, reports, and parking passes consume one consistent summary projection.
- Direct client writes cannot bypass the ledger invariants or organization authorization.

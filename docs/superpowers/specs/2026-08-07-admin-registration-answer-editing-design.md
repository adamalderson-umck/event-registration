# Admin Registration Answer Editing Design

**Date:** 2026-08-07

## Goal

Allow a signed-in organization member who can manage registrations to correct every current registration-form answer from the admin registration detail view. The primary motivating case is replacing a temporary parking tag with the vehicle's permanent license plate.

Every successful edit must be validated against the event's current form, preserve unrelated registration state, and create an immutable field-level audit record. Saving an edit must not send an email.

## Scope

This feature edits `registrations.form_data` only. It does not provide new controls for:

- registration status;
- payment state or payment history;
- waiver decisions, signatures, or signature evidence;
- event or organization identity; or
- registrant self-service editing.

Confirmed, pending, and waitlisted registrations are editable. Cancelled registrations remain read-only historical records. The feature uses the registration-management permission already present in the admin viewer: any signed-in member of the registration's organization may use it.

## Existing System Context

`RegistrationViewer` already loads complete registration rows and displays all event fields in a detail view. Standard and parking tables, parking passes, CSV exports, and print reports all derive their displayed answers from `registration.form_data`. Updating that canonical object therefore updates every downstream representation after the registration list refreshes.

`DynamicField` already renders all supported field types. Public submissions are normalized and validated in `supabase/functions/_shared/registration-request.ts`. That server-side validation supports text, email, phone, number, date, textarea, select, radio, checkbox, and checkbox-group fields, including required and conditional-field rules.

The existing registration-update email trigger returns without sending when `status` is unchanged. A form-answer-only update therefore does not create an email notification.

## User Experience

### Entering edit mode

An **Edit Answers** action appears on the detail page for any non-cancelled registration. Choosing it creates a draft copy of the saved form answers and replaces the current field-value list with form controls.

The edit form follows the current event definition:

- section breaks retain the event's grouping;
- conditional fields appear and disappear using the same rules as the public form;
- all supported field types reuse the existing `DynamicField` controls; and
- fields deleted from the event definition appear separately as legacy read-only answers.

Legacy answers are not included in the editable control set. The server preserves them byte-for-byte when it constructs the final `form_data` object.

### Saving and cancelling

**Save Changes** validates and submits the complete set of current-field answers. While the request is pending, fields and actions are disabled. **Cancel Editing** discards the draft and restores the saved view.

If the administrator tries to cancel editing or navigate back with unsaved changes, the application asks for confirmation. Ordinary browser refresh and tab-close protection may use the browser's standard `beforeunload` warning while the edit is dirty.

When a controlling answer makes a conditional field hidden, the now-hidden current-field answer is removed on save. That removal is recorded in the audit entry. A successful save returns to read mode and displays the canonical row returned by the server.

### Edit history

A collapsed **Edit History** section appears below the registration details. Entries are newest first and show:

- editor display name, with a stable user identifier as fallback;
- edit timestamp; and
- each changed field's saved label, previous value, and new value.

The history shows only answer edits introduced by this feature. Existing status, payment, and signature histories retain their current displays and semantics.

## Validation

The server is authoritative. Client validation provides immediate field-level feedback, but a save succeeds only after the server validates the proposed current-field answers against the event definition loaded during that request.

The editing validator reuses the public registration field-normalization rules rather than maintaining a separate set. It validates:

- the event's supported field definitions and field-count limits;
- required visible values;
- email, phone, number, and date formats;
- select, radio, and checkbox-group membership in configured options;
- checkbox booleans and required checkbox consent;
- conditional visibility and removal of hidden current-field answers; and
- serialized payload and per-value size limits.

The editor sends only current-field answers. The server separates the registration's existing keys into current and legacy sets, validates and cleans the proposed current set, and combines the result with the unchanged legacy set. It never accepts client-supplied legacy values.

Event status and registration close date do not prevent correction of an existing active registration. Those constraints govern new submissions, not administrative maintenance.

## Server Boundary and Data Flow

A new authenticated `update-registration-answers` Edge Function owns the update workflow.

1. Verify the bearer token and resolve the authenticated user.
2. Parse a bounded request containing the registration ID, organization ID, expected original `form_data`, and proposed current-field answers.
3. Load the registration and event using the trusted server client.
4. Confirm that the user is a member of the organization, the registration belongs to the supplied organization and its event, and the registration is not cancelled.
5. Validate and normalize the proposed current-field answers and merge them with server-loaded legacy answers.
6. Compute field-level changes. If there are none, return the unchanged canonical registration without inserting history.
7. Call a service-role-only database function that locks the registration, checks the expected original `form_data`, rechecks its identity and active status, updates `form_data`, and inserts the audit entry in one transaction.
8. Return the updated registration and created history entry.

The database function accepts only the columns needed for this operation and cannot mutate status, payments, signatures, organization ID, or event ID. The expected original snapshot provides optimistic concurrency without requiring a registration schema change.

The client replaces the matching item in `registrations` and `selectedReg` with the returned canonical row. The existing realtime subscription remains a secondary refresh path for other open sessions.

## Audit Storage

Add a `registration_answer_edits` table with:

- `id uuid primary key`;
- `registration_id uuid not null`;
- `org_id uuid not null`;
- `event_id uuid not null`;
- `editor_user_id uuid not null`;
- `editor_display_name text not null`;
- `changes jsonb not null`; and
- `created_at timestamptz not null default now()`.

`changes` is an ordered array of objects containing `fieldId`, `fieldLabel`, `before`, and `after`. Labels are snapshotted so history remains understandable if the event field is later renamed or deleted. A removed value uses JSON `null` for `after`; a newly supplied value uses JSON `null` for `before`.

The server derives the editor identity and display-name snapshot from authenticated data; neither is accepted from the browser. The table has row-level security. Organization members may select rows belonging to their organization. Browser roles receive no insert, update, or delete permission. The transactional database function is executable only by the service role.

Audit records intentionally contain registration answers and therefore follow the same organization-scoped confidentiality expectations as the registration itself.

## Concurrency and Failure Handling

The update function locks the registration row before comparing its current `form_data` with the expected snapshot. A mismatch returns a stable conflict result and performs no update. The UI keeps the administrator's draft, explains that another change was saved, and offers to reload the latest record before retrying. It never silently overwrites newer answers.

Other stable outcomes are:

- `invalid_request`: keep edit mode open and associate returned field errors with controls where possible;
- `registration_cancelled`: discard no draft automatically, explain that the record is now read-only, and provide a return to the refreshed detail view;
- `not_authorized` or `not_found`: expose no registration data and show a generic access error; and
- `save_failed`: keep the draft intact and allow retry.

Any database error rolls back both the answer update and audit insert. A no-change submission performs neither operation. The endpoint does not invoke email delivery, and the unchanged registration status causes the existing update trigger to return without sending.

## Components

- `RegistrationViewer`: owns read/edit mode, draft state, dirty-navigation protection, server calls, canonical-row replacement, and history loading.
- A focused registration-answer editor component: renders current form fields, section breaks, conditional visibility, errors, and save/cancel actions without absorbing payment, cancellation, or history responsibilities.
- A focused edit-history component: renders immutable field-level changes and empty/loading/error states.
- Shared current-field validation utilities: expose the public submission normalizer for reuse by the admin endpoint while keeping payment and waiver validation separate.
- `update-registration-answers` Edge Function: authenticates, authorizes, validates, preserves legacy values, computes changes, invokes the atomic database operation, and maps stable errors.
- Database migration: adds audit storage, row-level read policy, grants, indexes, and the atomic service-role-only update function.

Parking and standard tables need no separate edit implementation. Both continue opening the shared detail view.

## Testing

### Shared validation tests

- Accept every supported field type with valid values.
- Reject missing required values and invalid email, phone, number, date, and configured-option values.
- Apply conditional visibility in field order.
- Remove newly hidden current-field answers.
- Preserve server-loaded answers for deleted fields without accepting client replacements for them.

### Edge Function tests

- Reject missing or invalid authentication, non-membership, identity mismatches, cancelled registrations, oversized requests, and invalid answers.
- Return a no-op without calling the mutation function when normalized answers are unchanged.
- Pass only trusted editor identity, normalized final data, expected data, and computed changes to the database function.
- Map concurrency and database failures to stable responses without leaking record data.

### Migration and security tests

- Require an organization member for audit-history reads.
- Deny browser inserts, updates, and deletes on audit rows.
- Restrict the mutation function to the service role.
- Prove the row is locked and its identity, status, and expected answers are checked before mutation.
- Prove update and audit insert occur atomically.
- Prove the function updates only `form_data` and leaves status, payment, signature, organization, and event columns unchanged.

### Component tests

- Show **Edit Answers** for confirmed, pending, and waitlisted registrations but not cancelled registrations.
- Render and edit every supported control type, section break, and conditional field.
- Show field errors without losing the draft.
- Confirm before abandoning dirty edits.
- Disable controls during save and prevent duplicate submissions.
- Replace detail values after success and show the resulting history entry.
- Preserve the draft during validation, conflict, and network failures.

### Regression and acceptance tests

- Existing cancellation and payment workflows continue to pass.
- A changed answer flows through the standard table, parking table, individual printout, table printout, sign-in sheet, CSV, and parking pass wherever that field is already represented.
- A parking registration can move from a temporary tag to a permanent license plate; the new plate appears in the detail view, parking table, audit history, pass output, and export data without sending email.

## Acceptance Criteria

The feature is complete when an authorized organization member can open any non-cancelled registration, edit all current form answers under current form rules, save once, and immediately see the canonical new values. Each material save has exactly one immutable field-level audit record. Concurrent, invalid, unauthorized, failed, and cancelled saves change neither the registration nor its history. Existing status, payment, signature, email, export, print, and parking-pass behavior remains intact except that those read surfaces reflect the corrected answers.

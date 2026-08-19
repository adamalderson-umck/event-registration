# Parking Pass Finalization Design

**Date:** 2026-08-19  
**Status:** Approved for implementation planning

## Goal

Give organization staff a reliable way to record that a physical parking pass was handed to or collected by its registrant. Call that state **Finalized**. Keep pass fulfillment separate from registration, payment, and waitlist status, and preserve an audit history when staff undo a mistaken finalization.

The same change will close the temporary parking-pass preview window automatically after the browser print flow finishes.

## Scope

This work applies only to parking events and their authenticated administration UI. It includes:

- one-at-a-time finalization and undo;
- a manual action and a prompt after printing;
- current finalization state and append-only transition history;
- actor and timestamp display;
- automatic closure of the temporary print window; and
- focused and regression testing.

It does not include bulk actions, public-registration changes, automatic email, unrelated registration-status changes, deployment, or production migration execution.

## State Model

Registration status remains one of the existing lifecycle values such as `confirmed`, `waitlisted`, or `cancelled`. Payment status also remains independent. Finalization records physical pass handoff and does not replace either status.

Add nullable current-state fields to `registrations`:

- `parking_pass_finalized_at`: the server timestamp of the current finalization;
- `parking_pass_finalized_by`: the authenticated user who finalized it; and
- `parking_pass_finalized_by_name`: a display-name snapshot for stable, convenient UI display.

All three fields are null before finalization. Finalizing populates all three atomically. Undo clears all three atomically. Historical actions remain in a separate append-only table.

Add a `parking_pass_finalization_events` table with:

- its own audit-row ID;
- organization ID;
- registration ID;
- action, constrained to `finalized` or `reopened`;
- actor user ID;
- actor display-name snapshot; and
- server-created timestamp.

The current registration fields make list and detail queries direct. The event table preserves every correction without requiring the application to reconstruct current state from history.

## Authorization and Atomic Transitions

Provide authenticated database operations for finalization and undo. Each operation must:

1. require a signed-in user;
2. verify membership in the supplied organization with the existing membership helper;
3. lock and load the target registration;
4. verify that the registration belongs to the supplied organization and a parking event;
5. validate the requested state transition;
6. read the actor's display name from the existing profile identity source;
7. update current state and append the audit event in one transaction; and
8. return the updated registration and its finalization details.

Finalization is valid only when the registration is `confirmed`, payment status is `paid`, and the pass is not already finalized. Undo is valid only when the pass is currently finalized. Repeated or stale requests return a recognizable conflict instead of silently succeeding or creating duplicate history.

Organization members may read finalization history for their organization. Browser clients may not insert, update, or delete audit rows directly. Function execution grants must follow the repository's existing authenticated-operation pattern and exclude anonymous or public execution.

## Derived Pass State

The parking pass display keeps its existing derived values:

- Valid;
- Payment pending;
- Waitlisted; and
- Invalid.

When the current finalization fields are populated, the Pass column displays **Finalized**. Registration status remains visible separately, so later cancellation does not erase or misrepresent the fact that a pass was previously handed over. Cancellation also does not delete audit events.

An unfinalized pass is eligible for printing and finalization only while its derived state is Valid. A finalized pass is not offered for reprinting until staff undo finalization and it is still otherwise Valid.

## Parking Table Actions

Replace the row's growing group of action links with one accessible **Actions** dropdown. It contains only actions valid for the selected registration:

- View;
- Record Payment;
- Print Pass;
- Finalize; or
- Undo Finalization.

Print Pass and Finalize appear only for Valid, unfinalized passes. Undo Finalization appears only for finalized passes. Other existing action eligibility rules remain unchanged.

The dropdown must support keyboard navigation, focus management, activation, Escape dismissal, and outside-click dismissal. While a finalization transition is pending, the affected controls are disabled to prevent duplicate requests.

## Print and Finalize Flow

Printing and finalizing remain separate actions:

1. Staff selects Print Pass.
2. The app opens the temporary pass preview window and waits for its images and fonts as it does today.
3. The browser print flow opens.
4. When the print flow finishes, whether by printing or cancellation, the temporary preview window closes automatically.
5. The original admin window asks, **Was this parking pass handed to the registrant?**
6. Staff selects Finalize or Not yet.

Opening or completing the print dialog never finalizes a registration automatically because the browser cannot prove physical handoff. The follow-up prompt invokes the same finalization operation as the manual dropdown action.

The print implementation must close the child window only after printing has been invoked. It must not close while assets are still loading. It should handle the browser's print-completion event and the return from the native print call defensively so supported browsers close the preview without closing it prematurely. Existing popup-blocked and print-asset failure behavior must remain actionable.

## Manual Finalize and Undo

Manual Finalize opens a confirmation dialog that identifies the registrant or vehicle and explains that Finalized means the physical pass was handed over. On success, the list and any selected detail state update immediately from the authoritative response.

Undo Finalization requires confirmation. On success, the current finalization fields clear, a `reopened` audit event is appended, and Print Pass and Finalize become available again only if the registration still meets Valid eligibility.

The registration detail view displays:

- current pass state;
- finalizing staff display name; and
- finalized date and time.

It also exposes the append-only finalization history in chronological order, including both finalization and undo actions.

## Error Handling and Concurrency

The UI must not show optimistic final success before the database operation returns. It maps known failures to actionable messages:

- the registration is no longer eligible;
- another staff member already changed the finalization state;
- the user no longer has organization access; or
- the request could not be completed because of a network or unexpected server error.

On failure, the existing displayed state remains unchanged. Realtime refresh or the next successful fetch reconciles changes made by another staff member.

## Testing and Verification

Database contract tests will cover:

- the new columns, constraints, foreign keys, and indexes;
- organization-scoped read access to audit events;
- prohibition of direct authenticated audit mutation;
- authenticated-only transition execution;
- membership, organization, registration, and parking-event validation;
- confirmed-and-paid eligibility;
- atomic current-state and audit writes;
- undo behavior; and
- stale or duplicate transition conflicts.

Utility and component tests will cover:

- Finalized taking precedence in the pass display while registration status remains separate;
- Print Pass, Finalize, and Undo eligibility;
- the Actions dropdown's conditional items and keyboard behavior;
- manual finalization and confirmed undo;
- the post-print question and Not yet path;
- synchronization between list and detail state;
- actor and timestamp rendering;
- temporary print-window closure after print completion or cancellation;
- no premature window closure during asset loading; and
- existing popup and print failure handling.

Before implementation handoff, run the focused tests, the full Vitest suite serially on Windows, migration/security contract checks, lint without new exclusions, the production build and widget-cache check, and `git diff --check`. Browser inspection, if separately authorized and performed, must use local project data rather than an authenticated production account.

## Delivery Boundaries

Implementation, PR publication, merge, deployment, and production migration remain separate authorization gates. Completing this design or its implementation plan does not authorize any of those later actions.

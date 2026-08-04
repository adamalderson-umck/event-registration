# Parking Registration Extension Design

## Purpose

Use the existing event registration system as a beta proving ground for a parking registration product. The extension must preserve the repository's tested multi-tenant, form, waiver, capacity, waitlist, payment, export, and administration substrate while adding only the parking-specific behavior needed for the beta.

Parking remains an event in the current administrator vocabulary. This design does not attempt to define how a later parking product will be integrated into the church website.

## Scope

The beta includes:

- A parking event type and creation preset
- Structured driver, address, and vehicle fields
- One vehicle and one physical pass per registration
- Parking rules implemented through the existing waiver system
- Existing capacity and optional waitlist behavior
- Payment-based pass validity
- In-person payment verification by an administrator
- A parking-focused registrations table
- Individual printing on 2.833-inch by 11-inch precut stock

The beta does not include:

- A separate Parking module or navigation hierarchy
- A generalized extension or plugin framework
- Data migration from `parking-pass-system`
- Firebase code or services from the parking prototype
- Self-service registration editing, magic-link editing, or change history
- A decision about online payment collection after waitlist promotion
- Website integration work

## Selected Approach

Parking is a typed event with a preset. This is the smallest approach that gives parking-specific features a reliable semantic boundary.

A convention-only field template was rejected because label changes or regenerated field IDs could silently break license-plate search and pass printing. A generalized extension framework was rejected because it would add infrastructure that the beta does not require.

## Architecture and Data Boundary

### Event type

Add an `event_type` column to `events` with allowed values `standard` and `parking`. It is non-null and defaults to `standard`, so existing events retain their behavior without data migration beyond the default value.

Add an `allow_in_person_payment` boolean to `events`. It is non-null and defaults to `false`, preserving the current behavior of existing events. The parking preset sets it to `true`.

The administrator chooses the type when creating an event. The UI does not permit changing an existing event's type because changing it could invalidate fields and registrations already attached to the event.

### Shared records

Parking events continue to use:

- `events` for configuration
- `registrations` for submissions and payment state
- `events.form_fields` for form structure
- `registrations.form_data` for submitted values
- `events.waivers` and `registrations.signature_records` for the parking agreement
- Existing event capacity, waitlist, notification, theme, status, and payment fields

No parking-specific registration table is added.

### Stable parking fields

The parking preset creates fields with reserved, deterministic IDs. Parking features resolve values through those IDs rather than visible labels. The fields required for administration and pass printing cannot be deleted, but administrators may change their labels, descriptions, and order.

Parking-specific behavior is divided into small boundaries:

- A parking preset constructs the initial event configuration.
- A parking field registry owns reserved field identities and value lookup.
- A pass-status helper derives whether a pass is printable.
- A parking pass document generator owns the physical print layout.
- Conditional presentation components select parking behavior only when `event_type` is `parking`.

Standard events do not call parking-specific behavior.

## Parking Event Creation and Editing

The existing New Event action offers two choices:

- Standard Event
- Parking Registration

Choosing Parking Registration opens the existing event editor with parking defaults applied. The administrator still configures the event title, slug, description, term dates, registration close date, capacity, optional waitlist, payment amount, notifications, header image, theme, status, fields, and waivers through the existing editor.

The preset enables payments and enables an `Allow payment in person` option by default. The option is implemented as a general event payment capability rather than a parking-only payment provider rule. In this beta, publishing a parking event requires payments to remain enabled with a positive amount because a pass is valid only after payment is recorded.

Parking event cards display a small Parking badge. Duplicating a parking event preserves its type, field structure, waiver, and configuration while resetting registration and waitlist counts in the same manner as standard event duplication.

Publishing is blocked if a required protected parking field is missing or malformed. The editor identifies each field that must be repaired.

## Parking Preset

The preset includes the existing protected first name, last name, and email fields, plus:

- Required phone number
- Required local street address, city, state, and ZIP code
- Optional permanent street address, city, state, and ZIP code
- Vehicle year
- Required vehicle make
- Required vehicle model
- Required vehicle color
- Required license plate
- Required vehicle registration state
- Required vehicle registration county
- Required insurance provider

The preset also creates one required Parking Rules and Agreement waiver. Its initial content is derived from the current parking prototype's rules. Administrators edit it through the existing waiver editor. The existing waiver content hash, signature record, and signer metadata remain authoritative; no second rules or agreement subsystem is introduced.

## Public Registration Flow

A parking event uses the existing public URL, form renderer, validation, CAPTCHA, signature, capacity, waitlist, and theme behavior.

The flow is:

1. The registrant enters contact, address, and vehicle information.
2. The registrant reviews and signs the parking waiver.
3. Submission creates one registration and returns its database-authoritative registration ID and status.
4. A waitlisted registration is not charged and proceeds to a waitlist confirmation.
5. A confirmed registration chooses online payment or payment in person.
6. Successful online capture records `paid`; payment in person records a pending payment method until an administrator marks it paid.
7. The confirmation screen shows Pass valid, Payment pending, or Waitlisted as appropriate.

Parking confirmations omit event calendar links because the configured dates describe a parking term rather than an appointment.

If online payment fails or is abandoned, the confirmed registration remains recorded with pending payment and no valid pass. The registrant may retry during the active session. This design does not introduce a persistent self-service payment link.

When the waitlist promotes a parking registration, payment remains pending and the pass remains invalid. The forthcoming payment redesign will decide how promoted registrants complete online payment. Administrators may record an externally completed payment in the meantime.

## Pass Validity

Pass status is derived and is not stored as an independently editable field.

| Registration status | Payment status | Pass status |
| --- | --- | --- |
| `confirmed` | `paid` | Valid |
| `confirmed` | `pending` | Payment pending |
| `waitlisted` | any | Waitlisted |
| `cancelled` | any | Invalid |
| any other combination | any | Invalid |

Online payment may move a confirmed registration to Valid immediately. An in-person payment becomes Valid only after an administrator records it as paid. Only Valid registrations expose the print action.

## Administrator Registration Experience

Standard events retain the existing registrations table. Parking events use a focused table with these columns:

- Registrant
- Email
- License plate
- Vehicle
- Registration status
- Payment status
- Pass status
- Actions

Existing search continues to search all configured form fields, including the license plate. The registration detail view continues to show the complete form response and signed waiver.

Parking actions are:

- View the complete registration
- Mark a pending in-person payment as paid
- Print a valid parking pass

Failed payment-status updates leave the previous value in place and display an error. Waitlisted, cancelled, and unpaid registrations explain why pass printing is unavailable.

CSV export and registration printouts retain all configured parking fields and the existing waiver, media, registration status, payment status, and submission columns. Parking-specific table presentation does not change the underlying export contract.

## Physical Parking Pass

The Print Pass action generates one pass for the selected registration. It targets one piece of precut stock measuring exactly 2.833 inches wide by 11 inches long. It does not arrange multiple passes on letter paper.

Print CSS sets the physical page size explicitly:

```css
@page {
  size: 2.833in 11in;
}
```

The narrow portrait layout contains:

- Organization name
- Parking event or term title
- A large license plate
- Vehicle year when provided, plus make, model, and color
- A prominent VALID PARKING PASS label
- Term start and end dates
- A short registration reference
- Display instructions

The pass excludes the registrant's address, phone number, email address, insurance provider, payment details, and signature. The browser print preview remains available so staff can verify orientation and scaling before printing.

The document generator HTML-escapes all event and registration values. Opening or printing the pass never mutates registration or payment state.

## Failure Handling

- The database rejects unknown event types.
- Existing events default to Standard and continue through their current code paths.
- Missing protected parking fields block publishing instead of allowing partially working parking features.
- Submission uses the status returned by the database rather than deriving capacity state from a potentially stale client count.
- A failed registration submission creates neither a payment attempt nor a pass.
- A failed or abandoned payment leaves a recoverable payment-pending registration.
- A failed administrator payment update preserves the prior state.
- Printer errors and blocked print windows do not alter application data.
- Malformed or missing required parking form values make the pass unavailable and identify the missing value.
- Payment-provider details stay behind the existing payment boundary so the planned payment redesign can replace them without changing parking validity rules.

## Verification Strategy

### Database and domain tests

- Migration adds the constrained event type and defaults existing events to Standard.
- Standard events remain readable and writable.
- Pass-state derivation covers confirmed, waitlisted, cancelled, paid, and pending combinations.
- Database-returned capacity and waitlist status drives the public result.

### Unit tests

- Parking preset produces deterministic, unique protected field IDs.
- Parking field lookup is independent of visible labels and ordering.
- Parking preset contains exactly one required parking waiver.
- Pass HTML escapes untrusted values.
- Pass output contains required public vehicle information and excludes private registrant information.
- Print CSS specifies `2.833in 11in`.

### Component tests

- New Event offers Standard and Parking choices.
- Parking selection seeds the expected editor values.
- Standard editor behavior is unchanged.
- Required parking fields cannot be deleted.
- Parking registration table uses the approved focused columns.
- Payment-pending and invalid records cannot print a pass.
- Marking an in-person payment paid enables pass printing for a confirmed registration.
- Parking confirmation omits calendar actions and displays the correct pass state.

### Integration and regression tests

- Create, duplicate, edit, publish, and register for a parking event.
- Exercise confirmed and waitlisted submissions with payments enabled.
- Verify existing cancellation and waitlist promotion behavior.
- Verify parking CSV and print-report parity.
- Run the repository's existing lint, unit, component, and production build checks.

### Physical verification

Complete one end-to-end registration through payment verification and print its pass on the actual 2.833-inch by 11-inch precut stock. Confirm page size, orientation, scaling, legibility, and printer-feed behavior before considering the beta ready for operational use.

## Delivery Boundary

This specification defines one cohesive beta: create and manage a typed parking event, accept one-vehicle registrations under the existing waiver/capacity/waitlist substrate, derive validity from payment, and print one physical pass. Payment-system redesign, website integration, self-service editing, audit history, and a generalized extension framework require separate designs.

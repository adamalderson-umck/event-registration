# Registration Waiver and Media Status Design

## Goal

Show each registrant's required-waiver status and media-release decision in both the admin registrations table and the full registration table printout.

## Scope

- Add two derived columns: `Waiver` and `Media`.
- Use the registration and event data already fetched by the admin view.
- Keep the on-screen and printed labels consistent through one shared utility.
- Do not change the Supabase schema, registration query, registration form, CSV export, sign-in sheet, summary report, or individual registration printout.

## Existing Data Flow

`RegistrationViewer` fetches complete registration rows from Supabase with `select('*')`. Event form definitions in `event.form_fields` provide the ordinary table columns, and each value comes from `registration.form_data[field.id]`. Registration `Status` is already rendered as a separate derived column from `registration.status`.

Waiver outcomes are stored separately in `registration.signature_records`. Each record identifies its event waiver with `waiverId` and records either a signed decision or an explicit decline.

## Derived Status Rules

A shared utility will accept a registration and the event waiver definitions and return:

```js
{
  waiverStatus: 'Signed' | 'Missing',
  mediaDecision: 'Approved' | 'Declined' | 'Missing',
}
```

### Waiver

1. Select every event waiver whose `required` value is not explicitly `false`.
2. Match each definition to a signature record by `waiverId`.
3. Return `Signed` only when at least one required waiver exists and every required waiver has a matching record with `signed === true` and is not declined.
4. Return `Missing` when a required waiver is absent, unsigned, declined, or when the event has no required-waiver definition.

This aggregates multiple required waivers safely while producing the single requested table value.

### Media

1. Identify the beta event's optional `Media Release` waiver from the event definitions by its title, case-insensitively.
2. Match its signature record by `waiverId`.
3. Return `Approved` when the record has `signed === true` and is not declined.
4. Return `Declined` when the record has `declined === true`.
5. Return `Missing` when the definition or matching decision record is absent or incomplete.

Older and imported registrations without matching `signature_records` therefore display `Missing` rather than implying consent.

## Admin Table

Retain the existing first five form-field columns. Add the two new data columns in this order:

1. Existing form-field columns
2. `Waiver`
3. `Media`
4. `Status`
5. `Actions`

The new values use compact text styling consistent with other table cells. `Actions` remains the final administrative control column.

## Full Table Printout

Retain every non-section form-field column. Add the derived columns after the form fields in this order:

1. Existing form-field columns
2. `Waiver`
3. `Media`
4. `Status`

The print report uses the same shared utility as the admin table, preventing the two outputs from drifting.

## Error and Compatibility Behavior

- Missing or malformed `signature_records` are treated as an empty list.
- Missing or malformed event waiver definitions produce `Missing` values.
- Unknown record shapes do not throw during table rendering or print generation.
- No consent is inferred from registration status, legacy form fields, or the absence of a decline.

## Testing

Implementation will follow test-driven development.

Unit tests for the shared utility will cover:

- all required waivers signed;
- one required waiver missing;
- Media Release approved;
- Media Release declined;
- media decision missing;
- missing or malformed arrays;
- unrelated optional waivers not affecting the required-waiver result.

Print-report tests will verify that `Waiver`, `Media`, and `Status` appear in the approved order and that each row contains the derived labels. A component test will verify the same column order and values in the admin registrations table.

## Acceptance Criteria

- Every beta-event row in the admin registrations table shows `Waiver` and `Media` values.
- The full registration table printout shows the same values for the same filtered registrations.
- Labels are exactly `Signed` or `Missing` for Waiver and `Approved`, `Declined`, or `Missing` for Media.
- Admin order is form fields, Waiver, Media, Status, Actions.
- Print order is form fields, Waiver, Media, Status.
- Existing filtering and print selection behavior remains unchanged.

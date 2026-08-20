# Parking License Plate Validation Design

**Date:** 2026-08-19
**Status:** Approved 2026-08-20

## Goal

Require parking registrants to provide a plausibly formatted U.S. license plate instead of satisfying the required field with an obvious placeholder. The validation is intentionally a plausibility check, not proof that a plate exists or belongs to the registrant.

The system must continue to accept a vehicle whose permanent plate is not yet available by accepting the exact normalized value `TEMP`.

## Existing Context

Parking events use the protected field ID `parking_license_plate`. The field is currently a required generic text field. Initial registration and later administrative answer editing both enforce generic text validation, so any nonblank string currently satisfies the requirement.

Canonical answers are stored in `registrations.form_data`. The parking administration table, pass output, reports, exports, and email content read the plate from that canonical object. Normalizing the value before it enters that object therefore gives every downstream surface one consistent representation.

The application already has submission-level abuse controls. This change does not replace or expand those controls; it only closes the easiest placeholder-value escape from the required plate field.

## Validation Contract

### Normalization

For `parking_license_plate` only, both the browser and server normalize a submitted string in this order:

1. Trim leading and trailing whitespace.
2. Convert letters to uppercase.
3. Remove all remaining whitespace and ASCII hyphens.

Examples:

| Submitted value | Normalized value |
| --- | --- |
| ` abc 123 ` | `ABC123` |
| `abc-123` | `ABC123` |
| `t-e-m-p` | `TEMP` |

The normalized value is the value stored in `registrations.form_data`. Administrative edits use the same normalization before calculating and recording a changed answer.

### Accepted values

The normalized value is accepted when either condition is true:

- It is exactly `TEMP`.
- It contains 3 through 8 ASCII characters, every character is `A` through `Z` or `0` through `9`, and it does not match a suspicious pattern below.

One- and two-character values are intentionally rejected. This may exclude rare short vanity plates, but it prevents a single random keystroke from satisfying the required field.

### Suspicious patterns

After normalization, reject all of the following:

1. **One repeated character:** the entire value is the same letter or digit repeated at least three times, such as `XXX`, `AAAAAA`, or `111111`.
2. **Known placeholders:** the entire value is one of `TEST`, `TESTING`, `NONE`, `UNKNOWN`, `NOPLATE`, `NIL`, `NULL`, `PLATE`, or `LICENSE`. Values shorter than three characters, including `NA`, already fail the length rule.
3. **Sequential letters or digits:** the entire value is a forward or reverse consecutive run of at least three letters or digits, such as `ABC`, `ABCDEF`, `FEDCBA`, `123`, `123456`, or `654321`.
4. **Keyboard-row runs:** the entire value is a forward or reverse contiguous run of at least three characters from `QWERTYUIOP`, `ASDFGHJKL`, or `ZXCVBNM`, such as `QWE`, `QWERTY`, `ASDFGH`, `HGFDSA`, `ZXCVBN`, or `NBVCXZ`.

The detector remains deliberately small and explainable. It does not use entropy scores, probabilistic classification, government data, or a continually growing list of imagined fake values. A plausible invented value such as `KDM482` remains valid.

## User Experience

The public registration form normalizes the value on blur and again before final validation. Removing a space or hyphen is not presented as an error. If the normalized value is invalid, the field receives this inline error:

> Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.

The administrative answer editor behaves the same way. Existing stored values remain readable even if they would fail the new rule, but an administrator must provide a valid current value when saving an edit to the plate field.

## Architecture and Data Flow

Plate semantics are attached to the stable field ID `parking_license_plate`; this does not introduce a new general-purpose form-field type.

The browser uses a focused pure plate-normalization and validation helper from both:

- the public registration form; and
- the administrative registration-answer editor.

The registration Edge Function applies the authoritative equivalent rule while normalizing current form data. The administrative answer-edit Edge Function reaches the same rule through its existing use of current-form-data normalization. A request rejected by the server does not create or modify a registration.

Client and server implementations use a shared table of test vectors so their observable contract cannot drift even though they execute in different runtimes.

## Error Handling

- Missing values continue to use the existing required-field error.
- Structurally invalid or suspicious values use the plate-specific error.
- A server rejection remains an invalid registration request and does not reveal internal matching details.
- Normalization is idempotent: normalizing an already normalized value produces the same value.
- Plate validation does not change the registration-state requirement or any payment, waiver, CAPTCHA, duplicate-warning, or pass-finalization behavior.

## Test Coverage

Table-driven unit tests cover the shared contract, including:

- accepted ordinary plates containing letters, digits, only letters, or only digits;
- accepted `TEMP` in different input casing and with removable separators;
- normalization of lowercase input, whitespace, and hyphens;
- rejection below 3 and above 8 characters;
- rejection of punctuation and non-ASCII characters;
- every placeholder category and its reverse-pattern cases;
- values close to suspicious patterns that must remain valid, such as `ABC1`, `QWE7`, `AAB111`, and `KDM482`;
- normalization idempotence;
- identical public-registration and administrative-edit behavior;
- server rejection even when browser validation is bypassed; and
- storage, audit history, parking table, pass, report, and export consumption of the normalized canonical value.

Existing standard-event text fields must remain unchanged.

## Out of Scope

- Government or commercial plate-database lookup
- Proof of vehicle ownership
- State-by-state plate-format rules
- International plates
- Changes to CAPTCHA, rate limits, email verification, payment, or other anti-fraud controls
- Retrospective rewriting of existing registration records

## Completion Criteria

The feature is complete when every new or administratively edited parking plate is stored in normalized uppercase alphanumeric form, except for the supported `TEMP` sentinel; obvious placeholders and low-effort repeated, sequential, or keyboard-run values are rejected consistently by the browser and server; bypassing browser validation cannot persist an invalid value; and standard registrations and existing parking records remain unaffected.

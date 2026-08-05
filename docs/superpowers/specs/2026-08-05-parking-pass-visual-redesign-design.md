# Parking Pass Visual Redesign

## Purpose

Redesign the printable parking pass so it is substantially more polished, easier to identify from outside a vehicle, and visibly connected to the United Methodist Church of Kent. Preserve the existing parking workflow, pass eligibility rules, existing public information, Letter-sheet geometry, and one-pass-per-print behavior while adding one approved static parking-area advisory.

## Approved Direction

Use the approved **Monument** concept: a restrained identity header, a plate-first center, a parking-area advisory band, and a compact term/reference footer. The pass uses Source Sans 3 throughout and includes the supplied `UMC_of_Kent_logo.svg` as both a solid header mark and an oversized cropped watermark.

The license plate is the dominant element. `VALID PARKING PASS` is the next strongest signal. Church and event identity, vehicle description, term dates, reference, and display instructions remain clearly legible but subordinate.

The printout is grayscale only. The design must therefore create hierarchy through scale, weight, spacing, rules, black fills, and opacity rather than color.

## Physical Print Contract

The physical geometry does not change:

- The browser print sheet remains US Letter in portrait orientation: `8.5in × 11in`.
- The pass remains anchored to the top of the sheet.
- The pass footprint remains `8.5in × 3.66in`.
- The middle and bottom thirds of the sheet remain blank.
- Page margins remain zero.

The artwork inside the existing pass footprint rotates 90 degrees clockwise. Treat the design as an upright logical canvas measuring `3.66in × 8.5in`, then rotate that canvas clockwise into the unchanged `8.5in × 3.66in` footprint. When the printed strip is turned counterclockwise for upright viewing, the original left edge of the Letter sheet becomes the physical bottom of the pass.

The pass footprint is a clipping viewport. It uses `overflow: hidden`; no scrollbar or content outside the physical border may appear in browser print preview, generated PDF output, or the printed result.

## Information and Hierarchy

The redesign contains the current pass information plus one approved static advisory:

1. Organization name
2. Parking event or term title
3. `VALID PARKING PASS`
4. License plate
5. Vehicle year when available, color, make, and model
6. `Parking permitted in designated areas only.`
7. Term start and end dates
8. Short registration reference
9. `Display this pass clearly in your vehicle.`

The pass continues to exclude the registrant's name, address, phone number, email address, insurance provider, payment details, and signature.

The upright hierarchy is:

- A compact header pairs the solid church-tree logo with the organization name and event title.
- A black `VALID PARKING PASS` label introduces the central identification area.
- The license plate uses the largest and heaviest type on the pass.
- A short heavy rule separates the license plate from the vehicle description.
- `Parking permitted in designated areas only.` appears in a centered light-gray band with strong top and bottom rules. It is more prominent than footer metadata but subordinate to the plate and validity label.
- The term and reference share a two-column footer.
- The display instruction sits centered below the footer.

## Typography

Use Source Sans 3 exclusively, with Arial or a generic sans-serif only as an emergency fallback while the font is unavailable.

Use these roles and weights:

- License plate: Source Sans 3, weight 900
- `VALID PARKING PASS`: weight 900 with restrained tracking
- Event title and parking-area advisory: weight 800
- Organization name, vehicle description, metadata labels, and metadata values: weight 700
- Display instruction: weight 600

Self-host the required Source Sans 3 webfont assets with the application rather than depending on a third-party font request at print time. The print action must wait for `document.fonts.ready` before invoking the print dialog so the preview and physical output do not fall back after a fixed timing delay.

## Logo Treatment

Use the supplied `UMC_of_Kent_logo.svg` instead of the earlier Illustrator file. Copy it into the repository as a dedicated parking-pass asset while preserving its vector paths and proportions.

The logo appears twice:

- Header mark: solid black, square, fully visible, and aligned with the organization/event identity.
- Watermark: the same SVG, converted to black through presentation styling, centered behind the main identification area at approximately `4.5%` opacity.

The watermark is intentionally oversized to approximately `1.8×` the upright pass width. Its left and right sides extend beyond the logical pass edges and are clipped by the pass viewport. This cropped scale is part of the approved design. The watermark must not reduce the contrast or readability of the license plate, status label, rule, or vehicle description.

The SVG is decorative in its watermark use and must not be exposed twice to assistive technology. The header mark receives a concise accessible description in the browser document; the watermark uses empty alternative text or equivalent decorative treatment.

## Implementation Boundaries

Keep the redesign inside the focused parking-pass document generator and its assets. Do not change:

- Pass validity rules
- Registration or payment state
- Parking field lookup
- The public registration flow
- Administrator actions
- CSV or full-registration print reports
- The physical sheet or pass dimensions

Continue HTML-escaping all event and registration values. Static logo markup and font assets must not weaken that boundary.

The print window remains non-mutating. Blocked popups, font failures, image failures, print cancellation, and printer errors must not alter application data.

## Failure Handling

- If the pass is not valid, do not open a print window.
- If required vehicle values are missing, retain the current explicit error.
- If the print window is blocked, retain the current popup guidance.
- If Source Sans 3 cannot load, allow the declared fallback font rather than blocking printing indefinitely.
- If the logo fails to render, the text hierarchy must remain complete and usable.
- Font readiness must use a bounded fallback so an unexpected font-loading failure cannot leave the print action hanging forever.

## Verification Strategy

### Unit tests

- The pass retains every approved public value and excludes private registration values.
- The pass contains the exact static text `Parking permitted in designated areas only.` between the vehicle block and term/reference footer.
- The page remains Letter portrait with zero margins.
- The pass remains `8.5in × 3.66in` and anchored to the top of the page.
- The inner logical canvas is `3.66in × 8.5in` and rotates 90 degrees clockwise.
- The pass viewport clips overflow and emits no scrollable print container.
- Source Sans 3 is declared with the approved weight roles.
- The supplied SVG appears once as the visible header mark and once as a decorative watermark.
- The watermark uses the approved oversized scale and low opacity.
- Untrusted event and registration values remain HTML-escaped.
- Invalid or incomplete registrations remain non-printable.

### Browser and PDF verification

Render representative short and long values in a real browser. Confirm:

- Source Sans 3 is loaded before print is invoked.
- The license plate remains the dominant element.
- The watermark crops at the pass border without a scrollbar.
- The header logo remains crisp.
- No text overlaps the watermark, logo, border, or neighboring text.
- Browser print preview shows one rotated pass in the top third of a portrait Letter sheet and two blank thirds below it.
- A saved print-to-PDF result has the same orientation, clipping, and grayscale hierarchy.

### Regression and physical verification

- Run the focused parking-pass tests.
- Run the full Vitest suite serially, then lint and build.
- Print one real pass at 100% scale on Letter paper.
- Confirm the footprint remains `8.5in × 3.66in`, the left sheet edge becomes the pass bottom when viewed upright, no scrollbar or clipping artifact prints, the watermark is visible but subordinate, and the plate is readable from outside a vehicle.

## Delivery Boundary

This change is a visual and print-readiness redesign of the existing parking pass. It does not introduce new pass data, new registration behavior, new payment behavior, alternate pass sizes, color output, QR codes, barcodes, or a general print-template system.

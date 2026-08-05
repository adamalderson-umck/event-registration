# Parking Pass Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-column parking pass with the approved rotated Monument design, Source Sans 3 typography, church logo and oversized watermark, parking-area advisory, and asset-aware print timing while preserving all existing pass data and physical geometry.

**Architecture:** Keep the feature inside `src/utils/parkingPass.js` and its focused test file. Vite imports the church SVG and the self-hosted Fontsource WOFF2 asset as URLs; `buildParkingPassHtml` accepts injectable asset URLs for deterministic tests and defaults to those production assets. The print function writes the document synchronously, then waits for fonts and images with a 1.5-second bound before opening the print dialog.

**Tech Stack:** React/Vite asset imports, JavaScript template HTML/CSS, Vitest/jsdom, `@fontsource-variable/source-sans-3` 5.3.0, browser print CSS

---

## File Structure

- Create `src/assets/parking-pass/UMC_of_Kent_logo.svg`: repository-owned copy of the user-approved vector logo; no runtime dependency on Google Drive.
- Modify `package.json`: add the pinned self-hosted Source Sans 3 variable-font package.
- Modify `package-lock.json`: lock the exact Fontsource package and integrity metadata.
- Modify `src/utils/parkingPass.js`: own imported asset URLs, approved HTML/CSS, 90-degree layout transform, clipping, and bounded print-asset readiness.
- Modify `src/utils/__tests__/parkingPass.test.js`: verify the public/private data boundary, exact visual contract, asset usage, ordering, and print timing.
- Reference only `docs/superpowers/specs/2026-08-05-parking-pass-visual-redesign-design.md`: do not modify it during implementation.

### Task 1: Add the Approved Logo and Self-Hosted Font Dependency

**Files:**
- Create: `src/assets/parking-pass/UMC_of_Kent_logo.svg`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm the supplied SVG is the approved source file**

Run:

```powershell
Get-Item -LiteralPath 'J:\My Drive\Google Drive\Church\Logo Refresh Project\Illustrator files\UMC_of_Kent_logo.svg' | Select-Object FullName, Length, LastWriteTime
Select-String -LiteralPath 'J:\My Drive\Google Drive\Church\Logo Refresh Project\Illustrator files\UMC_of_Kent_logo.svg' -Pattern 'viewBox="0 0 1600 1600"', '#34583d'
```

Expected: the file exists, has a `1600 × 1600` view box, and contains the approved `#34583d` vector fill.

- [ ] **Step 2: Copy the approved vector into the focused asset directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'src\assets\parking-pass' | Out-Null
Copy-Item -LiteralPath 'J:\My Drive\Google Drive\Church\Logo Refresh Project\Illustrator files\UMC_of_Kent_logo.svg' -Destination 'src\assets\parking-pass\UMC_of_Kent_logo.svg'
```

Expected: `src/assets/parking-pass/UMC_of_Kent_logo.svg` is byte-for-byte identical to the supplied file.

Verify:

```powershell
Get-FileHash -Algorithm SHA256 'J:\My Drive\Google Drive\Church\Logo Refresh Project\Illustrator files\UMC_of_Kent_logo.svg', 'src\assets\parking-pass\UMC_of_Kent_logo.svg'
```

Expected: both SHA-256 values match.

- [ ] **Step 3: Install the pinned Source Sans 3 variable-font package**

Run:

```powershell
npm install @fontsource-variable/source-sans-3@5.3.0
```

Expected: `package.json` and `package-lock.json` add `@fontsource-variable/source-sans-3` at `^5.3.0`; npm may repeat the repository's existing audit findings, but it must exit 0.

- [ ] **Step 4: Verify the exact local WOFF2 asset that the pass will import**

Run:

```powershell
Get-Item 'node_modules\@fontsource-variable\source-sans-3\files\source-sans-3-latin-wght-normal.woff2' | Select-Object FullName, Length
```

Expected: the Latin normal variable-weight WOFF2 exists and is non-empty.

- [ ] **Step 5: Commit the focused brand assets**

Run:

```powershell
git add -- package.json package-lock.json src/assets/parking-pass/UMC_of_Kent_logo.svg
git diff --cached --check
git commit -m "chore: add parking pass brand assets"
```

Expected: one commit containing only the logo and Fontsource dependency changes.

### Task 2: Implement the Approved Rotated Monument Document

**Files:**
- Modify: `src/utils/__tests__/parkingPass.test.js:33-56`
- Modify: `src/utils/parkingPass.js:1-77`

- [ ] **Step 1: Replace the document-contract tests with precise failing assertions**

In `src/utils/__tests__/parkingPass.test.js`, add the fixed asset fixture below the `event` fixture:

```js
const assets = {
    logoUrl: '/assets/UMC_of_Kent_logo.svg',
    fontUrl: '/assets/source-sans-3-latin-wght-normal.woff2',
};
```

Replace the first two tests with:

```js
it('builds the approved pass content while excluding private registration values', () => {
    const html = buildParkingPassHtml(
        registration(),
        event,
        { name: 'Kent Methodist Church' },
        assets,
    );

    expect(html).toContain('Kent Methodist Church');
    expect(html).toContain('Fall 2026 Parking');
    expect(html).toContain('&lt;ABC&amp;123&gt;');
    expect(html).toContain('2024 Blue Honda Civic');
    expect(html).toContain('VALID PARKING PASS');
    expect(html).toContain('Parking permitted in designated areas only.');
    expect(html).toContain('abc12345');
    expect(html).toContain('Aug 15, 2026 - Dec 15, 2026');
    expect(html).toContain('Display this pass clearly in your vehicle.');

    expect(html.indexOf('class="vehicle"')).toBeLessThan(html.indexOf('class="advisory"'));
    expect(html.indexOf('class="advisory"')).toBeLessThan(html.indexOf('class="pass-footer"'));

    expect(html).not.toContain('driver@example.com');
    expect(html).not.toContain('123 Private Drive');
    expect(html).not.toContain('Private Insurance Co.');
});

it('keeps the sheet geometry while rotating and clipping the upright design', () => {
    const html = buildParkingPassHtml(registration(), event, 'Kent Methodist Church', assets);

    expect(html).toContain('@page { size: letter portrait; margin: 0; }');
    expect(html).toContain('html, body { width: 8.5in; height: 11in; margin: 0; overflow: hidden; }');
    expect(html).toContain('.pass { position: relative; width: 8.5in; height: 3.66in; overflow: hidden; }');
    expect(html).toContain('width: 3.66in;');
    expect(html).toContain('height: 8.5in;');
    expect(html).toContain('transform: translateX(8.5in) rotate(90deg);');
    expect(html).toContain('transform-origin: top left;');
    expect(html).not.toContain('overflow: auto');
    expect(html).not.toContain('overflow: scroll');
});

it('uses Source Sans 3 at the approved weights', () => {
    const html = buildParkingPassHtml(registration(), event, 'Kent Methodist Church', assets);

    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Source Sans 3'");
    expect(html).toContain('font-weight: 200 900;');
    expect(html).toContain('url("/assets/source-sans-3-latin-wght-normal.woff2")');
    expect(html).toContain('.plate { font-size: 42pt; line-height: .95; font-weight: 900;');
    expect(html).toContain('.valid { align-self: center;');
    expect(html).toContain('font-weight: 900;');
    expect(html).toContain('.event, .advisory { font-weight: 800; }');
    expect(html).toContain('.direction { margin-top: .12in; text-align: center; font-size: 8pt; line-height: 1.25; font-weight: 600; }');
});

it('renders the approved logo as a header mark and oversized decorative watermark', () => {
    const html = buildParkingPassHtml(registration(), event, 'Kent Methodist Church', assets);

    expect(html.match(/src="\/assets\/UMC_of_Kent_logo\.svg"/g)).toHaveLength(2);
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain('alt="Kent Methodist Church logo"');
    expect(html).toContain('class="watermark" src="/assets/UMC_of_Kent_logo.svg" alt="" aria-hidden="true"');
    expect(html).toContain('width: 6.6in;');
    expect(html).toContain('height: 6.6in;');
    expect(html).toContain('opacity: .045;');
});
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: FAIL because the current generator has no fourth `assets` parameter, Source Sans 3 declaration, rotated logical canvas, logo markup, watermark, or advisory.

- [ ] **Step 3: Add the production asset imports and defaults**

At the top of `src/utils/parkingPass.js`, above the existing `PARKING_FIELD_IDS` import, add:

```js
import sourceSans3Url from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import umcKentLogoUrl from '../assets/parking-pass/UMC_of_Kent_logo.svg?url';
```

Below the imports, add:

```js
const DEFAULT_PARKING_PASS_ASSETS = Object.freeze({
    logoUrl: umcKentLogoUrl,
    fontUrl: sourceSans3Url,
});
```

- [ ] **Step 4: Replace `buildParkingPassHtml` with the approved document implementation**

Keep `escapeHtml`, `formatDate`, and `getOrganizationName` unchanged. Replace `buildParkingPassHtml` with:

```js
export function buildParkingPassHtml(
    registration,
    event,
    organization,
    assets = DEFAULT_PARKING_PASS_ASSETS,
) {
    if (!canPrintParkingPass(registration)) {
        throw new Error('Only valid parking registrations can be printed.');
    }

    const licensePlate = getParkingFieldValue(registration, PARKING_FIELD_IDS.LICENSE_PLATE);
    const vehicle = getParkingVehicleLabel(registration);
    if (!licensePlate || !vehicle) {
        throw new Error('Required parking pass values are missing.');
    }

    const eventTitle = escapeHtml(event?.title);
    const organizationName = escapeHtml(getOrganizationName(organization));
    const registrationId = escapeHtml(String(registration?.id ?? '').slice(0, 8));
    const dates = `${formatDate(event?.start_date)} - ${formatDate(event?.end_date)}`;
    const logoUrl = escapeHtml(assets.logoUrl);
    const fontUrl = escapeHtml(assets.fontUrl);

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${eventTitle} Parking Pass</title>
<style>
@page { size: letter portrait; margin: 0; }
@font-face { font-family: 'Source Sans 3'; src: url("${fontUrl}") format("woff2"); font-style: normal; font-weight: 200 900; font-display: swap; }
html, body { width: 8.5in; height: 11in; margin: 0; overflow: hidden; }
body { box-sizing: border-box; font-family: 'Source Sans 3', Arial, sans-serif; color: #111; }
* { box-sizing: border-box; }
.pass { position: relative; width: 8.5in; height: 3.66in; overflow: hidden; }
.pass-artwork { position: absolute; top: 0; left: 0; width: 3.66in; height: 8.5in; overflow: hidden; transform: translateX(8.5in) rotate(90deg); transform-origin: top left; border: 2px solid #111; padding: .18in; display: flex; flex-direction: column; background: #fff; }
.brand { position: relative; z-index: 2; display: grid; grid-template-columns: .58in 1fr; gap: .12in; align-items: center; padding-bottom: .14in; border-bottom: 1px solid #999; background: rgba(255, 255, 255, .92); }
.brand-logo { display: block; width: .54in; height: .54in; filter: grayscale(1) brightness(0); }
.organization { font-size: 10pt; line-height: 1.05; font-weight: 700; }
.event { margin-top: .05in; font-size: 13pt; line-height: 1.05; }
.event, .advisory { font-weight: 800; }
.main { position: relative; z-index: 1; isolation: isolate; flex: 1; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.watermark { position: absolute; z-index: -1; width: 6.6in; height: 6.6in; max-width: none; left: 50%; top: 52%; transform: translate(-50%, -50%); filter: grayscale(1) brightness(0); opacity: .045; }
.valid { align-self: center; margin-bottom: .28in; padding: .08in .12in; background: #111; color: #fff; font-size: 13pt; line-height: 1; font-weight: 900; letter-spacing: .04in; }
.plate { font-size: 42pt; line-height: .95; font-weight: 900; letter-spacing: .01in; overflow-wrap: anywhere; }
.plate-rule { width: 79%; height: 3px; margin: .15in auto .12in; background: #111; }
.vehicle { font-size: 11pt; line-height: 1.15; font-weight: 700; text-transform: uppercase; letter-spacing: .01in; }
.advisory { position: relative; z-index: 2; margin: 0 -.03in .14in; padding: .09in .08in; border-top: 2px solid #111; border-bottom: 2px solid #111; background: rgba(232, 232, 232, .94); text-align: center; font-size: 10pt; line-height: 1.25; }
.pass-footer { position: relative; z-index: 2; border-top: 1px solid #999; padding-top: .12in; display: grid; grid-template-columns: 1.25fr .75fr; gap: .12in; background: rgba(255, 255, 255, .92); }
.meta-label { font-size: 7pt; line-height: 1; font-weight: 700; text-transform: uppercase; letter-spacing: .025in; color: #555; }
.meta-value { margin-top: .03in; font-size: 9pt; line-height: 1.15; font-weight: 700; }
.direction { margin-top: .12in; text-align: center; font-size: 8pt; line-height: 1.25; font-weight: 600; }
</style></head><body>
<main class="pass">
  <div class="pass-artwork">
    <header class="brand">
      <img class="brand-logo" src="${logoUrl}" alt="${organizationName} logo">
      <div><div class="organization">${organizationName}</div><div class="event">${eventTitle}</div></div>
    </header>
    <section class="main">
      <img class="watermark" src="${logoUrl}" alt="" aria-hidden="true">
      <div class="valid">VALID PARKING PASS</div>
      <div class="plate">${escapeHtml(licensePlate)}</div>
      <div class="plate-rule"></div>
      <div class="vehicle">${escapeHtml(vehicle)}</div>
    </section>
    <div class="advisory">Parking permitted in designated areas only.</div>
    <footer class="pass-footer">
      <div><div class="meta-label">Valid term</div><div class="meta-value">${escapeHtml(dates)}</div></div>
      <div><div class="meta-label">Reference</div><div class="meta-value">${registrationId}</div></div>
    </footer>
    <div class="direction">Display this pass clearly in your vehicle.</div>
  </div>
</main></body></html>`;
}
```

- [ ] **Step 5: Run the focused tests and verify the document contract passes**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: all parking-pass tests pass, including content/privacy, rotation/clipping, font weights, and two-logo assertions.

- [ ] **Step 6: Build once to prove Vite resolves both imported assets**

Run:

```powershell
npm run build
```

Expected: exit 0; `dist/assets/` contains emitted SVG and WOFF2 assets referenced by the production bundle.

- [ ] **Step 7: Commit the approved document design**

Run:

```powershell
git add -- src/utils/parkingPass.js src/utils/__tests__/parkingPass.test.js
git diff --cached --check
git commit -m "feat: redesign printable parking pass"
```

Expected: one commit containing only the generator and focused test changes.

### Task 3: Wait for Print Assets with a Bounded Fallback

**Files:**
- Modify: `src/utils/__tests__/parkingPass.test.js:1-100`
- Modify: `src/utils/parkingPass.js:79-100`

- [ ] **Step 1: Make timer cleanup deterministic in the existing test teardown**

Replace the existing `afterEach` line in `src/utils/__tests__/parkingPass.test.js` with:

```js
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
```

- [ ] **Step 2: Add a reusable print-window fixture and failing readiness tests**

Add this helper below `registration`:

```js
function makePrintWindow({ fontsReady = Promise.resolve(), images = [] } = {}) {
    return {
        document: {
            write: vi.fn(),
            close: vi.fn(),
            fonts: { ready: fontsReady },
            images,
        },
        focus: vi.fn(),
        print: vi.fn(),
    };
}
```

Add these tests after the document tests:

```js
it('waits for fonts and images before focusing and printing', async () => {
    let resolveFonts;
    let resolveImage;
    const fontsReady = new Promise(resolve => { resolveFonts = resolve; });
    const image = {
        complete: false,
        addEventListener: vi.fn((eventName, handler) => {
            if (eventName === 'load') resolveImage = handler;
        }),
    };
    const printWindow = makePrintWindow({ fontsReady, images: [image] });
    vi.spyOn(window, 'open').mockReturnValue(printWindow);

    const printing = printParkingPass(registration(), event, 'Kent Methodist Church');
    await Promise.resolve();

    expect(printing).toBeInstanceOf(Promise);
    expect(printWindow.focus).not.toHaveBeenCalled();
    expect(printWindow.print).not.toHaveBeenCalled();

    resolveFonts();
    resolveImage();
    await printing;

    expect(printWindow.focus).toHaveBeenCalledOnce();
    expect(printWindow.print).toHaveBeenCalledOnce();
    expect(printWindow.focus.mock.invocationCallOrder[0])
        .toBeLessThan(printWindow.print.mock.invocationCallOrder[0]);
});

it('prints after the 1500ms fallback when an asset never settles', async () => {
    vi.useFakeTimers();
    const neverReady = new Promise(() => {});
    const printWindow = makePrintWindow({ fontsReady: neverReady });
    vi.spyOn(window, 'open').mockReturnValue(printWindow);

    const printing = printParkingPass(registration(), event, 'Kent Methodist Church');

    await vi.advanceTimersByTimeAsync(1499);
    expect(printWindow.print).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await printing;
    expect(printWindow.print).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run the focused tests and verify readiness behavior fails**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: FAIL because `printParkingPass` returns `undefined` and uses the old fixed 250ms timer instead of font/image readiness.

- [ ] **Step 4: Add the bounded asset-readiness helpers**

Add these helpers above `printParkingPass` in `src/utils/parkingPass.js`:

```js
const PRINT_ASSET_TIMEOUT_MS = 1500;

function waitForImage(image) {
    if (image.complete) return Promise.resolve();

    return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
    });
}

function settleWithin(promise, timeoutMs) {
    return new Promise(resolve => {
        const timeoutId = window.setTimeout(resolve, timeoutMs);

        Promise.resolve(promise)
            .catch(() => undefined)
            .then(() => {
                window.clearTimeout(timeoutId);
                resolve();
            });
    });
}

function waitForPrintAssets(printWindow) {
    const document = printWindow.document;
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const imagesReady = Promise.all(Array.from(document.images ?? [], waitForImage));

    return settleWithin(Promise.all([fontsReady, imagesReady]), PRINT_ASSET_TIMEOUT_MS);
}
```

- [ ] **Step 5: Replace the fixed print timer with the readiness promise**

Replace `printParkingPass` with:

```js
export function printParkingPass(registration, event, organization) {
    const html = buildParkingPassHtml(registration, event, organization);
    const printWindow = window.open('', '_blank', 'width=408,height=1200');
    if (!printWindow) {
        throw new Error('Allow popups to print the parking pass.');
    }

    printWindow.document.write(html);
    printWindow.document.close();

    return waitForPrintAssets(printWindow).then(() => {
        printWindow.focus();
        printWindow.print();
    });
}
```

- [ ] **Step 6: Run the focused tests and verify all pass**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: all focused tests pass; the invalid-registration and missing-plate errors remain synchronous and unchanged.

- [ ] **Step 7: Commit the print-readiness behavior**

Run:

```powershell
git add -- src/utils/parkingPass.js src/utils/__tests__/parkingPass.test.js
git diff --cached --check
git commit -m "fix: wait for parking pass assets before printing"
```

Expected: one commit containing only bounded asset-readiness code and its tests.

### Task 4: Verify Browser, PDF, Regression, and Physical Output

**Files:**
- Verify: `src/utils/parkingPass.js`
- Verify: `src/utils/__tests__/parkingPass.test.js`
- Verify: `src/assets/parking-pass/UMC_of_Kent_logo.svg`
- Verify: `package.json`
- Verify: `package-lock.json`

- [ ] **Step 1: Run the focused parking-pass suite**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: all parking-pass tests pass.

- [ ] **Step 2: Run the full test suite serially**

Run:

```powershell
npm run test:run
```

Expected: 22 test files pass with at least the 145 baseline tests plus the newly added parking-pass tests. Do not run Vitest concurrently with lint or build; this repository has previously hit worker-start timeouts under concurrent load.

- [ ] **Step 3: Run lint, production build, and whitespace validation sequentially**

Run:

```powershell
npm run lint
npm run build
git diff --check
```

Expected: all three commands exit 0.

- [ ] **Step 4: Inspect the emitted self-hosted assets**

Run:

```powershell
Get-ChildItem 'dist\assets' | Where-Object { $_.Name -match 'UMC_of_Kent_logo|source-sans-3.*woff2' } | Select-Object Name, Length
```

Expected: one non-empty emitted church SVG and one non-empty Source Sans 3 Latin WOFF2 are present.

- [ ] **Step 5: Verify the real browser print preview**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Then use a valid paid parking registration in the administrator view and choose **Print Pass**. In browser print preview at 100% scale, confirm all of the following:

1. The page is portrait Letter with one `8.5in × 3.66in` pass in the top third and two blank thirds below.
2. The design reads upright only after turning the printed strip counterclockwise, making the original sheet's left edge the pass bottom.
3. No browser or pass scrollbar appears.
4. The Source Sans 3 plate is the largest element and remains fully legible with a long representative plate.
5. The solid header logo is crisp and black.
6. The watermark is approximately 1.8 times the upright pass width, crops beyond both side edges, and remains subordinate at 4.5% opacity.
7. `Parking permitted in designated areas only.` appears below the vehicle block and above the term/reference footer.
8. No private registration or payment data appears.

Expected: every item is visibly true before continuing.

- [ ] **Step 6: Save and inspect a PDF from the same preview**

Use the browser's **Save to PDF** destination at 100% scale and save the temporary file under the ignored `debug/` directory. Inspect the saved PDF and confirm the same orientation, clipping, grayscale hierarchy, logo quality, and absence of scrollbars.

Expected: PDF output matches browser preview and contains exactly one Letter page.

- [ ] **Step 7: Complete the physical print check**

Print the same pass on one Letter sheet at 100% scale. Cut or fold at the one-third boundary and view the pass upright. Confirm:

1. The physical pass is exactly `8.5in × 3.66in`.
2. The original left sheet edge is the upright pass bottom.
3. The plate is readable from outside the vehicle.
4. The watermark is visible but never competes with the plate or vehicle text.
5. No clipped text, unwanted scaling, scrollbar, or extra page prints.

Expected: all five physical checks pass. If printer scaling changes the dimensions, stop and correct printer settings to **Actual size / 100%** before judging the CSS.

- [ ] **Step 8: Verify the branch contains only the approved scope**

Run:

```powershell
git status --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- src/components src/config src/utils/parkingRegistration.js src/utils/printReports.js
```

Expected: the worktree is clean; the branch changes only the approved spec/plan, `.gitignore`, package manifests, focused logo asset, `parkingPass.js`, and `parkingPass.test.js`; the final scoped diff command prints nothing.

## Implementation Notes

- Do not merge or push without explicit user authorization.
- Keep `.superpowers/` and `debug/` artifacts untracked.
- Do not add lint exclusions.
- Preserve the existing synchronous validation and popup-blocker errors.
- Treat physical print verification as required evidence, not an inference from CSS or unit tests.

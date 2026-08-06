# Tithe.ly Payment Step Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Tithe.ly's official URL/embed pair, preserve an explicit Pay in Person choice, and send Tithe.ly registrants to a dedicated pending-payment page with an iframe plus safe button and URL fallbacks.

**Architecture:** Keep the existing registration insert and `phase === 'payment'` boundary. Expand the strict parser to convert the official snippet into a narrow structured configuration, reject partial or conflicting configuration at save time, reconstruct the provider button from that structure, and leave reconciliation in the existing administrator ledger. No raw pasted HTML is stored or rendered, no registrant payment identifier is collected, and Turnstile code is untouched.

**Tech Stack:** React 19, Vite 7, Vitest 4, React Testing Library, Tailwind CSS 4, Supabase/Postgres ledger already on `origin/main`

---

## File map

### New files

- `src/components/TithelyFallbackButton.jsx` — reconstruct the allowlisted provider button and load the fixed provider script once.
- `src/components/__tests__/TithelyFallbackButton.test.jsx` — prove structured attributes, script deduplication, and absence of raw style/HTML replay.

### Modified files

- `src/utils/tithelyEmbed.js` and `src/utils/__tests__/tithelyEmbed.test.js` — parse, validate, compare, merge, and persist form/location/fund/amount/frequency values.
- `src/utils/eventPayload.js` and `src/utils/__tests__/eventPayload.test.js` — reject incomplete or invalid Tithe.ly configuration even when Pay in Person is enabled.
- `src/components/TithelyConfigurationFields.jsx` and its test — remove misleading silent-degradation copy.
- `src/components/TithelyGivingForm.jsx`, `src/components/RegistrationPaymentStep.jsx`, and their tests — render a non-completing pending-payment page with three payment paths.
- `src/components/FormPreview.jsx`, `src/components/EventRegistrationForm.jsx`, and their tests — use the selected method to label the final action and preserve the payment phase.
- `src/components/RecordPaymentDialog.jsx` and its test — use `Transaction ID` in administrator reconciliation.
- `src/utils/paymentStatus.js`, `src/components/RegistrationViewer.jsx`, and their tests — translate the known duplicate-ledger error to Transaction ID wording.

### Deliberately unchanged

- `supabase/migrations/**` — keep the generic `reference_number` schema and unique index.
- Turnstile state, callbacks, scripts, token verification, and edge functions — another agent owns that repair.
- Application routes and shell — the existing phase switch already leaves the global header/footer in place.

---

### Task 1: Parse the complete official Tithe.ly configuration

**Files:**
- Modify: `src/utils/tithelyEmbed.js`
- Modify: `src/utils/__tests__/tithelyEmbed.test.js`

- [ ] **Step 1: Add the exact official snippet as a failing regression fixture**

Add to `src/utils/__tests__/tithelyEmbed.test.js`:

```js
const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const LOCATION_ID = 'c9f19096-4a76-4ea1-be56-d7f16d1e5241';
const FUND_ID = 'c4c11990-779e-4582-ba46-bf510ed3a37f';
const givingUrl = `https://give.tithe.ly/?formId=${FORM_ID}&locationId=${LOCATION_ID}&fundId=${FUND_ID}&amount=10000&frequency=one-time`;
const officialEmbedCode = `<button class="tithely-give-button" data-form=59b0fe48-e075-436e-a91e-88011a19d975 data-location=c9f19096-4a76-4ea1-be56-d7f16d1e5241 data-fund="c4c11990-779e-4582-ba46-bf510ed3a37f" data-amount="10000" data-frequency="one-time" style="background-color: #00DB72; font-family: inherit; font-weight: bold; font-size: 19px; padding: 15px 70px; border-radius: 4px; cursor: pointer; background-image: none; color: white; text-shadow: none; display: inline-block; float: none; border: none;">Give</button><script src="https://static.tithely.com/give/give.js" defer></script>`;
const structuredConfig = {
    formId: FORM_ID,
    locationId: LOCATION_ID,
    fundId: FUND_ID,
    amount: '10000',
    frequency: 'one-time',
};

expect(parseTithelyGivingUrl(givingUrl)).toEqual({ ...structuredConfig, givingUrl });
expect(parseTithelyEmbedCode(officialEmbedCode)).toEqual(structuredConfig);
expect(normalizeTithelyConfiguration({ givingUrl, embedCode: officialEmbedCode })).toEqual({
    givingUrl,
    embedConfig: structuredConfig,
});
```

Add table cases that replace one shared form/location/fund/amount/frequency value and expect `TITHELY_ERROR_CODES.MISMATCH`. Retain hostile-snippet tests and add malformed optional UUIDs, nonnumeric amount, unsafe frequency, duplicate known URL parameters, and an unknown button attribute.

Prove backward compatibility and URL enrichment:

```js
expect(normalizeTithelyConfiguration({
    givingUrl,
    existingEmbedConfig: { formId: FORM_ID },
})).toEqual({ givingUrl, embedConfig: structuredConfig });
```

- [ ] **Step 2: Run the parser test and verify the expected failure**

```powershell
npx vitest run src/utils/__tests__/tithelyEmbed.test.js --maxWorkers=1
```

Expected: FAIL because the current button allowlist rejects the four optional official attributes and the URL parser returns only `formId`.

- [ ] **Step 3: Implement a shared structured-field contract**

In `src/utils/tithelyEmbed.js`, add:

```js
const STRUCTURED_FIELDS = Object.freeze([
    { key: 'formId', query: 'formId', attribute: 'data-form', required: true, validate: isUuid },
    { key: 'locationId', query: 'locationId', attribute: 'data-location', validate: isUuid },
    { key: 'fundId', query: 'fundId', attribute: 'data-fund', validate: isUuid },
    { key: 'amount', query: 'amount', attribute: 'data-amount', validate: value => /^\d+$/.test(value) && Number(value) > 0 },
    { key: 'frequency', query: 'frequency', attribute: 'data-frequency', validate: value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value) },
]);
const BUTTON_ATTRIBUTES = new Set(['class', 'style', ...STRUCTURED_FIELDS.map(field => field.attribute)]);
const SAVED_CONFIG_KEYS = new Set(STRUCTURED_FIELDS.map(field => field.key));
```

Use helpers with the following behavior:

```js
function readUrlConfiguration(url) {
    return STRUCTURED_FIELDS.reduce((result, field) => {
        const values = url.searchParams.getAll(field.query);
        if (values.length > 1 || (field.required && values.length !== 1)) {
            fail(field.key === 'formId' ? TITHELY_ERROR_CODES.INVALID_URL_FORM_ID : TITHELY_ERROR_CODES.INVALID_URL);
        }
        if (values.length === 1) {
            if (!field.validate(values[0])) fail(TITHELY_ERROR_CODES.INVALID_URL);
            result[field.key] = values[0];
        }
        return result;
    }, {});
}

function readButtonConfiguration(button) {
    return STRUCTURED_FIELDS.reduce((result, field) => {
        const value = button.getAttribute(field.attribute);
        if (field.required && !value) fail(TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID);
        if (value != null) {
            if (!field.validate(value)) {
                fail(field.key === 'formId' ? TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID : TITHELY_ERROR_CODES.INVALID_EMBED);
            }
            result[field.key] = value;
        }
        return result;
    }, {});
}
```

Return `{ ...readUrlConfiguration(url), givingUrl: url.toString() }` from the URL parser. Return `readButtonConfiguration(button)` from the embed parser. Reject any button attribute outside `BUTTON_ATTRIBUTES`; accept `style` only as inert parsed input and never return it.

Normalize saved data with the same validators and reject unknown keys. Compare all fields present in both sources, then enrich a form-ID-only saved configuration from the URL:

```js
const parsedEmbedConfig = pastedEmbedCode
    ? parseTithelyEmbedCode(pastedEmbedCode)
    : normalizeSavedEmbedConfig(existingEmbedConfig);
const urlConfig = Object.fromEntries(
    STRUCTURED_FIELDS.filter(({ key }) => parsedUrl[key] != null).map(({ key }) => [key, parsedUrl[key]]),
);
const hasMismatch = STRUCTURED_FIELDS.some(({ key }) => (
    urlConfig[key] != null
    && parsedEmbedConfig[key] != null
    && urlConfig[key].toLowerCase() !== parsedEmbedConfig[key].toLowerCase()
));
if (hasMismatch) fail(TITHELY_ERROR_CODES.MISMATCH);
return { givingUrl: parsedUrl.givingUrl, embedConfig: { ...urlConfig, ...parsedEmbedConfig } };
```

Use the message:

```js
'Tithe.ly URL and embed code must use the same form, location, fund, amount, and frequency.'
```

- [ ] **Step 4: Re-run and commit**

```powershell
npx vitest run src/utils/__tests__/tithelyEmbed.test.js --maxWorkers=1
git add src/utils/tithelyEmbed.js src/utils/__tests__/tithelyEmbed.test.js
git commit -m "fix: accept structured Tithely embed configuration"
```

Expected: PASS, then one parser-focused commit.

---

### Task 2: Block invalid Tithe.ly event saves

**Files:**
- Modify: `src/utils/eventPayload.js`
- Modify: `src/utils/__tests__/eventPayload.test.js`
- Modify: `src/components/TithelyConfigurationFields.jsx`
- Modify: `src/components/__tests__/TithelyConfigurationFields.test.jsx`

- [ ] **Step 1: Add failing save-blocking tests**

Replace the current invalid-URL degradation test with:

```js
it('rejects invalid Tithe.ly configuration even when Pay in Person remains available', async () => {
    await expect(buildEventPayload({
        ...createParkingDraft(),
        eventType: 'standard',
        tithelyGivingUrl: 'https://example.org/give',
        tithelyEmbedCode: '',
        tithelyEmbedConfig: null,
        allowInPersonPayment: true,
    }, 'org-1')).rejects.toThrow('Use an HTTPS give.tithe.ly giving URL.');
});

it('rejects a URL without an embed even when Pay in Person remains available', async () => {
    await expect(buildEventPayload({
        ...createParkingDraft(),
        eventType: 'standard',
        tithelyEmbedCode: '',
        tithelyEmbedConfig: null,
    }, 'org-1')).rejects.toThrow('Paste the official Tithe.ly embed code.');
});
```

Keep the no-Tithe.ly Pay in Person-only case valid. In the editor-field test, prove the invalid configuration alert does not contain `Pay in Person remains available`.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run src/utils/__tests__/eventPayload.test.js src/components/__tests__/TithelyConfigurationFields.test.jsx --maxWorkers=1
```

Expected: FAIL because payload construction suppresses the parser error and the UI promises degradation.

- [ ] **Step 3: Propagate parser errors and persist only normalized values**

In `buildEventPayload`, use direct normalization:

```js
const tithelyConfiguration = normalizeTithelyConfiguration({
    givingUrl: event.tithelyGivingUrl,
    embedCode: event.tithelyEmbedCode,
    existingEmbedConfig: event.tithelyEmbedConfig,
});
```

Retain the active-event path rule:

```js
if (event.status === 'active' && event.paymentEnabled
    && !tithelyConfiguration.givingUrl && !event.allowInPersonPayment) {
    throw new Error('Payment-enabled events require a valid Tithe.ly form or Pay in Person.');
}
```

Persist only:

```js
tithely_giving_url: tithelyConfiguration.givingUrl,
tithely_embed_config: tithelyConfiguration.embedConfig,
```

Remove the unused `allowInPerson` prop from `TithelyConfigurationFields` and render only `{draftStatus.error}`.

- [ ] **Step 4: Re-run and commit**

```powershell
npx vitest run src/utils/__tests__/eventPayload.test.js src/components/__tests__/TithelyConfigurationFields.test.jsx --maxWorkers=1
git add src/utils/eventPayload.js src/utils/__tests__/eventPayload.test.js src/components/TithelyConfigurationFields.jsx src/components/__tests__/TithelyConfigurationFields.test.jsx
git commit -m "fix: block invalid Tithely event configuration"
```

Expected: PASS; no invalid Tithe.ly input silently becomes Pay in Person-only.

---

### Task 3: Reconstruct the official fallback button safely

**Files:**
- Create: `src/components/TithelyFallbackButton.jsx`
- Create: `src/components/__tests__/TithelyFallbackButton.test.jsx`
- Modify: `src/utils/tithelyEmbed.js`

- [ ] **Step 1: Write failing button/script tests**

Create a test that renders the complete structured config and asserts `class="tithely-give-button"`, the five `data-*` values, no inline `style`, and exactly one deferred `https://static.tithely.com/give/give.js` script after rerender.

Core assertions:

```jsx
const button = screen.getByRole('button', { name: 'Pay with Tithe.ly' });
expect(button).toHaveAttribute('data-form', config.formId);
expect(button).toHaveAttribute('data-location', config.locationId);
expect(button).toHaveAttribute('data-fund', config.fundId);
expect(button).toHaveAttribute('data-amount', config.amount);
expect(button).toHaveAttribute('data-frequency', config.frequency);
expect(button).not.toHaveAttribute('style');
expect(document.querySelectorAll('script[src="https://static.tithely.com/give/give.js"]')).toHaveLength(1);
```

- [ ] **Step 2: Run and verify the missing-module failure**

```powershell
npx vitest run src/components/__tests__/TithelyFallbackButton.test.jsx --maxWorkers=1
```

- [ ] **Step 3: Implement the safe reconstructed button**

Export `TITHELY_SCRIPT_URL` from `tithelyEmbed.js`, then create:

```jsx
import React, { useEffect } from 'react';
import { TITHELY_SCRIPT_URL } from '../utils/tithelyEmbed';

export default function TithelyFallbackButton({ embedConfig }) {
    useEffect(() => {
        if (document.querySelector(`script[src="${TITHELY_SCRIPT_URL}"]`)) return;
        const script = document.createElement('script');
        script.src = TITHELY_SCRIPT_URL;
        script.defer = true;
        script.dataset.tithelyFallbackScript = 'true';
        document.body.appendChild(script);
    }, []);

    return (
        <button
            type="button"
            className="tithely-give-button inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/50"
            data-form={embedConfig.formId}
            data-location={embedConfig.locationId}
            data-fund={embedConfig.fundId}
            data-amount={embedConfig.amount}
            data-frequency={embedConfig.frequency}
        >
            Pay with Tithe.ly
        </button>
    );
}
```

Never accept raw embed text, use `dangerouslySetInnerHTML`, or replay pasted style.

- [ ] **Step 4: Re-run and commit**

```powershell
npx vitest run src/components/__tests__/TithelyFallbackButton.test.jsx src/utils/__tests__/tithelyEmbed.test.js --maxWorkers=1
git add src/components/TithelyFallbackButton.jsx src/components/__tests__/TithelyFallbackButton.test.jsx src/utils/tithelyEmbed.js
git commit -m "feat: add safe Tithely fallback button"
```

---

### Task 4: Build the non-completing dedicated payment page

**Files:**
- Modify: `src/components/TithelyGivingForm.jsx`
- Modify: `src/components/__tests__/TithelyGivingForm.test.jsx`
- Modify: `src/components/RegistrationPaymentStep.jsx`
- Modify: `src/components/__tests__/RegistrationPaymentStep.test.jsx`

- [ ] **Step 1: Replace callback tests with failing page assertions**

Assert the heading, `Registration received — payment pending`, iframe, fallback button, and plain link. Assert no `/finished/i` button and no Gift ID or Transaction ID field. For `RegistrationPaymentStep`, assert Tithe.ly stays visible without a completion action and an in-person registration renders nothing.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx --maxWorkers=1
```

Expected: FAIL on the current local completion control and absent provider fallback.

- [ ] **Step 3: Render the approved pending-payment page**

Refactor `TithelyGivingForm` to accept only `{ event }`, validate stored configuration, and render:

```jsx
<Card className="space-y-5 p-5">
    <header>
        <p className="text-sm font-medium text-primary">{event.title}</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Complete your payment with Tithe.ly</h2>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Registration received — payment pending
        </p>
        {amount > 0 && <p className="mt-3 text-sm text-slate-600">Amount due: ${amount.toFixed(2)}</p>}
        <p className="mt-2 text-sm text-slate-600">Your registration remains pending until an administrator records the payment.</p>
    </header>
    <iframe src={configuration.givingUrl} title={`Tithe.ly giving form for ${event.title}`} className="min-h-[800px] w-full border-0" />
    <div className="space-y-3 border-t border-slate-200 pt-4">
        <p className="text-sm text-slate-600">If the embedded form does not load, use the Tithe.ly button:</p>
        <TithelyFallbackButton embedConfig={configuration.embedConfig} />
        <p className="text-sm text-slate-600">
            If the button does not open,{' '}
            <a href={configuration.givingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Open Tithe.ly in a new tab</a>.
        </p>
    </div>
</Card>
```

Replace `RegistrationPaymentStep` with:

```jsx
export default function RegistrationPaymentStep({ event, registration }) {
    if (registration?.payment_method !== 'tithely') return null;
    return <TithelyGivingForm event={event} />;
}
```

- [ ] **Step 4: Re-run and commit**

```powershell
npx vitest run src/components/__tests__/TithelyFallbackButton.test.jsx src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx --maxWorkers=1
git add src/components/TithelyGivingForm.jsx src/components/__tests__/TithelyGivingForm.test.jsx src/components/RegistrationPaymentStep.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx
git commit -m "feat: present dedicated Tithely payment page"
```

---

### Task 5: Label the selected submit action and preserve the payment phase

**Files:**
- Modify: `src/components/FormPreview.jsx`
- Modify: `src/components/__tests__/FormPreview.test.jsx`
- Modify: `src/components/EventRegistrationForm.jsx`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`

- [ ] **Step 1: Add failing label and phase-persistence tests**

Add a `FormPreview` test for `submitLabel="Submit Registration & Continue to Tithe.ly"`. Change the payment-step mock to a non-completing heading/notice. In the dual-method test, assert Tithe.ly selection changes the action label and Pay in Person restores `Submit Registration`. In the Tithe.ly submission test, assert the insert happens once, the payment notice replaces the form, and normal success copy is absent. Remove all `Finish Mock Tithe.ly` clicks.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run src/components/__tests__/FormPreview.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

- [ ] **Step 3: Add the label prop without touching Turnstile**

Add `submitLabel = 'Submit Registration'` to `FormPreview` and use:

```jsx
{isFull && event.waitlist_enabled ? 'Join Waitlist' : submitLabel}
```

for writable and read-only final actions. In the existing `FormPreview` call, add:

```jsx
submitLabel={paymentMethod === 'tithely'
    ? 'Submit Registration & Continue to Tithe.ly'
    : 'Submit Registration'}
```

Simplify the existing payment return to:

```jsx
if (phase === 'payment') {
    return <RegistrationPaymentStep event={event} registration={createdRegistration} />;
}
```

Do not edit any Turnstile import, ref, state, callback, script, token check, error path, or the `submitting` expression.

- [ ] **Step 4: Re-run, inspect the boundary, and commit**

```powershell
npx vitest run src/components/__tests__/FormPreview.test.jsx src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx --maxWorkers=1
git diff -- src/components/EventRegistrationForm.jsx
git add src/components/FormPreview.jsx src/components/__tests__/FormPreview.test.jsx src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx
git commit -m "feat: continue Tithely registrations to payment"
```

Expected: tests pass and the production diff changes only the payment-step callback and submit label outside tests.

---

### Task 6: Use Transaction ID throughout administrator reconciliation UI

**Files:**
- Modify: `src/components/RecordPaymentDialog.jsx`
- Modify: `src/components/__tests__/RecordPaymentDialog.test.jsx`
- Modify: `src/utils/paymentStatus.js`
- Modify: `src/utils/__tests__/paymentStatus.test.js`
- Modify: `src/components/RegistrationViewer.jsx`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Write failing nomenclature and duplicate-error tests**

Change the dialog test to expect label `Transaction ID` and message `Enter the Tithe.ly Transaction ID.`. Add utility tests:

```js
expect(formatRecordPaymentError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "registration_payments_active_tithely_reference_org_key"',
})).toBe('This Tithe.ly Transaction ID has already been recorded.');
expect(formatRecordPaymentError({ message: 'Network unavailable' })).toBe('Network unavailable');
expect(formatRecordPaymentError(null)).toBe('Unable to record payment.');
```

Add a `RegistrationViewer` test that returns that unique-index error from `record_registration_payment` and proves the friendly message, amount, and Transaction ID remain in the dialog.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run src/components/__tests__/RecordPaymentDialog.test.jsx src/utils/__tests__/paymentStatus.test.js src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1
```

- [ ] **Step 3: Implement the wording and narrow error translation**

In the dialog:

```js
const referenceLabel = method === 'check' ? 'Check number' : 'Transaction ID';
nextErrors.referenceNumber = 'Enter the Tithe.ly Transaction ID.';
```

In `paymentStatus.js`:

```js
const TITHELY_REFERENCE_UNIQUE_INDEX = 'registration_payments_active_tithely_reference_org_key';

export function formatRecordPaymentError(error) {
    const message = error?.message || '';
    const details = error?.details || '';
    if (error?.code === '23505' && `${message} ${details}`.includes(TITHELY_REFERENCE_UNIQUE_INDEX)) {
        return 'This Tithe.ly Transaction ID has already been recorded.';
    }
    return message || 'Unable to record payment.';
}
```

Import it into `RegistrationViewer` and use `setPaymentError(formatRecordPaymentError(err))` only in the record-payment catch. Do not change RPC arguments, the database column/index, cash, check, or void behavior.

- [ ] **Step 4: Re-run and commit**

```powershell
npx vitest run src/components/__tests__/RecordPaymentDialog.test.jsx src/utils/__tests__/paymentStatus.test.js src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1
git add src/components/RecordPaymentDialog.jsx src/components/__tests__/RecordPaymentDialog.test.jsx src/utils/paymentStatus.js src/utils/__tests__/paymentStatus.test.js src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "fix: use Tithely Transaction ID in admin"
```

---

### Task 7: Complete verification and scope review

- [ ] **Step 1: Run all focused feature tests serially**

```powershell
npx vitest run src/utils/__tests__/tithelyEmbed.test.js src/utils/__tests__/eventPayload.test.js src/utils/__tests__/paymentStatus.test.js src/components/__tests__/TithelyConfigurationFields.test.jsx src/components/__tests__/TithelyFallbackButton.test.jsx src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx src/components/__tests__/FormPreview.test.jsx src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/components/__tests__/RecordPaymentDialog.test.jsx src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1
```

- [ ] **Step 2: Run the complete suite and gates sequentially**

```powershell
npx vitest run --dir src --maxWorkers=1
npm run check:migrations
npm run lint
npm run build
```

Expected: every command exits 0. Do not run them concurrently and do not add or broaden lint exclusions.

- [ ] **Step 3: Scan forbidden controls, raw rendering, and scope**

```powershell
rg -n "I've finished with Tithe.ly|Gift ID|dangerouslySetInnerHTML|tithelyEmbedCode" src/components src/utils
git diff --check origin/main...HEAD
git diff origin/main...HEAD -- src/components/EventRegistrationForm.jsx
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: no registrant completion/Gift ID UI, no raw HTML rendering, Tithe.ly embed text only in editor normalization paths, no Turnstile edits, no whitespace errors, and only approved files.

- [ ] **Step 4: Perform browser acceptance after the separate Turnstile repair is integrated**

In an explicitly authorized non-production environment, without a real donation, verify: the exact snippet saves/reloads; invalid partial config blocks; both choices appear; the Tithe.ly label and next-page phase work; iframe/button/link all appear inside the shell; no identifier/completion control appears; Pay in Person goes directly to confirmation; and the admin field/error says Transaction ID. If Turnstile is not integrated, report automated verification separately and defer browser acceptance rather than modifying Turnstile here.

---

## Self-review checklist

- [ ] Every production change is preceded by a failing focused test.
- [ ] The exact supplied snippet is a permanent regression fixture.
- [ ] Raw embed HTML, script text, and pasted style are never persisted or rendered.
- [ ] Form-ID-only stored configuration remains valid and is enriched from the URL.
- [ ] Invalid Tithe.ly input never silently degrades to Pay in Person-only.
- [ ] Registrants see no Gift ID, Transaction ID, or local completion assertion.
- [ ] The database remains authoritative and retains generic `reference_number` storage.
- [ ] No migration, Turnstile code, placeholder, TODO, skipped test, or lint exclusion is added.
- [ ] Fresh test, migration, lint, build, diff, and status output exists before completion is claimed.

## Completion boundary

This plan authorizes local implementation and verification on `codex/tithely-payment-step-repair`. It does not authorize pushing, opening a pull request, deploying, changing production event data, submitting a real Tithe.ly donation, or merging. Those remain separate user decisions.

# Tithe.ly Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PayPal with validated per-event Tithe.ly giving forms, preserve Pay in Person, and keep all online gifts pending until authenticated administrator verification.

**Architecture:** Parse the provider-supplied link and embed snippet into a narrow normalized event configuration, render only the validated `give.tithe.ly` URL in an iframe, and store the registrant's selected method during the initial registration insert. Tithe.ly completion changes only local UI state; the existing authenticated, organization-scoped administrator RPC is generalized to verify either Tithe.ly or in-person payments.

**Tech Stack:** React 19, Vite 7, Vitest 4, React Testing Library, Tailwind CSS 4, Supabase/Postgres migrations

---

## File Structure

### New files

- `src/utils/tithelyEmbed.js` — provider URL/embed parsing, normalized stored-data validation, and available-method derivation.
- `src/utils/__tests__/tithelyEmbed.test.js` — parser allowlist, mismatch, and stored-data tests.
- `src/utils/paymentStatus.js` — shared administrator paid-verification eligibility predicate.
- `src/utils/__tests__/paymentStatus.test.js` — standard and parking eligibility cases.
- `src/components/TithelyConfigurationFields.jsx` — focused Event Editor inputs and configured/error summary.
- `src/components/__tests__/TithelyConfigurationFields.test.jsx` — editor-field interaction and messaging tests.
- `src/components/PaymentMethodChoice.jsx` — accessible registrant method choice.
- `src/components/__tests__/PaymentMethodChoice.test.jsx` — single- and dual-method rendering tests.
- `src/components/TithelyGivingForm.jsx` — responsive iframe, fallback link, and local completion control.
- `src/components/__tests__/TithelyGivingForm.test.jsx` — iframe, fallback, invalid-data, and completion tests.
- `supabase/migrations/20260805200000_tithely_payment_flow.sql` — event configuration columns and generalized administrator verification RPC.

### Modified files

- `src/utils/eventPayload.js` and `src/utils/__tests__/eventPayload.test.js` — normalize/persist provider configuration and enforce payment-method availability for active events.
- `src/components/EventEditor.jsx` — initialize, load, display, and retain normalized Tithe.ly configuration.
- `src/components/FormPreviewPane.jsx` — retain normalized payment configuration in the editor's synthetic event record.
- `src/components/FormPreview.jsx` and `src/components/__tests__/FormPreview.test.jsx` — add a last-page payment-method slot.
- `src/components/EventRegistrationForm.jsx` and `src/components/__tests__/EventRegistrationForm.test.jsx` — choose a method before insertion and route all confirmed paid events.
- `src/components/RegistrationPaymentStep.jsx` and `src/components/__tests__/RegistrationPaymentStep.test.jsx` — replace PayPal capture with pending Tithe.ly handoff.
- `src/components/SuccessState.jsx` — explain pending in-person payment.
- `src/components/ParkingRegistrationTable.jsx` and `src/components/__tests__/ParkingRegistrationTable.test.jsx` — use shared eligibility for both current methods.
- `src/components/RegistrationViewer.jsx` and `src/components/__tests__/RegistrationViewer.test.jsx` — expose paid verification for standard events and preserve returned method values.
- `package.json`, `package-lock.json`, `.env.example`, and `README.md` — remove PayPal and document Tithe.ly behavior.

### Removed file

- `src/components/PaymentSection.jsx` — PayPal SDK integration is no longer used.

---

### Task 1: Build the strict Tithe.ly parser and method derivation

**Files:**
- Create: `src/utils/tithelyEmbed.js`
- Create: `src/utils/__tests__/tithelyEmbed.test.js`

- [ ] **Step 1: Write failing parser and stored-configuration tests**

Create `src/utils/__tests__/tithelyEmbed.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
    getAvailablePaymentMethods,
    getTithelyDraftStatus,
    normalizeTithelyConfiguration,
    parseTithelyEmbedCode,
    parseTithelyGivingUrl,
    validateStoredTithelyConfiguration,
} from '../tithelyEmbed';

const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const OTHER_FORM_ID = 'a1ca4c5d-6865-11ee-90fc-1260ab546d11';
const GIVING_URL = `https://give.tithe.ly/?formId=${FORM_ID}&amount=100`;
const EMBED_CODE = `<button class="tithely-give-button" data-form="${FORM_ID}" style="background-color: #00DB72;">Give</button><script src="https://static.tithely.com/give/give.js" defer></script>`;

describe('Tithe.ly configuration', () => {
    it('normalizes the approved URL and embed pair', () => {
        expect(normalizeTithelyConfiguration({
            givingUrl: GIVING_URL,
            embedCode: EMBED_CODE,
        })).toEqual({
            givingUrl: GIVING_URL,
            embedConfig: { formId: FORM_ID },
        });
    });

    it('preserves a stored configuration when editing without repasting embed code', () => {
        expect(normalizeTithelyConfiguration({
            givingUrl: GIVING_URL,
            embedCode: '',
            existingEmbedConfig: { formId: FORM_ID },
        })).toEqual({
            givingUrl: GIVING_URL,
            embedConfig: { formId: FORM_ID },
        });
    });

    it.each([
        ['HTTP', `http://give.tithe.ly/?formId=${FORM_ID}`],
        ['look-alike host', `https://give.tithe.ly.example.com/?formId=${FORM_ID}`],
        ['alternate path', `https://give.tithe.ly/form?formId=${FORM_ID}`],
        ['missing form ID', 'https://give.tithe.ly/'],
        ['malformed form ID', 'https://give.tithe.ly/?formId=not-a-uuid'],
        ['duplicate form ID', `https://give.tithe.ly/?formId=${FORM_ID}&formId=${OTHER_FORM_ID}`],
    ])('rejects an invalid %s URL', (_name, value) => {
        expect(() => parseTithelyGivingUrl(value)).toThrow();
    });

    it.each([
        ['wrong script', `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script src="https://example.com/give.js" defer></script>`],
        ['inline event handler', `<button class="tithely-give-button" data-form="${FORM_ID}" onclick="alert(1)">Give</button><script src="https://static.tithely.com/give/give.js" defer></script>`],
        ['inline script body', `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script src="https://static.tithely.com/give/give.js" defer>alert(1)</script>`],
        ['extra executable element', `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script src="https://static.tithely.com/give/give.js" defer></script><script>alert(1)</script>`],
        ['missing button', '<script src="https://static.tithely.com/give/give.js" defer></script>'],
    ])('rejects embed code with %s', (_name, value) => {
        expect(() => parseTithelyEmbedCode(value)).toThrow();
    });

    it('rejects mismatched URL and embed form IDs', () => {
        const mismatchedEmbed = EMBED_CODE.replace(FORM_ID, OTHER_FORM_ID);
        expect(() => normalizeTithelyConfiguration({
            givingUrl: GIVING_URL,
            embedCode: mismatchedEmbed,
        })).toThrow('Tithe.ly URL and embed code must use the same form ID.');
    });

    it('reports draft configuration errors without throwing', () => {
        expect(getTithelyDraftStatus({
            tithelyGivingUrl: 'https://example.com/give',
            tithelyEmbedCode: EMBED_CODE,
            tithelyEmbedConfig: null,
        })).toMatchObject({ configured: false, error: expect.stringMatching(/Tithe.ly/i) });
    });

    it('validates normalized persisted data before rendering', () => {
        expect(validateStoredTithelyConfiguration({
            tithely_giving_url: GIVING_URL,
            tithely_embed_config: { formId: FORM_ID },
        })).toEqual({
            valid: true,
            givingUrl: GIVING_URL,
            embedConfig: { formId: FORM_ID },
        });
        expect(validateStoredTithelyConfiguration({
            tithely_giving_url: GIVING_URL,
            tithely_embed_config: { formId: OTHER_FORM_ID },
        })).toMatchObject({ valid: false });
    });

    it('derives only usable methods for enabled events', () => {
        expect(getAvailablePaymentMethods({
            payment_enabled: true,
            allow_in_person_payment: true,
            tithely_giving_url: GIVING_URL,
            tithely_embed_config: { formId: FORM_ID },
        })).toEqual(['tithely', 'in_person']);
        expect(getAvailablePaymentMethods({
            payment_enabled: true,
            allow_in_person_payment: true,
            tithely_giving_url: 'https://example.com/give',
            tithely_embed_config: { formId: FORM_ID },
        })).toEqual(['in_person']);
        expect(getAvailablePaymentMethods({ payment_enabled: false })).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm run test:run -- src/utils/__tests__/tithelyEmbed.test.js
```

Expected: FAIL because `src/utils/tithelyEmbed.js` does not exist.

- [ ] **Step 3: Implement the strict parser and public helpers**

Create `src/utils/tithelyEmbed.js`:

```js
const FORM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIVING_ORIGIN = 'https://give.tithe.ly';
const EMBED_SCRIPT_URL = 'https://static.tithely.com/give/give.js';
const BUTTON_ATTRIBUTES = new Set(['class', 'data-form', 'style']);
const SCRIPT_ATTRIBUTES = new Set(['src', 'defer']);

const fail = (message) => {
    throw new Error(message);
};

const requireFormId = (value) => {
    if (!FORM_ID_PATTERN.test(value || '')) {
        fail('Tithe.ly form ID must be a valid UUID.');
    }
    return value;
};

export function parseTithelyGivingUrl(value) {
    let url;
    try {
        url = new URL(String(value || '').trim());
    } catch {
        fail('Enter a valid Tithe.ly Giving Form URL.');
    }

    if (
        url.protocol !== 'https:'
        || url.origin !== GIVING_ORIGIN
        || url.pathname !== '/'
        || url.username
        || url.password
        || url.hash
    ) {
        fail('Giving Form URL must use https://give.tithe.ly/.');
    }

    const formIds = url.searchParams.getAll('formId');
    if (formIds.length !== 1) {
        fail('Giving Form URL must contain exactly one formId.');
    }

    return { givingUrl: url.toString(), formId: requireFormId(formIds[0]) };
}

export function parseTithelyEmbedCode(value) {
    const documentValue = new DOMParser().parseFromString(String(value || '').trim(), 'text/html');
    const elements = [...documentValue.body.children];
    const buttons = elements.filter((element) => element.tagName === 'BUTTON');
    const scripts = elements.filter((element) => element.tagName === 'SCRIPT');

    if (elements.length !== 2 || buttons.length !== 1 || scripts.length !== 1) {
        fail('Embed code must contain only the official Tithe.ly button and script.');
    }

    const button = buttons[0];
    const script = scripts[0];
    if (!button.classList.contains('tithely-give-button')) {
        fail('Embed code is missing the official Tithe.ly button class.');
    }

    for (const element of elements) {
        for (const attribute of [...element.attributes]) {
            if (attribute.name.toLowerCase().startsWith('on')) {
                fail('Embed code cannot contain executable event attributes.');
            }
        }
    }

    if ([...button.attributes].some((attribute) => !BUTTON_ATTRIBUTES.has(attribute.name))) {
        fail('Embed code contains unsupported button attributes.');
    }
    if ([...script.attributes].some((attribute) => !SCRIPT_ATTRIBUTES.has(attribute.name))) {
        fail('Embed code contains unsupported script attributes.');
    }
    if (
        script.src !== EMBED_SCRIPT_URL
        || !script.hasAttribute('defer')
        || script.textContent.trim()
    ) {
        fail('Embed code must use the official deferred Tithe.ly script.');
    }

    return { formId: requireFormId(button.dataset.form) };
}

export function normalizeTithelyConfiguration({
    givingUrl,
    embedCode = '',
    existingEmbedConfig = null,
}) {
    const trimmedUrl = String(givingUrl || '').trim();
    const trimmedCode = String(embedCode || '').trim();
    if (!trimmedUrl && !trimmedCode && !existingEmbedConfig) {
        return { givingUrl: null, embedConfig: null };
    }
    if (!trimmedUrl) fail('Enter the Tithe.ly Giving Form URL.');

    const parsedUrl = parseTithelyGivingUrl(trimmedUrl);
    if (!trimmedCode && !existingEmbedConfig) {
        fail('Paste the official Tithe.ly embed code.');
    }
    const embedConfig = trimmedCode
        ? parseTithelyEmbedCode(trimmedCode)
        : { formId: requireFormId(existingEmbedConfig?.formId) };

    if (parsedUrl.formId !== embedConfig.formId) {
        fail('Tithe.ly URL and embed code must use the same form ID.');
    }

    return { givingUrl: parsedUrl.givingUrl, embedConfig };
}

export function getTithelyDraftStatus(event) {
    try {
        const normalized = normalizeTithelyConfiguration({
            givingUrl: event?.tithelyGivingUrl,
            embedCode: event?.tithelyEmbedCode,
            existingEmbedConfig: event?.tithelyEmbedConfig,
        });
        return {
            configured: Boolean(normalized.embedConfig),
            error: '',
            ...normalized,
        };
    } catch (error) {
        return { configured: false, error: error.message, givingUrl: null, embedConfig: null };
    }
}

export function validateStoredTithelyConfiguration(event) {
    try {
        const givingUrl = event?.tithely_giving_url ?? event?.tithelyGivingUrl;
        const embedConfig = event?.tithely_embed_config ?? event?.tithelyEmbedConfig;
        const parsedUrl = parseTithelyGivingUrl(givingUrl);
        const formId = requireFormId(embedConfig?.formId);
        if (parsedUrl.formId !== formId) {
            fail('Stored Tithe.ly form IDs do not match.');
        }
        return { valid: true, givingUrl: parsedUrl.givingUrl, embedConfig: { formId } };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

export function getAvailablePaymentMethods(event) {
    const paymentEnabled = event?.payment_enabled ?? event?.paymentEnabled;
    if (!paymentEnabled) return [];

    const methods = [];
    if (validateStoredTithelyConfiguration(event).valid) methods.push('tithely');
    if (event?.allow_in_person_payment ?? event?.allowInPersonPayment) methods.push('in_person');
    return methods;
}
```

- [ ] **Step 4: Run the parser tests and verify they pass**

Run:

```powershell
npm run test:run -- src/utils/__tests__/tithelyEmbed.test.js
```

Expected: the new test file passes with no failed cases.

- [ ] **Step 5: Commit the parser slice**

```powershell
git add src/utils/tithelyEmbed.js src/utils/__tests__/tithelyEmbed.test.js
git commit -m "feat: validate Tithe.ly form configuration"
```

---

### Task 2: Persist normalized event configuration and generalize the secure RPC

**Files:**
- Create: `supabase/migrations/20260805200000_tithely_payment_flow.sql`
- Modify: `src/utils/eventPayload.js:1-44`
- Modify: `src/utils/__tests__/eventPayload.test.js:1-91`

- [ ] **Step 1: Add failing event-payload tests**

Add these imports and fixtures to `src/utils/__tests__/eventPayload.test.js`:

```js
const TITHELY_FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const TITHELY_URL = `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`;
const TITHELY_EMBED = `<button class="tithely-give-button" data-form="${TITHELY_FORM_ID}">Give</button><script src="https://static.tithely.com/give/give.js" defer></script>`;
```

Add the Tithe.ly fields to `createParkingDraft()`:

```js
tithelyGivingUrl: TITHELY_URL,
tithelyEmbedCode: TITHELY_EMBED,
tithelyEmbedConfig: null,
```

Add these cases inside `describe('event payloads', ...)`:

```js
it('persists normalized Tithe.ly configuration without raw embed code', async () => {
    const payload = await buildEventPayload(createParkingDraft(), 'org-1');

    expect(payload.tithely_giving_url).toBe(TITHELY_URL);
    expect(payload.tithely_embed_config).toEqual({ formId: TITHELY_FORM_ID });
    expect(payload).not.toHaveProperty('tithely_embed_code');
});

it('allows an active payment event with only Pay in Person', async () => {
    const event = {
        ...createParkingDraft(),
        tithelyGivingUrl: '',
        tithelyEmbedCode: '',
        tithelyEmbedConfig: null,
        allowInPersonPayment: true,
    };

    const payload = await buildEventPayload(event, 'org-1');
    expect(payload.tithely_giving_url).toBeNull();
    expect(payload.tithely_embed_config).toBeNull();
    expect(payload.allow_in_person_payment).toBe(true);
});

it('drops invalid Tithe.ly configuration when Pay in Person remains usable', async () => {
    const event = {
        ...createParkingDraft(),
        tithelyGivingUrl: 'https://example.com/give',
        allowInPersonPayment: true,
    };

    const payload = await buildEventPayload(event, 'org-1');
    expect(payload.tithely_giving_url).toBe('https://example.com/give');
    expect(payload.tithely_embed_config).toBeNull();
});

it('rejects an active payment event with no usable method', async () => {
    const event = {
        ...createParkingDraft(),
        eventType: 'standard',
        tithelyGivingUrl: '',
        tithelyEmbedCode: '',
        tithelyEmbedConfig: null,
        allowInPersonPayment: false,
    };

    await expect(buildEventPayload(event, 'org-1')).rejects.toThrow(
        'Payment-enabled events require a valid Tithe.ly form or Pay in Person.'
    );
});

it('reuses a saved normalized embed configuration on later edits', async () => {
    const event = {
        ...createParkingDraft(),
        tithelyEmbedCode: '',
        tithelyEmbedConfig: { formId: TITHELY_FORM_ID },
    };

    const payload = await buildEventPayload(event, 'org-1');
    expect(payload.tithely_embed_config).toEqual({ formId: TITHELY_FORM_ID });
});

it('preserves normalized Tithe.ly fields when duplicating an event', () => {
    const payload = buildDuplicateEventPayload({
        id: 'event-1',
        title: 'Giving Event',
        slug: 'giving-event',
        status: 'active',
        registration_count: 3,
        waitlist_count: 0,
        tithely_giving_url: TITHELY_URL,
        tithely_embed_config: { formId: TITHELY_FORM_ID },
    });

    expect(payload).toMatchObject({
        status: 'draft',
        tithely_giving_url: TITHELY_URL,
        tithely_embed_config: { formId: TITHELY_FORM_ID },
    });
});
```

- [ ] **Step 2: Run the event-payload tests and verify the new cases fail**

Run:

```powershell
npm run test:run -- src/utils/__tests__/eventPayload.test.js
```

Expected: FAIL because `buildEventPayload` does not persist or validate Tithe.ly fields.

- [ ] **Step 3: Normalize and validate payment configuration in `eventPayload.js`**

Add the import:

```js
import { normalizeTithelyConfiguration } from './tithelyEmbed';
```

At the start of `buildEventPayload`, after parking validation, add:

```js
    let tithelyConfiguration = { givingUrl: null, embedConfig: null };
    let tithelyError = null;
    try {
        tithelyConfiguration = normalizeTithelyConfiguration({
            givingUrl: event.tithelyGivingUrl,
            embedCode: event.tithelyEmbedCode,
            existingEmbedConfig: event.tithelyEmbedConfig,
        });
    } catch (error) {
        tithelyError = error;
    }

    if (
        event.status === 'active'
        && event.paymentEnabled
        && !tithelyConfiguration.embedConfig
        && !event.allowInPersonPayment
    ) {
        throw new Error('Payment-enabled events require a valid Tithe.ly form or Pay in Person.', {
            cause: tithelyError,
        });
    }
```

Add these properties to the returned payload immediately after `allow_in_person_payment`:

```js
        tithely_giving_url: tithelyConfiguration.givingUrl
            || event.tithelyGivingUrl?.trim()
            || null,
        tithely_embed_config: tithelyConfiguration.embedConfig,
```

- [ ] **Step 4: Add the database migration**

Create `supabase/migrations/20260805200000_tithely_payment_flow.sql`:

```sql
ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS tithely_giving_url text,
    ADD COLUMN IF NOT EXISTS tithely_embed_config jsonb;

CREATE OR REPLACE FUNCTION public.mark_registration_paid(
    p_registration_id uuid,
    p_org_id uuid
)
RETURNS SETOF public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.org_members
        WHERE org_id = p_org_id
          AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to manage this organization';
    END IF;

    RETURN QUERY
    UPDATE public.registrations
    SET payment_status = 'paid',
        payment_details = COALESCE(payment_details, '{}'::jsonb)
            || jsonb_build_object('verifiedAt', now(), 'verifiedBy', auth.uid())
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status = 'confirmed'
      AND payment_status = 'pending'
      AND payment_method IN ('tithely', 'in_person')
    RETURNING *;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration is not an eligible pending payment';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated;
```

- [ ] **Step 5: Run payload tests and inspect the migration contract**

Run:

```powershell
npm run test:run -- src/utils/__tests__/eventPayload.test.js
rg -n "SET search_path = ''|payment_method IN|REVOKE ALL|GRANT EXECUTE|tithely_giving_url" supabase/migrations/20260805200000_tithely_payment_flow.sql
```

Expected: all event-payload tests pass; the search output shows the empty search path, the two supported methods, revocations, authenticated grant, and new event column.

- [ ] **Step 6: Commit the persistence slice**

```powershell
git add src/utils/eventPayload.js src/utils/__tests__/eventPayload.test.js supabase/migrations/20260805200000_tithely_payment_flow.sql
git commit -m "feat: persist Tithe.ly event configuration"
```

---

### Task 3: Add focused Tithe.ly configuration fields to the Event Editor

**Files:**
- Create: `src/components/TithelyConfigurationFields.jsx`
- Create: `src/components/__tests__/TithelyConfigurationFields.test.jsx`
- Modify: `src/components/EventEditor.jsx:52-77,106-136,457-480`
- Modify: `src/components/FormPreviewPane.jsx:19-33`

- [ ] **Step 1: Write failing component tests**

Create `src/components/__tests__/TithelyConfigurationFields.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TithelyConfigurationFields from '../TithelyConfigurationFields';

const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';

describe('TithelyConfigurationFields', () => {
    it('reports URL and embed changes', () => {
        const onChange = vi.fn();
        render(
            <TithelyConfigurationFields
                givingUrl=""
                embedCode=""
                embedConfig={null}
                allowInPerson={false}
                onChange={onChange}
            />
        );

        fireEvent.change(screen.getByLabelText(/giving form url/i), {
            target: { value: `https://give.tithe.ly/?formId=${FORM_ID}` },
        });
        fireEvent.change(screen.getByLabelText(/embed code/i), {
            target: { value: '<button>Give</button>' },
        });

        expect(onChange).toHaveBeenCalledWith('tithelyGivingUrl', `https://give.tithe.ly/?formId=${FORM_ID}`);
        expect(onChange).toHaveBeenCalledWith('tithelyEmbedCode', '<button>Give</button>');
    });

    it('shows a saved configured form without rendering raw code', () => {
        render(
            <TithelyConfigurationFields
                givingUrl={`https://give.tithe.ly/?formId=${FORM_ID}`}
                embedCode=""
                embedConfig={{ formId: FORM_ID }}
                allowInPerson={false}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(new RegExp(`Configured form: ${FORM_ID}`, 'i'))).toBeInTheDocument();
        expect(screen.getByLabelText(/embed code/i)).toHaveValue('');
    });

    it('explains that invalid Tithe.ly input leaves Pay in Person available', () => {
        render(
            <TithelyConfigurationFields
                givingUrl="https://example.com/give"
                embedCode="<button>Give</button>"
                embedConfig={null}
                allowInPerson={true}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByRole('alert')).toHaveTextContent(/Pay in Person remains available/i);
    });
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```powershell
npm run test:run -- src/components/__tests__/TithelyConfigurationFields.test.jsx
```

Expected: FAIL because `TithelyConfigurationFields.jsx` does not exist.

- [ ] **Step 3: Implement the focused editor fields**

Create `src/components/TithelyConfigurationFields.jsx`:

```jsx
import React from 'react';
import { getTithelyDraftStatus } from '../utils/tithelyEmbed';
import Input from './ui/Input';
import Label from './ui/Label';

export default function TithelyConfigurationFields({
    givingUrl,
    embedCode,
    embedConfig,
    allowInPerson,
    onChange,
}) {
    const status = getTithelyDraftStatus({
        tithelyGivingUrl: givingUrl,
        tithelyEmbedCode: embedCode,
        tithelyEmbedConfig: embedConfig,
    });

    return (
        <div className="space-y-4 border-t border-slate-100 pt-4">
            <div>
                <Label htmlFor="event-tithely-url">Tithe.ly Giving Form URL</Label>
                <Input
                    id="event-tithely-url"
                    type="url"
                    value={givingUrl}
                    onChange={(event) => onChange('tithelyGivingUrl', event.target.value)}
                    placeholder="https://give.tithe.ly/?formId=..."
                />
            </div>
            <div>
                <Label htmlFor="event-tithely-embed">Tithe.ly Embed Code</Label>
                <textarea
                    id="event-tithely-embed"
                    value={embedCode}
                    onChange={(event) => onChange('tithelyEmbedCode', event.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="Paste the official Tithe.ly button and script code"
                />
                <p className="mt-1 text-xs text-slate-500">
                    The code is validated to identify the form. Pasted HTML and scripts are never stored or executed.
                </p>
            </div>
            {status.configured && (
                <p className="text-sm text-emerald-700">
                    Configured form: {status.embedConfig.formId}
                </p>
            )}
            {status.error && (givingUrl || embedCode || embedConfig) && (
                <p role="alert" className="text-sm text-amber-700">
                    {status.error}{allowInPerson ? ' Pay in Person remains available.' : ''}
                </p>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Wire the fields into `EventEditor.jsx`**

Add the import:

```jsx
import TithelyConfigurationFields from './TithelyConfigurationFields';
```

Add these values to the initial event state after `allowInPersonPayment`:

```js
tithelyGivingUrl: '',
tithelyEmbedCode: '',
tithelyEmbedConfig: null,
```

Add these values to the loaded event state after `allowInPersonPayment`:

```js
tithelyGivingUrl: data.tithely_giving_url || '',
tithelyEmbedCode: '',
tithelyEmbedConfig: data.tithely_embed_config || null,
```

After a successful create or update, before `setSaved(true)`, normalize the local editor state from the saved payload:

```js
setEvent((current) => ({
    ...current,
    tithelyGivingUrl: eventData.tithely_giving_url || '',
    tithelyEmbedCode: '',
    tithelyEmbedConfig: eventData.tithely_embed_config || null,
}));
```

Render the focused fields after the amount input and before the Pay in Person checkbox:

```jsx
<TithelyConfigurationFields
    givingUrl={event.tithelyGivingUrl}
    embedCode={event.tithelyEmbedCode}
    embedConfig={event.tithelyEmbedConfig}
    allowInPerson={event.allowInPersonPayment}
    onChange={handleChange}
/>
```

In `FormPreviewPane.jsx`, add the normalized values to `syntheticEvent` after `payment_enabled`:

```js
allow_in_person_payment: eventState.allowInPersonPayment || false,
tithely_giving_url: eventState.tithelyGivingUrl || null,
tithely_embed_config: eventState.tithelyEmbedConfig || null,
```

- [ ] **Step 5: Run focused editor and payload tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/TithelyConfigurationFields.test.jsx src/utils/__tests__/eventPayload.test.js
```

Expected: both test files pass.

- [ ] **Step 6: Commit the editor slice**

```powershell
git add src/components/TithelyConfigurationFields.jsx src/components/__tests__/TithelyConfigurationFields.test.jsx src/components/EventEditor.jsx src/components/FormPreviewPane.jsx
git commit -m "feat: configure Tithe.ly forms per event"
```

---

### Task 4: Add accessible pre-submission payment-method choice

**Files:**
- Create: `src/components/PaymentMethodChoice.jsx`
- Create: `src/components/__tests__/PaymentMethodChoice.test.jsx`
- Modify: `src/components/FormPreview.jsx:13-41,213-217`
- Modify: `src/components/__tests__/FormPreview.test.jsx`

- [ ] **Step 1: Write failing method-choice tests**

Create `src/components/__tests__/PaymentMethodChoice.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentMethodChoice from '../PaymentMethodChoice';

describe('PaymentMethodChoice', () => {
    it('requires a choice when both methods are available', () => {
        const onChange = vi.fn();
        render(
            <PaymentMethodChoice
                methods={['tithely', 'in_person']}
                value=""
                onChange={onChange}
                error="Choose a payment method"
            />
        );

        expect(screen.getByRole('group', { name: /payment method/i })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Choose a payment method');
        fireEvent.click(screen.getByRole('radio', { name: /Tithe.ly/i }));
        expect(onChange).toHaveBeenCalledWith('tithely');
    });

    it('summarizes a single automatically selected method', () => {
        render(
            <PaymentMethodChoice
                methods={['in_person']}
                value="in_person"
                onChange={vi.fn()}
            />
        );
        expect(screen.getByText(/Payment method: Pay in Person/i)).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });
});
```

Add this case to `src/components/__tests__/FormPreview.test.jsx`:

```jsx
it('renders the payment slot only on the final page', () => {
    render(
        <FormPreview
            event={baseEvent}
            readOnly={false}
            paymentSlot={<div>Choose Payment Method</div>}
        />
    );
    expect(screen.getByText('Choose Payment Method')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
npm run test:run -- src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/FormPreview.test.jsx
```

Expected: FAIL because the component and `paymentSlot` prop do not exist.

- [ ] **Step 3: Implement `PaymentMethodChoice.jsx`**

```jsx
import React from 'react';
import Card from './ui/Card';

const LABELS = {
    tithely: 'Tithe.ly',
    in_person: 'Pay in Person',
};

export default function PaymentMethodChoice({ methods, value, onChange, error = '' }) {
    if (!methods?.length) return null;

    if (methods.length === 1) {
        return (
            <Card className="p-4">
                <p className="text-sm font-medium text-slate-700">
                    Payment method: {LABELS[methods[0]]}
                </p>
            </Card>
        );
    }

    return (
        <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">Payment Method</legend>
            <div className="space-y-3">
                {methods.map((method) => (
                    <label key={method} className="flex cursor-pointer items-center gap-3">
                        <input
                            type="radio"
                            name="payment-method"
                            value={method}
                            checked={value === method}
                            onChange={() => onChange(method)}
                            className="h-4 w-4 text-primary focus:ring-primary/50"
                        />
                        <span className="text-sm text-slate-700">{LABELS[method]}</span>
                    </label>
                ))}
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </fieldset>
    );
}
```

- [ ] **Step 4: Add the last-page slot to `FormPreview.jsx`**

Add `paymentSlot` to the JSDoc and component arguments:

```jsx
 * @param {React.ReactNode} [props.paymentSlot] - Payment choice rendered on the last page
```

```jsx
paymentSlot,
```

Render it between the waiver slot and CAPTCHA slot:

```jsx
{/* Payment choice — only on last page */}
{isLastPage && paymentSlot}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/FormPreview.test.jsx
```

Expected: both test files pass.

- [ ] **Step 6: Commit the method-choice slice**

```powershell
git add src/components/PaymentMethodChoice.jsx src/components/__tests__/PaymentMethodChoice.test.jsx src/components/FormPreview.jsx src/components/__tests__/FormPreview.test.jsx
git commit -m "feat: choose registration payment method"
```

---

### Task 5: Replace the PayPal step with the pending Tithe.ly iframe handoff

**Files:**
- Create: `src/components/TithelyGivingForm.jsx`
- Create: `src/components/__tests__/TithelyGivingForm.test.jsx`
- Modify: `src/components/RegistrationPaymentStep.jsx:1-83`
- Replace: `src/components/__tests__/RegistrationPaymentStep.test.jsx`

- [ ] **Step 1: Write failing Tithe.ly form tests**

Create `src/components/__tests__/TithelyGivingForm.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TithelyGivingForm from '../TithelyGivingForm';

const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const event = {
    title: 'Fall Parking',
    payment_amount: 100,
    tithely_giving_url: `https://give.tithe.ly/?formId=${FORM_ID}`,
    tithely_embed_config: { formId: FORM_ID },
};

describe('TithelyGivingForm', () => {
    it('renders a titled iframe and safe fallback link', () => {
        render(<TithelyGivingForm event={event} onFinished={vi.fn()} />);

        expect(screen.getByTitle('Tithe.ly giving form for Fall Parking')).toHaveAttribute(
            'src',
            event.tithely_giving_url,
        );
        expect(screen.getByRole('link', { name: /open Tithe.ly in a new tab/i })).toHaveAttribute(
            'rel',
            'noopener noreferrer',
        );
        expect(screen.getByText('$100.00')).toBeInTheDocument();
        expect(screen.getByText(/remains pending until an administrator verifies/i)).toBeInTheDocument();
    });

    it('finishes locally without claiming payment verification', () => {
        const onFinished = vi.fn();
        render(<TithelyGivingForm event={event} onFinished={onFinished} />);
        fireEvent.click(screen.getByRole('button', { name: /I've finished with Tithe.ly/i }));
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid persisted provider data', () => {
        render(
            <TithelyGivingForm
                event={{ ...event, tithely_giving_url: 'https://example.com/give' }}
                onFinished={vi.fn()}
            />
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/Tithe.ly is unavailable/i);
        expect(screen.queryByTitle(/giving form/i)).not.toBeInTheDocument();
    });
});
```

Replace `src/components/__tests__/RegistrationPaymentStep.test.jsx` with:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../TithelyGivingForm', () => ({
    default: ({ onFinished }) => (
        <button onClick={onFinished}>I've finished with Tithe.ly</button>
    ),
}));

import RegistrationPaymentStep from '../RegistrationPaymentStep';

describe('RegistrationPaymentStep', () => {
    it('completes locally while preserving pending Tithe.ly state', () => {
        const registration = {
            id: 'reg-1',
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'tithely',
        };
        const onComplete = vi.fn();
        render(
            <RegistrationPaymentStep
                event={{ title: 'Fall Parking' }}
                registration={registration}
                onComplete={onComplete}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /finished with Tithe.ly/i }));
        expect(onComplete).toHaveBeenCalledWith(registration);
    });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
npm run test:run -- src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx
```

Expected: FAIL because the Tithe.ly component does not exist and the payment step still uses PayPal.

- [ ] **Step 3: Implement `TithelyGivingForm.jsx`**

```jsx
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { validateStoredTithelyConfiguration } from '../utils/tithelyEmbed';
import Button from './ui/Button';
import Card from './ui/Card';

export default function TithelyGivingForm({ event, onFinished }) {
    const configuration = validateStoredTithelyConfiguration(event);
    if (!configuration.valid) {
        return (
            <Card className="p-5">
                <p role="alert" className="text-sm text-red-600">
                    Tithe.ly is unavailable for this event. Please contact the organizer.
                </p>
            </Card>
        );
    }

    const amount = Number(event.payment_amount);
    return (
        <Card className="space-y-4 p-5">
            <div>
                <h2 className="text-lg font-semibold text-slate-900">Complete Your Gift with Tithe.ly</h2>
                {amount > 0 && <p className="mt-1 text-2xl font-bold text-slate-900">${amount.toFixed(2)}</p>}
                <p className="mt-2 text-sm text-slate-600">
                    Your payment remains pending until an administrator verifies the gift.
                </p>
            </div>
            <iframe
                src={configuration.givingUrl}
                title={`Tithe.ly giving form for ${event.title}`}
                className="min-h-[800px] w-full rounded-lg border border-slate-200"
            />
            <a
                href={configuration.givingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
                Open Tithe.ly in a new tab <ExternalLink className="h-4 w-4" />
            </a>
            <Button type="button" onClick={onFinished} className="w-full" size="lg">
                I've finished with Tithe.ly
            </Button>
        </Card>
    );
}
```

- [ ] **Step 4: Simplify `RegistrationPaymentStep.jsx`**

Replace its contents with:

```jsx
import React from 'react';
import TithelyGivingForm from './TithelyGivingForm';

export default function RegistrationPaymentStep({ event, registration, onComplete }) {
    return (
        <div className="mx-auto max-w-2xl">
            <TithelyGivingForm
                event={event}
                onFinished={() => onComplete?.(registration)}
            />
        </div>
    );
}
```

- [ ] **Step 5: Run focused Tithe.ly tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx
```

Expected: both test files pass and no Supabase payment update is invoked.

- [ ] **Step 6: Commit the Tithe.ly handoff slice**

```powershell
git add src/components/TithelyGivingForm.jsx src/components/__tests__/TithelyGivingForm.test.jsx src/components/RegistrationPaymentStep.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx
git commit -m "feat: embed pending Tithe.ly payment step"
```

---

### Task 6: Route every paid event through the selected method

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx:1-470`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`
- Modify: `src/components/SuccessState.jsx:1-59`

- [ ] **Step 1: Update the payment-step mock to preserve pending state**

In `EventRegistrationForm.test.jsx`, replace the existing `RegistrationPaymentStep` mock with:

```jsx
vi.mock('../RegistrationPaymentStep', () => ({
    default: ({ registration, onComplete }) => (
        <section>
            <h2>Complete Your Gift with Tithe.ly</h2>
            <button onClick={() => onComplete(registration)}>
                I've finished with Tithe.ly
            </button>
        </section>
    ),
}));
```

Add these fixtures near `makeEvent`:

```js
const TITHELY_FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const TITHELY_CONFIG = {
    tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
    tithely_embed_config: { formId: TITHELY_FORM_ID },
};
```

In `setupMocks`, replace the fixed `mockInsertSingle.mockResolvedValue(...)` block with an implementation that returns the method actually inserted:

```js
mockInsertSingle.mockImplementation(async () => {
    const inserted = mockInsert.mock.calls.at(-1)?.[0] || {};
    return {
        data: insertError ? null : {
            id: 'registration-1',
            status: 'confirmed',
            payment_status: inserted.payment_status,
            payment_method: inserted.payment_method,
        },
        error: insertError,
    };
});
```

- [ ] **Step 2: Add failing registration-flow tests**

Add these tests inside the existing `EventRegistrationForm` describe block:

```jsx
it('routes a confirmed standard Tithe.ly registration through the payment phase', async () => {
    setupMocks(makeEvent({
        payment_enabled: true,
        allow_in_person_payment: false,
        ...TITHELY_CONFIG,
    }));
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/complete your gift with Tithe.ly/i)).toBeInTheDocument();
    expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        payment_status: 'pending',
        payment_method: 'tithely',
    }));

    fireEvent.click(screen.getByRole('button', { name: /finished with Tithe.ly/i }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
});

it('requires a method choice when Tithe.ly and Pay in Person are available', async () => {
    setupMocks(makeEvent({
        payment_enabled: true,
        allow_in_person_payment: true,
        ...TITHELY_CONFIG,
    }));
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/choose a payment method/i);
    expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Pay in Person/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    await waitFor(() => expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        payment_method: 'in_person',
    })));
    expect(await screen.findByText(/pay in person/i)).toBeInTheDocument();
});

it('automatically uses Pay in Person when it is the only method', async () => {
    setupMocks(makeEvent({
        payment_enabled: true,
        allow_in_person_payment: true,
        tithely_giving_url: null,
        tithely_embed_config: null,
    }));
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    await waitFor(() => expect(supabase._mocks.mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        payment_method: 'in_person',
    })));
    expect(await screen.findByText(/pay in person/i)).toBeInTheDocument();
});

it('keeps a waitlisted Tithe.ly registration out of the payment phase', async () => {
    setupMocks(makeEvent({
        payment_enabled: true,
        allow_in_person_payment: false,
        waitlist_enabled: true,
        ...TITHELY_CONFIG,
    }));
    supabase._mocks.mockInsertSingle.mockResolvedValue({
        data: {
            id: 'registration-1',
            status: 'waitlisted',
            payment_status: 'pending',
            payment_method: 'tithely',
        },
        error: null,
    });
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/added to waitlist/i)).toBeInTheDocument();
    expect(screen.queryByText(/complete your gift with Tithe.ly/i)).not.toBeInTheDocument();
});
```

Update the existing paid parking test event to include `...TITHELY_CONFIG`. Before submitting, select the Tithe.ly radio because both methods are available:

```jsx
fireEvent.click(screen.getByRole('radio', { name: /Tithe.ly/i }));
fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
```

After local Tithe.ly completion, expect the final parking pass text to remain `Payment pending`, not `Valid`.

- [ ] **Step 3: Run the registration tests and verify they fail**

Run:

```powershell
npm run test:run -- src/components/__tests__/EventRegistrationForm.test.jsx
```

Expected: the new method-choice and standard-event cases fail against the parking-only PayPal flow.

- [ ] **Step 4: Wire method derivation and selection into `EventRegistrationForm.jsx`**

Add imports:

```jsx
import PaymentMethodChoice from './PaymentMethodChoice';
import { getAvailablePaymentMethods } from '../utils/tithelyEmbed';
```

Add state after `createdRegistration`:

```js
const [paymentMethod, setPaymentMethod] = useState('');
```

After `pages` is derived, add:

```js
const availablePaymentMethods = event ? getAvailablePaymentMethods(event) : [];
```

In the successful event-fetch branch, derive the initial selection immediately before `setEvent(data)`:

```js
const fetchedPaymentMethods = getAvailablePaymentMethods(data);
setPaymentMethod(fetchedPaymentMethods.length === 1 ? fetchedPaymentMethods[0] : '');
```

At the end of `validate`, before state setters, add:

```js
if (!fieldsToValidate && event?.payment_enabled && !paymentMethod) {
    newErrors._payment_method = 'Choose a payment method';
}
```

Change the registration insert field to:

```js
payment_method: event.payment_enabled ? paymentMethod : null,
```

Replace `requiresParkingPayment` with:

```js
const requiresTithelyPayment =
    created.status === 'confirmed'
    && event.payment_enabled === true
    && created.payment_method === 'tithely';
setPhase(requiresTithelyPayment ? 'payment' : 'success');
```

Add this `paymentSlot` prop to `FormPreview`:

```jsx
paymentSlot={
    event.payment_enabled
        ? (
            <PaymentMethodChoice
                methods={availablePaymentMethods}
                value={paymentMethod}
                onChange={(method) => {
                    setPaymentMethod(method);
                    setErrors((current) => {
                        const next = { ...current };
                        delete next._payment_method;
                        return next;
                    });
                }}
                error={errors._payment_method}
            />
        )
        : null
}
```

In `handleReset`, reset the method using the same single-method rule:

```js
setPaymentMethod(availablePaymentMethods.length === 1 ? availablePaymentMethods[0] : '');
```

- [ ] **Step 5: Add pending in-person confirmation copy**

In `SuccessState.jsx`, after the main confirmation paragraph and before the email paragraph, add:

```jsx
{!isWaitlisted
    && registration?.payment_status === 'pending'
    && registration?.payment_method === 'in_person'
    && (
        <p className="mb-2 text-sm font-medium text-slate-700">
            Payment is pending. Please pay in person as arranged with the organizer.
        </p>
    )}
```

- [ ] **Step 6: Run registration and payment component tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/EventRegistrationForm.test.jsx src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx src/components/__tests__/TithelyGivingForm.test.jsx
```

Expected: all four test files pass; standard and parking Tithe.ly completion remains pending.

- [ ] **Step 7: Commit the registrant-flow slice**

```powershell
git add src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/components/SuccessState.jsx
git commit -m "feat: route paid registrations by method"
```

---

### Task 7: Generalize administrator paid verification across event types

**Files:**
- Create: `src/utils/paymentStatus.js`
- Create: `src/utils/__tests__/paymentStatus.test.js`
- Modify: `src/components/ParkingRegistrationTable.jsx:31-78`
- Modify: `src/components/__tests__/ParkingRegistrationTable.test.jsx`
- Modify: `src/components/RegistrationViewer.jsx:106-128,267-285,426-478`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Write failing shared eligibility tests**

Create `src/utils/__tests__/paymentStatus.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { canMarkRegistrationPaid } from '../paymentStatus';

describe('canMarkRegistrationPaid', () => {
    it.each(['tithely', 'in_person'])('allows confirmed pending %s payments', (paymentMethod) => {
        expect(canMarkRegistrationPaid({
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: paymentMethod,
        })).toBe(true);
    });

    it.each([
        ['waitlisted registration', { status: 'waitlisted', payment_status: 'pending', payment_method: 'tithely' }],
        ['paid registration', { status: 'confirmed', payment_status: 'paid', payment_method: 'tithely' }],
        ['historical PayPal method', { status: 'confirmed', payment_status: 'pending', payment_method: 'paypal' }],
        ['missing method', { status: 'confirmed', payment_status: 'pending', payment_method: null }],
    ])('rejects a %s', (_name, registration) => {
        expect(canMarkRegistrationPaid(registration)).toBe(false);
    });
});
```

Add to `ParkingRegistrationTable.test.jsx`:

```jsx
it('allows confirmed pending Tithe.ly registrations to be marked paid', () => {
    const pendingRegistration = registration({
        payment_status: 'pending',
        payment_method: 'tithely',
    });
    const onMarkPaid = vi.fn();
    render(
        <ParkingRegistrationTable
            registrations={[pendingRegistration]}
            onView={vi.fn()}
            onMarkPaid={onMarkPaid}
            onPrintPass={vi.fn()}
        />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark Paid' }));
    expect(onMarkPaid).toHaveBeenCalledWith(pendingRegistration);
});
```

- [ ] **Step 2: Add failing standard-event administrator tests**

Add this test to `RegistrationViewer.test.jsx`:

```jsx
it('marks an eligible standard Tithe.ly registration paid', async () => {
    const pendingRegistration = {
        id: 'registration-1',
        status: 'confirmed',
        payment_status: 'pending',
        payment_method: 'tithely',
        form_data: { name: 'Alex' },
        signature_records: [],
    };
    const paidRegistration = { ...pendingRegistration, payment_status: 'paid' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [pendingRegistration], error: null });
    supabase.rpc.mockResolvedValue({ data: [paidRegistration], error: null });

    render(
        <RegistrationViewer
            orgId="org-1"
            eventId="event-1"
            event={event}
            onBack={vi.fn()}
        />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Paid' }));
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('mark_registration_paid', {
        p_registration_id: 'registration-1',
        p_org_id: 'org-1',
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /view/i }));
    expect(screen.getByText(/paid \(tithely\)/i)).toBeInTheDocument();
});
```

Update the existing parking RPC result to retain `payment_method: 'in_person'` instead of changing it to `in_person_verified`.

Also change the paid base fixture in `ParkingRegistrationTable.test.jsx` from `payment_method: 'paypal'` to `payment_method: 'tithely'`; historical PayPal values remain supported by production display code but should not remain a current payment-flow fixture.

- [ ] **Step 3: Run focused administrator tests and verify they fail**

Run:

```powershell
npm run test:run -- src/utils/__tests__/paymentStatus.test.js src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: failures show the missing helper, missing Tithe.ly eligibility, and missing standard-event action.

- [ ] **Step 4: Implement the shared eligibility predicate**

Create `src/utils/paymentStatus.js`:

```js
const VERIFIABLE_METHODS = new Set(['tithely', 'in_person']);

export function canMarkRegistrationPaid(registration) {
    return registration?.status === 'confirmed'
        && registration?.payment_status === 'pending'
        && VERIFIABLE_METHODS.has(registration?.payment_method);
}
```

In `ParkingRegistrationTable.jsx`, import the helper:

```js
import { canMarkRegistrationPaid } from '../utils/paymentStatus';
```

Replace the local three-condition `canMarkPaid` assignment with:

```js
const canMarkPaid = canMarkRegistrationPaid(registration);
```

- [ ] **Step 5: Expose the same action in `RegistrationViewer.jsx`**

Import the helper:

```js
import { canMarkRegistrationPaid } from '../utils/paymentStatus';
```

In the selected-registration action group, before Cancel Registration, render:

```jsx
{canMarkRegistrationPaid(selectedReg) && (
    <Button
        variant="success"
        size="sm"
        onClick={() => handleMarkPaid(selectedReg)}
    >
        Mark Paid
    </Button>
)}
```

In each standard-event table row, render this before View inside the Actions cell:

```jsx
{canMarkRegistrationPaid(reg) && (
    <button
        type="button"
        onClick={() => handleMarkPaid(reg)}
        className="mr-3 text-sm font-medium text-primary hover:text-primary-dark"
    >
        Mark Paid
    </button>
)}
```

Keep `handleMarkPaid`'s existing organization-scoped RPC call and state replacement. The generalized migration now returns the original selected method.

- [ ] **Step 6: Run focused administrator tests**

Run:

```powershell
npm run test:run -- src/utils/__tests__/paymentStatus.test.js src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/RegistrationViewer.test.jsx src/utils/__tests__/parkingRegistration.test.js src/utils/__tests__/parkingPass.test.js
```

Expected: all five test files pass; pending Tithe.ly and in-person methods are eligible, and parking passes remain invalid until paid.

- [ ] **Step 7: Commit the administrator slice**

```powershell
git add src/utils/paymentStatus.js src/utils/__tests__/paymentStatus.test.js src/components/ParkingRegistrationTable.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "feat: verify Tithe.ly payments in admin"
```

---

### Task 8: Remove PayPal and update current documentation

**Files:**
- Delete: `src/components/PaymentSection.jsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example:5-6`
- Modify: `README.md:3,12`

- [ ] **Step 1: Remove the PayPal package using npm**

Run:

```powershell
npm uninstall @paypal/react-paypal-js
```

Expected: npm removes the direct dependency and its unused transitive PayPal packages from `package-lock.json`.

- [ ] **Step 2: Delete the obsolete PayPal component**

Delete `src/components/PaymentSection.jsx` with `apply_patch`:

```diff
*** Delete File: src/components/PaymentSection.jsx
```

- [ ] **Step 3: Remove the PayPal environment example and update README claims**

Remove these lines from `.env.example`:

```text
# PayPal (optional — only needed if payment is enabled)
# VITE_PAYPAL_CLIENT_ID=your-paypal-client-id
```

Change the README opening sentence to:

```markdown
A dynamic, multi-tenant Event Registration System with secure forms, waiver signatures, waitlists, and Tithe.ly giving integration. Built with React 19, Tailwind CSS v4, and Supabase.
```

Change the Payments feature bullet to:

```markdown
- **Payments:** Optional per-event Tithe.ly giving forms with Pay in Person and administrator verification.
```

- [ ] **Step 4: Verify current runtime code and package metadata contain no PayPal integration**

Run:

```powershell
rg -n -i "paypal|VITE_PAYPAL_CLIENT_ID|@paypal" src package.json package-lock.json .env.example README.md
```

Expected: no matches. Historical specifications and old migrations are intentionally outside this search and remain unchanged.

- [ ] **Step 5: Run all payment-related tests**

Run:

```powershell
npm run test:run -- src/utils/__tests__/tithelyEmbed.test.js src/utils/__tests__/eventPayload.test.js src/utils/__tests__/paymentStatus.test.js src/components/__tests__/TithelyConfigurationFields.test.jsx src/components/__tests__/PaymentMethodChoice.test.jsx src/components/__tests__/TithelyGivingForm.test.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: all listed test files pass.

- [ ] **Step 6: Commit the removal and documentation slice**

```powershell
git add package.json package-lock.json .env.example README.md src/components/PaymentSection.jsx
git commit -m "chore: remove PayPal integration"
```

---

### Task 9: Run complete verification and browser acceptance checks

**Files:**
- Verify all changed files
- Modify only a directly implicated file if a verification failure proves a defect in this feature

- [ ] **Step 1: Run the complete test suite serially**

Run:

```powershell
npm run test:run
```

Expected: all Vitest files and tests pass with no worker-start timeout. Do not run lint or build concurrently with this command.

- [ ] **Step 2: Run lint after tests complete**

Run:

```powershell
npm run lint
```

Expected: exit code 0 with no ESLint errors. Do not add or broaden lint exclusions to make this pass.

- [ ] **Step 3: Run the production build after lint completes**

Run:

```powershell
npm run build
```

Expected: Vite completes a production build and writes `dist` assets without unresolved PayPal imports.

- [ ] **Step 4: Check the complete diff for hygiene and scope**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only the Tithe.ly payment flow, migration, PayPal removal, tests, and approved documentation are present; the worktree is clean after committed changes.

- [ ] **Step 5: Start the app for browser verification**

Do not perform write-path browser checks against production. Use an already authorized non-production Supabase project after the new migration has been applied there. If no such environment is available, stop after the automated gates and request explicit authorization before applying the migration anywhere; do not substitute production writes.

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Expected: Vite reports a local URL. Keep the process in its existing terminal session and do not launch a second dev server.

- [ ] **Step 6: Verify the Event Editor in a real browser**

Using the browser-testing skill required by the execution environment, verify:

1. A draft event accepts the current UMCK Giving Form URL and dashboard embed code.
2. Saving replaces the raw embed text with a configured form-ID summary.
3. An invalid Tithe.ly URL plus Pay in Person can save and clearly reports that only Pay in Person is usable.
4. An active payment-enabled event with neither method shows the exact activation error.
5. Reloading a configured event retains the URL and normalized form ID.

Expected: every item behaves as specified without console errors.

- [ ] **Step 7: Verify standard, parking, and fallback registrant flows**

Using disposable test events/registrations, verify:

1. Tithe.ly-only standard event: iframe and fallback link appear after confirmed registration.
2. Both-method standard event: method choice is required; Pay in Person skips the iframe and shows pending instructions.
3. Tithe.ly parking event: **I've finished with Tithe.ly** reaches confirmation but pass status remains **Payment pending**.
4. Waitlisted paid event: no payment iframe appears.
5. Narrow mobile viewport: iframe, fallback link, and completion button fit without horizontal overflow.
6. Open the fallback link in a new tab and confirm it reaches the same Tithe.ly form ID.

Expected: all flows match the pending-payment contract. Do not submit a real monetary transaction.

- [ ] **Step 8: Verify administrator paid state**

With an authenticated organization administrator and disposable registrations:

1. Mark one pending Tithe.ly standard registration paid.
2. Mark one pending in-person registration paid.
3. Confirm both retain their original method label and record paid status.
4. Confirm a paid parking registration becomes **Valid** and gains **Print Pass**.
5. Confirm unsupported or waitlisted registrations do not show **Mark Paid**.

Expected: only eligible organization-scoped registrations can be verified.

---

## Completion Boundary

Completion means the branch contains the reviewed migration and code, all automated checks pass serially, and the real browser flows above are verified. This plan does not authorize applying the migration to a live Supabase project, deploying Firebase Hosting, pushing the branch, opening a pull request, or merging. Those actions require a separate explicit user instruction.

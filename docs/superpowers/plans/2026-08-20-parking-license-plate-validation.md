# Parking License Plate Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize parking license plates and reject obvious placeholder values consistently in public registration, administrative editing, and authoritative Edge Function validation.

**Architecture:** A focused browser helper owns the stable parking-plate field ID, normalization, plausibility rules, and user-facing error. A mirrored Deno helper enforces the same contract server-side; both implementations consume one test-vector module to prevent drift. Existing dynamic-field rendering gains a generic blur callback, while only the protected `parking_license_plate` field receives specialized behavior.

**Tech Stack:** React 19, JavaScript, Deno TypeScript, Supabase Edge Functions, Vitest, Testing Library, ESLint

---

## File Map

- Create `test-fixtures/licensePlateValidationCases.js`: shared valid and invalid examples imported by browser and Edge Function tests.
- Create `src/utils/licensePlate.js`: browser-side field identity, normalization, plausibility validation, answer normalization, and error text.
- Create `src/utils/__tests__/licensePlate.test.js`: table-driven browser contract tests.
- Modify `src/config/eventPresets.js`: source the protected field ID from the focused helper.
- Modify `src/config/__tests__/eventPresets.test.js`: prove the preset retains the stable ID.
- Modify `src/components/DynamicField.jsx`: report text-input blur without embedding plate semantics.
- Modify `src/components/FormPreview.jsx`: carry the blur callback from the public form to `DynamicField`.
- Modify `src/components/__tests__/DynamicField.test.jsx`: cover the generic blur callback.
- Modify `src/components/EventRegistrationForm.jsx`: normalize on blur and before submission, and show the plate-specific error.
- Modify `src/components/__tests__/EventRegistrationForm.test.jsx`: cover normalization, rejection, and the submitted canonical value.
- Modify `src/utils/registrationAnswerForm.js`: validate and normalize protected plate answers in the admin utility layer.
- Modify `src/utils/__tests__/registrationAnswerForm.test.js`: cover admin utility validation and normalized answer preparation.
- Modify `src/components/RegistrationAnswerEditor.jsx`: normalize the protected field on blur before saving.
- Modify `src/components/__tests__/RegistrationAnswerEditor.test.jsx`: cover admin blur, error, and normalized save payload.
- Create `supabase/functions/_shared/license-plate.ts`: authoritative Deno normalization and plausibility rules.
- Create `supabase/functions/_shared/license-plate.test.ts`: table-driven Edge Function contract tests using the shared vectors.
- Modify `supabase/functions/_shared/registration-request.ts`: invoke plate validation by stable field ID and return the normalized stored value.
- Modify `supabase/functions/_shared/registration-request.test.ts`: prove new registrations store normalized plates and reject bypass attempts.
- Modify `supabase/functions/_shared/registration-answer-edit.test.ts`: prove admin edits validate and audit normalized plates while preserving legacy answers.

### Task 1: Define the Browser Plate Contract

**Files:**
- Create: `test-fixtures/licensePlateValidationCases.js`
- Create: `src/utils/licensePlate.js`
- Create: `src/utils/__tests__/licensePlate.test.js`
- Modify: `src/config/eventPresets.js:1-35`
- Modify: `src/config/__tests__/eventPresets.test.js`

- [ ] **Step 1: Add shared test vectors**

Create `test-fixtures/licensePlateValidationCases.js`:

```js
export const VALID_LICENSE_PLATE_CASES = Object.freeze([
  ['abc 123', 'ABC123'],
  ['abc-123', 'ABC123'],
  ['  kdm482  ', 'KDM482'],
  ['outatime', 'OUTATIME'],
  ['8042', '8042'],
  ['bird', 'BIRD'],
  ['t-e-m-p', 'TEMP'],
]);

export const INVALID_LICENSE_PLATE_CASES = Object.freeze([
  '', 'X', 'AB', 'ABCDEFGHI', 'ABC@123', 'ÅBC123',
  'XXX', 'AAAAAA', '111111',
  'TEST', 'TESTING', 'NONE', 'UNKNOWN', 'NOPLATE', 'NIL', 'NULL', 'PLATE', 'LICENSE',
  'ABC', 'ABCDEF', 'FEDCBA', '123', '123456', '654321',
  'QWE', 'QWERTY', 'ASDFGH', 'HGFDSA', 'ZXCVBN', 'NBVCXZ',
]);
```

- [ ] **Step 2: Write the failing browser helper tests**

Create `src/utils/__tests__/licensePlate.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  INVALID_LICENSE_PLATE_CASES,
  VALID_LICENSE_PLATE_CASES,
} from '../../../test-fixtures/licensePlateValidationCases';
import {
  LICENSE_PLATE_ERROR,
  PARKING_LICENSE_PLATE_FIELD_ID,
  isPlausibleLicensePlate,
  normalizeLicensePlate,
  normalizeParkingLicensePlateAnswers,
} from '../licensePlate';

describe('parking license plate contract', () => {
  it.each(VALID_LICENSE_PLATE_CASES)('normalizes and accepts %s', (input, expected) => {
    expect(normalizeLicensePlate(input)).toBe(expected);
    expect(isPlausibleLicensePlate(input)).toBe(true);
    expect(normalizeLicensePlate(expected)).toBe(expected);
  });

  it.each(INVALID_LICENSE_PLATE_CASES)('rejects %s', (input) => {
    expect(isPlausibleLicensePlate(input)).toBe(false);
  });

  it('normalizes only the protected answer when that field is present', () => {
    const fields = [
      { id: 'notes', type: 'text' },
      { id: PARKING_LICENSE_PLATE_FIELD_ID, type: 'text' },
    ];
    expect(normalizeParkingLicensePlateAnswers(fields, {
      notes: ' keep-this ',
      [PARKING_LICENSE_PLATE_FIELD_ID]: ' ab-c 123 ',
    })).toEqual({
      notes: ' keep-this ',
      [PARKING_LICENSE_PLATE_FIELD_ID]: 'ABC123',
    });
  });

  it('exports the approved error text', () => {
    expect(LICENSE_PLATE_ERROR).toBe(
      'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.',
    );
  });
});
```

- [ ] **Step 3: Run the helper tests to verify they fail**

Run:

```powershell
npx vitest run src/utils/__tests__/licensePlate.test.js --maxWorkers=1
```

Expected: FAIL because `src/utils/licensePlate.js` does not exist.

- [ ] **Step 4: Implement the browser helper**

Create `src/utils/licensePlate.js`:

```js
export const PARKING_LICENSE_PLATE_FIELD_ID = 'parking_license_plate';

export const LICENSE_PLATE_ERROR =
  'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.';

const PLACEHOLDERS = new Set([
  'TEST', 'TESTING', 'NONE', 'UNKNOWN', 'NOPLATE', 'NIL', 'NULL', 'PLATE', 'LICENSE',
]);
const RUNS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  'QWERTYUIOP',
  'ASDFGHJKL',
  'ZXCVBNM',
];

export function normalizeLicensePlate(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '')
    : '';
}

function isWholeRun(value) {
  return value.length >= 3 && RUNS.some((run) => (
    run.includes(value) || [...run].reverse().join('').includes(value)
  ));
}

export function isPlausibleLicensePlate(value) {
  const normalized = normalizeLicensePlate(value);
  if (normalized === 'TEMP') return true;
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) return false;
  if (/^([A-Z0-9])\1+$/.test(normalized)) return false;
  if (PLACEHOLDERS.has(normalized)) return false;
  return !isWholeRun(normalized);
}

export function normalizeParkingLicensePlateAnswers(fields = [], answers = {}) {
  const hasProtectedField = fields.some(
    (field) => field?.id === PARKING_LICENSE_PLATE_FIELD_ID,
  );
  if (!hasProtectedField || !Object.hasOwn(answers, PARKING_LICENSE_PLATE_FIELD_ID)) {
    return answers;
  }
  return {
    ...answers,
    [PARKING_LICENSE_PLATE_FIELD_ID]: normalizeLicensePlate(
      answers[PARKING_LICENSE_PLATE_FIELD_ID],
    ),
  };
}
```

In `src/config/eventPresets.js`, import the constant and use it as the existing registry value:

```js
import { PARKING_LICENSE_PLATE_FIELD_ID } from '../utils/licensePlate';

// inside PARKING_FIELD_IDS
LICENSE_PLATE: PARKING_LICENSE_PLATE_FIELD_ID,
```

Add this assertion to the parking-preset test in `src/config/__tests__/eventPresets.test.js`:

```js
expect(PARKING_FIELD_IDS.LICENSE_PLATE).toBe('parking_license_plate');
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npx vitest run src/utils/__tests__/licensePlate.test.js src/config/__tests__/eventPresets.test.js --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit the browser contract**

```powershell
git add -- test-fixtures/licensePlateValidationCases.js src/utils/licensePlate.js src/utils/__tests__/licensePlate.test.js src/config/eventPresets.js src/config/__tests__/eventPresets.test.js
git commit -m "feat: define parking plate validation contract"
```

### Task 2: Carry Blur Events Through Generic Form Rendering

**Files:**
- Modify: `src/components/DynamicField.jsx:17-57`
- Modify: `src/components/FormPreview.jsx:70-105,235-255`
- Modify: `src/components/__tests__/DynamicField.test.jsx`

- [ ] **Step 1: Write the failing blur callback test**

Add to `src/components/__tests__/DynamicField.test.jsx`:

```jsx
it('reports the field id and current text when a text input blurs', () => {
    const onBlur = vi.fn();
    render(
        <DynamicField
            field={{ id: 'plate', type: 'text', label: 'Plate' }}
            value="abc-123"
            onChange={mockOnChange}
            onBlur={onBlur}
        />
    );

    fireEvent.blur(screen.getByLabelText('Plate'));
    expect(onBlur).toHaveBeenCalledWith('plate', 'abc-123');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run src/components/__tests__/DynamicField.test.jsx --maxWorkers=1
```

Expected: FAIL because `DynamicField` does not report blur.

- [ ] **Step 3: Implement generic blur propagation**

Change the `DynamicField` signature and text-like input branch:

```jsx
export default function DynamicField({
    field,
    value,
    onChange,
    onBlur,
    error,
    disabled = false,
}) {
    // existing declarations remain
    const handleBlur = (currentValue) => {
        onBlur?.(id, currentValue);
    };

    // on the Input used by text, email, phone, and number
    <Input
        // existing props remain
        onBlur={(event) => handleBlur(event.target.value)}
    />
}
```

Add `onFieldBlur` to `FormPreview` documentation and props, then forward it without changing read-only behavior:

```jsx
const handleFieldBlur = (fieldId, value) => {
    if (!readOnly && onFieldBlur) onFieldBlur(fieldId, value);
};

<DynamicField
    field={field}
    value={formData[field.id]}
    onChange={handleFieldChange}
    onBlur={handleFieldBlur}
    error={errors[field.id]}
    disabled={readOnly}
/>
```

- [ ] **Step 4: Run the component test**

Run:

```powershell
npx vitest run src/components/__tests__/DynamicField.test.jsx --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit blur plumbing**

```powershell
git add -- src/components/DynamicField.jsx src/components/FormPreview.jsx src/components/__tests__/DynamicField.test.jsx
git commit -m "feat: propagate dynamic field blur events"
```

### Task 3: Enforce the Contract in Public Registration

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx:1-18,180-228,313-323,521-531`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`

- [ ] **Step 1: Write failing public-form tests**

Add this helper near `makeEvent` in `src/components/__tests__/EventRegistrationForm.test.jsx`:

```js
function makeParkingEvent() {
    return makeEvent({
        event_type: 'parking',
        form_fields: [
            ...makeEvent().form_fields,
            {
                id: 'parking_license_plate',
                type: 'text',
                label: 'License Plate',
                required: true,
                system: true,
            },
        ],
    });
}
```

Add these tests:

```jsx
it('normalizes a parking plate on blur and submits the canonical value', async () => {
    const user = userEvent.setup();
    setupMocks(makeParkingEvent());
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
    await completeRequiredFields();

    const plate = screen.getByLabelText(/license plate/i);
    await user.type(plate, ' ab-c 123 ');
    await user.tab();
    expect(plate).toHaveValue('ABC123');

    await user.click(screen.getByRole('button', { name: /submit registration/i }));
    await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith(
        'submit-registration',
        expect.objectContaining({
            body: expect.objectContaining({
                formData: expect.objectContaining({ parking_license_plate: 'ABC123' }),
            }),
        }),
    ));
});

it('rejects an obvious parking plate placeholder before submission', async () => {
    const user = userEvent.setup();
    setupMocks(makeParkingEvent());
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
    await completeRequiredFields();
    await user.type(screen.getByLabelText(/license plate/i), 'XXXXXX');
    await user.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/placeholder values are not accepted/i)).toBeInTheDocument();
    expect(supabase._mocks.mockInvoke).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the public-form tests to verify they fail**

Run:

```powershell
npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

Expected: FAIL because plate blur, plate-specific validation, and submission normalization are absent.

- [ ] **Step 3: Implement public-form normalization and validation**

Import the browser helper into `EventRegistrationForm.jsx`:

```js
import {
    LICENSE_PLATE_ERROR,
    PARKING_LICENSE_PLATE_FIELD_ID,
    isPlausibleLicensePlate,
    normalizeLicensePlate,
    normalizeParkingLicensePlateAnswers,
} from '../utils/licensePlate';
```

Add the focused blur handler:

```js
const handleFieldBlur = (fieldId, value) => {
    if (fieldId !== PARKING_LICENSE_PLATE_FIELD_ID) return;
    const normalized = normalizeLicensePlate(value);
    setFormData((current) => ({ ...current, [fieldId]: normalized }));
};
```

Inside the existing validation loop, after required validation, add:

```js
if (
    field.id === PARKING_LICENSE_PLATE_FIELD_ID
    && value
    && !isPlausibleLicensePlate(value)
) {
    newErrors[field.id] = LICENSE_PLATE_ERROR;
}
```

After building `cleanFormData` in `performSubmission`, normalize it once more and submit that result:

```js
const normalizedFormData = normalizeParkingLicensePlateAnswers(
    allVisibleFields,
    cleanFormData,
);

// request body
formData: normalizedFormData,
```

Pass `onFieldBlur={handleFieldBlur}` to `FormPreview`.

- [ ] **Step 4: Run the focused public-form tests**

Run:

```powershell
npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit public registration behavior**

```powershell
git add -- src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx
git commit -m "feat: validate parking plates during registration"
```

### Task 4: Enforce the Contract in Administrative Editing

**Files:**
- Modify: `src/utils/registrationAnswerForm.js:1-14,50-55,73-109`
- Modify: `src/utils/__tests__/registrationAnswerForm.test.js`
- Modify: `src/components/RegistrationAnswerEditor.jsx:1-70`
- Modify: `src/components/__tests__/RegistrationAnswerEditor.test.jsx`

- [ ] **Step 1: Write failing admin utility tests**

Use the protected ID in the existing conditional plate fixture in `registrationAnswerForm.test.js`, then add:

```js
it('rejects suspicious protected plates and prepares normalized answers', () => {
  const plateField = {
    id: 'parking_license_plate',
    type: 'text',
    label: 'License Plate',
    required: true,
  };

  expect(validateAnswerDraft([plateField], {
    parking_license_plate: 'XXXXXX',
  })).toEqual({
    parking_license_plate:
      'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.',
  });
  expect(prepareVisibleAnswers([plateField], {
    parking_license_plate: ' ab-c 123 ',
  })).toEqual({ parking_license_plate: 'ABC123' });
});

it('does not apply plate rules to an ordinary text field', () => {
  expect(validateAnswerDraft([
    { id: 'nickname', type: 'text', required: true },
  ], { nickname: 'XXXXXX' })).toEqual({});
});
```

- [ ] **Step 2: Run the admin utility tests to verify they fail**

Run:

```powershell
npx vitest run src/utils/__tests__/registrationAnswerForm.test.js --maxWorkers=1
```

Expected: FAIL because the utilities still treat the protected field as generic text.

- [ ] **Step 3: Implement admin utility validation and answer normalization**

Import the plate contract in `registrationAnswerForm.js`:

```js
import {
  LICENSE_PLATE_ERROR,
  PARKING_LICENSE_PLATE_FIELD_ID,
  isPlausibleLicensePlate,
  normalizeParkingLicensePlateAnswers,
} from './licensePlate';
```

Normalize the result from `prepareVisibleAnswers`:

```js
export function prepareVisibleAnswers(fields, formData = {}) {
  const visibleFields = getVisibleFields(fields, formData);
  const answers = Object.fromEntries(visibleFields.flatMap((field) => (
    Object.hasOwn(formData, field.id) ? [[field.id, formData[field.id]]] : []
  )));
  return normalizeParkingLicensePlateAnswers(visibleFields, answers);
}
```

At the start of `valueError`, add:

```js
if (
  field.id === PARKING_LICENSE_PLATE_FIELD_ID
  && !isPlausibleLicensePlate(value)
) {
  return LICENSE_PLATE_ERROR;
}
```

- [ ] **Step 4: Add failing editor interaction tests**

Change the plate fixture ID in `RegistrationAnswerEditor.test.jsx` to `parking_license_plate`, then add:

```jsx
it('normalizes the protected plate on blur and saves the normalized value', async () => {
  const user = userEvent.setup();
  const props = renderEditor({
    formFields: [{
      id: 'parking_license_plate',
      type: 'text',
      label: 'License Plate',
      required: true,
    }],
    savedFormData: { parking_license_plate: 'TEMP' },
  });
  const plate = screen.getByLabelText(/^License Plate/);
  await user.clear(plate);
  await user.type(plate, ' ab-c 123 ');
  await user.tab();
  expect(plate).toHaveValue('ABC123');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(props.onSave).toHaveBeenCalledWith({ parking_license_plate: 'ABC123' });
});

it('blocks an obvious protected-plate placeholder', async () => {
  const user = userEvent.setup();
  const props = renderEditor({
    formFields: [{
      id: 'parking_license_plate',
      type: 'text',
      label: 'License Plate',
      required: true,
    }],
    savedFormData: { parking_license_plate: 'TEMP' },
  });
  const plate = screen.getByLabelText(/^License Plate/);
  await user.clear(plate);
  await user.type(plate, 'XXXXXX');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(screen.getByText(/placeholder values are not accepted/i)).toBeInTheDocument();
  expect(props.onSave).not.toHaveBeenCalled();
});

it('shows an existing suspicious plate without reporting an error before save', () => {
  renderEditor({
    formFields: [{
      id: 'parking_license_plate',
      type: 'text',
      label: 'License Plate',
      required: true,
    }],
    savedFormData: { parking_license_plate: 'XXXXXX' },
  });
  expect(screen.getByLabelText(/^License Plate/)).toHaveValue('XXXXXX');
  expect(screen.queryByText(/placeholder values are not accepted/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement editor blur normalization**

Import the ID and normalizer into `RegistrationAnswerEditor.jsx`, add:

```js
const handleBlur = (fieldId, value) => {
    if (fieldId !== PARKING_LICENSE_PLATE_FIELD_ID) return;
    handleChange(fieldId, normalizeLicensePlate(value));
};
```

Then pass `onBlur={handleBlur}` to `DynamicField`.

- [ ] **Step 6: Run admin tests**

Run:

```powershell
npx vitest run src/utils/__tests__/registrationAnswerForm.test.js src/components/__tests__/RegistrationAnswerEditor.test.jsx --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit administrative editing behavior**

```powershell
git add -- src/utils/registrationAnswerForm.js src/utils/__tests__/registrationAnswerForm.test.js src/components/RegistrationAnswerEditor.jsx src/components/__tests__/RegistrationAnswerEditor.test.jsx
git commit -m "feat: validate parking plates during admin edits"
```

### Task 5: Make Edge Function Validation Authoritative

**Files:**
- Create: `supabase/functions/_shared/license-plate.ts`
- Create: `supabase/functions/_shared/license-plate.test.ts`
- Modify: `supabase/functions/_shared/registration-request.ts:1-35,210-252`
- Modify: `supabase/functions/_shared/registration-request.test.ts`
- Modify: `supabase/functions/_shared/registration-answer-edit.test.ts`

- [ ] **Step 1: Write the failing Deno helper contract test**

Create `supabase/functions/_shared/license-plate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  INVALID_LICENSE_PLATE_CASES,
  VALID_LICENSE_PLATE_CASES,
} from '../../../test-fixtures/licensePlateValidationCases.js';
import {
  isPlausibleLicensePlate,
  normalizeLicensePlate,
} from './license-plate.ts';

describe('Edge Function parking plate contract', () => {
  it.each(VALID_LICENSE_PLATE_CASES)('normalizes and accepts %s', (input, expected) => {
    expect(normalizeLicensePlate(input)).toBe(expected);
    expect(isPlausibleLicensePlate(input)).toBe(true);
  });

  it.each(INVALID_LICENSE_PLATE_CASES)('rejects %s', (input) => {
    expect(isPlausibleLicensePlate(input)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the Edge Function helper test to verify it fails**

Run:

```powershell
npx vitest run supabase/functions/_shared/license-plate.test.ts --maxWorkers=1
```

Expected: FAIL because `license-plate.ts` does not exist.

- [ ] **Step 3: Implement the Deno plate helper**

Create `supabase/functions/_shared/license-plate.ts` with the same pure contract as the browser helper:

```ts
export const PARKING_LICENSE_PLATE_FIELD_ID = 'parking_license_plate';

const PLACEHOLDERS = new Set([
  'TEST', 'TESTING', 'NONE', 'UNKNOWN', 'NOPLATE', 'NIL', 'NULL', 'PLATE', 'LICENSE',
]);
const RUNS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  'QWERTYUIOP',
  'ASDFGHJKL',
  'ZXCVBNM',
];

export function normalizeLicensePlate(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '')
    : '';
}

function isWholeRun(value: string): boolean {
  return value.length >= 3 && RUNS.some((run) => (
    run.includes(value) || [...run].reverse().join('').includes(value)
  ));
}

export function isPlausibleLicensePlate(value: unknown): boolean {
  const normalized = normalizeLicensePlate(value);
  if (normalized === 'TEMP') return true;
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) return false;
  if (/^([A-Z0-9])\1+$/.test(normalized)) return false;
  if (PLACEHOLDERS.has(normalized)) return false;
  return !isWholeRun(normalized);
}
```

- [ ] **Step 4: Add failing authoritative integration tests**

In `registration-request.test.ts`, add a parking field to a derived event and assert normalization plus direct bypass rejection:

```ts
it('normalizes plausible parking plates and rejects browser bypasses', () => {
  const parkingEvent = {
    ...baseEvent,
    form_fields: [
      ...baseEvent.form_fields,
      { id: 'parking_license_plate', type: 'text', required: true },
    ],
  };
  const requestWithPlate = (plate: string) => ({
    ...baseRequest,
    formData: { ...baseRequest.formData, parking_license_plate: plate },
  });

  expect(buildRegistrationInsert(
    parkingEvent,
    requestWithPlate(' ab-c 123 '),
    metadata,
  ).form_data.parking_license_plate).toBe('ABC123');
  expect(() => buildRegistrationInsert(
    parkingEvent,
    requestWithPlate('XXXXXX'),
    metadata,
  )).toThrow('invalid_request');
});
```

In `registration-answer-edit.test.ts`, use the stable protected ID in a focused event and add:

```ts
it('normalizes and audits a protected parking plate edit', () => {
  const parkingEvent = {
    ...event,
    form_fields: [
      ...event.form_fields,
      { id: 'parking_license_plate', type: 'text', label: 'License Plate', required: true },
    ],
  };
  const prepared = prepareRegistrationAnswerEdit(parkingEvent, {
    form_data: {
      name: 'Alex', email: 'alex@example.org', permit: 'No',
      parking_license_plate: 'TEMP', retired: 'keep me',
    },
  }, {
    name: 'Alex', email: 'alex@example.org', permit: 'No',
    parking_license_plate: ' ab-c 123 ',
  });

  expect(prepared.formData).toMatchObject({
    parking_license_plate: 'ABC123',
    retired: 'keep me',
  });
  expect(prepared.changes).toContainEqual({
    fieldId: 'parking_license_plate',
    fieldLabel: 'License Plate',
    before: 'TEMP',
    after: 'ABC123',
  });
  expect(() => prepareRegistrationAnswerEdit(parkingEvent, {
    form_data: prepared.formData,
  }, {
    name: 'Alex', email: 'alex@example.org', permit: 'No',
    parking_license_plate: 'XXXXXX',
  })).toThrow('invalid_request');
});
```

- [ ] **Step 5: Enforce the helper in current-form-data normalization**

Import the server helper at the top of `registration-request.ts`:

```ts
import {
  PARKING_LICENSE_PLATE_FIELD_ID,
  isPlausibleLicensePlate,
  normalizeLicensePlate,
} from './license-plate.ts';
```

At the start of the string-handling portion of `validateFieldValue`, before generic email, phone, date, and option rules, add:

```ts
if (field.id === PARKING_LICENSE_PLATE_FIELD_ID) {
  if (!isPlausibleLicensePlate(value)) invalidRequest();
  return normalizeLicensePlate(value);
}
```

This makes both `buildRegistrationInsert` and `prepareRegistrationAnswerEdit` authoritative because both already call `normalizeCurrentFormData`.

- [ ] **Step 6: Run focused Edge Function tests and static checks**

Run:

```powershell
npx vitest run supabase/functions/_shared/license-plate.test.ts supabase/functions/_shared/registration-request.test.ts supabase/functions/_shared/registration-answer-edit.test.ts --maxWorkers=1
deno lint supabase/functions/_shared/license-plate.ts supabase/functions/_shared/registration-request.ts
deno check supabase/functions/_shared/license-plate.ts supabase/functions/_shared/registration-request.ts
```

Expected: all Vitest files PASS; `deno lint` and `deno check` exit 0.

- [ ] **Step 7: Commit authoritative validation**

```powershell
git add -- supabase/functions/_shared/license-plate.ts supabase/functions/_shared/license-plate.test.ts supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-request.test.ts supabase/functions/_shared/registration-answer-edit.test.ts
git commit -m "feat: enforce parking plate validation server-side"
```

### Task 6: Verify the Complete Feature

**Files:**
- Verify: all files changed in Tasks 1–5

- [ ] **Step 1: Run all directly affected tests serially**

```powershell
npx vitest run src/utils/__tests__/licensePlate.test.js src/config/__tests__/eventPresets.test.js src/components/__tests__/DynamicField.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/utils/__tests__/registrationAnswerForm.test.js src/components/__tests__/RegistrationAnswerEditor.test.jsx supabase/functions/_shared/license-plate.test.ts supabase/functions/_shared/registration-request.test.ts supabase/functions/_shared/registration-answer-edit.test.ts src/utils/__tests__/parkingRegistration.test.js src/utils/__tests__/parkingPass.test.js src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js src/components/__tests__/ParkingRegistrationTable.test.jsx --maxWorkers=1
```

Expected: PASS. The existing parking table, pass, export, and report tests confirm consumers still read the canonical plate value without new formatting behavior.

- [ ] **Step 2: Run the full frontend and shared-function suite serially**

```powershell
npm run test:run -- --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run repository static verification**

```powershell
npm run lint
npm run build
deno lint supabase/functions/_shared/license-plate.ts supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-answer-edit.ts
deno check supabase/functions/_shared/license-plate.ts supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-answer-edit.ts
git diff --check origin/main...HEAD
```

Expected: each command exits 0; the build completes and the diff check prints no errors.

- [ ] **Step 4: Review the final diff against the approved boundaries**

Run:

```powershell
git status --short --branch
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: only the approved design, plan, validation helpers, shared test vectors, focused form/editor integrations, and their tests differ from `origin/main`; the worktree is clean.

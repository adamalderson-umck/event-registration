# Parking Registration Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parking as a first-class event type that reuses the existing registration substrate, captures one vehicle per registration, derives pass validity from payment, and prints one pass on 2.833-inch by 11-inch precut stock.

**Architecture:** Add a constrained `event_type` and a generic in-person-payment flag to events, then keep parking configuration in the existing event fields, waiver JSON, and registration form data. Isolate parking semantics in a preset/field registry, a pure pass-status helper, a focused admin table, and a print generator; standard events remain on their existing paths.

**Tech Stack:** React 19, JavaScript, Vite, Vitest 4, Testing Library, Supabase Postgres/Auth/RPC, PayPal React SDK, browser print CSS

---

## Scope Check

This is one cohesive beta rather than multiple independent products: create a typed parking event, accept a one-vehicle registration using existing waivers/capacity/waitlists, collect or verify payment, administer the record, and print a valid pass. Website integration, payment-provider redesign, post-promotion self-service payment, registration editing, and audit history remain outside this plan.

## File Structure

### Create

- `supabase/migrations/20260804_parking_registration_extension.sql`: event columns, constraints, and authenticated admin payment-verification RPC.
- `src/config/eventPresets.js`: standard system fields, parking field IDs, prototype parking rules, preset construction, and parking publish validation.
- `src/config/__tests__/eventPresets.test.js`: deterministic IDs, cloning, required fields, waiver, and validation coverage.
- `src/utils/parkingRegistration.js`: parking field lookup, vehicle formatting, and derived pass status.
- `src/utils/__tests__/parkingRegistration.test.js`: pass-state matrix and stable field lookup coverage.
- `src/utils/eventPayload.js`: pure event-editor state to Supabase payload mapping and parking publish validation.
- `src/utils/__tests__/eventPayload.test.js`: parking type, payment option, fields, waiver, and validation coverage.
- `src/components/EventTypeChooser.jsx`: Standard versus Parking creation choice.
- `src/components/__tests__/EventTypeChooser.test.jsx`: creation-choice behavior.
- `src/components/RegistrationPaymentStep.jsx`: online versus in-person payment choice for a newly created confirmed registration.
- `src/components/__tests__/RegistrationPaymentStep.test.jsx`: payment choice and failure behavior.
- `src/components/ParkingRegistrationTable.jsx`: parking-specific admin columns and row actions.
- `src/components/__tests__/ParkingRegistrationTable.test.jsx`: focused table, pass gating, and action callbacks.
- `src/utils/parkingPass.js`: safe pass HTML and single-stock browser print entry point.
- `src/utils/__tests__/parkingPass.test.js`: content, privacy, escaping, and physical page-size coverage.

### Modify

- `src/components/FormFieldBuilder.jsx`: preserve fields marked `system` during individual, bulk, and clear-all deletion.
- `src/components/__tests__/FormPreview.test.jsx`: run unchanged as regression coverage for seeded fields.
- `src/components/AdminDashboard.jsx`: creation chooser, initial event type, parking badge, parking table callbacks, and admin payment RPC.
- `src/components/EventEditor.jsx`: load/save the new event fields, initialize from the selected preset, expose in-person payment, and enforce parking publish requirements.
- `src/components/EventCard.jsx`: display a Parking badge on public event cards.
- `src/components/EventRegistrationForm.jsx`: use the inserted row returned by Supabase, trust its status, and route confirmed paid parking events into the payment step.
- `src/components/SuccessState.jsx`: parking-specific pass state and no calendar actions.
- `src/components/RegistrationViewer.jsx`: delegate parking events to the focused table and expose Mark Paid/Print Pass actions.
- `src/components/PaymentSection.jsx`: keep online capture behind the existing RPC and render actionable failures.
- `src/components/__tests__/EventRegistrationForm.test.jsx`: authoritative returned-status, waitlist, online, and in-person paths.
- `src/components/__tests__/RegistrationViewer.test.jsx`: parking delegation and payment-state refresh.
- `src/utils/__tests__/exportCsv.test.js`: parking field and status parity.
- `src/utils/__tests__/printReports.test.js`: parking field and status parity in existing reports.

## Task 1: Define the Parking Preset and Stable Field Contract

**Files:**
- Create: `src/config/eventPresets.js`
- Create: `src/config/__tests__/eventPresets.test.js`
- Modify: `src/components/EventEditor.jsx:38-76`

- [ ] **Step 1: Write the failing preset tests**

Create `src/config/__tests__/eventPresets.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
    EVENT_TYPES,
    PARKING_FIELD_IDS,
    createEventPreset,
    validateParkingEventDraft,
    validateParkingEventRecord,
} from '../eventPresets';

describe('createEventPreset', () => {
    it('keeps the standard preset on the existing three system fields', () => {
        const preset = createEventPreset(EVENT_TYPES.STANDARD);
        expect(preset.eventType).toBe('standard');
        expect(preset.formFields.map((field) => field.id)).toEqual([
            'system_first_name',
            'system_last_name',
            'system_email',
        ]);
        expect(preset.waivers).toEqual([]);
        expect(preset.paymentEnabled).toBe(false);
        expect(preset.allowInPersonPayment).toBe(false);
    });

    it('creates deterministic protected parking fields and one required waiver', () => {
        const preset = createEventPreset(EVENT_TYPES.PARKING);
        const ids = preset.formFields.map((field) => field.id);

        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(PARKING_FIELD_IDS.LICENSE_PLATE);
        expect(ids).toContain(PARKING_FIELD_IDS.VEHICLE_MAKE);
        expect(preset.formFields.find((field) => field.id === PARKING_FIELD_IDS.LICENSE_PLATE)).toMatchObject({
            required: true,
            system: true,
        });
        expect(preset.waivers).toEqual([
            expect.objectContaining({
                id: 'parking_rules_agreement',
                title: 'Parking Rules and Agreement',
                required: true,
            }),
        ]);
        expect(preset.paymentEnabled).toBe(true);
        expect(preset.allowInPersonPayment).toBe(true);
    });

    it('returns independent field and waiver copies', () => {
        const first = createEventPreset(EVENT_TYPES.PARKING);
        const second = createEventPreset(EVENT_TYPES.PARKING);
        first.formFields[0].label = 'Changed';
        first.waivers[0].title = 'Changed';
        expect(second.formFields[0].label).not.toBe('Changed');
        expect(second.waivers[0].title).toBe('Parking Rules and Agreement');
    });
});

describe('validateParkingEventDraft', () => {
    it('requires payments, a positive amount, and every protected parking field before publishing', () => {
        const preset = createEventPreset(EVENT_TYPES.PARKING);
        expect(validateParkingEventDraft({
            eventType: 'parking',
            paymentEnabled: true,
            paymentAmount: '100',
            formFields: preset.formFields,
            waivers: preset.waivers,
        })).toEqual([]);

        expect(validateParkingEventDraft({
            eventType: 'parking',
            paymentEnabled: false,
            paymentAmount: '',
            formFields: preset.formFields.filter((field) => field.id !== PARKING_FIELD_IDS.LICENSE_PLATE),
            waivers: [],
        })).toEqual(expect.arrayContaining([
            'Parking events require payment with a positive amount.',
            'Missing required parking field: License Plate.',
            'Parking events require the Parking Rules and Agreement waiver.',
        ]));
    });

    it('does not apply parking validation to standard events', () => {
        expect(validateParkingEventDraft({ eventType: 'standard' })).toEqual([]);
    });

    it('validates a persisted snake-case event record', () => {
        const preset = createEventPreset(EVENT_TYPES.PARKING);
        expect(validateParkingEventRecord({
            event_type: 'parking',
            payment_enabled: true,
            payment_amount: 100,
            form_fields: preset.formFields,
            waivers: preset.waivers,
        })).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the preset tests and verify RED**

Run:

```powershell
npm run test:run -- src/config/__tests__/eventPresets.test.js
```

Expected: FAIL because `src/config/eventPresets.js` does not exist.

- [ ] **Step 3: Implement the preset and validator**

Create `src/config/eventPresets.js` with these exports and exact field IDs:

```js
import { US_STATES } from './fieldTemplates';

export const EVENT_TYPES = Object.freeze({
    STANDARD: 'standard',
    PARKING: 'parking',
});

export const SYSTEM_FIELDS = Object.freeze([
    { id: 'system_first_name', type: 'text', label: 'Your First Name', required: true, system: true },
    { id: 'system_last_name', type: 'text', label: 'Your Last Name', required: true, system: true },
    { id: 'system_email', type: 'email', label: 'Your Email', required: true, system: true },
]);

export const PARKING_FIELD_IDS = Object.freeze({
    PHONE: 'parking_phone',
    LOCAL_STREET: 'parking_local_street',
    LOCAL_CITY: 'parking_local_city',
    LOCAL_STATE: 'parking_local_state',
    LOCAL_ZIP: 'parking_local_zip',
    PERMANENT_STREET: 'parking_permanent_street',
    PERMANENT_CITY: 'parking_permanent_city',
    PERMANENT_STATE: 'parking_permanent_state',
    PERMANENT_ZIP: 'parking_permanent_zip',
    VEHICLE_YEAR: 'parking_vehicle_year',
    VEHICLE_MAKE: 'parking_vehicle_make',
    VEHICLE_MODEL: 'parking_vehicle_model',
    VEHICLE_COLOR: 'parking_vehicle_color',
    LICENSE_PLATE: 'parking_license_plate',
    REGISTRATION_STATE: 'parking_registration_state',
    REGISTRATION_COUNTY: 'parking_registration_county',
    INSURANCE_PROVIDER: 'parking_insurance_provider',
});

const protectedField = (id, type, label, required = true, options) => ({
    id,
    type,
    label,
    required,
    system: true,
    placeholder: '',
    ...(options ? { options: [...options] } : {}),
});

const PARKING_FIELDS = Object.freeze([
    protectedField(PARKING_FIELD_IDS.PHONE, 'phone', 'Phone Number'),
    protectedField(PARKING_FIELD_IDS.LOCAL_STREET, 'text', 'Local Street Address'),
    protectedField(PARKING_FIELD_IDS.LOCAL_CITY, 'text', 'Local City'),
    protectedField(PARKING_FIELD_IDS.LOCAL_STATE, 'select', 'Local State', true, US_STATES),
    protectedField(PARKING_FIELD_IDS.LOCAL_ZIP, 'text', 'Local ZIP Code'),
    protectedField(PARKING_FIELD_IDS.PERMANENT_STREET, 'text', 'Permanent Street Address', false),
    protectedField(PARKING_FIELD_IDS.PERMANENT_CITY, 'text', 'Permanent City', false),
    protectedField(PARKING_FIELD_IDS.PERMANENT_STATE, 'select', 'Permanent State', false, US_STATES),
    protectedField(PARKING_FIELD_IDS.PERMANENT_ZIP, 'text', 'Permanent ZIP Code', false),
    protectedField(PARKING_FIELD_IDS.VEHICLE_YEAR, 'number', 'Vehicle Year', false),
    protectedField(PARKING_FIELD_IDS.VEHICLE_MAKE, 'text', 'Vehicle Make'),
    protectedField(PARKING_FIELD_IDS.VEHICLE_MODEL, 'text', 'Vehicle Model'),
    protectedField(PARKING_FIELD_IDS.VEHICLE_COLOR, 'text', 'Vehicle Color'),
    protectedField(PARKING_FIELD_IDS.LICENSE_PLATE, 'text', 'License Plate'),
    protectedField(PARKING_FIELD_IDS.REGISTRATION_STATE, 'select', 'Vehicle Registration State', true, US_STATES),
    protectedField(PARKING_FIELD_IDS.REGISTRATION_COUNTY, 'text', 'Vehicle Registration County'),
    protectedField(PARKING_FIELD_IDS.INSURANCE_PROVIDER, 'text', 'Insurance Provider'),
]);

const PARKING_RULES_HTML = `<ol>
<li>I understand that this parking pass is for the vehicle registered only and other vehicles must be registered.</li>
<li>I understand my vehicle must be removed from premises no later than Saturday evening and cannot be returned to the parking lot until 3:00 PM Sunday afternoon (violators will be towed).</li>
<li>I understand that parking at UMC of Kent is at my own risk and the church is not liable for any damage that may occur to my vehicle.</li>
<li>I understand that there will be no alcoholic beverages on the church premises.</li>
<li>I understand that the parking pass must be posted on the back window, driver's side, of my vehicle.</li>
<li>I understand this parking pass is for one semester only and a new pass must be obtained for each semester.</li>
<li>I understand parking is only permitted along the outside perimeter of the parking lot.</li>
<li>I understand that all donations made through the online giving portal are non-refundable.</li>
<li>I understand any violations will result in the loss of parking privileges with no refund.</li>
</ol>`;

const cloneField = (field) => ({
    ...field,
    options: Array.isArray(field.options) ? [...field.options] : field.options,
});

export function createEventPreset(eventType = EVENT_TYPES.STANDARD) {
    const parking = eventType === EVENT_TYPES.PARKING;
    return {
        eventType: parking ? EVENT_TYPES.PARKING : EVENT_TYPES.STANDARD,
        formFields: [...SYSTEM_FIELDS, ...(parking ? PARKING_FIELDS : [])].map(cloneField),
        waivers: parking ? [{
            id: 'parking_rules_agreement',
            title: 'Parking Rules and Agreement',
            content: PARKING_RULES_HTML,
            required: true,
            order: 0,
        }] : [],
        paymentEnabled: parking,
        paymentAmount: '',
        allowInPersonPayment: parking,
    };
}

export function validateParkingEventDraft(event) {
    if (event?.eventType !== EVENT_TYPES.PARKING) return [];
    const errors = [];
    if (!event.paymentEnabled || !(Number(event.paymentAmount) > 0)) {
        errors.push('Parking events require payment with a positive amount.');
    }
    const fields = Array.isArray(event.formFields) ? event.formFields : [];
    for (const field of PARKING_FIELDS.filter((item) => item.required)) {
        if (!fields.some((candidate) => candidate?.id === field.id && candidate.system === true)) {
            errors.push(`Missing required parking field: ${field.label}.`);
        }
    }
    const waivers = Array.isArray(event.waivers) ? event.waivers : [];
    if (!waivers.some((waiver) => waiver?.id === 'parking_rules_agreement' && waiver.required === true)) {
        errors.push('Parking events require the Parking Rules and Agreement waiver.');
    }
    return errors;
}

export function validateParkingEventRecord(event) {
    return validateParkingEventDraft({
        eventType: event?.event_type,
        paymentEnabled: event?.payment_enabled,
        paymentAmount: event?.payment_amount,
        formFields: event?.form_fields,
        waivers: event?.waivers,
    });
}
```

- [ ] **Step 4: Replace EventEditor's local system-field constant**

In `src/components/EventEditor.jsx`, import `SYSTEM_FIELDS` from `../config/eventPresets` and delete the local `SYSTEM_FIELDS` declaration. Keep the existing missing-system-field recovery behavior unchanged.

```js
import { SYSTEM_FIELDS } from '../config/eventPresets';
```

- [ ] **Step 5: Run focused and regression tests**

Run:

```powershell
npm run test:run -- src/config/__tests__/eventPresets.test.js src/components/__tests__/FormPreview.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx
```

Expected: PASS for all selected files.

- [ ] **Step 6: Commit the preset contract**

```powershell
git add src/config/eventPresets.js src/config/__tests__/eventPresets.test.js src/components/EventEditor.jsx
git commit -m "feat: define parking event preset"
```

## Task 2: Protect System Fields and Add Event-Type Creation

**Files:**
- Modify: `src/components/FormFieldBuilder.jsx:61-145,215-245`
- Create: `src/components/__tests__/FormFieldBuilder.test.jsx`
- Create: `src/components/EventTypeChooser.jsx`
- Create: `src/components/__tests__/EventTypeChooser.test.jsx`
- Modify: `src/components/AdminDashboard.jsx:21-29,234-244,385-398`
- Modify: `src/components/EventEditor.jsx:44-76`

- [ ] **Step 1: Write failing protected-field tests**

Create `src/components/__tests__/FormFieldBuilder.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FormFieldBuilder from '../FormFieldBuilder';

describe('FormFieldBuilder protected fields', () => {
    const fields = [
        { id: 'system_first_name', type: 'text', label: 'First Name', system: true, required: true },
        { id: 'parking_license_plate', type: 'text', label: 'License Plate', system: true, required: true },
        { id: 'custom_notes', type: 'text', label: 'Notes', required: false },
    ];

    it('clear all preserves protected fields', () => {
        const onChange = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<FormFieldBuilder fields={fields} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        expect(onChange).toHaveBeenCalledWith(fields.filter((field) => field.system));
    });

    it('does not render individual delete controls for protected fields', () => {
        render(<FormFieldBuilder fields={fields} onChange={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Delete License Plate' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Notes' })).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the protected-field tests and verify RED**

Run:

```powershell
npm run test:run -- src/components/__tests__/FormFieldBuilder.test.jsx
```

Expected: FAIL because Clear All currently returns an empty array and protected fields still participate in bulk selection.

- [ ] **Step 3: Preserve protected fields in every deletion path**

In `src/components/FormFieldBuilder.jsx`, make the selection checkbox conditional, guard individual removal, and preserve protected fields in bulk actions:

```jsx
{!field.system && (
    <input
        aria-label={`Select ${field.label} for deletion`}
        type="checkbox"
        checked={isChecked}
        onChange={() => onToggleCheck(field.id)}
        onClick={(event) => event.stopPropagation()}
        className="w-4 h-4 cursor-pointer accent-primary rounded border-slate-300 shrink-0"
    />
)}
```

Add an accessible name to the existing custom-field trash button:

```jsx
<button
    aria-label={`Delete ${field.label}`}
    onClick={(event) => { event.stopPropagation(); onRemove(field.id); }}
    className="text-slate-300 hover:text-danger shrink-0 cursor-pointer"
>
    <Trash2 className="w-4 h-4" />
</button>
```

```js
const removeField = (fieldId) => {
    const target = fields.find((field) => field.id === fieldId);
    if (target?.system) return;
    onChange(fields.filter((field) => field.id !== fieldId));
    if (selectedField?.id === fieldId) setSelectedField(null);
    setCheckedIds((current) => {
        const next = new Set(current);
        next.delete(fieldId);
        return next;
    });
};

const handleClearAll = () => {
    if (window.confirm('Remove all custom fields? Protected fields will remain.')) {
        onChange(fields.filter((field) => field.system));
        setSelectedField(null);
        setCheckedIds(new Set());
    }
};

const handleRemoveChecked = () => {
    onChange(fields.filter((field) => field.system || !checkedIds.has(field.id)));
    if (selectedField && !selectedField.system && checkedIds.has(selectedField.id)) {
        setSelectedField(null);
    }
    setCheckedIds(new Set());
};
```

- [ ] **Step 4: Write the failing event-type chooser test**

Create `src/components/__tests__/EventTypeChooser.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EventTypeChooser from '../EventTypeChooser';

describe('EventTypeChooser', () => {
    it('returns the selected event type and can cancel', () => {
        const onChoose = vi.fn();
        const onCancel = vi.fn();
        render(<EventTypeChooser onChoose={onChoose} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: /parking registration/i }));
        expect(onChoose).toHaveBeenCalledWith('parking');
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 5: Run the chooser test and verify RED**

Run:

```powershell
npm run test:run -- src/components/__tests__/EventTypeChooser.test.jsx
```

Expected: FAIL because `EventTypeChooser.jsx` does not exist.

- [ ] **Step 6: Implement the focused chooser**

Create `src/components/EventTypeChooser.jsx` as a modal/card with two buttons. Its behavior must be exactly this interface:

```jsx
import React from 'react';
import { CalendarDays, Car, X } from 'lucide-react';
import { EVENT_TYPES } from '../config/eventPresets';
import Button from './ui/Button';
import Card from './ui/Card';

export default function EventTypeChooser({ onChoose, onCancel }) {
    return (
        <Card className="max-w-2xl mx-auto p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Create Event</h2>
                    <p className="text-sm text-slate-500">Choose the registration starting point.</p>
                </div>
                <Button variant="ghost" onClick={onCancel} aria-label="Cancel"><X className="w-4 h-4" /></Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <button type="button" onClick={() => onChoose(EVENT_TYPES.STANDARD)} className="text-left border rounded-xl p-5 hover:border-primary">
                    <CalendarDays className="w-6 h-6 text-primary mb-3" />
                    <span className="block font-semibold">Standard Event</span>
                    <span className="block text-sm text-slate-500">Start with the existing core fields.</span>
                </button>
                <button type="button" onClick={() => onChoose(EVENT_TYPES.PARKING)} className="text-left border rounded-xl p-5 hover:border-primary">
                    <Car className="w-6 h-6 text-primary mb-3" />
                    <span className="block font-semibold">Parking Registration</span>
                    <span className="block text-sm text-slate-500">Start with driver, vehicle, payment, and parking agreement defaults.</span>
                </button>
            </div>
        </Card>
    );
}
```

- [ ] **Step 7: Wire the chooser into AdminDashboard and the preset into EventEditor**

Add `newEventType` state to `AdminDashboard`, show the chooser before a new editor, and pass the selection into `EventEditor`:

```js
const [newEventType, setNewEventType] = useState(null);
```

```jsx
{subView === 'choose-event-type' && (
    <EventTypeChooser
        onChoose={(eventType) => {
            setNewEventType(eventType);
            setSelectedEventId(null);
            setSubView('editor');
        }}
        onCancel={() => setSubView(null)}
    />
)}
```

Change Create Event to set `subView` to `choose-event-type`, and pass:

```jsx
<EventEditor
    orgId={currentOrg.id}
    eventId={selectedEventId}
    initialEventType={selectedEventId ? null : newEventType}
    onBack={() => {
        setSubView(null);
        setNewEventType(null);
    }}
/>
```

In `EventEditor`, accept `initialEventType = EVENT_TYPES.STANDARD`, call `createEventPreset(initialEventType)`, and initialize `eventType`, `formFields`, `waivers`, `paymentEnabled`, `paymentAmount`, and `allowInPersonPayment` from that preset. Existing event loads must overwrite those values from the database.

- [ ] **Step 8: Run the focused tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/FormFieldBuilder.test.jsx src/components/__tests__/EventTypeChooser.test.jsx src/config/__tests__/eventPresets.test.js
```

Expected: PASS for all selected files.

- [ ] **Step 9: Commit protected fields and creation choice**

```powershell
git add src/components/FormFieldBuilder.jsx src/components/__tests__/FormFieldBuilder.test.jsx src/components/EventTypeChooser.jsx src/components/__tests__/EventTypeChooser.test.jsx src/components/AdminDashboard.jsx src/components/EventEditor.jsx
git commit -m "feat: add parking event creation choice"
```

## Task 3: Persist Parking Type and In-Person Payment Configuration

**Files:**
- Create: `supabase/migrations/20260804_parking_registration_extension.sql`
- Create: `src/utils/eventPayload.js`
- Create: `src/utils/__tests__/eventPayload.test.js`
- Modify: `src/components/EventEditor.jsx:93-129,197-260,456-495`
- Modify: `src/components/EventCard.jsx:35-41`
- Create: `src/components/__tests__/EventCard.test.jsx`

- [ ] **Step 1: Create the database migration**

Create `supabase/migrations/20260804_parking_registration_extension.sql`:

```sql
ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS event_type text;

UPDATE public.events
SET event_type = 'standard'
WHERE event_type IS NULL;

ALTER TABLE public.events
    ALTER COLUMN event_type SET DEFAULT 'standard',
    ALTER COLUMN event_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'events_event_type_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_event_type_check
            CHECK (event_type IN ('standard', 'parking'));
    END IF;
END $$;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS allow_in_person_payment boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.mark_registration_paid(
    p_registration_id uuid,
    p_org_id uuid
)
RETURNS SETOF public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        payment_method = 'in_person_verified',
        payment_details = COALESCE(payment_details, '{}'::jsonb) || jsonb_build_object(
            'verifiedAt', now(),
            'verifiedBy', auth.uid()
        )
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status = 'confirmed'
      AND payment_status = 'pending'
      AND payment_method = 'in_person'
    RETURNING *;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration is not an eligible pending in-person payment';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated;
```

- [ ] **Step 2: Write failing event-payload tests**

Create `src/utils/__tests__/eventPayload.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createEventPreset } from '../../config/eventPresets';
import { buildDuplicateEventPayload, buildEventPayload } from '../eventPayload';

const parkingDraft = (overrides = {}) => {
    const preset = createEventPreset('parking');
    return {
        title: 'Fall 2026 Parking',
        slug: 'fall-2026-parking',
        description: '',
        location: '',
        startDate: '2026-08-20T08:00',
        endDate: '2026-12-15T18:00',
        registrationCloseDate: '2026-09-01T18:00',
        status: 'active',
        capacity: '50',
        waitlistEnabled: true,
        paymentEnabled: true,
        paymentAmount: '100',
        allowInPersonPayment: true,
        eventType: 'parking',
        formFields: preset.formFields,
        waivers: preset.waivers,
        notifications: { organizers: ['admin@example.org'], perRegistration: false, weeklyDigest: false, digestDay: 'monday' },
        reminderHoursBefore: '',
        headerImageUrl: null,
        theme: null,
        ...overrides,
    };
};

describe('buildEventPayload', () => {
    it('persists the parking type, payment option, protected fields, and waiver', async () => {
        const payload = await buildEventPayload(parkingDraft(), 'org-1');
        expect(payload).toMatchObject({
            event_type: 'parking',
            allow_in_person_payment: true,
            payment_enabled: true,
            payment_amount: 100,
            org_id: 'org-1',
        });
        expect(payload.form_fields).toContainEqual(expect.objectContaining({ id: 'parking_license_plate', system: true }));
        expect(payload.waivers).toEqual([expect.objectContaining({ id: 'parking_rules_agreement', required: true, order: 0 })]);
        expect(payload.waivers[0].contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('rejects an active parking event without valid payment configuration', async () => {
        await expect(buildEventPayload(parkingDraft({ paymentEnabled: false, paymentAmount: '' }), 'org-1'))
            .rejects.toThrow('Parking events require payment with a positive amount.');
    });

    it('duplicates parking configuration while resetting identity and counts', () => {
        const duplicate = buildDuplicateEventPayload({
            id: 'event-1',
            title: 'Fall Parking',
            slug: 'fall-parking',
            event_type: 'parking',
            allow_in_person_payment: true,
            registration_count: 10,
            waitlist_count: 2,
            reminder_sent_at: '2026-08-01T12:00:00Z',
        });
        expect(duplicate).toMatchObject({
            title: 'Fall Parking (Copy)',
            slug: null,
            event_type: 'parking',
            allow_in_person_payment: true,
            status: 'draft',
            registration_count: 0,
            waitlist_count: 0,
            reminder_sent_at: null,
        });
        expect(duplicate.id).toBeUndefined();
    });
});
```

- [ ] **Step 3: Run event-payload tests and verify RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/eventPayload.test.js
```

Expected: FAIL because `src/utils/eventPayload.js` does not exist.

- [ ] **Step 4: Implement the complete event payload mapper**

Create `src/utils/eventPayload.js`:

```js
import { validateParkingEventDraft } from '../config/eventPresets';
import { sha256 } from './hashContent';

export async function buildEventPayload(event, orgId) {
    if (event.status === 'active') {
        const [firstError] = validateParkingEventDraft(event);
        if (firstError) throw new Error(firstError);
    }

    return {
        title: event.title.trim(),
        slug: event.slug.trim() || null,
        description: event.description.trim(),
        location: event.location.trim(),
        start_date: event.startDate || null,
        end_date: event.endDate || null,
        registration_close_date: event.registrationCloseDate || null,
        status: event.status,
        event_type: event.eventType,
        capacity: event.capacity ? parseInt(event.capacity, 10) : null,
        waitlist_enabled: event.waitlistEnabled,
        payment_enabled: event.paymentEnabled,
        payment_amount: event.paymentAmount ? parseFloat(event.paymentAmount) : null,
        allow_in_person_payment: event.allowInPersonPayment,
        form_fields: event.formFields,
        notifications: {
            organizers: event.notifications.organizers.filter((email) => email.trim() !== ''),
            perRegistration: event.notifications.perRegistration,
            weeklyDigest: event.notifications.weeklyDigest,
            digestDay: event.notifications.digestDay,
        },
        reminder_hours_before: event.reminderHoursBefore ? parseInt(event.reminderHoursBefore, 10) : null,
        waivers: await Promise.all(event.waivers.map(async (waiver, index) => ({
            ...waiver,
            title: waiver.title.trim(),
            contentHash: await sha256(waiver.content || ''),
            order: index,
        }))),
        header_image_url: event.headerImageUrl,
        theme: event.theme,
        org_id: orgId,
    };
}

export function buildDuplicateEventPayload(sourceEvent) {
    const {
        id: _id,
        created_at: _createdAt,
        updated_at: _updatedAt,
        registration_count: _registrationCount,
        waitlist_count: _waitlistCount,
        reminder_sent_at: _reminderSentAt,
        slug: _slug,
        ...configuration
    } = sourceEvent;
    return {
        ...configuration,
        title: `${sourceEvent.title} (Copy)`,
        slug: null,
        status: 'draft',
        registration_count: 0,
        waitlist_count: 0,
        reminder_sent_at: null,
    };
}
```

- [ ] **Step 5: Load, render, validate, and save the new fields**

In `EventEditor.jsx`:

- Map `data.event_type || 'standard'` to `eventType`.
- Map `!!data.allow_in_person_payment` to `allowInPersonPayment`.
- Import `buildEventPayload` from `../utils/eventPayload` and remove the direct `sha256` import.
- Replace the inline `eventData` construction with `const eventData = await buildEventPayload(event, orgId)` inside the existing `try` block. The caught validation error continues through the existing error surface.
- Under Amount, render this only while payment is enabled:

```jsx
<Checkbox
    label="Allow payment in person"
    checked={event.allowInPersonPayment}
    onChange={(changeEvent) => handleChange('allowInPersonPayment', changeEvent.target.checked)}
/>
```

Do not render an event-type switch for existing events. Show a read-only Parking badge in the editor heading when `event.eventType === 'parking'`.

- [ ] **Step 6: Block dashboard activation that bypasses the editor**

Import `validateParkingEventRecord` in `AdminDashboard.jsx`. At the start of `handleStatusChange`, before the optimistic update, add:

```js
const targetEvent = events.find((event) => event.id === eventId);
if (newStatus === 'active') {
    const [validationError] = validateParkingEventRecord(targetEvent);
    if (validationError) {
        setDashboardError(validationError);
        setTimeout(() => setDashboardError(''), 4000);
        return;
    }
}
```

This closes the publish-validation bypass in the dashboard status dropdown.

Also import `buildDuplicateEventPayload` from `../utils/eventPayload` and replace the inline field-stripping logic in `handleDuplicate` with:

```js
const newEvent = buildDuplicateEventPayload(sourceEvent);
```

The unit test above proves that the parking type and in-person configuration survive duplication while identity, slug, status, counts, and reminder state reset.

- [ ] **Step 7: Add and test parking badges**

Create `src/components/__tests__/EventCard.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventCard from '../EventCard';

describe('EventCard', () => {
    it('labels parking events without labeling standard events', () => {
        const { rerender } = render(<EventCard event={{ title: 'Fall Parking', event_type: 'parking' }} onSelect={vi.fn()} />);
        expect(screen.getByText('Parking')).toBeInTheDocument();
        rerender(<EventCard event={{ title: 'Dinner', event_type: 'standard' }} onSelect={vi.fn()} />);
        expect(screen.queryByText('Parking')).not.toBeInTheDocument();
    });
});
```

Render the badge next to the title in `EventCard` and next to the title in the dashboard event list:

```jsx
{event.event_type === 'parking' && (
    <span className="text-xs font-semibold rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">Parking</span>
)}
```

- [ ] **Step 8: Run focused tests and inspect migration**

Run:

```powershell
npm run test:run -- src/utils/__tests__/eventPayload.test.js src/components/__tests__/EventCard.test.jsx src/config/__tests__/eventPresets.test.js
git diff --check
```

Expected: tests PASS and `git diff --check` produces no output.

- [ ] **Step 9: Commit persistence and editor behavior**

```powershell
git add supabase/migrations/20260804_parking_registration_extension.sql src/utils/eventPayload.js src/utils/__tests__/eventPayload.test.js src/components/EventEditor.jsx src/components/EventCard.jsx src/components/__tests__/EventCard.test.jsx src/components/AdminDashboard.jsx
git commit -m "feat: persist parking event configuration"
```

## Task 4: Derive Parking Values and Pass State

**Files:**
- Create: `src/utils/parkingRegistration.js`
- Create: `src/utils/__tests__/parkingRegistration.test.js`

- [ ] **Step 1: Write the failing utility tests**

Create `src/utils/__tests__/parkingRegistration.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import {
    PARKING_PASS_STATUS,
    getParkingFieldValue,
    getParkingPassStatus,
    getParkingVehicleLabel,
} from '../parkingRegistration';

const registration = (overrides = {}) => ({
    status: 'confirmed',
    payment_status: 'paid',
    form_data: {
        [PARKING_FIELD_IDS.VEHICLE_YEAR]: '2024',
        [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
        [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
        [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
        [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC 123',
    },
    ...overrides,
});

describe('parking registration helpers', () => {
    it('reads parking values by stable ID and formats the vehicle', () => {
        const record = registration();
        expect(getParkingFieldValue(record, PARKING_FIELD_IDS.LICENSE_PLATE)).toBe('ABC 123');
        expect(getParkingVehicleLabel(record)).toBe('2024 Blue Honda Civic');
    });

    it.each([
        ['confirmed', 'paid', PARKING_PASS_STATUS.VALID],
        ['confirmed', 'pending', PARKING_PASS_STATUS.PAYMENT_PENDING],
        ['waitlisted', 'paid', PARKING_PASS_STATUS.WAITLISTED],
        ['waitlisted', 'pending', PARKING_PASS_STATUS.WAITLISTED],
        ['cancelled', 'paid', PARKING_PASS_STATUS.INVALID],
        ['pending', 'paid', PARKING_PASS_STATUS.INVALID],
    ])('maps %s and %s to %s', (status, paymentStatus, expected) => {
        expect(getParkingPassStatus(registration({ status, payment_status: paymentStatus }))).toBe(expected);
    });
});
```

- [ ] **Step 2: Run the utility test and verify RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingRegistration.test.js
```

Expected: FAIL because `parkingRegistration.js` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `src/utils/parkingRegistration.js`:

```js
import { PARKING_FIELD_IDS } from '../config/eventPresets';

export const PARKING_PASS_STATUS = Object.freeze({
    VALID: 'Valid',
    PAYMENT_PENDING: 'Payment pending',
    WAITLISTED: 'Waitlisted',
    INVALID: 'Invalid',
});

export function getParkingFieldValue(registration, fieldId) {
    const value = registration?.form_data?.[fieldId];
    return value == null ? '' : String(value).trim();
}

export function getParkingVehicleLabel(registration) {
    return [
        getParkingFieldValue(registration, PARKING_FIELD_IDS.VEHICLE_YEAR),
        getParkingFieldValue(registration, PARKING_FIELD_IDS.VEHICLE_COLOR),
        getParkingFieldValue(registration, PARKING_FIELD_IDS.VEHICLE_MAKE),
        getParkingFieldValue(registration, PARKING_FIELD_IDS.VEHICLE_MODEL),
    ].filter(Boolean).join(' ');
}

export function getParkingPassStatus(registration) {
    if (registration?.status === 'waitlisted') return PARKING_PASS_STATUS.WAITLISTED;
    if (registration?.status !== 'confirmed') return PARKING_PASS_STATUS.INVALID;
    if (registration?.payment_status === 'paid') return PARKING_PASS_STATUS.VALID;
    if (registration?.payment_status === 'pending') return PARKING_PASS_STATUS.PAYMENT_PENDING;
    return PARKING_PASS_STATUS.INVALID;
}

export function canPrintParkingPass(registration) {
    return getParkingPassStatus(registration) === PARKING_PASS_STATUS.VALID;
}
```

- [ ] **Step 4: Run the utility tests and verify GREEN**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingRegistration.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the parking domain helper**

```powershell
git add src/utils/parkingRegistration.js src/utils/__tests__/parkingRegistration.test.js
git commit -m "feat: derive parking pass status"
```

## Task 5: Complete the Public Parking Payment Flow

**Files:**
- Create: `src/components/RegistrationPaymentStep.jsx`
- Create: `src/components/__tests__/RegistrationPaymentStep.test.jsx`
- Modify: `src/components/EventRegistrationForm.jsx:14-19,255-351,382-390`
- Modify: `src/components/PaymentSection.jsx:8-80`
- Modify: `src/components/SuccessState.jsx:7-46`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`

- [ ] **Step 1: Write the failing payment-step tests**

Create `src/components/__tests__/RegistrationPaymentStep.test.jsx` with the Supabase RPC mocked:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../services/supabase', () => ({
    supabase: { rpc: vi.fn() },
}));
vi.mock('../PaymentSection', () => ({
    default: ({ onPaymentComplete }) => (
        <button onClick={() => onPaymentComplete({ success: true })}>Mock online payment</button>
    ),
}));

import RegistrationPaymentStep from '../RegistrationPaymentStep';
import { supabase } from '../../services/supabase';

describe('RegistrationPaymentStep', () => {
    const event = { payment_amount: 100, allow_in_person_payment: true };
    const registration = { id: 'reg-1', status: 'confirmed' };

    it('completes online payment through PaymentSection', () => {
        const onComplete = vi.fn();
        render(<RegistrationPaymentStep event={event} registration={registration} onComplete={onComplete} />);
        fireEvent.click(screen.getByRole('button', { name: /mock online payment/i }));
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ payment_status: 'paid' }));
    });

    it('records in-person selection as pending', async () => {
        supabase.rpc.mockResolvedValue({ data: null, error: null });
        const onComplete = vi.fn();
        render(<RegistrationPaymentStep event={event} registration={registration} onComplete={onComplete} />);
        fireEvent.click(screen.getByRole('button', { name: /pay in person/i }));
        await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('update_payment_status', {
            p_registration_id: 'reg-1',
            p_payment_status: 'pending',
            p_payment_method: 'in_person',
            p_payment_details: {},
        }));
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
            payment_status: 'pending',
            payment_method: 'in_person',
        }));
    });

    it('keeps the step open and shows an RPC error', async () => {
        supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
        render(<RegistrationPaymentStep event={event} registration={registration} onComplete={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /pay in person/i }));
        expect(await screen.findByText(/unable to record payment choice/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the payment-step tests and verify RED**

Run:

```powershell
npm run test:run -- src/components/__tests__/RegistrationPaymentStep.test.jsx
```

Expected: FAIL because `RegistrationPaymentStep.jsx` does not exist.

- [ ] **Step 3: Implement RegistrationPaymentStep**

Create `src/components/RegistrationPaymentStep.jsx` with this state transition contract:

```jsx
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import PaymentSection from './PaymentSection';
import Button from './ui/Button';
import Card from './ui/Card';

export default function RegistrationPaymentStep({ event, registration, onComplete }) {
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const chooseInPerson = async () => {
        setSaving(true);
        setError('');
        const { error: rpcError } = await supabase.rpc('update_payment_status', {
            p_registration_id: registration.id,
            p_payment_status: 'pending',
            p_payment_method: 'in_person',
            p_payment_details: {},
        });
        setSaving(false);
        if (rpcError) {
            setError('Unable to record payment choice. Please try again.');
            return;
        }
        onComplete({ ...registration, payment_status: 'pending', payment_method: 'in_person' });
    };

    return (
        <div className="max-w-lg mx-auto space-y-4">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <PaymentSection
                registrationId={registration.id}
                amount={Number(event.payment_amount)}
                onPaymentComplete={(result) => {
                    if (result.success) {
                        onComplete({ ...registration, payment_status: 'paid', payment_method: 'paypal' });
                    } else {
                        setError('Payment was not completed. Your registration remains payment pending.');
                    }
                }}
            />
            {event.allow_in_person_payment && (
                <Card className="p-5">
                    <Button variant="secondary" onClick={chooseInPerson} loading={saving}>Pay in Person</Button>
                </Card>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Extend EventRegistrationForm tests for authoritative status and payment**

In the hoisted Supabase mock in `src/components/__tests__/EventRegistrationForm.test.jsx`, replace the insert declarations and returned mock handles with:

```js
const mockInsertSingle = vi.fn();
const mockInsertSelect = vi.fn(() => ({ single: mockInsertSingle }));
const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
// Include mockInsertSingle in supabase._mocks.
```

In `setupMocks`, reset and configure `mockInsertSingle` instead of resolving `mockInsert` directly:

```js
mockInsertSingle.mockReset();
mockInsertSingle.mockResolvedValue({
    data: { id: 'registration-1', status: 'confirmed', payment_status: 'pending', payment_method: null },
    error: insertError,
});
```

Add this component mock before importing `EventRegistrationForm`:

```jsx
vi.mock('../RegistrationPaymentStep', () => ({
    default: ({ registration, onComplete }) => (
        <div>
            <p>Payment Required</p>
            <button onClick={() => onComplete({ ...registration, payment_status: 'paid', payment_method: 'paypal' })}>
                Complete Mock Payment
            </button>
        </div>
    ),
}));
```

Add these complete tests inside the existing `describe` block:

```jsx
it('routes a database-confirmed parking registration to payment', async () => {
    setupMocks(makeEvent({
        event_type: 'parking',
        payment_enabled: true,
        payment_amount: 100,
        allow_in_person_payment: true,
    }));
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await userEvent.type(await screen.findByLabelText(/first name/i), 'Alex');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Driver');
    await userEvent.type(screen.getByLabelText(/email/i), 'alex@example.org');
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/payment required/i)).toBeInTheDocument();
    expect(supabase._mocks.mockInsertSingle).toHaveBeenCalledTimes(1);
});

it('trusts returned waitlist status and never opens payment', async () => {
    setupMocks(makeEvent({
        event_type: 'parking',
        payment_enabled: true,
        payment_amount: 100,
        allow_in_person_payment: true,
        capacity: 50,
        registration_count: 1,
        waitlist_enabled: true,
    }));
    supabase._mocks.mockInsertSingle.mockResolvedValue({
        data: { id: 'registration-2', status: 'waitlisted', payment_status: 'pending', payment_method: null },
        error: null,
    });
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await userEvent.type(await screen.findByLabelText(/first name/i), 'Jamie');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Waitlist');
    await userEvent.type(screen.getByLabelText(/email/i), 'jamie@example.org');
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/added to waitlist/i)).toBeInTheDocument();
    expect(screen.queryByText(/payment required/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Route the returned registration through payment and success phases**

In `EventRegistrationForm.jsx`:

- Replace the boolean-only submission state with `createdRegistration` and `phase` (`form`, `payment`, `success`).
- Change insert to:

```js
const { data: created, error: insertError } = await supabase
    .from('registrations')
    .insert(registrationData)
    .select('id, status, payment_status, payment_method')
    .single();

if (insertError) throw insertError;
if (!created) throw new Error('Registration was created without a returned record.');
```

- Use `created.status === 'waitlisted'`; delete the post-insert client count calculation.
- Route a confirmed registration to `RegistrationPaymentStep` only when `event.event_type === 'parking'` and `event.payment_enabled === true`.
- Route a waitlisted registration, a standard event, or a parking event with payment disabled directly to `SuccessState`.
- On payment completion, store the returned registration state and route to Success.
- Reset all phase and registration state in `handleReset`.

Render:

```jsx
if (phase === 'payment' && createdRegistration) {
    return (
        <RegistrationPaymentStep
            event={event}
            registration={createdRegistration}
            onComplete={(paidRegistration) => {
                setCreatedRegistration(paidRegistration);
                setPhase('success');
            }}
        />
    );
}
```

- [ ] **Step 6: Make SuccessState parking-aware**

Pass `registration={createdRegistration}` into `SuccessState`. For parking events, call `getParkingPassStatus(registration)`, render that label, and guard the existing calendar block with:

```jsx
{event?.event_type !== 'parking' && event?.start_date && !isWaitlisted && (
    // existing calendar controls
)}
```

Keep standard-event wording and calendar behavior unchanged.

- [ ] **Step 7: Make online failures actionable**

In `PaymentSection.jsx`, add local error state, clear it at the start of approval, and render `Payment could not be completed. Please try again.` when capture or RPC update fails. Continue invoking `onPaymentComplete({ success: false, error: err.message })`.

- [ ] **Step 8: Run public-flow tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/RegistrationPaymentStep.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/utils/__tests__/parkingRegistration.test.js
```

Expected: PASS; standard submit tests still reach the original success state, confirmed parking reaches payment, and returned waitlist status bypasses payment.

- [ ] **Step 9: Commit the public flow**

```powershell
git add src/components/RegistrationPaymentStep.jsx src/components/__tests__/RegistrationPaymentStep.test.jsx src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/components/PaymentSection.jsx src/components/SuccessState.jsx
git commit -m "feat: add parking registration payment flow"
```

## Task 6: Generate the Physical Parking Pass

**Files:**
- Create: `src/utils/parkingPass.js`
- Create: `src/utils/__tests__/parkingPass.test.js`

- [ ] **Step 1: Write the failing pass tests**

Create `src/utils/__tests__/parkingPass.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import { buildParkingPassHtml, printParkingPass } from '../parkingPass';

const event = {
    title: 'Fall 2026 Parking',
    start_date: '2026-08-20T00:00:00Z',
    end_date: '2026-12-15T00:00:00Z',
};
const registration = {
    id: '12345678-abcd-0000-0000-000000000000',
    status: 'confirmed',
    payment_status: 'paid',
    form_data: {
        system_email: 'private@example.org',
        [PARKING_FIELD_IDS.LOCAL_STREET]: '1 Private Street',
        [PARKING_FIELD_IDS.INSURANCE_PROVIDER]: 'Private Insurance',
        [PARKING_FIELD_IDS.LICENSE_PLATE]: '<ABC&123>',
        [PARKING_FIELD_IDS.VEHICLE_YEAR]: '2024',
        [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
        [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
        [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
    },
};

describe('parking pass', () => {
    afterEach(() => vi.restoreAllMocks());

    it('uses exact stock dimensions, escapes values, and excludes private fields', () => {
        const html = buildParkingPassHtml(registration, event, 'UMC of Kent');
        expect(html).toContain('@page { size: 2.833in 11in; margin: 0; }');
        expect(html).toContain('&lt;ABC&amp;123&gt;');
        expect(html).toContain('2024 Blue Honda Civic');
        expect(html).toContain('VALID PARKING PASS');
        expect(html).toContain('Reference: 12345678');
        expect(html).not.toContain('private@example.org');
        expect(html).not.toContain('1 Private Street');
        expect(html).not.toContain('Private Insurance');
    });

    it('rejects non-valid registrations before opening a window', () => {
        const open = vi.spyOn(window, 'open');
        expect(() => printParkingPass({ ...registration, payment_status: 'pending' }, event, 'UMC of Kent'))
            .toThrow('Only valid parking registrations can be printed.');
        expect(open).not.toHaveBeenCalled();
    });

    it('rejects a valid record with missing required vehicle values', () => {
        expect(() => buildParkingPassHtml({
            ...registration,
            form_data: { ...registration.form_data, [PARKING_FIELD_IDS.LICENSE_PLATE]: '' },
        }, event, 'UMC of Kent')).toThrow('Required parking pass values are missing.');
    });
});
```

- [ ] **Step 2: Run the pass test and verify RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: FAIL because `parkingPass.js` does not exist.

- [ ] **Step 3: Implement safe HTML generation and printing**

Create `src/utils/parkingPass.js` with:

```js
import { PARKING_FIELD_IDS } from '../config/eventPresets';
import { canPrintParkingPass, getParkingFieldValue, getParkingVehicleLabel } from './parkingRegistration';

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatDate = (value) => value
    ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Open term';

export function buildParkingPassHtml(registration, event, organizationName) {
    if (!canPrintParkingPass(registration)) {
        throw new Error('Only valid parking registrations can be printed.');
    }
    const plate = getParkingFieldValue(registration, PARKING_FIELD_IDS.LICENSE_PLATE);
    const vehicle = getParkingVehicleLabel(registration);
    if (!plate || !vehicle) throw new Error('Required parking pass values are missing.');

    return `<!doctype html><html><head><title>Parking Pass - ${escapeHtml(plate)}</title><style>
@page { size: 2.833in 11in; margin: 0; }
html, body { width: 2.833in; height: 11in; margin: 0; }
body { box-sizing: border-box; padding: .22in; font-family: Arial, sans-serif; text-align: center; }
.pass { height: 10.56in; border: 3px solid #111; display: flex; flex-direction: column; justify-content: space-between; padding: .22in; box-sizing: border-box; }
.org { font-size: 16pt; font-weight: 700; }
.term { font-size: 14pt; }
.plate { font-size: 28pt; font-weight: 800; overflow-wrap: anywhere; }
.valid { font-size: 15pt; font-weight: 800; border: 3px solid #111; padding: .14in .05in; }
.meta { font-size: 10pt; line-height: 1.4; }
</style></head><body><main class="pass">
<header><div class="org">${escapeHtml(organizationName)}</div><div class="term">${escapeHtml(event?.title)}</div></header>
<section><div class="plate">${escapeHtml(plate)}</div><div>${escapeHtml(vehicle)}</div></section>
<div class="valid">VALID PARKING PASS</div>
<footer class="meta"><div>${escapeHtml(formatDate(event?.start_date))} - ${escapeHtml(formatDate(event?.end_date))}</div><div>Reference: ${escapeHtml(String(registration.id).slice(0, 8))}</div><div>Display as directed by the parking office.</div></footer>
</main></body></html>`;
}

export function printParkingPass(registration, event, organizationName) {
    const html = buildParkingPassHtml(registration, event, organizationName);
    const printWindow = window.open('', '_blank', 'width=408,height=1200');
    if (!printWindow) throw new Error('Allow popups to print the parking pass.');
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
}
```

- [ ] **Step 4: Run the pass tests and verify GREEN**

Run:

```powershell
npm run test:run -- src/utils/__tests__/parkingPass.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the pass generator**

```powershell
git add src/utils/parkingPass.js src/utils/__tests__/parkingPass.test.js
git commit -m "feat: generate parking passes"
```

## Task 7: Add the Parking-Focused Admin Table and Actions

**Files:**
- Create: `src/components/ParkingRegistrationTable.jsx`
- Create: `src/components/__tests__/ParkingRegistrationTable.test.jsx`
- Modify: `src/components/RegistrationViewer.jsx:23-29,78-102,163-187,219-285,370-435`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Write the failing focused-table test**

Create `src/components/__tests__/ParkingRegistrationTable.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PARKING_FIELD_IDS } from '../../config/eventPresets';
import ParkingRegistrationTable from '../ParkingRegistrationTable';

const makeRegistration = (overrides = {}) => ({
    id: 'reg-1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'paypal',
    form_data: {
        system_first_name: 'Alex',
        system_last_name: 'Driver',
        system_email: 'alex@example.org',
        [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC123',
        [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
        [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
        [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
    },
    ...overrides,
});

describe('ParkingRegistrationTable', () => {
    it('renders the approved columns and valid print action', () => {
        const onPrintPass = vi.fn();
        render(<ParkingRegistrationTable registrations={[makeRegistration()]} onView={vi.fn()} onMarkPaid={vi.fn()} onPrintPass={onPrintPass} />);
        const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((node) => node.textContent);
        expect(headers).toEqual(['Registrant', 'Email', 'License Plate', 'Vehicle', 'Registration', 'Payment', 'Pass', 'Actions']);
        fireEvent.click(screen.getByRole('button', { name: /print pass/i }));
        expect(onPrintPass).toHaveBeenCalledWith(expect.objectContaining({ id: 'reg-1' }));
    });

    it('offers Mark Paid only for confirmed pending in-person registrations', () => {
        const onMarkPaid = vi.fn();
        render(<ParkingRegistrationTable registrations={[makeRegistration({ payment_status: 'pending', payment_method: 'in_person' })]} onView={vi.fn()} onMarkPaid={onMarkPaid} onPrintPass={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /print pass/i })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /mark paid/i }));
        expect(onMarkPaid).toHaveBeenCalledWith(expect.objectContaining({ id: 'reg-1' }));
        expect(screen.getByText('Payment pending')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the table test and verify RED**

Run:

```powershell
npm run test:run -- src/components/__tests__/ParkingRegistrationTable.test.jsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement ParkingRegistrationTable**

Create `src/components/ParkingRegistrationTable.jsx`:

```jsx
import React from 'react';
import { PARKING_FIELD_IDS } from '../config/eventPresets';
import {
    canPrintParkingPass,
    getParkingFieldValue,
    getParkingPassStatus,
    getParkingVehicleLabel,
} from '../utils/parkingRegistration';
import Card from './ui/Card';

const columns = ['Registrant', 'Email', 'License Plate', 'Vehicle', 'Registration', 'Payment', 'Pass', 'Actions'];

export default function ParkingRegistrationTable({ registrations, onView, onMarkPaid, onPrintPass }) {
    return (
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">
                        {columns.map((column) => (
                            <th key={column} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{column}</th>
                        ))}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {registrations.map((registration) => {
                            const firstName = getParkingFieldValue(registration, 'system_first_name');
                            const lastName = getParkingFieldValue(registration, 'system_last_name');
                            const mayMarkPaid = registration.status === 'confirmed'
                                && registration.payment_status === 'pending'
                                && registration.payment_method === 'in_person';
                            return (
                                <tr key={registration.id}>
                                    <td className="px-4 py-3">{[firstName, lastName].filter(Boolean).join(' ')}</td>
                                    <td className="px-4 py-3">{getParkingFieldValue(registration, 'system_email')}</td>
                                    <td className="px-4 py-3 font-semibold">{getParkingFieldValue(registration, PARKING_FIELD_IDS.LICENSE_PLATE)}</td>
                                    <td className="px-4 py-3">{getParkingVehicleLabel(registration)}</td>
                                    <td className="px-4 py-3">{registration.status || 'pending'}</td>
                                    <td className="px-4 py-3">{registration.payment_status || 'pending'}</td>
                                    <td className="px-4 py-3">{getParkingPassStatus(registration)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => onView(registration)} aria-label="View">View</button>
                                            {mayMarkPaid && (
                                                <button type="button" onClick={() => onMarkPaid(registration)} aria-label="Mark Paid">Mark Paid</button>
                                            )}
                                            {canPrintParkingPass(registration) && (
                                                <button type="button" onClick={() => onPrintPass(registration)} aria-label="Print Pass">Print Pass</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
```

- [ ] **Step 4: Add admin payment and print handlers**

In `RegistrationViewer.jsx`, add:

```js
const handleMarkPaid = async (registration) => {
    const { data, error } = await supabase.rpc('mark_registration_paid', {
        p_registration_id: registration.id,
        p_org_id: orgId,
    });
    if (error) {
        setCancelError('Failed to mark payment as paid: ' + error.message);
        return;
    }
    const updated = Array.isArray(data) ? data[0] : data;
    if (updated) {
        setRegistrations((current) => current.map((item) => item.id === updated.id ? updated : item));
        setSelectedReg((current) => current?.id === updated.id ? updated : current);
    }
};

const handlePrintParkingPass = (registration) => {
    try {
        printParkingPass(registration, event, organizationName);
    } catch (error) {
        setCancelError(error.message || 'Unable to print this parking pass.');
    }
};
```

Accept `organizationName` in `RegistrationViewer` props. Pass it explicitly from `AdminDashboard` as `organizationName={currentOrg.name}` and use that prop in the print handler.

When `event?.event_type === 'parking'`, render `ParkingRegistrationTable` in place of the generic table body. Keep the existing toolbar, filter, CSV, table print, detail modal, cancellation, and realtime subscription around it.

- [ ] **Step 5: Extend RegistrationViewer tests**

Add `rpc: vi.fn()` to the Supabase mock, import `waitFor` and `PARKING_FIELD_IDS`, and add this fixture inside the existing `describe` block:

```jsx
const parkingRegistration = {
    id: 'parking-reg-1',
    status: 'confirmed',
    payment_status: 'pending',
    payment_method: 'in_person',
    form_data: {
        system_first_name: 'Alex',
        system_last_name: 'Driver',
        system_email: 'alex@example.org',
        [PARKING_FIELD_IDS.LICENSE_PLATE]: 'ABC123',
        [PARKING_FIELD_IDS.VEHICLE_MAKE]: 'Honda',
        [PARKING_FIELD_IDS.VEHICLE_MODEL]: 'Civic',
        [PARKING_FIELD_IDS.VEHICLE_COLOR]: 'Blue',
    },
    signature_records: [],
};
```

Add these complete tests:

```jsx
it('delegates parking events to the focused table', async () => {
    supabase._mocks.mockOrder.mockResolvedValue({ data: [parkingRegistration], error: null });
    render(
        <RegistrationViewer
            orgId="org-1"
            eventId="event-1"
            event={{ title: 'Fall Parking', event_type: 'parking', form_fields: [], waivers: [] }}
            organizationName="UMC of Kent"
            onBack={vi.fn()}
        />
    );
    expect(await screen.findByText('ABC123')).toBeInTheDocument();
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Registrant', 'Email', 'License Plate', 'Vehicle', 'Registration', 'Payment', 'Pass', 'Actions']);
});

it('refreshes the parking row after an admin marks in-person payment paid', async () => {
    supabase._mocks.mockOrder.mockResolvedValue({ data: [parkingRegistration], error: null });
    supabase.rpc.mockResolvedValue({
        data: [{ ...parkingRegistration, payment_status: 'paid', payment_method: 'in_person_verified' }],
        error: null,
    });
    render(
        <RegistrationViewer
            orgId="org-1"
            eventId="event-1"
            event={{ title: 'Fall Parking', event_type: 'parking', form_fields: [], waivers: [] }}
            organizationName="UMC of Kent"
            onBack={vi.fn()}
        />
    );
    fireEvent.click(await screen.findByRole('button', { name: /mark paid/i }));
    await waitFor(() => expect(screen.getByText('Valid')).toBeInTheDocument());
    expect(supabase.rpc).toHaveBeenCalledWith('mark_registration_paid', {
        p_registration_id: parkingRegistration.id,
        p_org_id: 'org-1',
    });
});
```

- [ ] **Step 6: Run admin tests**

Run:

```powershell
npm run test:run -- src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/RegistrationViewer.test.jsx src/utils/__tests__/parkingPass.test.js
```

Expected: PASS for all selected files.

- [ ] **Step 7: Commit the admin experience**

```powershell
git add src/components/ParkingRegistrationTable.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/AdminDashboard.jsx
git commit -m "feat: administer parking registrations"
```

## Task 8: Prove Export and Existing Report Parity

**Files:**
- Modify: `src/utils/printReports.js:83-108`
- Modify: `src/utils/__tests__/exportCsv.test.js`
- Modify: `src/utils/__tests__/printReports.test.js`

- [ ] **Step 1: Add parking CSV coverage**

Add a test to `src/utils/__tests__/exportCsv.test.js` using stable parking fields:

```js
it('exports parking fields with registration and payment status', () => {
    const fields = [
        { id: 'system_first_name', label: 'First Name', type: 'text' },
        { id: 'parking_license_plate', label: 'License Plate', type: 'text' },
    ];
    const csv = buildCsvString([{
        id: 'reg-1',
        status: 'confirmed',
        payment_status: 'paid',
        form_data: { system_first_name: 'Alex', parking_license_plate: 'ABC123' },
        signature_records: [],
    }], fields, []);
    expect(csv).toContain('First Name,License Plate,Waiver,Media,Status,Payment,Submitted');
    expect(csv).toContain('Alex,ABC123,Missing,Missing,confirmed,paid');
});
```

- [ ] **Step 2: Add parking table-print coverage**

Add this test to `src/utils/__tests__/printReports.test.js`, reusing the file's existing `write` print-window mock:

```js
it('prints stable parking fields with registration, payment, and submission status', () => {
    printRegistrationTable([{
        id: 'reg-1',
        status: 'confirmed',
        payment_status: 'paid',
        created_at: '2026-08-04T12:00:00Z',
        form_data: { system_first_name: 'Alex', parking_license_plate: 'ABC123' },
        signature_records: [],
    }], {
        title: 'Fall Parking',
        event_type: 'parking',
        form_fields: [
            { id: 'system_first_name', label: 'First Name', type: 'text' },
            { id: 'parking_license_plate', label: 'License Plate', type: 'text' },
        ],
        waivers: [],
    });
    const html = write.mock.calls[0][0];
    expect(html).toContain('<th>License Plate</th>');
    expect(html).toContain('<th>Status</th><th>Payment</th><th>Submitted</th>');
    expect(html).toContain('<td>ABC123</td>');
    expect(html).toContain('<td>confirmed</td><td>paid</td>');
    expect(html).toContain(new Date('2026-08-04T12:00:00Z').toLocaleString());
});
```

- [ ] **Step 3: Run the tests and verify the report test is RED**

Run:

```powershell
npm run test:run -- src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js
```

Expected: CSV test PASS; print-report test FAIL because the current table report does not include Payment or Submitted.

- [ ] **Step 4: Add Payment and Submitted to the full table report**

In `printRegistrationTable` in `src/utils/printReports.js`, replace `derivedHeaders` and the row return with:

```js
const derivedHeaders = '<th>Waiver</th><th>Media</th><th>Status</th><th>Payment</th><th>Submitted</th>';
```

```js
const submitted = reg.created_at ? new Date(reg.created_at).toLocaleString() : 'N/A';
return `<tr>${cells}<td>${waiverStatus}</td><td>${mediaDecision}</td><td>${reg.status || 'pending'}</td><td>${reg.payment_status || 'N/A'}</td><td>${submitted}</td></tr>`;
```

- [ ] **Step 5: Run the parity tests and verify GREEN**

Run:

```powershell
npm run test:run -- src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js
```

Expected: PASS; CSV and full table print now share parking fields, registration status, payment status, and submission timestamp.

- [ ] **Step 6: Commit the parity behavior and evidence**

```powershell
git add src/utils/printReports.js src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js
git commit -m "feat: preserve parking report parity"
```

## Task 9: Full Regression and Physical Verification

**Files:**
- Verify only; no additional source files expected.

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
npm run test:run
npm run lint
npm run build
```

Expected: every command exits 0. Do not add or broaden lint exclusions if lint fails; fix the reported code.

- [ ] **Step 2: Inspect scope and migration safety**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors; only the approved design, plan, migration, parking source, and related tests are tracked. The original checkout's `diff.txt` is not present in this worktree and is never staged.

- [ ] **Step 3: Apply and verify the migration in the beta Supabase environment**

Do not mutate the beta database until the user explicitly authorizes deployment. After authorization, open the beta project's Supabase Dashboard, choose SQL Editor, paste the complete contents of `supabase/migrations/20260804_parking_registration_extension.sql`, and run it once. Then run these read-only verification queries in the same SQL Editor:

```sql
SELECT event_type, count(*)
FROM public.events
GROUP BY event_type;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'events'
  AND column_name IN ('event_type', 'allow_in_person_payment')
ORDER BY column_name;

SELECT has_function_privilege('authenticated', 'public.mark_registration_paid(uuid, uuid)', 'EXECUTE');
SELECT has_function_privilege('anon', 'public.mark_registration_paid(uuid, uuid)', 'EXECUTE');
```

Expected: all legacy events report `standard`; both columns are non-null with the approved defaults; the authenticated privilege query returns `true` and the anonymous privilege query returns `false`.

- [ ] **Step 4: Verify the complete browser workflow**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

In the authenticated admin UI:

1. Create a Parking Registration event.
2. Confirm the protected fields, parking waiver, payment, and in-person defaults are present.
3. Set a positive payment amount, term dates, capacity, optional waitlist, and activate it.
4. Duplicate it and confirm the copy remains Parking with the same configuration, a blank slug, Draft status, and zero registrations/waitlist entries.
5. Open the original public link and complete one confirmed registration with Pay in Person.
6. Confirm the admin table shows the expected registrant, plate, vehicle, pending payment, and Payment pending pass state.
7. Mark the payment paid and confirm the pass state becomes Valid and Print Pass appears.
8. Fill the event to capacity, submit another registration, and confirm it is waitlisted without seeing a payment step.
9. Cancel one confirmed registration and confirm the existing database workflow promotes the first waitlisted registration.
10. Confirm the cancelled registration becomes Invalid and the promoted registration remains Payment pending with no printable pass.
11. Create or open a standard event and confirm its editor, public form, success calendar links, and generic registrations table remain unchanged.

Expected: all eleven observations match the approved design and no unexpected browser console errors appear.

- [ ] **Step 5: Verify actual pass stock**

From the valid registration, click Print Pass and select the printer loaded with one 2.833-inch by 11-inch precut piece. In print preview and on the physical result, confirm:

- Custom page size is 2.833 inches by 11 inches.
- Scale is 100 percent with no fit-to-letter transformation.
- The pass feeds in the intended orientation.
- Organization, term, plate, vehicle, validity label, dates, reference, and display instructions are legible.
- No address, phone, email, insurance, payment detail, or signature appears.

Expected: one correctly aligned pass prints on one precut piece. Record printer-specific orientation settings in the operational handoff if the driver requires them; do not encode a printer-specific workaround in application CSS.

- [ ] **Step 6: Commit any verification-only documentation correction**

If physical verification requires a factual printer-orientation note, update this plan or the repository's operator documentation and commit only that documentation:

```powershell
git add docs/superpowers/plans/2026-08-04-parking-registration-extension.md
git commit -m "docs: record parking pass print verification"
```

If no documentation correction is needed, do not create an empty commit.

# Event Email Message Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-event plain-text confirmation and reminder messages, current parking payment facts, authenticated canonical email composition, and idempotent delivery control for registration and reminder emails.

**Architecture:** Build on the committed eight-function recovery baseline. Add two event columns plus a service-role-only delivery ledger, centralize frontend message defaults/validation, extract pure email formatting and payment-label helpers, and convert the two recovered email functions into thin HTTP entrypoints with dependency-injected handlers. Preserve all unrelated recovered function behavior and do not deploy the three baseline-only functions.

**Tech Stack:** React 19, Vite 7, Vitest 4, Supabase Postgres/pg_net/Edge Functions, TypeScript, emailjs 4, PowerShell, Firebase Hosting

---

## Prerequisite

Complete and commit `docs/superpowers/plans/2026-08-06-edge-function-source-recovery.md`. Before starting, these paths must exist:

- `supabase/functions/send-registration-email/send-registration-email.ts`
- `supabase/functions/send-event-reminders/index.ts`
- `supabase/functions/capture-signer-ip/`
- `supabase/functions/verify-cancel-token/`
- `supabase/functions/weekly-digest/`
- `supabase/functions/DEPLOYED_BASELINES.md`

Run:

```powershell
git status --porcelain=v1
npx vitest run src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
```

Expected: clean worktree and PASS. Stop if the baseline is absent or dirty.

## File Structure

- Create `src/config/eventEmailMessages.js`: starter strings, reminder-enabled predicate, draft/record validation, and reminder-toggle state transition.
- Create `src/config/__tests__/eventEmailMessages.test.js`: pure message-default and validation coverage.
- Create `src/components/EventEmailMessageFields.jsx`: plain-text editor controls and reminder-disabled state.
- Create `src/components/__tests__/EventEmailMessageFields.test.jsx`: interaction/accessibility coverage.
- Modify `src/config/eventPresets.js`: seed parking confirmation text.
- Modify `src/components/EventEditor.jsx`: load, edit, preserve, and save both messages.
- Modify `src/components/AdminDashboard.jsx`: enforce the same active-event validation in quick status changes.
- Modify `src/utils/eventPayload.js`: persist and validate both columns.
- Modify `src/utils/__tests__/eventPayload.test.js` and `src/config/__tests__/eventPresets.test.js`: payload/preset regression coverage.
- Create `src/security/__tests__/eventEmailMigration.test.js`: SQL contract for columns, constraints, ledger privileges, and protected webhook payloads.
- Create via `npx supabase migration new event_email_message_control`: CLI-timestamped migration containing the approved schema and trigger changes.
- Create `supabase/functions/_shared/email-content.ts`: safe plain-text rendering, payment labels, and email composition helpers.
- Create `supabase/functions/_shared/email-content.test.ts`: content, escaping, and payment-label tests.
- Create `supabase/functions/_shared/email-automation.ts`: trusted-caller and logical-delivery-key helpers.
- Create `supabase/functions/_shared/email-automation.test.ts`: authorization and key-stability tests.
- Create `supabase/functions/_shared/email-delivery.ts`: delivery claim/complete/fail adapter.
- Create `supabase/functions/_shared/email-delivery.test.ts`: idempotency and retry tests.
- Create `supabase/functions/_shared/org-smtp.ts`: Vault-backed SMTP lookup and send adapter.
- Create `supabase/functions/send-registration-email/handler.ts` and `handler.test.ts`: canonical registration-email orchestration.
- Modify `supabase/functions/send-registration-email/send-registration-email.ts`: thin production entrypoint.
- Create `supabase/functions/send-event-reminders/handler.ts` and `handler.test.ts`: due-event batch orchestration.
- Modify `supabase/functions/send-event-reminders/index.ts`: thin production entrypoint.
- Modify `supabase/config.toml`: require JWT verification for the two modified email functions and pin their entrypoints.

### Task 1: Add the Schema and Trigger Security Contract

**Files:**
- Create: `src/security/__tests__/eventEmailMigration.test.js`
- Create via CLI: `supabase/migrations/*_event_email_message_control.sql`

- [ ] **Step 1: Write the failing migration contract**

```js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const migrationName = readdirSync(migrationsDirectory)
    .find((name) => name.endsWith('_event_email_message_control.sql'));

if (!migrationName) throw new Error('event_email_message_control migration is missing');
const sql = readFileSync(path.join(migrationsDirectory, migrationName), 'utf8');

describe('event email message control migration', () => {
    it('adds the two event message columns and active-event invariants', () => {
        expect(sql).toMatch(/add column(?: if not exists)? confirmation_message text/i);
        expect(sql).toMatch(/add column(?: if not exists)? reminder_message text/i);
        expect(sql).toMatch(/event_type\s*<>\s*'parking'[\s\S]+coalesce\(btrim\(confirmation_message\),\s*''\)\s*<>\s*''/i);
        expect(sql).toMatch(/reminder_hours_before is null[\s\S]+coalesce\(btrim\(reminder_message\),\s*''\)\s*<>\s*''/i);
    });

    it('backfills the approved starter messages before adding constraints', () => {
        expect(sql).toContain('Thank you for registering for this parking event.');
        expect(sql).toContain('This is a friendly reminder that your event is coming up soon!');
        expect(sql.indexOf('Thank you for registering')).toBeLessThan(sql.indexOf('events_active_parking_confirmation_message_check'));
    });

    it('creates a service-role-only delivery ledger', () => {
        expect(sql).toMatch(/create table public\.email_deliveries/i);
        expect(sql).toMatch(/delivery_key text not null unique/i);
        expect(sql).toMatch(/state text not null default 'pending'/i);
        expect(sql).toMatch(/enable row level security/i);
        expect(sql).toMatch(/revoke all on table public\.email_deliveries from public, anon, authenticated/i);
        expect(sql).toMatch(/grant select, insert, update on table public\.email_deliveries to service_role/i);
    });

    it('replaces full-row anonymous webhook payloads with protected identifiers', () => {
        expect(sql).toMatch(/current_setting\('app\.settings\.service_role_key',\s*true\)/i);
        expect(sql).toMatch(/'registration_id',\s*new\.id/i);
        expect(sql).not.toMatch(/to_jsonb\(new\)/i);
        expect(sql).not.toMatch(/name\s*=\s*'anon_key'/i);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run src/security/__tests__/eventEmailMigration.test.js --maxWorkers=1
```

Expected: FAIL with `event_email_message_control migration is missing`.

- [ ] **Step 3: Generate the migration through the CLI**

Run:

```powershell
npx supabase migration new event_email_message_control
$migrationPath = Get-ChildItem -LiteralPath supabase/migrations -Filter '*_event_email_message_control.sql' |
    Sort-Object LastWriteTimeUtc |
    Select-Object -Last 1 -ExpandProperty FullName
if (-not $migrationPath) { throw 'Supabase CLI did not create the migration' }
$migrationPath
```

Expected: one CLI-generated timestamped path. Use that exact path for the SQL in the next step; never invent or rename the timestamp.

- [ ] **Step 4: Add the schema, ledger, and protected trigger SQL**

Put this complete SQL in the generated migration:

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS confirmation_message text,
  ADD COLUMN IF NOT EXISTS reminder_message text;

UPDATE public.events
SET confirmation_message = 'Thank you for registering for this parking event.'
WHERE event_type = 'parking'
  AND coalesce(btrim(confirmation_message), '') = '';

UPDATE public.events
SET reminder_message = 'This is a friendly reminder that your event is coming up soon!'
WHERE reminder_hours_before IS NOT NULL
  AND coalesce(btrim(reminder_message), '') = '';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_active_parking_confirmation_message_check,
  ADD CONSTRAINT events_active_parking_confirmation_message_check CHECK (
    status <> 'active'
    OR event_type <> 'parking'
    OR coalesce(btrim(confirmation_message), '') <> ''
  ),
  DROP CONSTRAINT IF EXISTS events_active_reminder_message_check,
  ADD CONSTRAINT events_active_reminder_message_check CHECK (
    status <> 'active'
    OR reminder_hours_before IS NULL
    OR coalesce(btrim(reminder_message), '') <> ''
  );

CREATE TABLE public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_key text NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'registration_confirmation',
    'registration_waitlist',
    'registration_cancellation',
    'waitlist_promotion',
    'organizer_notification',
    'event_reminder'
  )),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.notify_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_service_role_key text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';
  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_project_url IS NULL OR coalesce(v_service_role_key, '') = '' THEN
    RAISE WARNING 'Registration email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'registration_id', NEW.id,
      'event_id', NEW.event_id,
      'org_id', NEW.org_id
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_registration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_service_role_key text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';
  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_project_url IS NULL OR coalesce(v_service_role_key, '') = '' THEN
    RAISE WARNING 'Registration email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'registration_id', NEW.id,
      'event_id', NEW.event_id,
      'org_id', NEW.org_id,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'transition_at', NEW.updated_at
    )
  );
  RETURN NEW;
END;
$$;
```

- [ ] **Step 5: Run migration checks**

Run:

```powershell
npx vitest run src/security/__tests__/eventEmailMigration.test.js --maxWorkers=1
npm run check:migrations
```

Expected: PASS. Do not run `supabase db push`; production migration history remains a separate deployment gate.

- [ ] **Step 6: Commit the schema contract**

```powershell
git add -- src/security/__tests__/eventEmailMigration.test.js supabase/migrations/*_event_email_message_control.sql
git commit -m "feat: add event email message schema"
```

### Task 2: Add Message Defaults, Validation, and Payload Mapping

**Files:**
- Create: `src/config/eventEmailMessages.js`
- Create: `src/config/__tests__/eventEmailMessages.test.js`
- Modify: `src/config/eventPresets.js`
- Modify: `src/config/__tests__/eventPresets.test.js`
- Modify: `src/utils/eventPayload.js`
- Modify: `src/utils/__tests__/eventPayload.test.js`

- [ ] **Step 1: Write failing pure-configuration tests**

Create `src/config/__tests__/eventEmailMessages.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
    PARKING_CONFIRMATION_MESSAGE_STARTER,
    REMINDER_MESSAGE_STARTER,
    applyReminderHoursChange,
    hasReminderSchedule,
    validateEventEmailDraft,
    validateEventEmailRecord,
} from '../eventEmailMessages';

describe('event email message configuration', () => {
    it('requires parking confirmation text only for active parking events', () => {
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'parking', confirmationMessage: '   ',
        })).toEqual(['Active parking events require a confirmation email message.']);
        expect(validateEventEmailDraft({
            status: 'draft', eventType: 'parking', confirmationMessage: '',
        })).toEqual([]);
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', confirmationMessage: '',
        })).toEqual([]);
    });

    it('requires reminder text only for active reminder-enabled events', () => {
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', reminderHoursBefore: '24', reminderMessage: '',
        })).toEqual(['Active events with a reminder time require a reminder email message.']);
        expect(validateEventEmailDraft({
            status: 'active', eventType: 'standard', reminderHoursBefore: '', reminderMessage: '',
        })).toEqual([]);
    });

    it('maps persisted records to the same validation contract', () => {
        expect(validateEventEmailRecord({
            status: 'active',
            event_type: 'parking',
            confirmation_message: PARKING_CONFIRMATION_MESSAGE_STARTER,
            reminder_hours_before: 24,
            reminder_message: REMINDER_MESSAGE_STARTER,
        })).toEqual([]);
    });

    it('seeds a blank reminder only when a schedule is enabled and preserves authored text', () => {
        expect(hasReminderSchedule('24')).toBe(true);
        expect(hasReminderSchedule('')).toBe(false);
        expect(applyReminderHoursChange({ reminderMessage: '' }, '24')).toEqual({
            reminderHoursBefore: '24',
            reminderMessage: REMINDER_MESSAGE_STARTER,
        });
        expect(applyReminderHoursChange({ reminderMessage: 'Pickup at the office.' }, '')).toEqual({
            reminderHoursBefore: '',
            reminderMessage: 'Pickup at the office.',
        });
    });
});
```

Extend existing preset/payload tests with these assertions:

```js
expect(createEventPreset('parking').confirmationMessage)
    .toBe('Thank you for registering for this parking event.');
expect(createEventPreset('standard').confirmationMessage).toBe('');

expect(payload).toMatchObject({
    confirmation_message: 'Pickup at the church office.',
    reminder_message: 'Bring photo identification.',
});
expect(duplicate).toMatchObject({
    confirmation_message: 'Pickup at the church office.',
    reminder_message: 'Bring photo identification.',
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

```powershell
npx vitest run src/config/__tests__/eventEmailMessages.test.js src/config/__tests__/eventPresets.test.js src/utils/__tests__/eventPayload.test.js --maxWorkers=1
```

Expected: FAIL because the new module and payload fields do not exist.

- [ ] **Step 3: Implement the pure configuration module**

Create `src/config/eventEmailMessages.js`:

```js
export const PARKING_CONFIRMATION_MESSAGE_STARTER =
    'Thank you for registering for this parking event.';
export const REMINDER_MESSAGE_STARTER =
    'This is a friendly reminder that your event is coming up soon!';

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

export const hasReminderSchedule = (value) => (
    value !== null && value !== undefined && String(value).trim() !== ''
);

export function validateEventEmailDraft(event) {
    if (event?.status !== 'active') return [];
    const errors = [];
    if (event.eventType === 'parking' && !hasText(event.confirmationMessage)) {
        errors.push('Active parking events require a confirmation email message.');
    }
    if (hasReminderSchedule(event.reminderHoursBefore) && !hasText(event.reminderMessage)) {
        errors.push('Active events with a reminder time require a reminder email message.');
    }
    return errors;
}

export const validateEventEmailRecord = (event) => validateEventEmailDraft({
    status: event?.status,
    eventType: event?.event_type,
    confirmationMessage: event?.confirmation_message,
    reminderHoursBefore: event?.reminder_hours_before,
    reminderMessage: event?.reminder_message,
});

export function applyReminderHoursChange(event, reminderHoursBefore) {
    return {
        reminderHoursBefore,
        reminderMessage: hasReminderSchedule(reminderHoursBefore)
            && !hasText(event?.reminderMessage)
            ? REMINDER_MESSAGE_STARTER
            : (event?.reminderMessage || ''),
    };
}
```

- [ ] **Step 4: Wire presets and payload validation**

In `eventPresets.js`, import the parking starter and return:

```js
confirmationMessage: isParking ? PARKING_CONFIRMATION_MESSAGE_STARTER : '',
```

In `eventPayload.js`, import `validateEventEmailDraft`, combine it with parking validation for active events, and serialize:

```js
if (event.status === 'active') {
    const validationError = [
        ...validateParkingEventDraft(event),
        ...validateEventEmailDraft(event),
    ][0];
    if (validationError) throw new Error(validationError);
}

confirmation_message: event.confirmationMessage?.trim() || null,
reminder_message: event.reminderMessage?.trim() || null,
```

Keep `buildDuplicateEventPayload` unchanged except for tests: its existing rest/spread behavior deliberately preserves both stored message columns while resetting status and reminder delivery state.

- [ ] **Step 5: Update test fixtures and run the focused suite**

Add `confirmationMessage` and `reminderMessage` to active parking fixtures. Use nonblank reminder text whenever `reminderHoursBefore` is nonblank.

Run:

```powershell
npx vitest run src/config/__tests__/eventEmailMessages.test.js src/config/__tests__/eventPresets.test.js src/utils/__tests__/eventPayload.test.js --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit defaults and persistence**

```powershell
git add -- src/config/eventEmailMessages.js src/config/__tests__/eventEmailMessages.test.js src/config/eventPresets.js src/config/__tests__/eventPresets.test.js src/utils/eventPayload.js src/utils/__tests__/eventPayload.test.js
git commit -m "feat: add per-event email message configuration"
```

### Task 3: Add the Event Editor Controls

**Files:**
- Create: `src/components/EventEmailMessageFields.jsx`
- Create: `src/components/__tests__/EventEmailMessageFields.test.jsx`
- Modify: `src/components/EventEditor.jsx`
- Modify: `src/components/AdminDashboard.jsx`

- [ ] **Step 1: Write the failing component test**

Create `src/components/__tests__/EventEmailMessageFields.test.jsx`:

```jsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EventEmailMessageFields from '../EventEmailMessageFields';

describe('EventEmailMessageFields', () => {
    it('edits confirmation text for every event', () => {
        const onChange = vi.fn();
        render(<EventEmailMessageFields
            confirmationMessage="Current confirmation"
            reminderMessage=""
            reminderEnabled={false}
            onChange={onChange}
        />);

        fireEvent.change(screen.getByLabelText('Confirmation Email Message'), {
            target: { value: 'Pickup at the church office.' },
        });
        expect(onChange).toHaveBeenCalledWith('confirmationMessage', 'Pickup at the church office.');
    });

    it('disables reminder editing until a reminder time is configured', () => {
        const { rerender } = render(<EventEmailMessageFields
            confirmationMessage="Confirmation"
            reminderMessage="Preserved reminder"
            reminderEnabled={false}
            onChange={vi.fn()}
        />);

        expect(screen.getByLabelText('Reminder Email Message')).toBeDisabled();
        expect(screen.getByText('Set a reminder time to edit this message.')).toBeInTheDocument();

        rerender(<EventEmailMessageFields
            confirmationMessage="Confirmation"
            reminderMessage="Preserved reminder"
            reminderEnabled
            onChange={vi.fn()}
        />);
        expect(screen.getByLabelText('Reminder Email Message')).toBeEnabled();
        expect(screen.getByLabelText('Reminder Email Message')).toHaveValue('Preserved reminder');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx vitest run src/components/__tests__/EventEmailMessageFields.test.jsx --maxWorkers=1
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused editor component**

Create `src/components/EventEmailMessageFields.jsx`:

```jsx
import React from 'react';
import Label from './ui/Label';

const textareaClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';

export default function EventEmailMessageFields({
    confirmationMessage,
    reminderMessage,
    reminderEnabled,
    onChange,
}) {
    return (
        <div className="space-y-5">
            <div>
                <Label htmlFor="confirmation-message">Confirmation Email Message</Label>
                <p className="text-xs text-slate-500 mb-1">
                    The email adds status, event and registration details, cancellation link, and parking payment facts automatically. Put all pickup and process instructions here.
                </p>
                <textarea
                    id="confirmation-message"
                    rows={5}
                    className={textareaClass}
                    value={confirmationMessage}
                    onChange={(event) => onChange('confirmationMessage', event.target.value)}
                />
            </div>
            <div>
                <Label htmlFor="reminder-message">Reminder Email Message</Label>
                {!reminderEnabled && (
                    <p className="text-xs text-slate-500 mb-1">Set a reminder time to edit this message.</p>
                )}
                <textarea
                    id="reminder-message"
                    rows={5}
                    className={textareaClass}
                    value={reminderMessage}
                    disabled={!reminderEnabled}
                    onChange={(event) => onChange('reminderMessage', event.target.value)}
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Integrate event state and reminder transitions**

In `EventEditor.jsx`:

1. Import `EventEmailMessageFields`, `applyReminderHoursChange`, and `hasReminderSchedule`.
2. Initialize `confirmationMessage: preset.confirmationMessage` and `reminderMessage: ''`.
3. Load `data.confirmation_message || ''` and `data.reminder_message || ''`.
4. Add this handler:

```js
const handleReminderHoursChange = (value) => {
    setEvent((previous) => ({
        ...previous,
        ...applyReminderHoursChange(previous, value),
    }));
    setSaved(false);
};
```

5. Replace the reminder-hours `onChange` with `handleReminderHoursChange(e.target.value)`.
6. Render this component directly below the reminder-hours row:

```jsx
<EventEmailMessageFields
    confirmationMessage={event.confirmationMessage}
    reminderMessage={event.reminderMessage}
    reminderEnabled={hasReminderSchedule(event.reminderHoursBefore)}
    onChange={handleChange}
/>
```

In `AdminDashboard.jsx`, combine the quick-activation checks:

```js
const validationError = [
    ...validateParkingEventRecord(targetEvent),
    ...validateEventEmailRecord(targetEvent),
][0];
```

- [ ] **Step 5: Run focused editor and validation tests**

```powershell
npx vitest run src/components/__tests__/EventEmailMessageFields.test.jsx src/config/__tests__/eventEmailMessages.test.js src/utils/__tests__/eventPayload.test.js --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit the editor flow**

```powershell
git add -- src/components/EventEmailMessageFields.jsx src/components/__tests__/EventEmailMessageFields.test.jsx src/components/EventEditor.jsx src/components/AdminDashboard.jsx
git commit -m "feat: edit event confirmation and reminder messages"
```

### Task 4: Build Safe Email Content Helpers

**Files:**
- Create: `supabase/functions/_shared/email-content.ts`
- Create: `supabase/functions/_shared/email-content.test.ts`

- [ ] **Step 1: Write failing content tests**

Create `supabase/functions/_shared/email-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildConfirmedRegistrationEmail,
  buildReminderEmail,
  escapeHtml,
  paymentMethodLabel,
  paymentStatusLabel,
  renderPlainText,
} from './email-content.ts';

const parkingRegistration = {
  payment_method: 'in_person',
  payment_status: 'pending',
  legacy_payment_paid: false,
  form_data: { system_email: 'person@example.org', parking_license_plate: 'ABC<123' },
};

describe('email content', () => {
  it('escapes HTML and preserves safe paragraph and line breaks', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    expect(renderPlainText('First line\nSecond line\n\nNext <section>')).toBe(
      '<p>First line<br>Second line</p><p>Next &lt;section&gt;</p>',
    );
  });

  it('maps current payment facts without process wording', () => {
    expect(paymentMethodLabel('in_person')).toBe('Pay in Person');
    expect(paymentMethodLabel('tithely')).toBe('Tithe.ly');
    expect(paymentStatusLabel({ payment_status: 'pending' })).toBe('Pending verification');
    expect(paymentStatusLabel({ payment_status: 'partial' })).toBe('Partially paid');
    expect(paymentStatusLabel({ payment_status: 'paid' })).toBe('Verified');
    expect(paymentStatusLabel({ payment_status: 'paid', legacy_payment_paid: true })).toBe('Verified');
  });

  it('places custom confirmation text before parking payment facts and escapes form data', () => {
    const result = buildConfirmedRegistrationEmail({
      event: {
        title: 'Fall <Parking>',
        event_type: 'parking',
        confirmation_message: 'Pickup details are below.\nBring ID.',
        location: 'Church & Office',
      },
      registration: parkingRegistration,
      formFields: [
        { id: 'system_email', label: 'Email' },
        { id: 'parking_license_plate', label: 'License Plate' },
      ],
      eventDate: 'Saturday, August 15, 2026',
      cancelUrl: 'https://events.example/?cancel=true&token=safe',
    });

    expect(result.subject).toBe('Registration Confirmed: Fall <Parking>');
    expect(result.html).toContain('Pickup details are below.<br>Bring ID.');
    expect(result.html).toContain('Payment method</div><div class="field-value">Pay in Person');
    expect(result.html).toContain('Payment status</div><div class="field-value">Pending verification');
    expect(result.html).toContain('ABC&lt;123');
    expect(result.html).toContain('href="https://events.example/?cancel=true&amp;token=safe"');
    expect(result.html).not.toContain('print');
    expect(result.html.indexOf('Pickup details')).toBeLessThan(result.html.indexOf('Payment method'));
  });

  it('uses the standard fallback and reads verified state in reminders', () => {
    const confirmation = buildConfirmedRegistrationEmail({
      event: { title: 'Dinner', event_type: 'standard', confirmation_message: null, location: null },
      registration: { form_data: {}, payment_status: 'not_required', payment_method: null },
      formFields: [], eventDate: null, cancelUrl: 'https://events.example/cancel',
    });
    expect(confirmation.html).toContain('Your registration has been confirmed!');

    const reminder = buildReminderEmail({
      event: {
        title: 'Fall Parking', event_type: 'parking',
        reminder_message: 'Pickup at the office.', location: '1435 E Main St',
      },
      registration: { ...parkingRegistration, payment_status: 'paid' },
      eventDate: 'Saturday, August 15, 2026', eventTime: '9:00 AM',
      calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
    });
    expect(reminder.html).toContain('Payment status</div><div class="field-value">Verified');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run supabase/functions/_shared/email-content.test.ts --maxWorkers=1
```

Expected: FAIL because `email-content.ts` does not exist.

- [ ] **Step 3: Implement safe rendering and factual labels**

Create `supabase/functions/_shared/email-content.ts` with these public functions and types:

```ts
export interface EmailEvent {
  title: string;
  event_type: string;
  confirmation_message?: string | null;
  reminder_message?: string | null;
  location?: string | null;
}

export interface EmailRegistration {
  form_data: Record<string, unknown>;
  payment_method?: string | null;
  payment_status?: string | null;
  legacy_payment_paid?: boolean;
}

export interface EmailField { id: string; label: string }

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '&mdash;';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderPlainText(value: string): string {
  return value.trim().replace(/\r\n?/g, '\n').split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function paymentMethodLabel(method: string | null | undefined): string {
  if (method === 'tithely') return 'Tithe.ly';
  if (method === 'in_person' || method === 'in_person_verified') return 'Pay in Person';
  return method ? String(method) : 'Not selected';
}

export function paymentStatusLabel(registration: Pick<EmailRegistration, 'payment_status' | 'legacy_payment_paid'>): string {
  if (registration.payment_status === 'paid' || registration.legacy_payment_paid) return 'Verified';
  if (registration.payment_status === 'partial') return 'Partially paid';
  if (registration.payment_status === 'pending') return 'Pending verification';
  if (registration.payment_status === 'not_required') return 'Not required';
  return 'Unknown';
}

export function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;margin:0;padding:24px}.container{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}.header{background:linear-gradient(135deg,#2563eb,#8b5cf6);padding:24px 32px;color:#fff}.body{padding:32px}.field{margin-bottom:16px}.field-label{font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:600}.field-value{font-size:15px;color:#1e293b}.status-badge{display:inline-block;padding:4px 12px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600}.divider{height:1px;background:#e2e8f0;margin:20px 0}.footer{padding:16px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#94a3b8}
</style></head><body><div class="container">${content}</div></body></html>`;
}

function field(label: string, value: unknown): string {
  return `<div class="field"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(value)}</div></div>`;
}

function paymentFacts(event: EmailEvent, registration: EmailRegistration): string {
  if (event.event_type !== 'parking') return '';
  return field('Payment method', paymentMethodLabel(registration.payment_method))
    + field('Payment status', paymentStatusLabel(registration));
}

export function buildConfirmedRegistrationEmail(input: {
  event: EmailEvent;
  registration: EmailRegistration;
  formFields: EmailField[];
  eventDate: string | null;
  cancelUrl: string;
}): { subject: string; html: string } {
  const { event, registration, formFields, eventDate, cancelUrl } = input;
  const message = event.confirmation_message?.trim()
    || (event.event_type === 'standard' ? 'Your registration has been confirmed!' : '');
  if (!message) throw new Error('missing_confirmation_message');
  const fields = formFields.map((item) => {
    const value = registration.form_data[item.id];
    return field(item.label, Array.isArray(value) ? value.join(', ') : value);
  }).join('');
  const safeTitle = escapeHtml(event.title);
  const html = wrapEmail(`<div class="header"><h1>${safeTitle}</h1><p>Registration Confirmed</p></div><div class="body"><span class="status-badge">Confirmed</span>${renderPlainText(message)}<div class="divider"></div>${paymentFacts(event, registration)}${eventDate ? field('Date', eventDate) : ''}${event.location ? field('Location', event.location) : ''}<div class="divider"></div>${fields}<div class="divider"></div><p>Need to cancel? Click below:</p><a href="${escapeHtml(cancelUrl)}">Cancel Registration</a></div><div class="footer">This is an automated confirmation. Please do not reply.</div>`);
  return { subject: `Registration Confirmed: ${event.title}`, html };
}

export function buildReminderEmail(input: {
  event: EmailEvent;
  registration: EmailRegistration;
  eventDate: string;
  eventTime: string;
  calendarUrl: string;
}): { subject: string; html: string } {
  const { event, registration, eventDate, eventTime, calendarUrl } = input;
  const message = event.reminder_message?.trim();
  if (!message) throw new Error('missing_reminder_message');
  const safeTitle = escapeHtml(event.title);
  const html = wrapEmail(`<div class="header"><h1>${safeTitle}</h1><p>Event Reminder</p></div><div class="body">${renderPlainText(message)}<div class="divider"></div>${paymentFacts(event, registration)}${field('Date', eventDate)}${field('Time', eventTime)}${event.location ? field('Location', event.location) : ''}<div class="divider"></div><p>Add to your calendar:</p><a href="${escapeHtml(calendarUrl)}">Add to Google Calendar</a></div><div class="footer">You're receiving this because you're registered for this event.</div>`);
  return { subject: `Reminder: ${event.title} is coming up!`, html };
}
```

Keep waitlist, cancellation, promotion, and organizer templates in the registration handler initially, but make them call the exported `escapeHtml`, `renderPlainText`, and `wrapEmail` helpers rather than accepting raw dynamic HTML or duplicating the shell.

- [ ] **Step 4: Run content tests**

```powershell
npx vitest run supabase/functions/_shared/email-content.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit safe content helpers**

```powershell
git add -- supabase/functions/_shared/email-content.ts supabase/functions/_shared/email-content.test.ts
git commit -m "feat: add safe event email content helpers"
```

### Task 5: Add Trusted Automation and Delivery Idempotency

**Files:**
- Create: `supabase/functions/_shared/email-automation.ts`
- Create: `supabase/functions/_shared/email-automation.test.ts`
- Create: `supabase/functions/_shared/email-delivery.ts`
- Create: `supabase/functions/_shared/email-delivery.test.ts`
- Create: `supabase/functions/_shared/org-smtp.ts`

- [ ] **Step 1: Write failing authorization and delivery-key tests**

Create `supabase/functions/_shared/email-automation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isTrustedAutomationRequest,
  registrationDeliveryKey,
  reminderDeliveryKey,
} from './email-automation.ts';

describe('email automation boundary', () => {
  it('accepts only the exact service-role bearer credential', () => {
    const trusted = new Request('https://example.test', {
      headers: { Authorization: 'Bearer service-secret' },
    });
    const user = new Request('https://example.test', {
      headers: { Authorization: 'Bearer user-token' },
    });
    expect(isTrustedAutomationRequest(trusted, 'service-secret')).toBe(true);
    expect(isTrustedAutomationRequest(user, 'service-secret')).toBe(false);
    expect(isTrustedAutomationRequest(new Request('https://example.test'), 'service-secret')).toBe(false);
  });

  it('creates stable logical occurrence keys without recipient PII', () => {
    expect(registrationDeliveryKey('registration_confirmation', 'reg-1')).toBe(
      'registration_confirmation:reg-1:initial',
    );
    expect(registrationDeliveryKey('waitlist_promotion', 'reg-1', '2026-08-06T12:00:00Z')).toBe(
      'waitlist_promotion:reg-1:2026-08-06T12:00:00Z',
    );
    expect(reminderDeliveryKey('event-1', 'reg-1', '2026-09-01T13:00:00Z', 24)).toBe(
      'event_reminder:event-1:reg-1:2026-09-01T13:00:00Z:24',
    );
  });
});
```

Create `supabase/functions/_shared/email-delivery.test.ts` with an in-memory adapter proving these outcomes:

```ts
import { describe, expect, it, vi } from 'vitest';
import { deliverOnce } from './email-delivery.ts';

describe('deliverOnce', () => {
  it('sends and completes a newly claimed delivery', async () => {
    const store = { claim: vi.fn(async () => 'claimed' as const), complete: vi.fn(), fail: vi.fn() };
    const send = vi.fn(async () => undefined);
    expect(await deliverOnce(store, { deliveryKey: 'key-1' }, send)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith('key-1');
  });

  it('skips an already sent key', async () => {
    const store = { claim: vi.fn(async () => 'already_sent' as const), complete: vi.fn(), fail: vi.fn() };
    const send = vi.fn();
    expect(await deliverOnce(store, { deliveryKey: 'key-1' }, send)).toBe('already_sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('records a sanitized failure code and remains retryable', async () => {
    const store = { claim: vi.fn(async () => 'claimed' as const), complete: vi.fn(), fail: vi.fn() };
    const send = vi.fn(async () => { throw new Error('SMTP exposed person@example.org'); });
    expect(await deliverOnce(store, { deliveryKey: 'key-1' }, send)).toBe('failed');
    expect(store.fail).toHaveBeenCalledWith('key-1', 'smtp_send_failed');
    expect(JSON.stringify(store.fail.mock.calls)).not.toContain('person@example.org');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.test.ts --maxWorkers=1
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the pure automation helpers**

Create `supabase/functions/_shared/email-automation.ts`:

```ts
export function isTrustedAutomationRequest(request: Request, serviceRoleKey: string): boolean {
  return serviceRoleKey.length > 0
    && request.headers.get('authorization') === `Bearer ${serviceRoleKey}`;
}

export function registrationDeliveryKey(
  kind: string,
  registrationId: string,
  occurrence = 'initial',
): string {
  return `${kind}:${registrationId}:${occurrence}`;
}

export function reminderDeliveryKey(
  eventId: string,
  registrationId: string,
  startDate: string,
  reminderHoursBefore: number,
): string {
  return `event_reminder:${eventId}:${registrationId}:${startDate}:${reminderHoursBefore}`;
}
```

- [ ] **Step 4: Implement delivery claims and sanitized completion/failure**

Create `supabase/functions/_shared/email-delivery.ts` with this public contract:

```ts
export interface DeliveryClaim {
  deliveryKey: string;
  orgId?: string;
  eventId?: string;
  registrationId?: string;
  kind?: string;
}

export interface DeliveryStore {
  claim(delivery: DeliveryClaim): Promise<'claimed' | 'already_sent'>;
  complete(deliveryKey: string): Promise<void>;
  fail(deliveryKey: string, errorCode: string): Promise<void>;
}

export async function deliverOnce(
  store: DeliveryStore,
  delivery: DeliveryClaim,
  send: () => Promise<void>,
): Promise<'sent' | 'already_sent' | 'failed'> {
  const claim = await store.claim(delivery);
  if (claim === 'already_sent') return 'already_sent';
  try {
    await send();
    await store.complete(delivery.deliveryKey);
    return 'sent';
  } catch {
    await store.fail(delivery.deliveryKey, 'smtp_send_failed');
    return 'failed';
  }
}
```

Add `createSupabaseDeliveryStore(client)` in the same file. Its `claim` method:

1. Inserts the complete ledger row with `pending` state.
2. On PostgreSQL `23505`, selects only `state` by `delivery_key`.
3. Returns `already_sent` for `sent`.
4. Atomically updates `failed` to `pending`, increments `attempt_count`, clears `last_error_code`, and refreshes `attempted_at` before returning `claimed`.

`complete` sets `state='sent'`, `sent_at`, and `updated_at`. `fail` sets `state='failed'`, the fixed error code, and `updated_at`. No method accepts recipient address, message body, SMTP error text, or registration answers.

- [ ] **Step 5: Add the Vault-backed SMTP adapter**

Create `supabase/functions/_shared/org-smtp.ts` with:

```ts
import { SMTPClient } from 'npm:emailjs@4.0.3';

export interface SmtpConfig {
  host: string;
  port?: number;
  fromName?: string;
  fromEmail: string;
  auth?: { user?: string };
}

export async function loadSmtpPassword(
  client: { rpc(name: string, args: Record<string, string>): Promise<{ data: string | null; error: unknown }> },
  orgId: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_org_smtp_secret', { p_org_id: orgId });
  if (error || !data) throw new Error('smtp_not_configured');
  return data;
}

export async function sendHtmlEmail(input: {
  config: SmtpConfig;
  password: string;
  orgName: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const port = input.config.port || 465;
  const client = new SMTPClient({
    host: input.config.host,
    port,
    ssl: port === 465,
    user: input.config.auth?.user,
    password: input.password,
  });
  await client.sendAsync({
    from: `"${input.config.fromName || input.orgName}" <${input.config.fromEmail}>`,
    to: input.to,
    subject: input.subject,
    attachment: [{ data: input.html, alternative: true }],
  });
}
```

Pin the modified functions' Supabase JS import to the exact tested version in per-function `deno.json`; do not alter imports in the three baseline-only functions.

- [ ] **Step 6: Run shared-helper tests**

```powershell
npx vitest run supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit the automation foundation**

```powershell
git add -- supabase/functions/_shared/email-automation.ts supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.ts supabase/functions/_shared/email-delivery.test.ts supabase/functions/_shared/org-smtp.ts
git commit -m "feat: add trusted idempotent email delivery"
```

### Task 6: Refactor Registration Email Delivery Around Canonical Records

**Files:**
- Create: `supabase/functions/send-registration-email/handler.ts`
- Create: `supabase/functions/send-registration-email/handler.test.ts`
- Modify: `supabase/functions/send-registration-email/send-registration-email.ts`
- Create: `supabase/functions/send-registration-email/deno.json`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write failing registration-handler tests**

Create `supabase/functions/send-registration-email/handler.test.ts`. Build fixtures for a parking event, organization SMTP configuration, form fields, and canonical registrations. Inject repository, delivery-store, and mail-send fakes. Cover all of these cases explicitly:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleRegistrationEmail } from './handler.ts';

describe('handleRegistrationEmail', () => {
  it('rejects a non-POST request before querying canonical records', async () => {
    const loadDelivery = vi.fn();
    const response = await handleRegistrationEmail(
      new Request('https://example.test', { method: 'GET' }),
      testDependencies({ loadDelivery }),
    );
    expect(response.status).toBe(405);
    expect(loadDelivery).not.toHaveBeenCalled();
  });

  it('rejects an ordinary authenticated token before reading the body', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token' },
      body: '{not-json',
    });
    const response = await handleRegistrationEmail(request, testDependencies());
    expect(response.status).toBe(401);
  });

  it('reloads an initial confirmed registration and uses only canonical content', async () => {
    const send = vi.fn(async () => undefined);
    const dependencies = testDependencies({ send });
    const request = authorizedRequest({
      kind: 'registration_confirmation',
      registration_id: 'registration-1',
      injected_email: 'attacker@example.org',
      injected_html: '<script>attack()</script>',
    });
    const response = await handleRegistrationEmail(request, dependencies);
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'canonical@example.org',
      subject: 'Registration Confirmed: Parking Event',
    }));
    expect(JSON.stringify(send.mock.calls)).not.toContain('attacker@example.org');
    expect(JSON.stringify(send.mock.calls)).not.toContain('attack()');
  });

  it('adds selected payment method and current status to a parking confirmation', async () => {
    const send = vi.fn(async () => undefined);
    await handleRegistrationEmail(authorizedRequest({
      kind: 'registration_confirmation',
      registration_id: 'registration-1',
    }), testDependencies({ send, paymentMethod: 'in_person', paymentStatus: 'pending' }));
    const html = send.mock.calls[0][0].html;
    expect(html).toContain('Payment method: Pay in Person');
    expect(html).toContain('Payment status: Pending verification');
    expect(html).not.toMatch(/print|printable|ready|mailed|pickup/i);
  });

  it.each(['registration_waitlist', 'registration_cancellation', 'waitlist_promotion', 'organizer_notification'])
  ('preserves system-controlled %s copy', async (kind) => {
    const send = vi.fn(async () => undefined);
    await handleRegistrationEmail(
      authorizedRequest({ kind, registration_id: 'registration-1' }),
      testDependencies({ send, canonicalTransition: kind }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].html).not.toContain('Creator confirmation text');
  });

  it('suppresses an already-sent logical delivery', async () => {
    const send = vi.fn();
    const response = await handleRegistrationEmail(
      authorizedRequest({ kind: 'registration_confirmation', registration_id: 'registration-1' }),
      testDependencies({ send, claimResult: 'already_sent' }),
    );
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
});
```

The test file must define `authorizedRequest()` and `testDependencies()` locally with exact canonical fixture values. Add separate assertions for escaped title, form label, form answer, location, and cancellation URL. Add transition-mismatch, missing-recipient, missing-message, missing-SMTP, and SMTP-failure cases; responses and failure records may contain fixed codes but never PII, message content, form answers, or secret values.

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run supabase/functions/send-registration-email/handler.test.ts --maxWorkers=1
```

Expected: FAIL because `handler.ts` does not exist.

- [ ] **Step 3: Implement the dependency-injected handler**

Create `handler.ts` with these exported contracts:

```ts
export type RegistrationDeliveryKind =
  | 'registration_confirmation'
  | 'registration_waitlist'
  | 'registration_cancellation'
  | 'waitlist_promotion'
  | 'organizer_notification';

export interface RegistrationEmailRequest {
  registration_id: string;
  kind: RegistrationDeliveryKind;
}

export interface RegistrationEmailDependencies {
  serviceRoleKey: string;
  loadCanonicalDelivery(input: RegistrationEmailRequest): Promise<CanonicalRegistrationDelivery | null>;
  validateTransition(input: RegistrationEmailRequest, record: CanonicalRegistrationDelivery): boolean;
  loadSmtpPassword(orgId: string): Promise<string>;
  deliver(
    claim: DeliveryClaim,
    send: () => Promise<void>,
  ): Promise<'sent' | 'already_sent' | 'failed'>;
  send(input: OutgoingEmail): Promise<void>;
}

export async function handleRegistrationEmail(
  request: Request,
  dependencies: RegistrationEmailDependencies,
): Promise<Response>;
```

The handler must execute in this order:

1. Reject any method except `POST` with `405`.
2. Compare the exact bearer credential with `serviceRoleKey`; return `401` before `request.json()` on failure.
3. Parse and validate only `registration_id` and `kind`; ignore all other keys.
4. Reload the registration, event, organization, form definition, and payment projection through `loadCanonicalDelivery`. Construct cancellation links with the `URL` and `URLSearchParams` APIs from canonical IDs/tokens before passing the resulting string to the escaping content helper.
5. Confirm the requested transition against canonical current/previous state; return a fixed skipped code if it does not match.
6. Compose initial confirmed registrations with `confirmation_message` and parking payment facts. Keep waitlist, cancellation, promotion, and organizer copy system-controlled.
7. Claim the deterministic delivery key before SMTP work, load the Vault password, and send through the shared adapter.
8. Return fixed result counts/codes only. Do not return or log an address, body, form value, SMTP error, or credential.

Preserve all existing subject lines, cancellation links, form-detail ordering, waitlist copy, cancellation copy, promotion copy, and organizer notification behavior unless the approved specification explicitly changes it.

- [ ] **Step 4: Replace the recovered entrypoint with thin production wiring**

In `send-registration-email.ts`, create the Supabase service-role client, canonical repository, delivery store, and SMTP adapter, then pass them to `handleRegistrationEmail`. The canonical query must select named columns instead of `*`, including the current `payment_method` and `payment_status`. It must not accept canonical content from the webhook body.

Create `deno.json` with exact import pins used by this function. Pin `@supabase/supabase-js` to the repository-tested exact version and keep `emailjs` at `npm:emailjs@4.0.3` through the shared adapter.

Update only these function blocks in `supabase/config.toml`:

```toml
[functions.send-registration-email]
verify_jwt = true
entrypoint = "./functions/send-registration-email/send-registration-email.ts"

[functions.send-event-reminders]
verify_jwt = true
```

Do not change the other six blocks.

- [ ] **Step 5: Run registration and shared tests**

```powershell
npx vitest run supabase/functions/send-registration-email/handler.test.ts supabase/functions/_shared/email-content.test.ts supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit the registration function**

```powershell
git add -- supabase/functions/send-registration-email supabase/functions/_shared supabase/config.toml
git commit -m "feat: customize registration confirmation emails"
```

### Task 7: Refactor Reminder Delivery With Fresh Payment State and Partial Retry

**Files:**
- Create: `supabase/functions/send-event-reminders/handler.ts`
- Create: `supabase/functions/send-event-reminders/handler.test.ts`
- Modify: `supabase/functions/send-event-reminders/index.ts`
- Create: `supabase/functions/send-event-reminders/deno.json`
- Verify: `supabase/config.toml`

- [ ] **Step 1: Write failing reminder-handler tests**

Create `handler.test.ts` with injected clock, repository, delivery, password, and send fakes. Cover authorization before body/database work, the existing hourly threshold, confirmed recipients only, and the following key cases:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleEventReminders } from './handler.ts';

describe('handleEventReminders', () => {
  it('loads fresh payment state separately for every due parking recipient', async () => {
    const send = vi.fn(async () => undefined);
    const loadRecipients = vi.fn(async () => [
      canonicalRecipient({ id: 'registration-1', payment_status: 'pending' }),
      canonicalRecipient({ id: 'registration-2', payment_status: 'paid' }),
    ]);
    const response = await handleEventReminders(authorizedReminderRequest(),
      testReminderDependencies({ loadRecipients, send }));
    expect(response.status).toBe(200);
    expect(send.mock.calls[0][0].html).toContain('Payment status: Pending verification');
    expect(send.mock.calls[1][0].html).toContain('Payment status: Verified');
  });

  it('retries a failed recipient without resending a successful recipient', async () => {
    const deliver = vi.fn()
      .mockResolvedValueOnce('already_sent')
      .mockResolvedValueOnce('sent');
    const send = vi.fn(async () => undefined);
    const response = await handleEventReminders(authorizedReminderRequest(),
      testReminderDependencies({ deliver, send }));
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not mark the event complete while an intended delivery failed', async () => {
    const markReminderComplete = vi.fn();
    const deliver = vi.fn()
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('failed');
    await handleEventReminders(authorizedReminderRequest(),
      testReminderDependencies({ deliver, markReminderComplete }));
    expect(markReminderComplete).not.toHaveBeenCalled();
  });

  it('marks an event complete after every intended delivery is sent or already sent', async () => {
    const markReminderComplete = vi.fn();
    const deliver = vi.fn()
      .mockResolvedValueOnce('already_sent')
      .mockResolvedValueOnce('sent');
    await handleEventReminders(authorizedReminderRequest(),
      testReminderDependencies({ deliver, markReminderComplete }));
    expect(markReminderComplete).toHaveBeenCalledTimes(1);
  });
});
```

Also test: non-POST `405`; wrong bearer `401`; no reminder time; blank custom message; draft/inactive event; future threshold; cancelled/waitlisted registration exclusion; escaped custom message/title/location; Pay in Person and Tithe.ly labels; all payment statuses; missing email skip; Vault failure; one recipient SMTP failure does not halt later recipients; and response/log payloads contain only fixed counts/codes.

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run supabase/functions/send-event-reminders/handler.test.ts --maxWorkers=1
```

Expected: FAIL because `handler.ts` does not exist.

- [ ] **Step 3: Implement due-event orchestration**

Create `handler.ts` with these public contracts:

```ts
export interface ReminderDependencies {
  serviceRoleKey: string;
  now(): Date;
  loadDueEvents(now: Date): Promise<CanonicalReminderEvent[]>;
  loadConfirmedRecipients(eventId: string): Promise<CanonicalReminderRecipient[]>;
  loadSmtpPassword(orgId: string): Promise<string>;
  deliver(
    claim: DeliveryClaim,
    send: () => Promise<void>,
  ): Promise<'sent' | 'already_sent' | 'failed'>;
  send(input: OutgoingEmail): Promise<void>;
  markReminderComplete(eventId: string, completedAt: Date): Promise<void>;
}

export async function handleEventReminders(
  request: Request,
  dependencies: ReminderDependencies,
): Promise<Response>;
```

Preserve the recovered function's due-window behavior and one-reminder-per-event model. Query named columns and reload confirmed registrations, including current `payment_method` and `payment_status`, at execution time. Use a delivery key containing event ID, registration ID, event start, and `reminder_hours_before`. Continue after individual failures. Set `reminder_sent_at` only after every intended key is either `sent` or `already_sent`; a failed key leaves the event retryable, while the ledger prevents successful recipients from receiving duplicates.

- [ ] **Step 4: Replace the recovered reminder entrypoint with thin wiring**

In `index.ts`, create the service-role Supabase client, repository, delivery store, Vault-backed SMTP adapter, and system clock. Pass them to `handleEventReminders`. Require exact bearer authorization in the handler even though `verify_jwt = true` is also configured.

Create `deno.json` with the exact tested `@supabase/supabase-js` version. Do not change the hourly cron expression or invoke the function during implementation.

- [ ] **Step 5: Run reminder and shared tests**

```powershell
npx vitest run supabase/functions/send-event-reminders/handler.test.ts supabase/functions/_shared/email-content.test.ts supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 6: Commit the reminder function**

```powershell
git add -- supabase/functions/send-event-reminders supabase/config.toml
git commit -m "feat: customize event reminder emails"
```

### Task 8: Run Local Verification and Inspect the Event Editor

**Files:**
- Verify all files changed by Tasks 1-7

- [ ] **Step 1: Run focused frontend, migration, inventory, and function tests serially**

```powershell
npx vitest run src/config/__tests__/eventEmailMessages.test.js src/config/__tests__/eventPresets.test.js src/utils/__tests__/eventPayload.test.js src/components/__tests__/EventEmailMessageFields.test.jsx src/security/__tests__/eventEmailMigration.test.js src/security/__tests__/edgeFunctionInventory.test.js supabase/functions/_shared/email-content.test.ts supabase/functions/_shared/email-automation.test.ts supabase/functions/_shared/email-delivery.test.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-event-reminders/handler.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run the complete repository gates serially**

```powershell
npm run lint
npm run check:migrations
npx vitest run --dir src --maxWorkers=1
npm run build
git diff --check
```

Expected: all commands PASS. Do not add or broaden lint exclusions to obtain a pass.

- [ ] **Step 3: Start the local application for browser inspection**

```powershell
npm run dev -- --host 127.0.0.1
```

Use the repository's existing local test credentials/data only; do not access an authenticated user session or production account without separate permission. In a browser, inspect create, edit, duplicate, and quick-status flows at desktop and narrow widths.

Confirm all of the following:

- Every event editor shows a plain-text confirmation-message control.
- Selecting the parking preset seeds `Thank you for registering for this parking event.` without overwriting authored text.
- The reminder-message control stays visible but disabled when no reminder time is selected.
- Enabling a reminder seeds `This is a friendly reminder that your event is coming up soon!` only when the field is blank.
- Disabling a reminder preserves the current reminder text and locks the control.
- Re-enabling a reminder restores the preserved text.
- Active parking and reminder-enabled events show specific validation before save or quick activation when required text is blank.
- Draft events may preserve blank fields.
- No UI text promises printing, pickup, readiness, mailing, or notification behavior.

Stop the local development server normally after inspection.

- [ ] **Step 4: Review the final change boundary**

```powershell
git status --short
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD -- supabase/functions/capture-signer-ip supabase/functions/verify-cancel-token supabase/functions/weekly-digest
```

Expected: the last command shows only their immutable recovery files from the recovery commit, with no later behavioral edits. Review the full diff for PII/secrets, floating imports, system-authored parking-process wording, unrelated code, and broad lint/test suppressions.

- [ ] **Step 5: Commit any verification-only corrections**

If inspection required a scoped correction, rerun the affected focused test first and then all Step 2 gates before committing:

```powershell
git add -p
git diff --cached --check
git commit -m "fix: complete event email message controls"
```

If no correction was needed, do not create an empty commit.

### Task 9: Prepare the PR and Preserve the Production Deployment Gate

**Files:**
- Verify branch history and changed files only

- [ ] **Step 1: Confirm the branch is reviewable and based on current remote main**

```powershell
git fetch origin
git status --porcelain=v1
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree, the planned sequence of small commits, and no whitespace errors. If `origin/main` moved, assess the diff and rebase while it is still cheap only when it does not disturb unrelated work.

- [ ] **Step 2: Re-run the required release evidence after any rebase**

```powershell
npm run lint
npm run check:migrations
npx vitest run --dir src --maxWorkers=1
npm run build
```

Expected: PASS on the exact commit to publish.

- [ ] **Step 3: Publish a non-draft PR without merging it**

```powershell
git push -u origin codex/email-message-control
$prBody = @'
## Summary

- recover all active Supabase Edge Function sources and configuration into Git
- add per-event confirmation and reminder text with active-event validation
- secure and make registration/reminder delivery canonical, idempotent, and payment-aware

## Baseline-only functions

`capture-signer-ip`, `verify-cancel-token`, and `weekly-digest` are source-recovery baselines only. They have no behavioral changes and must not be deployed by this work.

## Verification

- npm run lint
- npm run check:migrations
- npx vitest run --dir src --maxWorkers=1
- npm run build
- focused Edge Function handler and shared-module tests
- browser inspection of create, edit, duplicate, reminder-toggle, and quick-activation flows

## Deployment status

Production migration and deployment are intentionally pending. Do not run `supabase db push` until Issue #5 reconciles the live and repository migration ledgers. Production rollout and controlled test email delivery require separate authorization.
'@
gh pr create --base main --head codex/email-message-control --title "Customize event confirmation and reminder emails" --body $prBody
gh pr view --json number,url,isDraft,state,headRefName,baseRefName,statusCheckRollup
```

The reviewed PR body must summarize both source recovery and behavioral changes, call out the three baseline-only functions, enumerate local verification, and state that production migration/deployment is intentionally pending. Leave the PR unmerged unless the user gives separate explicit merge authorization.

- [ ] **Step 4: Keep production database and deployment operations blocked**

Do **not** run `supabase db push`: the live migration ledger is known to differ from the repository ledger and must first be reconciled under Issue #5. Do not manually execute this migration, deploy Firebase Hosting, deploy either modified Edge Function, change cron/trigger secrets, or send any test email in the PR-preparation task. Those are external production changes requiring separate authorization after review and migration-ledger reconciliation.

- [ ] **Step 5: After separate deployment authorization, use the approved dependency order**

Only after Issue #5 is resolved, the PR is reviewed/merged as separately authorized, and the user explicitly authorizes production rollout:

1. Read the live migration ledger and prove it aligns with the repository ledger.
2. Apply the reviewed database migration through the normal migration mechanism.
3. Deploy the application editor/validation build.
4. Deploy only `send-registration-email` from the reviewed repository commit.
5. Deploy only `send-event-reminders` from the reviewed repository commit.
6. Never deploy `capture-signer-ip`, `verify-cancel-token`, or `weekly-digest` as part of this work.
7. Read back the full function inventory, versions, JWT settings, and bundle hashes; compare the two changed bundles with the reviewed source artifact.
8. With a separately approved test recipient, send one controlled confirmation and one controlled reminder and inspect content, links, current payment state, ledger state, and duplicate suppression.

Treat any migration mismatch, unexpected function revision, hash mismatch, unauthorized response, duplicate delivery, stale reminder payment status, or parking-process promise as a failed rollout. Stop and report it rather than continuing.

## Completion Gate

- All eight active Edge Functions have repository-owned source and explicit configuration.
- The three baseline-only recoveries have no behavioral changes and were not redeployed.
- Both event message fields persist through create, edit, duplicate, draft, active, and quick-status flows.
- Reminder text is visible but not editable without a configured reminder time; disabling preserves it.
- Active parking and reminder-enabled events cannot omit their required message.
- Initial confirmed registrations use custom confirmation text; other registration variants remain system-controlled.
- Parking confirmations and reminders display selected payment method and current payment status without process promises.
- Reminder batches retry failed recipients without resending successful recipients.
- Both functions authenticate trusted automation, reload canonical records, escape dynamic content, use Vault-backed SMTP, and return/log no sensitive content.
- Focused tests, full serial Vitest, migration checks, lint, build, browser inspection, and diff review pass.
- The PR is non-draft and unmerged; production migration, deployment, and controlled email verification remain separately authorized operations.

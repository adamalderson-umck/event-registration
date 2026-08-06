# Registration Payment Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-click paid verification with an auditable cash, check, and Tithe.ly payment ledger that supports multiple uncapped donations, partial status, conditional reference numbers, void-and-replace corrections, and consistent admin/reporting output.

**Architecture:** A normalized Supabase `registration_payments` table is the authoritative history. Security-definer RPCs record and void payments, then atomically refresh cached registration payment projections used by React tables, reports, and parking-pass rules. Focused React components handle entry and history, while pure utilities own display formatting and CSV/print serialization.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, React 19, Supabase JS, Vitest 4, Testing Library, Tailwind CSS, Vite.

---

## Scope and file map

This is one cohesive feature, not a set of independent subsystems: every UI and report change consumes the same payment ledger and projection contract.

**Create:**

- `supabase/migrations/20260806030000_registration_payment_ledger.sql` — ledger schema, historical migration, projection triggers, secured record/void RPCs, and legacy RPC retirement.
- `src/security/__tests__/paymentLedgerMigration.test.js` — source-level migration contract checks available without a local Supabase CLI.
- `src/components/RecordPaymentDialog.jsx` — cash/check/Tithe.ly entry form and client-side conditional validation.
- `src/components/__tests__/RecordPaymentDialog.test.jsx` — payment-entry form behavior.
- `src/components/PaymentHistory.jsx` — active/voided audit history and reason-required void flow.
- `src/components/__tests__/PaymentHistory.test.jsx` — history rendering and correction behavior.

**Modify:**

- `src/utils/paymentStatus.js` — registration payment summary, remaining amount, active-payment ordering, and record-action eligibility.
- `src/utils/__tests__/paymentStatus.test.js` — status/summary coverage including donations and legacy records.
- `src/components/RegistrationViewer.jsx` — load ledger rows, call RPCs, refresh registration state, render dialogs/history, expose ledger export.
- `src/components/__tests__/RegistrationViewer.test.jsx` — standard and parking integration, RPC payloads, preserved selected method, and export wiring.
- `src/components/ParkingRegistrationTable.jsx` — concise payment summary and Record Payment action.
- `src/components/__tests__/ParkingRegistrationTable.test.jsx` — partial/paid summaries and action eligibility.
- `src/utils/exportCsv.js` — concise registration Payment values plus one-row-per-payment ledger CSV.
- `src/utils/__tests__/exportCsv.test.js` — approved registration column order and payment-ledger escaping/void data.
- `src/utils/printReports.js` — individual payment history, concise table summaries, and actual collected-total math.
- `src/utils/__tests__/printReports.test.js` — printed summary/history escaping and correct collected totals.
- `src/utils/parkingRegistration.js` — classify `partial` as payment pending for passes.
- `src/utils/__tests__/parkingRegistration.test.js` — partial registrations cannot print a pass.

## Task 1: Establish the secured database ledger

**Files:**

- Create: `src/security/__tests__/paymentLedgerMigration.test.js`
- Create: `supabase/migrations/20260806030000_registration_payment_ledger.sql`

- [ ] **Step 1: Write the failing migration contract test**

Create `src/security/__tests__/paymentLedgerMigration.test.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const migrationName = fs.readdirSync(migrationsDir)
  .find((name) => name.endsWith('_registration_payment_ledger.sql'));
const sql = migrationName
  ? fs.readFileSync(path.join(migrationsDir, migrationName), 'utf8')
  : '';

describe('registration payment ledger migration', () => {
  it('creates normalized audited payment records and projections', () => {
    expect(migrationName).toBeDefined();
    expect(sql).toMatch(/create table public\.registration_payments/i);
    expect(sql).toMatch(/payment_expected_amount numeric\(12, 2\)/i);
    expect(sql).toMatch(/payment_recorded_total numeric\(12, 2\)/i);
    expect(sql).toMatch(/legacy_payment_paid boolean/i);
    expect(sql).toMatch(/check \(method in \('cash', 'check', 'tithely'\)\)/i);
    expect(sql).toMatch(/unique index registration_payments_active_tithely_transaction_uidx/i);
    expect(sql).toMatch(/where method = 'tithely' and voided_at is null/i);
    expect(sql).toMatch(/on delete restrict/i);
  });

  it('derives snapshots and protects cached projections', () => {
    expect(sql).toMatch(/initialize_registration_payment_projection/i);
    expect(sql).toMatch(/before insert on public\.registrations/i);
    expect(sql).toMatch(/guard_registration_payment_projection/i);
    expect(sql).toMatch(/before update of payment_expected_amount, payment_recorded_total, payment_status, legacy_payment_paid/i);
    expect(sql).toMatch(/current_setting\('app\.payment_projection_write', true\)/i);
  });

  it('records and voids only through organization-scoped RPCs', () => {
    expect(sql).toMatch(/function public\.record_registration_payment/i);
    expect(sql).toMatch(/function public\.void_registration_payment/i);
    expect(sql).toMatch(/private\.is_org_member\(p_org_id\)/i);
    expect(sql).toMatch(/for update of registrations/i);
    expect(sql).toMatch(/grant execute on function public\.record_registration_payment/i);
    expect(sql).toMatch(/grant execute on function public\.void_registration_payment/i);
    expect(sql).toMatch(/revoke insert, update, delete on public\.registration_payments from anon, authenticated/i);
  });

  it('retires one-click paid mutation without rewriting selected method', () => {
    expect(sql).toMatch(/drop function if exists public\.mark_registration_paid\(uuid, uuid\)/i);
    expect(sql).not.toMatch(/payment_method\s*=\s*'in_person_verified'/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
npm run test:run -- src/security/__tests__/paymentLedgerMigration.test.js
```

Expected: FAIL because no `_registration_payment_ledger.sql` migration exists.

- [ ] **Step 3: Create the complete payment-ledger migration**

Create `supabase/migrations/20260806030000_registration_payment_ledger.sql` with this contract:

```sql
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS payment_expected_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_recorded_total numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_payment_paid boolean NOT NULL DEFAULT false;

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_payment_status_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_payment_expected_amount_check
  CHECK (payment_expected_amount IS NULL OR payment_expected_amount > 0),
  ADD CONSTRAINT registrations_payment_recorded_total_check
  CHECK (payment_recorded_total >= 0);

CREATE TABLE public.registration_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE RESTRICT,
  method text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CONSTRAINT registration_payments_method_check
    CHECK (method IN ('cash', 'check', 'tithely')),
  CONSTRAINT registration_payments_amount_check CHECK (amount > 0),
  CONSTRAINT registration_payments_reference_check CHECK (
    (method = 'cash' AND reference_number IS NULL)
    OR
    (method IN ('check', 'tithely') AND NULLIF(btrim(reference_number), '') IS NOT NULL)
  ),
  CONSTRAINT registration_payments_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR
    (
      voided_at IS NOT NULL
      AND voided_by IS NOT NULL
      AND NULLIF(btrim(void_reason), '') IS NOT NULL
    )
  )
);

CREATE INDEX registration_payments_registration_idx
  ON public.registration_payments(registration_id, payment_date DESC, created_at DESC);
CREATE UNIQUE INDEX registration_payments_active_tithely_transaction_uidx
  ON public.registration_payments(org_id, lower(btrim(reference_number)))
  WHERE method = 'tithely' AND voided_at IS NULL;

ALTER TABLE public.registration_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY registration_payments_member_read
  ON public.registration_payments
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(org_id)));

GRANT SELECT ON public.registration_payments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.registration_payments FROM PUBLIC, anon, authenticated;

-- Preserve paid history without inventing amounts or references. Pending records
-- receive the current event amount because no earlier snapshot exists.
UPDATE public.registrations AS registrations
SET
  legacy_payment_paid = registrations.payment_status = 'paid',
  payment_recorded_total = 0,
  payment_expected_amount = CASE
    WHEN registrations.payment_status = 'paid' THEN NULL
    WHEN events.payment_enabled AND events.payment_amount > 0 THEN events.payment_amount
    ELSE NULL
  END,
  payment_status = CASE
    WHEN registrations.payment_status = 'paid' THEN 'paid'
    WHEN events.payment_enabled THEN 'pending'
    ELSE 'not_required'
  END
FROM public.events AS events
WHERE events.id = registrations.event_id;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'partial', 'paid'));

CREATE OR REPLACE FUNCTION private.initialize_registration_payment_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  event_payment_enabled boolean;
  event_payment_amount numeric(12, 2);
BEGIN
  SELECT events.payment_enabled, events.payment_amount
  INTO event_payment_enabled, event_payment_amount
  FROM public.events AS events
  WHERE events.id = NEW.event_id
    AND events.org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration event does not belong to the supplied organization';
  END IF;

  NEW.payment_expected_amount := CASE
    WHEN event_payment_enabled AND event_payment_amount > 0 THEN event_payment_amount
    ELSE NULL
  END;
  NEW.payment_recorded_total := 0;
  NEW.legacy_payment_paid := false;
  NEW.payment_status := CASE WHEN event_payment_enabled THEN 'pending' ELSE 'not_required' END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_registration_payment_projection
  ON public.registrations;
CREATE TRIGGER initialize_registration_payment_projection
BEFORE INSERT ON public.registrations
FOR EACH ROW EXECUTE FUNCTION private.initialize_registration_payment_projection();

CREATE OR REPLACE FUNCTION private.guard_registration_payment_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF current_setting('app.payment_projection_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Registration payment projections are read-only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_payment_projection
  ON public.registrations;
CREATE TRIGGER guard_registration_payment_projection
BEFORE UPDATE OF payment_expected_amount, payment_recorded_total, payment_status, legacy_payment_paid
ON public.registrations
FOR EACH ROW EXECUTE FUNCTION private.guard_registration_payment_projection();

CREATE OR REPLACE FUNCTION private.refresh_registration_payment_projection(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  refreshed public.registrations;
  payment_enabled boolean;
  active_total numeric(12, 2);
  next_status text;
BEGIN
  SELECT registrations, events.payment_enabled
  INTO refreshed, payment_enabled
  FROM public.registrations AS registrations
  JOIN public.events AS events ON events.id = registrations.event_id
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  SELECT COALESCE(sum(payments.amount), 0)
  INTO active_total
  FROM public.registration_payments AS payments
  WHERE payments.registration_id = p_registration_id
    AND payments.org_id = p_org_id
    AND payments.voided_at IS NULL;

  next_status := CASE
    WHEN NOT payment_enabled THEN 'not_required'
    WHEN refreshed.legacy_payment_paid THEN 'paid'
    WHEN active_total = 0 THEN 'pending'
    WHEN refreshed.payment_expected_amount IS NULL THEN 'paid'
    WHEN active_total < refreshed.payment_expected_amount THEN 'partial'
    ELSE 'paid'
  END;

  PERFORM set_config('app.payment_projection_write', 'allowed', true);
  UPDATE public.registrations AS registrations
  SET payment_recorded_total = active_total,
      payment_status = next_status
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  RETURNING registrations.* INTO refreshed;
  PERFORM set_config('app.payment_projection_write', '', true);

  RETURN refreshed;
END;
$$;

CREATE OR REPLACE FUNCTION private.registration_payment_result(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'registration', to_jsonb(registrations),
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(payments) ORDER BY payments.payment_date DESC, payments.created_at DESC)
      FROM public.registration_payments AS payments
      WHERE payments.registration_id = registrations.id
        AND payments.org_id = registrations.org_id
    ), '[]'::jsonb)
  )
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION public.record_registration_payment(
  p_registration_id uuid,
  p_org_id uuid,
  p_method text,
  p_amount numeric,
  p_payment_date date,
  p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  registration_status text;
  event_payment_enabled boolean;
  normalized_method text := lower(btrim(p_method));
  normalized_reference text := NULLIF(btrim(p_reference_number), '');
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  SELECT registrations.status, events.payment_enabled
  INTO registration_status, event_payment_enabled
  FROM public.registrations AS registrations
  JOIN public.events AS events ON events.id = registrations.event_id
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;
  IF registration_status <> 'confirmed' OR NOT event_payment_enabled THEN
    RAISE EXCEPTION 'Registration is not eligible to receive a payment';
  END IF;
  IF normalized_method IS NULL OR normalized_method NOT IN ('cash', 'check', 'tithely') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_payment_date IS NULL OR p_payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Payment date must not be in the future';
  END IF;
  IF normalized_method = 'cash' AND normalized_reference IS NOT NULL THEN
    RAISE EXCEPTION 'Cash payments do not use a reference number';
  END IF;
  IF normalized_method = 'check' AND normalized_reference IS NULL THEN
    RAISE EXCEPTION 'Check number is required';
  END IF;
  IF normalized_method = 'tithely' AND normalized_reference IS NULL THEN
    RAISE EXCEPTION 'Tithe.ly transaction number is required';
  END IF;

  BEGIN
    INSERT INTO public.registration_payments (
      org_id, registration_id, method, amount, payment_date,
      reference_number, created_by
    ) VALUES (
      p_org_id, p_registration_id, normalized_method, p_amount,
      p_payment_date,
      CASE WHEN normalized_method = 'cash' THEN NULL ELSE normalized_reference END,
      (SELECT auth.uid())
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Tithe.ly transaction already reconciled' USING ERRCODE = '23505';
  END;

  PERFORM private.refresh_registration_payment_projection(p_registration_id, p_org_id);
  RETURN private.registration_payment_result(p_registration_id, p_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_registration_payment(
  p_payment_id uuid,
  p_registration_id uuid,
  p_org_id uuid,
  p_void_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  normalized_reason text := NULLIF(btrim(p_void_reason), '');
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;
  IF normalized_reason IS NULL THEN
    RAISE EXCEPTION 'Void reason is required';
  END IF;

  PERFORM 1
  FROM public.registration_payments AS payments
  WHERE payments.id = p_payment_id
    AND payments.registration_id = p_registration_id
    AND payments.org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  UPDATE public.registration_payments AS payments
  SET voided_at = now(),
      voided_by = (SELECT auth.uid()),
      void_reason = normalized_reason
  WHERE payments.id = p_payment_id
    AND payments.registration_id = p_registration_id
    AND payments.org_id = p_org_id
    AND payments.voided_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment is already voided';
  END IF;

  PERFORM private.refresh_registration_payment_projection(p_registration_id, p_org_id);
  RETURN private.registration_payment_result(p_registration_id, p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION private.initialize_registration_payment_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_registration_payment_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_registration_payment_projection(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.registration_payment_result(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_registration_payment(uuid, uuid, text, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_registration_payment(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_registration_payment(uuid, uuid, text, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_registration_payment(uuid, uuid, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_registration_paid(uuid, uuid);
```

- [ ] **Step 4: Strengthen the source-level contract assertions**

Add assertions to `paymentLedgerMigration.test.js` for the approved status cases and error text:

```js
it('implements pending, partial, paid, and legacy-paid derivation without overpaid', () => {
  expect(sql).toMatch(/when refreshed\.legacy_payment_paid then 'paid'/i);
  expect(sql).toMatch(/when active_total = 0 then 'pending'/i);
  expect(sql).toMatch(/when refreshed\.payment_expected_amount is null then 'paid'/i);
  expect(sql).toMatch(/when active_total < refreshed\.payment_expected_amount then 'partial'/i);
  expect(sql).not.toMatch(/'overpaid'/i);
});

it('requires conditional references, positive amounts, and nonfuture dates', () => {
  expect(sql).toMatch(/payment amount must be positive/i);
  expect(sql).toMatch(/check number is required/i);
  expect(sql).toMatch(/tithe\.ly transaction number is required/i);
  expect(sql).toMatch(/payment date must not be in the future/i);
  expect(sql).toMatch(/void reason is required/i);
});
```

- [ ] **Step 5: Run the migration contract tests**

Run:

```powershell
npm run test:run -- src/security/__tests__/paymentLedgerMigration.test.js src/security/__tests__/adminAccessMigration.test.js
```

Expected: both files PASS. No local Supabase runtime is configured in this repository, so these checks do not substitute for applying the migration to an authorized test/staging project later.

- [ ] **Step 6: Commit the database contract**

```powershell
git add src/security/__tests__/paymentLedgerMigration.test.js supabase/migrations/20260806030000_registration_payment_ledger.sql
git commit -m "feat: add registration payment ledger database contract"
```

## Task 2: Replace the binary status helper with payment summaries

**Files:**

- Modify: `src/utils/paymentStatus.js`
- Modify: `src/utils/__tests__/paymentStatus.test.js`
- Modify: `src/utils/parkingRegistration.js`
- Modify: `src/utils/__tests__/parkingRegistration.test.js`

- [ ] **Step 1: Replace the old helper tests with approved summary behavior**

Write these cases in `src/utils/__tests__/paymentStatus.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  canRecordRegistrationPayment,
  formatPaymentSummary,
  getActivePayments,
  getPaymentRemainingAmount,
} from '../paymentStatus';

describe('payment status helpers', () => {
  it.each([
    [{ payment_status: 'pending', payment_recorded_total: 0 }, 'Pending — $0.00 recorded'],
    [{ payment_status: 'partial', payment_recorded_total: 25, payment_expected_amount: 50 }, 'Partially Paid — $25.00 of $50.00'],
    [{ payment_status: 'paid', payment_recorded_total: 65, payment_expected_amount: 50 }, 'Paid — $65.00 recorded'],
    [{ payment_status: 'paid', payment_recorded_total: 10, payment_expected_amount: null }, 'Paid — $10.00 recorded'],
    [{ payment_status: 'not_required', payment_recorded_total: 0 }, 'Not required'],
    [{ payment_status: 'paid', legacy_payment_paid: true, payment_recorded_total: 0 }, 'Legacy paid — details unavailable'],
  ])('formats %j', (registration, expected) => {
    expect(formatPaymentSummary(registration)).toBe(expected);
  });

  it('never labels a donation above the expected amount as overpaid', () => {
    expect(formatPaymentSummary({
      payment_status: 'paid',
      payment_recorded_total: 150,
      payment_expected_amount: 50,
    })).toBe('Paid — $150.00 recorded');
  });

  it('calculates only a positive remaining amount', () => {
    expect(getPaymentRemainingAmount({ payment_expected_amount: 50, payment_recorded_total: 20 })).toBe(30);
    expect(getPaymentRemainingAmount({ payment_expected_amount: 50, payment_recorded_total: 65 })).toBe(0);
    expect(getPaymentRemainingAmount({ payment_expected_amount: null, payment_recorded_total: 20 })).toBeNull();
  });

  it.each(['pending', 'partial', 'paid'])('allows confirmed %s registrations to receive another payment', (payment_status) => {
    expect(canRecordRegistrationPayment({ status: 'confirmed', payment_status })).toBe(true);
  });

  it.each([
    undefined,
    { status: 'waitlisted', payment_status: 'pending' },
    { status: 'cancelled', payment_status: 'partial' },
    { status: 'confirmed', payment_status: 'not_required' },
  ])('rejects ineligible registrations', (registration) => {
    expect(canRecordRegistrationPayment(registration)).toBe(false);
  });

  it('sorts active payments by payment date then recorded timestamp', () => {
    const payments = [
      { id: 'void', payment_date: '2026-08-05', created_at: '2026-08-05T10:00:00Z', voided_at: '2026-08-05T11:00:00Z' },
      { id: 'older', payment_date: '2026-08-04', created_at: '2026-08-05T12:00:00Z' },
      { id: 'newer', payment_date: '2026-08-05', created_at: '2026-08-05T09:00:00Z' },
    ];
    expect(getActivePayments(payments).map(({ id }) => id)).toEqual(['newer', 'older']);
  });
});
```

Add `partial` to the parking helper matrix in `src/utils/__tests__/parkingRegistration.test.js`:

```js
['confirmed', 'partial', PARKING_PASS_STATUS.PAYMENT_PENDING],
```

- [ ] **Step 2: Run the focused helper tests and confirm failure**

```powershell
npm run test:run -- src/utils/__tests__/paymentStatus.test.js src/utils/__tests__/parkingRegistration.test.js
```

Expected: FAIL because the new exports and partial pass mapping do not exist.

- [ ] **Step 3: Implement the pure payment helpers**

Replace `src/utils/paymentStatus.js` with:

```js
const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

const RECORDABLE_STATUSES = new Set(['pending', 'partial', 'paid']);

export function formatCurrency(value) {
  return CURRENCY.format(Number(value) || 0);
}

export function getPaymentRemainingAmount(registration) {
  const expected = registration?.payment_expected_amount;
  if (expected === null || expected === undefined || expected === '') return null;
  return Math.max(Number(expected) - Number(registration?.payment_recorded_total || 0), 0);
}

export function formatPaymentSummary(registration) {
  if (!registration) return 'Not required';
  if (registration.legacy_payment_paid) return 'Legacy paid — details unavailable';

  const total = formatCurrency(registration.payment_recorded_total);
  if (registration.payment_status === 'not_required') return 'Not required';
  if (registration.payment_status === 'partial') {
    return `Partially Paid — ${total} of ${formatCurrency(registration.payment_expected_amount)}`;
  }
  if (registration.payment_status === 'paid') return `Paid — ${total} recorded`;
  return `Pending — ${total} recorded`;
}

export function canRecordRegistrationPayment(registration) {
  return Boolean(
    registration
    && registration.status === 'confirmed'
    && RECORDABLE_STATUSES.has(registration.payment_status),
  );
}

export function getActivePayments(payments = []) {
  return payments
    .filter((payment) => !payment.voided_at)
    .sort((left, right) => (
      right.payment_date.localeCompare(left.payment_date)
      || right.created_at.localeCompare(left.created_at)
    ));
}
```

In `src/utils/parkingRegistration.js`, treat both `pending` and `partial` as payment pending:

```js
if (['pending', 'partial'].includes(registration?.payment_status)) {
  return PARKING_PASS_STATUS.PAYMENT_PENDING;
}
```

- [ ] **Step 4: Run the focused helpers**

```powershell
npm run test:run -- src/utils/__tests__/paymentStatus.test.js src/utils/__tests__/parkingRegistration.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the shared projection helpers**

```powershell
git add src/utils/paymentStatus.js src/utils/__tests__/paymentStatus.test.js src/utils/parkingRegistration.js src/utils/__tests__/parkingRegistration.test.js
git commit -m "feat: derive registration payment summaries"
```

## Task 3: Build the method-aware Record Payment dialog

**Files:**

- Create: `src/components/RecordPaymentDialog.jsx`
- Create: `src/components/__tests__/RecordPaymentDialog.test.jsx`

- [ ] **Step 1: Write failing dialog tests**

Create `src/components/__tests__/RecordPaymentDialog.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordPaymentDialog from '../RecordPaymentDialog';

const registration = {
  payment_status: 'partial',
  payment_expected_amount: 50,
  payment_recorded_total: 20,
};

describe('RecordPaymentDialog', () => {
  it('submits cash without a reference number', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<RecordPaymentDialog registration={registration} onSubmit={onSubmit} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Amount'), '15.25');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      method: 'cash', amount: 15.25, referenceNumber: null,
    }));
  });

  it('requires a check number only for checks', async () => {
    const user = userEvent.setup();
    render(<RecordPaymentDialog registration={registration} onSubmit={vi.fn()} onClose={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Payment method'), 'check');
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Check number is required');

    await user.type(screen.getByLabelText('Check number'), '1042');
    expect(screen.queryByLabelText('Tithe.ly transaction number')).not.toBeInTheDocument();
  });

  it('requires a Tithe.ly transaction number', async () => {
    const user = userEvent.setup();
    render(<RecordPaymentDialog registration={registration} onSubmit={vi.fn()} onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Payment method'), 'tithely');
    expect(screen.getByLabelText('Tithe.ly transaction number')).toBeRequired();
  });

  it('rejects nonpositive amounts and future dates', async () => {
    const user = userEvent.setup();
    render(<RecordPaymentDialog registration={registration} onSubmit={vi.fn()} onClose={vi.fn()} today="2026-08-05" />);
    await user.type(screen.getByLabelText('Amount'), '0');
    await user.clear(screen.getByLabelText('Payment date'));
    await user.type(screen.getByLabelText('Payment date'), '2026-08-06');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(expect.arrayContaining([
      'Enter a positive amount', 'Payment date cannot be in the future',
    ]));
  });

  it('retains form values while displaying a server error', async () => {
    const { rerender } = render(<RecordPaymentDialog registration={registration} onSubmit={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Amount'), '10');
    rerender(<RecordPaymentDialog registration={registration} onSubmit={vi.fn()} onClose={vi.fn()} error="Tithe.ly transaction already reconciled" />);
    expect(screen.getByLabelText('Amount')).toHaveValue(10);
    expect(screen.getByText('Tithe.ly transaction already reconciled')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the dialog test and confirm failure**

```powershell
npm run test:run -- src/components/__tests__/RecordPaymentDialog.test.jsx
```

Expected: FAIL because `RecordPaymentDialog.jsx` does not exist.

- [ ] **Step 3: Implement the focused dialog**

Create `src/components/RecordPaymentDialog.jsx` with local date/validation helpers and this public contract:

```jsx
import React, { useState } from 'react';
import { formatCurrency, getPaymentRemainingAmount } from '../utils/paymentStatus';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';
import Label from './ui/Label';
import Select from './ui/Select';

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export default function RecordPaymentDialog({
  registration,
  onSubmit,
  onClose,
  submitting = false,
  error = '',
  today = localIsoDate(),
}) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [errors, setErrors] = useState({});
  const remaining = getPaymentRemainingAmount(registration);

  const handleMethodChange = (nextMethod) => {
    setMethod(nextMethod);
    setReferenceNumber('');
    setErrors({});
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) nextErrors.amount = 'Enter a positive amount';
    if (!paymentDate) nextErrors.paymentDate = 'Payment date is required';
    else if (paymentDate > today) nextErrors.paymentDate = 'Payment date cannot be in the future';
    if (method === 'check' && !referenceNumber.trim()) nextErrors.referenceNumber = 'Check number is required';
    if (method === 'tithely' && !referenceNumber.trim()) nextErrors.referenceNumber = 'Tithe.ly transaction number is required';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    onSubmit({
      method,
      amount: numericAmount,
      paymentDate,
      referenceNumber: method === 'cash' ? null : referenceNumber.trim(),
    });
  };

  const referenceLabel = method === 'check' ? 'Check number' : 'Tithe.ly transaction number';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="record-payment-title">
      <Card className="w-full max-w-lg p-6 shadow-2xl">
        <h2 id="record-payment-title" className="text-xl font-bold text-slate-900">Record Payment</h2>
        <div className="mt-2 text-sm text-slate-600">
          <p>Recorded: {formatCurrency(registration?.payment_recorded_total)}</p>
          {registration?.payment_expected_amount != null && <p>Expected: {formatCurrency(registration.payment_expected_amount)}</p>}
          {remaining > 0 && <p>Remaining: {formatCurrency(remaining)}</p>}
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <Label htmlFor="payment-method">Payment method</Label>
            <Select id="payment-method" value={method} onChange={(event) => handleMethodChange(event.target.value)} options={[
              { value: 'cash', label: 'Cash' },
              { value: 'check', label: 'Check' },
              { value: 'tithely', label: 'Tithe.ly' },
            ]} />
          </div>
          <div>
            <Label htmlFor="payment-amount">Amount</Label>
            <Input id="payment-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} error={errors.amount} required />
            {errors.amount && <p role="alert" className="mt-1 text-xs text-danger">{errors.amount}</p>}
          </div>
          <div>
            <Label htmlFor="payment-date">Payment date</Label>
            <Input id="payment-date" type="date" max={today} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} error={errors.paymentDate} required />
            {errors.paymentDate && <p role="alert" className="mt-1 text-xs text-danger">{errors.paymentDate}</p>}
          </div>
          {method !== 'cash' && (
            <div>
              <Label htmlFor="payment-reference">{referenceLabel}</Label>
              <Input id="payment-reference" value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} error={errors.referenceNumber} required />
              {errors.referenceNumber && <p role="alert" className="mt-1 text-xs text-danger">{errors.referenceNumber}</p>}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting}>Record Payment</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the component test**

```powershell
npm run test:run -- src/components/__tests__/RecordPaymentDialog.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit the entry dialog**

```powershell
git add src/components/RecordPaymentDialog.jsx src/components/__tests__/RecordPaymentDialog.test.jsx
git commit -m "feat: add registration payment entry dialog"
```

## Task 4: Add auditable payment history and void flow

**Files:**

- Create: `src/components/PaymentHistory.jsx`
- Create: `src/components/__tests__/PaymentHistory.test.jsx`

- [ ] **Step 1: Write failing history tests**

Create `src/components/__tests__/PaymentHistory.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentHistory from '../PaymentHistory';

const active = {
  id: 'payment-1', method: 'check', amount: 25, payment_date: '2026-08-04',
  reference_number: '1042', created_at: '2026-08-05T12:00:00Z', created_by: 'user-1',
};
const voided = {
  id: 'payment-2', method: 'tithely', amount: 10, payment_date: '2026-08-03',
  reference_number: 'TX-22', created_at: '2026-08-04T12:00:00Z', created_by: 'user-2',
  voided_at: '2026-08-05T13:00:00Z', voided_by: 'user-1', void_reason: 'Wrong registration',
};

describe('PaymentHistory', () => {
  it('renders active and voided details without hiding the audit record', () => {
    render(<PaymentHistory payments={[active, voided]} onVoid={vi.fn()} />);
    expect(screen.getByText('Check #1042')).toBeInTheDocument();
    expect(screen.getByText('Tithe.ly #TX-22')).toBeInTheDocument();
    expect(screen.getByText('Voided: Wrong registration')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Void Payment' })).toHaveLength(1);
  });

  it('requires a reason before requesting a void', async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn();
    render(<PaymentHistory payments={[active]} onVoid={onVoid} />);
    await user.click(screen.getByRole('button', { name: 'Void Payment' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Void' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Void reason is required');
    expect(onVoid).not.toHaveBeenCalled();
  });

  it('submits the payment and trimmed reason', async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn().mockResolvedValue();
    render(<PaymentHistory payments={[active]} onVoid={onVoid} />);
    await user.click(screen.getByRole('button', { name: 'Void Payment' }));
    await user.type(screen.getByLabelText('Void reason'), '  Entered twice  ');
    await user.click(screen.getByRole('button', { name: 'Confirm Void' }));
    expect(onVoid).toHaveBeenCalledWith(active, 'Entered twice');
  });
});
```

- [ ] **Step 2: Run and confirm the component is missing**

```powershell
npm run test:run -- src/components/__tests__/PaymentHistory.test.jsx
```

Expected: FAIL because `PaymentHistory.jsx` does not exist.

- [ ] **Step 3: Implement the history and void dialog**

Create `src/components/PaymentHistory.jsx`. Keep rendering and correction initiation in this component; persistence remains in `RegistrationViewer`.

```jsx
import React, { useState } from 'react';
import { formatCurrency } from '../utils/paymentStatus';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';
import Label from './ui/Label';

function methodLabel(payment) {
  if (payment.method === 'check') return `Check #${payment.reference_number}`;
  if (payment.method === 'tithely') return `Tithe.ly #${payment.reference_number}`;
  return 'Cash';
}

export default function PaymentHistory({ payments = [], onVoid, voidingPaymentId = null, error = '' }) {
  const [voidTarget, setVoidTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const orderedPayments = [...payments].sort((left, right) => (
    right.payment_date.localeCompare(left.payment_date)
    || right.created_at.localeCompare(left.created_at)
  ));

  const confirmVoid = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError('Void reason is required');
      return;
    }
    await onVoid(voidTarget, trimmed);
    setVoidTarget(null);
    setReason('');
    setReasonError('');
  };

  return (
    <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="payment-history-title">
      <h3 id="payment-history-title" className="text-base font-semibold text-slate-900">Payment History</h3>
      {orderedPayments.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No payments recorded.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {orderedPayments.map((payment) => (
            <Card key={payment.id} className={`p-4 ${payment.voided_at ? 'bg-slate-50 opacity-75' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{formatCurrency(payment.amount)} — {methodLabel(payment)}</p>
                  <p className="text-sm text-slate-600">Paid {payment.payment_date}</p>
                  <p className="text-xs text-slate-500">Recorded {new Date(payment.created_at).toLocaleString()} by {payment.created_by}</p>
                  {payment.voided_at && <p className="mt-2 text-sm font-medium text-red-700">Voided: {payment.void_reason}</p>}
                </div>
                {!payment.voided_at && (
                  <Button type="button" size="sm" variant="danger" onClick={() => setVoidTarget(payment)}>Void Payment</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="void-payment-title">
          <Card className="w-full max-w-md p-6 shadow-2xl">
            <h2 id="void-payment-title" className="text-xl font-bold text-slate-900">Void Payment</h2>
            <p className="mt-2 text-sm text-slate-600">The original record remains in payment history and stops counting toward the active total.</p>
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="mt-4">
              <Label htmlFor="void-reason">Void reason</Label>
              <Input id="void-reason" value={reason} onChange={(event) => setReason(event.target.value)} error={reasonError} />
              {reasonError && <p role="alert" className="mt-1 text-xs text-danger">{reasonError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setVoidTarget(null)} disabled={voidingPaymentId === voidTarget.id}>Cancel</Button>
              <Button type="button" variant="danger" onClick={confirmVoid} loading={voidingPaymentId === voidTarget.id}>Confirm Void</Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the focused history tests**

```powershell
npm run test:run -- src/components/__tests__/PaymentHistory.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit the audit-history component**

```powershell
git add src/components/PaymentHistory.jsx src/components/__tests__/PaymentHistory.test.jsx
git commit -m "feat: add registration payment audit history"
```

## Task 5: Integrate recording and voiding into standard and parking administration

**Files:**

- Modify: `src/components/RegistrationViewer.jsx:1-135,260-338,390-513`
- Modify: `src/components/ParkingRegistrationTable.jsx:1-85`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`
- Modify: `src/components/__tests__/ParkingRegistrationTable.test.jsx`

- [ ] **Step 1: Rewrite integration tests around Record Payment**

In `RegistrationViewer.test.jsx`, import `userEvent`, extend the Supabase chain mock so the registration fetch can accept a nested select string, then replace Mark Paid cases with these expectations:

```jsx
it('records a check payment and preserves the registrant-selected method', async () => {
  const user = userEvent.setup();
  const pending = {
    id: 'registration-1', status: 'confirmed', payment_status: 'pending',
    payment_method: 'in_person', payment_expected_amount: 50, payment_recorded_total: 0,
    registration_payments: [], form_data: { name: 'Alex' }, signature_records: [],
  };
  const refreshed = { ...pending, payment_status: 'partial', payment_recorded_total: 25 };
  supabase._mocks.mockOrder.mockResolvedValue({ data: [pending], error: null });
  supabase.rpc.mockResolvedValue({
    data: {
      registration: refreshed,
      payments: [{ id: 'payment-1', method: 'check', amount: 25, payment_date: '2026-08-05', reference_number: '1042', created_at: '2026-08-05T12:00:00Z', created_by: 'admin-1' }],
    },
    error: null,
  });

  render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Record Payment' }));
  await user.selectOptions(screen.getByLabelText('Payment method'), 'check');
  await user.type(screen.getByLabelText('Amount'), '25');
  await user.type(screen.getByLabelText('Check number'), '1042');
  await user.click(screen.getByRole('button', { name: 'Record Payment' }));

  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('record_registration_payment', {
    p_registration_id: 'registration-1',
    p_org_id: 'org-1',
    p_method: 'check',
    p_amount: 25,
    p_payment_date: expect.any(String),
    p_reference_number: '1042',
  }));
  expect(refreshed.payment_method).toBe('in_person');
  expect(await screen.findByText('Partially Paid — $25.00 of $50.00')).toBeInTheDocument();
});

it('keeps Record Payment available after paid because donations are uncapped', async () => {
  supabase._mocks.mockOrder.mockResolvedValue({
    data: [{ id: 'registration-1', status: 'confirmed', payment_status: 'paid', payment_recorded_total: 75, payment_expected_amount: 50, registration_payments: [], form_data: { name: 'Alex' } }],
    error: null,
  });
  render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Record Payment' })).toBeInTheDocument();
});

it('voids a payment and replaces the registration projection from the RPC result', async () => {
  const user = userEvent.setup();
  const payment = {
    id: 'payment-1', method: 'cash', amount: 25, payment_date: '2026-08-05',
    created_at: '2026-08-05T12:00:00Z', created_by: 'admin-1',
  };
  const partial = {
    id: 'registration-1', status: 'confirmed', payment_status: 'partial',
    payment_method: 'in_person', payment_expected_amount: 50, payment_recorded_total: 25,
    registration_payments: [payment], form_data: { name: 'Alex' }, signature_records: [],
  };
  const pending = {
    ...partial,
    payment_status: 'pending',
    payment_recorded_total: 0,
  };
  const voidedPayment = {
    ...payment,
    voided_at: '2026-08-05T13:00:00Z',
    voided_by: 'admin-1',
    void_reason: 'Entered twice',
  };
  supabase._mocks.mockOrder.mockResolvedValue({ data: [partial], error: null });
  supabase.rpc.mockResolvedValue({
    data: { registration: pending, payments: [voidedPayment] },
    error: null,
  });

  render(<RegistrationViewer orgId="org-1" eventId="event-1" event={{ ...event, payment_enabled: true }} onBack={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: /view/i }));
  await user.click(screen.getByRole('button', { name: 'Void Payment' }));
  await user.type(screen.getByLabelText('Void reason'), 'Entered twice');
  await user.click(screen.getByRole('button', { name: 'Confirm Void' }));

  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('void_registration_payment', {
    p_payment_id: 'payment-1',
    p_registration_id: 'registration-1',
    p_org_id: 'org-1',
    p_void_reason: 'Entered twice',
  }));
  expect(await screen.findByText('Pending — $0.00 recorded')).toBeInTheDocument();
  expect(screen.getByText('Voided: Entered twice')).toBeInTheDocument();
});
```

Also update the header assertion for standard registrations to preserve relative order while inserting Payment before Actions:

```js
expect(headers).toEqual(['Name', 'Waiver', 'Media', 'Status', 'Payment', 'Actions']);
```

In `ParkingRegistrationTable.test.jsx`, rename props and assert paid rows still expose Record Payment:

```jsx
const onRecordPayment = vi.fn();
render(
  <ParkingRegistrationTable
    registrations={[registration({ payment_status: 'paid', payment_recorded_total: 65, payment_expected_amount: 50 })]}
    onView={vi.fn()}
    onRecordPayment={onRecordPayment}
    onPrintPass={vi.fn()}
  />,
);
expect(screen.getByText('Paid — $65.00 recorded')).toBeInTheDocument();
await userEvent.click(screen.getByRole('button', { name: 'Record Payment' }));
expect(onRecordPayment).toHaveBeenCalled();
```

- [ ] **Step 2: Run the integration tests and confirm the old flow fails**

```powershell
npm run test:run -- src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx
```

Expected: FAIL because the UI still exposes Mark Paid and calls `mark_registration_paid`.

- [ ] **Step 3: Load payment rows with registrations**

In `RegistrationViewer.jsx`, import the new components and helpers:

```jsx
import RecordPaymentDialog from './RecordPaymentDialog';
import PaymentHistory from './PaymentHistory';
import {
  canRecordRegistrationPayment,
  formatPaymentSummary,
} from '../utils/paymentStatus';
```

Replace `.select('*')` in `fetchRegistrations` with the nested ledger query:

```jsx
.select('*, registration_payments(*)')
```

The RPC result contains the same payment-row shape, so one rendering contract serves initial fetches and mutations. The existing registration Realtime subscription remains sufficient because every payment RPC also updates the registration projection, which triggers a refetch for other open admin sessions.

- [ ] **Step 4: Replace Mark Paid state and handlers with ledger operations**

Add state:

```jsx
const [paymentDialogRegistration, setPaymentDialogRegistration] = useState(null);
const [recordingPayment, setRecordingPayment] = useState(false);
const [voidingPaymentId, setVoidingPaymentId] = useState(null);
const [paymentError, setPaymentError] = useState('');
```

Replace `handleMarkPaid` with:

```jsx
const applyPaymentResult = (result) => {
  const updated = {
    ...result.registration,
    registration_payments: result.payments || [],
  };
  setRegistrations((current) => current.map((item) => item.id === updated.id ? updated : item));
  setSelectedReg((current) => current?.id === updated.id ? updated : current);
  return updated;
};

const handleRecordPayment = async (values) => {
  if (!paymentDialogRegistration || recordingPayment) return;
  setRecordingPayment(true);
  setPaymentError('');
  try {
    const { data, error } = await supabase.rpc('record_registration_payment', {
      p_registration_id: paymentDialogRegistration.id,
      p_org_id: orgId,
      p_method: values.method,
      p_amount: values.amount,
      p_payment_date: values.paymentDate,
      p_reference_number: values.referenceNumber,
    });
    if (error) throw error;
    applyPaymentResult(data);
    setPaymentDialogRegistration(null);
  } catch (error) {
    setPaymentError(error.message || 'Unable to record payment.');
    throw error;
  } finally {
    setRecordingPayment(false);
  }
};

const handleVoidPayment = async (payment, reason) => {
  if (!selectedReg || voidingPaymentId) return;
  setVoidingPaymentId(payment.id);
  setPaymentError('');
  try {
    const { data, error } = await supabase.rpc('void_registration_payment', {
      p_payment_id: payment.id,
      p_registration_id: selectedReg.id,
      p_org_id: orgId,
      p_void_reason: reason,
    });
    if (error) throw error;
    applyPaymentResult(data);
  } catch (error) {
    setPaymentError(error.message || 'Unable to void payment.');
    throw error;
  } finally {
    setVoidingPaymentId(null);
  }
};
```

- [ ] **Step 5: Render one consistent payment summary, history, and entry action**

In the detail action bar, replace Mark Paid with:

```jsx
{canRecordRegistrationPayment(selectedReg) && (
  <Button variant="secondary" size="sm" onClick={() => {
    setPaymentError('');
    setPaymentDialogRegistration(selectedReg);
  }}>
    Record Payment
  </Button>
)}
```

Replace the detail footer's raw payment text with:

```jsx
<div className="mt-4 border-t border-slate-200 pt-4">
  <p className="text-sm font-semibold text-slate-900">{formatPaymentSummary(selectedReg)}</p>
  <p className="mt-1 text-xs text-slate-500">Selected method: {selectedReg.payment_method || 'None'}</p>
  <PaymentHistory
    payments={selectedReg.registration_payments || []}
    onVoid={handleVoidPayment}
    voidingPaymentId={voidingPaymentId}
    error={paymentError}
  />
</div>
```

Add `RecordPaymentDialog` to both existing return branches so it remains visible from the list or detail view:

```jsx
{paymentDialogRegistration && (
  <RecordPaymentDialog
    registration={paymentDialogRegistration}
    onSubmit={handleRecordPayment}
    onClose={() => setPaymentDialogRegistration(null)}
    submitting={recordingPayment}
    error={paymentError}
  />
)}
```

In the standard table, add a Payment header between Status and Actions, add this cell, and replace the old action:

```jsx
<td className="px-4 py-3 text-sm text-slate-700">
  {formatPaymentSummary(reg)}
</td>
{canRecordRegistrationPayment(reg) && (
  <button type="button" onClick={() => setPaymentDialogRegistration(reg)} className="text-primary hover:text-primary-dark text-sm font-medium cursor-pointer">
    Record Payment
  </button>
)}
```

- [ ] **Step 6: Update the parking table using the same contract**

Change `ParkingRegistrationTable` props to:

```jsx
export default function ParkingRegistrationTable({ registrations, onView, onRecordPayment, onPrintPass })
```

Import `canRecordRegistrationPayment` and `formatPaymentSummary`, render the summary in Payment, and use:

```jsx
{canRecordRegistrationPayment(registration) && (
  <button type="button" onClick={() => onRecordPayment(registration)} className="text-primary hover:text-primary-dark font-medium cursor-pointer">
    Record Payment
  </button>
)}
```

Pass `onRecordPayment={setPaymentDialogRegistration}` from `RegistrationViewer`.

- [ ] **Step 7: Run standard and parking integration tests**

```powershell
npm run test:run -- src/components/__tests__/RecordPaymentDialog.test.jsx src/components/__tests__/PaymentHistory.test.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/utils/__tests__/parkingRegistration.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit the admin integration**

```powershell
git add src/components/RegistrationViewer.jsx src/components/ParkingRegistrationTable.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx
git commit -m "feat: reconcile registration payments in admin"
```

## Task 6: Preserve registration CSV order and add the payment-ledger export

**Files:**

- Modify: `src/utils/exportCsv.js`
- Modify: `src/utils/__tests__/exportCsv.test.js`
- Modify: `src/components/RegistrationViewer.jsx:19,396-425`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Write failing CSV tests**

Keep the existing registration header assertion exactly:

```js
expect(headerLine).toBe('"First Name","Email","Allergies","Waiver","Media","Status","Payment","Submitted"');
```

Change registration payment fixtures to projected fields and assert the concise cell:

```js
expect(lines[1]).toContain('"Paid — $65.00 recorded"');
```

Add ledger coverage:

```js
import { buildCsvString, buildPaymentLedgerCsv } from '../exportCsv';

it('exports one ledger row per payment including void audit fields', () => {
  const registrationsWithPayments = [{
    ...registrations[0],
    payment_expected_amount: 50,
    payment_recorded_total: 65,
    registration_payments: [
      { id: 'p1', method: 'cash', amount: 25, payment_date: '2026-08-01', created_at: '2026-08-02T10:00:00Z', created_by: 'admin-1' },
      { id: 'p2', method: 'tithely', amount: 40, payment_date: '2026-08-02', reference_number: 'TX,"42"', created_at: '2026-08-02T11:00:00Z', created_by: 'admin-1', voided_at: '2026-08-03T11:00:00Z', voided_by: 'admin-2', void_reason: 'Wrong registration' },
    ],
  }];

  const csv = buildPaymentLedgerCsv(registrationsWithPayments, fields, { title: 'Beta Event' });
  const lines = csv.split('\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('"Event","First Name","Email","Allergies","Registration ID"');
  expect(lines[1]).toContain('"Cash","25.00"');
  expect(lines[2]).toContain('"Tithe.ly","40.00","2026-08-02","TX,""42"""');
  expect(lines[2]).toContain('"Voided","Wrong registration"');
});
```

- [ ] **Step 2: Run and confirm the new serializer is missing**

```powershell
npm run test:run -- src/utils/__tests__/exportCsv.test.js
```

Expected: FAIL because `buildPaymentLedgerCsv` is not exported and registration rows still use raw status.

- [ ] **Step 3: Implement shared CSV serialization and ledger flattening**

Import `formatPaymentSummary` and change the registration Payment cell:

```js
import { formatPaymentSummary } from './paymentStatus';
```

In `buildCsvString`, replace the existing `reg.payment_status || ''` entry with:

```js
formatPaymentSummary(reg),
```

Refactor the existing download mechanics into:

```js
function downloadCsvText(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

Add the ledger builder and downloader:

```js
export function buildPaymentLedgerCsv(registrations, formFields, event) {
  const fields = formFields.filter((field) => field.type !== 'sectionBreak');
  const headers = [
    'Event', ...fields.map((field) => field.label), 'Registration ID',
    'Registration Payment Status', 'Expected Amount', 'Active Recorded Total',
    'Payment Method', 'Payment Amount', 'Payment Date', 'Reference Number',
    'Recorded At', 'Recorded By', 'Record State', 'Voided At', 'Voided By', 'Void Reason',
  ];

  const rows = registrations.flatMap((registration) => (
    (registration.registration_payments || []).map((payment) => [
      event?.title || '',
      ...fields.map((field) => {
        const value = registration.form_data?.[field.id];
        return Array.isArray(value) ? value.join(', ') : (value ?? '');
      }),
      registration.id,
      registration.payment_status || '',
      registration.payment_expected_amount ?? '',
      Number(registration.payment_recorded_total || 0).toFixed(2),
      payment.method === 'tithely' ? 'Tithe.ly' : payment.method[0].toUpperCase() + payment.method.slice(1),
      Number(payment.amount).toFixed(2),
      payment.payment_date,
      payment.reference_number || '',
      payment.created_at,
      payment.created_by,
      payment.voided_at ? 'Voided' : 'Active',
      payment.voided_at || '',
      payment.voided_by || '',
      payment.void_reason || '',
    ])
  ));

  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}

export function downloadPaymentLedgerCsv(registrations, formFields, event, filename = 'payment-ledger.csv') {
  downloadCsvText(buildPaymentLedgerCsv(registrations, formFields, event), filename);
}
```

Replace the body of the existing `downloadCsv` with:

```js
const csv = buildCsvString(registrations, formFields, waivers);
downloadCsvText(csv, filename);
```

- [ ] **Step 4: Wire a distinct Payments CSV button**

Import `downloadPaymentLedgerCsv` in `RegistrationViewer.jsx` and add next to the existing CSV button:

```jsx
<Button variant="secondary" size="sm" onClick={() => downloadPaymentLedgerCsv(
  filtered,
  formFields,
  event,
  `${event?.title?.replace(/\s+/g, '_') || 'event'}_payments.csv`,
)} title="Export Payment Ledger">
  <Download className="w-4 h-4" /> Payments CSV
</Button>
```

Extend the hoisted export mocks in `RegistrationViewer.test.jsx`:

```js
const { downloadCsvMock, downloadPaymentLedgerCsvMock } = vi.hoisted(() => ({
  downloadCsvMock: vi.fn(),
  downloadPaymentLedgerCsvMock: vi.fn(),
}));

vi.mock('../../utils/exportCsv', () => ({
  downloadCsv: downloadCsvMock,
  downloadPaymentLedgerCsv: downloadPaymentLedgerCsvMock,
}));
```

Add this assertion while keeping the existing registration CSV assertion unchanged:

```jsx
fireEvent.click(screen.getByTitle('Export Payment Ledger'));
expect(downloadPaymentLedgerCsvMock).toHaveBeenCalledWith(
  [expect.objectContaining({ id: 'registration-1' })],
  event.form_fields,
  event,
  'Beta_Event_payments.csv',
);
```

- [ ] **Step 5: Run CSV and viewer tests**

```powershell
npm run test:run -- src/utils/__tests__/exportCsv.test.js src/components/__tests__/RegistrationViewer.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit both export surfaces**

```powershell
git add src/utils/exportCsv.js src/utils/__tests__/exportCsv.test.js src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "feat: export registration payment ledger"
```

## Task 7: Print payment summaries, history, and actual collected totals

**Files:**

- Modify: `src/utils/printReports.js`
- Modify: `src/utils/__tests__/printReports.test.js`

- [ ] **Step 1: Write failing print-report tests**

Add fixtures with projected totals and ledger rows, then assert:

```js
it('prints an escaped payment summary and audit history for one registration', () => {
  printIndividualRegistration({
    payment_status: 'partial',
    payment_expected_amount: 50,
    payment_recorded_total: 25,
    registration_payments: [{
      id: 'p1', method: 'check', amount: 25, payment_date: '2026-08-04',
      reference_number: '10<&42', created_at: '2026-08-05T12:00:00Z', created_by: 'admin-1',
    }],
  }, { title: 'Parking Event', form_fields: [] });

  const html = write.mock.calls[0][0];
  expect(html).toContain('Partially Paid — $25.00 of $50.00');
  expect(html).toContain('Check #10&lt;&amp;42');
  expect(html).toContain('$25.00');
});

it('sums recorded totals instead of multiplying paid registrations by the event amount', () => {
  printEventSummary([
    { status: 'confirmed', payment_status: 'paid', payment_recorded_total: 65 },
    { status: 'confirmed', payment_status: 'partial', payment_recorded_total: 25 },
    { status: 'cancelled', payment_status: 'paid', payment_recorded_total: 10 },
  ], { title: 'Donation Event', payment_enabled: true, payment_amount: 50 });

  const html = write.mock.calls[0][0];
  expect(html).toContain('Payment Collected');
  expect(html).toContain('$100.00');
  expect(html).toContain('Partially Paid');
});
```

Update the registration table assertion to expect the concise escaped summary rather than raw `paid`.

- [ ] **Step 2: Run and confirm print behavior fails**

```powershell
npm run test:run -- src/utils/__tests__/printReports.test.js
```

Expected: FAIL because print reports still display raw status and estimate collection from paid count.

- [ ] **Step 3: Use the shared formatter in concise print surfaces**

Import:

```js
import { formatPaymentSummary } from './paymentStatus';
```

In `printRegistrationTable`, render:

```js
<td>${escapeHtml(formatPaymentSummary(reg))}</td>
```

In `printIndividualRegistration`, replace the raw payment status and add an escaped history table:

```js
const paymentRows = (registration.registration_payments || []).map((payment) => {
  const reference = payment.method === 'check'
    ? `Check #${payment.reference_number}`
    : payment.method === 'tithely'
      ? `Tithe.ly #${payment.reference_number}`
      : 'Cash';
  return `<tr>
    <td>${escapeHtml(payment.payment_date)}</td>
    <td>${escapeHtml(reference)}</td>
    <td>$${Number(payment.amount).toFixed(2)}</td>
    <td>${payment.voided_at ? `Voided: ${escapeHtml(payment.void_reason)}` : 'Active'}</td>
  </tr>`;
}).join('');
```

Insert this after the registration fields when rows exist:

```js
<h2>Payment History</h2>
<table>
  <thead><tr><th>Payment Date</th><th>Method</th><th>Amount</th><th>State</th></tr></thead>
  <tbody>${paymentRows}</tbody>
</table>
```

- [ ] **Step 4: Correct collected-total math and partial count**

In `printEventSummary`, replace `paid * event.payment_amount` with:

```js
const paid = registrations.filter((registration) => registration.payment_status === 'paid').length;
const partialPayments = registrations.filter((registration) => registration.payment_status === 'partial').length;
const paymentTotal = event.payment_enabled
  ? registrations.reduce((sum, registration) => sum + Number(registration.payment_recorded_total || 0), 0)
  : null;
```

Render payment total when it is not null, including `$0.00`, and add a Partially Paid summary box when `partialPayments > 0`.

- [ ] **Step 5: Run print and CSV parity tests**

```powershell
npm run test:run -- src/utils/__tests__/printReports.test.js src/utils/__tests__/exportCsv.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit reporting parity**

```powershell
git add src/utils/printReports.js src/utils/__tests__/printReports.test.js
git commit -m "feat: print registration payment history"
```

## Task 8: Remove obsolete flow references and run the full verification cluster

**Files:**

- Modify only files identified by the searches below if obsolete current-source references remain.

- [ ] **Step 1: Search current source for the retired one-click flow**

Run:

```powershell
rg -n "canMarkRegistrationPaid|handleMarkPaid|Mark Paid|mark_registration_paid|in_person_verified" src README.md
```

Expected: no current-source matches. Historical migrations and approved design/plan documents may retain explanatory matches and must not be rewritten merely to make the search empty.

- [ ] **Step 2: Run all payment-focused tests serially**

```powershell
npm run test:run -- src/security/__tests__/paymentLedgerMigration.test.js src/utils/__tests__/paymentStatus.test.js src/utils/__tests__/parkingRegistration.test.js src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js src/components/__tests__/RecordPaymentDialog.test.jsx src/components/__tests__/PaymentHistory.test.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx
```

Expected: all selected test files PASS.

- [ ] **Step 3: Run the full repository suite serially**

Do not overlap Vitest with lint or build; this repository previously hit worker-start timeouts when those jobs ran concurrently.

```powershell
npm run test:run
```

Expected: all test files and tests PASS.

- [ ] **Step 4: Run static and production checks**

```powershell
npm run lint
npm run build
git diff --check
```

Expected: lint exits 0, Vite production build exits 0, and `git diff --check` produces no output.

- [ ] **Step 5: Apply the migration only to an authorized nonproduction target**

This repository has no local `supabase/config.toml` and no Supabase CLI, so do not claim runtime database verification from source tests. With explicit target authorization and credentials, apply `20260806030000_registration_payment_ledger.sql` to a disposable or staging Supabase project, then verify:

```text
1. Anonymous record/void RPC calls fail.
2. A nonmember and a cross-organization member fail.
3. An owning organization member records cash, check, and Tithe.ly payments.
4. Concurrent reuse of one normalized Tithe.ly transaction accepts only one row.
5. A payment below the snapshot produces partial; reaching/exceeding it produces paid.
6. A positive no-amount donation produces paid with the full total retained.
7. Voiding recalculates status; re-voiding fails; the audit row remains.
8. A legacy-paid registration remains paid without a synthetic ledger row.
9. Direct payment table mutations and projection updates fail.
```

- [ ] **Step 6: Verify the rendered browser workflow against that target**

Using the repository's normal browser-test setup and an authenticated organization member:

```text
1. Record a cash payment with a backdated date.
2. Record a check and confirm the check number appears in history and ledger CSV.
3. Record a Tithe.ly donation and confirm duplicate transaction rejection retains form values.
4. Combine payment methods to move pending -> partial -> paid.
5. Add a donation above the configured amount and confirm no overpaid label appears.
6. Record a positive no-amount donation and confirm paid.
7. Void and replace a record; confirm the old row and reason remain visible.
8. Confirm waitlisted/cancelled rows cannot record payments.
9. Confirm partial parking registrations cannot print passes and paid registrations can.
10. Confirm payment-disabled standard registration behavior is unchanged.
11. Inspect narrow/mobile layouts for both dialogs and payment history.
```

- [ ] **Step 7: Confirm the implementation worktree is clean**

After any verification finding has been repaired through the task that owns the affected file and its focused tests have been rerun, execute:

```powershell
git status --short --branch
```

Expected: the feature branch is shown with no modified, staged, or untracked implementation files. Do not deploy, push, open a PR, or merge without the user's separate authorization for those actions.

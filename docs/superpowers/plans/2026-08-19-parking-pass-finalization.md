# Parking Pass Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff finalize and undo one physical parking-pass handoff at a time, preserve an organization-scoped audit history, prompt after printing, and close the temporary print window automatically.

**Architecture:** Store the current finalization projection on `registrations`, protect it with a guard trigger, and mutate it through separate authenticated finalize/undo RPCs backed by one private locking transition helper that also appends immutable history. Keep eligibility and labels in the existing parking utility, isolate Supabase calls in a service, build focused accessible UI components, and let `RegistrationViewer` coordinate authoritative state updates and the post-print prompt.

**Tech Stack:** React 19, Vite, Tailwind CSS, Supabase/PostgreSQL RPC and RLS, Vitest, Testing Library, lucide-react.

---

## File map

- Create `supabase/migrations/20260819090000_parking_pass_finalization.sql`: current-state columns, metadata constraint, guard trigger, audit table/RLS, private atomic helper, and narrow finalize/undo RPCs.
- Create `src/security/__tests__/parkingPassFinalizationMigration.test.js`: static migration security and state-transition contract.
- Create `src/services/parkingPassFinalization.js`: RPC/error boundary and organization-scoped history query.
- Create `src/services/__tests__/parkingPassFinalization.test.js`: service payload, result, and stable error tests.
- Modify `src/utils/parkingRegistration.js`: Finalized label and finalization/undo eligibility helpers.
- Modify `src/utils/__tests__/parkingRegistration.test.js`: utility state precedence and eligibility tests.
- Modify `src/utils/parkingPass.js`: close the temporary preview after the native print flow returns.
- Modify `src/utils/__tests__/parkingPass.test.js`: print-window lifecycle regressions.
- Create `src/components/ParkingRegistrationActionsMenu.jsx`: accessible row action dropdown.
- Create `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx`: conditional actions and keyboard behavior.
- Create `src/components/ParkingPassFinalizationDialog.jsx`: finalize, post-print, and undo confirmation dialog.
- Create `src/components/__tests__/ParkingPassFinalizationDialog.test.jsx`: copy, focus, confirmation, and dismissal tests.
- Create `src/components/ParkingPassFinalizationHistory.jsx`: lazy organization-scoped audit history.
- Create `src/components/__tests__/ParkingPassFinalizationHistory.test.jsx`: history loading, retry, empty, and rendering tests.
- Modify `src/components/ParkingRegistrationTable.jsx`: Finalized display and dropdown wiring.
- Modify `src/components/__tests__/ParkingRegistrationTable.test.jsx`: action-menu eligibility and callbacks.
- Modify `src/components/RegistrationViewer.jsx`: print follow-up, RPC transitions, authoritative list/detail updates, finalization detail, and history.
- Modify `src/components/__tests__/RegistrationViewer.test.jsx`: integrated manual, print, undo, error, and detail behavior.

### Task 1: Persist and protect parking-pass finalization

**Files:**
- Create: `src/security/__tests__/parkingPassFinalizationMigration.test.js`
- Create: `supabase/migrations/20260819090000_parking_pass_finalization.sql`

- [ ] **Step 1: Write the failing migration contract test**

Create `src/security/__tests__/parkingPassFinalizationMigration.test.js`:

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.resolve(
  process.cwd(),
  'supabase/migrations/20260819090000_parking_pass_finalization.sql',
), 'utf8');

describe('parking pass finalization migration', () => {
  it('adds a consistent current-state projection and guards direct writes', () => {
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_at timestamptz/i);
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_by uuid/i);
    expect(sql).toMatch(/add column if not exists parking_pass_finalized_by_name text/i);
    expect(sql).toMatch(/registrations_parking_pass_finalization_metadata_check/i);
    expect(sql).toMatch(/before insert on public\.registrations[\s\S]*initialize_parking_pass_finalization_projection/i);
    expect(sql).toMatch(/before update of[\s\S]*parking_pass_finalized_at[\s\S]*parking_pass_finalized_by[\s\S]*parking_pass_finalized_by_name/i);
    expect(sql).toMatch(/current_setting\('app\.parking_pass_finalization_write', true\)/i);
  });

  it('creates immutable organization-scoped audit history', () => {
    expect(sql).toMatch(/create table public\.parking_pass_finalization_events/i);
    expect(sql).toMatch(/check \(action in \('finalized', 'reopened'\)\)/i);
    expect(sql).toMatch(/for select[\s\S]+to authenticated[\s\S]+private\.is_org_member/i);
    expect(sql).toMatch(/revoke all on table public\.parking_pass_finalization_events from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on table public\.parking_pass_finalization_events to authenticated/i);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]+parking_pass_finalization_events[^;]+to authenticated/i);
  });

  it('locks and validates an organization parking registration', () => {
    expect(sql).toMatch(/create or replace function private\.transition_parking_pass_finalization/i);
    expect(sql).toMatch(/create or replace function public\.finalize_parking_pass/i);
    expect(sql).toMatch(/create or replace function public\.undo_parking_pass_finalization/i);
    expect(sql).toMatch(/if not private\.is_org_member\(p_org_id\)/i);
    expect(sql).toMatch(/for update of registrations/i);
    expect(sql).toMatch(/v_event_type is distinct from 'parking'/i);
    expect(sql).toMatch(/v_registration\.status <> 'confirmed'/i);
    expect(sql).toMatch(/v_registration\.payment_status <> 'paid'/i);
    expect(sql).toMatch(/v_registration\.parking_pass_finalized_at is distinct from p_expected_finalized_at/i);
  });

  it('updates projection and history in the same function', () => {
    expect(sql).toMatch(/set_config\('app\.parking_pass_finalization_write', 'allowed', true\)/i);
    expect(sql).toMatch(/update public\.registrations as registrations[\s\S]+parking_pass_finalized_at/i);
    expect(sql).toMatch(/insert into public\.parking_pass_finalization_events/i);
    expect(sql).toMatch(/'finalization_conflict'/i);
    expect(sql).toMatch(/'not_eligible'/i);
  });

  it('exposes the transition only to signed-in roles', () => {
    expect(sql).toMatch(/revoke all on function public\.finalize_parking_pass\(uuid, uuid\)\s+from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.undo_parking_pass_finalization\(uuid, uuid, timestamptz\)\s+from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.finalize_parking_pass\(uuid, uuid\)\s+to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.undo_parking_pass_finalization\(uuid, uuid, timestamptz\)\s+to authenticated/i);
  });
});
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run:

```powershell
npx vitest run src/security/__tests__/parkingPassFinalizationMigration.test.js --maxWorkers=1
```

Expected: FAIL because `20260819090000_parking_pass_finalization.sql` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260819090000_parking_pass_finalization.sql`:

```sql
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_by uuid,
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_by_name text;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_parking_pass_finalization_metadata_check
  CHECK (
    (
      parking_pass_finalized_at IS NULL
      AND parking_pass_finalized_by IS NULL
      AND parking_pass_finalized_by_name IS NULL
    )
    OR (
      parking_pass_finalized_at IS NOT NULL
      AND parking_pass_finalized_by_name IS NOT NULL
      AND pg_catalog.btrim(parking_pass_finalized_by_name) <> ''
    )
  );

CREATE TABLE public.parking_pass_finalization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('finalized', 'reopened')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_display_name text NOT NULL CHECK (pg_catalog.btrim(actor_display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT parking_pass_finalization_events_registration_org_fkey
    FOREIGN KEY (registration_id, org_id)
    REFERENCES public.registrations(id, org_id) ON DELETE RESTRICT
);

CREATE INDEX parking_pass_finalization_events_registration_created_idx
  ON public.parking_pass_finalization_events (registration_id, created_at DESC);

CREATE INDEX parking_pass_finalization_events_org_idx
  ON public.parking_pass_finalization_events (org_id);

ALTER TABLE public.parking_pass_finalization_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY parking_pass_finalization_events_org_read
  ON public.parking_pass_finalization_events
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(parking_pass_finalization_events.org_id)));

REVOKE ALL ON TABLE public.parking_pass_finalization_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.parking_pass_finalization_events TO authenticated;
GRANT ALL ON TABLE public.parking_pass_finalization_events TO service_role;

CREATE OR REPLACE FUNCTION private.initialize_parking_pass_finalization_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.parking_pass_finalized_at := NULL;
  NEW.parking_pass_finalized_by := NULL;
  NEW.parking_pass_finalized_by_name := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initialize_parking_pass_finalization_projection
BEFORE INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.initialize_parking_pass_finalization_projection();

CREATE OR REPLACE FUNCTION private.guard_parking_pass_finalization_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF pg_catalog.current_setting('app.parking_pass_finalization_write', true)
      IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Parking pass finalization is managed by its transition function';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_parking_pass_finalization_projection
BEFORE UPDATE OF
  parking_pass_finalized_at,
  parking_pass_finalized_by,
  parking_pass_finalized_by_name
ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.guard_parking_pass_finalization_projection();

CREATE OR REPLACE FUNCTION private.transition_parking_pass_finalization(
  p_registration_id uuid,
  p_org_id uuid,
  p_finalized boolean,
  p_expected_finalized_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_audit public.parking_pass_finalization_events%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_name text;
  v_event_type text;
  v_action text;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  IF NOT private.is_org_member(p_org_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF p_finalized IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;

  SELECT registrations.*
  INTO v_registration
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT events.event_type
  INTO v_event_type
  FROM public.events AS events
  WHERE events.id = v_registration.event_id
    AND events.org_id = p_org_id;

  IF NOT FOUND OR v_event_type IS DISTINCT FROM 'parking' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_parking');
  END IF;

  SELECT NULLIF(pg_catalog.btrim(profiles.display_name), '')
  INTO v_actor_name
  FROM public.profiles AS profiles
  WHERE profiles.id = v_actor_id;
  v_actor_name := COALESCE(v_actor_name, v_actor_id::text);

  IF p_finalized THEN
    IF v_registration.parking_pass_finalized_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'finalization_conflict');
    END IF;
    IF v_registration.status <> 'confirmed'
       OR v_registration.payment_status <> 'paid' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_eligible');
    END IF;
    v_action := 'finalized';
  ELSE
    IF v_registration.parking_pass_finalized_at IS NULL
       OR v_registration.parking_pass_finalized_at IS DISTINCT FROM p_expected_finalized_at THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'finalization_conflict');
    END IF;
    v_action := 'reopened';
  END IF;

  PERFORM pg_catalog.set_config('app.parking_pass_finalization_write', 'allowed', true);
  UPDATE public.registrations AS registrations
  SET parking_pass_finalized_at = CASE WHEN p_finalized THEN pg_catalog.now() ELSE NULL END,
      parking_pass_finalized_by = CASE WHEN p_finalized THEN v_actor_id ELSE NULL END,
      parking_pass_finalized_by_name = CASE WHEN p_finalized THEN v_actor_name ELSE NULL END
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  RETURNING registrations.* INTO v_registration;
  PERFORM pg_catalog.set_config('app.parking_pass_finalization_write', '', true);

  INSERT INTO public.parking_pass_finalization_events (
    registration_id,
    org_id,
    action,
    actor_user_id,
    actor_display_name
  ) VALUES (
    p_registration_id,
    p_org_id,
    v_action,
    v_actor_id,
    v_actor_name
  )
  RETURNING * INTO v_audit;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'registration', pg_catalog.to_jsonb(v_registration),
    'event', pg_catalog.to_jsonb(v_audit)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_parking_pass(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.transition_parking_pass_finalization(
    p_registration_id,
    p_org_id,
    true,
    NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.undo_parking_pass_finalization(
  p_registration_id uuid,
  p_org_id uuid,
  p_expected_finalized_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.transition_parking_pass_finalization(
    p_registration_id,
    p_org_id,
    false,
    p_expected_finalized_at
  );
$$;

REVOKE ALL ON FUNCTION private.guard_parking_pass_finalization_projection()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.initialize_parking_pass_finalization_projection()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.transition_parking_pass_finalization(uuid, uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_parking_pass(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_parking_pass_finalization(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_parking_pass(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_parking_pass_finalization(uuid, uuid, timestamptz) TO authenticated, service_role;
```

- [ ] **Step 4: Run focused migration checks**

Run:

```powershell
npx vitest run src/security/__tests__/parkingPassFinalizationMigration.test.js --maxWorkers=1
npm run check:migrations
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the database contract**

```powershell
git add -- src/security/__tests__/parkingPassFinalizationMigration.test.js supabase/migrations/20260819090000_parking_pass_finalization.sql
git commit -m "feat: persist parking pass finalization"
```

### Task 2: Add parking state and Supabase service boundaries

**Files:**
- Modify: `src/utils/parkingRegistration.js:3-49`
- Modify: `src/utils/__tests__/parkingRegistration.test.js:1-53`
- Create: `src/services/parkingPassFinalization.js`
- Create: `src/services/__tests__/parkingPassFinalization.test.js`

- [ ] **Step 1: Write failing utility tests**

Update the imports and add these cases to `src/utils/__tests__/parkingRegistration.test.js`:

```js
import {
    PARKING_PASS_STATUS,
    canFinalizeParkingPass,
    canPrintParkingPass,
    canUndoParkingPassFinalization,
    getParkingFieldValue,
    getParkingPassStatus,
    getParkingVehicleLabel,
} from '../parkingRegistration';

it('shows Finalized independently of later registration status', () => {
    const finalized = {
        parking_pass_finalized_at: '2026-08-19T14:30:00Z',
        parking_pass_finalized_by_name: 'Admin User',
    };
    expect(getParkingPassStatus(registration(finalized))).toBe(PARKING_PASS_STATUS.FINALIZED);
    expect(getParkingPassStatus(registration({ ...finalized, status: 'cancelled' })))
        .toBe(PARKING_PASS_STATUS.FINALIZED);
});

it('allows finalization and printing only for unfinalized valid passes', () => {
    const valid = registration();
    const finalized = registration({ parking_pass_finalized_at: '2026-08-19T14:30:00Z' });
    expect(canFinalizeParkingPass(valid)).toBe(true);
    expect(canPrintParkingPass(valid)).toBe(true);
    expect(canUndoParkingPassFinalization(valid)).toBe(false);
    expect(canFinalizeParkingPass(finalized)).toBe(false);
    expect(canPrintParkingPass(finalized)).toBe(false);
    expect(canUndoParkingPassFinalization(finalized)).toBe(true);
});
```

- [ ] **Step 2: Write the failing service test**

Create `src/services/__tests__/parkingPassFinalization.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), select: vi.fn(), registrationEq: vi.fn(),
  orgEq: vi.fn(), order: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  listParkingPassFinalizationEvents,
  setParkingPassFinalization,
} from '../parkingPassFinalization';

describe('parking pass finalization service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.registrationEq });
    mocks.registrationEq.mockReturnValue({ eq: mocks.orgEq });
    mocks.orgEq.mockReturnValue({ order: mocks.order });
  });

  it('sends the exact finalization RPC arguments', async () => {
    const result = { ok: true, registration: { id: 'registration-1' }, event: { id: 'audit-1' } };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await expect(setParkingPassFinalization({
      registrationId: 'registration-1', orgId: 'org-1', finalized: true,
    })).resolves.toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_parking_pass', {
      p_registration_id: 'registration-1', p_org_id: 'org-1',
    });
  });

  it('sends the observed timestamp when undoing', async () => {
    const result = { ok: true, registration: { id: 'registration-1' }, event: { id: 'audit-2' } };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await setParkingPassFinalization({ registrationId: 'registration-1', orgId: 'org-1',
      finalized: false, expectedFinalizedAt: '2026-08-19T14:30:00Z' });
    expect(mocks.rpc).toHaveBeenCalledWith('undo_parking_pass_finalization', {
      p_registration_id: 'registration-1', p_org_id: 'org-1',
      p_expected_finalized_at: '2026-08-19T14:30:00Z',
    });
  });

  it.each(['not_eligible', 'finalization_conflict', 'forbidden'])
  ('preserves the stable %s response code', async (code) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    await expect(setParkingPassFinalization({
      registrationId: 'registration-1', orgId: 'org-1', finalized: true,
    })).rejects.toMatchObject({ code });
  });

  it('maps transport failures without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('private detail') });
    await expect(setParkingPassFinalization({})).rejects.toMatchObject({ code: 'transition_failed' });
  });

  it('lists newest organization-scoped events', async () => {
    const entries = [{ id: 'audit-1' }];
    mocks.order.mockResolvedValue({ data: entries, error: null });
    await expect(listParkingPassFinalizationEvents('registration-1', 'org-1'))
      .resolves.toEqual(entries);
    expect(mocks.from).toHaveBeenCalledWith('parking_pass_finalization_events');
    expect(mocks.select).toHaveBeenCalledWith('*');
    expect(mocks.registrationEq).toHaveBeenCalledWith('registration_id', 'registration-1');
    expect(mocks.orgEq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
```

- [ ] **Step 3: Run the focused tests to verify they fail**

Run:

```powershell
npx vitest run src/utils/__tests__/parkingRegistration.test.js src/services/__tests__/parkingPassFinalization.test.js --maxWorkers=1
```

Expected: FAIL because the helpers and service do not exist.

- [ ] **Step 4: Implement the utility rules**

In `src/utils/parkingRegistration.js`, add Finalized and the two explicit eligibility helpers:

```js
export const PARKING_PASS_STATUS = Object.freeze({
    FINALIZED: 'Finalized',
    VALID: 'Valid',
    PAYMENT_PENDING: 'Payment pending',
    WAITLISTED: 'Waitlisted',
    INVALID: 'Invalid',
});

export function getParkingPassStatus(registration) {
    if (registration?.parking_pass_finalized_at) return PARKING_PASS_STATUS.FINALIZED;
    if (registration?.status === 'waitlisted') return PARKING_PASS_STATUS.WAITLISTED;
    if (registration?.status !== 'confirmed') return PARKING_PASS_STATUS.INVALID;
    if (registration?.payment_status === 'paid') return PARKING_PASS_STATUS.VALID;
    if (registration?.payment_status === 'pending' || registration?.payment_status === 'partial') {
        return PARKING_PASS_STATUS.PAYMENT_PENDING;
    }
    return PARKING_PASS_STATUS.INVALID;
}

export function canFinalizeParkingPass(registration) {
    return getParkingPassStatus(registration) === PARKING_PASS_STATUS.VALID;
}

export function canUndoParkingPassFinalization(registration) {
    return Boolean(registration?.parking_pass_finalized_at);
}

export function canPrintParkingPass(registration) {
    return canFinalizeParkingPass(registration);
}
```

Keep `getParkingFieldValue` and `getParkingVehicleLabel` unchanged.

- [ ] **Step 5: Implement the service**

Create `src/services/parkingPassFinalization.js`:

```js
import { supabase } from './supabase';

const codedError = (code) => Object.assign(new Error(code), { code });

export async function setParkingPassFinalization({
  registrationId, orgId, finalized, expectedFinalizedAt = null,
}) {
  const functionName = finalized
    ? 'finalize_parking_pass'
    : 'undo_parking_pass_finalization';
  const args = finalized
    ? { p_registration_id: registrationId, p_org_id: orgId }
    : {
        p_registration_id: registrationId,
        p_org_id: orgId,
        p_expected_finalized_at: expectedFinalizedAt,
      };
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) throw codedError('transition_failed');
  if (!data?.ok) throw codedError(data?.code || 'transition_failed');
  return data;
}

export async function listParkingPassFinalizationEvents(registrationId, orgId) {
  const { data, error } = await supabase.from('parking_pass_finalization_events')
    .select('*')
    .eq('registration_id', registrationId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw codedError('history_failed');
  return data || [];
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npx vitest run src/utils/__tests__/parkingRegistration.test.js src/services/__tests__/parkingPassFinalization.test.js --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/utils/parkingRegistration.js src/utils/__tests__/parkingRegistration.test.js src/services/parkingPassFinalization.js src/services/__tests__/parkingPassFinalization.test.js
git commit -m "feat: add parking finalization state boundary"
```

### Task 3: Close the parking-pass preview after printing

**Files:**
- Modify: `src/utils/parkingPass.js:143-155`
- Modify: `src/utils/__tests__/parkingPass.test.js:24-26,131-252`

- [ ] **Step 1: Extend the print-window test double and write failing lifecycle tests**

Change `makePrintWindow` and add two tests in `src/utils/__tests__/parkingPass.test.js`:

```js
function makePrintWindow({ fontsReady = Promise.resolve(), images = [] } = {}) {
    return {
        document: { write: vi.fn(), close: vi.fn(), fonts: { ready: fontsReady }, images },
        focus: vi.fn(),
        print: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
    };
}

it('closes the temporary preview after the native print call returns', async () => {
    const printWindow = makePrintWindow();
    vi.spyOn(window, 'open').mockReturnValue(printWindow);
    await printParkingPass(registration(), event, 'Kent Methodist Church');
    expect(printWindow.print).toHaveBeenCalledOnce();
    expect(printWindow.close).toHaveBeenCalledOnce();
    expect(printWindow.print.mock.invocationCallOrder[0])
        .toBeLessThan(printWindow.close.mock.invocationCallOrder[0]);
    expect(printWindow.addEventListener).toHaveBeenCalledWith(
        'afterprint', expect.any(Function), { once: true },
    );
});

it('does not close the preview while print assets are pending', async () => {
    let resolveFonts;
    const printWindow = makePrintWindow({
        fontsReady: new Promise((resolve) => { resolveFonts = resolve; }),
    });
    vi.spyOn(window, 'open').mockReturnValue(printWindow);
    const result = printParkingPass(registration(), event, 'Kent Methodist Church');
    expect(printWindow.close).not.toHaveBeenCalled();
    resolveFonts();
    await result;
    expect(printWindow.close).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the print tests to verify they fail**

Run:

```powershell
npx vitest run src/utils/__tests__/parkingPass.test.js --maxWorkers=1
```

Expected: FAIL because `printWindow.close()` is never called.

- [ ] **Step 3: Close in a `finally` block after invoking print**

Replace the final promise body in `printParkingPass`:

```js
    return waitForPrintAssets(printWindow).then(() => {
        printWindow.focus();
        let closed = false;
        const closePreview = () => {
            if (closed) return;
            closed = true;
            printWindow.close();
        };
        printWindow.addEventListener?.('afterprint', closePreview, { once: true });
        try {
            printWindow.print();
        } finally {
            closePreview();
        }
    });
```

This preserves popup and asset errors, closes after print or cancel when the native call returns, and also closes if the browser throws from `print()`.

- [ ] **Step 4: Run print tests and commit**

Run:

```powershell
npx vitest run src/utils/__tests__/parkingPass.test.js --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/utils/parkingPass.js src/utils/__tests__/parkingPass.test.js
git commit -m "fix: close parking pass print preview"
```

### Task 4: Build the accessible parking actions dropdown

**Files:**
- Create: `src/components/ParkingRegistrationActionsMenu.jsx`
- Create: `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx`

- [ ] **Step 1: Write failing menu behavior tests**

Create `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParkingRegistrationActionsMenu from '../ParkingRegistrationActionsMenu';

const actions = () => ({
    onView: vi.fn(), onRecordPayment: vi.fn(), onPrintPass: vi.fn(),
    onFinalize: vi.fn(), onUndoFinalization: vi.fn(),
});

describe('ParkingRegistrationActionsMenu', () => {
    it('renders only enabled actions and invokes the selected action', async () => {
        const user = userEvent.setup();
        const handlers = actions();
        render(<ParkingRegistrationActionsMenu {...handlers} canRecordPayment canPrint canFinalize canUndo={false} />);
        await user.click(screen.getByRole('button', { name: 'Actions' }));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'View', 'Record Payment', 'Print Pass', 'Finalize',
        ]);
        await user.click(screen.getByRole('menuitem', { name: 'Finalize' }));
        expect(handlers.onFinalize).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('supports arrow navigation and Escape focus restoration', async () => {
        const user = userEvent.setup();
        render(<ParkingRegistrationActionsMenu {...actions()} canRecordPayment={false} canPrint={false} canFinalize={false} canUndo />);
        const trigger = screen.getByRole('button', { name: 'Actions' });
        await user.click(trigger);
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: 'Undo Finalization' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes on an outside pointer action', async () => {
        const user = userEvent.setup();
        render(<div><ParkingRegistrationActionsMenu {...actions()} canRecordPayment={false} canPrint={false} canFinalize={false} canUndo={false} /><button>Outside</button></div>);
        await user.click(screen.getByRole('button', { name: 'Actions' }));
        await user.click(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the menu test to verify it fails**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx --maxWorkers=1
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused menu component**

Create `src/components/ParkingRegistrationActionsMenu.jsx`:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function ParkingRegistrationActionsMenu({
    onView, onRecordPayment, onPrintPass, onFinalize, onUndoFinalization,
    canRecordPayment, canPrint, canFinalize, canUndo, disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const itemRefs = useRef([]);
    const items = [
        { label: 'View', enabled: true, run: onView },
        { label: 'Record Payment', enabled: canRecordPayment, run: onRecordPayment },
        { label: 'Print Pass', enabled: canPrint, run: onPrintPass },
        { label: 'Finalize', enabled: canFinalize, run: onFinalize },
        { label: 'Undo Finalization', enabled: canUndo, run: onUndoFinalization },
    ].filter((item) => item.enabled);

    useEffect(() => {
        if (!open) return undefined;
        itemRefs.current[0]?.focus();
        const closeOutside = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);

    const focusItem = (index) => itemRefs.current[index]?.focus();
    const toggleMenu = () => {
        if (!open) {
            const rect = triggerRef.current.getBoundingClientRect();
            setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 176) });
        }
        setOpen((value) => !value);
    };
    const handleMenuKeyDown = (event) => {
        const current = itemRefs.current.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault(); setOpen(false); triggerRef.current?.focus();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault(); focusItem((current + 1 + items.length) % items.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault(); focusItem((current - 1 + items.length) % items.length);
        } else if (event.key === 'Home') {
            event.preventDefault(); focusItem(0);
        } else if (event.key === 'End') {
            event.preventDefault(); focusItem(items.length - 1);
        }
    };

    return (
        <div ref={rootRef} className="relative inline-block">
            <button ref={triggerRef} type="button" disabled={disabled}
                aria-haspopup="menu" aria-expanded={open}
                onClick={toggleMenu}
                className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-dark disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                Actions <ChevronDown className="h-4 w-4" />
            </button>
            {open && (
                <div role="menu" aria-label="Registration actions" onKeyDown={handleMenuKeyDown}
                    style={position}
                    className="fixed z-50 min-w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {items.map((item, index) => (
                        <button key={item.label} ref={(node) => { itemRefs.current[index] = node; }}
                            type="button" role="menuitem" tabIndex={index === 0 ? 0 : -1}
                            onClick={() => { setOpen(false); item.run(); }}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run the menu test and commit**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/components/ParkingRegistrationActionsMenu.jsx src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx
git commit -m "feat: add parking registration action menu"
```

### Task 5: Build confirmation and audit-history UI units

**Files:**
- Create: `src/components/ParkingPassFinalizationDialog.jsx`
- Create: `src/components/__tests__/ParkingPassFinalizationDialog.test.jsx`
- Create: `src/components/ParkingPassFinalizationHistory.jsx`
- Create: `src/components/__tests__/ParkingPassFinalizationHistory.test.jsx`

- [ ] **Step 1: Write failing confirmation-dialog tests**

Create `src/components/__tests__/ParkingPassFinalizationDialog.test.jsx`:

```jsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParkingPassFinalizationDialog from '../ParkingPassFinalizationDialog';

const registration = { form_data: { system_first_name: 'Alex', system_last_name: 'Morgan', parking_license_plate: 'ABC123' } };

describe('ParkingPassFinalizationDialog', () => {
    it('uses the physical-handoff question after printing', async () => {
        const user = userEvent.setup(); const onConfirm = vi.fn();
        render(<ParkingPassFinalizationDialog registration={registration} mode="post-print" onConfirm={onConfirm} onClose={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'Finalize printed parking pass?' })).toBeInTheDocument();
        expect(screen.getByText('Was this parking pass handed to the registrant?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Finalize' }));
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('confirms undo and disables dismissal while saving', async () => {
        const user = userEvent.setup(); const onClose = vi.fn();
        render(<ParkingPassFinalizationDialog registration={registration} mode="undo" saving onConfirm={vi.fn()} onClose={onClose} />);
        expect(screen.getByText(/reopen this pass for printing and finalization/i)).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Undo Finalization' })).toBeDisabled();
    });

    it('shows a stable error and restores focus after closing', async () => {
        const user = userEvent.setup(); const onClose = vi.fn();
        render(<div><button autoFocus>Origin</button><ParkingPassFinalizationDialog registration={registration} mode="finalize" error="This pass is no longer eligible." onConfirm={vi.fn()} onClose={onClose} /></div>);
        expect(screen.getByRole('alert')).toHaveTextContent('This pass is no longer eligible.');
        await user.click(screen.getByRole('button', { name: 'Not yet' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Write failing history tests**

Create `src/components/__tests__/ParkingPassFinalizationHistory.test.jsx`:

```jsx
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listEvents = vi.hoisted(() => vi.fn());
vi.mock('../../services/parkingPassFinalization', () => ({ listParkingPassFinalizationEvents: listEvents }));
import ParkingPassFinalizationHistory from '../ParkingPassFinalizationHistory';

describe('ParkingPassFinalizationHistory', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads and renders newest actions when expanded', async () => {
        const user = userEvent.setup();
        listEvents.mockResolvedValue([{ id: 'audit-1', action: 'finalized', actor_display_name: 'Admin User', created_at: '2026-08-19T14:30:00Z' }]);
        render(<ParkingPassFinalizationHistory registrationId="registration-1" orgId="org-1" refreshKey={0} />);
        await user.click(screen.getByRole('button', { name: 'Pass History' }));
        expect(await screen.findByText('Pass finalized')).toBeInTheDocument();
        expect(screen.getByText('Admin User')).toBeInTheDocument();
        expect(listEvents).toHaveBeenCalledWith('registration-1', 'org-1');
    });

    it('shows empty history and a retry after failure', async () => {
        const user = userEvent.setup();
        listEvents.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce([]);
        render(<ParkingPassFinalizationHistory registrationId="registration-1" orgId="org-1" refreshKey={0} />);
        await user.click(screen.getByRole('button', { name: 'Pass History' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load pass history.');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('No pass finalization actions recorded.')).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingPassFinalizationDialog.test.jsx src/components/__tests__/ParkingPassFinalizationHistory.test.jsx --maxWorkers=1
```

Expected: FAIL because both components do not exist.

- [ ] **Step 4: Implement the confirmation dialog**

Create `src/components/ParkingPassFinalizationDialog.jsx`, following the focus-trap pattern in `RecordPaymentDialog.jsx`:

```jsx
import React, { useEffect, useRef } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';

const content = {
    'post-print': { title: 'Finalize printed parking pass?', message: 'Was this parking pass handed to the registrant?', confirm: 'Finalize', close: 'Not yet' },
    finalize: { title: 'Finalize parking pass?', message: 'Confirm that this physical parking pass was handed to the registrant.', confirm: 'Finalize', close: 'Not yet' },
    undo: { title: 'Undo parking pass finalization?', message: 'This will reopen this pass for printing and finalization. The earlier action will remain in Pass History.', confirm: 'Undo Finalization', close: 'Keep Finalized' },
};

const focusable = (container) => Array.from(container.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));

export default function ParkingPassFinalizationDialog({ registration, mode, onConfirm, onClose, saving = false, error = '' }) {
    const titleRef = useRef(null);
    const copy = content[mode];
    const formData = registration?.form_data || {};
    const identity = [formData.system_first_name, formData.system_last_name].filter(Boolean).join(' ');
    const plate = formData.parking_license_plate;

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        titleRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') { if (!saving) onClose(); return; }
        if (event.key !== 'Tab') return;
        const elements = focusable(event.currentTarget); const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <Card role="dialog" aria-modal="true" aria-labelledby="parking-finalization-title" onKeyDown={handleKeyDown} className="w-full max-w-md p-6">
                <h2 ref={titleRef} id="parking-finalization-title" tabIndex="-1" className="text-xl font-bold text-slate-900">{copy.title}</h2>
                <p className="mt-3 text-sm text-slate-700">{copy.message}</p>
                {(identity || plate) && <p className="mt-2 text-sm font-semibold text-slate-900">{[identity, plate].filter(Boolean).join(' — ')}</p>}
                {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
                <div className="mt-6 flex justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>{copy.close}</Button>
                    <Button type="button" variant={mode === 'undo' ? 'danger' : 'primary'} onClick={onConfirm} loading={saving} disabled={saving}>{copy.confirm}</Button>
                </div>
            </Card>
        </div>
    );
}
```

- [ ] **Step 5: Implement lazy audit history**

Create `src/components/ParkingPassFinalizationHistory.jsx` by adapting the focused loading pattern from `RegistrationEditHistory.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { listParkingPassFinalizationEvents } from '../services/parkingPassFinalization';
import Button from './ui/Button';
import Card from './ui/Card';

export default function ParkingPassFinalizationHistory({ registrationId, orgId, refreshKey }) {
    const [expanded, setExpanded] = useState(false); const [loading, setLoading] = useState(false);
    const [error, setError] = useState(''); const [entries, setEntries] = useState([]);
    const priorRefreshKey = useRef(refreshKey);
    const load = useCallback(async () => {
        setLoading(true); setError('');
        try { setEntries(await listParkingPassFinalizationEvents(registrationId, orgId)); }
        catch { setError('Unable to load pass history.'); }
        finally { setLoading(false); }
    }, [registrationId, orgId]);

    useEffect(() => {
        if (priorRefreshKey.current === refreshKey) return;
        priorRefreshKey.current = refreshKey;
        if (expanded) void load();
    }, [expanded, load, refreshKey]);

    const toggle = () => { if (expanded) setExpanded(false); else { setExpanded(true); void load(); } };
    return (
        <Card className="overflow-hidden">
            <button type="button" aria-expanded={expanded} onClick={toggle} className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Pass History
            </button>
            {expanded && <div className="border-t border-slate-200 px-5 py-4">
                {loading ? <p role="status" className="text-sm text-slate-500">Loading pass history…</p>
                    : error ? <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><Button size="sm" variant="secondary" onClick={load}>Retry</Button></div>
                    : entries.length === 0 ? <p className="text-sm text-slate-500">No pass finalization actions recorded.</p>
                    : <ol className="space-y-4">{entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0"><div><p className="text-sm font-semibold text-slate-800">{entry.action === 'finalized' ? 'Pass finalized' : 'Finalization undone'}</p><p className="text-sm text-slate-600">{entry.actor_display_name}</p></div><time className="text-xs text-slate-500" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time></li>)}</ol>}
            </div>}
        </Card>
    );
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingPassFinalizationDialog.test.jsx src/components/__tests__/ParkingPassFinalizationHistory.test.jsx --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/components/ParkingPassFinalizationDialog.jsx src/components/ParkingPassFinalizationHistory.jsx src/components/__tests__/ParkingPassFinalizationDialog.test.jsx src/components/__tests__/ParkingPassFinalizationHistory.test.jsx
git commit -m "feat: add parking finalization dialogs and history"
```

### Task 6: Replace crowded parking row links with the dropdown

**Files:**
- Modify: `src/components/ParkingRegistrationTable.jsx:1-97`
- Modify: `src/components/__tests__/ParkingRegistrationTable.test.jsx:1-94`

- [ ] **Step 1: Rewrite the table tests around the action menu**

Update the render calls with `onFinalize`, `onUndoFinalization`, and `busyRegistrationId`, then replace direct-link expectations with:

```jsx
it('shows valid unfinalized actions in one dropdown', async () => {
    const user = userEvent.setup(); const paidRegistration = registration();
    const onPrintPass = vi.fn(); const onFinalize = vi.fn();
    render(<ParkingRegistrationTable registrations={[paidRegistration]} onView={vi.fn()}
        onRecordPayment={vi.fn()} onPrintPass={onPrintPass} onFinalize={onFinalize}
        onUndoFinalization={vi.fn()} busyRegistrationId={null} />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menuitem', { name: 'Print Pass' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Finalize' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Undo Finalization' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Print Pass' }));
    expect(onPrintPass).toHaveBeenCalledWith(paidRegistration);
});

it('shows Finalized and only the undo fulfillment action', async () => {
    const user = userEvent.setup(); const onUndoFinalization = vi.fn();
    const finalized = registration({ parking_pass_finalized_at: '2026-08-19T14:30:00Z' });
    render(<ParkingRegistrationTable registrations={[finalized]} onView={vi.fn()}
        onRecordPayment={vi.fn()} onPrintPass={vi.fn()} onFinalize={vi.fn()}
        onUndoFinalization={onUndoFinalization} busyRegistrationId={null} />);
    expect(screen.getByText('Finalized')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Print Pass' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Finalize' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Undo Finalization' }));
    expect(onUndoFinalization).toHaveBeenCalledWith(finalized);
});
```

- [ ] **Step 2: Run the table test to verify it fails**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingRegistrationTable.test.jsx --maxWorkers=1
```

Expected: FAIL because the table still renders separate links and has no finalization callbacks.

- [ ] **Step 3: Wire eligibility into the table**

In `ParkingRegistrationTable.jsx`, import the menu plus `canFinalizeParkingPass` and `canUndoParkingPassFinalization`. Change the signature and replace the action-link `<div>` with:

```jsx
export default function ParkingRegistrationTable({
    registrations, onView, onRecordPayment, onPrintPass,
    onFinalize, onUndoFinalization, busyRegistrationId,
}) {
```

```jsx
<ParkingRegistrationActionsMenu
    onView={() => onView(registration)}
    onRecordPayment={() => onRecordPayment(registration)}
    onPrintPass={() => onPrintPass(registration)}
    onFinalize={() => onFinalize(registration)}
    onUndoFinalization={() => onUndoFinalization(registration)}
    canRecordPayment={eligibleToRecordPayment}
    canPrint={canPrintParkingPass(registration)}
    canFinalize={canFinalizeParkingPass(registration)}
    canUndo={canUndoParkingPassFinalization(registration)}
    disabled={busyRegistrationId === registration.id}
/>
```

Delete the former View, Record Payment, and Print Pass link buttons. Keep all table columns and cell data unchanged.

- [ ] **Step 4: Run focused component tests and commit**

Run:

```powershell
npx vitest run src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/components/ParkingRegistrationTable.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx
git commit -m "feat: consolidate parking registration actions"
```

### Task 7: Integrate finalization and the post-print prompt

**Files:**
- Modify: `src/components/RegistrationViewer.jsx:1-772`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Add mocks and failing integrated tests**

Extend the existing hoisted mocks and add the module mocks in `RegistrationViewer.test.jsx`:

```jsx
const {
    downloadCsvMock,
    downloadPaymentLedgerCsvMock,
    updateRegistrationAnswersMock,
    printParkingPassMock,
    setParkingPassFinalizationMock,
} = vi.hoisted(() => ({
    downloadCsvMock: vi.fn(),
    downloadPaymentLedgerCsvMock: vi.fn(),
    updateRegistrationAnswersMock: vi.fn(),
    printParkingPassMock: vi.fn(),
    setParkingPassFinalizationMock: vi.fn(),
}));

vi.mock('../../utils/parkingPass', () => ({ printParkingPass: printParkingPassMock }));
vi.mock('../../services/parkingPassFinalization', () => ({
    setParkingPassFinalization: setParkingPassFinalizationMock,
}));
vi.mock('../ParkingPassFinalizationHistory', () => ({
    default: ({ refreshKey }) => (
        <div data-testid="parking-pass-history">pass-history-{refreshKey}</div>
    ),
}));
```

Reset both new mocks in `beforeEach`:

```jsx
printParkingPassMock.mockReset();
setParkingPassFinalizationMock.mockReset();
```

Then add these tests:

```jsx
it('prompts after printing and finalizes from the authoritative RPC response', async () => {
    const user = userEvent.setup();
    const valid = { ...parkingRegistration, payment_status: 'paid' };
    const finalized = { ...valid, parking_pass_finalized_at: '2026-08-19T14:30:00Z', parking_pass_finalized_by: 'user-1', parking_pass_finalized_by_name: 'Admin User' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [valid], error: null });
    printParkingPassMock.mockResolvedValue();
    setParkingPassFinalizationMock.mockResolvedValue({ registration: finalized, event: { id: 'audit-1' } });
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} organizationName="Kent Methodist Church" onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Print Pass' }));
    expect(await screen.findByRole('dialog', { name: 'Finalize printed parking pass?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finalize' }));
    expect(setParkingPassFinalizationMock).toHaveBeenCalledWith({ registrationId: valid.id, orgId: 'org-1', finalized: true });
    expect(await screen.findByText('Finalized')).toBeInTheDocument();
});

it('supports manual finalization without printing', async () => {
    const user = userEvent.setup(); const valid = { ...parkingRegistration, payment_status: 'paid' };
    const finalized = { ...valid, parking_pass_finalized_at: '2026-08-19T14:30:00Z', parking_pass_finalized_by_name: 'Admin User' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [valid], error: null });
    setParkingPassFinalizationMock.mockResolvedValue({ registration: finalized, event: { id: 'audit-1' } });
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Finalize' }));
    expect(screen.getByRole('dialog', { name: 'Finalize parking pass?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finalize' }));
    expect(printParkingPassMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Finalized')).toBeInTheDocument();
});

it('confirms undo and restores valid actions', async () => {
    const user = userEvent.setup();
    const finalized = { ...parkingRegistration, payment_status: 'paid', parking_pass_finalized_at: '2026-08-19T14:30:00Z', parking_pass_finalized_by_name: 'Admin User' };
    const reopened = { ...finalized, parking_pass_finalized_at: null, parking_pass_finalized_by: null, parking_pass_finalized_by_name: null };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [finalized], error: null });
    setParkingPassFinalizationMock.mockResolvedValue({ registration: reopened, event: { id: 'audit-2' } });
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Undo Finalization' }));
    await user.click(screen.getByRole('button', { name: 'Undo Finalization' }));
    expect(setParkingPassFinalizationMock).toHaveBeenCalledWith({
        registrationId: finalized.id,
        orgId: 'org-1',
        finalized: false,
        expectedFinalizedAt: '2026-08-19T14:30:00Z',
    });
    expect(await screen.findByText('Valid')).toBeInTheDocument();
});

it('keeps the prompt open and maps an eligibility race', async () => {
    const user = userEvent.setup(); const valid = { ...parkingRegistration, payment_status: 'paid' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [valid], error: null });
    setParkingPassFinalizationMock.mockRejectedValue(Object.assign(new Error('not_eligible'), { code: 'not_eligible' }));
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Finalize' }));
    await user.click(screen.getByRole('button', { name: 'Finalize' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This pass is no longer eligible to be finalized.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('shows finalizer details and pass history in the parking detail view', async () => {
    const user = userEvent.setup();
    const finalized = { ...parkingRegistration, payment_status: 'paid', parking_pass_finalized_at: '2026-08-19T14:30:00Z', parking_pass_finalized_by_name: 'Admin User' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [finalized], error: null });
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(screen.getByText('Pass status: Finalized')).toBeInTheDocument();
    expect(screen.getByText(/Finalized by Admin User/)).toBeInTheDocument();
    expect(screen.getByTestId('parking-pass-history')).toBeInTheDocument();
});
```

```jsx
it('leaves a printed pass Valid when staff chooses Not yet', async () => {
    const user = userEvent.setup();
    const valid = { ...parkingRegistration, payment_status: 'paid' };
    supabase._mocks.mockOrder.mockResolvedValue({ data: [valid], error: null });
    printParkingPassMock.mockResolvedValue();
    render(<RegistrationViewer orgId="org-1" eventId="event-1" event={parkingEvent} organizationName="Kent Methodist Church" onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Print Pass' }));
    await user.click(await screen.findByRole('button', { name: 'Not yet' }));
    expect(setParkingPassFinalizationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Valid')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the viewer test to verify it fails**

Run:

```powershell
npx vitest run src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1
```

Expected: FAIL because finalization state and dialogs are not integrated.

- [ ] **Step 3: Add finalization state, error mapping, and authoritative replacement**

In `RegistrationViewer.jsx`, import the new service/components and `getParkingPassStatus`. Add:

```js
const finalizationMessages = {
    not_eligible: 'This pass is no longer eligible to be finalized.',
    finalization_conflict: 'Another staff member already changed this pass. Refresh and try again.',
    forbidden: 'You no longer have access to manage this organization.',
    not_authenticated: 'Your session expired. Sign in and try again.',
    transition_failed: 'Unable to update this pass. Please try again.',
};
```

Inside the component add:

```js
const [finalizationDialog, setFinalizationDialog] = useState(null);
const [savingFinalization, setSavingFinalization] = useState(false);
const [finalizationError, setFinalizationError] = useState('');
const [parkingHistoryRefreshKey, setParkingHistoryRefreshKey] = useState(0);

const replaceRegistration = (updated) => {
    setRegistrations((current) => current.map((item) => item.id === updated.id
        ? { ...item, ...updated, registration_payments: updated.registration_payments || item.registration_payments || [] }
        : item));
    setSelectedReg((current) => current?.id === updated.id
        ? { ...current, ...updated, registration_payments: updated.registration_payments || current.registration_payments || [] }
        : current);
};
```

Refactor `applyPaymentResult` to call `replaceRegistration(updated)` so payment and finalization responses share the same authoritative replacement rule.

- [ ] **Step 4: Implement print, manual, and undo handlers**

Replace `handlePrintParkingPass` and add the transition handler:

```js
const openFinalizationDialog = (registration, mode) => {
    setFinalizationError('');
    setFinalizationDialog({ registration, mode });
};

const handlePrintParkingPass = async (registration) => {
    try {
        await printParkingPass(registration, event, organizationName);
        openFinalizationDialog(registration, 'post-print');
    } catch (err) {
        console.error('Failed to print parking pass:', err);
        setCancelError(err.message || 'Unable to print this parking pass.');
    }
};

const handleParkingFinalization = async () => {
    if (!finalizationDialog || savingFinalization) return;
    setSavingFinalization(true); setFinalizationError('');
    const finalized = finalizationDialog.mode !== 'undo';
    try {
        const result = await setParkingPassFinalization({
            registrationId: finalizationDialog.registration.id,
            orgId,
            finalized,
            expectedFinalizedAt: finalized
                ? null
                : finalizationDialog.registration.parking_pass_finalized_at,
        });
        replaceRegistration(result.registration);
        setParkingHistoryRefreshKey((value) => value + 1);
        setFinalizationDialog(null);
    } catch (error) {
        setFinalizationError(finalizationMessages[error.code] || finalizationMessages.transition_failed);
    } finally {
        setSavingFinalization(false);
    }
};
```

- [ ] **Step 5: Wire the table, dialog, detail state, and history**

Pass these props to `ParkingRegistrationTable`:

```jsx
onFinalize={(registration) => openFinalizationDialog(registration, 'finalize')}
onUndoFinalization={(registration) => openFinalizationDialog(registration, 'undo')}
busyRegistrationId={savingFinalization ? finalizationDialog?.registration.id : null}
```

Render the shared dialog in both list and detail return branches so it remains available regardless of current view:

```jsx
{finalizationDialog && (
    <ParkingPassFinalizationDialog
        registration={finalizationDialog.registration}
        mode={finalizationDialog.mode}
        saving={savingFinalization}
        error={finalizationError}
        onConfirm={handleParkingFinalization}
        onClose={() => { if (!savingFinalization) { setFinalizationDialog(null); setFinalizationError(''); } }}
    />
)}
```

In the parking detail card, add:

```jsx
{event?.event_type === 'parking' && !editingAnswers && (
    <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">Pass status: {getParkingPassStatus(selectedReg)}</p>
        {selectedReg.parking_pass_finalized_at && (
            <p className="mt-1 text-xs text-slate-500">
                Finalized by {selectedReg.parking_pass_finalized_by_name} on{' '}
                {new Date(selectedReg.parking_pass_finalized_at).toLocaleString()}
            </p>
        )}
    </div>
)}
```

After `RegistrationEditHistory`, render parking history only for parking events:

```jsx
{!editingAnswers && event?.event_type === 'parking' && (
    <ParkingPassFinalizationHistory
        registrationId={selectedReg.id}
        orgId={orgId}
        refreshKey={parkingHistoryRefreshKey}
    />
)}
```

- [ ] **Step 6: Run the integrated parking cluster and commit**

Run:

```powershell
npx vitest run src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx src/components/__tests__/ParkingPassFinalizationDialog.test.jsx src/components/__tests__/ParkingPassFinalizationHistory.test.jsx src/utils/__tests__/parkingRegistration.test.js src/utils/__tests__/parkingPass.test.js src/services/__tests__/parkingPassFinalization.test.js --maxWorkers=1
```

Expected: PASS.

```powershell
git add -- src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "feat: finalize parking passes from admin workflow"
```

### Task 8: Full verification and handoff

**Files:**
- Review all files changed since `647fc74`

- [ ] **Step 1: Run the full serial test suite**

Run:

```powershell
npm run test:run -- --maxWorkers=1
```

Expected: all tests PASS with no worker crash or nested-worktree discovery.

- [ ] **Step 2: Run static, migration, and production-build gates**

Run:

```powershell
npm run check:migrations
npm run lint
npm run build
git diff --check 647fc74...HEAD
```

Expected: every command PASS. Do not add or broaden lint exclusions to obtain a pass. `npm run build` must also pass the widget-cache contract.

- [ ] **Step 3: Review the exact diff and repository state**

Run:

```powershell
git diff --stat 647fc74...HEAD
git diff 647fc74...HEAD -- supabase/migrations src
git status --short --branch
```

Expected: only the planned migration, security test, parking service/utilities, focused components, and their tests changed; no secrets, generated build output, unrelated formatting, deployment, or production state changes; the worktree is clean.

- [ ] **Step 4: Hand off without publishing or deploying**

Report the branch name, commit list, exact passing commands, and any browser behavior not directly inspected. Do not push, open a PR, merge, deploy, apply the production migration, or access authenticated production records without the user's separate authorization.

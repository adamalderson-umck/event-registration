# Admin Registration Answer Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized organization members safely edit every current form answer on a non-cancelled registration, with current-form validation, optimistic concurrency, and immutable field-level audit history.

**Architecture:** Reuse the public submission normalizer for authoritative server validation, add a pure edit-preparation module for legacy-value preservation and change calculation, and expose the operation through an authenticated Edge Function. A service-role-only PostgreSQL function locks and updates the registration while inserting its audit row atomically; focused React components provide editing and history inside the existing registration detail view.

**Tech Stack:** React 19, Vite, Vitest, Testing Library, Supabase Edge Functions (TypeScript), Supabase/PostgreSQL migrations, Row Level Security.

---

## File Structure

- Modify `supabase/functions/_shared/registration-request.ts`: export the existing current-field normalizer.
- Create `supabase/functions/_shared/registration-answer-edit.ts`: parse edit requests, preserve legacy answers, normalize current answers, and compute audit changes.
- Create `supabase/functions/_shared/registration-answer-edit.test.ts`: test normalization and edit preparation.
- Create `supabase/migrations/20260807120000_admin_registration_answer_edits.sql`: add audit storage, read policy, and atomic mutation function.
- Create `src/security/__tests__/registrationAnswerEditsMigration.test.js`: enforce migration security and atomicity contracts.
- Create `supabase/functions/update-registration-answers/{handler.ts,handler.test.ts,index.ts}`: implement the authenticated endpoint.
- Modify `supabase/config.toml` and `src/security/__tests__/adminEdgeFunctions.test.js`: configure and enforce endpoint authentication.
- Create `src/utils/registrationAnswerForm.js` and its tests: prepare and validate client drafts.
- Create `src/services/registrationAnswerEdits.js` and its tests: invoke saves and query history.
- Create `src/components/RegistrationAnswerEditor.jsx` and its tests: render editable current fields and read-only legacy answers.
- Create `src/components/RegistrationEditHistory.jsx` and its tests: render immutable edits.
- Modify `src/components/RegistrationViewer.jsx` and its tests: integrate editing, dirty protection, canonical refresh, and history.
- Modify `src/security/__tests__/edgeFunctionInventory.test.js` and `supabase/functions/DEPLOYED_BASELINES.md` after authorized deployment: record exact live metadata.

### Task 1: Reuse Authoritative Current-Field Validation

**Files:**
- Modify: `supabase/functions/_shared/registration-request.ts:135-213,315-328`
- Test: `supabase/functions/_shared/registration-answer-edit.test.ts`

- [ ] **Step 1: Write the failing normalizer test**

Create `supabase/functions/_shared/registration-answer-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeCurrentFormData } from './registration-request.ts';

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  org_id: '22222222-2222-4222-8222-222222222222',
  status: 'closed',
  form_fields: [
    { id: 'name', type: 'text', label: 'Name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'permit', type: 'radio', label: 'Permit?', required: true, options: ['Yes', 'No'] },
    { id: 'plate', type: 'text', label: 'License Plate', required: true,
      condition: { field: 'permit', operator: 'equals', value: 'Yes' } },
  ],
};

describe('normalizeCurrentFormData', () => {
  it('normalizes visible answers without new-registration status rules', () => {
    expect(normalizeCurrentFormData(event, {
      name: 'Alex', email: ' ALEX@EXAMPLE.ORG ', permit: 'Yes', plate: 'ABC123',
    })).toEqual({
      name: 'Alex', email: 'alex@example.org', permit: 'Yes', plate: 'ABC123',
    });
  });

  it('rejects hidden answers and missing visible required answers', () => {
    expect(() => normalizeCurrentFormData(event, {
      name: 'Alex', email: 'alex@example.org', permit: 'No', plate: 'ABC123',
    })).toThrow('invalid_request');
    expect(() => normalizeCurrentFormData(event, {
      name: 'Alex', email: 'alex@example.org', permit: 'Yes',
    })).toThrow('invalid_request');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/registration-answer-edit.test.ts --maxWorkers=1`

Expected: FAIL because `normalizeCurrentFormData` is not exported.

- [ ] **Step 3: Export the existing normalizer and update its caller**

In `registration-request.ts`, rename `buildCleanFormData` and export it:

```ts
export function normalizeCurrentFormData(
  event: EventRecord,
  rawFormData: Record<string, unknown>,
): Record<string, unknown> {
  // Retain the complete existing buildCleanFormData body without behavior changes.
}
```

In `buildRegistrationInsert`, use:

```ts
const formData = normalizeCurrentFormData(event, request.formData);
```

Do not move `assertEventAcceptsRegistration` into the normalizer. Existing public submission must still call it; admin editing must be able to validate records for closed events.

- [ ] **Step 4: Run shared and submission tests**

Run: `npx vitest run supabase/functions/_shared/registration-answer-edit.test.ts supabase/functions/submit-registration/handler.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-answer-edit.test.ts
git commit -m "refactor: share registration answer validation"
```

### Task 2: Prepare Canonical Answer Edits and Audit Changes

**Files:**
- Create: `supabase/functions/_shared/registration-answer-edit.ts`
- Modify: `supabase/functions/_shared/registration-answer-edit.test.ts`

- [ ] **Step 1: Add failing edit-domain tests**

Append:

```ts
import {
  parseRegistrationAnswerEditRequest,
  prepareRegistrationAnswerEdit,
} from './registration-answer-edit.ts';

const REGISTRATION_ID = '33333333-3333-4333-8333-333333333333';

describe('registration answer edits', () => {
  it('parses only the bounded request contract', () => {
    expect(parseRegistrationAnswerEditRequest({
      registrationId: REGISTRATION_ID,
      orgId: event.org_id,
      expectedFormData: { name: 'Alex' },
      answers: { name: 'Morgan' },
    })).toEqual({
      registrationId: REGISTRATION_ID,
      orgId: event.org_id,
      expectedFormData: { name: 'Alex' },
      answers: { name: 'Morgan' },
    });
    expect(() => parseRegistrationAnswerEditRequest({
      registrationId: REGISTRATION_ID, orgId: event.org_id,
      expectedFormData: {}, answers: {}, status: 'confirmed',
    })).toThrow('invalid_request');
  });

  it('preserves legacy answers and records current-field changes', () => {
    const prepared = prepareRegistrationAnswerEdit(event, {
      form_data: {
        name: 'Alex', email: 'alex@example.org', permit: 'Yes', plate: 'TEMP', retired: 'keep me',
      },
    }, { name: 'Alex', email: 'alex@example.org', permit: 'Yes', plate: 'ABC123' });
    expect(prepared.formData).toEqual({
      retired: 'keep me', name: 'Alex', email: 'alex@example.org', permit: 'Yes', plate: 'ABC123',
    });
    expect(prepared.changes).toEqual([{
      fieldId: 'plate', fieldLabel: 'License Plate', before: 'TEMP', after: 'ABC123',
    }]);
  });

  it('records removal when a condition hides a field', () => {
    const prepared = prepareRegistrationAnswerEdit(event, {
      form_data: { name: 'Alex', email: 'alex@example.org', permit: 'Yes', plate: 'TEMP' },
    }, { name: 'Alex', email: 'alex@example.org', permit: 'No' });
    expect(prepared.changes).toEqual([
      { fieldId: 'permit', fieldLabel: 'Permit?', before: 'Yes', after: 'No' },
      { fieldId: 'plate', fieldLabel: 'License Plate', before: 'TEMP', after: null },
    ]);
  });

  it('returns no changes after normalization of equivalent answers', () => {
    expect(prepareRegistrationAnswerEdit(event, {
      form_data: { name: 'Alex', email: 'alex@example.org', permit: 'No' },
    }, { name: 'Alex', email: ' ALEX@EXAMPLE.ORG ', permit: 'No' }).changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/registration-answer-edit.test.ts --maxWorkers=1`

Expected: FAIL because the edit module does not exist.

- [ ] **Step 3: Implement the edit-domain module**

Create `registration-answer-edit.ts`:

```ts
import { type EventRecord, normalizeCurrentFormData } from './registration-request.ts';

const MAX_BODY_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(['registrationId', 'orgId', 'expectedFormData', 'answers']);
type UnknownRecord = Record<string, unknown>;
const invalid = (): never => { throw new Error('invalid_request'); };
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: unknown) => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
};
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export interface RegistrationAnswerChange {
  fieldId: string; fieldLabel: string; before: unknown; after: unknown;
}

export function parseRegistrationAnswerEditRequest(value: unknown) {
  if (!isRecord(value) || Object.keys(value).some((key) => !KEYS.has(key)) ||
      bytes(value) > MAX_BODY_BYTES || !UUID.test(String(value.registrationId || '')) ||
      !UUID.test(String(value.orgId || '')) || !isRecord(value.expectedFormData) ||
      !isRecord(value.answers)) invalid();
  return {
    registrationId: value.registrationId as string,
    orgId: value.orgId as string,
    expectedFormData: value.expectedFormData,
    answers: value.answers,
  };
}

export function prepareRegistrationAnswerEdit(
  event: EventRecord,
  registration: { form_data: UnknownRecord },
  answers: UnknownRecord,
) {
  const fields = Array.isArray(event.form_fields)
    ? event.form_fields.filter((field): field is UnknownRecord =>
      isRecord(field) && field.type !== 'sectionBreak')
    : [];
  const currentIds = new Set(fields.map((field) => String(field.id)));
  const legacy = Object.fromEntries(
    Object.entries(registration.form_data).filter(([id]) => !currentIds.has(id)),
  );
  const formData = { ...legacy, ...normalizeCurrentFormData(event, answers) };
  const changes: RegistrationAnswerChange[] = fields.flatMap((field) => {
    const fieldId = String(field.id);
    const before = Object.hasOwn(registration.form_data, fieldId)
      ? registration.form_data[fieldId] : null;
    const after = Object.hasOwn(formData, fieldId) ? formData[fieldId] : null;
    return same(before, after) ? [] : [{
      fieldId,
      fieldLabel: typeof field.label === 'string' && field.label ? field.label : fieldId,
      before,
      after,
    }];
  });
  return { formData, changes };
}
```

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run supabase/functions/_shared/registration-answer-edit.test.ts --maxWorkers=1
git add supabase/functions/_shared/registration-answer-edit.ts supabase/functions/_shared/registration-answer-edit.test.ts
git commit -m "feat: prepare audited registration answer edits"
```

Expected: PASS and commit succeeds.

### Task 3: Add Atomic Audit Storage and Mutation

**Files:**
- Create: `supabase/migrations/20260807120000_admin_registration_answer_edits.sql`
- Create: `src/security/__tests__/registrationAnswerEditsMigration.test.js`

- [ ] **Step 1: Write the failing migration contract test**

Create `registrationAnswerEditsMigration.test.js`:

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.resolve(process.cwd(),
  'supabase/migrations/20260807120000_admin_registration_answer_edits.sql'), 'utf8');

describe('registration answer edit migration', () => {
  it('creates organization-scoped immutable history', () => {
    expect(sql).toMatch(/create table public\.registration_answer_edits/i);
    expect(sql).toMatch(/for select[\s\S]+to authenticated[\s\S]+private\.is_org_member/i);
    expect(sql).toMatch(/revoke all on table public\.registration_answer_edits from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on table public\.registration_answer_edits to authenticated/i);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]+registration_answer_edits[^;]+authenticated/i);
  });
  it('locks and compares the canonical registration', () => {
    expect(sql).toMatch(/create or replace function public\.apply_registration_answer_edit/i);
    expect(sql).toMatch(/for update of registrations/i);
    expect(sql).toMatch(/v_registration\.form_data is distinct from p_expected_form_data/i);
    expect(sql).toMatch(/v_registration\.status = 'cancelled'/i);
  });
  it('updates only form_data and inserts history atomically', () => {
    expect(sql).toMatch(/update public\.registrations\s+set form_data = p_new_form_data/i);
    expect(sql).not.toMatch(/set[\s\S]{0,120}(status|payment_status|signature_records)\s*=/i);
    expect(sql).toMatch(/insert into public\.registration_answer_edits/i);
  });
  it('exposes mutation only to service_role', () => {
    expect(sql).toMatch(/revoke all on function public\.apply_registration_answer_edit[^;]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.apply_registration_answer_edit[^;]+to service_role/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/security/__tests__/registrationAnswerEditsMigration.test.js --maxWorkers=1`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Create the migration**

Create `20260807120000_admin_registration_answer_edits.sql`:

```sql
CREATE TABLE public.registration_answer_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  editor_user_id uuid NOT NULL,
  editor_display_name text NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_answer_edits_registration_created_idx
  ON public.registration_answer_edits (registration_id, created_at DESC);
CREATE INDEX registration_answer_edits_org_idx ON public.registration_answer_edits (org_id);
ALTER TABLE public.registration_answer_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY registration_answer_edits_org_read ON public.registration_answer_edits
  FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(registration_answer_edits.org_id)));
REVOKE ALL ON TABLE public.registration_answer_edits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.registration_answer_edits TO authenticated;
GRANT ALL ON TABLE public.registration_answer_edits TO service_role;

CREATE OR REPLACE FUNCTION public.apply_registration_answer_edit(
  p_registration_id uuid, p_org_id uuid, p_event_id uuid,
  p_editor_user_id uuid, p_editor_display_name text,
  p_expected_form_data jsonb, p_new_form_data jsonb, p_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_edit public.registration_answer_edits%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_expected_form_data) <> 'object'
     OR jsonb_typeof(p_new_form_data) <> 'object'
     OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0
     OR nullif(pg_catalog.btrim(p_editor_display_name), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;
  SELECT registrations.* INTO v_registration
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
    AND registrations.event_id = p_event_id
  FOR UPDATE OF registrations;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_registration.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'registration_cancelled');
  END IF;
  IF v_registration.form_data IS DISTINCT FROM p_expected_form_data THEN
    RETURN jsonb_build_object('ok', false, 'code', 'edit_conflict');
  END IF;
  UPDATE public.registrations SET form_data = p_new_form_data
  WHERE id = p_registration_id RETURNING * INTO v_registration;
  INSERT INTO public.registration_answer_edits (
    registration_id, org_id, event_id, editor_user_id, editor_display_name, changes
  ) VALUES (
    p_registration_id, p_org_id, p_event_id, p_editor_user_id,
    pg_catalog.btrim(p_editor_display_name), p_changes
  ) RETURNING * INTO v_edit;
  RETURN jsonb_build_object('ok', true, 'registration', to_jsonb(v_registration), 'edit', to_jsonb(v_edit));
END;
$$;
REVOKE ALL ON FUNCTION public.apply_registration_answer_edit(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_registration_answer_edit(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) TO service_role;
```

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run src/security/__tests__/registrationAnswerEditsMigration.test.js --maxWorkers=1
npm run check:migrations
git add supabase/migrations/20260807120000_admin_registration_answer_edits.sql src/security/__tests__/registrationAnswerEditsMigration.test.js
git commit -m "feat: store atomic registration answer audits"
```

Expected: both checks PASS and commit succeeds.

### Task 4: Build the Authenticated Update Endpoint

**Files:**
- Create: `supabase/functions/update-registration-answers/handler.ts`
- Create: `supabase/functions/update-registration-answers/handler.test.ts`
- Create: `supabase/functions/update-registration-answers/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/security/__tests__/adminEdgeFunctions.test.js`

- [ ] **Step 1: Write failing handler tests**

Create `handler.test.ts` with dependency fakes around this contract:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createUpdateRegistrationAnswersHandler } from './handler.ts';

const ids = {
  registration: '33333333-3333-4333-8333-333333333333',
  event: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  user: '44444444-4444-4444-8444-444444444444',
};
const event = { id: ids.event, org_id: ids.org, form_fields: [
  { id: 'plate', type: 'text', label: 'License Plate', required: true },
] };
const registration = {
  id: ids.registration, org_id: ids.org, event_id: ids.event, status: 'confirmed',
  form_data: { plate: 'TEMP', retired: 'keep' }, signature_records: [], payment_status: 'paid',
};
const body = {
  registrationId: ids.registration, orgId: ids.org,
  expectedFormData: registration.form_data, answers: { plate: 'ABC123' },
};
const post = (value = body) => new Request('https://example.test/update-registration-answers', {
  method: 'POST',
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});
const dependencies = (overrides = {}) => ({
  authenticate: vi.fn(async () => ({ id: ids.user, email: 'admin@kentmethodist.org' })),
  isMember: vi.fn(async () => true),
  loadRegistration: vi.fn(async () => registration),
  loadEvent: vi.fn(async () => event),
  loadEditorName: vi.fn(async () => 'Admin User'),
  applyEdit: vi.fn(async (args) => ({
    ok: true,
    registration: { ...registration, form_data: args.newFormData },
    edit: { id: 'edit-1', changes: args.changes },
  })),
  log: vi.fn(),
  requestId: vi.fn(() => 'request-1'),
  ...overrides,
});

describe('update-registration-answers handler', () => {
  it('uses trusted identity and canonical values for a successful edit', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post());
    expect(response.status).toBe(200);
    expect(deps.applyEdit).toHaveBeenCalledWith(expect.objectContaining({
      registrationId: ids.registration, orgId: ids.org, eventId: ids.event,
      editorUserId: ids.user, editorDisplayName: 'Admin User',
      expectedFormData: registration.form_data,
      newFormData: { retired: 'keep', plate: 'ABC123' },
      changes: [{ fieldId: 'plate', fieldLabel: 'License Plate', before: 'TEMP', after: 'ABC123' }],
    }));
  });

  it('returns canonical data without mutation for a no-op', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post({
      ...body, answers: { plate: 'TEMP' },
    }));
    expect(deps.applyEdit).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ registration, edit: null });
  });

  it('rejects a stale snapshot even when the proposed answers match current data', async () => {
    const deps = dependencies();
    const response = await createUpdateRegistrationAnswersHandler(deps)(post({
      ...body,
      expectedFormData: { plate: 'OLDER', retired: 'keep' },
      answers: { plate: 'TEMP' },
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'edit_conflict' });
    expect(deps.applyEdit).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthenticated', { authenticate: vi.fn(async () => null) }, 401, 'not_authorized'],
    ['non-member', { isMember: vi.fn(async () => false) }, 404, 'not_found'],
    ['missing', { loadRegistration: vi.fn(async () => null) }, 404, 'not_found'],
    ['cancelled', { loadRegistration: vi.fn(async () => ({ ...registration, status: 'cancelled' })) }, 409, 'registration_cancelled'],
  ])('rejects %s requests', async (_label, overrides, status, code) => {
    const response = await createUpdateRegistrationAnswersHandler(dependencies(overrides))(post());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(expect.objectContaining({ error: code }));
  });

  it.each([['edit_conflict', 409], ['registration_cancelled', 409], ['not_found', 404]])(
    'maps RPC result %s', async (code, status) => {
      const deps = dependencies({ applyEdit: vi.fn(async () => ({ ok: false, code })) });
      const response = await createUpdateRegistrationAnswersHandler(deps)(post());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
    },
  );
});
```

In the same file add explicit tests for wrong method (`405`), absent authorization (`401`), malformed or over-1-MiB bodies (`400 invalid_request`), organization/event mismatches (`404 not_found`), invalid answers (`400 invalid_request`), and thrown dependencies (`500 save_failed` with no PII in `log`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/update-registration-answers/handler.test.ts --maxWorkers=1`

Expected: FAIL because the handler is absent.

- [ ] **Step 3: Implement the dependency-driven handler**

Create `handler.ts`:

```ts
import {
  parseRegistrationAnswerEditRequest,
  prepareRegistrationAnswerEdit,
  type RegistrationAnswerChange,
} from '../_shared/registration-answer-edit.ts';
import type { EventRecord } from '../_shared/registration-request.ts';

type UnknownRecord = Record<string, unknown>;
interface User { id: string; email?: string | null }
interface Registration extends UnknownRecord {
  id: string; org_id: string; event_id: string; status: string; form_data: UnknownRecord;
}
export interface ApplyArgs {
  registrationId: string; orgId: string; eventId: string; editorUserId: string;
  editorDisplayName: string; expectedFormData: UnknownRecord; newFormData: UnknownRecord;
  changes: RegistrationAnswerChange[];
}
interface Dependencies {
  authenticate(req: Request): Promise<User | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  loadRegistration(id: string): Promise<Registration | null>;
  loadEvent(id: string): Promise<EventRecord | null>;
  loadEditorName(user: User): Promise<string>;
  applyEdit(args: ApplyArgs): Promise<UnknownRecord>;
  log?(event: UnknownRecord): void;
  requestId?(): string;
}

const MAX_BODY_BYTES = 1024 * 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const statusFor = (code: string) => code === 'not_found' ? 404
  : code === 'edit_conflict' || code === 'registration_cancelled' ? 409 : 400;

export function createUpdateRegistrationAnswersHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const requestId = deps.requestId?.() ?? crypto.randomUUID();
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    try {
      const user = await deps.authenticate(req);
      if (!user) return json({ error: 'not_authorized' }, 401);
      const length = Number(req.headers.get('content-length') || 0);
      if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
        return json({ error: 'invalid_request' }, 400);
      }
      const request = parseRegistrationAnswerEditRequest(await req.json());
      if (!await deps.isMember(request.orgId, user.id)) return json({ error: 'not_found' }, 404);
      const registration = await deps.loadRegistration(request.registrationId);
      if (!registration || registration.org_id !== request.orgId) return json({ error: 'not_found' }, 404);
      if (registration.status === 'cancelled') return json({ error: 'registration_cancelled' }, 409);
      const event = await deps.loadEvent(registration.event_id);
      if (!event || event.id !== registration.event_id || event.org_id !== request.orgId) {
        return json({ error: 'not_found' }, 404);
      }
      if (JSON.stringify(registration.form_data) !== JSON.stringify(request.expectedFormData)) {
        return json({ error: 'edit_conflict' }, 409);
      }
      const prepared = prepareRegistrationAnswerEdit(event, registration, request.answers);
      if (prepared.changes.length === 0) return json({ registration, edit: null });
      const result = await deps.applyEdit({
        registrationId: registration.id, orgId: registration.org_id,
        eventId: registration.event_id, editorUserId: user.id,
        editorDisplayName: await deps.loadEditorName(user),
        expectedFormData: request.expectedFormData,
        newFormData: prepared.formData, changes: prepared.changes,
      });
      if (result.ok !== true) {
        const code = typeof result.code === 'string' ? result.code : 'save_failed';
        return json({ error: code }, statusFor(code));
      }
      return json({ registration: result.registration, edit: result.edit });
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_request') {
        return json({ error: 'invalid_request' }, 400);
      }
      deps.log?.({ requestId, code: 'save_failed' });
      return json({ error: 'save_failed', requestId }, 500);
    }
  };
}
```

- [ ] **Step 4: Wire trusted Supabase dependencies**

Create `index.ts` with a user client carrying the request `Authorization` header and a service-role client. Use these exact data operations:

```ts
const isMember = async (orgId: string, userId: string) => {
  const { data } = await admin.from('org_members').select('user_id')
    .eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
};
const loadRegistration = async (id: string) => {
  const { data } = await admin.from('registrations').select('*').eq('id', id).maybeSingle();
  return data;
};
const loadEvent = async (id: string) => {
  const { data } = await admin.from('events').select('id,org_id,form_fields')
    .eq('id', id).maybeSingle();
  return data;
};
const loadEditorName = async (user: { id: string; email?: string | null }) => {
  const { data } = await admin.from('profiles').select('display_name')
    .eq('id', user.id).maybeSingle();
  return data?.display_name?.trim() || user.email || user.id;
};
const applyEdit = async (args: ApplyArgs) => {
  const { data, error } = await admin.rpc('apply_registration_answer_edit', {
    p_registration_id: args.registrationId, p_org_id: args.orgId,
    p_event_id: args.eventId, p_editor_user_id: args.editorUserId,
    p_editor_display_name: args.editorDisplayName,
    p_expected_form_data: args.expectedFormData,
    p_new_form_data: args.newFormData, p_changes: args.changes,
  });
  if (error) throw error;
  return data;
};
```

`authenticate` must require the bearer header and call `userClient.auth.getUser()`. Environment lookup must fail generically for absent `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. Pass `console.error(JSON.stringify(event))` as the sanitized logger and serve the created handler with `Deno.serve`.

- [ ] **Step 5: Configure and statically enforce authentication**

Append to `supabase/config.toml`:

```toml
[functions.update-registration-answers]
verify_jwt = true
```

Append to `adminEdgeFunctions.test.js`:

```js
it('protects registration answer edits with auth, membership, and trusted RPC data', () => {
  const source = readFunction('update-registration-answers');
  expect(source).toMatch(/auth\.getUser\(\)/);
  expect(source).toMatch(/from\('org_members'\)/);
  expect(source).toMatch(/from\('registrations'\)/);
  expect(source).toMatch(/from\('events'\)/);
  expect(source).toMatch(/rpc\('apply_registration_answer_edit'/);
  expect(source).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
});
```

- [ ] **Step 6: Run focused tests and commit**

```powershell
npx vitest run supabase/functions/_shared/registration-answer-edit.test.ts supabase/functions/update-registration-answers/handler.test.ts src/security/__tests__/adminEdgeFunctions.test.js --maxWorkers=1
git add supabase/functions/update-registration-answers supabase/config.toml src/security/__tests__/adminEdgeFunctions.test.js
git commit -m "feat: add registration answer update endpoint"
```

Expected: PASS. Do not run the edge inventory test until deployment metadata is recorded in Task 9.

### Task 5: Add Client Answer Utilities and Service Boundary

**Files:**
- Create: `src/utils/registrationAnswerForm.js`
- Create: `src/utils/__tests__/registrationAnswerForm.test.js`
- Create: `src/services/registrationAnswerEdits.js`
- Create: `src/services/__tests__/registrationAnswerEdits.test.js`

- [ ] **Step 1: Write failing utility tests**

Create `registrationAnswerForm.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  buildAnswerDraft, getLegacyAnswers, getVisibleFields,
  isAnswerDraftDirty, prepareVisibleAnswers, validateAnswerDraft,
} from '../registrationAnswerForm';

const fields = [
  { id: 'section', type: 'sectionBreak', label: 'Vehicle' },
  { id: 'email', type: 'email', label: 'Email', required: true },
  { id: 'has_plate', type: 'radio', label: 'Plate?', required: true, options: ['Yes', 'No'] },
  { id: 'plate', type: 'text', label: 'License Plate', required: true,
    condition: { field: 'has_plate', operator: 'equals', value: 'Yes' } },
];

it('separates editable and legacy answers', () => {
  const saved = { email: 'a@example.org', has_plate: 'Yes', plate: 'TEMP', retired: 'keep' };
  expect(buildAnswerDraft(fields, saved)).toEqual({
    email: 'a@example.org', has_plate: 'Yes', plate: 'TEMP',
  });
  expect(getLegacyAnswers(fields, saved)).toEqual({ retired: 'keep' });
});

it('validates visible formats and drops hidden answers', () => {
  const draft = { email: 'bad', has_plate: 'No', plate: 'TEMP' };
  expect(getVisibleFields(fields, draft).map((field) => field.id)).toEqual(['email', 'has_plate']);
  expect(validateAnswerDraft(fields, draft)).toEqual({ email: 'Please enter a valid email address' });
  expect(prepareVisibleAnswers(fields, draft)).toEqual({ email: 'bad', has_plate: 'No' });
});

it('compares editable values independently of legacy answers', () => {
  const saved = { email: 'a@example.org', has_plate: 'No', retired: 'keep' };
  expect(isAnswerDraftDirty(fields, saved, buildAnswerDraft(fields, saved))).toBe(false);
  expect(isAnswerDraftDirty(fields, saved, { email: 'b@example.org', has_plate: 'No' })).toBe(true);
});
```

Add table-driven cases for required checkbox/checkbox-group, phone digit length, finite number, ISO date, and select/radio/checkbox-group options.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/registrationAnswerForm.test.js --maxWorkers=1`

Expected: FAIL because the utility is absent.

- [ ] **Step 3: Implement client utilities**

Create `registrationAnswerForm.js`, importing `evaluateCondition`. Export the six tested functions and:

```js
export const ANSWER_ERROR_MESSAGES = Object.freeze({
  required: 'This field is required',
  checkboxGroup: 'Select at least one option',
  email: 'Please enter a valid email address',
  phone: 'Please enter a valid phone number',
  number: 'Please enter a valid number',
  date: 'Please enter a valid date',
  option: 'Select a listed option',
});
```

`getVisibleFields` iterates in field order and excludes section breaks. `prepareVisibleAnswers` copies only own values for visible fields. `validateAnswerDraft` mirrors required values, email, 10-15 phone digits, finite number, `YYYY-MM-DD`, and configured options. `isAnswerDraftDirty` compares `JSON.stringify(prepareVisibleAnswers(...))` for saved and draft values so hiding a dependent answer counts as a change.

- [ ] **Step 4: Write failing client-service tests**

Create `registrationAnswerEdits.test.js`, mock `../supabase`, and assert:

```js
expect(supabase.functions.invoke).toHaveBeenCalledWith('update-registration-answers', {
  body: { registrationId, orgId, expectedFormData, answers },
});
```

For history, assert `.from('registration_answer_edits').select('*').eq('registration_id', registrationId).eq('org_id', orgId).order('created_at', { ascending: false })`. An invoke error with context JSON `{ error: 'edit_conflict' }` must throw an `Error` whose `code` is `edit_conflict`; unknown errors use `save_failed`.

- [ ] **Step 5: Implement the client service**

Create `registrationAnswerEdits.js`:

```js
import { supabase } from './supabase';
const codedError = (code) => Object.assign(new Error(code), { code });

export async function updateRegistrationAnswers(payload) {
  const { data, error } = await supabase.functions.invoke('update-registration-answers', {
    body: payload,
  });
  if (error) {
    let body;
    try { body = await error.context?.json?.(); } catch { body = null; }
    throw codedError(body?.error || 'save_failed');
  }
  return data;
}

export async function listRegistrationAnswerEdits(registrationId, orgId) {
  const { data, error } = await supabase.from('registration_answer_edits')
    .select('*').eq('registration_id', registrationId).eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw codedError('history_failed');
  return data || [];
}
```

- [ ] **Step 6: Verify and commit**

```powershell
npx vitest run src/utils/__tests__/registrationAnswerForm.test.js src/services/__tests__/registrationAnswerEdits.test.js --maxWorkers=1
git add src/utils/registrationAnswerForm.js src/utils/__tests__/registrationAnswerForm.test.js src/services/registrationAnswerEdits.js src/services/__tests__/registrationAnswerEdits.test.js
git commit -m "feat: add registration answer client helpers"
```

Expected: PASS and commit succeeds.

### Task 6: Build the Focused Answer Editor

**Files:**
- Create: `src/components/RegistrationAnswerEditor.jsx`
- Create: `src/components/__tests__/RegistrationAnswerEditor.test.jsx`

- [ ] **Step 1: Write failing interaction tests**

Use this fixture:

```jsx
const fields = [
  { id: 'section', type: 'sectionBreak', label: 'Vehicle' },
  { id: 'email', type: 'email', label: 'Email', required: true },
  { id: 'kind', type: 'radio', label: 'Tag Type', required: true,
    options: ['Temporary', 'Permanent'] },
  { id: 'plate', type: 'text', label: 'License Plate', required: true,
    condition: { field: 'kind', operator: 'equals', value: 'Permanent' } },
];
render(<RegistrationAnswerEditor
  formFields={fields}
  savedFormData={{ email: 'alex@example.org', kind: 'Temporary', retired: 'Legacy value' }}
  saving={false} saveError="" onDirtyChange={onDirtyChange}
  onSave={onSave} onCancel={onCancel}
/>);
```

Assert the section heading and legacy value render; choosing Permanent reveals License Plate; invalid email blocks save with an inline alert; valid submit calls `onSave` with visible current answers only; edits call `onDirtyChange(true)`; Cancel calls `onCancel`; and `saving` disables inputs/actions. Add one table-driven render/edit case for every `DynamicField` type.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/RegistrationAnswerEditor.test.jsx --maxWorkers=1`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement `RegistrationAnswerEditor`**

The component owns `draft` and `errors`, resetting both when `savedFormData` changes. Its core is:

```jsx
const pages = splitIntoPages(formFields || []);
const legacyAnswers = getLegacyAnswers(formFields, savedFormData);
const dirty = isAnswerDraftDirty(formFields, savedFormData, draft);
useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

const handleSubmit = (event) => {
  event.preventDefault();
  const nextErrors = validateAnswerDraft(formFields, draft);
  setErrors(nextErrors);
  if (Object.keys(nextErrors).length === 0) {
    onSave(prepareVisibleAnswers(formFields, draft));
  }
};
```

Render each page title in `<h4>`, filter fields with `evaluateCondition(field.condition, draft)`, and render `DynamicField` with `disabled={saving}`. Format null/empty legacy values as `â€”`, arrays as comma-separated strings, and show them in **Legacy answers (read-only)**. Render `saveError` with `role="alert"`, then **Cancel Editing** and **Save Changes** buttons; Save uses `loading={saving}`.

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run src/components/__tests__/RegistrationAnswerEditor.test.jsx src/utils/__tests__/registrationAnswerForm.test.js --maxWorkers=1
git add src/components/RegistrationAnswerEditor.jsx src/components/__tests__/RegistrationAnswerEditor.test.jsx
git commit -m "feat: add registration answer editor"
```

Expected: PASS and commit succeeds.
### Task 7: Build Immutable Edit History UI

**Files:**
- Create: `src/components/RegistrationEditHistory.jsx`
- Create: `src/components/__tests__/RegistrationEditHistory.test.jsx`

- [ ] **Step 1: Write failing history tests**

Mock `listRegistrationAnswerEdits` and use:

```jsx
render(<RegistrationEditHistory
  registrationId="registration-1"
  orgId="org-1"
  refreshKey={0}
/>);
await user.click(screen.getByRole('button', { name: /edit history/i }));
expect(await screen.findByText('Admin User')).toBeInTheDocument();
expect(screen.getByText('License Plate')).toBeInTheDocument();
expect(screen.getByText('TEMP')).toBeInTheDocument();
expect(screen.getByText('ABC123')).toBeInTheDocument();
```

The mock entry includes `created_at`, `editor_display_name`, `editor_user_id`, and changes demonstrating scalar, array, boolean, and null values. Add tests for collapsed-by-default, loading, empty history, `history_failed`, fallback user ID, and refetch when `refreshKey` changes while expanded.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/__tests__/RegistrationEditHistory.test.jsx --maxWorkers=1`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement history rendering**

Create `RegistrationEditHistory.jsx` with `expanded`, `loading`, `error`, and `entries` state. Load only when first expanded, and refetch whenever `refreshKey` changes while expanded. The toggle is a button with `aria-expanded`. Use:

```js
const formatAuditValue = (value) => {
  if (value === null || value === undefined || value === '') return 'â€”';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};
```

Each entry shows `editor_display_name || editor_user_id`, localized `created_at`, and changes with labelled **Before** and **After** values. Loading and empty states use `role="status"`; failure uses `role="alert"` and a Retry button.

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run src/components/__tests__/RegistrationEditHistory.test.jsx src/services/__tests__/registrationAnswerEdits.test.js --maxWorkers=1
git add src/components/RegistrationEditHistory.jsx src/components/__tests__/RegistrationEditHistory.test.jsx
git commit -m "feat: show registration answer edit history"
```

Expected: PASS and commit succeeds.

### Task 8: Integrate Editing into RegistrationViewer

**Files:**
- Modify: `src/components/RegistrationViewer.jsx:1-18,32-45,284-410`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`

- [ ] **Step 1: Extend viewer test mocks**

Add:

```js
const { updateRegistrationAnswersMock } = vi.hoisted(() => ({
  updateRegistrationAnswersMock: vi.fn(),
}));
vi.mock('../../services/registrationAnswerEdits', () => ({
  updateRegistrationAnswers: updateRegistrationAnswersMock,
}));
vi.mock('../RegistrationEditHistory', () => ({
  default: ({ refreshKey }) => <div data-testid="edit-history">history-{refreshKey}</div>,
}));
```

Reset the save mock in `beforeEach`. Success tests resolve `{ registration: updatedRegistration, edit: { id: 'edit-1' } }`.

- [ ] **Step 2: Write failing integration tests**

Add tests proving:

- confirmed, pending, and waitlisted detail views show **Edit Answers**;
- cancelled detail views do not;
- editing a parking plate calls the service with the original complete `expectedFormData` and current visible `answers`;
- success replaces detail/list values and increments history refresh;
- `edit_conflict`, `registration_cancelled`, and `save_failed` preserve the draft with distinct messages;
- dirty Cancel and Back use `window.confirm`, clean Cancel does not; and
- `beforeunload` is prevented only while editing is dirty.

The parking save assertion is exact:

```js
expect(updateRegistrationAnswersMock).toHaveBeenCalledWith({
  registrationId: 'parking-registration-1',
  orgId: 'org-1',
  expectedFormData: parkingRegistration.form_data,
  answers: expect.objectContaining({
    [PARKING_FIELD_IDS.LICENSE_PLATE]: 'PERM456',
  }),
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1`

Expected: FAIL because edit mode is absent.

- [ ] **Step 4: Add viewer state, dirty protection, and save behavior**

Import `Pencil`, `RegistrationAnswerEditor`, `RegistrationEditHistory`, and `updateRegistrationAnswers`. Add:

```js
const [editingAnswers, setEditingAnswers] = useState(false);
const [answerDraftDirty, setAnswerDraftDirty] = useState(false);
const [savingAnswers, setSavingAnswers] = useState(false);
const [answerSaveError, setAnswerSaveError] = useState('');
const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
```

Register a `beforeunload` handler only while `editingAnswers && answerDraftDirty`. Add `confirmDiscardAnswerDraft` that returns true when clean and otherwise calls `window.confirm('Discard unsaved registration changes?')`.

Use these messages and save function:

```js
const answerEditMessages = {
  edit_conflict: 'This registration changed elsewhere. Reload the latest answers before trying again.',
  registration_cancelled: 'This registration was cancelled and is now read-only.',
  invalid_request: 'Correct the highlighted registration answers and try again.',
  save_failed: 'Unable to save these changes. Your draft has been kept; please try again.',
};

const handleSaveAnswers = async (answers) => {
  if (!selectedReg || savingAnswers) return;
  setSavingAnswers(true);
  setAnswerSaveError('');
  try {
    const result = await updateRegistrationAnswers({
      registrationId: selectedReg.id,
      orgId,
      expectedFormData: getFormData(selectedReg),
      answers,
    });
    const updated = {
      ...selectedReg,
      ...result.registration,
      registration_payments: result.registration.registration_payments
        || selectedReg.registration_payments || [],
    };
    setRegistrations((current) => current.map((item) =>
      item.id === updated.id ? updated : item));
    setSelectedReg(updated);
    setEditingAnswers(false);
    setAnswerDraftDirty(false);
    if (result.edit) setHistoryRefreshKey((value) => value + 1);
  } catch (error) {
    setAnswerSaveError(answerEditMessages[error.code] || answerEditMessages.save_failed);
  } finally {
    setSavingAnswers(false);
  }
};
```

For a cancelled error, do not discard the draft. Realtime or a deliberate reload will supply the canonical cancelled row.

- [ ] **Step 5: Render edit mode and history**

Add **Edit Answers** only for non-cancelled records outside edit mode. When editing, replace the answer list with:

```jsx
<RegistrationAnswerEditor
  formFields={formFields}
  savedFormData={getFormData(selectedReg)}
  saving={savingAnswers}
  saveError={answerSaveError}
  onDirtyChange={setAnswerDraftDirty}
  onSave={handleSaveAnswers}
  onCancel={() => {
    if (!confirmDiscardAnswerDraft()) return;
    setEditingAnswers(false);
    setAnswerDraftDirty(false);
    setAnswerSaveError('');
  }}
/>
```

Hide cancellation, payment, print, waiver, and payment-history controls while editing so only one mutation workflow is active. Route **Back to List** through the same discard confirmation. Below the card, outside edit mode, render:

```jsx
<RegistrationEditHistory
  registrationId={selectedReg.id}
  orgId={orgId}
  refreshKey={historyRefreshKey}
/>
```

- [ ] **Step 6: Run focused UI and downstream regressions**

```powershell
npx vitest run src/components/__tests__/RegistrationAnswerEditor.test.jsx src/components/__tests__/RegistrationEditHistory.test.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/utils/__tests__/parkingPass.test.js src/utils/__tests__/exportCsv.test.js src/utils/__tests__/printReports.test.js --maxWorkers=1
```

Expected: PASS. Parking/table/pass/export/print production code remains unchanged because it already reads `form_data`.

- [ ] **Step 7: Commit**

```powershell
git add src/components/RegistrationViewer.jsx src/components/__tests__/RegistrationViewer.test.jsx
git commit -m "feat: edit registration answers from admin view"
```

### Task 9: Verify Locally, Deploy with Authorization, and Record Live Metadata

**Files:**
- Modify after authorized deployment: `src/security/__tests__/edgeFunctionInventory.test.js`
- Modify after authorized deployment: `supabase/functions/DEPLOYED_BASELINES.md`

- [ ] **Step 1: Run local repository checks serially**

```powershell
npm run lint
npm run check:migrations
npx vitest run --maxWorkers=1
npm run build
```

Expected before deployment: lint, migration checks, feature tests, and build PASS. The full Vitest run has one intentional inventory failure because the source tree contains `update-registration-answers` without live deployment metadata. Confirm there are no other failures.

- [ ] **Step 2: Stop for explicit production authorization**

Report local verification and ask permission to apply `20260807120000_admin_registration_answer_edits.sql` and deploy `update-registration-answers` to project `eonpdgufuewpqdjpshbc`. Do not make either production mutation without authorization.

- [ ] **Step 3: Reconcile and apply only the reviewed migration**

Read the live migration ledger and compare it to repository history through the established Supabase CLI workflow. Because this repository previously had ledger/filename differences, do not run a blind `supabase db push`. Apply only the new reviewed migration after confirming its predecessor relationship. Verify the live table, indexes, RLS policy, grants, and function signature.

Expected: only the new audit table and RPC are added; existing data, policies, and functions remain unchanged.

- [ ] **Step 4: Deploy and read back the function**

```powershell
npx supabase functions deploy update-registration-answers --project-ref eonpdgufuewpqdjpshbc
npx supabase functions list --project-ref eonpdgufuewpqdjpshbc --output json
```

Expected: the function is ACTIVE with JWT verification enabled. Capture its exact returned version and `ezbr_sha256`; do not infer the hash.

- [ ] **Step 5: Record exact metadata and close the inventory gap**

Add `update-registration-answers` to `EXPECTED_FUNCTIONS` in `edgeFunctionInventory.test.js` using the read-back version, `verifyJwt: true`, and exact hash. Add the matching row to `DEPLOYED_BASELINES.md`, preserving existing provenance and adding the read-back date if it differs.

Run: `npx vitest run src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1`

Expected: PASS with exact directory, config, version, and hash coverage.

- [ ] **Step 6: Perform the parking acceptance check**

With a controlled non-cancelled parking registration:

1. Record its original plate and email-delivery count.
2. Open **View**, choose **Edit Answers**, and replace the temporary tag.
3. Save and inspect detail values and Edit History.
4. Return to the parking table and confirm the permanent plate.
5. Print the pass and export CSV; confirm both contain it.
6. Confirm no registration email delivery was created.
7. Restore the test record through the same audited workflow if needed.

Expected: all read surfaces agree, one audit entry exists, status/payment/signatures are unchanged, and no email was sent.

- [ ] **Step 7: Run final verification and commit deployment metadata**

```powershell
npm run lint
npm run check:migrations
npx vitest run --maxWorkers=1
npm run build
git diff --check
git status --short
git add src/security/__tests__/edgeFunctionInventory.test.js supabase/functions/DEPLOYED_BASELINES.md
git commit -m "docs: record registration edit function deployment"
```

Expected: every check PASS and the worktree is clean after commit.

- [ ] **Step 8: Review without publishing or merging**

```powershell
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: the branch contains the approved design, focused implementation commits, and exact deployment metadata. Do not push, open a PR, or merge unless separately requested.


# Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn a public registrant before a same-email, same-event registration is repeated within 10 minutes, while making exact request retries idempotent and preserving an explicit path for another person or vehicle.

**Architecture:** The browser sends a stable submission-attempt UUID and an explicit recent-registration override through the existing Turnstile-protected Edge Function. The trusted handler checks attempt idempotency first, then performs a sanitized recent-registration lookup before insertion; an additive unique database column provides the final same-attempt race guard. The React form recognizes only the sanitized `recent_registration` response, renders a focused accessible dialog, and obtains a fresh Turnstile token before an approved continuation.

**Tech Stack:** React 19, Vitest and Testing Library, Supabase Edge Functions on Deno, Supabase JavaScript client/PostgREST, PostgreSQL migrations, Cloudflare Turnstile, Tailwind CSS.

---

## Source of Truth

- Approved design: `docs/superpowers/specs/2026-08-07-repeat-submission-warning-design.md`
- Public form: `src/components/EventRegistrationForm.jsx`
- Trusted request reconstruction: `supabase/functions/_shared/registration-request.ts`
- Public submission boundary: `supabase/functions/submit-registration/handler.ts`
- Edge Function bootstrap: `supabase/functions/submit-registration/index.ts`

Do not use IP addresses, names, phone numbers, vehicle fields, signature records, or arbitrary answer similarity for duplicate matching. Do not add office contact details, automatic corrections, replacement, merge, or cancellation behavior.

## Current Supabase Contract Check

- The official Supabase changelog was reviewed on 2026-08-07. Its current breaking-change notices do not invalidate this additive-column design or the existing service-role submission boundary.
- The official CLI workflow documents `npx supabase migration new <name>` as the command that creates the timestamped migration file; this plan therefore captures the generated path instead of inventing a version.
- The official database documentation confirms PostgREST JSON arrow selectors, including text extraction with `->>`, which supports the planned normalized `form_data->>system_email` filter.

## File Map

- Create through `npx supabase migration new add_registration_submission_attempt`: the exact CLI-generated migration path, bound to `$migrationPath` immediately after generation. Do not invent or preselect the 14-digit version.
- Create `src/security/__tests__/registrationSubmissionAttemptMigration.test.js`: attempt-column, active recent-lookup index, and permission-regression coverage.
- Modify `supabase/functions/_shared/registration-request.ts`: accept the current-client attempt/override pair, normalize the cached-legacy shape, and retain the exact-key request boundary.
- Modify `supabase/functions/_shared/registration-request.test.ts`: request-shape, legacy compatibility, malformed-pair, and normalization coverage.
- Modify `supabase/functions/submit-registration/handler.ts`: attempt lookup, recent-registration lookup, sanitized `409`, insert-race recovery, and safe failure behavior.
- Modify `supabase/functions/submit-registration/handler.test.ts`: server query and outcome coverage.
- Create `src/services/registrationSubmission.js`: decode the sanitized Edge Function error envelope without coupling UI code to Supabase error classes.
- Create `src/services/__tests__/registrationSubmission.test.js`: response-decoding coverage.
- Create `src/components/RecentRegistrationDialog.jsx`: approved copy, context-aware continuation action, focus containment, Escape handling, and safe return action.
- Create `src/components/__tests__/RecentRegistrationDialog.test.jsx`: copy and accessibility contract.
- Modify `src/components/EventRegistrationForm.jsx`: stable attempt lifecycle, warning state, fresh-Turnstile continuation, error classification, and dialog integration.
- Modify `src/components/__tests__/EventRegistrationForm.test.jsx`: request contract, state preservation, override, Turnstile, retry, and attempt-rotation coverage.

### Task 1: Add the Database Attempt Identifier and Recent-Lookup Index

**Files:**
- Create via Supabase CLI: `$migrationPath`, the one exact path printed by `npx supabase migration new add_registration_submission_attempt`
- Create: `src/security/__tests__/registrationSubmissionAttemptMigration.test.js`

- [ ] **Step 1: Write the failing migration-contract test**

Create `src/security/__tests__/registrationSubmissionAttemptMigration.test.js` with this complete contract. It discovers the CLI-generated filename by its fixed suffix, so the test remains exact without inventing a Supabase migration version.

```js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const migrationNames = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('_add_registration_submission_attempt.sql'));
const migrationName = migrationNames[0];
const sql = migrationName
    ? readFileSync(path.join(migrationsDirectory, migrationName), 'utf8')
    : '';

describe('registration submission attempt migration', () => {
    it('has exactly one generated migration file', () => {
        expect(migrationNames).toHaveLength(1);
        expect(migrationName).toMatch(/^\d{14}_add_registration_submission_attempt\.sql$/);
    });

    it('adds a generated non-null UUID and a named uniqueness constraint', () => {
        expect(sql).toMatch(
            /alter table public\.registrations[\s\S]*add column submission_attempt_id uuid not null default gen_random_uuid\(\)/i,
        );
        expect(sql).toMatch(
            /add constraint registrations_submission_attempt_id_key\s+unique\s*\(submission_attempt_id\)/i,
        );
    });

    it('indexes the active same-event normalized-email time-window lookup', () => {
        expect(sql).toMatch(
            /create index registrations_recent_active_email_idx\s+on public\.registrations\s*\(\s*org_id\s*,\s*event_id\s*,\s*\(\(form_data->>'system_email'\)\)\s*,\s*created_at desc\s*\)\s*where status in \('pending', 'confirmed', 'waitlisted'\)/i,
        );
    });

    it('does not broaden registration-table access', () => {
        expect(sql).not.toMatch(/grant\s+(?:insert|select|update|delete|all)[\s\S]*\b(?:anon|authenticated)\b/i);
        expect(sql).not.toMatch(/disable row level security/i);
        expect(sql).not.toMatch(/drop policy/i);
    });
});
```

- [ ] **Step 2: Run the migration test and verify the expected failure**

Run:

```powershell
npx vitest run src/security/__tests__/registrationSubmissionAttemptMigration.test.js --maxWorkers=1
```

Expected: FAIL because no migration ending in `_add_registration_submission_attempt.sql` exists.

- [ ] **Step 3: Generate the migration through the Supabase CLI**

Discover the installed command first, then generate the file. Do not manually choose a version.

```powershell
npx supabase migration new --help
npx supabase migration new add_registration_submission_attempt
$migrationPath = (Get-ChildItem 'supabase\migrations\*_add_registration_submission_attempt.sql' | Sort-Object Name -Descending | Select-Object -First 1).FullName
$migrationPath
```

Expected: `$migrationPath` resolves to one newly generated file with a 14-digit version greater than the existing migrations.

- [ ] **Step 4: Add the minimal additive schema contract**

Replace the generated migration's comment-only body with exactly:

```sql
ALTER TABLE public.registrations
  ADD COLUMN submission_attempt_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_submission_attempt_id_key
  UNIQUE (submission_attempt_id);

CREATE INDEX registrations_recent_active_email_idx
  ON public.registrations (
    org_id,
    event_id,
    ((form_data->>'system_email')),
    created_at DESC
  )
  WHERE status IN ('pending', 'confirmed', 'waitlisted');
```

The authorized partial composite expression index matches the handler's equality filters first, its creation-time range last, and only the three active statuses used by the warning query. Do not add grants, policies, triggers, functions, an IP index, or any broader JSON index. PostgreSQL evaluates the generated UUID default for existing rows and retains it for admin/CSV inserts that omit the new column.

- [ ] **Step 5: Verify the migration contract and repository migration rules**

Run:

```powershell
npx vitest run src/security/__tests__/registrationSubmissionAttemptMigration.test.js --maxWorkers=1
npm run check:migrations
```

Expected: both commands PASS; the migration checker reports one additional valid pending migration.

- [ ] **Step 6: Commit the database boundary**

```powershell
git add -- src/security/__tests__/registrationSubmissionAttemptMigration.test.js
git add -- (Get-ChildItem 'supabase\migrations\*_add_registration_submission_attempt.sql' | Select-Object -ExpandProperty FullName)
git commit -m "feat: identify registration submission attempts"
```

### Task 2: Extend the Trusted Public Request Contract

**Files:**
- Modify: `supabase/functions/_shared/registration-request.ts:12-18,52-59,112-141`
- Modify: `supabase/functions/_shared/registration-request.test.ts:1-90`

- [ ] **Step 1: Add failing tests for current and cached-legacy request shapes**

Add a fixed attempt UUID to `baseRequest`:

```ts
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';

const baseRequest = {
  turnstileToken: 'verified-token',
  eventId: EVENT_ID,
  orgId: ORG_ID,
  formData: {
    system_email: 'person@example.com',
    name: 'Person Example',
    attendance: 'Sunday',
    updates: true,
    interests: ['Music'],
  },
  paymentMethod: null,
  signatureRecords: [{
    waiverId: 'waiver-1',
    declined: false,
    consentToESign: true,
    signerName: 'Person Example',
    signatureMethod: 'draw',
    signatureData: 'data:image/png;base64,c2lnbmF0dXJl',
  }],
  submissionAttemptId: ATTEMPT_ID,
  recentDuplicateOverride: false,
};
```

Replace the current exact-shape test and add the compatibility/error cases:

```ts
it('accepts the current public request shape', () => {
  expect(parseRegistrationRequest(baseRequest)).toEqual(baseRequest);
});

it('normalizes the cached-legacy shape only when both new fields are absent', () => {
  const { submissionAttemptId, recentDuplicateOverride, ...legacyRequest } = baseRequest;

  expect(parseRegistrationRequest(legacyRequest)).toEqual({
    ...legacyRequest,
    submissionAttemptId: null,
    recentDuplicateOverride: false,
  });
});

it('rejects malformed or incomplete attempt contracts', () => {
  expect(() => parseRegistrationRequest({ ...baseRequest, submissionAttemptId: 'not-a-uuid' }))
    .toThrow('invalid_request');
  expect(() => parseRegistrationRequest({ ...baseRequest, recentDuplicateOverride: 'yes' }))
    .toThrow('invalid_request');

  const { recentDuplicateOverride, ...missingOverride } = baseRequest;
  expect(() => parseRegistrationRequest(missingOverride)).toThrow('invalid_request');

  const { submissionAttemptId, ...overrideWithoutAttempt } = baseRequest;
  expect(() => parseRegistrationRequest(overrideWithoutAttempt)).toThrow('invalid_request');
});
```

Also extend the authoritative insert test to prove email normalization remains the matching contract:

```ts
const result = buildRegistrationInsert(baseEvent, {
  ...baseRequest,
  formData: { ...baseRequest.formData, system_email: '  PERSON@Example.COM ' },
}, metadata);

expect(result.form_data.system_email).toBe('person@example.com');
```

- [ ] **Step 2: Run the shared request tests and verify they fail**

```powershell
npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1
```

Expected: FAIL because the new top-level keys are rejected and the parsed type lacks the normalized compatibility fields.

- [ ] **Step 3: Implement the exact current/legacy parser contract**

Add the two keys to `TOP_LEVEL_KEYS`:

```ts
const TOP_LEVEL_KEYS = new Set([
  'turnstileToken',
  'eventId',
  'orgId',
  'formData',
  'paymentMethod',
  'signatureRecords',
  'submissionAttemptId',
  'recentDuplicateOverride',
]);
```

Extend `RegistrationRequest`:

```ts
export interface RegistrationRequest {
  turnstileToken: string;
  eventId: string;
  orgId: string;
  formData: Record<string, unknown>;
  paymentMethod: string | null;
  signatureRecords: SignatureDecision[];
  submissionAttemptId: string | null;
  recentDuplicateOverride: boolean;
}
```

In `parseRegistrationRequest`, validate that the two new keys are both present or both absent, and return normalized internal fields:

```ts
const hasSubmissionAttemptId = Object.hasOwn(value, 'submissionAttemptId');
const hasRecentDuplicateOverride = Object.hasOwn(value, 'recentDuplicateOverride');
if (hasSubmissionAttemptId !== hasRecentDuplicateOverride) invalidRequest();

const {
  turnstileToken,
  eventId,
  orgId,
  formData,
  paymentMethod,
  signatureRecords,
  submissionAttemptId,
  recentDuplicateOverride,
} = value;

if (
  typeof turnstileToken !== 'string' || !turnstileToken || turnstileToken.length > MAX_TOKEN_LENGTH ||
  !isUuid(eventId) || !isUuid(orgId) ||
  !isRecord(formData) || !Array.isArray(signatureRecords) ||
  (paymentMethod !== null && typeof paymentMethod !== 'string') ||
  (hasSubmissionAttemptId && !isUuid(submissionAttemptId)) ||
  (hasRecentDuplicateOverride && typeof recentDuplicateOverride !== 'boolean')
) {
  invalidRequest();
}

return {
  turnstileToken,
  eventId,
  orgId,
  formData,
  paymentMethod,
  signatureRecords: signatureRecords as SignatureDecision[],
  submissionAttemptId: hasSubmissionAttemptId ? submissionAttemptId as string : null,
  recentDuplicateOverride: hasRecentDuplicateOverride ? recentDuplicateOverride as boolean : false,
};
```

Do not accept a client-supplied status, timestamp, prior registration ID, normalized email, or IP address.

- [ ] **Step 4: Run the shared request tests**

```powershell
npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1
```

Expected: PASS, including the existing request-size, event, answer, waiver, signature-metadata, and payment tests.

- [ ] **Step 5: Commit the request contract**

```powershell
git add -- supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-request.test.ts
git commit -m "feat: validate registration attempt requests"
```

### Task 3: Enforce Idempotency and the Recent-Registration Warning Server-Side

**Files:**
- Modify: `supabase/functions/submit-registration/handler.ts:17-47,82-181`
- Modify: `supabase/functions/submit-registration/handler.test.ts:4-212`

- [ ] **Step 1: Rebuild the handler test fixture around reusable registration lookup chains**

Update the handler test constants so the trusted system email and current-client contract are used everywhere:

```ts
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const requestBody = {
  turnstileToken: 'browser-response-token',
  eventId: EVENT_ID,
  orgId: ORG_ID,
  formData: { system_email: 'Person@Example.com' },
  paymentMethod: null,
  signatureRecords: [],
  submissionAttemptId: ATTEMPT_ID,
  recentDuplicateOverride: false,
};

const event = {
  id: EVENT_ID,
  org_id: ORG_ID,
  status: 'active',
  registration_close_date: null,
  payment_enabled: false,
  allow_in_person_payment: false,
  tithely_giving_url: null,
  tithely_embed_config: null,
  form_fields: [{ id: 'system_email', type: 'email', required: true, system: true }],
  waivers: [],
};
```

Replace `makeAdminClient` with a fixture that exposes distinct queued registration lookup results and records every filter call. Use one self-returning lookup chain so `.eq()`, `.in()`, `.gte()`, and `.limit()` can be asserted without imitating PostgREST internals in every test:

```ts
function makeAdminClient({
  eventData = event,
  eventError = null,
  lookupResults = [],
  insertData = created,
  insertError = null,
} = {}) {
  const eventSingle = vi.fn(async () => ({ data: eventData, error: eventError }));
  const eventEq2 = vi.fn(() => ({ single: eventSingle }));
  const eventEq1 = vi.fn(() => ({ eq: eventEq2 }));
  const eventSelect = vi.fn(() => ({ eq: eventEq1 }));

  const maybeSingle = vi.fn();
  lookupResults.forEach((result) => maybeSingle.mockResolvedValueOnce(result));
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const lookupChain = {
    eq: vi.fn(() => lookupChain),
    in: vi.fn(() => lookupChain),
    gte: vi.fn(() => lookupChain),
    limit: vi.fn(() => lookupChain),
    maybeSingle,
  };
  const registrationSelect = vi.fn(() => lookupChain);

  const insertSingle = vi.fn(async () => ({ data: insertData, error: insertError }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const from = vi.fn((table: string) => table === 'events'
    ? { select: eventSelect }
    : { select: registrationSelect, insert });

  return {
    client: { from },
    mocks: {
      from,
      eventSelect,
      lookupChain,
      maybeSingle,
      registrationSelect,
      insert,
      insertSingle,
    },
  };
}
```

Inject `attemptId: () => '66666666-6666-4666-8666-666666666666'` and advance the fixed handler clock to `2026-08-07T12:00:00.000Z` in `setup`.

- [ ] **Step 2: Add failing idempotency and warning tests**

Add exact cases for attempt replay, the recent lookup, override, legacy compatibility, lookup failure, conflict, and insert-race recovery. The central assertions are:

```ts
it('returns an existing same-scope attempt before checking recency or inserting', async () => {
  const existing = { ...created, event_id: EVENT_ID, org_id: ORG_ID };
  const { handler, mocks } = setup({
    lookupResults: [{ data: existing, error: null }],
  });

  const response = await handler(post());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(created);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  expect(mocks.insert).not.toHaveBeenCalled();
});

it('returns a sanitized warning for a recent active same-email registration', async () => {
  const { handler, log, mocks } = setup({
    lookupResults: [
      { data: null, error: null },
      { data: { id: 'recent-registration' }, error: null },
    ],
  });

  const response = await handler(post());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: 'recent_registration',
    requestId: 'request-123',
  });
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('org_id', ORG_ID);
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('form_data->>system_email', 'person@example.com');
  expect(mocks.lookupChain.in).toHaveBeenCalledWith('status', ['pending', 'confirmed', 'waitlisted']);
  expect(mocks.lookupChain.gte).toHaveBeenCalledWith('created_at', '2026-08-07T11:50:00.000Z');
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it('allows an explicit override without bypassing trusted insertion', async () => {
  const { handler, mocks } = setup({
    lookupResults: [{ data: null, error: null }],
  });

  const response = await handler(post({ ...requestBody, recentDuplicateOverride: true }));

  expect(response.status).toBe(200);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    submission_attempt_id: ATTEMPT_ID,
    form_data: { system_email: 'person@example.com' },
  }));
});

it('keeps cached legacy clients compatible without emitting an unreadable warning', async () => {
  const { submissionAttemptId, recentDuplicateOverride, ...legacyBody } = requestBody;
  const { handler, mocks } = setup({
    lookupResults: [{ data: null, error: null }],
  });

  const response = await handler(post(legacyBody));

  expect(response.status).toBe(200);
  expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    submission_attempt_id: '66666666-6666-4666-8666-666666666666',
  }));
});
```

Add the remaining outcomes explicitly:

```ts
it('fails closed when the attempt lookup fails', async () => {
  const { handler, log, mocks } = setup({
    lookupResults: [{ data: null, error: { message: 'private lookup detail' } }],
  });

  const response = await handler(post());

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    error: 'submission_failed',
    requestId: 'request-123',
  });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'attempt_lookup_failed' }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('private lookup detail');
});

it('rejects an attempt identifier already used by another scope', async () => {
  const { handler, mocks } = setup({
    lookupResults: [{
      data: { ...created, event_id: '77777777-7777-4777-8777-777777777777', org_id: ORG_ID },
      error: null,
    }],
  });

  const response = await handler(post());

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: 'invalid_request',
    requestId: 'request-123',
  });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it('inserts once when the attempt and recent-registration lookups are empty', async () => {
  const { handler, mocks } = setup({
    lookupResults: [
      { data: null, error: null },
      { data: null, error: null },
    ],
  });

  const response = await handler(post());

  expect(response.status).toBe(200);
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('org_id', ORG_ID);
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
  expect(mocks.lookupChain.eq).toHaveBeenCalledWith('form_data->>system_email', 'person@example.com');
  expect(mocks.lookupChain.in).toHaveBeenCalledWith('status', ['pending', 'confirmed', 'waitlisted']);
  expect(mocks.lookupChain.gte).toHaveBeenCalledWith('created_at', '2026-08-07T11:50:00.000Z');
  expect(mocks.lookupChain.limit).toHaveBeenCalledWith(1);
  expect(mocks.insert).toHaveBeenCalledTimes(1);
});

it('fails closed when the recent-registration lookup fails', async () => {
  const { handler, log, mocks } = setup({
    lookupResults: [
      { data: null, error: null },
      { data: null, error: { message: 'private recent detail' } },
    ],
  });

  const response = await handler(post());

  expect(response.status).toBe(500);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({
    code: 'recent_registration_lookup_failed',
  }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('private recent detail');
});

it('recovers a same-attempt insert race without logging or inserting again', async () => {
  const existing = { ...created, event_id: EVENT_ID, org_id: ORG_ID };
  const { handler, log, mocks } = setup({
    lookupResults: [
      { data: null, error: null },
      { data: null, error: null },
      { data: existing, error: null },
    ],
    insertData: null,
    insertError: { message: 'unique violation detail' },
  });

  const response = await handler(post());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(created);
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'registration_insert_failed' }));
});

it('keeps an unrecovered insert failure generic and PII-free', async () => {
  const { handler, log } = setup({
    lookupResults: [
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ],
    insertData: null,
    insertError: { message: 'secret database detail' },
  });

  const response = await handler(post());
  const serializedLogs = JSON.stringify(log.mock.calls);

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    error: 'submission_failed',
    requestId: 'request-123',
  });
  expect(serializedLogs).toContain('registration_insert_failed');
  expect(serializedLogs).not.toContain('secret database detail');
  expect(serializedLogs).not.toContain('person@example.com');
  expect(serializedLogs).not.toContain('browser-response-token');
  expect(serializedLogs).not.toContain('203.0.113.10');
});
```

- [ ] **Step 3: Run the handler tests and verify they fail**

```powershell
npx vitest run supabase/functions/submit-registration/handler.test.ts --maxWorkers=1
```

Expected: FAIL because the handler has no registration lookup interface, attempt field, recent check, or race recovery.

- [ ] **Step 4: Add typed registration lookup support and public-result shaping**

In `handler.ts`, replace the insert-only registration interface with a self-returning filter contract:

```ts
type PublicRegistration = {
  id: unknown;
  event_id?: unknown;
  org_id?: unknown;
  status: unknown;
  payment_status: unknown;
  payment_method: unknown;
};

interface RegistrationFilterQuery {
  eq(column: string, value: string): RegistrationFilterQuery;
  in(column: string, values: string[]): RegistrationFilterQuery;
  gte(column: string, value: string): RegistrationFilterQuery;
  limit(count: number): RegistrationFilterQuery;
  maybeSingle(): QueryResult<PublicRegistration>;
}

interface RegistrationQuery {
  select(columns: string): RegistrationFilterQuery;
  insert(value: unknown): {
    select(columns: string): { single(): QueryResult<PublicRegistration> };
  };
}
```

Add these constants and helpers:

```ts
const PUBLIC_REGISTRATION_COLUMNS = 'id,event_id,org_id,status,payment_status,payment_method';
const ACTIVE_REGISTRATION_STATUSES = ['pending', 'confirmed', 'waitlisted'];
const RECENT_REGISTRATION_WINDOW_MS = 10 * 60 * 1000;

function publicRegistration(record: PublicRegistration): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    payment_status: record.payment_status,
    payment_method: record.payment_method,
  };
}

async function findAttempt(adminClient: RegistrationAdminClient, attemptId: string) {
  return await adminClient.from('registrations')
    .select(PUBLIC_REGISTRATION_COLUMNS)
    .eq('submission_attempt_id', attemptId)
    .limit(1)
    .maybeSingle();
}
```

Add the injectable attempt generator to `HandlerDependencies`:

```ts
attemptId?: () => string;
```

Default it beside the correlation-ID generator in `createSubmitRegistrationHandler`:

```ts
requestId = () => crypto.randomUUID(),
attemptId = () => crypto.randomUUID(),
```

- [ ] **Step 5: Implement the ordered attempt and recent-registration flow**

After loading the event, capture one server time and construct the trusted insert plus effective attempt ID:

```ts
const requestTime = now();
const legacyClient = request.submissionAttemptId === null;
const effectiveAttemptId = request.submissionAttemptId ?? attemptId();

let registrationInsert;
try {
  assertEventAcceptsRegistration(event, request, requestTime);
  registrationInsert = {
    ...buildRegistrationInsert(event, request, {
      ipAddress: trustedRequestIp(req),
      userAgent: req.headers.get('user-agent') || '',
      now: requestTime,
    }),
    submission_attempt_id: effectiveAttemptId,
  };
} catch (error) {
  const code = messageOf(error);
  if (code === 'registration_unavailable') {
    return errorResponse('registration_unavailable', 409, correlationId, origin);
  }
  return errorResponse('invalid_request', 400, correlationId, origin);
}
```

Then implement the approved order:

```ts
const attemptResult = await findAttempt(adminClient, effectiveAttemptId);
if (attemptResult.error) {
  log({ requestId: correlationId, code: 'attempt_lookup_failed', hostname: verification.hostname });
  return errorResponse('submission_failed', 500, correlationId, origin);
}
if (attemptResult.data) {
  if (attemptResult.data.event_id !== request.eventId || attemptResult.data.org_id !== request.orgId) {
    return errorResponse('invalid_request', 400, correlationId, origin);
  }
  return json(publicRegistration(attemptResult.data), 200, origin);
}

const normalizedEmail = registrationInsert.form_data.system_email;
if (typeof normalizedEmail !== 'string' || !normalizedEmail) {
  return errorResponse('invalid_request', 400, correlationId, origin);
}

if (!legacyClient && !request.recentDuplicateOverride) {
  const cutoff = new Date(requestTime.getTime() - RECENT_REGISTRATION_WINDOW_MS).toISOString();
  const recentResult = await adminClient.from('registrations')
    .select('id')
    .eq('org_id', request.orgId)
    .eq('event_id', request.eventId)
    .eq('form_data->>system_email', normalizedEmail)
    .in('status', ACTIVE_REGISTRATION_STATUSES)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle();

  if (recentResult.error) {
    log({ requestId: correlationId, code: 'recent_registration_lookup_failed', hostname: verification.hostname });
    return errorResponse('submission_failed', 500, correlationId, origin);
  }
  if (recentResult.data) {
    return errorResponse('recent_registration', 409, correlationId, origin);
  }
}
```

Replace the current insert block with the complete race-recovery flow:

```ts
const { data: createdRecord, error: insertError } = await adminClient.from('registrations')
  .insert(registrationInsert)
  .select(PUBLIC_REGISTRATION_COLUMNS)
  .single();

if (insertError || !createdRecord) {
  const recoveredAttempt = await findAttempt(adminClient, effectiveAttemptId);
  if (!recoveredAttempt.error && recoveredAttempt.data) {
    if (
      recoveredAttempt.data.event_id !== request.eventId ||
      recoveredAttempt.data.org_id !== request.orgId
    ) {
      return errorResponse('invalid_request', 400, correlationId, origin);
    }
    return json(publicRegistration(recoveredAttempt.data), 200, origin);
  }

  log({ requestId: correlationId, code: 'registration_insert_failed', hostname: verification.hostname });
  return errorResponse('submission_failed', 500, correlationId, origin);
}

return json(publicRegistration(createdRecord), 200, origin);
```

Do not inspect raw database error text to detect the race. Recovery succeeds only when the same unguessable attempt UUID can be reloaded in the same organization and event. Always shape successful responses through `publicRegistration` so attempt IDs and prior-row data never reach the browser.

- [ ] **Step 6: Run the server request and handler tests**

```powershell
npx vitest run supabase/functions/_shared/registration-request.test.ts supabase/functions/submit-registration/handler.test.ts --maxWorkers=1
```

Expected: PASS. Confirm the existing Siteverify failure test still proves no token, server secret, email, provider message, or database detail is logged.

- [ ] **Step 7: Commit the trusted server behavior**

```powershell
git add -- supabase/functions/submit-registration/handler.ts supabase/functions/submit-registration/handler.test.ts
git commit -m "feat: warn on recent registrations"
```

### Task 4: Decode Sanitized Submission Errors in One Client Boundary

**Files:**
- Create: `src/services/registrationSubmission.js`
- Create: `src/services/__tests__/registrationSubmission.test.js`

- [ ] **Step 1: Write the failing response-decoder tests**

Create `src/services/__tests__/registrationSubmission.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
    RECENT_REGISTRATION_ERROR,
    getRegistrationSubmissionErrorCode,
} from '../registrationSubmission';

describe('getRegistrationSubmissionErrorCode', () => {
    it('reads the sanitized Edge Function error envelope from a cloned response', async () => {
        const context = new Response(JSON.stringify({
            error: RECENT_REGISTRATION_ERROR,
            requestId: 'request-123',
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });

        await expect(getRegistrationSubmissionErrorCode({ context }))
            .resolves.toBe(RECENT_REGISTRATION_ERROR);
        await expect(context.json()).resolves.toEqual({
            error: RECENT_REGISTRATION_ERROR,
            requestId: 'request-123',
        });
    });

    it.each([
        null,
        {},
        { context: {} },
        { context: new Response('not json', { status: 500 }) },
        { context: new Response(JSON.stringify({ error: 42 }), { status: 500 }) },
    ])('returns null for an unreadable or malformed error context', async (error) => {
        await expect(getRegistrationSubmissionErrorCode(error)).resolves.toBeNull();
    });
});
```

- [ ] **Step 2: Run the decoder tests and verify the expected failure**

```powershell
npx vitest run src/services/__tests__/registrationSubmission.test.js --maxWorkers=1
```

Expected: FAIL because `registrationSubmission.js` does not exist.

- [ ] **Step 3: Implement the narrow decoder**

Create `src/services/registrationSubmission.js`:

```js
export const RECENT_REGISTRATION_ERROR = 'recent_registration';

export async function getRegistrationSubmissionErrorCode(error) {
    const response = error?.context;
    if (!response || typeof response.clone !== 'function') {
        return null;
    }

    try {
        const body = await response.clone().json();
        return typeof body?.error === 'string' ? body.error : null;
    } catch {
        return null;
    }
}
```

Do not decode or expose prior registration data. The helper returns only the sanitized string code.

- [ ] **Step 4: Run and commit the decoder**

```powershell
npx vitest run src/services/__tests__/registrationSubmission.test.js --maxWorkers=1
git add -- src/services/registrationSubmission.js src/services/__tests__/registrationSubmission.test.js
git commit -m "feat: decode registration submission outcomes"
```

Expected: test PASS, then one focused commit.

### Task 5: Build the Accessible Recent-Registration Dialog

**Files:**
- Create: `src/components/RecentRegistrationDialog.jsx`
- Create: `src/components/__tests__/RecentRegistrationDialog.test.jsx`

- [ ] **Step 1: Write failing copy and accessibility tests**

Create `src/components/__tests__/RecentRegistrationDialog.test.jsx` using the repository's `RecordPaymentDialog` accessibility expectations:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import RecentRegistrationDialog from '../RecentRegistrationDialog';

function renderDialog(eventType = 'standard') {
    const onReturn = vi.fn();
    const onContinue = vi.fn();
    render(
        <RecentRegistrationDialog
            eventType={eventType}
            onReturn={onReturn}
            onContinue={onContinue}
        />,
    );
    return { onReturn, onContinue };
}

describe('RecentRegistrationDialog', () => {
    it.each([
        ['standard', 'another person', 'Register another person'],
        ['parking', 'another vehicle', 'Register another vehicle'],
        ['future-type', 'another registration', 'Submit another registration'],
    ])('uses approved %s event wording', (eventType, subject, action) => {
        renderDialog(eventType);

        expect(screen.getByRole('dialog', { name: 'You recently registered' }))
            .toHaveAttribute('aria-modal', 'true');
        expect(screen.getByText(/within the last 10 minutes/i)).toBeInTheDocument();
        expect(screen.getByText(/contact the church office/i)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(subject, 'i'))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('focuses the safe action, traps Tab, and restores prior focus', async () => {
        const user = userEvent.setup();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const { unmount } = render(
            <RecentRegistrationDialog eventType="standard" onReturn={vi.fn()} onContinue={vi.fn()} />,
        );

        const safeAction = screen.getByRole('button', { name: 'Return to form' });
        const continueAction = screen.getByRole('button', { name: 'Register another person' });
        expect(safeAction).toHaveFocus();
        await user.tab({ shift: true });
        expect(continueAction).toHaveFocus();
        await user.tab();
        expect(safeAction).toHaveFocus();

        unmount();
        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('uses Escape and the safe button as Return, and calls Continue separately', async () => {
        const user = userEvent.setup();
        const { onReturn, onContinue } = renderDialog('parking');

        await user.keyboard('{Escape}');
        expect(onReturn).toHaveBeenCalledTimes(1);
        expect(onContinue).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Register another vehicle' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite the destination focus chosen by Continue', async () => {
        const user = userEvent.setup();
        const securityTarget = document.createElement('div');
        securityTarget.tabIndex = -1;
        document.body.append(securityTarget);
        const onContinue = vi.fn(() => securityTarget.focus());
        const { unmount } = render(
            <RecentRegistrationDialog
                eventType="standard"
                onReturn={vi.fn()}
                onContinue={onContinue}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Register another person' }));
        unmount();

        expect(onContinue).toHaveBeenCalledTimes(1);
        expect(securityTarget).toHaveFocus();
        securityTarget.remove();
    });
});
```

- [ ] **Step 2: Run the dialog tests and verify the expected failure**

```powershell
npx vitest run src/components/__tests__/RecentRegistrationDialog.test.jsx --maxWorkers=1
```

Expected: FAIL because the dialog component does not exist.

- [ ] **Step 3: Implement the approved dialog as a focused component**

Create `src/components/RecentRegistrationDialog.jsx` with the complete focused implementation below. It reuses the repository's `Button` and `Card` and the already-proven dialog focus pattern without introducing another UI dependency.

```jsx
import React, { useEffect, useRef } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';

function getEventWording(eventType) {
    if (eventType === 'parking') {
        return { subject: 'another vehicle', action: 'Register another vehicle' };
    }
    if (eventType === 'standard' || !eventType) {
        return { subject: 'another person', action: 'Register another person' };
    }
    return { subject: 'another registration', action: 'Submit another registration' };
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element instanceof HTMLElement && element.getAttribute('aria-hidden') !== 'true');
}

export default function RecentRegistrationDialog({ eventType, onReturn, onContinue }) {
    const returnButtonRef = useRef(null);
    const restoreFocusRef = useRef(true);
    const wording = getEventWording(eventType);

    useEffect(() => {
        const previouslyFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        returnButtonRef.current?.focus();

        return () => {
            if (restoreFocusRef.current && previouslyFocusedElement?.isConnected) {
                previouslyFocusedElement.focus();
            }
        };
    }, []);

    function handleContinue() {
        restoreFocusRef.current = false;
        onContinue();
    }

    function handleDialogKeyDown(event) {
        if (event.key === 'Escape') {
            onReturn();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }

        const focusableElements = getFocusableElements(event.currentTarget);
        const firstFocusableElement = focusableElements[0];
        const lastFocusableElement = focusableElements.at(-1);
        if (!firstFocusableElement || !lastFocusableElement) {
            return;
        }

        if (event.shiftKey && document.activeElement === firstFocusableElement) {
            event.preventDefault();
            lastFocusableElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
            event.preventDefault();
            firstFocusableElement.focus();
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <Card
                role="dialog"
                aria-modal="true"
                aria-labelledby="recent-registration-dialog-title"
                className="w-full max-w-lg p-6"
                onKeyDown={handleDialogKeyDown}
            >
                <h2 id="recent-registration-dialog-title" className="text-xl font-bold text-slate-900">
                    You recently registered
                </h2>
                <p className="mt-3 text-sm text-slate-600">
                    A registration using this email was submitted for this event within the last 10 minutes.
                    {' '}To correct an existing registration, please contact the church office.
                    {' '}If you are registering {wording.subject}, you may continue.
                </p>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={handleContinue}>
                        {wording.action}
                    </Button>
                    <Button ref={returnButtonRef} type="button" onClick={onReturn}>
                        Return to form
                    </Button>
                </div>
            </Card>
        </div>
    );
}
```

Do not close on backdrop clicks and do not add contact links.

- [ ] **Step 4: Run and commit the dialog tests**

```powershell
npx vitest run src/components/__tests__/RecentRegistrationDialog.test.jsx --maxWorkers=1
git add -- src/components/RecentRegistrationDialog.jsx src/components/__tests__/RecentRegistrationDialog.test.jsx
git commit -m "feat: add recent registration warning dialog"
```

Expected: tests PASS, including focus, Escape, exact context wording, and absence of contact links.

### Task 6: Integrate Attempt State, Warning, and Fresh Turnstile Continuation

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx:1-512`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx:1-521`

- [ ] **Step 1: Extend the successful-request test with the current client contract**

In `submits successfully and shows success state`, assert the two new fields and capture the attempt ID:

```jsx
const firstCallBody = supabase._mocks.mockInvoke.mock.calls[0]?.[1]?.body;
expect(firstCallBody).toEqual(expect.objectContaining({
    turnstileToken: 'verified-token',
    eventId: 'evt-1',
    orgId: 'org-1',
    submissionAttemptId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    recentDuplicateOverride: false,
}));
```

Run:

```powershell
npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx -t "submits successfully" --maxWorkers=1
```

Expected: FAIL because the form does not yet send either field.

- [ ] **Step 2: Add failing warning-preservation and safe-return tests**

Add a helper that creates the same sanitized error shape produced by Supabase Functions:

```jsx
function recentRegistrationError() {
    return {
        context: new Response(JSON.stringify({
            error: 'recent_registration',
            requestId: 'request-123',
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        }),
    };
}
```

Then add:

```jsx
it('preserves values and creates nothing when the user returns from a recent warning', async () => {
    setupMocks();
    supabase._mocks.mockInvoke.mockResolvedValueOnce({
        data: null,
        error: recentRegistrationError(),
    });
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByRole('dialog', { name: 'You recently registered' }))
        .toBeInTheDocument();
    expect(screen.getByDisplayValue('Jane')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText(/contact the church office/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Return to form' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
    expect(window.turnstile.reset).toHaveBeenCalledWith('widget-1');
});
```

- [ ] **Step 3: Add a failing parking continuation test with a fresh Turnstile token**

Replace the default Turnstile stub only for this test. Capture its callback and make reset supply a fresh token:

```jsx
it('continues a parking registration with the same attempt and a fresh Turnstile token', async () => {
    let turnstileCallback;
    window.turnstile.render.mockImplementation((_element, options) => {
        turnstileCallback = options.callback;
        options.callback('initial-token');
        return 'widget-1';
    });
    window.turnstile.reset.mockImplementation(() => turnstileCallback('fresh-token'));

    setupMocks(makeEvent({ event_type: 'parking' }));
    supabase._mocks.mockInvoke
        .mockResolvedValueOnce({ data: null, error: recentRegistrationError() })
        .mockResolvedValueOnce({
            data: {
                id: 'registration-2',
                status: 'confirmed',
                payment_status: 'not_required',
                payment_method: null,
            },
            error: null,
        });

    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Register another vehicle' }));

    await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(2));
    const firstBody = supabase._mocks.mockInvoke.mock.calls[0][1].body;
    const secondBody = supabase._mocks.mockInvoke.mock.calls[1][1].body;
    expect(secondBody).toEqual(expect.objectContaining({
        submissionAttemptId: firstBody.submissionAttemptId,
        recentDuplicateOverride: true,
        turnstileToken: 'fresh-token',
    }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
});
```

Add the fresh-verification failure case:

```jsx
it('retains values and stops when fresh Turnstile verification fails', async () => {
    let turnstileOptions;
    window.turnstile.render.mockImplementation((_element, options) => {
        turnstileOptions = options;
        options.callback('initial-token');
        return 'widget-1';
    });
    window.turnstile.reset.mockImplementation(() => turnstileOptions['error-callback']());

    setupMocks();
    supabase._mocks.mockInvoke.mockResolvedValueOnce({
        data: null,
        error: recentRegistrationError(),
    });
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Register another person' }));

    expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Security verification failed. Please try again.',
    );
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
});
```

Also cover the defensive case where the Turnstile widget cannot be reset:

```jsx
it('retains values and stops when fresh Turnstile verification is unavailable', async () => {
    setupMocks();
    supabase._mocks.mockInvoke.mockResolvedValueOnce({
        data: null,
        error: recentRegistrationError(),
    });
    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);

    await completeRequiredFields({ email: 'jane@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await screen.findByRole('dialog', { name: 'You recently registered' });
    window.turnstile.reset = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Register another person' }));

    expect(supabase._mocks.mockInvoke).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Security verification is unavailable. Please try again later.',
    );
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
});
```

- [ ] **Step 4: Add failing attempt-stability and rotation tests**

Cover both uncertain retry and a genuinely fresh form:

```jsx
it('keeps the attempt ID after a generic failure and changes it only for Register Another', async () => {
    setupMocks();
    supabase._mocks.mockInvoke
        .mockResolvedValueOnce({ data: null, error: { message: 'network failure' } })
        .mockResolvedValueOnce({
            data: {
                id: 'registration-1',
                status: 'confirmed',
                payment_status: 'not_required',
                payment_method: null,
            },
            error: null,
        })
        .mockResolvedValueOnce({
            data: {
                id: 'registration-2',
                status: 'confirmed',
                payment_status: 'not_required',
                payment_method: null,
            },
            error: null,
        });

    render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
    await completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    await screen.findByText(/failed to submit/i);

    window.turnstile.render.mock.calls[0][1].callback('retry-token');
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();

    const failedAttempt = supabase._mocks.mockInvoke.mock.calls[0][1].body.submissionAttemptId;
    const retryAttempt = supabase._mocks.mockInvoke.mock.calls[1][1].body.submissionAttemptId;
    expect(retryAttempt).toBe(failedAttempt);

    await userEvent.click(screen.getByRole('button', { name: 'Register Another' }));
    window.turnstile.render.mock.calls[0][1].callback('fresh-form-token');
    await completeRequiredFields({ email: 'another@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    const freshAttempt = supabase._mocks.mockInvoke.mock.calls[2][1].body.submissionAttemptId;
    expect(freshAttempt).not.toBe(failedAttempt);
});
```

If the existing Turnstile mock resets synchronously in this test, explicitly invoke the captured callback as shown; do not weaken production behavior to accommodate the mock.

- [ ] **Step 5: Run the focused form tests and verify they fail**

```powershell
npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

Expected: FAIL on missing request fields, missing dialog, missing error classification, and missing automatic fresh-token continuation.

- [ ] **Step 6: Add stable attempt and warning state to the form**

Import the focused units:

```jsx
import RecentRegistrationDialog from './RecentRegistrationDialog';
import {
    RECENT_REGISTRATION_ERROR,
    getRegistrationSubmissionErrorCode,
} from '../services/registrationSubmission';
```

Add state and refs beside the current Turnstile state:

```jsx
const [recentWarningOpen, setRecentWarningOpen] = useState(false);
const submissionAttemptId = useRef(crypto.randomUUID());
const pendingRecentOverride = useRef(false);
const performSubmissionRef = useRef(null);
```

On `eventId` or `orgId` change, rotate the attempt, clear pending override/warning state, and leave the existing event-fetch lifecycle intact:

```jsx
useEffect(() => {
    submissionAttemptId.current = crypto.randomUUID();
    pendingRecentOverride.current = false;
    setRecentWarningOpen(false);
}, [eventId, orgId]);
```

In `handleReset`, also run:

```jsx
submissionAttemptId.current = crypto.randomUUID();
pendingRecentOverride.current = false;
setRecentWarningOpen(false);
```

- [ ] **Step 7: Refactor submission execution without changing trusted payload construction**

Replace the submission side-effect portion of `handleSubmit` with this complete function. It moves the existing clean-form and signature-decision construction intact, adds the two trusted request properties, and classifies only the approved sanitized outcome:

```jsx
async function performSubmission(token, recentDuplicateOverride) {
    setSubmitting(true);

    try {
        const cleanFormData = {};
        for (const field of allVisibleFields) {
            if (formData[field.id] !== undefined) {
                cleanFormData[field.id] = formData[field.id];
            }
        }

        let signatureRecords = [];
        if (Array.isArray(event.waivers) && event.waivers.length > 0) {
            signatureRecords = event.waivers.map((waiver) => {
                const sig = signaturesMap[waiver.id] || {};
                if (sig.declined) {
                    return {
                        waiverId: waiver.id,
                        declined: true,
                    };
                }

                const decision = {
                    waiverId: waiver.id,
                    declined: false,
                    signerName: sig.signerName?.trim() || '',
                    signatureMethod: sig.signatureMethod || 'draw',
                    consentToESign: true,
                };
                if (decision.signatureMethod === 'draw') {
                    decision.signatureData = sig.signatureData;
                }
                return decision;
            });
        }

        const { data: created, error: insertError } = await supabase.functions.invoke(
            'submit-registration',
            {
                body: {
                    turnstileToken: token,
                    eventId,
                    orgId,
                    formData: cleanFormData,
                    paymentMethod: event.payment_enabled ? paymentMethod : null,
                    signatureRecords,
                    submissionAttemptId: submissionAttemptId.current,
                    recentDuplicateOverride,
                },
            },
        );

        if (insertError) {
            const errorCode = await getRegistrationSubmissionErrorCode(insertError);
            if (errorCode === RECENT_REGISTRATION_ERROR) {
                setTurnstileToken(null);
                setRecentWarningOpen(true);
                return;
            }
            throw insertError;
        }
        if (!created) {
            throw new Error('Registration was created without a returned record.');
        }

        setCreatedRegistration(created);
        const requiresTithelyPayment =
            created.status === 'confirmed'
            && created.payment_method === 'tithely';
        setPhase(requiresTithelyPayment ? 'payment' : 'success');
    } catch (error) {
        console.error('Error submitting registration:', error);
        setTurnstileToken(null);
        if (turnstileWidgetId.current !== null) {
            window.turnstile?.reset(turnstileWidgetId.current);
        }
        setErrors({ _form: 'Failed to submit registration. Please try again.' });
    } finally {
        setSubmitting(false);
    }
}
```

Do not call `console.error` or set the generic failure for `recent_registration`. Assign the latest function after its declaration:

```jsx
performSubmissionRef.current = performSubmission;
```

Keep the existing `handleSubmit` validation and Turnstile checks, remove its old duplicated side-effect block, and finish it with:

```jsx
await performSubmission(turnstileToken, false);
```

- [ ] **Step 8: Wire fresh Turnstile continuation and failure behavior**

Update the Turnstile callback inside `mountTurnstile`:

```jsx
callback: (token) => {
    setTurnstileToken(token);
    if (pendingRecentOverride.current) {
        pendingRecentOverride.current = false;
        void performSubmissionRef.current?.(token, true);
    }
},
'expired-callback': () => {
    setTurnstileToken(null);
    if (pendingRecentOverride.current) {
        pendingRecentOverride.current = false;
        setSubmitting(false);
        setErrors({ _form: 'Security verification expired. Please try again.' });
    }
},
'error-callback': () => {
    setTurnstileToken(null);
    if (pendingRecentOverride.current) {
        pendingRecentOverride.current = false;
        setSubmitting(false);
        setErrors({ _form: 'Security verification failed. Please try again.' });
    }
},
```

The safe return handler must close the dialog, clear override intent, reset Turnstile, and retain all form state:

```jsx
const handleRecentReturn = () => {
    setRecentWarningOpen(false);
    pendingRecentOverride.current = false;
    setTurnstileToken(null);
    if (turnstileWidgetId.current !== null) {
        window.turnstile?.reset(turnstileWidgetId.current);
    }
};
```

The continuation handler must close the dialog, mark the pending override, clear stale errors/token, focus the security container, and reset the widget:

```jsx
const handleRecentContinue = () => {
    setRecentWarningOpen(false);
    pendingRecentOverride.current = true;
    setErrors({});
    setTurnstileToken(null);
    setSubmitting(true);
    turnstileRef.current?.focus();

    const resetTurnstile = window.turnstile?.reset;
    if (turnstileWidgetId.current === null || typeof resetTurnstile !== 'function') {
        pendingRecentOverride.current = false;
        setSubmitting(false);
        setErrors({ _form: 'Security verification is unavailable. Please try again later.' });
        return;
    }

    resetTurnstile(turnstileWidgetId.current);
};
```

Give the Turnstile container `tabIndex="-1"` and `aria-label="Security verification"` so focus has a deterministic accessible target.

- [ ] **Step 9: Render the warning without disrupting the form**

Render this as a sibling after `FormPreview`, within the existing outer form container:

```jsx
{recentWarningOpen && (
    <RecentRegistrationDialog
        eventType={event.event_type}
        onReturn={handleRecentReturn}
        onContinue={handleRecentContinue}
    />
)}
```

The dialog must not clear `formData`, `signaturesMap`, `paymentMethod`, `currentPage`, or `submissionAttemptId`. The continuation still passes through Turnstile and the trusted Edge Function; it never inserts directly.

- [ ] **Step 10: Run the dialog, decoder, and public-form suites**

```powershell
npx vitest run src/services/__tests__/registrationSubmission.test.js src/components/__tests__/RecentRegistrationDialog.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

Expected: PASS. Confirm the existing signature test still sends decisions without client IP metadata, and all payment/waitlist routing tests remain green.

- [ ] **Step 11: Commit the browser integration**

```powershell
git add -- src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx
git commit -m "feat: confirm intentional repeat registrations"
```

### Task 7: Full Verification and Deployment Handoff

**Files:**
- Verify only; no new production mutation or deployment files.

- [ ] **Step 1: Run the focused feature suite serially**

```powershell
npx vitest run src/security/__tests__/registrationSubmissionAttemptMigration.test.js supabase/functions/_shared/registration-request.test.ts supabase/functions/submit-registration/handler.test.ts src/services/__tests__/registrationSubmission.test.js src/components/__tests__/RecentRegistrationDialog.test.jsx src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1
```

Expected: PASS with no skipped feature tests.

- [ ] **Step 2: Run repository migration validation**

```powershell
npm run check:migrations
npx supabase migration list --local
```

Expected: migration validation PASS; the CLI lists the generated submission-attempt migration as local/pending. If no local Supabase stack is running, record that environmental limitation and retain the passing SQL contract test and migration-directory validation; do not start, reset, link, or push a database without authorization.

- [ ] **Step 3: Run the complete test suite serially**

```powershell
npm run test:run -- --maxWorkers=1
```

Expected: PASS. Use the repository's established serial mode to avoid worker-start timeouts; do not mask failures by excluding tests.

- [ ] **Step 4: Run static and production-build checks**

```powershell
npm run lint
npm run build
```

Expected: both PASS with no new lint exclusions and a successful Vite production build.

- [ ] **Step 5: Review the exact change boundary**

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

Expected: only the approved migration, server request/handler files, focused client service/dialog/form files, their tests, and the approved spec/plan are present. There must be no office contact details, IP matching, automatic correction, new lint exclusions, secrets, deployment edits, or unrelated files.

- [ ] **Step 6: Stop before production actions and report the rollout order**

Report these separately gated production steps without executing them:

1. Apply the additive migration.
2. Deploy the backward-compatible `submit-registration` Edge Function.
3. Deploy the browser hosting revision.
4. With separate authorization and a designated test event, verify one warning/Return path, one explicit additional-registration path, and one same-attempt retry while accounting for capacity, confirmation email, and payment side effects.

Do not push, open a pull request, apply migrations, deploy functions/hosting, query additional production PII, create a real registration, send email, or merge without the user's separate authorization.

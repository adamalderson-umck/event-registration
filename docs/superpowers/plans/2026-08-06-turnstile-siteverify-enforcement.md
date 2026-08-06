# Turnstile Siteverify Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public registration fail closed unless Cloudflare Siteverify validates a token for the approved hostname and `event_registration` action, while preventing direct browser inserts.

**Architecture:** The React form sends an untrusted registration request to a public Supabase Edge Function. Pure validation helpers bound and reconstruct the request from the current event definition, the function verifies Turnstile at Cloudflare's fixed endpoint and inserts with the server credential, and a forward-only migration removes `INSERT` from browser roles.

**Tech Stack:** React 19, Vite, Vitest, Supabase Edge Functions on Deno 2, Supabase JavaScript client, PostgreSQL migrations, Cloudflare Turnstile Siteverify.

---

## File map

- Create `supabase/functions/_shared/registration-request.ts`: pure request, event-field, waiver, and response validation with no Deno or network dependencies.
- Create `supabase/functions/_shared/turnstile.ts`: fixed-destination Siteverify call, timeout, and response checks.
- Create `supabase/functions/submit-registration/index.ts`: HTTP/CORS boundary, event lookup, server-derived registration payload, insert, generic responses, and safe logging.
- Create `supabase/functions/_shared/registration-request.test.ts`: Vitest coverage for nested allowlists, size bounds, event/payment checks, and server-derived metadata.
- Create `supabase/functions/_shared/turnstile.test.ts`: Vitest coverage for accepted and rejected Siteverify results, timeout, malformed results, hostname, and action.
- Modify `supabase/config.toml`: declare `submit-registration` with `verify_jwt = false`.
- Modify `src/components/EventRegistrationForm.jsx`: include the Turnstile action, invoke the function, remove direct insert/IP capture, and reset the widget after failures.
- Modify `src/components/__tests__/EventRegistrationForm.test.jsx`: replace direct-insert expectations with Edge Function request/response assertions and preserve the initialization regression.
- Create `supabase/migrations/20260806070000_enforce_siteverify_registration_insert.sql`: drop the bypass policy and revoke direct browser `INSERT`.
- Create `src/security/__tests__/siteverifyRegistrationMigration.test.js`: assert the migration closes both the RLS-policy and grant paths.

### Task 1: Pure registration request validation

**Files:**
- Create: `supabase/functions/_shared/registration-request.ts`
- Test: `supabase/functions/_shared/registration-request.test.ts`

- [ ] **Step 1: Write failing tests for the untrusted request boundary**

Cover these exact outcomes with table-driven Vitest tests:

```ts
expect(() => parseRegistrationRequest({ ...valid, extra: true })).toThrow('invalid_request');
expect(() => parseRegistrationRequest({ ...valid, turnstileToken: 'x'.repeat(2049) })).toThrow('invalid_request');
expect(() => buildRegistrationInsert(event, { ...request, formData: { unknown: 'x' } }, metadata))
  .toThrow('invalid_request');
expect(() => buildRegistrationInsert(event, { ...request, signatureRecords: [signed, signed] }, metadata))
  .toThrow('invalid_request');
expect(buildRegistrationInsert(event, request, metadata)).toMatchObject({
  event_id: event.id,
  org_id: event.org_id,
  status: 'pending',
  payment_status: 'not_required',
  signature_records: [expect.objectContaining({
    waiverTitle: event.waivers[0].title,
    waiverContentHash: event.waivers[0].contentHash,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  })],
});
```

Also cover required fields, email and phone format, option allowlists, checkbox/checkbox-group types, maximum strings/arrays/signature data, inactive or closed events, invalid org/event pairing, invalid payment methods, required waiver refusal, unknown waiver IDs, and client metadata not surviving reconstruction.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1`

Expected: FAIL because `registration-request.ts` does not exist.

- [ ] **Step 3: Implement the pure validator and payload builder**

Export these stable interfaces:

```ts
export interface RegistrationRequest {
  turnstileToken: string;
  eventId: string;
  orgId: string;
  formData: Record<string, unknown>;
  paymentMethod: string | null;
  signatureRecords: SignatureDecision[];
}

export function parseRegistrationRequest(value: unknown): RegistrationRequest;
export function assertEventAcceptsRegistration(event: EventRecord, request: RegistrationRequest, now?: Date): void;
export function buildRegistrationInsert(
  event: EventRecord,
  request: RegistrationRequest,
  metadata: { ipAddress: string; userAgent: string; now?: Date },
): RegistrationInsert;
```

Use an exact top-level key set. Bound the JSON body to 1 MiB, token to 2,048 characters, ordinary strings to 4,096 characters, option arrays to 100 items, signer names/emails/user agents to 320/320/1,024 characters, drawn signatures to 512 KiB, fields to 200, and waivers to 50. Exclude `sectionBreak` definitions. Re-evaluate field conditions from already validated form values, reject unknown keys, validate select/radio/checkbox-group values against event options, and construct every stored object into a fresh object.

- [ ] **Step 4: Run the validator tests and verify GREEN**

Run: `npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1`

Expected: all request-validation tests PASS.

- [ ] **Step 5: Commit the validator boundary**

```powershell
git add -- supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-request.test.ts
git commit -m "feat: validate public registration requests"
```

### Task 2: Siteverify client and fail-closed Edge Function

**Files:**
- Create: `supabase/functions/_shared/turnstile.ts`
- Create: `supabase/functions/_shared/turnstile.test.ts`
- Create: `supabase/functions/submit-registration/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write failing Siteverify tests**

Inject `fetch` and cover these exact cases:

```ts
await expect(verifyTurnstile(validOptions)).resolves.toMatchObject({ hostname: 'events.kentmethodist.org' });
await expect(verifyTurnstile(options({ success: false, 'error-codes': ['invalid-input-response'] })))
  .rejects.toThrow('security_verification_failed');
await expect(verifyTurnstile(options({ success: true, hostname: 'evil.example', action: 'event_registration' })))
  .rejects.toThrow('security_verification_failed');
await expect(verifyTurnstile(options({ success: true, hostname: 'events.kentmethodist.org', action: 'other' })))
  .rejects.toThrow('security_verification_failed');
```

Also assert that the fetch destination is exactly Cloudflare Siteverify, the secret and response are form-encoded, the platform IP is optional, timeout/abort fails closed, non-2xx and malformed JSON fail closed, and no provider response is included in the thrown error.

- [ ] **Step 2: Run Siteverify tests and verify RED**

Run: `npx vitest run supabase/functions/_shared/turnstile.test.ts --maxWorkers=1`

Expected: FAIL because `turnstile.ts` does not exist.

- [ ] **Step 3: Implement the fixed Siteverify client**

```ts
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile({
  secret, token, remoteIp, expectedHostnames, expectedAction,
  fetchImpl = fetch, timeoutMs = 5000,
}: VerifyTurnstileOptions): Promise<TurnstileSuccess> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST', body, signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const result = response.ok ? await response.json() : null;
    if (!isAcceptedTurnstileResult(result, expectedHostnames, expectedAction)) {
      throw new Error('security_verification_failed');
    }
    return result;
  } catch {
    throw new Error('security_verification_failed');
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Implement the Edge Function HTTP boundary**

Configure `[functions.submit-registration] verify_jwt = false`. The function must:

```ts
if (req.method === 'OPTIONS') return corsPreflight(req);
if (req.method !== 'POST') return jsonError('method_not_allowed', 405, requestId, req);
if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
  return jsonError('invalid_request', 400, requestId, req);
}
```

Allow exact browser origins `https://events.kentmethodist.org`, `https://event-registration-b7840.web.app`, `http://localhost:5173`, and `http://127.0.0.1:5173`; send `Vary: Origin`; never use cookies or `Access-Control-Allow-Credentials`. Read only `cf-connecting-ip`/`x-forwarded-for` from platform headers. Require `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`, `TURNSTILE_ACTION`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Parse the body, verify Turnstile, load the event by both IDs, build a clean insert, and return only `id,status,payment_status,payment_method`.

Log only `{ requestId, code, hostname?, eventId? }`; never log request bodies, tokens, secrets, signatures, waiver content, authorization headers, or raw caught errors. Return stable generic errors and the correlation ID.

- [ ] **Step 5: Run Siteverify tests and type-check the function**

Run: `npx vitest run supabase/functions/_shared/turnstile.test.ts --maxWorkers=1`

Run: `npx supabase functions serve submit-registration --env-file supabase/.env.local --no-verify-jwt` only when local non-secret test configuration exists; otherwise run `deno check supabase/functions/submit-registration/index.ts` if Deno is installed and record the unavailable local-runtime limitation honestly.

Expected: unit tests PASS; the function type-checks or the missing local runtime is documented.

- [ ] **Step 6: Commit the server verification boundary**

```powershell
git add -- supabase/config.toml supabase/functions/_shared/turnstile.ts supabase/functions/_shared/turnstile.test.ts supabase/functions/submit-registration/index.ts
git commit -m "feat: verify Turnstile before registration inserts"
```

### Task 3: Route the React form through the trusted function

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`

- [ ] **Step 1: Rewrite submission expectations and verify RED**

Make `setupMocks` return successful `submit-registration` function data. Assert:

```js
expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith('submit-registration', {
  body: expect.objectContaining({
    turnstileToken: 'verified-token',
    eventId: 'evt-1',
    orgId: 'org-1',
    formData: expect.objectContaining({ system_email: 'john@example.com' }),
    signatureRecords: expect.any(Array),
  }),
});
expect(supabase._mocks.mockInsert).not.toHaveBeenCalled();
```

Add assertions that the widget uses `action: 'event_registration'`, a failed function response shows the generic retry message and calls `window.turnstile.reset(widgetId)`, and the already-written loading-to-container regression remains green.

Run: `npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1`

Expected: FAIL on the new invocation contract.

- [ ] **Step 2: Implement the browser integration**

Add `action: 'event_registration'` to `turnstile.render`. Send only token, IDs, cleaned visible form data, selected payment method, and minimal signature decisions/data to:

```js
const { data: created, error } = await supabase.functions.invoke('submit-registration', {
  body: {
    turnstileToken,
    eventId,
    orgId,
    formData: cleanFormData,
    paymentMethod: event.payment_enabled ? paymentMethod : null,
    signatureRecords,
  },
});
```

Remove browser-provided status/payment status, waiver titles/hashes/timestamps/IP/user agent, `capture-signer-ip`, and `.from('registrations').insert(...)`. On any submission failure, clear the token and call `window.turnstile?.reset(turnstileWidgetId.current)` before showing the generic retry message.

- [ ] **Step 3: Run the component tests and verify GREEN**

Run: `npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx --maxWorkers=1`

Expected: all form tests PASS.

- [ ] **Step 4: Commit the browser cutover**

```powershell
git add -- src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx
git commit -m "fix: submit registrations through Siteverify"
```

### Task 4: Remove the direct database bypass

**Files:**
- Create: `supabase/migrations/20260806070000_enforce_siteverify_registration_insert.sql`
- Create: `src/security/__tests__/siteverifyRegistrationMigration.test.js`

- [ ] **Step 1: Write and run the failing migration assertion**

```js
expect(sql).toMatch(/drop policy if exists "?registrations_insert_valid"? on public\.registrations/i);
expect(sql).toMatch(/revoke insert on table public\.registrations from anon, authenticated/i);
expect(sql).not.toMatch(/grant\s+insert[\s\S]+\b(?:anon|authenticated)\b/i);
```

Run: `npx vitest run src/security/__tests__/siteverifyRegistrationMigration.test.js --maxWorkers=1`

Expected: FAIL because the migration does not exist.

- [ ] **Step 2: Create the migration through the Supabase CLI and add the lockdown SQL**

Run `npx supabase migration new enforce_siteverify_registration_insert`; rename the generated file to the reserved path above if necessary, then write exactly:

```sql
DROP POLICY IF EXISTS "registrations_insert_valid" ON public.registrations;
REVOKE INSERT ON TABLE public.registrations FROM anon, authenticated;
```

- [ ] **Step 3: Validate migration and assertion**

Run: `npm run check:migrations`

Run: `npx vitest run src/security/__tests__/siteverifyRegistrationMigration.test.js --maxWorkers=1`

Expected: both PASS.

- [ ] **Step 4: Commit the database lockdown**

```powershell
git add -- supabase/migrations/20260806070000_enforce_siteverify_registration_insert.sql src/security/__tests__/siteverifyRegistrationMigration.test.js
git commit -m "fix: block direct public registration inserts"
```

### Task 5: Full verification and security diff review

**Files:**
- Modify only files required by failures found in this task.

- [ ] **Step 1: Run all Edge Function helper tests serially**

Run: `npx vitest run supabase/functions/_shared/registration-request.test.ts supabase/functions/_shared/turnstile.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 2: Run the complete application suite serially**

Run: `npx vitest run --dir src --maxWorkers=1`

Expected: all tests PASS.

- [ ] **Step 3: Run static and build gates**

Run: `npm run check:migrations`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Review the security diff**

Confirm from `git diff origin/main...HEAD` that no secret appears in browser code, all registration writes flow through `submit-registration`, Siteverify failures cannot reach insert, and the migration removes both policy and grant paths. Confirm no raw request/provider/database value is logged.

- [ ] **Step 5: Commit any verification-only correction**

Stage only files changed to correct a failed gate, then commit with a message naming that correction. Do not create an empty commit.

### Task 6: Publish a ready PR without merging

**Files:** None.

- [ ] **Step 1: Re-read branch status and commits**

Run: `git status --short --branch`

Run: `git log --oneline origin/main..HEAD`

Expected: only intended work remains and all implementation changes are committed.

- [ ] **Step 2: Push and create a non-draft PR**

Push `codex/fix-turnstile-initialization` and create a ready PR summarizing the live hostname correction, UI initialization fix, fail-closed Siteverify function, browser cutover, and direct-insert lockdown. Do not merge.

- [ ] **Step 3: Read back CI and PR state**

Report pending checks distinctly from passing checks. Address failures only within the approved change scope.

### Task 7: Production cutover after explicit merge authorization

**Files:** None unless a deployment defect requires a separately reviewed correction.

- [ ] **Step 1: Configure Supabase function secrets without exposing values**

Set `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES=events.kentmethodist.org,event-registration-b7840.web.app`, and `TURNSTILE_ACTION=event_registration` in the Supabase project. Never print, paste into logs, or commit the secret.

- [ ] **Step 2: Deploy and validate the function before client use**

Deploy `submit-registration` with JWT verification disabled. Send a malformed/missing-token request and confirm `403 security_verification_failed` with no insert.

- [ ] **Step 3: Await explicit PR merge authorization**

Do not merge based on this plan or successful checks alone.

- [ ] **Step 4: After authorized merge and frontend deployment, apply database lockdown immediately**

Confirm the deployed browser invokes `submit-registration`, then apply the migration. Prove an anonymous direct Data API insert is denied.

- [ ] **Step 5: Perform the selected valid registration control**

Use a user-approved production event because this creates a real registration and may trigger capacity, payment, and email side effects. Until that is approved and succeeds, call production validation partial.

## Self-review

- Spec coverage: every security invariant, fail-closed case, hostname/action check, nested allowlist, metadata derivation, database denial, test proof, deployment ordering, rollback rule, and no-merge rule maps to a task above.
- Placeholder scan: no `TBD`, `TODO`, “implement later,” or undefined follow-on task remains.
- Type consistency: browser camelCase request keys match `RegistrationRequest`; database snake_case keys exist only in the server-built `RegistrationInsert`; the response fields match current success/payment consumers.
- Explicit non-scope: CSP and waiver HTML sanitization remain separately reported rather than bundled into this registration-boundary PR.

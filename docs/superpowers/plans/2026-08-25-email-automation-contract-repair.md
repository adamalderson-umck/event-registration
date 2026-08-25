# Email Automation Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair confirmation and reminder automation so database callers and Edge Functions share one purpose-specific authentication contract, registration queries match the real schema, and the suite fails on either class of drift.

**Architecture:** PostgreSQL triggers and cron read `email_automation_secret` from Vault and send it in `x-email-automation-secret`; both handlers compare that header with `EMAIL_AUTOMATION_SECRET`. Supabase service credentials remain limited to the internal database client. Registration loading returns an explicit found/missing/error result and uses `created_at`, `cancelled_at`, and `promoted_at`, while repository tests cross-check function projections, migration schema, SQL callers, runtime entrypoints, and function configuration.

**Tech Stack:** Supabase PostgreSQL migrations, `pg_net`, `pg_cron`, Deno Edge Functions, TypeScript, JavaScript, Vitest 4, ESLint, Vite.

---

## File Map

- Modify `supabase/functions/_shared/email-automation.ts`: define and validate the dedicated automation header.
- Modify `supabase/functions/_shared/email-automation.test.ts`: prove the shared authentication boundary and preserve delivery-key coverage.
- Modify `supabase/functions/send-registration-email/handler.ts`: rename the authentication dependency, consume discriminated canonical-load results, and use real transition timestamps.
- Modify `supabase/functions/send-registration-email/handler.test.ts`: use the dedicated header and cover query-error versus missing-record behavior.
- Modify `supabase/functions/send-registration-email/send-registration-email.ts`: separate caller authentication from the admin database credential and return explicit load outcomes.
- Modify `supabase/functions/send-event-reminders/handler.ts`: use the dedicated authentication dependency.
- Modify `supabase/functions/send-event-reminders/handler.test.ts`: prove dedicated-header authentication.
- Modify `supabase/functions/send-event-reminders/index.ts`: load `EMAIL_AUTOMATION_SECRET` separately from the database client credential.
- Create `supabase/migrations/20260825160000_repair_email_automation_contract.sql`: replace registration triggers and reminder cron with the dedicated Vault/header contract.
- Create `src/security/__tests__/emailAutomationContractRepair.test.js`: cross-check migration callers, Edge Function entrypoints, and JWT configuration.
- Create `src/security/__tests__/registrationEmailSchemaContract.test.js`: compare every registration projection column with the migration-defined schema.
- Modify `src/security/__tests__/edgeFunctionInventory.test.js`: record both functions as pending deployment with `verify_jwt = false` without altering live-version assertions.
- Modify `supabase/config.toml`: allow the purpose-specific header to reach both handlers.
- Modify `tools/check-supabase-migrations.mjs`: register the forward migration only after it is actually deployed; do not change this file during local implementation.

## Task 1: Make the shared authentication test expose the current mismatch

**Files:**
- Modify: `supabase/functions/_shared/email-automation.test.ts`
- Modify: `supabase/functions/send-registration-email/handler.test.ts`
- Modify: `supabase/functions/send-event-reminders/handler.test.ts`

- [ ] **Step 1: Replace the shared authentication expectation with the dedicated header contract**

In `email-automation.test.ts`, replace the service-role bearer test with:

```ts
it("accepts only the exact dedicated automation secret", () => {
  const trusted = new Request("https://example.test", {
    headers: { "x-email-automation-secret": "automation-secret" },
  });
  const bearerOnly = new Request("https://example.test", {
    headers: { authorization: "Bearer automation-secret" },
  });
  const mismatched = new Request("https://example.test", {
    headers: { "x-email-automation-secret": "wrong-secret" },
  });

  expect(isTrustedAutomationRequest(trusted, "automation-secret")).toBe(true);
  expect(isTrustedAutomationRequest(bearerOnly, "automation-secret")).toBe(false);
  expect(isTrustedAutomationRequest(mismatched, "automation-secret")).toBe(false);
  expect(isTrustedAutomationRequest(trusted, "")).toBe(false);
});
```

- [ ] **Step 2: Change both handler fixtures to express the desired boundary**

Rename each fixture constant from `serviceRoleKey` to `automationSecret`, send `x-email-automation-secret`, and change each dependency fixture from `serviceRoleKey` to `automationSecret`. Keep an explicit bearer-only rejection case in each handler suite:

```ts
const automationSecret = "automation-secret";

headers: { "x-email-automation-secret": automationSecret }

// dependency fixture
automationSecret,

// rejection request
headers: { authorization: "Bearer automation-secret" }
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run supabase/functions/_shared/email-automation.test.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-event-reminders/handler.test.ts --maxWorkers=1
```

Expected: FAIL because the helper still reads `authorization` and the handler dependency types still require `serviceRoleKey`.

- [ ] **Step 4: Implement the minimal shared authentication change**

Change `email-automation.ts` to:

```ts
export const AUTOMATION_SECRET_HEADER = "x-email-automation-secret";

export function isTrustedAutomationRequest(
  request: Request,
  automationSecret: string,
): boolean {
  return automationSecret.length > 0 &&
    request.headers.get(AUTOMATION_SECRET_HEADER) === automationSecret;
}
```

In both handlers, rename the dependency field and call:

```ts
if (!isTrustedAutomationRequest(request, dependencies.automationSecret)) {
  return jsonResponse({ error: "unauthorized" }, 401);
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 3 command again.

Expected: all three files pass, with bearer-only requests rejected before repository work.

- [ ] **Step 6: Commit the shared authentication boundary**

```powershell
git add supabase/functions/_shared/email-automation.ts supabase/functions/_shared/email-automation.test.ts supabase/functions/send-registration-email/handler.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-event-reminders/handler.ts supabase/functions/send-event-reminders/handler.test.ts
git commit -m "fix: separate email automation authentication"
```

## Task 2: Cross-check database callers, entrypoints, and function configuration

**Files:**
- Create: `src/security/__tests__/emailAutomationContractRepair.test.js`
- Modify: `src/security/__tests__/edgeFunctionInventory.test.js`
- Create: `supabase/migrations/20260825160000_repair_email_automation_contract.sql`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/send-registration-email/send-registration-email.ts`
- Modify: `supabase/functions/send-event-reminders/index.ts`

- [ ] **Step 1: Write the cross-artifact contract test**

Create `emailAutomationContractRepair.test.js` with tests that locate the repair migration and fail cleanly when it is absent:

```js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrations = path.resolve(root, 'supabase/migrations');
const repairName = readdirSync(migrations)
  .find((name) => name.endsWith('_repair_email_automation_contract.sql'));
const repairSql = repairName
  ? readFileSync(path.join(migrations, repairName), 'utf8')
  : '';
const config = readFileSync(path.resolve(root, 'supabase/config.toml'), 'utf8');
const registrationIndex = readFileSync(
  path.resolve(root, 'supabase/functions/send-registration-email/send-registration-email.ts'),
  'utf8',
);
const reminderIndex = readFileSync(
  path.resolve(root, 'supabase/functions/send-event-reminders/index.ts'),
  'utf8',
);

function functionBlock(slug) {
  const start = config.indexOf(`[functions.${slug}]`);
  const end = config.indexOf('\n[', start + 1);
  return start < 0 ? '' : config.slice(start, end < 0 ? undefined : end);
}

describe('email automation caller contract repair', () => {
  it('adds one forward repair migration', () => {
    expect(repairName).toBe('20260825160000_repair_email_automation_contract.sql');
  });

  it('uses the dedicated Vault secret and header for triggers and cron', () => {
    expect(repairSql.match(/name\s*=\s*'email_automation_secret'/gi)).toHaveLength(3);
    expect(repairSql.match(/'x-email-automation-secret'/gi)).toHaveLength(3);
    expect(repairSql).not.toMatch(/name\s*=\s*'service_role_key'/i);
    expect(repairSql).not.toMatch(/'Authorization'\s*,\s*'Bearer '/i);
    expect(repairSql).toMatch(/'send-event-reminders'[\s\S]+?'0 \* \* \* \*'/i);
  });

  it('loads caller auth separately from the admin database credential', () => {
    for (const source of [registrationIndex, reminderIndex]) {
      expect(source).toMatch(/Deno\.env\.get\("EMAIL_AUTOMATION_SECRET"\)/);
      expect(source).toMatch(/automationSecret,/);
      expect(source).toMatch(/createClient\(supabaseUrl, serviceRoleKey/);
      expect(source).not.toMatch(/automationSecret:\s*serviceRoleKey/);
    }
  });

  it('disables gateway JWT verification for dedicated-secret handlers', () => {
    expect(functionBlock('send-registration-email')).toMatch(/verify_jwt\s*=\s*false/i);
    expect(functionBlock('send-event-reminders')).toMatch(/verify_jwt\s*=\s*false/i);
  });
});
```

- [ ] **Step 2: Mark the two source configurations as pending deployment**

In `edgeFunctionInventory.test.js`, set:

```js
const PENDING_DEPLOYMENT_FUNCTIONS = Object.freeze({
  'send-event-reminders': { verifyJwt: false },
  'send-registration-email': { verifyJwt: false },
});
```

Do not edit `DEPLOYED_FUNCTIONS`; it must continue reporting the observed live versions, hashes, and JWT settings until deployment is separately authorized and verified.

- [ ] **Step 3: Run the contract tests and verify RED**

Run:

```powershell
npx vitest run src/security/__tests__/emailAutomationContractRepair.test.js src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
```

Expected: FAIL because the forward migration is absent, both entrypoints lack `EMAIL_AUTOMATION_SECRET`, and both config blocks still have `verify_jwt = true`.

- [ ] **Step 4: Add the forward-only caller migration**

Create `20260825160000_repair_email_automation_contract.sql` with the complete forward-only replacement below:

```sql
CREATE OR REPLACE FUNCTION public.notify_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_automation_secret text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  SELECT decrypted_secret INTO v_automation_secret
  FROM vault.decrypted_secrets
  WHERE name = 'email_automation_secret';

  IF v_project_url IS NULL OR coalesce(v_automation_secret, '') = '' THEN
    RAISE WARNING 'Email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', v_automation_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'registration_id', NEW.id
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
  v_automation_secret text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  SELECT decrypted_secret INTO v_automation_secret
  FROM vault.decrypted_secrets
  WHERE name = 'email_automation_secret';

  IF v_project_url IS NULL OR coalesce(v_automation_secret, '') = '' THEN
    RAISE WARNING 'Email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', v_automation_secret
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'registration_id', NEW.id,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

SELECT cron.schedule(
  'send-event-reminders',
  '0 * * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-event-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_automation_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
```

- [ ] **Step 5: Separate authentication secrets in both entrypoints**

Keep `serviceRoleKey` exclusively for `createClient`. Add:

```ts
const automationSecret = Deno.env.get("EMAIL_AUTOMATION_SECRET") || "";
```

Pass `automationSecret` to each handler dependency object.

- [ ] **Step 6: Disable gateway JWT verification for the two functions**

Set only these blocks in `supabase/config.toml`:

```toml
[functions.send-event-reminders]
verify_jwt = false

[functions.send-registration-email]
verify_jwt = false
entrypoint = "./functions/send-registration-email/send-registration-email.ts"
```

- [ ] **Step 7: Run contract tests and migration validation**

Run:

```powershell
npx vitest run src/security/__tests__/emailAutomationContractRepair.test.js src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
npm run check:migrations
```

Expected: contract tests pass; migration validation reports all migration files valid. Do not add the new migration to `EXPECTED_APPLIED_MIGRATIONS`, because it has not been deployed.

- [ ] **Step 8: Commit caller and configuration alignment**

```powershell
git add supabase/config.toml supabase/migrations/20260825160000_repair_email_automation_contract.sql supabase/functions/send-registration-email/send-registration-email.ts supabase/functions/send-event-reminders/index.ts src/security/__tests__/emailAutomationContractRepair.test.js src/security/__tests__/edgeFunctionInventory.test.js
git commit -m "fix: align email automation callers"
```

## Task 3: Make schema drift and canonical query failures observable

**Files:**
- Create: `src/security/__tests__/registrationEmailSchemaContract.test.js`
- Modify: `supabase/functions/send-registration-email/handler.ts`
- Modify: `supabase/functions/send-registration-email/handler.test.ts`
- Modify: `supabase/functions/send-registration-email/send-registration-email.ts`

- [ ] **Step 1: Write the migration-to-query schema contract test**

Create `registrationEmailSchemaContract.test.js` that reads all non-test TypeScript files in `send-registration-email`, extracts the `.from("registrations").select(...)` projection, and compares it to the baseline table definition:

```js
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const functionDir = path.resolve(root, 'supabase/functions/send-registration-email');
const source = readdirSync(functionDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => readFileSync(path.join(functionDir, name), 'utf8'))
  .join('\n');
const baseline = readFileSync(
  path.resolve(root, 'supabase/migrations/20260806001553_require_verified_google_identity_email.sql'),
  'utf8',
);

const projection = source.match(
  /\.from\("registrations"\)[\s\S]*?\.select\(\s*"([^"]+)"\s*\)/,
)?.[1];
const tableBody = baseline.match(
  /CREATE TABLE IF NOT EXISTS "public"\."registrations" \(([\s\S]*?)\n\);/i,
)?.[1];

describe('registration email schema contract', () => {
  it('selects only migration-defined registration columns', () => {
    expect(projection, 'registration projection missing').toBeTruthy();
    expect(tableBody, 'registrations table definition missing').toBeTruthy();
    const selected = projection.split(',').map((column) => column.trim());
    const schemaColumns = new Set(
      [...tableBody.matchAll(/^\s*"([^"]+)"\s+/gm)].map((match) => match[1]),
    );
    expect(selected.filter((column) => !schemaColumns.has(column))).toEqual([]);
  });
});
```

- [ ] **Step 2: Add handler tests for real transition timestamps and load errors**

Replace fictional `updated_at` in the canonical fixture with:

```ts
cancelled_at: "2026-08-07T12:00:00Z",
promoted_at: "2026-08-07T13:00:00Z",
```

Change the default loader result to:

```ts
loadCanonicalDelivery: vi.fn(() => Promise.resolve({
  status: "found" as const,
  record: canonicalDelivery(),
})),
```

Add a database-error test:

```ts
it("returns an observable server error when canonical loading fails", async () => {
  const { dependencies } = testDependencies({
    loadCanonicalDelivery: vi.fn(async () => ({ status: "error" as const })),
  });
  const response = await handleRegistrationEmail(
    authorizedRequest({ type: "INSERT", registration_id: "registration-1" }),
    dependencies,
  );

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "canonical_load_failed" });
});
```

Update the existing missing-record test to return `{ status: "missing" as const }`. Assert cancellation and promotion delivery keys contain `cancelled_at` and `promoted_at`, not a generic update timestamp.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npx vitest run src/security/__tests__/registrationEmailSchemaContract.test.js supabase/functions/send-registration-email/handler.test.ts --maxWorkers=1
```

Expected: schema test reports `updated_at` as unknown, and handler tests fail because load results are not discriminated and transition keys still use `updated_at`.

- [ ] **Step 4: Implement discriminated canonical-load results**

In `handler.ts`, define:

```ts
export type CanonicalRegistrationLoadResult =
  | { status: "found"; record: CanonicalRegistrationDelivery }
  | { status: "missing" }
  | { status: "error" };
```

Change the dependency signature to return this type. Handle it before canonical consistency checks:

```ts
const loaded = await dependencies.loadCanonicalDelivery(parsed.registration_id);
if (loaded.status === "error") {
  return jsonResponse({ error: "canonical_load_failed" }, 500);
}
if (loaded.status === "missing") {
  return jsonResponse({ skipped: true, code: "canonical_record_missing" });
}
const record = loaded.record;
```

Replace `updated_at` in `CanonicalRegistration` with nullable `cancelled_at` and `promoted_at`. Use the state-specific value for each update delivery. If the required timestamp is missing, return a sanitized `canonical_record_mismatch` skip rather than fabricating an idempotency occurrence.

- [ ] **Step 5: Repair the production loader projection and error mapping**

In `send-registration-email.ts`, select:

```ts
"id, org_id, event_id, status, form_data, payment_method, payment_status, legacy_payment_paid, created_at, cancelled_at, promoted_at"
```

Return `{ status: "error" }` for registration, event, or organization query errors; `{ status: "missing" }` only for absent canonical rows; and `{ status: "found", record: { registration, event, organization } }` on success. Do not include raw database errors in responses or logs.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command again.

Expected: both files pass; no selected registration column is absent from the baseline schema, and query failures return HTTP 500.

- [ ] **Step 7: Commit schema and observability repair**

```powershell
git add src/security/__tests__/registrationEmailSchemaContract.test.js supabase/functions/send-registration-email/handler.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-registration-email/send-registration-email.ts
git commit -m "fix: enforce registration email schema contract"
```

## Task 4: Full repository verification and handoff

**Files:**
- Verify all files changed in Tasks 1-3
- Update only if required by verification: `docs/superpowers/specs/2026-08-25-email-automation-contract-repair-design.md`

- [ ] **Step 1: Run focused contract tests together**

```powershell
npx vitest run supabase/functions/_shared/email-automation.test.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-event-reminders/handler.test.ts src/security/__tests__/emailAutomationContractRepair.test.js src/security/__tests__/registrationEmailSchemaContract.test.js src/security/__tests__/edgeFunctionInventory.test.js --maxWorkers=1
```

Expected: all focused tests pass with no warnings or skipped failures.

- [ ] **Step 2: Run migration validation**

```powershell
npm run check:migrations
```

Expected: all migration files validate, and the new forward migration is not represented as already applied.

- [ ] **Step 3: Run the full serial suite**

```powershell
npx vitest run --maxWorkers=1
```

Expected: all test files and tests pass; compare counts with the 71-file/670-test baseline and account for the new tests.

- [ ] **Step 4: Run lint and production build**

```powershell
npm run lint
npm run build
```

Expected: both commands exit 0. Do not add or broaden lint exclusions.

- [ ] **Step 5: Audit the final diff for secrets, debug artifacts, and scope**

```powershell
git diff origin/main --check
git diff origin/main --stat
rg -n "\[DEBUG-|sb_secret_|eyJ[A-Za-z0-9_-]+\.eyJ" supabase src docs tools
git status --short --branch
```

Expected: no whitespace errors, no credential values, no debug instrumentation, and only the approved repair/spec/plan files differ from `origin/main`.

- [ ] **Step 6: Report local completion without publishing or deploying**

Report the branch, worktree, commit list, exact verification results, and these still-unverified production gates:

- provision matching `email_automation_secret` and `EMAIL_AUTOMATION_SECRET` values without printing them;
- migration dry run naming exactly `20260825160000_repair_email_automation_contract.sql`;
- deploy only `send-registration-email` and `send-event-reminders` with their intended JWT settings;
- perform no-email database-to-function and canonical-loader probes;
- verify new ledger outcomes;
- separately approve any missed-email replay.

Do not push, create a PR, merge, deploy, provision credentials, update the remote migration ledger, or replay email without explicit authorization for that separate action.

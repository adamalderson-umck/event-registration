# Automatic Registration Email Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded automatic retries and an administrator intervention workflow for failed registration confirmation, waitlist, promotion, and cancellation emails.

**Architecture:** The existing `email_deliveries` row remains authoritative. A five-minute Postgres cron queues exact delivery IDs to the existing `send-registration-email` function, which reloads the ledger and canonical registration before retrying the original delivery key. Authenticated RPCs expose a safe event-scoped status projection and queue exhausted manual retries; Registration Viewer renders that projection without direct browser access to the ledger.

**Tech Stack:** React 19, Vitest 4, Testing Library, Supabase Edge Functions on Deno, PostgreSQL 17, `pg_cron`, `pg_net`, Supabase Vault, Tailwind CSS.

---

## File and Responsibility Map

- Create `supabase/functions/_shared/registration-email-lifecycle.ts`: canonical lifecycle-kind, occurrence, key, and applicability helpers shared by retry handling.
- Create `supabase/functions/_shared/registration-email-lifecycle.test.ts`: direct behavior coverage for all lifecycle states and obsolete-key rejection.
- Modify `supabase/functions/send-registration-email/handler.ts`: parse trusted `RETRY` requests, load a delivery row, verify applicability, and compose only the exact delivery.
- Modify `supabase/functions/send-registration-email/handler.test.ts`: public handler retry behavior and negative cases.
- Modify `supabase/functions/send-registration-email/send-registration-email.ts`: real service-role loader for one delivery row.
- Modify `supabase/functions/send-registration-email/send-registration-email.test.ts`: loader projection and error contract.
- Create `src/security/__tests__/registrationEmailRetryMigration.test.js`: migration, schedule, allowlist, RPC, and grants contract.
- Create via Supabase CLI `supabase/migrations/*_automatic_registration_email_retries.sql`: cron plus safe status/manual-retry RPCs.
- Create `src/services/registrationEmailDelivery.js`: browser RPC adapter and stable client errors.
- Create `src/services/__tests__/registrationEmailDelivery.test.js`: exact RPC payload and sanitized error coverage.
- Create `src/components/RegistrationEmailDeliveryCard.jsx`: latest-status presentation and inline manual-retry confirmation.
- Create `src/components/__tests__/RegistrationEmailDeliveryCard.test.jsx`: sent, scheduled, pending, exhausted, no-record, and retry interaction coverage.
- Move `src/components/ParkingRegistrationActionsMenu.jsx` to `src/components/RegistrationActionsMenu.jsx`: generic accessible registration actions dropdown.
- Create `src/components/__tests__/RegistrationActionsMenu.test.jsx`: item filtering, selection, keyboard navigation, and focus restoration.
- Delete `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx` after generic coverage is green.
- Modify `src/components/ParkingRegistrationTable.jsx`: delivery badge and generic action menu.
- Modify `src/components/__tests__/ParkingRegistrationTable.test.jsx`: exhausted badge/retry action and preserved parking actions.
- Modify `src/components/RegistrationViewer.jsx`: status loading, polling, alert/filter, standard-row menu, detail section, and manual retry refresh.
- Modify `src/components/__tests__/RegistrationViewer.test.jsx`: event-level discovery and end-to-end administrator interaction.

## Task 1: Canonical lifecycle applicability helper

**Files:**
- Create: `supabase/functions/_shared/registration-email-lifecycle.ts`
- Test: `supabase/functions/_shared/registration-email-lifecycle.test.ts`

- [ ] **Step 1: Write the failing lifecycle helper tests**

Create `registration-email-lifecycle.test.ts` with one table covering the four supported states and focused negative cases:

```ts
import { describe, expect, it } from "vitest";
import {
  applicableRegistrationLifecycleDelivery,
  isRegistrationLifecycleKind,
  matchesApplicableRegistrationLifecycleDelivery,
} from "./registration-email-lifecycle.ts";

const registration = (overrides: Record<string, unknown> = {}) => ({
  id: "registration-1",
  status: "confirmed",
  created_at: "2026-08-01T12:00:00+00:00",
  promoted_at: null,
  cancelled_at: null,
  ...overrides,
});

describe("registration email lifecycle", () => {
  it.each([
    [registration(), "registration_confirmation", "2026-08-01T12:00:00+00:00"],
    [registration({ status: "waitlisted" }), "registration_waitlist", "2026-08-01T12:00:00+00:00"],
    [registration({ promoted_at: "2026-08-02T12:00:00+00:00" }), "waitlist_promotion", "2026-08-02T12:00:00+00:00"],
    [registration({ status: "cancelled", cancelled_at: "2026-08-03T12:00:00+00:00" }), "registration_cancellation", "2026-08-03T12:00:00+00:00"],
  ])("maps the canonical state to %s", (record, kind, occurrence) => {
    expect(applicableRegistrationLifecycleDelivery(record)).toEqual({
      kind,
      occurrence,
      deliveryKey: `${kind}:registration-1:${occurrence}`,
    });
  });

  it("returns no applicable delivery for incomplete states", () => {
    expect(applicableRegistrationLifecycleDelivery(
      registration({ status: "cancelled", cancelled_at: null }),
    )).toBeNull();
    expect(applicableRegistrationLifecycleDelivery(
      registration({ status: "pending" }),
    )).toBeNull();
  });

  it("accepts only registrant lifecycle kinds", () => {
    expect(isRegistrationLifecycleKind("registration_confirmation")).toBe(true);
    expect(isRegistrationLifecycleKind("registration_waitlist")).toBe(true);
    expect(isRegistrationLifecycleKind("waitlist_promotion")).toBe(true);
    expect(isRegistrationLifecycleKind("registration_cancellation")).toBe(true);
    expect(isRegistrationLifecycleKind("organizer_notification")).toBe(false);
    expect(isRegistrationLifecycleKind("event_reminder")).toBe(false);
  });

  it("rejects an obsolete key even when the registration and kind match", () => {
    expect(matchesApplicableRegistrationLifecycleDelivery({
      registration: registration({ promoted_at: "2026-08-02T12:00:00+00:00" }),
      delivery: {
        registration_id: "registration-1",
        kind: "waitlist_promotion",
        delivery_key: "waitlist_promotion:registration-1:2026-08-01T12:00:00+00:00",
      },
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run supabase/functions/_shared/registration-email-lifecycle.test.ts --maxWorkers=1
```

Expected: FAIL because `registration-email-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement the focused lifecycle helper**

Create `registration-email-lifecycle.ts`:

```ts
import { registrationDeliveryKey } from "./email-automation.ts";
import type { DeliveryKind } from "./email-delivery.ts";

export const REGISTRATION_LIFECYCLE_KINDS = [
  "registration_confirmation",
  "registration_waitlist",
  "waitlist_promotion",
  "registration_cancellation",
] as const satisfies readonly DeliveryKind[];

export type RegistrationLifecycleKind =
  typeof REGISTRATION_LIFECYCLE_KINDS[number];

export interface LifecycleRegistration {
  id: string;
  status: string;
  created_at: string;
  promoted_at: string | null;
  cancelled_at: string | null;
}

export interface LifecycleDeliveryRow {
  registration_id: string;
  kind: string;
  delivery_key: string;
}

export function isRegistrationLifecycleKind(
  value: string,
): value is RegistrationLifecycleKind {
  return REGISTRATION_LIFECYCLE_KINDS.includes(
    value as RegistrationLifecycleKind,
  );
}

export function applicableRegistrationLifecycleDelivery(
  registration: LifecycleRegistration,
): { kind: RegistrationLifecycleKind; occurrence: string; deliveryKey: string } | null {
  let kind: RegistrationLifecycleKind;
  let occurrence: string | null;

  if (registration.status === "cancelled") {
    kind = "registration_cancellation";
    occurrence = registration.cancelled_at;
  } else if (registration.status === "waitlisted") {
    kind = "registration_waitlist";
    occurrence = registration.created_at;
  } else if (registration.status === "confirmed" && registration.promoted_at) {
    kind = "waitlist_promotion";
    occurrence = registration.promoted_at;
  } else if (registration.status === "confirmed") {
    kind = "registration_confirmation";
    occurrence = registration.created_at;
  } else {
    return null;
  }

  if (!occurrence) return null;
  return {
    kind,
    occurrence,
    deliveryKey: registrationDeliveryKey(kind, registration.id, occurrence),
  };
}

export function matchesApplicableRegistrationLifecycleDelivery({
  registration,
  delivery,
}: {
  registration: LifecycleRegistration;
  delivery: LifecycleDeliveryRow;
}): boolean {
  const applicable = applicableRegistrationLifecycleDelivery(registration);
  return Boolean(
    applicable &&
      delivery.registration_id === registration.id &&
      delivery.kind === applicable.kind &&
      delivery.delivery_key === applicable.deliveryKey,
  );
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the helper**

```powershell
git add -- supabase/functions/_shared/registration-email-lifecycle.ts supabase/functions/_shared/registration-email-lifecycle.test.ts
git commit -m "feat: define registration email lifecycle"
```

## Task 2: Exact-delivery retry in the canonical handler

**Files:**
- Modify: `supabase/functions/send-registration-email/handler.ts`
- Modify: `supabase/functions/send-registration-email/handler.test.ts`

- [ ] **Step 1: Add failing public-handler retry tests**

Extend the handler fixtures with this exported shape:

```ts
const retryDelivery = (overrides = {}) => ({
  id: "delivery-1",
  delivery_key: "registration_confirmation:registration-1:2026-08-06T12:00:00Z",
  registration_id: "registration-1",
  kind: "registration_confirmation",
  state: "failed",
  attempt_count: 4,
  attempted_at: "2026-08-06T14:00:00Z",
  ...overrides,
});
```

Add `loadDelivery` to `testDependencies`, then add tests that:

```ts
it("retries one exact failed lifecycle delivery", async () => {
  const { dependencies, send } = testDependencies({
    loadDelivery: vi.fn(async () => ({ status: "found", delivery: retryDelivery() })),
  });
  const response = await handleRegistrationEmail(
    authorizedRequest({ type: "RETRY", delivery_id: "delivery-1" }),
    dependencies,
  );
  expect(send).toHaveBeenCalledOnce();
  expect(dependencies.deliver).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryKey: "registration_confirmation:registration-1:2026-08-06T12:00:00Z",
      kind: "registration_confirmation",
    }),
    expect.any(Function),
  );
  expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
});

it.each([
  ["organizer_notification", "not_retryable"],
  ["event_reminder", "not_retryable"],
])("does not retry %s", async (kind, code) => {
  const { dependencies, send } = testDependencies({
    loadDelivery: vi.fn(async () => ({
      status: "found",
      delivery: retryDelivery({ kind }),
    })),
  });
  const response = await handleRegistrationEmail(
    authorizedRequest({ type: "RETRY", delivery_id: "delivery-1" }),
    dependencies,
  );
  expect(send).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ skipped: true, code });
});

it("does not retry an obsolete lifecycle key", async () => {
  const record = canonicalDelivery();
  record.registration.status = "confirmed";
  record.registration.promoted_at = "2026-08-07T13:00:00Z";
  const { dependencies, send } = testDependencies({
    loadCanonicalDelivery: vi.fn(async () => found(record)),
    loadDelivery: vi.fn(async () => ({ status: "found", delivery: retryDelivery() })),
  });
  const response = await handleRegistrationEmail(
    authorizedRequest({ type: "RETRY", delivery_id: "delivery-1" }),
    dependencies,
  );
  expect(send).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ skipped: true, code: "not_applicable" });
});
```

Also cover missing delivery, loader error, already-sent delivery, fresh pending returning `in_progress`, malformed retry body, and a cancellation retry that does not create a cancel URL.

- [ ] **Step 2: Run the handler tests and verify RED**

```powershell
npx vitest run supabase/functions/send-registration-email/handler.test.ts --maxWorkers=1
```

Expected: FAIL because `RETRY` and `loadDelivery` are not part of the handler contract.

- [ ] **Step 3: Add the retry request and delivery-load contracts**

Use a discriminated request union and sanitized loader result:

```ts
export type RegistrationEmailRequest =
  | { type: "INSERT"; registration_id: string }
  | { type: "UPDATE"; registration_id: string; old_status: string; new_status: string }
  | { type: "RETRY"; delivery_id: string };

export interface RegistrationEmailDeliveryRecord {
  id: string;
  delivery_key: string;
  registration_id: string;
  kind: DeliveryKind;
  state: "pending" | "sent" | "failed";
  attempt_count: number;
  attempted_at: string;
}

export type RegistrationEmailDeliveryLoadResult =
  | { status: "found"; delivery: RegistrationEmailDeliveryRecord }
  | { status: "missing" }
  | { status: "error" };
```

Add `loadDelivery(deliveryId)` to `RegistrationEmailDependencies`. Update `parseRequestBody` so `RETRY` requires only a nonblank `delivery_id`; preserve the existing INSERT and UPDATE validation exactly.

Use this retry parser branch before the existing INSERT/UPDATE branch:

```ts
if (body.type === "RETRY") {
  if (typeof body.delivery_id !== "string" || !body.delivery_id.trim()) {
    return null;
  }
  return { type: "RETRY", delivery_id: body.delivery_id };
}
```

- [ ] **Step 4: Implement exact retry resolution before normal delivery building**

Import the Task 1 helper. For `RETRY`:

```ts
const deliveryLoad = await dependencies.loadDelivery(parsed.delivery_id);
if (deliveryLoad.status === "error") {
  return jsonResponse({ error: "delivery_load_failed" }, 500);
}
if (deliveryLoad.status === "missing") {
  return jsonResponse({ skipped: true, code: "delivery_missing" });
}
const retryDelivery = deliveryLoad.delivery;
if (!isRegistrationLifecycleKind(retryDelivery.kind)) {
  return jsonResponse({ skipped: true, code: "not_retryable" });
}
if (retryDelivery.state === "sent") {
  return jsonResponse({
    success: true,
    sent: 0,
    already_sent: 1,
    in_progress: 0,
    failed: 0,
    skipped: 0,
  });
}
```

Load the canonical registration using `retryDelivery.registration_id`. Require `matchesApplicableRegistrationLifecycleDelivery(...)`. Convert the applicable kind to an internal existing request:

```ts
function requestForLifecycleRetry(
  delivery: RegistrationEmailDeliveryRecord,
): RegistrationEmailRequest {
  if (delivery.kind === "waitlist_promotion") {
    return {
      type: "UPDATE",
      registration_id: delivery.registration_id,
      old_status: "waitlisted",
      new_status: "confirmed",
    };
  }
  if (delivery.kind === "registration_cancellation") {
    return {
      type: "UPDATE",
      registration_id: delivery.registration_id,
      old_status: "confirmed",
      new_status: "cancelled",
    };
  }
  return { type: "INSERT", registration_id: delivery.registration_id };
}
```

Call `buildLogicalDeliveries`, then retain only the delivery whose kind and reconstructed key match the selected ledger row. Return `not_applicable` if exactly one match is not found. Continue through the existing delivery loop unchanged so the delivery store remains the only claim/complete/fail implementation.

- [ ] **Step 5: Run handler tests and verify GREEN**

Run the Step 2 command. Expected: PASS with all existing handler tests unchanged.

- [ ] **Step 6: Commit handler retry behavior**

```powershell
git add -- supabase/functions/send-registration-email/handler.ts supabase/functions/send-registration-email/handler.test.ts
git commit -m "feat: retry exact registration emails"
```

## Task 3: Real delivery loader at the Edge entrypoint

**Files:**
- Modify: `supabase/functions/send-registration-email/send-registration-email.ts`
- Modify: `supabase/functions/send-registration-email/send-registration-email.test.ts`

- [ ] **Step 1: Write failing entrypoint tests**

Generalize the hoisted query fixture to distinguish `registrations` and `email_deliveries`. Add a retry request and assert the exact projection:

```ts
const expectedDeliveryProjection =
  "id, delivery_key, registration_id, kind, state, attempt_count, attempted_at";

it("loads the retry delivery through the service-role client", async () => {
  query.state.deliveryResult = { data: null, error: null };
  const response = await servedHandler(retryRequest("delivery-1"));
  expect(response.status).toBe(200);
  expect(query.from).toHaveBeenCalledWith("email_deliveries");
  expect(query.select).toHaveBeenCalledWith(expectedDeliveryProjection);
  expect(query.eq).toHaveBeenCalledWith("id", "delivery-1");
  expect(await response.json()).toEqual({
    skipped: true,
    code: "delivery_missing",
  });
});
```

Add the query-error case expecting HTTP 500 and `{ error: "delivery_load_failed" }`.

- [ ] **Step 2: Run the entrypoint tests and verify RED**

```powershell
npx vitest run supabase/functions/send-registration-email/send-registration-email.test.ts --maxWorkers=1
```

Expected: FAIL because the entrypoint does not provide `loadDelivery`.

- [ ] **Step 3: Implement `loadDelivery`**

Add a loader parallel to `loadCanonicalDelivery`:

```ts
async function loadDelivery(
  deliveryId: string,
): Promise<RegistrationEmailDeliveryLoadResult> {
  const { data, error } = await client.from("email_deliveries")
    .select(
      "id, delivery_key, registration_id, kind, state, attempt_count, attempted_at",
    )
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) return { status: "error" };
  if (!data) return { status: "missing" };
  return {
    status: "found",
    delivery: data as RegistrationEmailDeliveryRecord,
  };
}
```

Pass `loadDelivery` to `handleRegistrationEmail` and import the new types from `handler.ts`.

- [ ] **Step 4: Run entrypoint and handler suites**

```powershell
npx vitest run supabase/functions/send-registration-email/send-registration-email.test.ts supabase/functions/send-registration-email/handler.test.ts --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit the real loader**

```powershell
git add -- supabase/functions/send-registration-email/send-registration-email.ts supabase/functions/send-registration-email/send-registration-email.test.ts
git commit -m "feat: load retry delivery records"
```

## Task 4: Retry cron and safe administrator RPCs

**Files:**
- Create: `src/security/__tests__/registrationEmailRetryMigration.test.js`
- Create via CLI: `supabase/migrations/*_automatic_registration_email_retries.sql`

- [ ] **Step 1: Write the failing migration contract test**

The test must locate exactly one filename ending `_automatic_registration_email_retries.sql` and assert:

```js
expect(sql).toMatch(/retry-registration-lifecycle-emails/i);
expect(sql).toMatch(/'\*\/5 \* \* \* \*'/);
expect(sql).toMatch(/attempt_count\s*<\s*4/i);
expect(sql).toMatch(/limit\s+10/i);
expect(sql).toMatch(/timeout_milliseconds\s*:=\s*30000/i);
expect(sql).toMatch(/'type'\s*,\s*'RETRY'/i);
expect(sql).toMatch(/'delivery_id'\s*,\s*[^\n]+\.id/i);
expect(sql.match(/'registration_confirmation'|'registration_waitlist'|'waitlist_promotion'|'registration_cancellation'/g))
  .toBeTruthy();
expect(sql).not.toMatch(/kind\s*=\s*'organizer_notification'/i);
expect(sql).not.toMatch(/kind\s*=\s*'event_reminder'/i);
expect(sql).toMatch(/create or replace function public\.get_registration_email_delivery_statuses/i);
expect(sql).toMatch(/create or replace function public\.retry_registration_email_delivery/i);
expect(sql).toMatch(/private\.is_org_member\(p_org_id\)/i);
expect(sql).toMatch(/revoke all on function[\s\S]+from public/i);
expect(sql).toMatch(/revoke all on function[\s\S]+from anon/i);
expect(sql).toMatch(/grant execute on function[\s\S]+to authenticated/i);
```

Also assert the status return columns, sanitized-code-only projection, exact key construction with `to_jsonb(timestamp)#>>'{}'`, the 5m/30m/2h cases, 15-minute pending lease, exhausted manual guard, Vault secret/header, and no table grant to `authenticated`.

- [ ] **Step 2: Run the migration test and verify RED**

```powershell
npx vitest run src/security/__tests__/registrationEmailRetryMigration.test.js --maxWorkers=1
```

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Create the migration with the Supabase CLI**

```powershell
npx supabase migration new automatic_registration_email_retries
$migrationFile = (Get-ChildItem -LiteralPath 'supabase/migrations' -Filter '*_automatic_registration_email_retries.sql').FullName
$migrationFile
```

Expected: exactly one CLI-generated path. Use that returned path for every edit and validation below; do not rename it or invent a timestamp.

- [ ] **Step 4: Implement the event-scoped status RPC**

In the generated migration, create `get_registration_email_delivery_statuses(p_org_id uuid, p_event_id uuid)` as `SECURITY DEFINER SET search_path TO ''`. It returns the exact columns approved in the design. Its query must:

1. Reject a null `auth.uid()` and nonmembers unless the trusted JWT role is exactly `service_role`.
2. Select only registrations matching both IDs.
3. Compute applicable kind and occurrence with one CASE expression.
4. Build the expected key as `kind || ':' || registration_id || ':' || (to_jsonb(occurrence)#>>'{}')`.
5. Left-join only the matching ledger row.
6. Compute `next_retry_at` with 5m/30m/2h and the 15-minute pending minimum.
7. Compute `exhausted` as `state = 'failed' AND attempt_count >= 4`.

The return signature is:

```sql
RETURNS TABLE (
  registration_id uuid,
  delivery_id uuid,
  kind text,
  state text,
  attempt_count integer,
  last_error_code text,
  attempted_at timestamptz,
  sent_at timestamptz,
  next_retry_at timestamptz,
  exhausted boolean
)
```

- [ ] **Step 5: Implement the manual retry RPC**

Create `retry_registration_email_delivery(p_org_id uuid, p_registration_id uuid, p_delivery_id uuid) RETURNS jsonb`. It must verify membership, ownership, current applicable kind/key, `state='failed'`, and `attempt_count >= 4`, then load `project_url` and `email_automation_secret` from Vault and queue:

```sql
PERFORM net.http_post(
  url := v_project_url || '/functions/v1/send-registration-email',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-email-automation-secret', v_automation_secret
  ),
  body := jsonb_build_object(
    'type', 'RETRY',
    'delivery_id', p_delivery_id
  ),
  timeout_milliseconds := 30000
);
RETURN jsonb_build_object('ok', true, 'code', 'queued');
```

Return stable non-sensitive codes for not found, not applicable, not exhausted, and configuration unavailable. Do not return delivery keys or Vault values.

- [ ] **Step 6: Implement the bounded cron query**

Unschedule an existing job with the same name before scheduling `*/5 * * * *`. The job command must use CTEs named `applicable`, `due`, and `configuration`; select only exact applicable keys; use the approved failure delays; apply `GREATEST(delay, interval '15 minutes')` to pending rows; order by `attempted_at`; limit 10; and call the same Edge payload shown in Step 5.

- [ ] **Step 7: Lock down function execution**

For both RPC signatures:

```sql
REVOKE ALL ON FUNCTION public.<signature> FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<signature> TO authenticated, service_role;
```

Do not grant browser roles any privilege on `public.email_deliveries`.

The migration implementation should use one private SQL helper so cron and both RPCs cannot drift on lifecycle applicability:

```sql
CREATE OR REPLACE FUNCTION private.registration_lifecycle_delivery(
  p_registration_id uuid,
  p_status text,
  p_created_at timestamptz,
  p_promoted_at timestamptz,
  p_cancelled_at timestamptz
)
RETURNS TABLE(kind text, delivery_key text)
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT lifecycle.kind,
         lifecycle.kind || ':' || p_registration_id::text || ':' ||
           (pg_catalog.to_jsonb(lifecycle.occurrence) #>> '{}')
  FROM (
    SELECT
      CASE
        WHEN p_status = 'cancelled' AND p_cancelled_at IS NOT NULL
          THEN 'registration_cancellation'
        WHEN p_status = 'waitlisted'
          THEN 'registration_waitlist'
        WHEN p_status = 'confirmed' AND p_promoted_at IS NOT NULL
          THEN 'waitlist_promotion'
        WHEN p_status = 'confirmed'
          THEN 'registration_confirmation'
        ELSE NULL
      END AS kind,
      CASE
        WHEN p_status = 'cancelled' THEN p_cancelled_at
        WHEN p_status = 'confirmed' AND p_promoted_at IS NOT NULL THEN p_promoted_at
        WHEN p_status IN ('confirmed', 'waitlisted') THEN p_created_at
        ELSE NULL
      END AS occurrence
  ) lifecycle
  WHERE lifecycle.kind IS NOT NULL
    AND lifecycle.occurrence IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION private.registration_lifecycle_delivery(
  uuid, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.registration_lifecycle_delivery(
  uuid, text, timestamptz, timestamptz, timestamptz
) TO service_role;
```

Use this expression consistently for retry timing:

```sql
CASE d.attempt_count
  WHEN 1 THEN interval '5 minutes'
  WHEN 2 THEN interval '30 minutes'
  WHEN 3 THEN interval '2 hours'
  ELSE NULL
END
```

For pending rows, wrap it with:

```sql
pg_catalog.greatest(
  CASE d.attempt_count
    WHEN 1 THEN interval '5 minutes'
    WHEN 2 THEN interval '30 minutes'
    WHEN 3 THEN interval '2 hours'
  END,
  interval '15 minutes'
)
```

The cron candidate core must be structurally equivalent to:

```sql
WITH applicable AS (
  SELECT d.id, d.state, d.attempt_count, d.attempted_at
  FROM public.email_deliveries d
  JOIN public.registrations r ON r.id = d.registration_id
  CROSS JOIN LATERAL private.registration_lifecycle_delivery(
    r.id, r.status, r.created_at, r.promoted_at, r.cancelled_at
  ) lifecycle
  WHERE d.kind = lifecycle.kind
    AND d.delivery_key = lifecycle.delivery_key
    AND d.kind IN (
      'registration_confirmation',
      'registration_waitlist',
      'waitlist_promotion',
      'registration_cancellation'
    )
    AND d.state IN ('failed', 'pending')
    AND d.attempt_count < 4
), due AS (
  SELECT id
  FROM applicable
  WHERE attempted_at + CASE
    WHEN state = 'pending' THEN pg_catalog.greatest(
      CASE attempt_count
        WHEN 1 THEN interval '5 minutes'
        WHEN 2 THEN interval '30 minutes'
        WHEN 3 THEN interval '2 hours'
      END,
      interval '15 minutes'
    )
    ELSE CASE attempt_count
      WHEN 1 THEN interval '5 minutes'
      WHEN 2 THEN interval '30 minutes'
      WHEN 3 THEN interval '2 hours'
    END
  END <= pg_catalog.now()
  ORDER BY attempted_at
  LIMIT 10
), configuration AS (
  SELECT
    max(decrypted_secret) FILTER (WHERE name = 'project_url') AS project_url,
    max(decrypted_secret) FILTER (
      WHERE name = 'email_automation_secret'
    ) AS automation_secret
  FROM vault.decrypted_secrets
)
SELECT net.http_post(
  url := configuration.project_url || '/functions/v1/send-registration-email',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-email-automation-secret', configuration.automation_secret
  ),
  body := jsonb_build_object('type', 'RETRY', 'delivery_id', due.id),
  timeout_milliseconds := 30000
)
FROM due
CROSS JOIN configuration
WHERE configuration.project_url IS NOT NULL
  AND coalesce(configuration.automation_secret, '') <> '';
```

The status RPC and manual RPC must both join through the same private helper and require `d.delivery_key = lifecycle.delivery_key`; do not replace this with registration ID plus kind alone.

Both `SECURITY DEFINER` RPCs use this exact caller gate before reading protected rows:

```sql
IF coalesce((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END IF;
```

Do not use user metadata, caller-supplied roles, or `current_user` for this decision.

- [ ] **Step 8: Run migration contract and ledger checks**

```powershell
npx vitest run src/security/__tests__/registrationEmailRetryMigration.test.js src/security/__tests__/eventEmailMigration.test.js src/security/__tests__/emailAutomationContractRepair.test.js --maxWorkers=1
npm run check:migrations
```

Expected: PASS and migration ledger valid.

- [ ] **Step 9: Run rollback-only SQL validation**

Use the repository's established targeted validation when `supabase db reset --local` hits the known internal bootstrap collision. In a transaction, create fixture organization/event/registrations/deliveries, execute the migration, assert the four applicable states, the three due boundaries, the batch cap, obsolete exclusion, and exhausted projection, then `ROLLBACK`. Store only the reusable validator under `tools/` if the test cannot execute the SQL directly; do not connect it to production.

- [ ] **Step 10: Commit migration and contract**

```powershell
git add -- src/security/__tests__/registrationEmailRetryMigration.test.js supabase/migrations/*_automatic_registration_email_retries.sql
git commit -m "feat: schedule registration email retries"
```

## Task 5: Browser RPC service

**Files:**
- Create: `src/services/registrationEmailDelivery.js`
- Test: `src/services/__tests__/registrationEmailDelivery.test.js`

- [ ] **Step 1: Write failing service tests**

Mock `supabase.rpc` and assert exact calls:

```js
await listRegistrationEmailDeliveryStatuses('org-1', 'event-1');
expect(rpc).toHaveBeenCalledWith('get_registration_email_delivery_statuses', {
  p_org_id: 'org-1',
  p_event_id: 'event-1',
});

await retryRegistrationEmailDelivery({
  orgId: 'org-1',
  registrationId: 'registration-1',
  deliveryId: 'delivery-1',
});
expect(rpc).toHaveBeenCalledWith('retry_registration_email_delivery', {
  p_org_id: 'org-1',
  p_registration_id: 'registration-1',
  p_delivery_id: 'delivery-1',
});
```

Require the list function to return a `Map` keyed by registration ID and map database failures to `email_status_failed`; require retry rejections to preserve the stable RPC `code` and network failures to become `email_retry_failed`.

- [ ] **Step 2: Run service tests and verify RED**

```powershell
npx vitest run src/services/__tests__/registrationEmailDelivery.test.js --maxWorkers=1
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Use the existing coded-error pattern. The list method calls the status RPC and returns `new Map((data || []).map(row => [row.registration_id, row]))`. The retry method throws when RPC data is missing or `{ ok: false }`; it returns `{ ok: true, code: 'queued' }` only for the approved response.

- [ ] **Step 4: Run service tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the service**

```powershell
git add -- src/services/registrationEmailDelivery.js src/services/__tests__/registrationEmailDelivery.test.js
git commit -m "feat: add registration email delivery service"
```

## Task 6: Generic accessible registration actions menu

**Files:**
- Move: `src/components/ParkingRegistrationActionsMenu.jsx` to `src/components/RegistrationActionsMenu.jsx`
- Create: `src/components/__tests__/RegistrationActionsMenu.test.jsx`
- Delete: `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx`
- Modify: `src/components/ParkingRegistrationTable.jsx`
- Modify: `src/components/__tests__/ParkingRegistrationTable.test.jsx`

- [ ] **Step 1: Write failing generic-menu tests**

Create `RegistrationActionsMenu.test.jsx` with the current keyboard/outside-click assertions expressed through the generic `items` contract. The first render is:

```jsx
<RegistrationActionsMenu
  items={[
    { label: 'View', onSelect: onView },
    { label: 'Retry failed email', onSelect: onRetry, enabled: false },
  ]}
/>
```

Assert only enabled items render, selection closes the menu, ArrowUp/ArrowDown/Home/End work, Escape restores trigger focus, outside pointer closes it, and `disabled` disables the trigger.

- [ ] **Step 2: Run menu tests and verify RED**

```powershell
npx vitest run src/components/__tests__/RegistrationActionsMenu.test.jsx --maxWorkers=1
```

Expected: FAIL because the component is absent.

- [ ] **Step 3: Move the proven menu behavior into the generic component**

```powershell
git mv src/components/ParkingRegistrationActionsMenu.jsx src/components/RegistrationActionsMenu.jsx
```

Replace the component parameters and hard-coded item construction with:

```js
export default function RegistrationActionsMenu({ items, disabled = false }) {
  const enabledItems = items.filter((item) => item.enabled !== false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  // Keep the file's existing effects, positioning, keyboard handlers, and JSX.
}
```

Within that unchanged implementation, replace every array reference from `items` to `enabledItems`, render `enabledItems.map(...)`, and replace `item.run()` with `item.onSelect()`. No CSS class, ARIA attribute, or key handler changes in this step.

The resulting item click body is exact:

```jsx
onClick={() => {
  setOpen(false);
  item.onSelect();
}}
```

Do not alter CSS or keyboard behavior.

- [ ] **Step 4: Convert ParkingRegistrationTable to item descriptors**

Build the descriptors with this exact shape and existing eligibility helpers:

```js
const deliveryStatus = emailDeliveryStatuses?.get(registration.id);
const items = [
  { label: 'View', onSelect: () => onView(registration) },
  { label: 'Record Payment', enabled: eligibleToRecordPayment, onSelect: () => onRecordPayment(registration) },
  { label: 'Print Pass', enabled: canPrintParkingPass(registration), onSelect: () => onPrintPass(registration) },
  { label: 'Finalize', enabled: canFinalizeParkingPass(registration), onSelect: () => onFinalize(registration) },
  { label: 'Undo Finalization', enabled: canUndoParkingPassFinalization(registration), onSelect: () => onUndoFinalization(registration) },
  { label: 'Retry failed email', enabled: deliveryStatus?.exhausted === true, onSelect: () => onRetryEmail(registration) },
];
```

Add props `emailDeliveryStatuses` and `onRetryEmail`; show `Email failed` beside registration status only when `deliveryStatus?.exhausted === true`.

- [ ] **Step 5: Run generic-menu and parking-table suites**

```powershell
npx vitest run src/components/__tests__/RegistrationActionsMenu.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx --maxWorkers=1
```

Expected: PASS, including existing payment/pass actions and new exhausted-only retry action.

- [ ] **Step 6: Remove the superseded parking-specific test**

Delete `src/components/__tests__/ParkingRegistrationActionsMenu.test.jsx`, then require `rg "ParkingRegistrationActionsMenu" src` to return no remaining imports.

- [ ] **Step 7: Commit the menu refactor**

```powershell
git add -A -- src/components/RegistrationActionsMenu.jsx src/components/ParkingRegistrationTable.jsx src/components/__tests__
git commit -m "refactor: share registration actions menu"
```

## Task 7: Email Delivery detail card

**Files:**
- Create: `src/components/RegistrationEmailDeliveryCard.jsx`
- Test: `src/components/__tests__/RegistrationEmailDeliveryCard.test.jsx`

- [ ] **Step 1: Write failing card tests**

Cover these exact presentations and focus behavior:

- null row or a projected row with `delivery_id: null` -> `No delivery record`, no retry button;
- `sent` -> `Sent` and `sent_at`;
- `pending` -> `Sending`;
- failed attempt 1-3 -> `Retry scheduled` and `next_retry_at`;
- failed attempt 4 -> `Failed - intervention required`, sanitized message, and retry button;
- first click reveals inline Confirm/Cancel;
- Confirm calls `onRetry(delivery_id)` once;
- `retrying` disables confirmation and shows sending state;
- unknown `last_error_code` maps to a generic safe sentence.
- a forwarded ref focuses the card's root element without changing the visible layout.

- [ ] **Step 2: Run card tests and verify RED**

```powershell
npx vitest run src/components/__tests__/RegistrationEmailDeliveryCard.test.jsx --maxWorkers=1
```

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the card**

Use a local `confirming` boolean and fixed maps:

```js
const kindLabels = {
  registration_confirmation: 'Registration confirmation',
  registration_waitlist: 'Waitlist confirmation',
  waitlist_promotion: 'Waitlist promotion',
  registration_cancellation: 'Cancellation confirmation',
};

const failureMessages = {
  smtp_send_failed: 'The outgoing mail server did not complete the delivery.',
  smtp_not_configured: 'Outgoing mail settings are unavailable.',
  cancel_token_not_configured: 'The cancellation-link signing configuration is unavailable.',
  base_url_not_configured: 'The event-site cancellation-link configuration is unavailable.',
  message_configuration_missing: 'The event email message configuration is incomplete.',
};
```

Export the component through `forwardRef`, attach the ref to the card's root element, and give that root `tabIndex={-1}` so the dropdown action can move keyboard focus to this section. Render a separate `Card` headed `Email Delivery`; treat `!status?.delivery_id` as the no-record case, do not show raw codes unless paired with their fixed human-readable message, and never accept recipient/body props.

- [ ] **Step 4: Run card tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the card**

```powershell
git add -- src/components/RegistrationEmailDeliveryCard.jsx src/components/__tests__/RegistrationEmailDeliveryCard.test.jsx
git commit -m "feat: show registration email delivery status"
```

## Task 8: Registration Viewer discovery and manual retry

**Files:**
- Modify: `src/components/RegistrationViewer.jsx`
- Modify: `src/components/__tests__/RegistrationViewer.test.jsx`
- Modify: `src/components/ParkingRegistrationTable.jsx`
- Modify: `src/components/__tests__/ParkingRegistrationTable.test.jsx`

- [ ] **Step 1: Extend the RegistrationViewer test seam**

Mock the Task 5 service separately from existing payment/finalization RPCs. Default it to `new Map()` so existing tests remain semantically unchanged.

- [ ] **Step 2: Write failing discovery tests**

Return one exhausted row and assert:

- banner text `1 email delivery requires attention`;
- `Email failed` badge on the affected registration only;
- `Email intervention` filter hides unaffected registrations;
- Actions dropdown offers `Retry failed email` only for the exhausted row;
- selecting it opens View Registration and shows the Email Delivery card.

Run:

```powershell
npx vitest run src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx --maxWorkers=1
```

Expected: FAIL on the missing discovery UI.

- [ ] **Step 3: Load and refresh event-scoped status independently**

Import `useCallback` and add state for `emailDeliveryStatuses`, `emailStatusError`, and refresh generation. Implement the independent loader with this contract:

```js
const refreshEmailDeliveryStatuses = useCallback(async () => {
  try {
    const statuses = await listRegistrationEmailDeliveryStatuses(orgId, eventId);
    setEmailDeliveryStatuses(statuses);
    setEmailStatusError('');
    return statuses;
  } catch {
    setEmailStatusError('Unable to load email delivery status.');
    return null;
  }
}, [orgId, eventId]);
```

Call it on initial load and registration realtime refresh. Add a separate effect with `window.setInterval(refreshEmailDeliveryStatuses, 60_000)` and clear it on unmount. The status loader must never set the registration `loading` state or clear registration rows.

- [ ] **Step 4: Add banner, filter, badges, and standard-row dropdown**

Compute exhausted IDs and filter with:

```js
const exhaustedRegistrationIds = useMemo(
  () => new Set([...emailDeliveryStatuses.entries()]
    .filter(([, status]) => status?.exhausted === true)
    .map(([registrationId]) => registrationId)),
  [emailDeliveryStatuses],
);

if (emailInterventionOnly) {
  result = result.filter((registration) =>
    exhaustedRegistrationIds.has(registration.id));
}
```

Use `RegistrationActionsMenu` for standard rows with these descriptors:

```js
[
  { label: 'View', onSelect: () => setSelectedReg(reg) },
  { label: 'Record Payment', enabled: canRecordRegistrationPayment(reg), onSelect: () => setPaymentDialogRegistration(reg) },
  { label: 'Retry failed email', enabled: exhaustedRegistrationIds.has(reg.id), onSelect: () => openEmailDelivery(reg) },
]
```

Pass the same status map and `openEmailDelivery` callback to `ParkingRegistrationTable`.

- [ ] **Step 5: Add the detail section and focus path**

Render `RegistrationEmailDeliveryCard` below Registration Details with:

```jsx
<RegistrationEmailDeliveryCard
  ref={emailDeliveryCardRef}
  status={emailDeliveryStatuses.get(selectedReg.id) || null}
  retrying={retryingDeliveryId === emailDeliveryStatuses.get(selectedReg.id)?.delivery_id}
  error={emailRetryError}
  onRetry={handleRetryEmailDelivery}
/>
```

`openEmailDelivery(registration)` sets `selectedReg`, sets a `focusEmailDelivery` flag, and a post-render effect calls `emailDeliveryCardRef.current?.focus()` before clearing the flag. Do not queue until the card's inline confirmation calls `onRetry`.

- [ ] **Step 6: Write failing manual-retry result tests**

Assert that confirmation calls the exact service payload, displays `Sending`, and polls status without treating either `{ code: 'queued' }` or the unchanged pre-retry failed snapshot as the new attempt's result. It stops on authoritative `sent`, or on `failed` only after `attempt_count` has increased beyond the pre-retry count. Assert the latter leaves an exhausted failed card plus a safe message. Assert status polling stops after 30 seconds and offers a refresh message rather than inferring failure.

- [ ] **Step 7: Implement bounded retry polling**

Add a handler that captures the delivery's pre-retry `attempt_count`, calls `retryRegistrationEmailDelivery`, then polls the status RPC every two seconds for at most 15 reads. A still-visible failed snapshot with the same attempt count predates the queued request and must not end polling:

```js
const handleRetryEmailDelivery = async (deliveryId) => {
  const registrationId = selectedReg.id;
  const baselineAttemptCount =
    emailDeliveryStatuses.get(registrationId)?.attempt_count ?? 0;
  setRetryingDeliveryId(deliveryId);
  setEmailRetryError('');
  try {
    await retryRegistrationEmailDelivery({
      orgId,
      registrationId,
      deliveryId,
    });
    for (let read = 0; read < 15; read += 1) {
      const statuses = await refreshEmailDeliveryStatuses();
      const status = statuses?.get(registrationId);
      if (status?.state === 'sent') return;
      if (
        status?.state === 'failed'
        && status.attempt_count > baselineAttemptCount
      ) return;
      await waitForRetryPoll();
    }
    setEmailRetryError('The retry is still processing. Refresh delivery status shortly.');
  } catch (error) {
    setEmailRetryError(emailRetryMessages[error.code] || emailRetryMessages.email_retry_failed);
  } finally {
    setRetryingDeliveryId(null);
  }
};
```

Define the owned wait and cleanup next to the handler:

```js
const retryPollTimers = useRef(new Set());
const waitForRetryPoll = () => new Promise((resolve) => {
  const timerId = window.setTimeout(() => {
    retryPollTimers.current.delete(timerId);
    resolve();
  }, 2_000);
  retryPollTimers.current.add(timerId);
});

useEffect(() => () => {
  for (const timerId of retryPollTimers.current) window.clearTimeout(timerId);
  retryPollTimers.current.clear();
}, []);
```

Stop when the selected delivery becomes `sent`, or when a newly completed attempt returns it to `failed`; never render raw database/provider errors.

- [ ] **Step 8: Run Registration Viewer and table suites**

Run the Step 2 command. Expected: PASS with existing  Registration Viewer and parking behavior preserved.

- [ ] **Step 9: Commit the administrator workflow**

```powershell
git add -- src/components/RegistrationViewer.jsx src/components/ParkingRegistrationTable.jsx src/components/__tests__/RegistrationViewer.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx
git commit -m "feat: manage failed registration emails"
```

## Task 9: Full local verification and documentation integrity

**Files:**
- Verify: all changed files
- Modify only if required by established inventory contract: `supabase/functions/DEPLOYED_BASELINES.md`

- [ ] **Step 1: Run focused email and security suites**

```powershell
npx vitest run supabase/functions/_shared/registration-email-lifecycle.test.ts supabase/functions/_shared/email-delivery.test.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-registration-email/send-registration-email.test.ts src/security/__tests__/registrationEmailRetryMigration.test.js src/security/__tests__/eventEmailMigration.test.js src/security/__tests__/emailAutomationContractRepair.test.js src/services/__tests__/registrationEmailDelivery.test.js src/components/__tests__/RegistrationActionsMenu.test.jsx src/components/__tests__/RegistrationEmailDeliveryCard.test.jsx src/components/__tests__/ParkingRegistrationTable.test.jsx src/components/__tests__/RegistrationViewer.test.jsx --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run repository-wide gates**

```powershell
npm run test:run -- --maxWorkers=1
npm run lint
npm run check:migrations
npm run build
git diff --check origin/main...HEAD
```

Expected: all commands exit 0. Do not broaden lint exclusions.

- [ ] **Step 3: Validate migration scope without applying it**

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Expected: local/remote history aligns through `20260826020710`, and the dry run names exactly the one CLI-generated automatic-retry migration. If any other migration appears, stop before production action.

- [ ] **Step 4: Review security and privacy boundaries**

Confirm by source and tests:

- no service-role or automation secret reaches browser code;
- no direct browser grant exists on `email_deliveries`;
- RPCs require authenticated organization membership;
- status output contains no recipient, subject, body, delivery key, headers, or raw provider response;
- only lifecycle kinds are automatically or manually retried;
- sent and obsolete keys cannot be queued.

- [ ] **Step 5: Update deployed baselines only after an authorized deployment**

Do not change `DEPLOYED_BASELINES.md` during local implementation. After separate deployment authorization and function readback, update only the `send-registration-email` row with the actual deployed version and bundle SHA, then commit that operational evidence separately.

- [ ] **Step 6: Final local commit if verification required tracked corrections**

If and only if verification required an in-scope correction, commit the tested correction with a focused message. Otherwise leave the branch clean at the Task 8 commit.

## Separate Remote and Production Gates

The implementation plan ends with a clean, locally verified branch. Each following action requires explicit authorization:

1. Push the branch and create a non-draft PR.
2. Merge the PR after remote CI succeeds.
3. Apply the single migration after a clean linked dry run.
4. Deploy only `send-registration-email` with `--use-api`.
5. Read back migration history, cron job, RPC grants, and deployed function metadata.
6. Run a controlled authorized failure/retry production test and verify the ledger plus Registration Viewer.
7. Commit updated deployed-baseline evidence and perform local/remote branch closeout.

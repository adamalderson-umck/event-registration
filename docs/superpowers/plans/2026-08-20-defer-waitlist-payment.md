# Deferred Waitlist Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent waitlisted registrants from selecting or owing payment until promotion, then provide configured payment choices in the promotion email.

**Architecture:** The browser submits explicit waitlist intent and omits payment selection when its event snapshot is full. The Edge Function validates that intent, while a database trigger makes the final atomic status/payment decision and handles capacity races. Promotion changes deferred payment to pending, and canonical email composition exposes only validated configured payment paths.

**Tech Stack:** React 19, Vitest and Testing Library, Supabase Edge Functions with Deno/TypeScript, PostgreSQL trigger migrations, ESLint, Vite.

---

## File Map

- `supabase/functions/_shared/tithely.ts`: new shared safe Tithe.ly URL validator.
- `supabase/functions/_shared/registration-request.ts`: parse and validate waitlist intent.
- `src/components/EventRegistrationForm.jsx`: waitlist-only UI and submission behavior.
- `src/services/registrationSubmission.js`: stable availability-conflict code.
- `supabase/functions/submit-registration/handler.ts`: capacity fields and sanitized race response.
- `supabase/migrations/20260820150000_defer_waitlist_payments.sql`: atomic insert and promotion lifecycle.
- `supabase/functions/send-registration-email/handler.ts`: promotion payment choices.
- `supabase/functions/send-registration-email/send-registration-email.ts`: canonical payment configuration query.
- Corresponding `*.test.*` files: focused regression coverage for each boundary.

### Task 1: Share Safe Tithe.ly URL Validation

**Files:**
- Create: `supabase/functions/_shared/tithely.ts`
- Create: `supabase/functions/_shared/tithely.test.ts`
- Modify: `supabase/functions/_shared/registration-request.ts`

- [ ] **Step 1: Write the failing validator test**

```ts
import { describe, expect, it } from "vitest";
import { getValidatedTithelyGivingUrl } from "./tithely.ts";

const FORM_ID = "11111111-1111-4111-8111-111111111111";

describe("getValidatedTithelyGivingUrl", () => {
  it("returns the canonical URL only when URL and embed IDs match", () => {
    const url = `https://give.tithe.ly/?formId=${FORM_ID}`;
    expect(getValidatedTithelyGivingUrl({
      tithely_giving_url: url,
      tithely_embed_config: { formId: FORM_ID },
    })).toBe(url);
  });

  it.each([
    {},
    { tithely_giving_url: "https://evil.example/pay", tithely_embed_config: { formId: FORM_ID } },
    { tithely_giving_url: `https://give.tithe.ly/?formId=${FORM_ID}`, tithely_embed_config: { formId: "22222222-2222-4222-8222-222222222222" } },
  ])("rejects unsafe or inconsistent configuration", (configuration) => {
    expect(getValidatedTithelyGivingUrl(configuration)).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run supabase/functions/_shared/tithely.test.ts --maxWorkers=1`

Expected: FAIL because `tithely.ts` does not exist.

- [ ] **Step 3: Add the minimal validator**

```ts
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getValidatedTithelyGivingUrl(configuration: {
  tithely_giving_url?: unknown;
  tithely_embed_config?: unknown;
}): string | null {
  const embed = configuration.tithely_embed_config;
  if (typeof configuration.tithely_giving_url !== "string" ||
      !embed || typeof embed !== "object" || Array.isArray(embed)) return null;
  try {
    const url = new URL(configuration.tithely_giving_url);
    const ids = url.searchParams.getAll("formId");
    const embedId = (embed as Record<string, unknown>).formId;
    if (url.protocol !== "https:" || url.origin !== "https://give.tithe.ly" ||
        url.pathname !== "/" || url.username || url.password || url.hash ||
        ids.length !== 1 || !UUID_PATTERN.test(ids[0]) ||
        typeof embedId !== "string" || ids[0].toLowerCase() !== embedId.toLowerCase()) return null;
    return url.toString();
  } catch {
    return null;
  }
}
```

Import it in `registration-request.ts`, replace `hasValidTithelyConfiguration(event)` with `getValidatedTithelyGivingUrl(event) !== null`, and remove the duplicated parser.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx vitest run supabase/functions/_shared/tithely.test.ts supabase/functions/_shared/registration-request.test.ts --maxWorkers=1`

Expected: both files PASS.

```powershell
git add -- supabase/functions/_shared/tithely.ts supabase/functions/_shared/tithely.test.ts supabase/functions/_shared/registration-request.ts
git commit -m "refactor: share Tithe.ly URL validation"
```

### Task 2: Add Deferred Waitlist Intent

**Files:**
- Modify: `supabase/functions/_shared/registration-request.ts`
- Modify: `supabase/functions/_shared/registration-request.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add `waitlistIntent: false` to `baseRequest`, then add:

```ts
it("parses only boolean waitlist intent and defaults legacy requests to false", () => {
  expect(parseRegistrationRequest({ ...baseRequest, waitlistIntent: true })).toMatchObject({ waitlistIntent: true });
  expect(() => parseRegistrationRequest({ ...baseRequest, waitlistIntent: "true" })).toThrow("invalid_request");
  const { waitlistIntent: _omitted, ...legacyRequest } = baseRequest;
  expect(parseRegistrationRequest(legacyRequest)).toMatchObject({ waitlistIntent: false });
});

it("defers payment only for a plausible full waitlist", () => {
  const full = { ...baseEvent, payment_enabled: true, capacity: 10, registration_count: 10, waitlist_enabled: true };
  expect(buildRegistrationInsert(full, {
    ...baseRequest, paymentMethod: null, waitlistIntent: true,
  }, metadata)).toMatchObject({ payment_status: "not_required", payment_method: null });
  expect(() => buildRegistrationInsert({ ...full, registration_count: 9 }, {
    ...baseRequest, paymentMethod: null, waitlistIntent: true,
  }, metadata)).toThrow("invalid_request");
  expect(() => buildRegistrationInsert({ ...full, waitlist_enabled: false }, {
    ...baseRequest, paymentMethod: null, waitlistIntent: true,
  }, metadata)).toThrow("invalid_request");
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1`

Expected: FAIL because the new top-level key is rejected.

- [ ] **Step 3: Implement the contract**

Add `waitlistIntent` to `TOP_LEVEL_KEYS` and `RegistrationRequest`. When the key is present, require a boolean; when it is absent, return `false` so an Edge Function deployment remains compatible with already-open browser sessions. Extend `EventRecord` with `capacity`, `registration_count`, and `waitlist_enabled`. Replace payment derivation with:

```ts
function getPayment(event: EventRecord, request: RegistrationRequest) {
  const plausibleWaitlist = event.waitlist_enabled === true &&
    typeof event.capacity === "number" && event.capacity > 0 &&
    typeof event.registration_count === "number" && event.registration_count >= event.capacity;
  if (request.waitlistIntent) {
    if (!plausibleWaitlist || request.paymentMethod !== null) invalidRequest();
    return { payment_status: "not_required" as const, payment_method: null };
  }
  if (!event.payment_enabled) {
    if (request.paymentMethod !== null) invalidRequest();
    return { payment_status: "not_required" as const, payment_method: null };
  }
  const allowed = new Set<string>();
  if (getValidatedTithelyGivingUrl(event)) allowed.add("tithely");
  if (event.allow_in_person_payment === true) allowed.add("in_person");
  if (request.paymentMethod === null || !allowed.has(request.paymentMethod)) invalidRequest();
  return { payment_status: "pending" as const, payment_method: request.paymentMethod };
}
```

Call `getPayment(event, request)` in `buildRegistrationInsert`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx vitest run supabase/functions/_shared/registration-request.test.ts --maxWorkers=1`

Expected: PASS.

```powershell
git add -- supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-request.test.ts
git commit -m "feat: validate deferred waitlist payment intent"
```

### Task 3: Hide Payment Selection in the Waitlist UI

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx`
- Modify: `src/components/__tests__/EventRegistrationForm.test.jsx`
- Modify: `src/services/registrationSubmission.js`
- Modify: `src/services/__tests__/registrationSubmission.test.js`

- [ ] **Step 1: Write the failing UI test**

```jsx
it("joins a full paid waitlist without selecting payment", async () => {
  setupMocks(makeEvent({
    payment_enabled: true, allow_in_person_payment: true,
    tithely_giving_url: `https://give.tithe.ly/?formId=${TITHELY_FORM_ID}`,
    tithely_embed_config: { formId: TITHELY_FORM_ID },
    capacity: 10, registration_count: 10, waitlist_enabled: true,
  }));
  supabase._mocks.mockInvoke.mockResolvedValue({
    data: { id: "registration-1", status: "waitlisted", payment_status: "not_required", payment_method: null },
    error: null,
  });
  render(<EventRegistrationForm eventId="evt-1" orgId="org-1" />);
  await completeRequiredFields();
  expect(screen.queryByText("Payment Method")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Join Waitlist" }));
  await waitFor(() => expect(supabase._mocks.mockInvoke).toHaveBeenCalledWith(
    "submit-registration",
    { body: expect.objectContaining({ paymentMethod: null, waitlistIntent: true }) },
  ));
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx -t "joins a full paid waitlist" --maxWorkers=1`

Expected: FAIL because payment UI remains visible and intent is absent.

- [ ] **Step 3: Implement the UI behavior**

Use:

```jsx
const isFull = Boolean(event?.capacity && event.registration_count >= event.capacity);
const isJoiningWaitlist = Boolean(isFull && event?.waitlist_enabled);
```

Initialize `paymentMethod` to empty when fetched data is full with waitlisting. Skip final payment validation for `isJoiningWaitlist`. Submit:

```jsx
paymentMethod: event.payment_enabled && !isJoiningWaitlist ? paymentMethod : null,
waitlistIntent: isJoiningWaitlist,
```

Render no `paymentSlot` for `isJoiningWaitlist`, and make its submit label exactly `Join Waitlist`.

- [ ] **Step 4: Add the retryable conflict behavior**

Export `AVAILABILITY_CHANGED_ERROR = "availability_changed"` from `registrationSubmission.js` and cover it in the service test. Add an `eventRefreshKey` counter to the event-fetch effect dependencies. When the conflict is returned, increment that counter so capacity and payment choices reload without resetting `formData`, then set:

```jsx
setErrors({
  _form: "Availability changed while you were registering. Please try again and choose a payment method if a spot is now available.",
});
```

Reset Turnstile using the existing submission-error path.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run src/components/__tests__/EventRegistrationForm.test.jsx src/services/__tests__/registrationSubmission.test.js --maxWorkers=1`

Expected: both files PASS, including existing confirmed-payment cases.

```powershell
git add -- src/components/EventRegistrationForm.jsx src/components/__tests__/EventRegistrationForm.test.jsx src/services/registrationSubmission.js src/services/__tests__/registrationSubmission.test.js
git commit -m "feat: defer payment when joining a waitlist"
```

### Task 4: Enforce the Edge and Database Boundaries

**Files:**
- Modify: `supabase/functions/submit-registration/handler.ts`
- Modify: `supabase/functions/submit-registration/handler.test.ts`
- Create: `supabase/migrations/20260820150000_defer_waitlist_payments.sql`
- Create: `src/security/__tests__/waitlistPaymentMigration.test.js`

- [ ] **Step 1: Write failing handler tests**

Add `waitlistIntent: false` to `requestBody`, add capacity fields to `event`, and test a full waitlist insert. Also simulate `insertError: { message: "payment_selection_required", details: "secret" }` and assert status 409 with:

```ts
{
  error: "availability_changed",
  requestId: "request-123",
}
```

Assert logs and response omit `secret`.

- [ ] **Step 2: Verify handler RED**

Run: `npx vitest run supabase/functions/submit-registration/handler.test.ts --maxWorkers=1`

Expected: FAIL because capacity fields are not selected and the error is generic.

- [ ] **Step 3: Implement handler enforcement**

Select:

```ts
"id,org_id,status,registration_close_date,capacity,registration_count,waitlist_enabled,payment_enabled,allow_in_person_payment,tithely_giving_url,tithely_embed_config,form_fields,waivers"
```

After failed attempt recovery and before generic logging, add:

```ts
if (messageOf(insertError) === "payment_selection_required") {
  return errorResponse("availability_changed", 409, correlationId, origin);
}
```

- [ ] **Step 4: Write the failing migration contract test**

Create a static SQL test that requires:

```js
expect(sql).toMatch(/if v_new_status = 'waitlisted'[\s\S]*new\.payment_method := null[\s\S]*new\.payment_status := 'not_required'/i);
expect(sql).toMatch(/v_new_status = 'confirmed'[\s\S]*v_event\.payment_enabled[\s\S]*payment_selection_required/i);
expect(sql).toMatch(/old\.status = 'waitlisted'[\s\S]*new\.status = 'confirmed'[\s\S]*when v_payment_enabled then 'pending'/i);
expect(sql).not.toMatch(/update\s+public\.registrations\s+set/i);
```

Run: `npx vitest run src/security/__tests__/waitlistPaymentMigration.test.js --maxWorkers=1`

Expected: FAIL because the migration does not exist.

- [ ] **Step 5: Create the migration**

Redefine the current `public.handle_new_registration()` body, preserving its event row lock and counter updates. Include `payment_enabled` in `v_event`, then add after `NEW.status := v_new_status`:

```sql
IF v_new_status = 'waitlisted' THEN
  NEW.payment_method := NULL;
  NEW.payment_status := 'not_required';
ELSIF v_event.payment_enabled AND NEW.payment_method IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'payment_selection_required';
END IF;
```

Add:

```sql
CREATE OR REPLACE FUNCTION private.apply_waitlist_payment_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_payment_enabled boolean;
BEGIN
  IF OLD.status <> 'waitlisted' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT events.payment_enabled INTO v_payment_enabled
  FROM public.events AS events
  WHERE events.id = NEW.event_id AND events.org_id = NEW.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found for waitlist payment lifecycle'; END IF;
  PERFORM pg_catalog.set_config('app.payment_projection_write', 'allowed', true);
  NEW.payment_method := NULL;
  NEW.payment_status := CASE WHEN v_payment_enabled THEN 'pending' ELSE 'not_required' END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.apply_waitlist_payment_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_waitlist_payment_lifecycle() TO service_role;
DROP TRIGGER IF EXISTS apply_waitlist_payment_lifecycle ON public.registrations;
CREATE TRIGGER apply_waitlist_payment_lifecycle
BEFORE UPDATE OF status ON public.registrations
FOR EACH ROW EXECUTE FUNCTION private.apply_waitlist_payment_lifecycle();
```

Do not add a historical data update.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npx vitest run supabase/functions/submit-registration/handler.test.ts src/security/__tests__/waitlistPaymentMigration.test.js src/security/__tests__/paymentLedgerMigration.test.js --maxWorkers=1
npm run check:migrations
```

Expected: all tests PASS and migration checker exits 0.

```powershell
git add -- supabase/functions/submit-registration/handler.ts supabase/functions/submit-registration/handler.test.ts supabase/migrations/20260820150000_defer_waitlist_payments.sql src/security/__tests__/waitlistPaymentMigration.test.js
git commit -m "feat: enforce atomic waitlist payment state"
```

### Task 5: Add Payment Paths to Promotion Email

**Files:**
- Modify: `supabase/functions/send-registration-email/handler.ts`
- Modify: `supabase/functions/send-registration-email/handler.test.ts`
- Modify: `supabase/functions/send-registration-email/send-registration-email.ts`

- [ ] **Step 1: Write failing promotion tests**

For a promoted paid event with valid Tithe.ly and Pay in Person, assert HTML contains `Complete payment online with Tithe.ly`, the configured URL, and `You may also pay in person`, but not `Payment verified`. Add an unsafe `evil.example` configuration case and assert it never appears in sent HTML.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run supabase/functions/send-registration-email/handler.test.ts --maxWorkers=1`

Expected: FAIL because promotion email has no payment section.

- [ ] **Step 3: Extend canonical event data and composition**

Add `payment_enabled`, `allow_in_person_payment`, `tithely_giving_url`, and `tithely_embed_config` to `CanonicalEvent` and the event query in `send-registration-email.ts`. Import the shared validator and add:

```ts
function promotionPaymentHtml(event: CanonicalEvent): string {
  if (!event.payment_enabled) return "";
  const givingUrl = getValidatedTithelyGivingUrl(event);
  const online = givingUrl
    ? `<p><a href="${escapeHtml(givingUrl)}">Complete payment online with Tithe.ly</a></p>`
    : "";
  const inPerson = event.allow_in_person_payment ? "<p>You may also pay in person.</p>" : "";
  return online || inPerson ? `<div class="divider"></div><h2>Payment</h2>${online}${inPerson}` : "";
}
```

Insert it before the promotion email's cancellation copy. Do not execute embed HTML or update payment state from email delivery.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx vitest run supabase/functions/send-registration-email/handler.test.ts supabase/functions/_shared/tithely.test.ts --maxWorkers=1`

Expected: both files PASS.

```powershell
git add -- supabase/functions/send-registration-email/handler.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-registration-email/send-registration-email.ts
git commit -m "feat: offer payment after waitlist promotion"
```

### Task 6: Full Verification and Handoff

**Files:**
- Verify all changed files; do not mutate production.

- [ ] **Step 1: Run the full serial test suite**

Run: `npm run test:run -- --maxWorkers=1`

Expected: all test files PASS with zero failures.

- [ ] **Step 2: Run migration, Edge Function, lint, and build checks**

```powershell
npm run check:migrations
deno lint supabase/functions/_shared/tithely.ts supabase/functions/_shared/tithely.test.ts supabase/functions/_shared/registration-request.ts supabase/functions/_shared/registration-request.test.ts supabase/functions/submit-registration/handler.ts supabase/functions/submit-registration/handler.test.ts supabase/functions/send-registration-email/handler.ts supabase/functions/send-registration-email/handler.test.ts supabase/functions/send-registration-email/send-registration-email.ts
deno check supabase/functions/submit-registration/index.ts supabase/functions/send-registration-email/send-registration-email.ts
npm run lint
npm run build
```

Expected: every command exits 0 with no diagnostics; the build's widget-cache contract passes.

- [ ] **Step 3: Inspect final state**

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors, no uncommitted changes, and only the design, plan, and focused implementation commits.

- [ ] **Step 4: Report boundaries**

Report verification evidence and the worktree path. State explicitly that no Supabase migration was applied, no Edge Function or Firebase deployment occurred, and no PR was created or merged unless separately authorized.

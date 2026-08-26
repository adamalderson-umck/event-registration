import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => {
  const state: {
    registrationResult: { data: unknown; error: unknown };
    deliveryResult: { data: unknown; error: unknown };
  } = {
    registrationResult: { data: null, error: null },
    deliveryResult: { data: null, error: null },
  };
  const maybeSingle = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();
  const from = vi.fn((table: string) => ({
    select(projection: string) {
      select(projection);
      return {
        eq(column: string, value: unknown) {
          eq(column, value);
          return {
            maybeSingle() {
              maybeSingle();
              return Promise.resolve(
                table === "email_deliveries"
                  ? state.deliveryResult
                  : state.registrationResult,
              );
            },
          };
        },
      };
    },
  }));
  return { state, maybeSingle, eq, select, from };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: query.from })),
}));

vi.mock("../_shared/org-smtp.ts", () => ({
  loadSmtpPassword: vi.fn(),
  sendHtmlEmail: vi.fn(),
}));

let servedHandler: (request: Request) => Promise<Response>;

vi.stubGlobal("Deno", {
  env: {
    get(name: string) {
      return {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "database-secret",
        EMAIL_AUTOMATION_SECRET: "automation-secret",
        BASE_URL: "https://events.example.org",
      }[name];
    },
  },
  serve(handler: (request: Request) => Promise<Response>) {
    servedHandler = handler;
  },
});

await import("./send-registration-email.ts");

const expectedRegistrationProjection =
  "id, org_id, event_id, status, form_data, payment_method, payment_status, legacy_payment_paid, created_at, cancelled_at, promoted_at";
const expectedDeliveryProjection =
  "id, delivery_key, registration_id, kind, state, attempt_count, attempted_at";

function request(): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-email-automation-secret": "automation-secret",
    },
    body: JSON.stringify({
      type: "INSERT",
      registration_id: "00000000-0000-0000-0000-000000000001",
    }),
  });
}

function retryRequest(deliveryId: string): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-email-automation-secret": "automation-secret",
    },
    body: JSON.stringify({ type: "RETRY", delivery_id: deliveryId }),
  });
}

describe("send-registration-email entrypoint", () => {
  beforeEach(() => {
    query.state.registrationResult = { data: null, error: null };
    query.state.deliveryResult = { data: null, error: null };
    vi.clearAllMocks();
  });

  it("loads the retry delivery through the service-role client", async () => {
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

  it("surfaces a real retry-delivery query failure", async () => {
    query.state.deliveryResult = {
      data: null,
      error: { code: "42703", message: "column does not exist" },
    };

    const response = await servedHandler(retryRequest("delivery-1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "delivery_load_failed" });
  });

  it("executes the canonical registration projection through the real loader", async () => {
    const response = await servedHandler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skipped: true,
      code: "canonical_record_missing",
    });
    expect(query.from).toHaveBeenCalledWith("registrations");
    expect(query.select).toHaveBeenCalledWith(expectedRegistrationProjection);
    expect(query.eq).toHaveBeenCalledWith(
      "id",
      "00000000-0000-0000-0000-000000000001",
    );
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("surfaces a real registration query failure", async () => {
    query.state.registrationResult = {
      data: null,
      error: { code: "42703", message: "column does not exist" },
    };

    const response = await servedHandler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "canonical_load_failed" });
  });
});

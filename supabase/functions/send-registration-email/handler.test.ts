import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalRegistrationDelivery,
  handleRegistrationEmail,
  type RegistrationEmailDependencies,
  type RegistrationEmailRequest,
} from "./handler.ts";

const serviceRoleKey = "service-role-secret";

function canonicalDelivery(
  overrides: Partial<CanonicalRegistrationDelivery> = {},
): CanonicalRegistrationDelivery {
  return {
    registration: {
      id: "registration-1",
      org_id: "org-1",
      event_id: "event-1",
      status: "confirmed",
      form_data: {
        system_email: "canonical@example.org",
        parking_license_plate: "ABC<123",
      },
      payment_method: "in_person",
      payment_status: "pending",
      legacy_payment_paid: false,
      created_at: "2026-08-06T12:00:00Z",
      updated_at: "2026-08-06T12:00:00Z",
    },
    event: {
      id: "event-1",
      org_id: "org-1",
      title: "Parking <Event>",
      event_type: "parking",
      start_date: "2026-08-15T09:00:00Z",
      location: "Church & Office",
      capacity: 50,
      registration_count: 12,
      form_fields: [
        { id: "system_email", type: "email", label: "Email" },
        { id: "parking_license_plate", type: "text", label: "License Plate" },
      ],
      notifications: {
        organizers: ["organizer@example.org"],
        perRegistration: true,
      },
      confirmation_message: "Creator confirmation text",
    },
    organization: {
      id: "org-1",
      name: "Test Organization",
      smtp_config: {
        host: "smtp.example.org",
        port: 465,
        fromName: "Events",
        fromEmail: "events@example.org",
        auth: { user: "smtp-user" },
      },
    },
    ...overrides,
  };
}

function authorizedRequest(
  body: RegistrationEmailRequest & Record<string, unknown>,
): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function testDependencies(
  overrides: Partial<RegistrationEmailDependencies> = {},
) {
  const send = vi.fn(async () => undefined);
  const dependencies: RegistrationEmailDependencies = {
    serviceRoleKey,
    loadCanonicalDelivery: vi.fn(async () => canonicalDelivery()),
    buildCancelUrl: vi.fn(async () =>
      "https://events.example/?cancel=true&token=safe"
    ),
    loadSmtpPassword: vi.fn(async () => "smtp-password"),
    deliver: vi.fn(async (_claim, performSend) => {
      try {
        await performSend();
        return "sent";
      } catch {
        return "failed";
      }
    }),
    send,
    ...overrides,
  };
  return { dependencies, send };
}

describe("handleRegistrationEmail", () => {
  it("rejects non-POST requests before querying canonical records", async () => {
    const loadCanonicalDelivery = vi.fn();
    const { dependencies } = testDependencies({ loadCanonicalDelivery });

    const response = await handleRegistrationEmail(
      new Request("https://example.test", { method: "GET" }),
      dependencies,
    );

    expect(response.status).toBe(405);
    expect(loadCanonicalDelivery).not.toHaveBeenCalled();
  });

  it("rejects an ordinary token before reading a malformed body", async () => {
    const { dependencies } = testDependencies();
    const response = await handleRegistrationEmail(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer ordinary-user-token" },
        body: "{not-json",
      }),
      dependencies,
    );

    expect(response.status).toBe(401);
  });

  it("rejects an invalid request without loading canonical records", async () => {
    const loadCanonicalDelivery = vi.fn();
    const { dependencies } = testDependencies({ loadCanonicalDelivery });
    const response = await handleRegistrationEmail(
      authorizedRequest({ type: "INSERT", registration_id: "" }),
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(loadCanonicalDelivery).not.toHaveBeenCalled();
  });

  it("uses only canonical content for an initial confirmed registration", async () => {
    const { dependencies, send } = testDependencies();
    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
        injected_email: "attacker@example.org",
        injected_html: "<script>attack()</script>",
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    const confirmation = send.mock.calls.find(([message]) =>
      message.subject.startsWith("Registration Confirmed:")
    )?.[0];
    expect(confirmation).toMatchObject({
      to: "canonical@example.org",
      subject: "Registration Confirmed: Parking <Event>",
    });
    expect(confirmation.html).toContain("Creator confirmation text");
    expect(confirmation.html).toContain(
      'Payment method</div><div class="field-value">Pay in Person',
    );
    expect(confirmation.html).toContain(
      'Payment status</div><div class="field-value">Pending verification',
    );
    expect(confirmation.html).toContain("Parking &lt;Event&gt;");
    expect(confirmation.html).toContain("Church &amp; Office");
    expect(confirmation.html).toContain("ABC&lt;123");
    expect(JSON.stringify(send.mock.calls)).not.toContain(
      "attacker@example.org",
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain("attack()");
  });

  it("keeps initial waitlist copy system-controlled", async () => {
    const record = canonicalDelivery();
    record.registration.status = "waitlisted";
    const { dependencies, send } = testDependencies({
      loadCanonicalDelivery: vi.fn(async () => record),
    });

    await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );

    const waitlist = send.mock.calls.find(([message]) =>
      message.subject.startsWith("Waitlist Confirmation:")
    )?.[0];
    expect(waitlist.html).toContain("You've been added to the waitlist.");
    expect(waitlist.html).not.toContain("Creator confirmation text");
  });

  it.each([
    {
      oldStatus: "confirmed",
      newStatus: "cancelled",
      subject: "Registration Cancelled: Parking <Event>",
    },
    {
      oldStatus: "waitlisted",
      newStatus: "confirmed",
      subject: "Spot Available! Parking <Event>",
    },
  ])("preserves system-controlled update copy for $newStatus", async ({
    oldStatus,
    newStatus,
    subject,
  }) => {
    const record = canonicalDelivery();
    record.registration.status = newStatus;
    record.registration.updated_at = "2026-08-07T12:00:00Z";
    const { dependencies, send } = testDependencies({
      loadCanonicalDelivery: vi.fn(async () => record),
    });

    await handleRegistrationEmail(
      authorizedRequest({
        type: "UPDATE",
        registration_id: "registration-1",
        old_status: oldStatus,
        new_status: newStatus,
      }),
      dependencies,
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject }));
    expect(JSON.stringify(send.mock.calls)).not.toContain(
      "Creator confirmation text",
    );
  });

  it("keeps organizer notification copy and recipient canonical", async () => {
    const { dependencies, send } = testDependencies();
    await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "organizer@example.org",
      subject: "New Registration: Parking <Event>",
    }));
  });

  it("skips the registrant delivery when the canonical email is missing", async () => {
    const record = canonicalDelivery();
    delete record.registration.form_data.system_email;
    record.event.notifications = null;
    const { dependencies, send } = testDependencies({
      loadCanonicalDelivery: vi.fn(async () => record),
    });

    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );

    expect(send).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ skipped: 1, sent: 0 });
  });

  it.each([
    {
      name: "missing custom confirmation text",
      mutate(record: CanonicalRegistrationDelivery) {
        record.event.confirmation_message = "";
      },
      expectedCode: "message_configuration_missing",
    },
    {
      name: "missing SMTP configuration",
      mutate(record: CanonicalRegistrationDelivery) {
        record.organization.smtp_config = null;
      },
      expectedCode: "smtp_not_configured",
    },
  ])("fails safely for $name", async ({ mutate, expectedCode }) => {
    const record = canonicalDelivery();
    record.event.notifications = null;
    mutate(record);
    let failureCode = "";
    const { dependencies } = testDependencies({
      loadCanonicalDelivery: vi.fn(async () => record),
      deliver: vi.fn(async (_claim, performSend) => {
        try {
          await performSend();
          return "sent";
        } catch (error) {
          failureCode = (error as Error).message;
          return "failed";
        }
      }),
    });

    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );
    const body = await response.text();

    expect(failureCode).toBe(expectedCode);
    expect(body).toContain('"failed":1');
    expect(body).not.toContain("canonical@example.org");
    expect(body).not.toContain("Creator confirmation text");
  });

  it("returns a fixed skip code when canonical records are missing", async () => {
    const { dependencies } = testDependencies({
      loadCanonicalDelivery: vi.fn(async () => null),
    });

    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );

    expect(await response.json()).toEqual({
      skipped: true,
      code: "canonical_record_missing",
    });
  });

  it("suppresses already-sent logical deliveries", async () => {
    const deliver = vi.fn(async () => "already_sent" as const);
    const { dependencies, send } = testDependencies({ deliver });

    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "INSERT",
        registration_id: "registration-1",
      }),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ already_sent: 2, sent: 0 });
  });

  it("skips a transition that does not match the canonical current status", async () => {
    const { dependencies, send } = testDependencies();
    const response = await handleRegistrationEmail(
      authorizedRequest({
        type: "UPDATE",
        registration_id: "registration-1",
        old_status: "confirmed",
        new_status: "cancelled",
      }),
      dependencies,
    );

    expect(send).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      skipped: true,
      code: "transition_mismatch",
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalReminderEvent,
  type CanonicalReminderRecipient,
  handleEventReminders,
  type ReminderDependencies,
} from "./handler.ts";

const automationSecret = "automation-secret";
const now = new Date("2026-08-06T12:00:00Z");

function reminderEvent(
  overrides: Partial<CanonicalReminderEvent> = {},
): CanonicalReminderEvent {
  return {
    id: "event-1",
    org_id: "org-1",
    title: "Parking <Reminder>",
    event_type: "parking",
    status: "active",
    start_date: "2026-08-06T13:00:00Z",
    end_date: "2026-08-06T14:00:00Z",
    location: "Church & Office",
    reminder_hours_before: 2,
    reminder_message: "Bring <photo> identification.",
    form_fields: [{ id: "system_email", type: "email", label: "Email" }],
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

function recipient(
  overrides: Partial<CanonicalReminderRecipient> = {},
): CanonicalReminderRecipient {
  return {
    id: "registration-1",
    org_id: "org-1",
    event_id: "event-1",
    status: "confirmed",
    form_data: { system_email: "first@example.org" },
    payment_method: "in_person",
    payment_status: "pending",
    legacy_payment_paid: false,
    ...overrides,
  };
}

function authorizedRequest(): Request {
  return new Request("https://example.test", {
    method: "POST",
    headers: { "x-email-automation-secret": automationSecret },
  });
}

function testDependencies(
  overrides: Partial<ReminderDependencies> = {},
): ReminderDependencies {
  return {
    automationSecret,
    now: () => now,
    loadDueEvents: vi.fn(async () => [reminderEvent()]),
    loadConfirmedRecipients: vi.fn(async () => [
      recipient(),
      recipient({
        id: "registration-2",
        form_data: { system_email: "second@example.org" },
        payment_method: "tithely",
        payment_status: "paid",
      }),
    ]),
    loadSmtpPassword: vi.fn(async () => "smtp-password"),
    deliver: vi.fn(async (_claim, send) => {
      try {
        await send();
        return "sent";
      } catch {
        return "failed";
      }
    }),
    send: vi.fn(async () => undefined),
    markReminderComplete: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("handleEventReminders", () => {
  it("rejects non-POST requests before repository work", async () => {
    const loadDueEvents = vi.fn();
    const response = await handleEventReminders(
      new Request("https://example.test", { method: "GET" }),
      testDependencies({ loadDueEvents }),
    );

    expect(response.status).toBe(405);
    expect(loadDueEvents).not.toHaveBeenCalled();
  });

  it("rejects a bearer token before repository work", async () => {
    const loadDueEvents = vi.fn();
    const response = await handleEventReminders(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer automation-secret" },
      }),
      testDependencies({ loadDueEvents }),
    );

    expect(response.status).toBe(401);
    expect(loadDueEvents).not.toHaveBeenCalled();
  });

  it("loads fresh payment state separately for every due parking recipient", async () => {
    const send = vi.fn(async () => undefined);
    const loadConfirmedRecipients = vi.fn(async () => [
      recipient(),
      recipient({
        id: "registration-2",
        form_data: { system_email: "second@example.org" },
        payment_method: "tithely",
        payment_status: "paid",
      }),
    ]);

    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({ loadConfirmedRecipients, send }),
    );

    expect(response.status).toBe(200);
    expect(loadConfirmedRecipients).toHaveBeenCalledWith("event-1");
    expect(send.mock.calls[0][0].html).toContain("Pending verification");
    expect(send.mock.calls[0][0].html).toContain("Pay in Person");
    expect(send.mock.calls[1][0].html).toContain("Verified");
    expect(send.mock.calls[1][0].html).toContain("Tithe.ly");
  });

  it("retries a failed recipient without resending a successful recipient", async () => {
    const send = vi.fn(async () => undefined);
    const deliver = vi.fn()
      .mockResolvedValueOnce("already_sent")
      .mockImplementationOnce(async (_claim, performSend) => {
        await performSend();
        return "sent";
      });

    await handleEventReminders(
      authorizedRequest(),
      testDependencies({ deliver, send }),
    );

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not mark the event complete while an intended delivery failed", async () => {
    const markReminderComplete = vi.fn();
    const deliver = vi.fn()
      .mockResolvedValueOnce("sent")
      .mockResolvedValueOnce("failed");

    await handleEventReminders(
      authorizedRequest(),
      testDependencies({ deliver, markReminderComplete }),
    );

    expect(markReminderComplete).not.toHaveBeenCalled();
  });

  it("does not mark the event complete while a delivery is in progress", async () => {
    const markReminderComplete = vi.fn();
    const deliver = vi.fn()
      .mockResolvedValueOnce("sent")
      .mockResolvedValueOnce("in_progress");

    await handleEventReminders(
      authorizedRequest(),
      testDependencies({ deliver, markReminderComplete }),
    );

    expect(markReminderComplete).not.toHaveBeenCalled();
  });

  it("marks an event complete after all intended deliveries are sent or already sent", async () => {
    const markReminderComplete = vi.fn(async () => undefined);
    const deliver = vi.fn()
      .mockResolvedValueOnce("already_sent")
      .mockResolvedValueOnce("sent");

    await handleEventReminders(
      authorizedRequest(),
      testDependencies({ deliver, markReminderComplete }),
    );

    expect(markReminderComplete).toHaveBeenCalledWith("event-1", now);
  });

  it.each([
    ["no reminder time", { reminder_hours_before: null }],
    ["blank custom message", { reminder_message: "  " }],
    ["inactive event", { status: "draft" }],
    ["future threshold", { start_date: "2026-08-07T13:00:00Z" }],
    ["event already started", { start_date: "2026-08-06T11:00:00Z" }],
  ])("skips %s", async (_name, overrides) => {
    const loadConfirmedRecipients = vi.fn();
    const markReminderComplete = vi.fn();

    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({
        loadDueEvents: vi.fn(async () => [reminderEvent(overrides)]),
        loadConfirmedRecipients,
        markReminderComplete,
      }),
    );

    expect(loadConfirmedRecipients).not.toHaveBeenCalled();
    expect(markReminderComplete).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ skipped: 1, sent: 0 });
  });

  it("excludes recipients that are not canonically confirmed for the event", async () => {
    const send = vi.fn(async () => undefined);
    const loadConfirmedRecipients = vi.fn(async () => [
      recipient({ status: "cancelled" }),
      recipient({ id: "registration-2", status: "waitlisted" }),
      recipient({ id: "registration-3", event_id: "event-other" }),
    ]);

    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({ loadConfirmedRecipients, send }),
    );

    expect(send).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ skipped: 3, sent: 0 });
  });

  it("escapes custom message, title, and location", async () => {
    const send = vi.fn(async () => undefined);
    await handleEventReminders(
      authorizedRequest(),
      testDependencies({
        loadConfirmedRecipients: vi.fn(async () => [recipient()]),
        send,
      }),
    );

    const html = send.mock.calls[0][0].html;
    expect(html).toContain("Parking &lt;Reminder&gt;");
    expect(html).toContain("Bring &lt;photo&gt; identification.");
    expect(html).toContain("Church &amp; Office");
    expect(html).not.toContain("<photo>");
  });

  it("skips a missing recipient email and completes the one-reminder event", async () => {
    const markReminderComplete = vi.fn(async () => undefined);
    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({
        loadConfirmedRecipients: vi.fn(async () => [
          recipient({ form_data: {} }),
        ]),
        markReminderComplete,
      }),
    );

    expect(markReminderComplete).toHaveBeenCalledWith("event-1", now);
    expect(await response.json()).toMatchObject({ skipped: 1, sent: 0 });
  });

  it("continues after one SMTP failure and returns no recipient or message data", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("provider rejected first@example.org"))
      .mockResolvedValueOnce(undefined);
    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({ send }),
    );
    const body = await response.text();

    expect(send).toHaveBeenCalledTimes(2);
    expect(body).toContain('"sent":1');
    expect(body).toContain('"failed":1');
    expect(body).not.toContain("first@example.org");
    expect(body).not.toContain("Bring <photo>");
  });

  it("treats a Vault failure as sanitized per-recipient failures", async () => {
    const send = vi.fn();
    const response = await handleEventReminders(
      authorizedRequest(),
      testDependencies({
        loadSmtpPassword: vi.fn(async () => {
          throw new Error("vault secret leaked");
        }),
        send,
      }),
    );
    const body = await response.text();

    expect(send).not.toHaveBeenCalled();
    expect(body).toContain('"failed":2');
    expect(body).not.toContain("vault secret leaked");
  });
});

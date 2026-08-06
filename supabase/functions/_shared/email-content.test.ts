import { describe, expect, it } from "vitest";
import {
  buildConfirmedRegistrationEmail,
  buildReminderEmail,
  escapeHtml,
  paymentMethodLabel,
  paymentStatusLabel,
  renderPlainText,
} from "./email-content.ts";

const parkingRegistration = {
  payment_method: "in_person",
  payment_status: "pending",
  legacy_payment_paid: false,
  form_data: {
    system_email: "person@example.org",
    parking_license_plate: "ABC<123",
  },
};

describe("email content", () => {
  it("escapes HTML and preserves safe paragraph and line breaks", () => {
    expect(escapeHtml('<script>"x"</script>')).toBe(
      "&lt;script&gt;&quot;x&quot;&lt;/script&gt;",
    );
    expect(renderPlainText("First line\nSecond line\n\nNext <section>")).toBe(
      "<p>First line<br>Second line</p><p>Next &lt;section&gt;</p>",
    );
  });

  it("maps selected payment methods and current statuses to approved labels", () => {
    expect(paymentMethodLabel("in_person")).toBe("Pay in Person");
    expect(paymentMethodLabel("tithely")).toBe("Tithe.ly");
    expect(paymentStatusLabel({ payment_status: "pending" })).toBe(
      "Pending verification",
    );
    expect(paymentStatusLabel({ payment_status: "partial" })).toBe(
      "Partially paid",
    );
    expect(paymentStatusLabel({ payment_status: "paid" })).toBe("Verified");
    expect(
      paymentStatusLabel({ payment_status: "paid", legacy_payment_paid: true }),
    ).toBe("Verified");
    expect(paymentStatusLabel({ payment_status: "not_required" })).toBe(
      "Not required",
    );
  });

  it("places custom confirmation text before parking payment facts and escapes dynamic fields", () => {
    const result = buildConfirmedRegistrationEmail({
      event: {
        title: "Fall <Parking>",
        event_type: "parking",
        confirmation_message: "Pickup details are below.\nBring ID.",
        location: "Church & Office",
      },
      registration: parkingRegistration,
      formFields: [
        { id: "system_email", label: "Email" },
        { id: "parking_license_plate", label: "License <Plate>" },
      ],
      eventDate: "Saturday, August 15, 2026",
      cancelUrl: "https://events.example/?cancel=true&token=safe",
    });

    expect(result.subject).toBe("Registration Confirmed: Fall <Parking>");
    expect(result.html).toContain("Fall &lt;Parking&gt;");
    expect(result.html).toContain("Pickup details are below.<br>Bring ID.");
    expect(result.html).toContain(
      'Payment method</div><div class="field-value">Pay in Person',
    );
    expect(result.html).toContain(
      'Payment status</div><div class="field-value">Pending verification',
    );
    expect(result.html).toContain("License &lt;Plate&gt;");
    expect(result.html).toContain("ABC&lt;123");
    expect(result.html).toContain("Church &amp; Office");
    expect(result.html).toContain(
      'href="https://events.example/?cancel=true&amp;token=safe"',
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toMatch(/print|printable|ready|mailed/i);
    expect(result.html.indexOf("Pickup details")).toBeLessThan(
      result.html.indexOf("Payment method"),
    );
  });

  it("uses the standard fallback and reads verified payment state in reminders", () => {
    const confirmation = buildConfirmedRegistrationEmail({
      event: {
        title: "Dinner",
        event_type: "standard",
        confirmation_message: null,
        location: null,
      },
      registration: {
        form_data: {},
        payment_status: "not_required",
        payment_method: null,
      },
      formFields: [],
      eventDate: null,
      cancelUrl: "https://events.example/cancel",
    });
    expect(confirmation.html).toContain(
      "Your registration has been confirmed!",
    );

    const reminder = buildReminderEmail({
      event: {
        title: "Fall Parking",
        event_type: "parking",
        reminder_message: "Pickup at the office.",
        location: "1435 E Main St",
      },
      registration: { ...parkingRegistration, payment_status: "paid" },
      eventDate: "Saturday, August 15, 2026",
      eventTime: "9:00 AM",
      calendarUrl:
        "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Parking",
    });
    expect(reminder.subject).toBe("Reminder: Fall Parking is coming up!");
    expect(reminder.html).toContain(
      'Payment method</div><div class="field-value">Pay in Person',
    );
    expect(reminder.html).toContain(
      'Payment status</div><div class="field-value">Verified',
    );
    expect(reminder.html).toContain("action=TEMPLATE&amp;text=Parking");
  });

  it("rejects missing required custom text for parking confirmations and reminders", () => {
    expect(() =>
      buildConfirmedRegistrationEmail({
        event: {
          title: "Parking",
          event_type: "parking",
          confirmation_message: "   ",
        },
        registration: parkingRegistration,
        formFields: [],
        eventDate: null,
        cancelUrl: "https://events.example/cancel",
      })
    ).toThrow("missing_confirmation_message");

    expect(() =>
      buildReminderEmail({
        event: {
          title: "Dinner",
          event_type: "standard",
          reminder_message: "",
        },
        registration: { form_data: {} },
        eventDate: "Saturday",
        eventTime: "9:00 AM",
        calendarUrl: "https://calendar.google.com/",
      })
    ).toThrow("missing_reminder_message");
  });
});

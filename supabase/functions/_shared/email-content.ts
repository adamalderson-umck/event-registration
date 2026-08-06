export interface EmailEvent {
  title: string;
  event_type: string;
  confirmation_message?: string | null;
  reminder_message?: string | null;
  location?: string | null;
}

export interface EmailRegistration {
  form_data: Record<string, unknown>;
  payment_method?: string | null;
  payment_status?: string | null;
  legacy_payment_paid?: boolean;
}

export interface EmailField {
  id: string;
  label: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderPlainText(value: string): string {
  const normalized = value.trim().replace(/\r\n?/g, "\n");
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) =>
      `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export function paymentMethodLabel(method: string | null | undefined): string {
  if (method === "tithely") return "Tithe.ly";
  if (method === "in_person" || method === "in_person_verified") {
    return "Pay in Person";
  }
  return method ? String(method) : "Not selected";
}

export function paymentStatusLabel(
  registration: Pick<
    EmailRegistration,
    "payment_status" | "legacy_payment_paid"
  >,
): string {
  if (
    registration.payment_status === "paid" || registration.legacy_payment_paid
  ) {
    return "Verified";
  }
  if (registration.payment_status === "partial") return "Partially paid";
  if (registration.payment_status === "pending") return "Pending verification";
  if (registration.payment_status === "not_required") return "Not required";
  return "Unknown";
}

export function wrapEmail(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f1f5f9; margin: 0; padding: 24px; }
    .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2563eb, #8b5cf6); padding: 24px 32px; color: white; }
    .header h1 { font-size: 20px; margin: 0 0 4px; }
    .header p { font-size: 13px; opacity: 0.85; margin: 0; }
    .body { padding: 32px; }
    .body p { font-size: 15px; color: #475569; }
    .field { margin-bottom: 16px; }
    .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 600; margin-bottom: 2px; }
    .field-value { font-size: 15px; color: #1e293b; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #dcfce7; color: #166534; }
    .cancel-link { display: inline-block; margin-top: 16px; padding: 10px 24px; background: #ef4444; color: white !important; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .footer { padding: 16px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
    .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
  </style>
</head>
<body><div class="container">${content}</div></body>
</html>`;
}

export function emailField(label: string, value: unknown): string {
  return `<div class="field"><div class="field-label">${
    escapeHtml(label)
  }</div><div class="field-value">${escapeHtml(value)}</div></div>`;
}

function paymentFacts(
  event: EmailEvent,
  registration: EmailRegistration,
): string {
  if (event.event_type !== "parking") return "";
  return emailField(
    "Payment method",
    paymentMethodLabel(registration.payment_method),
  ) +
    emailField("Payment status", paymentStatusLabel(registration));
}

export function buildConfirmedRegistrationEmail(input: {
  event: EmailEvent;
  registration: EmailRegistration;
  formFields: EmailField[];
  eventDate: string | null;
  cancelUrl: string;
}): { subject: string; html: string } {
  const { event, registration, formFields, eventDate, cancelUrl } = input;
  const message = event.confirmation_message?.trim() ||
    (event.event_type === "standard"
      ? "Your registration has been confirmed!"
      : "");
  if (!message) throw new Error("missing_confirmation_message");

  const fields = formFields.map((item) => {
    const value = registration.form_data[item.id];
    return emailField(
      item.label,
      Array.isArray(value) ? value.join(", ") : value,
    );
  }).join("");
  const safeTitle = escapeHtml(event.title);

  const html = wrapEmail(`
    <div class="header"><h1>${safeTitle}</h1><p>Registration Confirmed</p></div>
    <div class="body">
      <span class="status-badge">Confirmed</span>
      ${renderPlainText(message)}
      <div class="divider"></div>
      ${paymentFacts(event, registration)}
      ${eventDate ? emailField("Date", eventDate) : ""}
      ${event.location ? emailField("Location", event.location) : ""}
      <div class="divider"></div>
      ${fields}
      <div class="divider"></div>
      <p style="font-size:13px;color:#94a3b8;">Need to cancel? Click below:</p>
      <a href="${
    escapeHtml(cancelUrl)
  }" class="cancel-link">Cancel Registration</a>
    </div>
    <div class="footer">This is an automated confirmation. Please do not reply.</div>
  `);

  return { subject: `Registration Confirmed: ${event.title}`, html };
}

export function buildReminderEmail(input: {
  event: EmailEvent;
  registration: EmailRegistration;
  eventDate: string;
  eventTime: string;
  calendarUrl: string;
}): { subject: string; html: string } {
  const { event, registration, eventDate, eventTime, calendarUrl } = input;
  const message = event.reminder_message?.trim();
  if (!message) throw new Error("missing_reminder_message");
  const safeTitle = escapeHtml(event.title);

  const html = wrapEmail(`
    <div class="header"><h1>${safeTitle}</h1><p>Event Reminder</p></div>
    <div class="body">
      ${renderPlainText(message)}
      <div class="divider"></div>
      ${paymentFacts(event, registration)}
      ${emailField("Date", eventDate)}
      ${emailField("Time", eventTime)}
      ${event.location ? emailField("Location", event.location) : ""}
      <div class="divider"></div>
      <p style="font-size:13px;color:#94a3b8;">Add to your calendar:</p>
      <a href="${
    escapeHtml(calendarUrl)
  }" style="color:#2563eb;font-size:13px;text-decoration:underline;" target="_blank">Add to Google Calendar</a>
    </div>
    <div class="footer">You're receiving this because you're registered for this event.</div>
  `);

  return { subject: `Reminder: ${event.title} is coming up!`, html };
}

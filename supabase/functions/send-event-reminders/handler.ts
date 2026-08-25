import {
  isTrustedAutomationRequest,
  reminderDeliveryKey,
} from "../_shared/email-automation.ts";
import {
  buildReminderEmail,
  type EmailField,
  type OutgoingEmail,
} from "../_shared/email-content.ts";
import {
  type DeliveryClaim,
  type DeliveryResult,
  SanitizedDeliveryError,
} from "../_shared/email-delivery.ts";
import type { SmtpConfig } from "../_shared/org-smtp.ts";

export interface CanonicalReminderEvent {
  id: string;
  org_id: string;
  title: string;
  event_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  reminder_hours_before: number | null;
  reminder_message: string | null;
  form_fields: Array<EmailField & { type: string }>;
  organization: {
    id: string;
    name: string;
    smtp_config: SmtpConfig | null;
  };
}

export interface CanonicalReminderRecipient {
  id: string;
  org_id: string;
  event_id: string;
  status: string;
  form_data: Record<string, unknown>;
  payment_method: string | null;
  payment_status: string | null;
  legacy_payment_paid: boolean;
}

export interface ReminderOutgoingEmail extends OutgoingEmail {
  config: SmtpConfig;
  password: string;
  orgName: string;
}

export interface ReminderDependencies {
  automationSecret: string;
  now(): Date;
  loadDueEvents(now: Date): Promise<CanonicalReminderEvent[]>;
  loadConfirmedRecipients(
    eventId: string,
  ): Promise<CanonicalReminderRecipient[]>;
  loadSmtpPassword(orgId: string): Promise<string>;
  deliver(
    claim: DeliveryClaim,
    send: () => Promise<void>,
  ): Promise<DeliveryResult>;
  send(input: ReminderOutgoingEmail): Promise<void>;
  markReminderComplete(eventId: string, completedAt: Date): Promise<void>;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function recipientEmail(
  event: CanonicalReminderEvent,
  registration: CanonicalReminderRecipient,
): string | null {
  const field = event.form_fields.find((item) => item.id === "system_email") ||
    event.form_fields.find((item) => item.type === "email");
  const value = field ? registration.form_data[field.id] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDueEvent(event: CanonicalReminderEvent, now: Date): boolean {
  if (
    event.status !== "active" ||
    !event.reminder_message?.trim() ||
    typeof event.reminder_hours_before !== "number" ||
    !Number.isFinite(event.reminder_hours_before) ||
    !event.start_date ||
    event.organization.id !== event.org_id
  ) return false;

  const start = Date.parse(event.start_date);
  if (!Number.isFinite(start)) return false;
  const threshold = start - event.reminder_hours_before * 60 * 60 * 1000;
  return now.getTime() >= threshold && now.getTime() < start;
}

function googleCalendarUrl(event: CanonicalReminderEvent): string {
  const start = new Date(event.start_date as string);
  const end = event.end_date
    ? new Date(event.end_date)
    : new Date(start.getTime() + 60 * 60 * 1000);
  const googleDate = (value: Date) =>
    value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.search = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${googleDate(start)}/${googleDate(end)}`,
    location: event.location || "",
  }).toString();
  return url.toString();
}

function eventDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function eventTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function handleEventReminders(
  request: Request,
  dependencies: ReminderDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!isTrustedAutomationRequest(request, dependencies.automationSecret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const counts = {
    sent: 0,
    already_sent: 0,
    in_progress: 0,
    failed: 0,
    skipped: 0,
    completed: 0,
  };

  try {
    const now = dependencies.now();
    const events = await dependencies.loadDueEvents(now);
    for (const event of events) {
      if (!isDueEvent(event, now)) {
        counts.skipped += 1;
        continue;
      }

      const recipients = await dependencies.loadConfirmedRecipients(event.id);
      if (recipients.length === 0) {
        counts.skipped += 1;
        continue;
      }

      let eventBlocked = false;
      let passwordPromise: Promise<string> | null = null;
      const smtpPassword = () => {
        passwordPromise ||= dependencies.loadSmtpPassword(event.org_id);
        return passwordPromise;
      };

      for (const registration of recipients) {
        if (
          registration.status !== "confirmed" ||
          registration.event_id !== event.id ||
          registration.org_id !== event.org_id
        ) {
          counts.skipped += 1;
          continue;
        }
        const email = recipientEmail(event, registration);
        if (!email) {
          counts.skipped += 1;
          continue;
        }

        const result = await dependencies.deliver({
          deliveryKey: reminderDeliveryKey(
            event.id,
            registration.id,
            event.start_date as string,
            event.reminder_hours_before as number,
          ),
          orgId: event.org_id,
          eventId: event.id,
          registrationId: registration.id,
          kind: "event_reminder",
        }, async () => {
          const smtpConfig = event.organization.smtp_config;
          if (!smtpConfig?.host || !smtpConfig.fromEmail) {
            throw new SanitizedDeliveryError("smtp_not_configured");
          }
          let password: string;
          try {
            password = smtpConfig.auth?.user ? await smtpPassword() : "";
          } catch {
            throw new SanitizedDeliveryError("smtp_not_configured");
          }

          let outgoing: Omit<OutgoingEmail, "to">;
          try {
            outgoing = buildReminderEmail({
              event,
              registration,
              eventDate: eventDate(event.start_date as string),
              eventTime: eventTime(event.start_date as string),
              calendarUrl: googleCalendarUrl(event),
            });
          } catch (error) {
            if ((error as Error).message === "missing_reminder_message") {
              throw new SanitizedDeliveryError("message_configuration_missing");
            }
            throw error;
          }

          await dependencies.send({
            ...outgoing,
            to: email,
            config: smtpConfig,
            password,
            orgName: event.organization.name,
          });
        });

        counts[result] += 1;
        if (result === "failed" || result === "in_progress") {
          eventBlocked = true;
        }
      }

      if (!eventBlocked) {
        await dependencies.markReminderComplete(event.id, now);
        counts.completed += 1;
      }
    }
  } catch {
    return jsonResponse({ error: "automation_failed", ...counts }, 500);
  }

  return jsonResponse({
    success: counts.failed === 0 && counts.in_progress === 0,
    ...counts,
  });
}

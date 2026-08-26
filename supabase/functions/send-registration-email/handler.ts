import {
  isTrustedAutomationRequest,
  registrationDeliveryKey,
} from "../_shared/email-automation.ts";
import {
  buildConfirmedRegistrationEmail,
  type EmailField,
  emailField,
  escapeHtml,
  type OutgoingEmail,
  wrapEmail,
} from "../_shared/email-content.ts";
import {
  type DeliveryClaim,
  type DeliveryKind,
  type DeliveryResult,
  SanitizedDeliveryError,
} from "../_shared/email-delivery.ts";
import {
  isRegistrationLifecycleKind,
  matchesApplicableRegistrationLifecycleDelivery,
} from "../_shared/registration-email-lifecycle.ts";
import type { SmtpConfig } from "../_shared/org-smtp.ts";
import { getValidatedTithelyGivingUrl } from "../_shared/tithely.ts";

export type RegistrationEmailRequest =
  | { type: "INSERT"; registration_id: string }
  | {
    type: "UPDATE";
    registration_id: string;
    old_status: string;
    new_status: string;
  }
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

interface CanonicalRegistration {
  id: string;
  org_id: string;
  event_id: string;
  status: string;
  form_data: Record<string, unknown>;
  payment_method: string | null;
  payment_status: string | null;
  legacy_payment_paid: boolean;
  created_at: string;
  cancelled_at: string | null;
  promoted_at: string | null;
}

interface CanonicalEvent {
  id: string;
  org_id: string;
  title: string;
  event_type: string;
  start_date: string | null;
  location: string | null;
  capacity: number | null;
  registration_count: number;
  payment_enabled: boolean;
  allow_in_person_payment: boolean;
  tithely_giving_url: string | null;
  tithely_embed_config: Record<string, unknown> | null;
  form_fields: Array<EmailField & { type: string }>;
  notifications: {
    organizers?: string[];
    perRegistration?: boolean;
  } | null;
  confirmation_message: string | null;
}

interface CanonicalOrganization {
  id: string;
  name: string;
  smtp_config: SmtpConfig | null;
}

export interface CanonicalRegistrationDelivery {
  registration: CanonicalRegistration;
  event: CanonicalEvent;
  organization: CanonicalOrganization;
}

export type CanonicalRegistrationLoadResult =
  | { status: "found"; record: CanonicalRegistrationDelivery }
  | { status: "missing" }
  | { status: "error" };

export interface RegistrationOutgoingEmail extends OutgoingEmail {
  config: SmtpConfig;
  password: string;
  orgName: string;
}

export interface RegistrationEmailDependencies {
  automationSecret: string;
  baseUrl: string;
  loadCanonicalDelivery(
    registrationId: string,
  ): Promise<CanonicalRegistrationLoadResult>;
  loadDelivery(
    deliveryId: string,
  ): Promise<RegistrationEmailDeliveryLoadResult>;
  generateCancelToken(record: CanonicalRegistrationDelivery): Promise<string>;
  loadSmtpPassword(orgId: string): Promise<string>;
  deliver(
    claim: DeliveryClaim,
    send: () => Promise<void>,
  ): Promise<DeliveryResult>;
  send(input: RegistrationOutgoingEmail): Promise<void>;
}

async function buildCancelUrl(
  record: CanonicalRegistrationDelivery,
  dependencies: RegistrationEmailDependencies,
): Promise<string> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(dependencies.baseUrl);
  } catch {
    throw new SanitizedDeliveryError("base_url_not_configured");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new SanitizedDeliveryError("base_url_not_configured");
  }

  const url = new URL("/", baseUrl);
  url.searchParams.set("cancel", "true");
  url.searchParams.set(
    "token",
    await dependencies.generateCancelToken(record),
  );
  return url.toString();
}

interface LogicalDelivery {
  kind: DeliveryKind;
  recipient: string;
  occurrence: string;
  compose(): Promise<OutgoingEmail>;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body),
    { status, headers: { "content-type": "application/json" } },
  );

function parseRequestBody(value: unknown): RegistrationEmailRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.type === "RETRY") {
    if (typeof body.delivery_id !== "string" || !body.delivery_id.trim()) {
      return null;
    }
    return { type: "RETRY", delivery_id: body.delivery_id };
  }
  if (body.type !== "INSERT" && body.type !== "UPDATE") return null;
  if (
    typeof body.registration_id !== "string" || !body.registration_id.trim()
  ) {
    return null;
  }
  if (
    body.type === "UPDATE" && (
      typeof body.old_status !== "string" || typeof body.new_status !== "string"
    )
  ) {
    return null;
  }
  return {
    type: body.type,
    registration_id: body.registration_id,
    ...(body.type === "UPDATE"
      ? {
        old_status: body.old_status as string,
        new_status: body.new_status as string,
      }
      : {}),
  };
}

function registrantEmail(record: CanonicalRegistrationDelivery): string | null {
  const fields = record.event.form_fields;
  const emailField = fields.find((field) => field.id === "system_email") ||
    fields.find((field) => field.type === "email");
  const value = emailField
    ? record.registration.form_data[emailField.id]
    : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function eventDate(startDate: string | null): string | null {
  if (!startDate) return null;
  return new Date(startDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formFieldsHtml(record: CanonicalRegistrationDelivery): string {
  return record.event.form_fields.map((field) => {
    const value = record.registration.form_data[field.id];
    return emailField(
      field.label,
      Array.isArray(value) ? value.join(", ") : value,
    );
  }).join("");
}

function waitlistEmail(
  record: CanonicalRegistrationDelivery,
  cancelUrl: string,
): OutgoingEmail {
  const title = escapeHtml(record.event.title);
  const date = eventDate(record.event.start_date);
  const html = wrapEmail(`
    <div class="header"><h1>${title}</h1><p>Registration Waitlisted</p></div>
    <div class="body">
      <p>You've been added to the waitlist. We'll notify you by email if a spot opens up.</p>
      <span class="status-badge" style="background:#fef3c7;color:#92400e;">Waitlisted</span>
      <div class="divider"></div>
      ${date ? emailField("Date", date) : ""}
      ${
    record.event.location ? emailField("Location", record.event.location) : ""
  }
      <div class="divider"></div>
      ${formFieldsHtml(record)}
      <div class="divider"></div>
      <p style="font-size:13px;color:#94a3b8;">Need to cancel? Click below:</p>
      <a href="${
    escapeHtml(cancelUrl)
  }" class="cancel-link">Cancel Registration</a>
    </div>
    <div class="footer">This is an automated confirmation. Please do not reply.</div>
  `);
  return {
    to: registrantEmail(record) || "",
    subject: `Waitlist Confirmation: ${record.event.title}`,
    html,
  };
}

function cancellationEmail(
  record: CanonicalRegistrationDelivery,
): OutgoingEmail {
  const title = escapeHtml(record.event.title);
  return {
    to: registrantEmail(record) || "",
    subject: `Registration Cancelled: ${record.event.title}`,
    html: wrapEmail(`
      <div class="header"><h1>${title}</h1><p>Registration Cancelled</p></div>
      <div class="body">
        <p>Your registration for <strong>${title}</strong> has been successfully cancelled.</p>
        <span class="status-badge" style="background:#fee2e2;color:#991b1b;">Cancelled</span>
      </div>
      <div class="footer">This is an automated confirmation. Please do not reply.</div>
    `),
  };
}

function promotionPaymentHtml(event: CanonicalEvent): string {
  if (!event.payment_enabled) return "";
  const givingUrl = getValidatedTithelyGivingUrl(event);
  const online = givingUrl
    ? `<p><a href="${escapeHtml(givingUrl)}">Complete payment online with Tithe.ly</a></p>`
    : "";
  const inPerson = event.allow_in_person_payment
    ? "<p>You may also pay in person.</p>"
    : "";
  return online || inPerson
    ? `<div class="divider"></div><h2>Payment</h2>${online}${inPerson}`
    : "";
}

function promotionEmail(
  record: CanonicalRegistrationDelivery,
  cancelUrl: string,
): OutgoingEmail {
  const title = escapeHtml(record.event.title);
  const date = eventDate(record.event.start_date);
  return {
    to: registrantEmail(record) || "",
    subject: `Spot Available! ${record.event.title}`,
    html: wrapEmail(`
      <div class="header"><h1>${title}</h1><p>You're In!</p></div>
      <div class="body">
        <p>Great news! A spot has opened up and your registration for <strong>${title}</strong> has been confirmed.</p>
        <span class="status-badge">Confirmed</span>
        <div class="divider"></div>
        ${date ? emailField("Date", date) : ""}
        ${
    record.event.location ? emailField("Location", record.event.location) : ""
  }
        ${promotionPaymentHtml(record.event)}
        <div class="divider"></div>
        <p style="font-size:13px;color:#94a3b8;">Need to cancel? Click below:</p>
        <a href="${
      escapeHtml(cancelUrl)
    }" class="cancel-link">Cancel Registration</a>
      </div>
      <div class="footer">This is an automated confirmation. Please do not reply.</div>
    `),
  };
}

function organizerEmail(
  record: CanonicalRegistrationDelivery,
  organizers: string[],
): OutgoingEmail {
  const rows = record.event.form_fields.map((field) => {
    const value = record.registration.form_data[field.id];
    const display = Array.isArray(value) ? value.join(", ") : value;
    return `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;">${
      escapeHtml(field.label)
    }</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${
      escapeHtml(display)
    }</td></tr>`;
  }).join("");
  const capacity = record.event.capacity
    ? `${record.event.registration_count} / ${record.event.capacity}`
    : String(record.event.registration_count);
  return {
    to: organizers.join(", "),
    subject: `New Registration: ${record.event.title}`,
    html: wrapEmail(`
      <div class="header"><h1>${
      escapeHtml(record.event.title)
    }</h1><p>New Registration Received</p></div>
      <div class="body">
        <p>A new registration has been submitted. Total registrations: <strong>${
      escapeHtml(capacity)
    }</strong></p>
        <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
      </div>
      <div class="footer">You're receiving this because you're listed as an organizer for this event.</div>
    `),
  };
}

function buildLogicalDeliveries(
  request: Exclude<RegistrationEmailRequest, { type: "RETRY" }>,
  record: CanonicalRegistrationDelivery,
  dependencies: RegistrationEmailDependencies,
): { deliveries: LogicalDelivery[]; skipped?: number; code?: string } {
  const email = registrantEmail(record);
  const deliveries: LogicalDelivery[] = [];
  let skipped = email ? 0 : 1;

  if (request.type === "INSERT") {
    if (
      record.registration.status !== "confirmed" &&
      record.registration.status !== "waitlisted"
    ) {
      return { deliveries, code: "transition_mismatch" };
    }
    if (email) {
      const kind: DeliveryKind = record.registration.status === "waitlisted"
        ? "registration_waitlist"
        : "registration_confirmation";
      deliveries.push({
        kind,
        recipient: email,
        occurrence: record.registration.created_at,
        compose: async () => {
          const cancelUrl = await buildCancelUrl(record, dependencies);
          if (kind === "registration_waitlist") {
            return waitlistEmail(record, cancelUrl);
          }
          try {
            const emailContent = buildConfirmedRegistrationEmail({
              event: record.event,
              registration: record.registration,
              formFields: record.event.form_fields,
              eventDate: eventDate(record.event.start_date),
              cancelUrl,
            });
            return { ...emailContent, to: email };
          } catch (error) {
            if ((error as Error).message === "missing_confirmation_message") {
              throw new SanitizedDeliveryError("message_configuration_missing");
            }
            throw error;
          }
        },
      });
    }

    const organizers = (record.event.notifications?.organizers || [])
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    if (record.event.notifications?.perRegistration && organizers.length > 0) {
      deliveries.push({
        kind: "organizer_notification",
        recipient: organizers.join(", "),
        occurrence: record.registration.created_at,
        compose: () => Promise.resolve(organizerEmail(record, organizers)),
      });
    }
    return { deliveries, skipped };
  }

  if (request.new_status !== record.registration.status) {
    return { deliveries, code: "transition_mismatch" };
  }
  if (
    request.old_status !== "cancelled" && request.new_status === "cancelled"
  ) {
    if (email) {
      if (!record.registration.cancelled_at) {
        return { deliveries, code: "canonical_record_mismatch" };
      }
      deliveries.push({
        kind: "registration_cancellation",
        recipient: email,
        occurrence: record.registration.cancelled_at,
        compose: () => Promise.resolve(cancellationEmail(record)),
      });
    }
    return { deliveries, skipped };
  }
  if (
    request.old_status === "waitlisted" && request.new_status === "confirmed"
  ) {
    if (email) {
      if (!record.registration.promoted_at) {
        return { deliveries, code: "canonical_record_mismatch" };
      }
      deliveries.push({
        kind: "waitlist_promotion",
        recipient: email,
        occurrence: record.registration.promoted_at,
        compose: async () =>
          promotionEmail(
            record,
            await buildCancelUrl(record, dependencies),
          ),
      });
    }
    return { deliveries, skipped };
  }
  skipped = 0;
  return { deliveries, skipped, code: "unsupported_transition" };
}

function requestForLifecycleRetry(
  delivery: RegistrationEmailDeliveryRecord,
): Exclude<RegistrationEmailRequest, { type: "RETRY" }> {
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

export async function handleRegistrationEmail(
  request: Request,
  dependencies: RegistrationEmailDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!isTrustedAutomationRequest(request, dependencies.automationSecret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let parsed: RegistrationEmailRequest | null;
  try {
    parsed = parseRequestBody(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return jsonResponse({ error: "invalid_request" }, 400);

  let retryDelivery: RegistrationEmailDeliveryRecord | null = null;
  let deliveryRequest: Exclude<RegistrationEmailRequest, { type: "RETRY" }>;
  let registrationId: string;

  if (parsed.type === "RETRY") {
    const deliveryLoad = await dependencies.loadDelivery(parsed.delivery_id);
    if (deliveryLoad.status === "error") {
      return jsonResponse({ error: "delivery_load_failed" }, 500);
    }
    if (deliveryLoad.status === "missing") {
      return jsonResponse({ skipped: true, code: "delivery_missing" });
    }
    retryDelivery = deliveryLoad.delivery;
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
    registrationId = retryDelivery.registration_id;
    deliveryRequest = requestForLifecycleRetry(retryDelivery);
  } else {
    registrationId = parsed.registration_id;
    deliveryRequest = parsed;
  }

  const loaded = await dependencies.loadCanonicalDelivery(
    registrationId,
  );
  if (loaded.status === "error") {
    return jsonResponse({ error: "canonical_load_failed" }, 500);
  }
  if (loaded.status === "missing") {
    return jsonResponse({ skipped: true, code: "canonical_record_missing" });
  }
  const record = loaded.record;
  if (
    record.registration.id !== registrationId ||
    record.registration.event_id !== record.event.id ||
    record.registration.org_id !== record.organization.id ||
    record.event.org_id !== record.organization.id
  ) {
    return jsonResponse({ skipped: true, code: "canonical_record_mismatch" });
  }

  if (
    retryDelivery &&
    !matchesApplicableRegistrationLifecycleDelivery({
      registration: record.registration,
      delivery: retryDelivery,
    })
  ) {
    return jsonResponse({ skipped: true, code: "not_applicable" });
  }

  const logical = buildLogicalDeliveries(deliveryRequest, record, dependencies);
  if (logical.code) return jsonResponse({ skipped: true, code: logical.code });
  if (retryDelivery) {
    logical.deliveries = logical.deliveries.filter((delivery) =>
      delivery.kind === retryDelivery?.kind &&
      registrationDeliveryKey(
          delivery.kind,
          record.registration.id,
          delivery.occurrence,
        ) === retryDelivery?.delivery_key
    );
    logical.skipped = 0;
    if (logical.deliveries.length !== 1) {
      return jsonResponse({ skipped: true, code: "not_applicable" });
    }
  }

  const counts = {
    sent: 0,
    already_sent: 0,
    in_progress: 0,
    failed: 0,
    skipped: logical.skipped || 0,
  };
  let passwordPromise: Promise<string> | null = null;
  const password = () => {
    if (!record.organization.smtp_config?.auth?.user) {
      return Promise.resolve("");
    }
    passwordPromise ||= dependencies.loadSmtpPassword(record.organization.id);
    return passwordPromise;
  };

  for (const logicalDelivery of logical.deliveries) {
    const result = await dependencies.deliver({
      deliveryKey: registrationDeliveryKey(
        logicalDelivery.kind,
        record.registration.id,
        logicalDelivery.occurrence,
      ),
      orgId: record.organization.id,
      eventId: record.event.id,
      registrationId: record.registration.id,
      kind: logicalDelivery.kind,
    }, async () => {
      const smtpConfig = record.organization.smtp_config;
      if (!smtpConfig?.host || !smtpConfig.fromEmail) {
        throw new SanitizedDeliveryError("smtp_not_configured");
      }
      let smtpPassword: string;
      try {
        smtpPassword = await password();
      } catch {
        throw new SanitizedDeliveryError("smtp_not_configured");
      }
      const outgoing = await logicalDelivery.compose();
      await dependencies.send({
        ...outgoing,
        to: logicalDelivery.recipient,
        config: smtpConfig,
        password: smtpPassword,
        orgName: record.organization.name,
      });
    });
    counts[result === "already_sent" ? "already_sent" : result] += 1;
  }

  return jsonResponse({ success: counts.failed === 0, ...counts });
}

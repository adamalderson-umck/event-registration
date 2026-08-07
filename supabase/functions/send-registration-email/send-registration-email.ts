import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseDeliveryStore,
  deliverOnce,
  SanitizedDeliveryError,
} from "../_shared/email-delivery.ts";
import { loadSmtpPassword, sendHtmlEmail } from "../_shared/org-smtp.ts";
import {
  type CanonicalRegistrationDelivery,
  handleRegistrationEmail,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const deliveryStore = createSupabaseDeliveryStore(client);

async function generateCancelToken(
  orgId: string,
  registrationId: string,
): Promise<string> {
  const secret = Deno.env.get("CANCEL_TOKEN_SECRET");
  if (!secret) {
    throw new SanitizedDeliveryError("cancel_token_not_configured");
  }

  const encoder = new TextEncoder();
  const message = `${orgId}:${registrationId}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  const hexSignature = Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return btoa(`${orgId}:${registrationId}:${hexSignature}`);
}

function publicBaseUrl(): URL {
  const configured = Deno.env.get("BASE_URL");
  if (configured) return new URL(configured);

  const projectUrl = new URL(supabaseUrl);
  return new URL(
    `${projectUrl.protocol}//${
      projectUrl.hostname.replace(".supabase.co", ".web.app")
    }`,
  );
}

async function loadCanonicalDelivery(
  registrationId: string,
): Promise<CanonicalRegistrationDelivery | null> {
  const { data: registration, error: registrationError } = await client
    .from("registrations")
    .select(
      "id, org_id, event_id, status, form_data, payment_method, payment_status, legacy_payment_paid, created_at, updated_at",
    )
    .eq("id", registrationId)
    .maybeSingle();
  if (registrationError || !registration) return null;

  const [
    { data: event, error: eventError },
    { data: organization, error: orgError },
  ] = await Promise.all([
    client.from("events").select(
      "id, org_id, title, event_type, start_date, location, capacity, registration_count, form_fields, notifications, confirmation_message",
    ).eq("id", registration.event_id).maybeSingle(),
    client.from("organizations").select("id, name, smtp_config")
      .eq("id", registration.org_id).maybeSingle(),
  ]);
  if (eventError || orgError || !event || !organization) return null;

  return { registration, event, organization } as CanonicalRegistrationDelivery;
}

Deno.serve((request: Request) =>
  handleRegistrationEmail(request, {
    serviceRoleKey,
    loadCanonicalDelivery,
    async buildCancelUrl(record) {
      const token = await generateCancelToken(
        record.organization.id,
        record.registration.id,
      );
      const url = new URL("/", publicBaseUrl());
      url.searchParams.set("cancel", "true");
      url.searchParams.set("token", token);
      return url.toString();
    },
    loadSmtpPassword: (orgId) => loadSmtpPassword(client, orgId),
    deliver: (claim, send) => deliverOnce(deliveryStore, claim, send),
    send: sendHtmlEmail,
  })
);

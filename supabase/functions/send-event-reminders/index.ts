import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseDeliveryStore,
  deliverOnce,
} from "../_shared/email-delivery.ts";
import { loadSmtpPassword, sendHtmlEmail } from "../_shared/org-smtp.ts";
import {
  type CanonicalReminderEvent,
  type CanonicalReminderRecipient,
  handleEventReminders,
} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const automationSecret = Deno.env.get("EMAIL_AUTOMATION_SECRET") || "";
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const deliveryStore = createSupabaseDeliveryStore(client);

async function loadDueEvents(
  _now: Date,
): Promise<CanonicalReminderEvent[]> {
  const { data: events, error } = await client.from("events").select(
    "id, org_id, title, event_type, status, start_date, end_date, location, reminder_hours_before, reminder_message, form_fields",
  ).eq("status", "active")
    .not("reminder_hours_before", "is", null)
    .not("start_date", "is", null)
    .is("reminder_sent_at", null);
  if (error) throw new Error("event_query_failed");

  const canonical = await Promise.all((events || []).map(async (event) => {
    const { data: organization, error: orgError } = await client
      .from("organizations")
      .select("id, name, smtp_config")
      .eq("id", event.org_id)
      .maybeSingle();
    if (orgError || !organization) return null;
    return { ...event, organization } as CanonicalReminderEvent;
  }));
  return canonical.filter((event): event is CanonicalReminderEvent =>
    event !== null
  );
}

async function loadConfirmedRecipients(
  eventId: string,
): Promise<CanonicalReminderRecipient[]> {
  const { data, error } = await client.from("registrations").select(
    "id, org_id, event_id, status, form_data, payment_method, payment_status, legacy_payment_paid",
  ).eq("event_id", eventId).eq("status", "confirmed");
  if (error) throw new Error("recipient_query_failed");
  return (data || []) as CanonicalReminderRecipient[];
}

async function markReminderComplete(
  eventId: string,
  completedAt: Date,
): Promise<void> {
  const { error } = await client.from("events")
    .update({ reminder_sent_at: completedAt.toISOString() })
    .eq("id", eventId)
    .is("reminder_sent_at", null);
  if (error) throw new Error("reminder_completion_failed");
}

Deno.serve((request: Request) =>
  handleEventReminders(request, {
    automationSecret,
    now: () => new Date(),
    loadDueEvents,
    loadConfirmedRecipients,
    loadSmtpPassword: (orgId) => loadSmtpPassword(client, orgId),
    deliver: (claim, send) => deliverOnce(deliveryStore, claim, send),
    send: sendHtmlEmail,
    markReminderComplete,
  })
);

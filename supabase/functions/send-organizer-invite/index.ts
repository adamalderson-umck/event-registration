import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "npm:emailjs@4";
import { isKentMethodistGoogleUser } from "../_shared/admin-access.ts";

interface RequestBody {
  eventId: string;
  recipientEmail: string;
  orgId: string;
}

interface SmtpConfig {
  host: string;
  port?: number;
  fromName?: string;
  fromEmail: string;
  auth?: { user: string };
}

interface EventNotifications {
  organizers?: string[];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(value) && !/[\r\n]/.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const supabaseUser = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: callingUser }, error: authError } =
      await supabaseUser.auth.getUser();
    const { data: databaseAuthorized, error: accessError } =
      await supabaseUser.rpc("is_kentmethodist_admin");

    if (
      authError || accessError || !isKentMethodistGoogleUser(callingUser) ||
      databaseAuthorized !== true
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { eventId, recipientEmail, orgId }: RequestBody = await req.json();
    const normalizedRecipient = typeof recipientEmail === "string"
      ? recipientEmail.trim().toLowerCase()
      : "";

    if (!eventId || !orgId || !isEmail(normalizedRecipient)) {
      return json({ error: "Missing or invalid required fields" }, 400);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", callingUser!.id)
      .maybeSingle();
    if (membershipError || !membership) return json({ error: "Forbidden" }, 403);

    const [{ data: org, error: orgError }, { data: event, error: eventError }] =
      await Promise.all([
        supabase.from("organizations").select("name, smtp_config").eq("id", orgId).single(),
        supabase.from("events").select("title, notifications").eq("id", eventId)
          .eq("org_id", orgId).single(),
      ]);

    if (orgError || !org || eventError || !event) {
      return json({ error: "Organization or event not found" }, 404);
    }

    const organizers = (event.notifications as EventNotifications | null)?.organizers || [];
    if (!organizers.some((email) => email.trim().toLowerCase() === normalizedRecipient)) {
      return json({ error: "Recipient is not an organizer for this event" }, 403);
    }

    const smtpConfig = org.smtp_config as SmtpConfig | null;
    if (!smtpConfig?.host) return json({ skipped: true, reason: "no smtp config" });

    const { data: smtpPassword, error: secretError } =
      await supabase.rpc("get_org_smtp_secret", { p_org_id: orgId });
    if (secretError) throw secretError;

    const senderName = callingUser!.user_metadata?.full_name ||
      callingUser!.user_metadata?.name || "An administrator";
    const safeTitle = escapeHtml(event.title);
    const safeSender = escapeHtml(senderName);
    const safeOrgName = escapeHtml(org.name);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
    <div style="background:#2563eb;padding:24px 32px;color:white"><h1>${safeTitle}</h1><p>Notification Subscription</p></div>
    <div style="padding:32px"><p><strong>${safeSender}</strong> added you to the notification list for <strong>${safeTitle}</strong>.</p><p>You will receive email notifications when new registrations are submitted for this event.</p></div>
    <div style="padding:16px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#64748b">You're receiving this because your email was added as an event organizer by ${safeOrgName}.</div>
  </div>
</body></html>`;

    const port = smtpConfig.port || 465;
    const client = new SMTPClient({
      host: smtpConfig.host,
      port,
      ssl: port === 465,
      user: smtpConfig.auth?.user,
      password: smtpPassword || undefined,
    });

    await client.sendAsync({
      from: `"${smtpConfig.fromName || org.name}" <${smtpConfig.fromEmail}>`,
      to: normalizedRecipient,
      subject: `You've been added to notifications: ${event.title}`,
      attachment: [{ data: html, alternative: true }],
    });

    return json({ success: true });
  } catch (error) {
    console.error("send-organizer-invite error:", error);
    return json({ error: (error as Error).message || "Internal error" }, 500);
  }
});

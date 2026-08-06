import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "npm:emailjs@4";

/**
 * weekly-digest
 *
 * Replaces the Firebase scheduled Cloud Function.
 * Called via Supabase pg_cron or an external scheduler (e.g., cron-job.org).
 * Aggregates registration stats for each event with weekly digest enabled
 * and sends digest emails to organizers.
 */

interface SmtpConfig {
  host: string;
  port?: number;
  fromName?: string;
  fromEmail: string;
  auth?: { user: string; pass: string };
}

function wrapEmail(content: string): string {
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
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .stat-box { background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1e293b; }
    .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .footer { padding: 16px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}

async function sendEmail(
  smtpConfig: SmtpConfig,
  orgName: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const client = new SMTPClient({
    host: smtpConfig.host,
    port: smtpConfig.port || 465,
    ssl: (smtpConfig.port || 465) === 465,
    user: smtpConfig.auth?.user,
    password: smtpConfig.auth?.pass,
  });

  await client.sendAsync({
    from: `"${smtpConfig.fromName || orgName}" <${smtpConfig.fromEmail}>`,
    to,
    subject,
    attachment: [{ data: html, alternative: true }],
  });
}

Deno.serve(async (req: Request) => {
  // Accept POST (from pg_cron webhook) or GET (from external scheduler)
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get all organizations with SMTP config
    const { data: orgs, error: orgErr } = await supabase
      .from("organizations")
      .select("*")
      .not("smtp_config", "is", null);

    if (orgErr) throw orgErr;

    let digestsSent = 0;

    for (const org of orgs || []) {
      const smtpConfig = org.smtp_config as SmtpConfig | null;
      if (!smtpConfig?.host) continue;

      // Get events with weekly digest enabled
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .eq("org_id", org.id);

      for (const event of events || []) {
        const notifications = event.notifications as Record<string, unknown> | null;
        if (!notifications?.weeklyDigest) continue;

        const organizers = (notifications?.organizers as string[]) || [];
        if (organizers.length === 0) continue;

        // Check if today matches configured digest day
        const today = new Date();
        const dayName = today.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
        const digestDay = (notifications?.digestDay as string) || "monday";
        if (dayName !== digestDay) continue;

        try {
          // Calculate week range
          const weekEnd = new Date();
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - 7);

          // Count registrations from this week
          const { count: newCount } = await supabase
            .from("registrations")
            .select("id", { count: "exact", head: true })
            .eq("event_id", event.id)
            .gte("created_at", weekStart.toISOString());

          // Counts by status
          const { data: allRegs } = await supabase
            .from("registrations")
            .select("status")
            .eq("event_id", event.id);

          const confirmed = (allRegs || []).filter((r) => r.status === "confirmed").length;
          const waitlisted = (allRegs || []).filter((r) => r.status === "waitlisted").length;
          const totalRegistrations = (allRegs || []).length;

          const capacityText = event.capacity
            ? `${totalRegistrations} / ${event.capacity}`
            : String(totalRegistrations);

          const html = wrapEmail(`
            <div class="header"><h1>${event.title}</h1><p>Weekly Registration Digest</p></div>
            <div class="body">
              <p style="font-size:13px;color:#94a3b8;margin:0 0 16px;">
                ${weekStart.toLocaleDateString()} \u2014 ${weekEnd.toLocaleDateString()}
              </p>
              <div class="stats-grid">
                <div class="stat-box"><div class="stat-value">${newCount || 0}</div><div class="stat-label">New This Week</div></div>
                <div class="stat-box"><div class="stat-value">${capacityText}</div><div class="stat-label">Total / Capacity</div></div>
                <div class="stat-box"><div class="stat-value">${confirmed}</div><div class="stat-label">Confirmed</div></div>
                <div class="stat-box"><div class="stat-value">${waitlisted}</div><div class="stat-label">Waitlisted</div></div>
              </div>
            </div>
            <div class="footer">You're receiving this because you're listed as an organizer for this event.</div>
          `);

          await sendEmail(smtpConfig, org.name, organizers.join(", "), `Weekly Digest: ${event.title}`, html);
          console.log(`Digest sent for ${event.title} to ${organizers.length} organizers`);
          digestsSent++;
        } catch (err) {
          console.error(`Digest error for event ${event.id}:`, err);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, digestsSent }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("weekly-digest error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

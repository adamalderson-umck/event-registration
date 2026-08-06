import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "npm:emailjs@4";

/**
 * send-event-reminders
 *
 * Cron-invoked Edge Function that sends pre-event reminder emails.
 * Checks for active events with:
 *   - reminder_hours_before set
 *   - start_date within the reminder window
 *   - reminder_sent_at IS NULL (not yet sent)
 *
 * For each matching event, emails all confirmed registrants via the org's SMTP config.
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
    .field { margin-bottom: 16px; }
    .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 600; margin-bottom: 2px; }
    .field-value { font-size: 15px; color: #1e293b; }
    .footer { padding: 16px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
    .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();

  // Fetch events that are due for a reminder
  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("*, organizations!events_org_id_fkey(*)")
    .eq("status", "active")
    .not("reminder_hours_before", "is", null)
    .not("start_date", "is", null)
    .is("reminder_sent_at", null);

  if (eventsErr) {
    console.error("Error fetching events:", eventsErr);
    return new Response(JSON.stringify({ error: eventsErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let totalSent = 0;

  for (const event of events || []) {
    const startTime = new Date(event.start_date as string).getTime();
    const reminderThreshold = startTime - (event.reminder_hours_before as number) * 60 * 60 * 1000;

    // Only send if we've passed the reminder threshold but the event hasn't started yet
    if (now.getTime() < reminderThreshold || now.getTime() >= startTime) continue;

    const org = event.organizations as Record<string, unknown>;
    const smtpConfig = org?.smtp_config as SmtpConfig | null;
    if (!smtpConfig?.host) {
      console.log(`No SMTP config for org ${org?.name}, skipping`);
      continue;
    }

    // Fetch confirmed registrations
    const { data: regs } = await supabase
      .from("registrations")
      .select("*")
      .eq("event_id", event.id)
      .eq("status", "confirmed");

    if (!regs || regs.length === 0) continue;

    const formFields = (event.form_fields || []) as Array<{ id: string; type: string; label: string }>;
    const emailField = formFields.find((f) => f.type === "email");

    const client = new SMTPClient({
      host: smtpConfig.host,
      port: smtpConfig.port || 465,
      ssl: (smtpConfig.port || 465) === 465,
      user: smtpConfig.auth?.user,
      password: smtpConfig.auth?.pass,
    });

    const eventDate = new Date(event.start_date as string).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const eventTime = new Date(event.start_date as string).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    });

    // Build Google Calendar link for the reminder email
    const startDt = new Date(event.start_date as string);
    const endDt = event.end_date ? new Date(event.end_date as string) : new Date(startDt.getTime() + 60 * 60 * 1000);
    const toGoogleDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const calParams = new URLSearchParams({
      action: "TEMPLATE",
      text: event.title || "",
      dates: `${toGoogleDate(startDt)}/${toGoogleDate(endDt)}`,
      location: event.location || "",
    });
    const googleCalUrl = `https://calendar.google.com/calendar/render?${calParams.toString()}`;

    for (const reg of regs) {
      const formData = reg.form_data as Record<string, unknown>;
      const recipientEmail = emailField ? (formData?.[emailField.id] as string) : null;
      if (!recipientEmail) continue;

      const html = wrapEmail(`
        <div class="header">
          <h1>${event.title}</h1>
          <p>Event Reminder \ud83d\udcc5</p>
        </div>
        <div class="body">
          <p style="font-size:15px;color:#475569;margin:0 0 16px;">
            This is a friendly reminder that <strong>${event.title}</strong> is coming up soon!
          </p>
          <div class="field">
            <div class="field-label">Date</div>
            <div class="field-value">${eventDate}</div>
          </div>
          <div class="field">
            <div class="field-label">Time</div>
            <div class="field-value">${eventTime}</div>
          </div>
          ${event.location ? `<div class="field"><div class="field-label">Location</div><div class="field-value">${event.location}</div></div>` : ""}
          <div class="divider"></div>
          <p style="font-size:13px;color:#94a3b8;">Add to your calendar:</p>
          <a href="${googleCalUrl}" style="color:#2563eb;font-size:13px;text-decoration:underline;" target="_blank">Add to Google Calendar</a>
        </div>
        <div class="footer">You're receiving this because you're registered for this event.</div>
      `);

      try {
        await client.sendAsync({
          from: `"${smtpConfig.fromName || (org?.name as string)}" <${smtpConfig.fromEmail}>`,
          to: recipientEmail,
          subject: `Reminder: ${event.title} is coming up!`,
          attachment: [{ data: html, alternative: true }],
        });
        totalSent++;
      } catch (emailErr) {
        console.error(`Failed to send reminder to ${recipientEmail}:`, emailErr);
      }
    }

    // Mark reminder as sent
    const { error: updateErr } = await supabase
      .from("events")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", event.id);

    if (updateErr) {
      console.error(`Failed to mark reminder_sent_at for event ${event.id}:`, updateErr);
    } else {
      console.log(`Sent ${regs.length} reminders for event "${event.title}"`);
    }
  }

  return new Response(JSON.stringify({ success: true, sent: totalSent }), {
    headers: { "Content-Type": "application/json" },
  });
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "npm:emailjs@4";

/**
 * send-registration-email
 *
 * Called via Supabase Database Webhook on registration INSERT or UPDATE.
 * Handles:
 * - Confirmation emails (on new registration)
 * - Cancellation emails (when status changes to 'cancelled')
 * - Waitlist promotion emails (when status changes from waitlisted to confirmed)
 * - Per-registration organizer notifications
 */

interface WebhookPayload {
  type: "INSERT" | "UPDATE";
  table: string;
  record: Record<string, unknown>;
  old_record: Record<string, unknown> | null;
}

// --- Security: HTML escaping to prevent XSS in emails ---
function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "\u2014";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Security: HMAC-SHA256 cancel token generation ---
async function generateCancelToken(orgId: string, registrationId: string): Promise<string> {
  const secret = Deno.env.get("CANCEL_TOKEN_SECRET");
  if (!secret) {
    console.warn("CANCEL_TOKEN_SECRET not set, using fallback (INSECURE)");
    return btoa(`${orgId}:${registrationId}`);
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
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return btoa(`${orgId}:${registrationId}:${hexSig}`);
}

// Email template helpers
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
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .status-confirmed { background: #dcfce7; color: #166534; }
    .status-waitlisted { background: #fef3c7; color: #92400e; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
    .cancel-link { display: inline-block; margin-top: 16px; padding: 10px 24px; background: #ef4444; color: white !important; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
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

interface SmtpConfig {
  host: string;
  port?: number;
  fromName?: string;
  fromEmail: string;
  auth?: { user: string; pass: string };
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
    from: `"${escapeHtml(smtpConfig.fromName || orgName)}" <${smtpConfig.fromEmail}>`,
    to,
    subject,
    attachment: [{ data: html, alternative: true }],
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const { type, record, old_record } = payload;

    if (!record) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const orgId = record.org_id as string;
    const eventId = record.event_id as string;
    const regId = record.id as string;

    // Fetch org and event data
    const [{ data: org }, { data: event }] = await Promise.all([
      supabase.from("organizations").select("name, smtp_config").eq("id", orgId).single(),
      supabase.from("events").select("title, start_date, location, capacity, registration_count, form_fields, notifications").eq("id", eventId).single(),
    ]);

    if (!org || !event) {
      console.error("Org or event not found", { orgId, eventId });
      return new Response(JSON.stringify({ skipped: true, reason: "missing data" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let smtpConfig = org.smtp_config as SmtpConfig | null;
    if (!smtpConfig?.host) {
      console.log("No SMTP config, skipping email");
      return new Response(JSON.stringify({ skipped: true, reason: "no smtp" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Vault Integration: Fetch SMTP password via RPC
    // supabase.schema('vault') is not supported for custom schemas in the JS client REST layer;
    // the correct approach per Supabase docs is a SECURITY DEFINER RPC function.
    let finalAuth = { ...smtpConfig.auth };
    if (finalAuth && finalAuth.user && !finalAuth.pass) {
      const { data: smtpPassword, error: vaultError } = await supabase
        .rpc('get_org_smtp_secret', { p_org_id: orgId });

      if (vaultError) {
        console.error(`Vault RPC error for org_smtp_${orgId}:`, vaultError.message);
      }

      if (smtpPassword) {
        finalAuth.pass = smtpPassword;
      } else {
        console.error(`Missing vault secret for org_smtp_${orgId}`);
        return new Response(JSON.stringify({ skipped: true, reason: "missing smtp password in vault" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    smtpConfig = { ...smtpConfig, auth: finalAuth };

    // Find registrant email from form data
    const formFields = (event.form_fields || []) as Array<{ id: string; type: string; label: string }>;
    const emailField = formFields.find((f) => f.id === "system_email") || formFields.find((f) => f.type === "email");
    const formData = record.form_data as Record<string, unknown>;
    const registrantEmail = emailField ? (formData?.[emailField.id] as string) : null;

    const BASE_URL = Deno.env.get("BASE_URL") || `${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", ".web.app")}`;

    // Handle INSERT - new registration
    if (type === "INSERT") {
      const status = record.status as string;

      // Send confirmation email to registrant
      if (registrantEmail) {
        const cancelToken = await generateCancelToken(orgId, regId);
        const cancelUrl = `${BASE_URL}/?cancel=true&token=${encodeURIComponent(cancelToken)}`;

        const eventDate = event.start_date
          ? new Date(event.start_date as string).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })
          : null;

        const statusClass = status === "waitlisted" ? "status-waitlisted" : "status-confirmed";
        const statusText = status === "waitlisted" ? "Waitlisted" : "Confirmed";
        const statusMessage = status === "waitlisted"
          ? "You've been added to the waitlist. We'll notify you by email if a spot opens up."
          : "Your registration has been confirmed!";

        const fieldsHtml = formFields.map((field) => {
          const value = formData?.[field.id];
          const displayValue = Array.isArray(value) ? escapeHtml(value.join(", ")) : escapeHtml(value);
          return `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${displayValue}</div></div>`;
        }).join("");

        const safeTitle = escapeHtml(event.title);
        const safeLocation = escapeHtml(event.location);

        const html = wrapEmail(`
          <div class="header"><h1>${safeTitle}</h1><p>Registration ${statusText}</p></div>
          <div class="body">
            <p style="margin:0 0 8px;font-size:15px;color:#475569;">${statusMessage}</p>
            <span class="${statusClass} status-badge">${statusText}</span>
            <div class="divider"></div>
            ${eventDate ? `<div class="field"><div class="field-label">Date</div><div class="field-value">${eventDate}</div></div>` : ""}
            ${event.location ? `<div class="field"><div class="field-label">Location</div><div class="field-value">${safeLocation}</div></div>` : ""}
            <div class="divider"></div>
            ${fieldsHtml}
            <div class="divider"></div>
            <p style="font-size:13px;color:#94a3b8;">Need to cancel? Click below:</p>
            <a href="${cancelUrl}" class="cancel-link">Cancel Registration</a>
          </div>
          <div class="footer">This is an automated confirmation. Please do not reply.</div>
        `);

        await sendEmail(smtpConfig, org.name, registrantEmail,
          status === "waitlisted" ? `Waitlist Confirmation: ${event.title}` : `Registration Confirmed: ${event.title}`,
          html);
        console.log(`Confirmation email sent to ${registrantEmail} (${status})`);
      }

      // Per-registration organizer notification
      const organizers = (event.notifications as Record<string, unknown>)?.organizers as string[] || [];
      const perReg = (event.notifications as Record<string, unknown>)?.perRegistration as boolean;
      if (perReg && organizers.length > 0) {
        const fieldsHtml = formFields.map((field) => {
          const value = formData?.[field.id];
          const displayValue = Array.isArray(value) ? escapeHtml(value.join(", ")) : escapeHtml(value);
          return `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;">${escapeHtml(field.label)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${displayValue}</td></tr>`;
        }).join("");

        const capacityText = event.capacity ? `${(event.registration_count || 0)} / ${event.capacity}` : String(event.registration_count || 0);
        const safeTitle = escapeHtml(event.title);
        const html = wrapEmail(`
          <div class="header"><h1>${safeTitle}</h1><p>New Registration Received</p></div>
          <div class="body">
            <p style="font-size:14px;color:#475569;margin:0 0 16px;">A new registration has been submitted. Total registrations: <strong>${capacityText}</strong></p>
            <table style="width:100%;border-collapse:collapse;"><tbody>${fieldsHtml}</tbody></table>
          </div>
          <div class="footer">You're receiving this because you're listed as an organizer for this event.</div>
        `);

        await sendEmail(smtpConfig, org.name, organizers.join(", "), `New Registration: ${event.title}`, html);
        console.log(`Organizer notification sent to ${organizers.length} organizers`);
      }
    }

    // Handle UPDATE - cancellation or promotion
    if (type === "UPDATE" && old_record) {
      const oldStatus = old_record.status as string;
      const newStatus = record.status as string;

      // Cancellation
      if (oldStatus !== "cancelled" && newStatus === "cancelled" && registrantEmail) {
        const safeTitle = escapeHtml(event.title);
        const html = wrapEmail(`
          <div class="header"><h1>${safeTitle}</h1><p>Registration Cancelled</p></div>
          <div class="body">
            <p style="font-size:15px;color:#475569;">Your registration for <strong>${safeTitle}</strong> has been successfully cancelled.</p>
            <span class="status-cancelled status-badge">Cancelled</span>
          </div>
          <div class="footer">This is an automated confirmation. Please do not reply.</div>
        `);

        await sendEmail(smtpConfig, org.name, registrantEmail, `Registration Cancelled: ${event.title}`, html);
        console.log(`Cancellation email sent to ${registrantEmail}`);
      }

      // Waitlist promotion
      if (oldStatus === "waitlisted" && newStatus === "confirmed" && registrantEmail) {
        const cancelToken = await generateCancelToken(orgId, regId);
        const cancelUrl = `${BASE_URL}/?cancel=true&token=${encodeURIComponent(cancelToken)}`;

        const eventDate = event.start_date
          ? new Date(event.start_date as string).toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })
          : null;

        const safeTitle = escapeHtml(event.title);
        const safeLocation = escapeHtml(event.location);

        const html = wrapEmail(`
          <div class="header"><h1>${safeTitle}</h1><p>You're In!</p></div>
          <div class="body">
            <p style="font-size:15px;color:#475569;">Great news! A spot has opened up and your registration for <strong>${safeTitle}</strong> has been confirmed.</p>
            <span class="status-confirmed status-badge">Confirmed</span>
            <div class="divider"></div>
            ${eventDate ? `<div class="field"><div class="field-label">Date</div><div class="field-value">${eventDate}</div></div>` : ""}
            ${event.location ? `<div class="field"><div class="field-label">Location</div><div class="field-value">${safeLocation}</div></div>` : ""}
            <div class="divider"></div>
            <p style="font-size:13px;color:#94a3b8;">Need to cancel? Click below:</p>
            <a href="${cancelUrl}" class="cancel-link">Cancel Registration</a>
          </div>
          <div class="footer">This is an automated confirmation. Please do not reply.</div>
        `);

        await sendEmail(smtpConfig, org.name, registrantEmail, `Spot Available! ${event.title}`, html);
        console.log(`Waitlist promotion email sent to ${registrantEmail}`);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-registration-email error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

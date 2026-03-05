/**
 * Email templates for the event registration system.
 * Returns HTML strings for confirmation, cancellation, waitlist promotion,
 * organizer notifications, and weekly digest emails.
 */

/**
 * Generate a cancel token for self-service cancellation.
 * Simple base64 encoding of orgId:registrationId.
 * TODO: Add HMAC signature for production security.
 */
function generateCancelToken(orgId, registrationId) {
    return Buffer.from(`${orgId}:${registrationId}`).toString("base64");
}

function wrapEmail(content) {
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
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .stat-box { background: #f8fafc; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1e293b; }
    .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}

/**
 * Registration confirmation email sent to the registrant.
 */
function confirmationEmail({ eventTitle, eventDate, eventLocation, formData, formFields, status, cancelUrl }) {
    const statusClass = status === "waitlisted" ? "status-waitlisted" : "status-confirmed";
    const statusText = status === "waitlisted" ? "Waitlisted" : "Confirmed";
    const statusMessage = status === "waitlisted"
        ? "You've been added to the waitlist. We'll notify you by email if a spot opens up."
        : "Your registration has been confirmed!";

    const fieldsHtml = (formFields || []).map((field) => {
        const value = formData?.[field.id];
        const displayValue = Array.isArray(value) ? value.join(", ") : (value || "—");
        return `<div class="field">
      <div class="field-label">${field.label}</div>
      <div class="field-value">${displayValue}</div>
    </div>`;
    }).join("");

    return wrapEmail(`
    <div class="header">
      <h1>${eventTitle}</h1>
      <p>Registration ${statusText}</p>
    </div>
    <div class="body">
      <p style="margin: 0 0 8px; font-size: 15px; color: #475569;">${statusMessage}</p>
      <span class="${statusClass} status-badge">${statusText}</span>
      <div class="divider"></div>

      ${eventDate ? `<div class="field"><div class="field-label">Date</div><div class="field-value">${eventDate}</div></div>` : ""}
      ${eventLocation ? `<div class="field"><div class="field-label">Location</div><div class="field-value">${eventLocation}</div></div>` : ""}

      <div class="divider"></div>
      ${fieldsHtml}

      ${cancelUrl ? `<div class="divider"></div>
      <p style="font-size: 13px; color: #94a3b8;">Need to cancel? Click below:</p>
      <a href="${cancelUrl}" class="cancel-link">Cancel Registration</a>` : ""}
    </div>
    <div class="footer">
      This is an automated confirmation. Please do not reply.
    </div>
  `);
}

/**
 * Cancellation confirmation email sent to registrant.
 */
function cancellationEmail({ eventTitle }) {
    return wrapEmail(`
    <div class="header">
      <h1>${eventTitle}</h1>
      <p>Registration Cancelled</p>
    </div>
    <div class="body">
      <p style="font-size: 15px; color: #475569;">
        Your registration for <strong>${eventTitle}</strong> has been successfully cancelled.
      </p>
      <span class="status-cancelled status-badge">Cancelled</span>
    </div>
    <div class="footer">
      This is an automated confirmation. Please do not reply.
    </div>
  `);
}

/**
 * Waitlist promotion email — sent when a spot opens.
 */
function waitlistPromotionEmail({ eventTitle, eventDate, eventLocation, cancelUrl }) {
    return wrapEmail(`
    <div class="header">
      <h1>${eventTitle}</h1>
      <p>You're In! 🎉</p>
    </div>
    <div class="body">
      <p style="font-size: 15px; color: #475569;">
        Great news! A spot has opened up and your registration for
        <strong>${eventTitle}</strong> has been confirmed.
      </p>
      <span class="status-confirmed status-badge">Confirmed</span>
      <div class="divider"></div>
      ${eventDate ? `<div class="field"><div class="field-label">Date</div><div class="field-value">${eventDate}</div></div>` : ""}
      ${eventLocation ? `<div class="field"><div class="field-label">Location</div><div class="field-value">${eventLocation}</div></div>` : ""}
      ${cancelUrl ? `<div class="divider"></div>
      <p style="font-size: 13px; color: #94a3b8;">Need to cancel? Click below:</p>
      <a href="${cancelUrl}" class="cancel-link">Cancel Registration</a>` : ""}
    </div>
    <div class="footer">
      This is an automated confirmation. Please do not reply.
    </div>
  `);
}

/**
 * Per-registration notification sent to organizers.
 */
function organizerNotificationEmail({ eventTitle, formData, formFields, registrationCount, capacity }) {
    const fieldsHtml = (formFields || []).map((field) => {
        const value = formData?.[field.id];
        const displayValue = Array.isArray(value) ? value.join(", ") : (value || "—");
        return `<tr><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;">${field.label}</td>
    <td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:13px;color:#1e293b;">${displayValue}</td></tr>`;
    }).join("");

    const capacityText = capacity ? `${registrationCount} / ${capacity}` : registrationCount;

    return wrapEmail(`
    <div class="header">
      <h1>${eventTitle}</h1>
      <p>New Registration Received</p>
    </div>
    <div class="body">
      <p style="font-size: 14px; color: #475569; margin: 0 0 16px;">
        A new registration has been submitted. Total registrations: <strong>${capacityText}</strong>
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${fieldsHtml}</tbody>
      </table>
    </div>
    <div class="footer">
      You're receiving this because you're listed as an organizer for this event.
    </div>
  `);
}

/**
 * Weekly digest email sent to organizers.
 */
function weeklyDigestEmail({ eventTitle, weekStart, weekEnd, newRegistrations, totalRegistrations, capacity, confirmedCount, waitlistedCount }) {
    const capacityText = capacity ? `${totalRegistrations} / ${capacity}` : totalRegistrations;

    return wrapEmail(`
    <div class="header">
      <h1>${eventTitle}</h1>
      <p>Weekly Registration Digest</p>
    </div>
    <div class="body">
      <p style="font-size: 13px; color: #94a3b8; margin: 0 0 16px;">
        ${weekStart} — ${weekEnd}
      </p>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value">${newRegistrations}</div>
          <div class="stat-label">New This Week</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${capacityText}</div>
          <div class="stat-label">Total / Capacity</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${confirmedCount}</div>
          <div class="stat-label">Confirmed</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${waitlistedCount}</div>
          <div class="stat-label">Waitlisted</div>
        </div>
      </div>
    </div>
    <div class="footer">
      You're receiving this because you're listed as an organizer for this event.
    </div>
  `);
}

module.exports = {
    generateCancelToken,
    confirmationEmail,
    cancellationEmail,
    waitlistPromotionEmail,
    organizerNotificationEmail,
    weeklyDigestEmail,
};

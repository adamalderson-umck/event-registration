/**
 * Print report generators.
 * Each function opens a new window and writes a formatted HTML document
 * for browser print (window.print()).
 */

const printStyles = `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 20px; color: #1a1a1b; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; color: #666; margin-bottom: 16px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 12px; }
    th { background: #f1f5f9; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
    .meta { font-size: 11px; color: #666; margin-bottom: 8px; }
    .field-row { margin-bottom: 8px; }
    .field-label { font-weight: 600; font-size: 12px; color: #555; }
    .field-value { font-size: 14px; margin-top: 2px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 16px 0; }
    .summary-box { border: 1px solid #ddd; padding: 12px; border-radius: 6px; }
    .summary-box .label { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .summary-box .value { font-size: 24px; font-weight: 700; }
    .sign-in-row td:last-child { width: 150px; }
    hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }
    @media print { body { padding: 0; } }
  </style>
`;

function openPrintWindow(html) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    // Short delay for rendering before print dialog
    setTimeout(() => w.print(), 400);
}

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}



/**
 * Print a single registration's full details
 */
export function printIndividualRegistration(registration, event) {
    const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
    const rows = formFields.map((field) => `
    <div class="field-row">
      <div class="field-label">${field.label}</div>
      <div class="field-value">${formatValue(registration.form_data?.[field.id])}</div>
    </div>
  `).join('');

    const html = `<!DOCTYPE html><html><head><title>Registration - ${event.title}</title>${printStyles}</head><body>
    <h1>${event.title}</h1>
    <h2>Individual Registration</h2>
    <div class="meta">
      Status: <strong>${registration.status || 'pending'}</strong> &nbsp;|&nbsp;
      Payment: <strong>${registration.payment_status || 'N/A'}</strong> &nbsp;|&nbsp;
      Date: <strong>${registration.created_at
            ? new Date(registration.created_at).toLocaleString()
            : 'N/A'}</strong>
    </div>
    <hr />
    ${rows}
  </body></html>`;

    openPrintWindow(html);
}

/**
 * Print a table of all registrations with form field columns
 */
export function printRegistrationTable(registrations, event) {
    const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
    const headers = formFields.map((f) => `<th>${f.label}</th>`).join('');
    const statusHeader = '<th>Status</th>';

    const rows = registrations.map((reg) => {
        const cells = formFields.map((f) =>
            `<td>${formatValue(reg.form_data?.[f.id])}</td>`
        ).join('');
        return `<tr>${cells}<td>${reg.status || 'pending'}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>${event.title} - Registrations</title>${printStyles}</head><body>
    <h1>${event.title}</h1>
    <h2>Registration Table &nbsp;·&nbsp; ${registrations.length} registrations</h2>
    <table>
      <thead><tr>${headers}${statusHeader}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;

    openPrintWindow(html);
}

/**
 * Print a sign-in sheet with name + signature column
 */
export function printSignInSheet(registrations, event) {
    const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
    // Try to find name-like fields
    const nameFields = formFields.filter((f) =>
        /name/i.test(f.label) && f.type === 'text'
    );
    const displayFields = nameFields.length > 0 ? nameFields : formFields.slice(0, 2);

    const headers = displayFields.map((f) => `<th>${f.label}</th>`).join('');

    const confirmedRegs = registrations.filter((r) => r.status !== 'cancelled');

    const rows = confirmedRegs.map((reg) => {
        const cells = displayFields.map((f) =>
            `<td>${formatValue(reg.form_data?.[f.id])}</td>`
        ).join('');
        return `<tr>${cells}<td class="sign-in-row"></td></tr>`;
    }).join('');

    // Add a few blank rows for walk-ins
    const blankRows = Array(5).fill(0).map(() => {
        const cells = displayFields.map(() => '<td>&nbsp;</td>').join('');
        return `<tr>${cells}<td></td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>${event.title} - Sign In Sheet</title>${printStyles}</head><body>
    <h1>${event.title}</h1>
    <h2>Sign-In Sheet &nbsp;·&nbsp; ${event.start_date
            ? new Date(event.start_date).toLocaleDateString()
            : ''}</h2>
    <table>
      <thead><tr>${headers}<th>Signature / Check-In</th></tr></thead>
      <tbody>${rows}${blankRows}</tbody>
    </table>
  </body></html>`;

    openPrintWindow(html);
}

/**
 * Print an event summary with stats
 */
export function printEventSummary(registrations, event) {
    const confirmed = registrations.filter((r) => r.status === 'confirmed').length;
    const waitlisted = registrations.filter((r) => r.status === 'waitlisted').length;
    const cancelled = registrations.filter((r) => r.status === 'cancelled').length;
    const pending = registrations.filter((r) => r.status === 'pending').length;

    const paid = registrations.filter((r) => r.payment_status === 'paid').length;
    const paymentTotal = event.payment_enabled && event.payment_amount
        ? (paid * event.payment_amount).toFixed(2)
        : null;

    const html = `<!DOCTYPE html><html><head><title>${event.title} - Summary</title>${printStyles}</head><body>
    <h1>${event.title}</h1>
    <h2>Event Summary</h2>
    <div class="meta">
      ${event.location ? `Location: ${event.location} &nbsp;|&nbsp;` : ''}
      ${event.start_date ? `Date: ${new Date(event.start_date).toLocaleDateString()}` : ''}
      ${event.end_date && event.end_date !== event.start_date ? ` – ${new Date(event.end_date).toLocaleDateString()}` : ''}
    </div>
    <div class="summary-grid">
      <div class="summary-box">
        <div class="label">Confirmed</div>
        <div class="value">${confirmed}</div>
      </div>
      <div class="summary-box">
        <div class="label">Capacity</div>
        <div class="value">${event.capacity || '∞'}</div>
      </div>
      <div class="summary-box">
        <div class="label">Waitlisted</div>
        <div class="value">${waitlisted}</div>
      </div>
      <div class="summary-box">
        <div class="label">Cancelled</div>
        <div class="value">${cancelled}</div>
      </div>
      ${pending > 0 ? `<div class="summary-box"><div class="label">Pending</div><div class="value">${pending}</div></div>` : ''}
      ${paymentTotal ? `<div class="summary-box"><div class="label">Payment Collected</div><div class="value">$${paymentTotal}</div></div>` : ''}
    </div>
    <div class="meta" style="margin-top: 16px;">
      Total registrations: ${registrations.length} &nbsp;|&nbsp;
      ${paid > 0 ? `Paid: ${paid}` : ''}
    </div>
  </body></html>`;

    openPrintWindow(html);
}

/**
 * Print report generators.
 * Each function opens a new window and writes a formatted HTML document
 * for browser print (window.print()).
 */

import { getRegistrationWaiverStatuses } from './registrationWaiverStatus';
import { formatCurrency, formatPaymentSummary } from './paymentStatus';
import { getParkingPassStatus, PARKING_PASS_STATUS } from './parkingRegistration';
import { getParkingReportColumns, getRegistrationFormData } from './registrationReportData';

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

const individualPrintStyles = `
  <style>
    @page { size: letter portrait; margin: 0.45in; }
    body.individual-registration { padding: 0; font-size: 11px; line-height: 1.35; }
    .print-header { border-bottom: 2px solid #334155; padding-bottom: 10px; }
    .print-header h1 { font-size: 20px; line-height: 1.2; margin: 0; }
    .document-type { color: #64748b; font-size: 12px; margin-top: 2px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .meta-item { border-left: 2px solid #cbd5e1; padding-left: 7px; break-inside: avoid; }
    .meta-label { color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
    .meta-value { color: #1e293b; font-size: 10px; font-weight: 600; margin-top: 1px; overflow-wrap: anywhere; }
    .print-section { margin-top: 12px; }
    .section-title { border-bottom: 1px solid #cbd5e1; color: #334155; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; margin: 0 0 5px; padding-bottom: 3px; text-transform: uppercase; break-after: avoid; }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; row-gap: 0; }
    .address-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    .address-sections .field-grid { grid-template-columns: 1fr; }
    .address-sections .print-section { break-inside: avoid; }
    .field-row { border-bottom: 1px solid #e2e8f0; margin: 0; min-height: 34px; padding: 5px 0; break-inside: avoid; }
    .field-row--wide { grid-column: 1 / -1; }
    .field-label { color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: 0.2px; text-transform: uppercase; }
    .field-value { color: #0f172a; font-size: 11px; margin-top: 2px; overflow-wrap: anywhere; }
    .payment-section { break-inside: avoid; }
    .payment-section table { margin-top: 5px; }
    .payment-section th, .payment-section td { font-size: 9px; padding: 5px 7px; }
    @media print { body.individual-registration { padding: 0; } }
  </style>
`;

const tablePrintStyles = `
  <style>
    @page { size: letter landscape; margin: 0.4in; }
    .registration-table table { table-layout: fixed; margin-bottom: 18px; }
    .registration-table th, .registration-table td { overflow-wrap: anywhere; }
    .registration-table .row-number { width: 30px; }
    .registration-table tr { break-inside: avoid; }
    .registration-table caption { text-align: left; font-size: 11px; margin-bottom: 4px; }
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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const parkingFieldGroups = [
    {
        title: 'Registrant',
        matches: (field) => [
            'system_first_name',
            'system_last_name',
            'system_email',
            'parking_phone',
        ].includes(field.id),
    },
    {
        title: 'Local Address',
        matches: (field) => field.id.startsWith('parking_local_'),
    },
    {
        title: 'Permanent Address',
        matches: (field) => field.id.startsWith('parking_permanent_'),
    },
    {
        title: 'Vehicle',
        matches: (field) => (
            field.id.startsWith('parking_vehicle_')
            || field.id === 'parking_license_plate'
            || field.id.startsWith('parking_registration_')
            || field.id === 'parking_insurance_provider'
        ),
    },
];

function getIndividualPrintSections(event) {
    const formFields = event.form_fields || [];

    if (event.event_type === 'parking') {
        const matchedIds = new Set();
        const sections = parkingFieldGroups.map((group) => {
            const fields = formFields.filter((field) => {
                if (field.type === 'sectionBreak' || !group.matches(field)) return false;
                matchedIds.add(field.id);
                return true;
            });
            return { title: group.title, fields };
        }).filter((section) => section.fields.length > 0);

        const additionalFields = formFields.filter((field) => (
            field.type !== 'sectionBreak' && !matchedIds.has(field.id)
        ));
        if (additionalFields.length > 0) {
            sections.push({ title: 'Additional Information', fields: additionalFields });
        }
        return sections;
    }

    const sections = [];
    let currentSection = { title: 'Registration Information', fields: [] };
    formFields.forEach((field) => {
        if (field.type === 'sectionBreak') {
            if (currentSection.fields.length > 0) sections.push(currentSection);
            currentSection = { title: field.label || 'Additional Information', fields: [] };
        } else {
            currentSection.fields.push(field);
        }
    });
    if (currentSection.fields.length > 0) sections.push(currentSection);
    return sections;
}

function formatParkingReportValue(column, registration) {
    const value = column.value(registration);
    return column.date && value ? new Date(value).toLocaleString() : formatValue(value);
}

function isWidePrintField(field, value) {
    return field.type === 'textarea'
        || field.type === 'richText'
        || (Array.isArray(value) && value.length > 2)
        || String(formatValue(value)).length > 80;
}



/**
 * Print a single registration's full details
 */
export function printIndividualRegistration(registration, event) {
    const formData = getRegistrationFormData(registration);
    const renderedSections = getIndividualPrintSections(event).map((section) => {
        const rows = section.fields.map((field) => {
            const value = formData[field.id];
            const wideClass = isWidePrintField(field, value) ? ' field-row--wide' : '';
            return `<div class="field-row${wideClass}">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="field-value">${escapeHtml(formatValue(value))}</div>
      </div>`;
        }).join('');
        return {
            title: section.title,
            html: `<section class="print-section">
      <h2 class="section-title">${escapeHtml(section.title)}</h2>
      <div class="field-grid">${rows}</div>
    </section>`,
        };
    });
    let sections = renderedSections.map((section) => section.html).join('');
    if (event.event_type === 'parking') {
        const addressTitles = new Set(['Local Address', 'Permanent Address']);
        const addressSections = renderedSections.filter((section) => addressTitles.has(section.title));
        sections = renderedSections.map((section) => {
            if (section.title === 'Local Address') {
                return `<div class="address-sections">${addressSections.map((address) => address.html).join('')}</div>`;
            }
            if (section.title === 'Permanent Address') return '';
            return section.html;
        }).join('');
    }
    const paymentRows = (registration.registration_payments || []).map((payment) => {
        const reference = payment.method === 'check'
            ? `Check #${payment.reference_number}`
            : payment.method === 'tithely'
                ? `Tithe.ly #${payment.reference_number}`
                : 'Cash';

        return `<tr>
      <td>${escapeHtml(payment.payment_date)}</td>
      <td>${escapeHtml(reference)}</td>
      <td>$${Number(payment.amount).toFixed(2)}</td>
      <td>${payment.voided_at ? `Voided: ${escapeHtml(payment.void_reason)}` : 'Active'}</td>
    </tr>`;
    }).join('');

    const submitted = registration.created_at
        ? new Date(registration.created_at).toLocaleString()
        : 'N/A';
    const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(registration, event.waivers);
    const details = [
        ['Registration ID', registration.id || 'N/A'],
        ['Waiver', waiverStatus],
        ['Media', mediaDecision],
        ['Selected Payment Method', registration.payment_method || 'None'],
        ['Expected Amount', registration.payment_expected_amount == null ? 'N/A' : formatCurrency(registration.payment_expected_amount)],
        ...getParkingReportColumns(event).map(column => [column.label, formatParkingReportValue(column, registration)]),
    ];
    const html = `<!DOCTYPE html><html><head><title>Registration - ${escapeHtml(event.title)}</title>${printStyles}${individualPrintStyles}</head><body class="individual-registration">
    <header class="print-header">
      <h1>${escapeHtml(event.title)}</h1>
      <p class="document-type">Individual Registration</p>
      <div class="meta-grid">
        <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${escapeHtml(registration.status || 'pending')}</div></div>
        <div class="meta-item"><div class="meta-label">Payment</div><div class="meta-value">${escapeHtml(formatPaymentSummary(registration) || 'N/A')}</div></div>
        <div class="meta-item"><div class="meta-label">Submitted</div><div class="meta-value">${escapeHtml(submitted)}</div></div>
        ${details.map(([label, value]) => `<div class="meta-item"><div class="meta-label">${escapeHtml(label)}</div><div class="meta-value">${escapeHtml(value)}</div></div>`).join('')}
      </div>
    </header>
    ${sections}
    ${paymentRows ? `<section class="print-section payment-section">
    <h2 class="section-title">Payment History</h2>
    <table>
      <thead><tr><th>Payment Date</th><th>Method</th><th>Amount</th><th>State</th></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>
    </section>` : ''}
  </body></html>`;

    openPrintWindow(html);
}

/**
 * Print a table of all registrations with form field columns
 */
export function printRegistrationTable(registrations, event) {
    const formFields = (event.form_fields || []).filter((f) => f.type !== 'sectionBreak');
    const parkingColumns = getParkingReportColumns(event);
    const headers = [
        ...formFields.map(field => field.label),
        'Waiver', 'Media', 'Status', 'Payment', 'Submitted',
        ...parkingColumns.map(column => column.label),
    ];

    const rows = registrations.map((reg) => {
        const formData = getRegistrationFormData(reg);
        const cells = formFields.map(field => formatValue(formData[field.id]));
        const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(
            reg,
            event.waivers
        );
        const submitted = reg.created_at
            ? new Date(reg.created_at).toLocaleString()
            : 'N/A';
        return [
            ...cells, waiverStatus, mediaDecision, reg.status || 'pending',
            formatPaymentSummary(reg) || 'N/A', submitted,
            ...parkingColumns.map(column => formatParkingReportValue(column, reg)),
        ];
    });
    const tables = [];
    const columnsPerTable = 8;
    for (let start = 0; start < headers.length; start += columnsPerTable) {
        const end = start + columnsPerTable;
        tables.push(`<table>
      ${headers.length > columnsPerTable ? `<caption>Columns ${start + 1}-${Math.min(end, headers.length)} of ${headers.length}. Row numbers match across tables.</caption>` : ''}
      <thead><tr><th class="row-number">#</th>${headers.slice(start, end).map(label => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td>${row.slice(start, end).map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`);
    }

    const html = `<!DOCTYPE html><html><head><title>${escapeHtml(event.title)} - Registrations</title>${printStyles}${tablePrintStyles}</head><body class="registration-table">
    <h1>${escapeHtml(event.title)}</h1>
    <h2>Registration Table &nbsp;·&nbsp; ${registrations.length} registrations</h2>
    ${tables.join('')}
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

    const isParking = event.event_type === 'parking';
    const headers = displayFields.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('');

    const confirmedRegs = registrations.filter((r) => r.status !== 'cancelled');

    const rows = confirmedRegs.map((reg) => {
        const formData = getRegistrationFormData(reg);
        const cells = displayFields.map((f) =>
            `<td>${escapeHtml(formatValue(formData[f.id]))}</td>`
        ).join('');
        return `<tr>${cells}<td>${escapeHtml(reg.status || 'pending')}</td>${isParking ? `<td>${getParkingPassStatus(reg)}</td>` : ''}<td class="sign-in-row"></td></tr>`;
    }).join('');

    // Add a few blank rows for walk-ins
    const blankRows = Array(5).fill(0).map(() => {
        const cells = displayFields.map(() => '<td>&nbsp;</td>').join('');
        return `<tr>${cells}<td></td>${isParking ? '<td></td>' : ''}<td></td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>${escapeHtml(event.title)} - Sign In Sheet</title>${printStyles}</head><body>
    <h1>${escapeHtml(event.title)}</h1>
    <h2>Sign-In Sheet &nbsp;·&nbsp; ${event.start_date
            ? new Date(event.start_date).toLocaleDateString()
            : ''}</h2>
    <table>
      <thead><tr>${headers}<th>Status</th>${isParking ? '<th>Pass Status</th>' : ''}<th>Signature / Check-In</th></tr></thead>
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

    const paid = registrations.filter((registration) => registration.payment_status === 'paid').length;
    const partialPayments = registrations.filter((registration) => registration.payment_status === 'partial').length;
    const paymentTotal = event.payment_enabled
        ? registrations.reduce(
            (sum, registration) => sum + Number(registration.payment_recorded_total || 0),
            0,
        ).toFixed(2)
        : null;

    const passSummary = event.event_type === 'parking'
        ? `<section><h2>Pass Status</h2><div class="summary-grid">${Object.values(PARKING_PASS_STATUS).map(status => (
            `<div class="summary-box"><div class="label">${status}</div><div class="value">${registrations.filter(registration => getParkingPassStatus(registration) === status).length}</div></div>`
        )).join('')}</div></section>`
        : '';
    const waiverStatuses = registrations.map(registration => getRegistrationWaiverStatuses(registration, event.waivers));
    const waiverCounts = [];
    if (event.waivers?.some(waiver => waiver.required !== false)) {
        for (const status of ['Signed', 'Missing']) {
            waiverCounts.push([`Waiver ${status}`, waiverStatuses.filter(value => value.waiverStatus === status).length]);
        }
    }
    if (event.waivers?.some(waiver => waiver.required === false && waiver.title?.trim().toLowerCase() === 'media release')) {
        for (const status of ['Approved', 'Declined', 'Missing']) {
            waiverCounts.push([`Media ${status}`, waiverStatuses.filter(value => value.mediaDecision === status).length]);
        }
    }
    const waiverSummary = waiverCounts.length
        ? `<section><h2>Waiver / Media (all registrations)</h2><div class="summary-grid">${waiverCounts.map(([label, count]) => `<div class="summary-box"><div class="label">${label}</div><div class="value">${count}</div></div>`).join('')}</div></section>`
        : '';

    const html = `<!DOCTYPE html><html><head><title>${escapeHtml(event.title)} - Summary</title>${printStyles}</head><body>
    <h1>${escapeHtml(event.title)}</h1>
    <h2>Event Summary</h2>
    <div class="meta">
      ${event.location ? `Location: ${escapeHtml(event.location)} &nbsp;|&nbsp;` : ''}
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
      ${partialPayments > 0 ? `<div class="summary-box"><div class="label">Partially Paid</div><div class="value">${partialPayments}</div></div>` : ''}
      ${paymentTotal !== null ? `<div class="summary-box"><div class="label">Payment Collected</div><div class="value">$${paymentTotal}</div></div>` : ''}
    </div>
    ${passSummary}
    ${waiverSummary}
    <div class="meta" style="margin-top: 16px;">
      Total registrations: ${registrations.length} &nbsp;|&nbsp;
      ${paid > 0 ? `Paid: ${paid}` : ''}
    </div>
  </body></html>`;

    openPrintWindow(html);
}

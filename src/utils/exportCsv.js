import { getRegistrationWaiverStatuses } from './registrationWaiverStatus';

/**
 * Escapes a value for CSV (RFC 4180).
 */
function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV string from registrations, form fields, and waiver definitions.
 * Appends Waiver, Media, Status, Payment, and Submitted columns.
 */
export function buildCsvString(registrations, formFields, waivers = []) {
  const filteredFields = formFields.filter((f) => f.type !== 'sectionBreak');
  const headers = [
    ...filteredFields.map((f) => f.label),
    'Waiver',
    'Media',
    'Status',
    'Payment',
    'Submitted',
  ];

  const rows = registrations.map((reg) => {
    const fieldValues = filteredFields.map((f) => {
      const val = reg.form_data?.[f.id];
      return Array.isArray(val) ? val.join(', ') : (val ?? '');
    });
    const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(reg, waivers);
    return [
      ...fieldValues,
      waiverStatus,
      mediaDecision,
      reg.status || '',
      reg.payment_status || '',
      reg.created_at ? new Date(reg.created_at).toLocaleString() : '',
    ];
  });

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];

  return csvLines.join('\n');
}

/**
 * Triggers a CSV file download in the browser.
 */
export function downloadCsv(registrations, formFields, filename = 'registrations.csv', waivers = []) {
  const csv = buildCsvString(registrations, formFields, waivers);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

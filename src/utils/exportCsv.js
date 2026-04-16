/**
 * Escapes a value for CSV (RFC 4180).
 */
function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV string from registrations + form field schema.
 * Appends Status, Payment, and Submitted columns.
 */
export function buildCsvString(registrations, formFields) {
  const filteredFields = formFields.filter((f) => f.type !== 'sectionBreak');
  const headers = [
    ...filteredFields.map((f) => f.label),
    'Status',
    'Payment',
    'Submitted',
  ];

  const rows = registrations.map((reg) => {
    const fieldValues = filteredFields.map((f) => {
      const val = reg.form_data?.[f.id];
      return Array.isArray(val) ? val.join(', ') : (val ?? '');
    });
    return [
      ...fieldValues,
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
export function downloadCsv(registrations, formFields, filename = 'registrations.csv') {
  const csv = buildCsvString(registrations, formFields);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import { getRegistrationWaiverStatuses } from './registrationWaiverStatus';
import { formatPaymentSummary } from './paymentStatus';
import { getParkingReportColumns, getRegistrationFormData } from './registrationReportData';

/**
 * Escapes a value for CSV (RFC 4180).
 */
function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV string from registrations, form fields, and waiver definitions.
 * Appends waiver, media, registration/payment status, parking details, and submission time.
 */
export function buildCsvString(registrations, formFields, waivers = [], event = {}) {
  const filteredFields = formFields.filter((f) => f.type !== 'sectionBreak');
  const parkingColumns = getParkingReportColumns(event);
  const headers = [
    ...filteredFields.map((f) => f.label),
    'Waiver',
    'Media',
    'Status',
    'Payment',
    ...parkingColumns.map(column => column.label),
    'Submitted',
  ];

  const rows = registrations.map((reg) => {
    const formData = getRegistrationFormData(reg);
    const fieldValues = filteredFields.map((f) => {
      const val = formData[f.id];
      return Array.isArray(val) ? val.join(', ') : (val ?? '');
    });
    const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(reg, waivers);
    return [
      ...fieldValues,
      waiverStatus,
      mediaDecision,
      reg.status || '',
      formatPaymentSummary(reg),
      ...parkingColumns.map(column => column.value(reg)),
      reg.created_at ? new Date(reg.created_at).toLocaleString() : '',
    ];
  });

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];

  return csvLines.join('\n');
}

function downloadCsvText(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildPaymentLedgerCsv(registrations, formFields, event) {
  const fields = formFields.filter((field) => field.type !== 'sectionBreak');
  const parkingColumns = getParkingReportColumns(event);
  const headers = [
    'Event',
    ...fields.map((field) => field.label),
    'Registration ID',
    'Registration Payment Status',
    'Expected Amount',
    'Active Recorded Total',
    'Payment Method',
    'Payment Amount',
    'Payment Date',
    'Reference Number',
    'Recorded At',
    'Recorded By',
    'Record State',
    'Voided At',
    'Voided By',
    'Void Reason',
    'Registration Status',
    'Selected Payment Method',
    ...parkingColumns.map(column => column.label),
  ];

  const rows = registrations.flatMap((registration) => (
    (registration.registration_payments || []).map((payment) => [
      event?.title || '',
      ...fields.map((field) => {
        const value = getRegistrationFormData(registration)[field.id];
        return Array.isArray(value) ? value.join(', ') : (value ?? '');
      }),
      registration.id,
      registration.payment_status || '',
      registration.payment_expected_amount ?? '',
      Number(registration.payment_recorded_total || 0).toFixed(2),
      payment.method === 'tithely'
        ? 'Tithe.ly'
        : payment.method[0].toUpperCase() + payment.method.slice(1),
      Number(payment.amount).toFixed(2),
      payment.payment_date,
      payment.reference_number || '',
      payment.created_at,
      payment.created_by,
      payment.voided_at ? 'Voided' : 'Active',
      payment.voided_at || '',
      payment.voided_by || '',
      payment.void_reason || '',
      registration.status || '',
      registration.payment_method || '',
      ...parkingColumns.map(column => column.value(registration)),
    ])
  ));

  return [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}

/**
 * Triggers a registration CSV file download in the browser.
 */
export function downloadCsv(registrations, formFields, filename = 'registrations.csv', waivers = [], event = {}) {
  downloadCsvText(buildCsvString(registrations, formFields, waivers, event), filename);
}

export function downloadPaymentLedgerCsv(
  registrations,
  formFields,
  event,
  filename = 'payment-ledger.csv',
) {
  downloadCsvText(buildPaymentLedgerCsv(registrations, formFields, event), filename);
}

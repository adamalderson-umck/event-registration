export const PARKING_LICENSE_PLATE_FIELD_ID = 'parking_license_plate';

export const LICENSE_PLATE_ERROR =
  'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.';

const PLACEHOLDERS = new Set([
  'TEST', 'TESTING', 'NONE', 'UNKNOWN', 'NOPLATE', 'NIL', 'NULL', 'PLATE', 'LICENSE',
]);
const RUNS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '0123456789',
  'QWERTYUIOP',
  'ASDFGHJKL',
  'ZXCVBNM',
];

export function normalizeLicensePlate(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '')
    : '';
}

function isWholeRun(value) {
  return value.length >= 3 && RUNS.some((run) => (
    run.includes(value) || [...run].reverse().join('').includes(value)
  ));
}

export function isPlausibleLicensePlate(value) {
  const normalized = normalizeLicensePlate(value);
  if (normalized === 'TEMP') return true;
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) return false;
  if (/^([A-Z0-9])\1+$/.test(normalized)) return false;
  if (PLACEHOLDERS.has(normalized)) return false;
  return !isWholeRun(normalized);
}

export function normalizeParkingLicensePlateAnswers(fields = [], answers = {}) {
  const hasProtectedField = fields.some(
    (field) => field?.id === PARKING_LICENSE_PLATE_FIELD_ID,
  );
  if (!hasProtectedField || !Object.hasOwn(answers, PARKING_LICENSE_PLATE_FIELD_ID)) {
    return answers;
  }
  return {
    ...answers,
    [PARKING_LICENSE_PLATE_FIELD_ID]: normalizeLicensePlate(
      answers[PARKING_LICENSE_PLATE_FIELD_ID],
    ),
  };
}

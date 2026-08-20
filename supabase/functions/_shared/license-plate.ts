export const PARKING_LICENSE_PLATE_FIELD_ID = 'parking_license_plate';

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

export function normalizeLicensePlate(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '')
    : '';
}

function isWholeRun(value: string): boolean {
  return value.length >= 3 && RUNS.some((run) => (
    run.includes(value) || [...run].reverse().join('').includes(value)
  ));
}

export function isPlausibleLicensePlate(value: unknown): boolean {
  const normalized = normalizeLicensePlate(value);
  if (normalized === 'TEMP') return true;
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) return false;
  if (/^([A-Z0-9])\1+$/.test(normalized)) return false;
  if (PLACEHOLDERS.has(normalized)) return false;
  return !isWholeRun(normalized);
}

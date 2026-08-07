import {
  type EventRecord,
  normalizeCurrentFormData,
} from './registration-request.ts';

const MAX_BODY_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = new Set([
  'registrationId',
  'orgId',
  'expectedFormData',
  'answers',
]);

type UnknownRecord = Record<string, unknown>;

export interface RegistrationAnswerEditRequest {
  registrationId: string;
  orgId: string;
  expectedFormData: UnknownRecord;
  answers: UnknownRecord;
}

export interface RegistrationAnswerChange {
  fieldId: string;
  fieldLabel: string;
  before: unknown;
  after: unknown;
}

function invalidRequest(): never {
  throw new Error('invalid_request');
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseRegistrationAnswerEditRequest(
  value: unknown,
): RegistrationAnswerEditRequest {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !REQUEST_KEYS.has(key))
    || serializedSize(value) > MAX_BODY_BYTES
    || !UUID_PATTERN.test(String(value.registrationId || ''))
    || !UUID_PATTERN.test(String(value.orgId || ''))
    || !isRecord(value.expectedFormData)
    || !isRecord(value.answers)
  ) {
    invalidRequest();
  }

  return {
    registrationId: value.registrationId as string,
    orgId: value.orgId as string,
    expectedFormData: value.expectedFormData,
    answers: value.answers,
  };
}

export function prepareRegistrationAnswerEdit(
  event: EventRecord,
  registration: { form_data: UnknownRecord },
  answers: UnknownRecord,
): { formData: UnknownRecord; changes: RegistrationAnswerChange[] } {
  const fields = Array.isArray(event.form_fields)
    ? event.form_fields.filter((field): field is UnknownRecord => (
      isRecord(field) && field.type !== 'sectionBreak'
    ))
    : [];
  const currentIds = new Set(fields.map((field) => String(field.id)));
  const legacyAnswers = Object.fromEntries(
    Object.entries(registration.form_data).filter(([id]) => !currentIds.has(id)),
  );
  const formData = {
    ...legacyAnswers,
    ...normalizeCurrentFormData(event, answers),
  };
  const changes = fields.flatMap((field): RegistrationAnswerChange[] => {
    const fieldId = String(field.id);
    const before = Object.hasOwn(registration.form_data, fieldId)
      ? registration.form_data[fieldId]
      : null;
    const after = Object.hasOwn(formData, fieldId)
      ? formData[fieldId]
      : null;

    return valuesMatch(before, after)
      ? []
      : [{
        fieldId,
        fieldLabel: typeof field.label === 'string' && field.label
          ? field.label
          : fieldId,
        before,
        after,
      }];
  });

  return { formData, changes };
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TOKEN_LENGTH = 2048;
const MAX_FIELDS = 200;
const MAX_WAIVERS = 50;
const MAX_STRING_LENGTH = 4096;
const MAX_OPTION_ITEMS = 100;
const MAX_SIGNER_LENGTH = 320;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_SIGNATURE_DATA_LENGTH = 512 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOP_LEVEL_KEYS = new Set([
  'turnstileToken',
  'eventId',
  'orgId',
  'formData',
  'paymentMethod',
  'signatureRecords',
]);
const SIGNATURE_KEYS = new Set([
  'waiverId',
  'declined',
  'consentToESign',
  'signerName',
  'signatureMethod',
  'signatureData',
]);
const SUPPORTED_FIELD_TYPES = new Set([
  'text',
  'email',
  'phone',
  'number',
  'date',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'checkboxGroup',
]);

type UnknownRecord = Record<string, unknown>;

export interface SignatureDecision {
  waiverId: string;
  declined: boolean;
  consentToESign?: boolean;
  signerName?: string;
  signatureMethod?: 'draw' | 'type';
  signatureData?: string | null;
}

export interface RegistrationRequest {
  turnstileToken: string;
  eventId: string;
  orgId: string;
  formData: Record<string, unknown>;
  paymentMethod: string | null;
  signatureRecords: SignatureDecision[];
}

export interface EventRecord extends UnknownRecord {
  id: string;
  org_id: string;
  status: string;
  registration_close_date?: string | null;
  payment_enabled?: boolean;
  allow_in_person_payment?: boolean;
  tithely_giving_url?: string | null;
  tithely_embed_config?: UnknownRecord | null;
  form_fields?: unknown;
  waivers?: unknown;
}

export interface RegistrationInsert {
  event_id: string;
  org_id: string;
  form_data: Record<string, unknown>;
  status: 'pending';
  payment_status: 'pending' | 'not_required';
  payment_method: string | null;
  signature_records: UnknownRecord[];
}

function invalidRequest(): never {
  throw new Error('invalid_request');
}

function registrationUnavailable(): never {
  throw new Error('registration_unavailable');
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function parseRegistrationRequest(value: unknown): RegistrationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS) || serializedSize(value) > MAX_BODY_BYTES) {
    invalidRequest();
  }

  const {
    turnstileToken,
    eventId,
    orgId,
    formData,
    paymentMethod,
    signatureRecords,
  } = value;

  if (
    typeof turnstileToken !== 'string' || !turnstileToken || turnstileToken.length > MAX_TOKEN_LENGTH ||
    !isUuid(eventId) || !isUuid(orgId) ||
    !isRecord(formData) || !Array.isArray(signatureRecords) ||
    (paymentMethod !== null && typeof paymentMethod !== 'string')
  ) {
    invalidRequest();
  }

  return {
    turnstileToken,
    eventId,
    orgId,
    formData,
    paymentMethod,
    signatureRecords: signatureRecords as SignatureDecision[],
  };
}

export function assertEventAcceptsRegistration(
  event: EventRecord,
  request: RegistrationRequest,
  now = new Date(),
): void {
  if (
    !event || event.id !== request.eventId || event.org_id !== request.orgId ||
    event.status !== 'active'
  ) {
    registrationUnavailable();
  }

  if (event.registration_close_date) {
    const closeTime = new Date(event.registration_close_date).getTime();
    if (!Number.isFinite(closeTime) || closeTime <= now.getTime()) {
      registrationUnavailable();
    }
  }
}

function isVisible(condition: unknown, formData: Record<string, unknown>): boolean {
  if (!isRecord(condition)) return true;
  const field = typeof condition.field === 'string' ? condition.field : '';
  const actual = formData[field];
  if (condition.operator === 'equals') {
    return Array.isArray(actual)
      ? actual.includes(condition.value)
      : String(actual || '') === String(condition.value ?? '');
  }
  if (condition.operator === 'notEquals') {
    return Array.isArray(actual)
      ? !actual.includes(condition.value)
      : String(actual || '') !== String(condition.value ?? '');
  }
  return true;
}

function getOptions(field: UnknownRecord): string[] {
  if (!Array.isArray(field.options) || field.options.length > MAX_OPTION_ITEMS) invalidRequest();
  const options = field.options;
  if (!options.every((option) => typeof option === 'string' && option.length <= MAX_STRING_LENGTH)) {
    invalidRequest();
  }
  return options;
}

function requireBoundedString(value: unknown, max = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string' || value.length > max) invalidRequest();
  return value;
}

function validateFieldValue(field: UnknownRecord, value: unknown): unknown {
  const type = field.type;
  if (typeof type !== 'string' || !SUPPORTED_FIELD_TYPES.has(type)) invalidRequest();

  if (type === 'checkbox') {
    if (typeof value !== 'boolean') invalidRequest();
    return value;
  }

  if (type === 'checkboxGroup') {
    if (!Array.isArray(value) || value.length > MAX_OPTION_ITEMS) invalidRequest();
    const options = new Set(getOptions(field));
    if (
      !value.every((item) => typeof item === 'string' && item.length <= MAX_STRING_LENGTH && options.has(item)) ||
      new Set(value).size !== value.length
    ) {
      invalidRequest();
    }
    return [...value];
  }

  if (type === 'number') {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalidRequest();
      return value;
    }
    const stringValue = requireBoundedString(value);
    if (!stringValue.trim() || !Number.isFinite(Number(stringValue))) invalidRequest();
    return stringValue;
  }

  const stringValue = requireBoundedString(value);
  if (type === 'email' && !EMAIL_PATTERN.test(stringValue.trim())) invalidRequest();
  if (type === 'phone') {
    const digits = stringValue.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) invalidRequest();
  }
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) invalidRequest();
  if ((type === 'select' || type === 'radio') && !getOptions(field).includes(stringValue)) {
    invalidRequest();
  }
  return type === 'email' ? stringValue.trim().toLowerCase() : stringValue;
}

export function normalizeCurrentFormData(
  event: EventRecord,
  rawFormData: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(event.form_fields) || event.form_fields.length > MAX_FIELDS) invalidRequest();

  const clean: Record<string, unknown> = {};
  const visibleFields: UnknownRecord[] = [];
  for (const rawField of event.form_fields) {
    if (!isRecord(rawField)) invalidRequest();
    if (rawField.type === 'sectionBreak') continue;
    if (typeof rawField.id !== 'string' || !rawField.id || !SUPPORTED_FIELD_TYPES.has(String(rawField.type))) {
      invalidRequest();
    }
    if (isVisible(rawField.condition, clean)) visibleFields.push(rawField);
    if (Object.hasOwn(rawFormData, rawField.id) && isVisible(rawField.condition, clean)) {
      clean[rawField.id] = validateFieldValue(rawField, rawFormData[rawField.id]);
    }
  }

  const visibleIds = new Set(visibleFields.map((field) => field.id as string));
  if (Object.keys(rawFormData).some((key) => !visibleIds.has(key))) invalidRequest();

  for (const field of visibleFields) {
    const id = field.id as string;
    const present = Object.hasOwn(clean, id);
    if (!field.required) continue;
    if (!present) invalidRequest();
    const value = clean[id];
    if (
      (field.type === 'checkbox' && value !== true) ||
      (field.type === 'checkboxGroup' && (!Array.isArray(value) || value.length === 0)) ||
      (typeof value === 'string' && !value.trim())
    ) {
      invalidRequest();
    }
  }

  if (serializedSize(clean) > MAX_BODY_BYTES) invalidRequest();
  return clean;
}

function getRegistrantEmail(event: EventRecord, formData: Record<string, unknown>): string {
  const fields = Array.isArray(event.form_fields) ? event.form_fields.filter(isRecord) : [];
  const emailField = fields.find((field) => field.id === 'system_email') ||
    fields.find((field) => field.type === 'email');
  const value = emailField && typeof emailField.id === 'string' ? formData[emailField.id] : '';
  return typeof value === 'string' ? value.slice(0, MAX_SIGNER_LENGTH) : '';
}

function trustedMetadata(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' && value ? value.slice(0, max) : fallback;
}

function buildSignatureRecords(
  event: EventRecord,
  request: RegistrationRequest,
  formData: Record<string, unknown>,
  metadata: { ipAddress: string; userAgent: string; now?: Date },
): UnknownRecord[] {
  if (!Array.isArray(event.waivers) || event.waivers.length > MAX_WAIVERS || request.signatureRecords.length > MAX_WAIVERS) {
    invalidRequest();
  }

  const decisions = new Map<string, UnknownRecord>();
  for (const rawDecision of request.signatureRecords) {
    if (!isRecord(rawDecision) || !hasOnlyKeys(rawDecision, SIGNATURE_KEYS) ||
      typeof rawDecision.waiverId !== 'string' || typeof rawDecision.declined !== 'boolean' ||
      decisions.has(rawDecision.waiverId)) {
      invalidRequest();
    }
    decisions.set(rawDecision.waiverId, rawDecision);
  }

  const waiverIds = new Set<string>();
  const now = metadata.now ?? new Date();
  const timestamp = now.toISOString();
  const ipAddress = trustedMetadata(metadata.ipAddress, 128, 'unknown');
  const userAgent = trustedMetadata(metadata.userAgent, MAX_USER_AGENT_LENGTH, 'unknown');
  const signerEmail = getRegistrantEmail(event, formData);

  const records = event.waivers.map((rawWaiver) => {
    if (!isRecord(rawWaiver) || typeof rawWaiver.id !== 'string' || !rawWaiver.id ||
      typeof rawWaiver.title !== 'string' || rawWaiver.title.length > MAX_STRING_LENGTH ||
      typeof rawWaiver.contentHash !== 'string' || rawWaiver.contentHash.length > MAX_STRING_LENGTH ||
      waiverIds.has(rawWaiver.id)) {
      invalidRequest();
    }
    waiverIds.add(rawWaiver.id);
    const decision = decisions.get(rawWaiver.id);
    if (!decision) invalidRequest();

    if (decision.declined === true) {
      if (rawWaiver.required !== false || Object.keys(decision).some((key) => !['waiverId', 'declined'].includes(key))) {
        invalidRequest();
      }
      return {
        waiverId: rawWaiver.id,
        waiverTitle: rawWaiver.title,
        waiverContentHash: rawWaiver.contentHash,
        signed: false,
        declined: true,
        declinedAt: timestamp,
        signerName: '',
        signerEmail,
        ipAddress,
        userAgent,
      };
    }

    if (decision.consentToESign !== true ||
      (decision.signatureMethod !== 'draw' && decision.signatureMethod !== 'type')) {
      invalidRequest();
    }
    const signerName = requireBoundedString(decision.signerName, MAX_SIGNER_LENGTH).trim();
    if (!signerName) invalidRequest();

    let signatureData: string | null = null;
    let signatureFont: string | null = null;
    if (decision.signatureMethod === 'draw') {
      signatureData = requireBoundedString(decision.signatureData, MAX_SIGNATURE_DATA_LENGTH);
      if (!signatureData) invalidRequest();
    } else {
      if (decision.signatureData != null) invalidRequest();
      signatureFont = "'Dancing Script', cursive";
    }

    return {
      waiverId: rawWaiver.id,
      waiverTitle: rawWaiver.title,
      waiverContentHash: rawWaiver.contentHash,
      signed: true,
      signedAt: timestamp,
      signerName,
      signerEmail,
      signatureMethod: decision.signatureMethod,
      signatureData,
      signatureFont,
      consentToESign: true,
      ipAddress,
      userAgent,
    };
  });

  if (decisions.size !== waiverIds.size || [...decisions.keys()].some((id) => !waiverIds.has(id))) {
    invalidRequest();
  }
  return records;
}

function hasValidTithelyConfiguration(event: EventRecord): boolean {
  if (typeof event.tithely_giving_url !== 'string' || !isRecord(event.tithely_embed_config)) return false;
  try {
    const url = new URL(event.tithely_giving_url);
    const formIds = url.searchParams.getAll('formId');
    const embedFormId = event.tithely_embed_config.formId;
    return url.protocol === 'https:' && url.origin === 'https://give.tithe.ly' && url.pathname === '/' &&
      !url.username && !url.password && !url.hash && formIds.length === 1 && isUuid(formIds[0]) &&
      typeof embedFormId === 'string' && formIds[0].toLowerCase() === embedFormId.toLowerCase();
  } catch {
    return false;
  }
}

function getPayment(event: EventRecord, requestedMethod: string | null): {
  payment_status: 'pending' | 'not_required';
  payment_method: string | null;
} {
  if (!event.payment_enabled) {
    if (requestedMethod !== null) invalidRequest();
    return { payment_status: 'not_required', payment_method: null };
  }

  const allowed = new Set<string>();
  if (hasValidTithelyConfiguration(event)) allowed.add('tithely');
  if (event.allow_in_person_payment === true) allowed.add('in_person');
  if (requestedMethod === null || !allowed.has(requestedMethod)) invalidRequest();
  return { payment_status: 'pending', payment_method: requestedMethod };
}

export function buildRegistrationInsert(
  event: EventRecord,
  request: RegistrationRequest,
  metadata: { ipAddress: string; userAgent: string; now?: Date },
): RegistrationInsert {
  assertEventAcceptsRegistration(event, request, metadata.now);
  const formData = normalizeCurrentFormData(event, request.formData);
  const payment = getPayment(event, request.paymentMethod);
  return {
    event_id: event.id,
    org_id: event.org_id,
    form_data: formData,
    status: 'pending',
    ...payment,
    signature_records: buildSignatureRecords(event, request, formData, metadata),
  };
}

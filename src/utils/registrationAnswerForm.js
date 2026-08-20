import { evaluateCondition } from './formConditions';
import {
  LICENSE_PLATE_ERROR,
  PARKING_LICENSE_PLATE_FIELD_ID,
  isPlausibleLicensePlate,
  normalizeParkingLicensePlateAnswers,
} from './licensePlate';

export const ANSWER_ERROR_MESSAGES = Object.freeze({
  required: 'This field is required',
  checkboxGroup: 'Select at least one option',
  email: 'Please enter a valid email address',
  phone: 'Please enter a valid phone number',
  number: 'Please enter a valid number',
  date: 'Please enter a valid date',
  option: 'Select a listed option',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const currentFields = (fields = []) => fields.filter(
  (field) => field?.type !== 'sectionBreak' && typeof field?.id === 'string',
);

export function buildAnswerDraft(fields, savedFormData = {}) {
  return Object.fromEntries(currentFields(fields).flatMap((field) => (
    Object.hasOwn(savedFormData, field.id)
      ? [[field.id, savedFormData[field.id]]]
      : []
  )));
}

export function getLegacyAnswers(fields, savedFormData = {}) {
  const currentIds = new Set(currentFields(fields).map((field) => field.id));
  return Object.fromEntries(
    Object.entries(savedFormData).filter(([id]) => !currentIds.has(id)),
  );
}

export function getVisibleFields(fields, formData = {}) {
  const visibleFields = [];
  const visibleData = {};

  for (const field of currentFields(fields)) {
    if (!evaluateCondition(field.condition, visibleData)) continue;
    visibleFields.push(field);
    if (Object.hasOwn(formData, field.id)) {
      visibleData[field.id] = formData[field.id];
    }
  }

  return visibleFields;
}

export function prepareVisibleAnswers(fields, formData = {}) {
  const visibleFields = getVisibleFields(fields, formData);
  const answers = Object.fromEntries(visibleFields.flatMap((field) => (
    Object.hasOwn(formData, field.id)
      ? [[field.id, formData[field.id]]]
      : []
  )));
  return normalizeParkingLicensePlateAnswers(visibleFields, answers);
}

function requiredError(field, value, present) {
  if (!field.required) return '';
  if (field.type === 'checkbox') {
    return value === true ? '' : ANSWER_ERROR_MESSAGES.required;
  }
  if (field.type === 'checkboxGroup') {
    return Array.isArray(value) && value.length > 0
      ? ''
      : ANSWER_ERROR_MESSAGES.checkboxGroup;
  }
  return present && !(typeof value === 'string' && value.trim() === '')
    ? ''
    : ANSWER_ERROR_MESSAGES.required;
}

function valueError(field, value) {
  if (
    field.id === PARKING_LICENSE_PLATE_FIELD_ID
    && !isPlausibleLicensePlate(value)
  ) {
    return LICENSE_PLATE_ERROR;
  }

  if (field.type === 'checkbox') {
    return typeof value === 'boolean' ? '' : ANSWER_ERROR_MESSAGES.required;
  }

  if (field.type === 'checkboxGroup') {
    if (!Array.isArray(value)) return ANSWER_ERROR_MESSAGES.option;
    const options = Array.isArray(field.options) ? field.options : [];
    const unique = new Set(value);
    return unique.size === value.length && value.every((item) => options.includes(item))
      ? ''
      : ANSWER_ERROR_MESSAGES.option;
  }

  if (field.type === 'number') {
    const valid = typeof value === 'number'
      ? Number.isFinite(value)
      : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
    return valid ? '' : ANSWER_ERROR_MESSAGES.number;
  }

  if (typeof value !== 'string') return ANSWER_ERROR_MESSAGES.required;
  if (field.type === 'email' && !EMAIL_PATTERN.test(value.trim())) {
    return ANSWER_ERROR_MESSAGES.email;
  }
  if (field.type === 'phone') {
    const digitCount = value.replace(/\D/g, '').length;
    if (digitCount < 10 || digitCount > 15) return ANSWER_ERROR_MESSAGES.phone;
  }
  if (field.type === 'date' && !DATE_PATTERN.test(value)) {
    return ANSWER_ERROR_MESSAGES.date;
  }
  if ((field.type === 'select' || field.type === 'radio')
      && (!Array.isArray(field.options) || !field.options.includes(value))) {
    return ANSWER_ERROR_MESSAGES.option;
  }
  return '';
}

export function validateAnswerDraft(fields, formData = {}) {
  const errors = {};

  for (const field of getVisibleFields(fields, formData)) {
    const present = Object.hasOwn(formData, field.id);
    const value = formData[field.id];
    const missing = requiredError(field, value, present);
    if (missing) {
      errors[field.id] = missing;
      continue;
    }
    if (!present) continue;
    const invalid = valueError(field, value);
    if (invalid) errors[field.id] = invalid;
  }

  return errors;
}

export function isAnswerDraftDirty(fields, savedFormData, draft) {
  return JSON.stringify(prepareVisibleAnswers(fields, savedFormData))
    !== JSON.stringify(prepareVisibleAnswers(fields, draft));
}

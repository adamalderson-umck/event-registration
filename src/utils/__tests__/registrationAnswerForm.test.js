import { describe, expect, it } from 'vitest';
import {
  buildAnswerDraft,
  getLegacyAnswers,
  getVisibleFields,
  isAnswerDraftDirty,
  prepareVisibleAnswers,
  validateAnswerDraft,
} from '../registrationAnswerForm';

const fields = [
  { id: 'section', type: 'sectionBreak', label: 'Vehicle' },
  { id: 'email', type: 'email', label: 'Email', required: true },
  {
    id: 'has_plate',
    type: 'radio',
    label: 'Plate?',
    required: true,
    options: ['Yes', 'No'],
  },
  {
    id: 'parking_license_plate',
    type: 'text',
    label: 'License Plate',
    required: true,
    condition: { field: 'has_plate', operator: 'equals', value: 'Yes' },
  },
];

describe('registration answer form utilities', () => {
  it('separates editable and legacy answers', () => {
    const saved = {
      email: 'a@example.org',
      has_plate: 'Yes',
      parking_license_plate: 'TEMP',
      retired: 'keep',
    };

    expect(buildAnswerDraft(fields, saved)).toEqual({
      email: 'a@example.org',
      has_plate: 'Yes',
      parking_license_plate: 'TEMP',
    });
    expect(getLegacyAnswers(fields, saved)).toEqual({ retired: 'keep' });
  });

  it('validates visible formats and drops hidden answers', () => {
    const draft = { email: 'bad', has_plate: 'No', parking_license_plate: 'TEMP' };

    expect(getVisibleFields(fields, draft).map((field) => field.id)).toEqual([
      'email',
      'has_plate',
    ]);
    expect(validateAnswerDraft(fields, draft)).toEqual({
      email: 'Please enter a valid email address',
    });
    expect(prepareVisibleAnswers(fields, draft)).toEqual({
      email: 'bad',
      has_plate: 'No',
    });
  });

  it('compares editable values independently of legacy answers', () => {
    const saved = {
      email: 'a@example.org',
      has_plate: 'No',
      retired: 'keep',
    };

    expect(isAnswerDraftDirty(
      fields,
      saved,
      buildAnswerDraft(fields, saved),
    )).toBe(false);
    expect(isAnswerDraftDirty(fields, saved, {
      email: 'b@example.org',
      has_plate: 'No',
    })).toBe(true);
  });

  it.each([
    [{ id: 'agree', type: 'checkbox', required: true }, false, 'This field is required'],
    [{ id: 'choices', type: 'checkboxGroup', required: true, options: ['A'] }, [], 'Select at least one option'],
    [{ id: 'phone', type: 'phone' }, '555-12', 'Please enter a valid phone number'],
    [{ id: 'count', type: 'number' }, 'many', 'Please enter a valid number'],
    [{ id: 'day', type: 'date' }, '08/07/2026', 'Please enter a valid date'],
    [{ id: 'choice', type: 'select', options: ['A', 'B'] }, 'C', 'Select a listed option'],
    [{ id: 'choice', type: 'radio', options: ['A', 'B'] }, 'C', 'Select a listed option'],
    [{ id: 'choices', type: 'checkboxGroup', options: ['A', 'B'] }, ['C'], 'Select a listed option'],
  ])('validates %s', (field, value, message) => {
    expect(validateAnswerDraft([field], { [field.id]: value })).toEqual({
      [field.id]: message,
    });
  });

  it('accepts valid supported values', () => {
    const supported = [
      { id: 'text', type: 'text', required: true },
      { id: 'email', type: 'email' },
      { id: 'phone', type: 'phone' },
      { id: 'number', type: 'number' },
      { id: 'date', type: 'date' },
      { id: 'textarea', type: 'textarea' },
      { id: 'select', type: 'select', options: ['A'] },
      { id: 'radio', type: 'radio', options: ['B'] },
      { id: 'checkbox', type: 'checkbox' },
      { id: 'group', type: 'checkboxGroup', options: ['C', 'D'] },
    ];

    expect(validateAnswerDraft(supported, {
      text: 'value',
      email: 'person@example.org',
      phone: '(330) 555-1212',
      number: '12',
      date: '2026-08-07',
      textarea: 'notes',
      select: 'A',
      radio: 'B',
      checkbox: false,
      group: ['C'],
    })).toEqual({});
  });

  it('rejects suspicious protected plates and prepares normalized answers', () => {
    const plateField = {
      id: 'parking_license_plate',
      type: 'text',
      label: 'License Plate',
      required: true,
    };

    expect(validateAnswerDraft([plateField], {
      parking_license_plate: 'XXXXXX',
    })).toEqual({
      parking_license_plate:
        'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.',
    });
    expect(prepareVisibleAnswers([plateField], {
      parking_license_plate: ' ab-c 123 ',
    })).toEqual({ parking_license_plate: 'ABC123' });
  });

  it('does not apply plate rules to an ordinary text field', () => {
    expect(validateAnswerDraft([
      { id: 'nickname', type: 'text', required: true },
    ], { nickname: 'XXXXXX' })).toEqual({});
  });
});

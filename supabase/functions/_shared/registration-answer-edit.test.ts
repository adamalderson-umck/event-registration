import { describe, expect, it } from 'vitest';
import { normalizeCurrentFormData } from './registration-request.ts';
import {
  parseRegistrationAnswerEditRequest,
  prepareRegistrationAnswerEdit,
} from './registration-answer-edit.ts';

const REGISTRATION_ID = '33333333-3333-4333-8333-333333333333';

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  org_id: '22222222-2222-4222-8222-222222222222',
  status: 'closed',
  form_fields: [
    { id: 'name', type: 'text', label: 'Name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'permit', type: 'radio', label: 'Permit?', required: true, options: ['Yes', 'No'] },
    {
      id: 'plate',
      type: 'text',
      label: 'License Plate',
      required: true,
      condition: { field: 'permit', operator: 'equals', value: 'Yes' },
    },
  ],
};

describe('normalizeCurrentFormData', () => {
  it('normalizes visible answers without new-registration status rules', () => {
    expect(normalizeCurrentFormData(event, {
      name: 'Alex',
      email: ' ALEX@EXAMPLE.ORG ',
      permit: 'Yes',
      plate: 'ABC123',
    })).toEqual({
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'Yes',
      plate: 'ABC123',
    });
  });

  it('rejects hidden answers and missing visible required answers', () => {
    expect(() => normalizeCurrentFormData(event, {
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'No',
      plate: 'ABC123',
    })).toThrow('invalid_request');
    expect(() => normalizeCurrentFormData(event, {
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'Yes',
    })).toThrow('invalid_request');
  });
});

describe('registration answer edits', () => {
  it('parses only the bounded request contract', () => {
    expect(parseRegistrationAnswerEditRequest({
      registrationId: REGISTRATION_ID,
      orgId: event.org_id,
      expectedFormData: { name: 'Alex' },
      answers: { name: 'Morgan' },
    })).toEqual({
      registrationId: REGISTRATION_ID,
      orgId: event.org_id,
      expectedFormData: { name: 'Alex' },
      answers: { name: 'Morgan' },
    });

    expect(() => parseRegistrationAnswerEditRequest({
      registrationId: REGISTRATION_ID,
      orgId: event.org_id,
      expectedFormData: {},
      answers: {},
      status: 'confirmed',
    })).toThrow('invalid_request');
  });

  it('preserves legacy answers and records current-field changes', () => {
    const prepared = prepareRegistrationAnswerEdit(event, {
      form_data: {
        name: 'Alex',
        email: 'alex@example.org',
        permit: 'Yes',
        plate: 'TEMP',
        retired: 'keep me',
      },
    }, {
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'Yes',
      plate: 'ABC123',
    });

    expect(prepared.formData).toEqual({
      retired: 'keep me',
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'Yes',
      plate: 'ABC123',
    });
    expect(prepared.changes).toEqual([{
      fieldId: 'plate',
      fieldLabel: 'License Plate',
      before: 'TEMP',
      after: 'ABC123',
    }]);
  });

  it('records removal when a condition hides a field', () => {
    const prepared = prepareRegistrationAnswerEdit(event, {
      form_data: {
        name: 'Alex',
        email: 'alex@example.org',
        permit: 'Yes',
        plate: 'TEMP',
      },
    }, {
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'No',
    });

    expect(prepared.formData).toEqual({
      name: 'Alex',
      email: 'alex@example.org',
      permit: 'No',
    });
    expect(prepared.changes).toEqual([
      { fieldId: 'permit', fieldLabel: 'Permit?', before: 'Yes', after: 'No' },
      { fieldId: 'plate', fieldLabel: 'License Plate', before: 'TEMP', after: null },
    ]);
  });

  it('returns no changes after normalization of equivalent answers', () => {
    expect(prepareRegistrationAnswerEdit(event, {
      form_data: { name: 'Alex', email: 'alex@example.org', permit: 'No' },
    }, {
      name: 'Alex',
      email: ' ALEX@EXAMPLE.ORG ',
      permit: 'No',
    }).changes).toEqual([]);
  });

  it('normalizes and audits a protected parking plate edit', () => {
    const parkingEvent = {
      ...event,
      form_fields: [
        ...event.form_fields,
        { id: 'parking_license_plate', type: 'text', label: 'License Plate', required: true },
      ],
    };
    const prepared = prepareRegistrationAnswerEdit(parkingEvent, {
      form_data: {
        name: 'Alex', email: 'alex@example.org', permit: 'No',
        parking_license_plate: 'TEMP', retired: 'keep me',
      },
    }, {
      name: 'Alex', email: 'alex@example.org', permit: 'No',
      parking_license_plate: ' ab-c 123 ',
    });

    expect(prepared.formData).toMatchObject({
      parking_license_plate: 'ABC123',
      retired: 'keep me',
    });
    expect(prepared.changes).toContainEqual({
      fieldId: 'parking_license_plate',
      fieldLabel: 'License Plate',
      before: 'TEMP',
      after: 'ABC123',
    });
    expect(() => prepareRegistrationAnswerEdit(parkingEvent, {
      form_data: prepared.formData,
    }, {
      name: 'Alex', email: 'alex@example.org', permit: 'No',
      parking_license_plate: 'XXXXXX',
    })).toThrow('invalid_request');
  });
});

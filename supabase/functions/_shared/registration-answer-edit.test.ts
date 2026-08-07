import { describe, expect, it } from 'vitest';
import { normalizeCurrentFormData } from './registration-request.ts';

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

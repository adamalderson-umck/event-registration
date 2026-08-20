import { describe, expect, it } from 'vitest';
import {
  INVALID_LICENSE_PLATE_CASES,
  VALID_LICENSE_PLATE_CASES,
} from '../../../test-fixtures/licensePlateValidationCases';
import {
  LICENSE_PLATE_ERROR,
  PARKING_LICENSE_PLATE_FIELD_ID,
  isPlausibleLicensePlate,
  normalizeLicensePlate,
  normalizeParkingLicensePlateAnswers,
} from '../licensePlate';

describe('parking license plate contract', () => {
  it.each(VALID_LICENSE_PLATE_CASES)('normalizes and accepts %s', (input, expected) => {
    expect(normalizeLicensePlate(input)).toBe(expected);
    expect(isPlausibleLicensePlate(input)).toBe(true);
    expect(normalizeLicensePlate(expected)).toBe(expected);
  });

  it.each(INVALID_LICENSE_PLATE_CASES)('rejects %s', (input) => {
    expect(isPlausibleLicensePlate(input)).toBe(false);
  });

  it('normalizes only the protected answer when that field is present', () => {
    const fields = [
      { id: 'notes', type: 'text' },
      { id: PARKING_LICENSE_PLATE_FIELD_ID, type: 'text' },
    ];
    expect(normalizeParkingLicensePlateAnswers(fields, {
      notes: ' keep-this ',
      [PARKING_LICENSE_PLATE_FIELD_ID]: ' ab-c 123 ',
    })).toEqual({
      notes: ' keep-this ',
      [PARKING_LICENSE_PLATE_FIELD_ID]: 'ABC123',
    });
  });

  it('exports the approved error text', () => {
    expect(LICENSE_PLATE_ERROR).toBe(
      'Enter a valid U.S. license plate using 3–8 letters and numbers, or TEMP for a temporary plate. Placeholder values are not accepted.',
    );
  });
});

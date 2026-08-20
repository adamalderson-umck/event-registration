import { describe, expect, it } from 'vitest';
import {
  INVALID_LICENSE_PLATE_CASES,
  VALID_LICENSE_PLATE_CASES,
} from '../../../test-fixtures/licensePlateValidationCases.js';
import {
  isPlausibleLicensePlate,
  normalizeLicensePlate,
} from './license-plate.ts';

describe('Edge Function parking plate contract', () => {
  it.each(VALID_LICENSE_PLATE_CASES)('normalizes and accepts %s', (input, expected) => {
    expect(normalizeLicensePlate(input)).toBe(expected);
    expect(isPlausibleLicensePlate(input)).toBe(true);
  });

  it.each(INVALID_LICENSE_PLATE_CASES)('rejects %s', (input) => {
    expect(isPlausibleLicensePlate(input)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { toSlug, isValidSlug } from '../../utils/slugUtils';

describe('toSlug', () => {
    it('lower-cases and hyphenates spaces', () => {
        expect(toSlug('VBS 2026')).toBe('vbs-2026');
    });
    it('strips leading/trailing hyphens', () => {
        expect(toSlug('  ---hello---  ')).toBe('hello');
    });
    it('collapses multiple separators', () => {
        expect(toSlug('Hello   World!!!')).toBe('hello-world');
    });
    it('returns empty string for empty input', () => {
        expect(toSlug('')).toBe('');
        expect(toSlug(null)).toBe('');
        expect(toSlug(undefined)).toBe('');
    });
});

describe('isValidSlug', () => {
    it('accepts valid slugs', () => {
        expect(isValidSlug('vbs-2026')).toBe(true);
        expect(isValidSlug('abc')).toBe(true);
    });
    it('rejects slugs that are too short', () => {
        expect(isValidSlug('ab')).toBe(false);
    });
    it('rejects uppercase', () => {
        expect(isValidSlug('VBS-2026')).toBe(false);
    });
    it('rejects leading hyphen', () => {
        expect(isValidSlug('-vbs-2026')).toBe(false);
    });
    it('rejects trailing hyphen', () => {
        expect(isValidSlug('vbs-2026-')).toBe(false);
    });
    it('rejects empty input', () => {
        expect(isValidSlug('')).toBe(false);
        expect(isValidSlug(null)).toBe(false);
    });
});

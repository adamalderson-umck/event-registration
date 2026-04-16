import { describe, it, expect } from 'vitest';
import {
    resolveTheme,
    resolveHeaderImage,
    checkAspectRatio,
    THEME_PRESETS,
    MAX_IMAGE_SIZE,
    ALLOWED_IMAGE_TYPES,
} from '../themePresets';

describe('resolveTheme', () => {
    it('returns system default when both args are null', () => {
        const result = resolveTheme(null, null);
        expect(result.primary).toBe('#2563eb');
        expect(result.accent).toBe('#8b5cf6');
        expect(result.presetId).toBe('default');
    });

    it('returns event preset colors when event theme is a known preset', () => {
        const result = resolveTheme({ preset: 'ocean' }, null);
        expect(result.primary).toBe('#0891b2');
        expect(result.accent).toBe('#06b6d4');
        expect(result.presetId).toBe('ocean');
    });

    it('falls back to org theme when event theme is null', () => {
        const result = resolveTheme(null, { preset: 'forest' });
        expect(result.primary).toBe('#059669');
        expect(result.accent).toBe('#34d399');
        expect(result.presetId).toBe('forest');
    });

    it('prioritizes event theme over org theme', () => {
        const result = resolveTheme(
            { preset: 'ruby' },
            { preset: 'forest' }
        );
        expect(result.primary).toBe('#dc2626');
        expect(result.presetId).toBe('ruby');
    });

    it('supports custom colors', () => {
        const result = resolveTheme({
            preset: 'custom',
            primaryColor: '#ff0000',
            accentColor: '#00ff00',
        }, null);
        expect(result.primary).toBe('#ff0000');
        expect(result.accent).toBe('#00ff00');
        expect(result.presetId).toBe('custom');
    });

    it('falls back to system default for custom without colors', () => {
        const result = resolveTheme({ preset: 'custom' }, null);
        expect(result.primary).toBe('#2563eb');
        expect(result.accent).toBe('#8b5cf6');
    });

    it('falls back to system default for unknown preset ID', () => {
        const result = resolveTheme({ preset: 'nonexistent' }, null);
        expect(result.primary).toBe('#2563eb');
    });
});

describe('resolveHeaderImage', () => {
    it('returns event image when set', () => {
        expect(resolveHeaderImage('https://event.png', 'https://org.png')).toBe('https://event.png');
    });

    it('falls back to org image when event is null', () => {
        expect(resolveHeaderImage(null, 'https://org.png')).toBe('https://org.png');
    });

    it('returns null when both are null', () => {
        expect(resolveHeaderImage(null, null)).toBeNull();
    });
});

describe('checkAspectRatio', () => {
    it('validates 1920x1080 as valid 16:9', () => {
        const result = checkAspectRatio(1920, 1080);
        expect(result.isValid).toBe(true);
        expect(result.ratio).toBe(1.78);
    });

    it('rejects 1:1 square as not 16:9', () => {
        const result = checkAspectRatio(1000, 1000);
        expect(result.isValid).toBe(false);
    });

    it('accepts close approximation within tolerance', () => {
        const result = checkAspectRatio(1600, 920);
        expect(result.isValid).toBe(true);
    });

    it('rejects 4:3 portrait as too far from 16:9', () => {
        const result = checkAspectRatio(800, 600);
        expect(result.isValid).toBe(false);
    });
});

describe('THEME_PRESETS', () => {
    it('has at least 8 presets', () => {
        expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
    });

    it('every preset has required keys', () => {
        for (const preset of THEME_PRESETS) {
            expect(preset).toHaveProperty('id');
            expect(preset).toHaveProperty('name');
            expect(preset).toHaveProperty('primary');
            expect(preset).toHaveProperty('accent');
        }
    });

    it('has unique IDs', () => {
        const ids = THEME_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('constants', () => {
    it('MAX_IMAGE_SIZE is 5MB', () => {
        expect(MAX_IMAGE_SIZE).toBe(5 * 1024 * 1024);
    });

    it('allows expected MIME types', () => {
        expect(ALLOWED_IMAGE_TYPES).toContain('image/jpeg');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/png');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/webp');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/gif');
    });
});

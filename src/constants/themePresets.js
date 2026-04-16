/**
 * Curated theme presets for event branding.
 * Each preset defines a primary and accent color used for headers, buttons, and accents.
 */

export const THEME_PRESETS = [
    {
        id: 'default',
        name: 'Default Blue',
        primary: '#2563eb',
        accent: '#8b5cf6',
    },
    {
        id: 'ocean',
        name: 'Ocean',
        primary: '#0891b2',
        accent: '#06b6d4',
    },
    {
        id: 'forest',
        name: 'Forest',
        primary: '#059669',
        accent: '#34d399',
    },
    {
        id: 'sunset',
        name: 'Sunset',
        primary: '#ea580c',
        accent: '#f59e0b',
    },
    {
        id: 'berry',
        name: 'Berry',
        primary: '#c026d3',
        accent: '#e879f9',
    },
    {
        id: 'slate',
        name: 'Slate',
        primary: '#475569',
        accent: '#94a3b8',
    },
    {
        id: 'ruby',
        name: 'Ruby',
        primary: '#dc2626',
        accent: '#f87171',
    },
    {
        id: 'indigo',
        name: 'Indigo',
        primary: '#4f46e5',
        accent: '#818cf8',
    },
];

/** System-wide default colors (matches Tailwind @theme) */
const SYSTEM_DEFAULT = {
    primary: '#2563eb',
    accent: '#8b5cf6',
};

/**
 * Resolve the effective theme for an event, with fallback chain:
 * event.theme → organization.default_theme → system default
 *
 * @param {Object|null} eventTheme - The event's theme JSONB value
 * @param {Object|null} orgDefaultTheme - The organization's default_theme JSONB value
 * @returns {{ primary: string, accent: string, presetId: string|null }}
 */
export function resolveTheme(eventTheme, orgDefaultTheme) {
    const theme = eventTheme || orgDefaultTheme;

    if (!theme) {
        return { ...SYSTEM_DEFAULT, presetId: 'default' };
    }

    // If it's a preset, look up the colors
    if (theme.preset && theme.preset !== 'custom') {
        const preset = THEME_PRESETS.find((p) => p.id === theme.preset);
        if (preset) {
            return {
                primary: preset.primary,
                accent: preset.accent,
                presetId: preset.id,
            };
        }
    }

    // Custom or unknown preset — use stored colors with fallback
    return {
        primary: theme.primaryColor || SYSTEM_DEFAULT.primary,
        accent: theme.accentColor || SYSTEM_DEFAULT.accent,
        presetId: theme.preset || 'custom',
    };
}

/**
 * Resolve the effective header image URL for an event, with fallback chain:
 * event.header_image_url → organization.default_header_image_url → null
 *
 * @param {string|null} eventImageUrl
 * @param {string|null} orgDefaultImageUrl
 * @returns {string|null}
 */
export function resolveHeaderImage(eventImageUrl, orgDefaultImageUrl) {
    return eventImageUrl || orgDefaultImageUrl || null;
}

/**
 * Check if an image's aspect ratio is approximately 16:9.
 * @param {number} width
 * @param {number} height
 * @param {number} tolerance - Percentage tolerance (default 15%)
 * @returns {{ isValid: boolean, ratio: number, expected: number }}
 */
export function checkAspectRatio(width, height, tolerance = 0.15) {
    const ratio = width / height;
    const expected = 16 / 9;
    const diff = Math.abs(ratio - expected) / expected;
    return {
        isValid: diff <= tolerance,
        ratio: Math.round(ratio * 100) / 100,
        expected: Math.round(expected * 100) / 100,
    };
}

/** Max upload size in bytes (5MB) */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Allowed MIME types for header images */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

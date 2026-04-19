/**
 * slugUtils.js
 * Shared helpers for event slug generation and validation.
 */

/**
 * Converts a free-text string into a URL-safe slug.
 * e.g. "VBS 2026!" → "vbs-2026"
 */
export function toSlug(text) {
  if (!text) return '';
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Returns true when slug is URL-safe.
 * Rules: lowercase alphanumeric and hyphens, 3-80 chars, no leading/trailing hyphen.
 */
export function isValidSlug(slug) {
  if (!slug) return false;
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug);
}

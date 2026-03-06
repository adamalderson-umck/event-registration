/**
 * Compute SHA-256 hash of a string using the Web Crypto API.
 * Returns a hex-encoded hash string prefixed with "sha256:".
 */
export async function sha256(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hashHex}`;
}

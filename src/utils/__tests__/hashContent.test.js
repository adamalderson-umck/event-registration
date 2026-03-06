import { describe, it, expect } from 'vitest';
import { sha256 } from '../hashContent';

describe('sha256', () => {
    it('returns a sha256-prefixed hex hash', async () => {
        const result = await sha256('hello world');
        expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces consistent hashes', async () => {
        const a = await sha256('test content');
        const b = await sha256('test content');
        expect(a).toBe(b);
    });

    it('produces different hashes for different content', async () => {
        const a = await sha256('content A');
        const b = await sha256('content B');
        expect(a).not.toBe(b);
    });
});

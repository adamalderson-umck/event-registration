import { describe, expect, it } from 'vitest';
import {
    RECENT_REGISTRATION_ERROR,
    getRegistrationSubmissionErrorCode,
} from '../registrationSubmission';

describe('getRegistrationSubmissionErrorCode', () => {
    it('reads the sanitized Edge Function error envelope from a cloned response', async () => {
        const context = new Response(JSON.stringify({
            error: RECENT_REGISTRATION_ERROR,
            requestId: 'request-123',
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });

        await expect(getRegistrationSubmissionErrorCode({ context }))
            .resolves.toBe(RECENT_REGISTRATION_ERROR);
        await expect(context.json()).resolves.toEqual({
            error: RECENT_REGISTRATION_ERROR,
            requestId: 'request-123',
        });
    });

    it.each([
        null,
        {},
        { context: {} },
        { context: new Response('not json', { status: 500 }) },
        { context: new Response(JSON.stringify({ error: 42 }), { status: 500 }) },
    ])('returns null for an unreadable or malformed error context', async (error) => {
        await expect(getRegistrationSubmissionErrorCode(error)).resolves.toBeNull();
    });
});

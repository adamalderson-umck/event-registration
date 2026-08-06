import { describe, expect, it } from 'vitest';
import {
    getAvailablePaymentMethods,
    getTithelyDraftStatus,
    normalizeTithelyConfiguration,
    parseTithelyEmbedCode,
    parseTithelyGivingUrl,
    TITHELY_ERROR_CODES,
    validateStoredTithelyConfiguration,
} from '../tithelyEmbed';

const FORM_ID = '59b0fe48-e075-436e-a91e-88011a19d975';
const OTHER_FORM_ID = 'c7f9f415-e9e4-4f78-a763-f2a9b1da27ca';
const givingUrl = `https://give.tithe.ly/?formId=${FORM_ID}&amount=100`;

function embedCode(formId = FORM_ID) {
    return `<button class="tithely-give-button" data-form="${formId}" style="background: #fff">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`;
}

describe('Tithe.ly giving URL parsing', () => {
    it('normalizes a valid current-style giving URL and preserves safe parameters', () => {
        expect(parseTithelyGivingUrl(givingUrl)).toEqual({
            formId: FORM_ID,
            givingUrl,
        });
    });

    it.each([
        'http://give.tithe.ly/?formId=' + FORM_ID,
        'https://give.tithe.ly.example/?formId=' + FORM_ID,
        'https://give.tithe.ly/give?formId=' + FORM_ID,
        `https://user:password@give.tithe.ly/?formId=${FORM_ID}`,
        `https://give.tithe.ly/?formId=${FORM_ID}#section`,
        'https://give.tithe.ly/',
        'https://give.tithe.ly/?formId=not-a-uuid',
        `https://give.tithe.ly/?formId=${FORM_ID}&formId=${FORM_ID}`,
    ])('rejects an unsafe or invalid giving URL: %s', url => {
        expect(() => parseTithelyGivingUrl(url)).toThrow();
    });
});

describe('Tithe.ly embed parsing', () => {
    it('accepts the official button and deferred script pair', () => {
        expect(parseTithelyEmbedCode(embedCode())).toEqual({ formId: FORM_ID });
    });

    it.each([
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://example.com/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}" onclick="alert(1)">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js">alert(1)</script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="other" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<button data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}" title="Give">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}"><span onclick="alert(1)">Give</span></button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<title>Unexpected</title><button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<body data-extra="unsafe"><button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script></body>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer async src="https://static.tithely.com/give/give.js"></script>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}"><span>Give</span></button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<head data-extra="unsafe"></head><button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
    ])('rejects unsafe or incomplete embed code', code => {
        expect(() => parseTithelyEmbedCode(code)).toThrow('Use the official Tithe.ly embed button and script.');
    });

    it.each([
        '<button class="tithely-give-button">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>',
        '<button class="tithely-give-button" data-form="not-a-uuid">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>',
    ])('reports a missing or invalid embed form ID distinctly', code => {
        expect(() => parseTithelyEmbedCode(code)).toThrow(
            'The Tithe.ly embed code must include one valid form ID.',
        );
    });
});

describe('Tithe.ly configuration', () => {
    it('normalizes a matching URL and current embed snippet', () => {
        expect(normalizeTithelyConfiguration({ givingUrl, embedCode: embedCode() })).toEqual({
            givingUrl,
            embedConfig: { formId: FORM_ID },
        });
    });

    it('reuses saved embed configuration when no code is pasted again', () => {
        expect(normalizeTithelyConfiguration({
            givingUrl,
            existingEmbedConfig: { formId: FORM_ID },
        })).toEqual({
            givingUrl,
            embedConfig: { formId: FORM_ID },
        });
    });

    it('returns a null configuration when all inputs are absent', () => {
        expect(normalizeTithelyConfiguration({})).toEqual({ givingUrl: null, embedConfig: null });
    });

    it('rejects mismatched URL and embed form IDs', () => {
        expect(() => normalizeTithelyConfiguration({
            givingUrl,
            embedCode: embedCode(OTHER_FORM_ID),
        })).toThrow('Tithe.ly URL and embed code must use the same form ID.');
    });

    it('rejects a saved form ID that does not match the URL', () => {
        expect(() => normalizeTithelyConfiguration({
            givingUrl,
            existingEmbedConfig: { formId: OTHER_FORM_ID },
        })).toThrow('Tithe.ly URL and embed code must use the same form ID.');
    });

    it.each([
        {
            name: 'missing URL',
            configuration: { embedCode: embedCode() },
            errorCode: TITHELY_ERROR_CODES.MISSING_URL,
            message: 'Enter the Tithe.ly giving URL.',
        },
        {
            name: 'invalid host or protocol',
            configuration: { givingUrl: `http://example.com/?formId=${FORM_ID}`, embedCode: embedCode() },
            errorCode: TITHELY_ERROR_CODES.INVALID_URL,
            message: 'Use an HTTPS give.tithe.ly giving URL.',
        },
        {
            name: 'missing or invalid form ID',
            configuration: { givingUrl: 'https://give.tithe.ly/', embedCode: embedCode() },
            errorCode: TITHELY_ERROR_CODES.INVALID_URL_FORM_ID,
            message: 'The Tithe.ly giving URL must include one valid form ID.',
        },
        {
            name: 'missing embed code',
            configuration: { givingUrl },
            errorCode: TITHELY_ERROR_CODES.MISSING_EMBED,
            message: 'Paste the official Tithe.ly embed code.',
        },
        {
            name: 'unsupported embed structure',
            configuration: { givingUrl, embedCode: '<button>Give</button>' },
            errorCode: TITHELY_ERROR_CODES.INVALID_EMBED,
            message: 'Use the official Tithe.ly embed button and script.',
        },
        {
            name: 'missing or invalid embed form ID',
            configuration: {
                givingUrl,
                embedCode: '<button class="tithely-give-button" data-form="not-a-uuid">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>',
            },
            errorCode: TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID,
            message: 'The Tithe.ly embed code must include one valid form ID.',
        },
        {
            name: 'mismatched form IDs',
            configuration: { givingUrl, embedCode: embedCode(OTHER_FORM_ID) },
            errorCode: TITHELY_ERROR_CODES.MISMATCH,
            message: 'Tithe.ly URL and embed code must use the same form ID.',
        },
    ])('returns a distinct draft error for $name', ({ configuration, errorCode, message }) => {
        expect(getTithelyDraftStatus(configuration)).toEqual({
            configured: false,
            error: message,
            errorCode,
            givingUrl: null,
            embedConfig: null,
        });
    });
});

describe('stored Tithe.ly configuration and payment methods', () => {
    const storedEvent = {
        payment_enabled: true,
        tithely_giving_url: givingUrl,
        tithely_embed_config: { formId: FORM_ID },
        allow_in_person_payment: true,
    };

    it('validates a persisted snake-case configuration', () => {
        expect(validateStoredTithelyConfiguration(storedEvent)).toEqual({
            valid: true,
            givingUrl,
            embedConfig: { formId: FORM_ID },
        });
    });

    it('validates a camelCase editor configuration', () => {
        expect(validateStoredTithelyConfiguration({
            tithelyGivingUrl: givingUrl,
            tithelyEmbedConfig: { formId: FORM_ID },
        })).toEqual({
            valid: true,
            givingUrl,
            embedConfig: { formId: FORM_ID },
        });
    });

    it('rejects a stored form ID mismatch', () => {
        expect(validateStoredTithelyConfiguration({
            ...storedEvent,
            tithely_embed_config: { formId: OTHER_FORM_ID },
        })).toEqual({
            valid: false,
            error: 'Tithe.ly URL and embed code must use the same form ID.',
        });
    });

    it('derives valid Tithe.ly and in-person methods in order', () => {
        expect(getAvailablePaymentMethods(storedEvent)).toEqual(['tithely', 'in_person']);
    });

    it('offers only in-person payment when stored Tithe.ly config is invalid', () => {
        expect(getAvailablePaymentMethods({
            ...storedEvent,
            tithely_embed_config: { formId: OTHER_FORM_ID },
        })).toEqual(['in_person']);
    });

    it('offers no payment methods when payment is disabled', () => {
        expect(getAvailablePaymentMethods({ ...storedEvent, payment_enabled: false })).toEqual([]);
    });
});

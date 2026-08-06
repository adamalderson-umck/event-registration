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
const LOCATION_ID = 'c9f19096-4a76-4ea1-be56-d7f16d1e5241';
const FUND_ID = 'c4c11990-779e-4582-ba46-bf510ed3a37f';
const OTHER_FORM_ID = 'c7f9f415-e9e4-4f78-a763-f2a9b1da27ca';
const OTHER_LOCATION_ID = 'a0fd1a72-96af-4bb2-8d33-9363d290c13a';
const OTHER_FUND_ID = 'f24a14b1-cf17-4d5c-9d34-2ef3c3319bde';
const givingUrl = `https://give.tithe.ly/?formId=${FORM_ID}&locationId=${LOCATION_ID}&fundId=${FUND_ID}&amount=10000&frequency=one-time`;
const officialEmbedCode = '<button class="tithely-give-button" data-form=59b0fe48-e075-436e-a91e-88011a19d975 data-location=c9f19096-4a76-4ea1-be56-d7f16d1e5241 data-fund="c4c11990-779e-4582-ba46-bf510ed3a37f" data-amount="10000" data-frequency="one-time" style="background-color: #00DB72; font-family: inherit; font-weight: bold; font-size: 19px; padding: 15px 70px; border-radius: 4px; cursor: pointer; background-image: none; color: white; text-shadow: none; display: inline-block; float: none; border: none;">Give</button><script src="https://static.tithely.com/give/give.js" defer></script>';
const structuredConfig = {
    formId: FORM_ID,
    locationId: LOCATION_ID,
    fundId: FUND_ID,
    amount: '10000',
    frequency: 'one-time',
};

function embedCode(overrides = {}) {
    const config = { ...structuredConfig, ...overrides };
    return `<button class="tithely-give-button" data-form="${config.formId}" data-location="${config.locationId}" data-fund="${config.fundId}" data-amount="${config.amount}" data-frequency="${config.frequency}" style="background: #fff">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`;
}

describe('Tithe.ly giving URL parsing', () => {
    it('normalizes the official giving URL and extracts structured fallback values', () => {
        expect(parseTithelyGivingUrl(givingUrl)).toEqual({
            ...structuredConfig,
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
        `https://give.tithe.ly/?formId=${FORM_ID}&locationId=not-a-uuid`,
        `https://give.tithe.ly/?formId=${FORM_ID}&fundId=not-a-uuid`,
        `https://give.tithe.ly/?formId=${FORM_ID}&amount=lots`,
        `https://give.tithe.ly/?formId=${FORM_ID}&frequency=one%20time`,
        `https://give.tithe.ly/?formId=${FORM_ID}&amount=100&amount=200`,
    ])('rejects an unsafe or invalid giving URL: %s', url => {
        expect(() => parseTithelyGivingUrl(url)).toThrow();
    });
});

describe('Tithe.ly embed parsing', () => {
    it('accepts the exact official button and deferred script pair', () => {
        expect(parseTithelyEmbedCode(officialEmbedCode)).toEqual(structuredConfig);
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
        `<button class="tithely-give-button" data-form="${FORM_ID}"><span>Give</span></button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<title>Unexpected</title><button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script>`,
        `<body data-extra="unsafe"><button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer src="https://static.tithely.com/give/give.js"></script></body>`,
        `<button class="tithely-give-button" data-form="${FORM_ID}">Give</button><script defer async src="https://static.tithely.com/give/give.js"></script>`,
        embedCode({ locationId: 'not-a-uuid' }),
        embedCode({ fundId: 'not-a-uuid' }),
        embedCode({ amount: 'lots' }),
        embedCode({ frequency: 'one time' }),
    ])('rejects unsafe or invalid embed code', code => {
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
    it('normalizes the matching official URL and embed snippet', () => {
        expect(normalizeTithelyConfiguration({ givingUrl, embedCode: officialEmbedCode })).toEqual({
            givingUrl,
            embedConfig: structuredConfig,
        });
    });

    it('enriches a saved form-ID-only configuration from the giving URL', () => {
        expect(normalizeTithelyConfiguration({
            givingUrl,
            existingEmbedConfig: { formId: FORM_ID },
        })).toEqual({
            givingUrl,
            embedConfig: structuredConfig,
        });
    });

    it('returns a null configuration when all inputs are absent', () => {
        expect(normalizeTithelyConfiguration({})).toEqual({ givingUrl: null, embedConfig: null });
    });

    it.each([
        ['form', 'formId', OTHER_FORM_ID],
        ['location', 'locationId', OTHER_LOCATION_ID],
        ['fund', 'fundId', OTHER_FUND_ID],
        ['amount', 'amount', '25000'],
        ['frequency', 'frequency', 'monthly'],
    ])('rejects mismatched %s values', (_name, key, value) => {
        expect(() => normalizeTithelyConfiguration({
            givingUrl,
            embedCode: embedCode({ [key]: value }),
        })).toThrow('Tithe.ly URL and embed code must use the same form, location, fund, amount, and frequency.');
    });

    it('rejects an unknown saved configuration key', () => {
        expect(() => normalizeTithelyConfiguration({
            givingUrl,
            existingEmbedConfig: { formId: FORM_ID, rawHtml: '<script>alert(1)</script>' },
        })).toThrow('Use the official Tithe.ly embed button and script.');
    });

    it.each([
        {
            name: 'missing URL',
            configuration: { embedCode: officialEmbedCode },
            errorCode: TITHELY_ERROR_CODES.MISSING_URL,
            message: 'Enter the Tithe.ly giving URL.',
        },
        {
            name: 'invalid host or protocol',
            configuration: { givingUrl: `http://example.com/?formId=${FORM_ID}`, embedCode: officialEmbedCode },
            errorCode: TITHELY_ERROR_CODES.INVALID_URL,
            message: 'Use an HTTPS give.tithe.ly giving URL.',
        },
        {
            name: 'missing or invalid form ID',
            configuration: { givingUrl: 'https://give.tithe.ly/', embedCode: officialEmbedCode },
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
            name: 'mismatched configuration',
            configuration: { givingUrl, embedCode: embedCode({ amount: '25000' }) },
            errorCode: TITHELY_ERROR_CODES.MISMATCH,
            message: 'Tithe.ly URL and embed code must use the same form, location, fund, amount, and frequency.',
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

    it('validates and enriches a persisted form-ID-only configuration', () => {
        expect(validateStoredTithelyConfiguration(storedEvent)).toEqual({
            valid: true,
            givingUrl,
            embedConfig: structuredConfig,
        });
    });

    it('rejects a stored form ID mismatch', () => {
        expect(validateStoredTithelyConfiguration({
            ...storedEvent,
            tithely_embed_config: { formId: OTHER_FORM_ID },
        })).toEqual({
            valid: false,
            error: 'Tithe.ly URL and embed code must use the same form, location, fund, amount, and frequency.',
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

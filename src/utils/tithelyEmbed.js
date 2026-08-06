const TITHELY_GIVING_ORIGIN = 'https://give.tithe.ly';
export const TITHELY_SCRIPT_URL = 'https://static.tithely.com/give/give.js';

export const TITHELY_ERROR_CODES = Object.freeze({
    MISSING_URL: 'missing_url',
    INVALID_URL: 'invalid_url',
    INVALID_URL_FORM_ID: 'invalid_url_form_id',
    INVALID_EMBED_FORM_ID: 'invalid_embed_form_id',
    MISSING_EMBED: 'missing_embed',
    INVALID_EMBED: 'invalid_embed',
    MISMATCH: 'mismatch',
});

const TITHELY_ERROR_MESSAGES = Object.freeze({
    [TITHELY_ERROR_CODES.MISSING_URL]: 'Enter the Tithe.ly giving URL.',
    [TITHELY_ERROR_CODES.INVALID_URL]: 'Use an HTTPS give.tithe.ly giving URL.',
    [TITHELY_ERROR_CODES.INVALID_URL_FORM_ID]: 'The Tithe.ly giving URL must include one valid form ID.',
    [TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID]: 'The Tithe.ly embed code must include one valid form ID.',
    [TITHELY_ERROR_CODES.MISSING_EMBED]: 'Paste the official Tithe.ly embed code.',
    [TITHELY_ERROR_CODES.INVALID_EMBED]: 'Use the official Tithe.ly embed button and script.',
    [TITHELY_ERROR_CODES.MISMATCH]: 'Tithe.ly URL and embed code must use the same form, location, fund, amount, and frequency.',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

const STRUCTURED_FIELDS = Object.freeze([
    { key: 'formId', query: 'formId', attribute: 'data-form', required: true, validate: isUuid },
    { key: 'locationId', query: 'locationId', attribute: 'data-location', validate: isUuid },
    { key: 'fundId', query: 'fundId', attribute: 'data-fund', validate: isUuid },
    { key: 'amount', query: 'amount', attribute: 'data-amount', validate: value => /^\d+$/.test(value) && Number(value) > 0 },
    { key: 'frequency', query: 'frequency', attribute: 'data-frequency', validate: value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value) },
]);
const BUTTON_ATTRIBUTES = new Set(['class', 'style', ...STRUCTURED_FIELDS.map(field => field.attribute)]);
const SAVED_CONFIG_KEYS = new Set(STRUCTURED_FIELDS.map(field => field.key));

function fail(code) {
    const error = new Error(TITHELY_ERROR_MESSAGES[code]);
    error.code = code;
    throw error;
}

function getGivingUrl(configuration) {
    return configuration?.tithely_giving_url ?? configuration?.tithelyGivingUrl ?? configuration?.givingUrl;
}

function getEmbedConfig(configuration) {
    return configuration?.tithely_embed_config
        ?? configuration?.tithelyEmbedConfig
        ?? configuration?.embedConfig;
}

function readUrlConfiguration(url) {
    return STRUCTURED_FIELDS.reduce((result, field) => {
        const values = url.searchParams.getAll(field.query);

        if (values.length > 1 || (field.required && values.length !== 1)) {
            fail(field.key === 'formId'
                ? TITHELY_ERROR_CODES.INVALID_URL_FORM_ID
                : TITHELY_ERROR_CODES.INVALID_URL);
        }

        if (values.length === 1) {
            if (!field.validate(values[0])) {
                fail(field.key === 'formId'
                    ? TITHELY_ERROR_CODES.INVALID_URL_FORM_ID
                    : TITHELY_ERROR_CODES.INVALID_URL);
            }
            result[field.key] = values[0];
        }

        return result;
    }, {});
}

function readButtonConfiguration(button) {
    return STRUCTURED_FIELDS.reduce((result, field) => {
        const value = button.getAttribute(field.attribute);

        if (field.required && !value) {
            fail(TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID);
        }

        if (value != null) {
            if (!field.validate(value)) {
                fail(field.key === 'formId'
                    ? TITHELY_ERROR_CODES.INVALID_EMBED_FORM_ID
                    : TITHELY_ERROR_CODES.INVALID_EMBED);
            }
            result[field.key] = value;
        }

        return result;
    }, {});
}

function normalizeSavedEmbedConfig(embedConfig) {
    if (embedConfig == null) {
        fail(TITHELY_ERROR_CODES.MISSING_EMBED);
    }

    if (
        typeof embedConfig !== 'object'
        || Array.isArray(embedConfig)
        || Object.keys(embedConfig).some(key => !SAVED_CONFIG_KEYS.has(key))
    ) {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    return STRUCTURED_FIELDS.reduce((result, field) => {
        const value = embedConfig[field.key];

        if (field.required && !value) {
            fail(TITHELY_ERROR_CODES.INVALID_EMBED);
        }

        if (value != null) {
            if (typeof value !== 'string' || !field.validate(value)) {
                fail(TITHELY_ERROR_CODES.INVALID_EMBED);
            }
            result[field.key] = value;
        }

        return result;
    }, {});
}

export function parseTithelyGivingUrl(value) {
    let url;

    if (typeof value !== 'string' || !value.trim()) {
        fail(TITHELY_ERROR_CODES.MISSING_URL);
    }

    try {
        url = new URL(value);
    } catch {
        fail(TITHELY_ERROR_CODES.INVALID_URL);
    }

    if (
        url.protocol !== 'https:'
        || url.origin !== TITHELY_GIVING_ORIGIN
        || url.pathname !== '/'
        || url.username
        || url.password
        || url.hash
    ) {
        fail(TITHELY_ERROR_CODES.INVALID_URL);
    }

    return { ...readUrlConfiguration(url), givingUrl: url.toString() };
}

export function parseTithelyEmbedCode(embedCode) {
    if (typeof embedCode !== 'string' || !embedCode.trim()) {
        fail(TITHELY_ERROR_CODES.MISSING_EMBED);
    }
    if (typeof DOMParser === 'undefined') {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    const document = new DOMParser().parseFromString(embedCode, 'text/html');
    const elements = [...document.body.children];
    const hasOnlyAllowedBodyNodes = [...document.body.childNodes].every(node => (
        node.nodeType === 1 || (node.nodeType === 3 && !node.textContent.trim())
    ));
    const hasEventHandler = [...document.querySelectorAll('*')].some(element => (
        [...element.attributes].some(attribute => attribute.name.startsWith('on'))
    ));

    if (
        document.head.childNodes.length
        || document.head.attributes.length
        || document.documentElement.attributes.length
        || document.body.attributes.length
        || hasEventHandler
        || !hasOnlyAllowedBodyNodes
        || elements.length !== 2
    ) {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    const button = elements.find(element => element.tagName === 'BUTTON');
    const script = elements.find(element => element.tagName === 'SCRIPT');
    if (!button || !script) {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    const hasInvalidButtonAttribute = [...button.attributes].some(attribute => (
        attribute.name.startsWith('on') || !BUTTON_ATTRIBUTES.has(attribute.name)
    ));
    if (
        hasInvalidButtonAttribute
        || button.getAttribute('class') !== 'tithely-give-button'
        || button.children.length
    ) {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    const scriptAttributes = [...script.attributes];
    const hasInvalidScriptAttribute = scriptAttributes.some(attribute => !['src', 'defer'].includes(attribute.name));
    if (
        hasInvalidScriptAttribute
        || script.getAttribute('src') !== TITHELY_SCRIPT_URL
        || !script.hasAttribute('defer')
        || script.textContent.trim()
    ) {
        fail(TITHELY_ERROR_CODES.INVALID_EMBED);
    }

    return readButtonConfiguration(button);
}

export function normalizeTithelyConfiguration({ givingUrl, embedCode = '', existingEmbedConfig = null } = {}) {
    const pastedEmbedCode = typeof embedCode === 'string' ? embedCode.trim() : embedCode;
    const hasGivingUrl = typeof givingUrl === 'string' && givingUrl.trim();
    const hasExistingConfig = existingEmbedConfig != null;

    if (!hasGivingUrl && !pastedEmbedCode && !hasExistingConfig) {
        return { givingUrl: null, embedConfig: null };
    }

    const parsedUrl = parseTithelyGivingUrl(givingUrl);
    const parsedEmbedConfig = pastedEmbedCode
        ? parseTithelyEmbedCode(pastedEmbedCode)
        : normalizeSavedEmbedConfig(existingEmbedConfig);
    const urlConfig = Object.fromEntries(
        STRUCTURED_FIELDS
            .filter(({ key }) => parsedUrl[key] != null)
            .map(({ key }) => [key, parsedUrl[key]]),
    );
    const hasMismatch = STRUCTURED_FIELDS.some(({ key }) => (
        urlConfig[key] != null
        && parsedEmbedConfig[key] != null
        && urlConfig[key].toLowerCase() !== parsedEmbedConfig[key].toLowerCase()
    ));

    if (hasMismatch) {
        fail(TITHELY_ERROR_CODES.MISMATCH);
    }

    return {
        givingUrl: parsedUrl.givingUrl,
        embedConfig: { ...urlConfig, ...parsedEmbedConfig },
    };
}

export function getTithelyDraftStatus(configuration) {
    try {
        const normalized = normalizeTithelyConfiguration(configuration);
        return { configured: Boolean(normalized.givingUrl), error: null, ...normalized };
    } catch (error) {
        return {
            configured: false,
            error: error instanceof Error ? error.message : String(error),
            errorCode: error instanceof Error ? error.code ?? null : null,
            givingUrl: null,
            embedConfig: null,
        };
    }
}

export function validateStoredTithelyConfiguration(configuration) {
    try {
        const normalized = normalizeTithelyConfiguration({
            givingUrl: getGivingUrl(configuration),
            existingEmbedConfig: getEmbedConfig(configuration),
        });

        if (!normalized.givingUrl) {
            return { valid: false, error: 'Tithe.ly configuration is incomplete.' };
        }

        return { valid: true, ...normalized };
    } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export function getAvailablePaymentMethods(configuration) {
    const paymentEnabled = configuration?.payment_enabled ?? configuration?.paymentEnabled;
    if (!paymentEnabled) {
        return [];
    }

    const methods = [];
    if (validateStoredTithelyConfiguration(configuration).valid) {
        methods.push('tithely');
    }

    if (configuration?.allow_in_person_payment ?? configuration?.allowInPersonPayment) {
        methods.push('in_person');
    }

    return methods;
}

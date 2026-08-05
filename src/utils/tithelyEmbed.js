const TITHELY_GIVING_ORIGIN = 'https://give.tithe.ly';
const TITHELY_SCRIPT_URL = 'https://static.tithely.com/give/give.js';
const EMBED_ERROR = 'Paste the official Tithe.ly embed code.';
const URL_ERROR = 'Enter a valid Tithe.ly giving URL.';
const MISMATCH_ERROR = 'Tithe.ly URL and embed code must use the same form ID.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

function fail(message) {
    throw new Error(message);
}

function getGivingUrl(configuration) {
    return configuration?.tithely_giving_url ?? configuration?.tithelyGivingUrl ?? configuration?.givingUrl;
}

function getEmbedConfig(configuration) {
    return configuration?.tithely_embed_config
        ?? configuration?.tithelyEmbedConfig
        ?? configuration?.embedConfig;
}

export function parseTithelyGivingUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        fail(URL_ERROR);
    }

    if (
        url.protocol !== 'https:'
        || url.origin !== TITHELY_GIVING_ORIGIN
        || url.pathname !== '/'
        || url.username
        || url.password
        || url.hash
    ) {
        fail(URL_ERROR);
    }

    const formIds = url.searchParams.getAll('formId');
    if (formIds.length !== 1 || !isUuid(formIds[0])) {
        fail(URL_ERROR);
    }

    return { formId: formIds[0], givingUrl: url.toString() };
}

export function parseTithelyEmbedCode(embedCode) {
    if (typeof embedCode !== 'string' || typeof DOMParser === 'undefined') {
        fail(EMBED_ERROR);
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
        fail(EMBED_ERROR);
    }

    const button = elements.find(element => element.tagName === 'BUTTON');
    const script = elements.find(element => element.tagName === 'SCRIPT');
    if (!button || !script) {
        fail(EMBED_ERROR);
    }

    const buttonAttributes = [...button.attributes];
    const hasInvalidButtonAttribute = buttonAttributes.some(attribute => (
        attribute.name.startsWith('on')
        || !['class', 'data-form', 'style'].includes(attribute.name)
    ));
    if (
        hasInvalidButtonAttribute
        || button.getAttribute('class') !== 'tithely-give-button'
        || !isUuid(button.getAttribute('data-form'))
        || button.children.length
    ) {
        fail(EMBED_ERROR);
    }

    const scriptAttributes = [...script.attributes];
    const hasInvalidScriptAttribute = scriptAttributes.some(attribute => !['src', 'defer'].includes(attribute.name));
    if (
        hasInvalidScriptAttribute
        || script.getAttribute('src') !== TITHELY_SCRIPT_URL
        || !script.hasAttribute('defer')
        || script.textContent.trim()
    ) {
        fail(EMBED_ERROR);
    }

    return { formId: button.getAttribute('data-form') };
}

export function normalizeTithelyConfiguration({ givingUrl, embedCode = '', existingEmbedConfig = null } = {}) {
    const pastedEmbedCode = typeof embedCode === 'string' ? embedCode.trim() : embedCode;
    const hasGivingUrl = typeof givingUrl === 'string' && givingUrl.trim();
    const hasExistingConfig = existingEmbedConfig != null;

    if (!hasGivingUrl && !pastedEmbedCode && !hasExistingConfig) {
        return { givingUrl: null, embedConfig: null };
    }

    const parsedUrl = parseTithelyGivingUrl(givingUrl);
    const embedConfig = pastedEmbedCode
        ? parseTithelyEmbedCode(pastedEmbedCode)
        : normalizeSavedEmbedConfig(existingEmbedConfig);

    if (parsedUrl.formId.toLowerCase() !== embedConfig.formId.toLowerCase()) {
        fail(MISMATCH_ERROR);
    }

    return { givingUrl: parsedUrl.givingUrl, embedConfig };
}

function normalizeSavedEmbedConfig(embedConfig) {
    if (!isUuid(embedConfig?.formId)) {
        fail(EMBED_ERROR);
    }

    return { formId: embedConfig.formId };
}

export function getTithelyDraftStatus(configuration) {
    try {
        const normalized = normalizeTithelyConfiguration(configuration);
        return { configured: Boolean(normalized.givingUrl), error: null, ...normalized };
    } catch (error) {
        return {
            configured: false,
            error: error instanceof Error ? error.message : String(error),
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

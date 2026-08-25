const FLASH_2_IMAGE_SIZES = [
    { value: '512', label: '512px' },
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
];
const PRO_IMAGE_SIZES = [
    { value: '1K', label: '1K' },
    { value: '2K', label: '2K' },
    { value: '4K', label: '4K' },
];

const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-image', label: 'Nano Banana 🍌 (~$0.04/img)', variant: 'flash', status: 'existing' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 🍌 (Flash)', variant: 'flash2', imageSizeOptions: FLASH_2_IMAGE_SIZES, supportsThinking: true, supportsGoogleSearch: true, status: 'existing' },
    { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro 🍌 (~$0.14/img)', variant: 'pro', imageSizeOptions: PRO_IMAGE_SIZES, status: 'existing' },
];

export const PROVIDERS = {
    makersuite: {
        id: 'makersuite',
        label: 'Google AI Studio',
        credentialKey: null,
        ui: { requiresApiKey: false, modelDiscovery: false, adapterRequired: false },
        models: GEMINI_MODELS,
    },
    linkapi: {
        id: 'linkapi',
        label: 'LinkAPI',
        credentialKey: 'linkapi',
        ui: {
            requiresApiKey: true,
            apiKeyLabel: 'LinkAPI API Key',
            modelDiscovery: { endpoint: '/models', responseFormat: 'openai-list', filter: 'image' },
            showsLegacyRecovery: true,
            providerInfo: 'Used only for image generation. Gemini proxy URL: https://api.linkapi.ai (do not add /v1).',
            adapterRequired: true,
        },
        transports: {
            sillyTavernGeminiProxy: { baseUrl: 'https://api.linkapi.ai' },
            openAiImages: { baseUrl: 'https://linkapi.ai/v1' },
        },
        models: GEMINI_MODELS.map((model) => ({ ...model, label: model.label.replace(/ \(~\$[^)]*\)/, ' (LinkAPI)').replace(' (Flash)', ' (LinkAPI)') , transport: 'sillyTavernGeminiProxy' })).concat([
            { id: 'gpt-image-2-c', label: 'ChatGPT Image 🖼️ (gpt-image-2-c)', variant: 'gptimage', transport: 'openAiImages', supportsReferenceImages: false, supportsSize: true, modelNote: 'ChatGPT models: text prompt only — avatar/reference images are not supported.', status: 'existing' },
        ]),
    },
    tokenreply: {
        id: 'tokenreply',
        label: 'TokenReply (Experimental)',
        status: 'experimental',
        credentialKey: 'tokenreply',
        ui: {
            requiresApiKey: true,
            apiKeyLabel: 'TokenReply API Key',
            modelDiscovery: { endpoint: '/models', responseFormat: 'openai-list', filter: 'tokenreply-image', experimental: true },
            providerInfo: 'Experimental: TokenReply uses grok-imagine-image through https://api.tokenreply.com/v1/images/generations. Only text prompts are sent; image-size and reference-image options stay disabled until a live compatibility check verifies them.',
            adapterRequired: true,
        },
        transports: { openAiImages: { baseUrl: 'https://api.tokenreply.com/v1' } },
        models: [
            { id: 'grok-imagine-image', label: 'Grok Imagine Image (Experimental)', transport: 'openAiImages', supportsReferenceImages: false, modelNote: 'Experimental: TokenReply Grok uses a minimal text-only OpenAI Images request. Image size and reference images are not sent.', status: 'experimental' },
            { id: 'grok-imagine-image-quality', label: 'Grok Imagine Image Quality (Experimental)', transport: 'openAiImages', supportsReferenceImages: false, modelNote: 'Experimental: TokenReply Grok uses a minimal text-only OpenAI Images request. Image size and reference images are not sent.', status: 'experimental' },
        ],
    },
    openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        credentialKey: null,
        ui: { requiresApiKey: false, modelDiscovery: false, adapterRequired: false },
        models: [
            { id: 'google/gemini-2.5-flash-image-preview', label: 'Nano Banana 🍌 (OpenRouter)', variant: 'flash', status: 'existing' },
            { id: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana 2 🍌 (OpenRouter)', variant: 'flash2', imageSizeOptions: FLASH_2_IMAGE_SIZES, supportsThinking: true, supportsGoogleSearch: true, status: 'existing' },
            { id: 'google/gemini-3-pro-image-preview', label: 'Nano Banana Pro 🍌 (OpenRouter)', variant: 'pro', imageSizeOptions: PRO_IMAGE_SIZES, status: 'existing' },
        ],
    },
};

export function getProviderDefinitions() {
    return Object.values(PROVIDERS);
}

export function getProviderDefinition(providerId) {
    return PROVIDERS[providerId];
}

function getLinkApiImageFallback(modelId) {
    if (!/^(gpt-image|dall-e)/i.test(modelId || '')) return undefined;
    return { id: modelId, label: modelId, transport: 'openAiImages', supportsReferenceImages: false, supportsSize: true, modelNote: 'ChatGPT models: text prompt only — avatar/reference images are not supported.', status: 'existing' };
}

export function getModelDefinition(providerId, modelId) {
    const provider = getProviderDefinition(providerId);
    const model = provider?.models.find((candidate) => candidate.id === modelId);
    return model || (providerId === 'linkapi' ? getLinkApiImageFallback(modelId) : undefined);
}

export function resolveTransport(providerId, modelId) {
    return getModelDefinition(providerId, modelId)?.transport;
}

export function resolveProviderRoute(providerId, modelId) {
    const provider = getProviderDefinition(providerId);
    const model = getModelDefinition(providerId, modelId);
    return { provider, model, transport: model?.transport };
}

export function requiresAdapterRoute(route) {
    return route.provider?.ui?.adapterRequired === true;
}

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

import { normalizeProviderDefinition, normalizeProviderConnection, normalizeModelDefinition, normalizeModelCapabilities, normalizeCapabilityEvidence, capabilityIsSupported, unknownCapabilities } from './contracts.js';

export { normalizeProviderDefinition, normalizeProviderConnection, normalizeModelDefinition, normalizeModelCapabilities, normalizeCapabilityEvidence, capabilityIsSupported, unknownCapabilities };

const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-image', label: 'Nano Banana 🍌 (~$0.04/img)', variant: 'flash', referenceImages: { maxCount: 3 }, transport: 'host-chat-image', status: 'existing' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 🍌 (Flash)', variant: 'flash2', imageSizeOptions: FLASH_2_IMAGE_SIZES, referenceImages: { maxCount: 4 }, supportsThinking: true, supportsGoogleSearch: true, transport: 'host-chat-image', status: 'existing' },
    { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro 🍌 (~$0.14/img)', variant: 'pro', imageSizeOptions: PRO_IMAGE_SIZES, referenceImages: { maxCount: 14 }, transport: 'host-chat-image', status: 'existing' },
];

function openAiImagesProvider({ id, label, baseUrl, models, discovery, info, provenance }) {
    return {
        id,
        label,
        status: 'experimental',
        posture: 'experimental',
        credentialKey: id,
        ui: {
            requiresApiKey: true,
            apiKeyLabel: `${label} API Key`,
            ...(discovery ? { modelDiscovery: discovery } : { modelDiscovery: false }),
            adapterRequired: true,
            providerInfo: info,
        },
        transports: { openAiImages: { baseUrl } },
        models: models.map((model) => ({
            ...model,
            transport: 'openAiImages',
            status: 'experimental',
        })),
        ...(discovery ? { discovery } : {}),
        ...(provenance ? { provenance } : {}),
    };
}

const WAVE_1_PROVENANCE = {
    sourceLicense: 'MIT research reimplementation; no provider code copied',
    reviewedRevision: 'hosted-provider-inventory-luna.md (2026-08-24)',
};

const FUTURE_SERVER_REASONS = {
    zai: 'Z.AI uses a native quality/size payload; server adapter required.',
    fal: 'Future server adapter: Fal requires a server proxy because browser clients cannot safely expose API keys.',
    replicate: 'Future server adapter: Replicate uses secret-bearing asynchronous predictions and polling.',
    civitai: 'Future server adapter: CivitAI uses secret-bearing asynchronous workflows and hosted output retrieval.',
    pixai: 'Future server adapter: PixAI uses secret-bearing asynchronous tasks and hosted output retrieval.',
    kie: 'Future server adapter: Kie.ai requires secret-bearing uploads and asynchronous polling.',
    midjourney: 'Future server adapter: LegNext is a third-party asynchronous gateway.',
    'custom-api': 'Future server adapter: declarative custom APIs require an SSRF-resistant server boundary.',
    novelai: 'Future server adapter: NovelAI native output is binary/proxy-specific and direct key use is unsafe.',
    stability: 'Future server adapter: Stability REST output is legacy/binary-specific and direct key use is unsafe.',
    naistera: 'Future server adapter: Naistera has conflicting routes and unverified browser safety.',
    arliai: 'Future server adapter: ArliAI direct key/CORS behavior is unverified.',
    chutes: 'Future server adapter: Chutes direct key/CORS behavior is unverified.',
};

function futureServerProvider(id, label, unavailableReason = FUTURE_SERVER_REASONS[id]) {
    return {
        id,
        label,
        status: 'future-server',
        posture: 'future-server',
        available: false,
        unavailableReason,
        connectionKinds: ['server-adapter'],
        ui: {
            requiresApiKey: false,
            modelDiscovery: false,
            adapterRequired: true,
            providerInfo: unavailableReason,
        },
        provenance: WAVE_1_PROVENANCE,
    };
}

const FUTURE_SERVER_PROVIDERS = Object.freeze([
    futureServerProvider('zai', 'Z.AI (Future Server Adapter)'),
    futureServerProvider('fal', 'Fal.ai (Future Server Adapter)'),
    futureServerProvider('replicate', 'Replicate (Future Server Adapter)'),
    futureServerProvider('civitai', 'CivitAI (Future Server Adapter)'),
    futureServerProvider('pixai', 'PixAI (Future Server Adapter)'),
    futureServerProvider('kie', 'Kie.ai (Future Server Adapter)'),
    futureServerProvider('midjourney', 'Midjourney via LegNext (Future Server Adapter)'),
    futureServerProvider('custom-api', 'Custom Hosted API (Future Server Adapter)'),
    futureServerProvider('novelai', 'NovelAI (Future Server Adapter)'),
    futureServerProvider('stability', 'Stability AI (Future Server Adapter)'),
    futureServerProvider('naistera', 'Naistera (Future Server Adapter)'),
    futureServerProvider('arliai', 'ArliAI (Future Server Adapter)'),
    futureServerProvider('chutes', 'Chutes (Future Server Adapter)'),
]);

export { FUTURE_SERVER_PROVIDERS };

export const PROVIDERS = {
    makersuite: {
        id: 'makersuite',
        label: 'Google AI Studio',
        credentialKey: null,
        transportIds: ['host-chat-image'],
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
        models: GEMINI_MODELS.map(({ referenceImages, ...model }) => ({ ...model, label: model.label.replace(/ \(~\$[^)]*\)/, ' (LinkAPI)').replace(' (Flash)', ' (LinkAPI)') , transport: 'sillyTavernGeminiProxy' })).concat([
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
        transportIds: ['host-chat-image'],
        ui: { requiresApiKey: false, modelDiscovery: false, adapterRequired: false },
        models: [
            { id: 'google/gemini-2.5-flash-image-preview', label: 'Nano Banana 🍌 (OpenRouter)', variant: 'flash', transport: 'host-chat-image', status: 'existing' },
            { id: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana 2 🍌 (OpenRouter)', variant: 'flash2', imageSizeOptions: FLASH_2_IMAGE_SIZES, supportsThinking: true, supportsGoogleSearch: true, transport: 'host-chat-image', status: 'existing' },
            { id: 'google/gemini-3-pro-image-preview', label: 'Nano Banana Pro 🍌 (OpenRouter)', variant: 'pro', imageSizeOptions: PRO_IMAGE_SIZES, transport: 'host-chat-image', status: 'existing' },
        ],
    },
    openai: openAiImagesProvider({
        id: 'openai',
        label: 'OpenAI GPT Image',
        baseUrl: 'https://api.openai.com/v1',
        models: [
            { id: 'gpt-image-2', label: 'GPT Image 2', supportsReferenceImages: false, modelNote: 'Experimental: strict Images generation is text-only until a model route proves reference support.' },
            { id: 'gpt-image-1.5', label: 'GPT Image 1.5', supportsReferenceImages: false },
            { id: 'gpt-image-1', label: 'GPT Image 1', supportsReferenceImages: false },
            { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', supportsReferenceImages: false },
        ],
        info: 'Experimental: direct OpenAI Images requests use a browser-visible API key. Prefer a trusted SillyTavern/server route where available.',
        provenance: WAVE_1_PROVENANCE,
    }),
    pollinations: {
        ...openAiImagesProvider({
            id: 'pollinations',
            label: 'Pollinations (Experimental)',
            baseUrl: 'https://gen.pollinations.ai/v1',
            models: [
                { id: 'flux', label: 'Flux' },
                { id: 'turbo', label: 'Turbo' },
                { id: 'kontext', label: 'Kontext' },
            ],
            info: 'Experimental: paid JSON generation uses the Bearer-authenticated /v1/images/generations route. Query-string keys are never used.',
            provenance: WAVE_1_PROVENANCE,
        }),
        transports: {
            openAiImages: { baseUrl: 'https://gen.pollinations.ai/v1' },
            pollinationsCatalog: { baseUrl: 'https://gen.pollinations.ai' },
        },
        discovery: { kind: 'native', endpoint: '/image/models', transportId: 'pollinationsCatalog', parserId: 'pollinations-image-models', retryable: true },
    },
    nanogpt: {
        ...openAiImagesProvider({
            id: 'nanogpt',
            label: 'NanoGPT (Experimental)',
            baseUrl: 'https://nano-gpt.com/v1',
            models: [
                { id: 'flux', label: 'Flux' },
                { id: 'flux-pro', label: 'Flux Pro' },
                { id: 'gpt-image-1', label: 'GPT Image 1' },
            ],
            info: 'Experimental: generation uses the verified /v1/images/generations route. Detailed catalog metadata is required before optional capabilities are enabled.',
            provenance: WAVE_1_PROVENANCE,
        }),
        transports: {
            openAiImages: { baseUrl: 'https://nano-gpt.com/v1' },
            nanogptCatalog: { baseUrl: 'https://nano-gpt.com/api' },
        },
        discovery: { kind: 'native', endpoint: '/v1/image-models?detailed=true', transportId: 'nanogptCatalog', parserId: 'nanogpt-image-models', retryable: true },
    },
    together: openAiImagesProvider({
        id: 'together',
        label: 'Together AI (Experimental)',
        baseUrl: 'https://api.together.xyz/v1',
        models: [{ id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'Stable Diffusion XL Base' }],
        info: 'Experimental: Together AI Images requests use the synchronous OpenAI-compatible endpoint. References and optional controls remain unknown.',
        provenance: WAVE_1_PROVENANCE,
    }),
    routeway: {
        ...openAiImagesProvider({
            id: 'routeway',
            label: 'Routeway (Experimental)',
            baseUrl: 'https://api.routeway.ai/v1',
            models: [{ id: 'flux', label: 'Flux' }],
            discovery: { endpoint: '/models', responseFormat: 'openai-list', filter: 'image-capable', experimental: true },
            info: 'Experimental: Routeway uses the synchronous OpenAI Images endpoint. Discovery filters to models with explicit image output metadata.',
            provenance: WAVE_1_PROVENANCE,
        }),
    },
    navy: openAiImagesProvider({
        id: 'navy',
        label: 'Navy.ai (Experimental)',
        baseUrl: 'https://api.navy/v1',
        models: [
            { id: 'flux', label: 'Flux' },
            { id: 'gpt-image', label: 'GPT Image' },
            { id: 'nano-banana', label: 'Nano Banana' },
        ],
        info: 'Experimental: Navy.ai uses a synchronous OpenAI-compatible image route. Response and optional capabilities remain unverified.',
        provenance: WAVE_1_PROVENANCE,
    }),
};

for (const provider of FUTURE_SERVER_PROVIDERS) PROVIDERS[provider.id] = provider;

export function getProviderDefinitions() {
    return Object.values(PROVIDERS);
}

export function getNormalizedProviderDefinitions() {
    return getProviderDefinitions().map((provider) => normalizeProviderDefinition(provider));
}

export function getProviderDefinition(providerId) {
    return PROVIDERS[providerId];
}

export function getNormalizedProviderDefinition(providerId) {
    const provider = getProviderDefinition(providerId);
    return provider ? normalizeProviderDefinition(provider) : undefined;
}

function getLinkApiImageFallback(modelId) {
    if (!/^(gpt-image|dall-e)/i.test(modelId || '')) return undefined;
    return { id: modelId, label: modelId, transport: 'openAiImages', supportsReferenceImages: false, supportsSize: true, modelNote: 'ChatGPT models: text prompt only — avatar/reference images are not supported.', status: 'existing' };
}

export function getModelDefinition(providerId, modelId) {
    const provider = getProviderDefinition(providerId);
    const model = (provider?.models || []).find((candidate) => candidate.id === modelId);
    return model || (providerId === 'linkapi' ? getLinkApiImageFallback(modelId) : undefined);
}

export function resolveTransport(providerId, modelId) {
    return getModelDefinition(providerId, modelId)?.transport;
}

export function getReferenceImageCapability(providerId, modelId) {
    const capability = getModelDefinition(providerId, modelId)?.referenceImages;
    return Number.isInteger(capability?.maxCount) && capability.maxCount > 0
        ? { maxCount: capability.maxCount }
        : undefined;
}

export function resolveProviderRoute(providerId, modelId) {
    const provider = getProviderDefinition(providerId);
    const model = getModelDefinition(providerId, modelId);
    return { provider, model, transport: model?.transport };
}

const ADAPTER_IDS = {
    openAiImages: 'openai-images',
    sillyTavernGeminiProxy: 'sillytavern-gemini-proxy',
    'host-chat-image': 'host-chat-image',
};

/** Validate a resolved provider/model before any transport can run. */
export function validateProviderRoute({ providerId, modelId, transportId, endpoint, modelDefinition, adapterRegistry } = {}) {
    const provider = getProviderDefinition(providerId);
    if (!provider) throw new Error(`Provider route is unresolved: ${providerId || 'unknown'}.`);
    if (provider.available === false || provider.posture === 'future-server' || provider.status === 'future-server') {
        throw new Error(`${provider.label || provider.id} is unavailable until a server adapter is available.`);
    }
    const model = modelDefinition || getModelDefinition(providerId, modelId);
    if (!model) throw new Error(`Model route is unresolved: ${providerId || 'unknown'}/${modelId || 'unknown'}.`);
    if (model.id !== modelId || (model.providerId && model.providerId !== providerId)) throw new Error(`Model route is forged for ${providerId}/${modelId}.`);
    const declaredTransport = model.transportId || model.transport;
    const allowedTransports = Array.isArray(provider.transportIds) && provider.transportIds.length
        ? provider.transportIds
        : Object.keys(provider.transports || {});
    if (!declaredTransport || allowedTransports.length && !allowedTransports.includes(declaredTransport)) {
        throw new Error(`Transport route is not allowlisted for ${providerId}/${modelId}.`);
    }
    const expectedAdapter = ADAPTER_IDS[declaredTransport] || declaredTransport;
    if (!expectedAdapter || !transportId || expectedAdapter !== transportId) {
        throw new Error(`Transport route is unresolved for ${providerId}/${modelId}.`);
    }
    const curatedEndpoint = provider.transports?.[declaredTransport]?.baseUrl;
    if (curatedEndpoint && endpoint !== curatedEndpoint) throw new Error(`Endpoint route is not curated for ${providerId}/${modelId}.`);
    if (adapterRegistry && typeof adapterRegistry.has === 'function' && !adapterRegistry.has(expectedAdapter)) {
        throw new Error(`Transport adapter is not registered: ${expectedAdapter}.`);
    }
    return { provider, model, adapterId: expectedAdapter, endpoint: provider.transports?.[declaredTransport]?.baseUrl };
}

export function requiresAdapterRoute(route) {
    return route.provider?.ui?.adapterRequired === true;
}

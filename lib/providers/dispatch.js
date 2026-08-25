import { buildGeminiProxyRequest } from './gemini-proxy.js';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from './openai-images.js';
import { attachNormalizedProviderError } from './errors.js';
import { decodeGenerationArtifact } from './artifact-decoder.js';
import { getProviderDefinition, validateProviderRoute } from './registry.js';
import { NATIVE_HOSTED_ADAPTERS } from './native-hosted.js';

function endpointFor(plan, connection, context = {}) {
    // The resolved plan endpoint is authoritative. Connection/context values
    // are only compatibility defaults for schema-1 callers at the boundary.
    return plan?.resolved?.endpoint || context.endpoint || connection?.endpoint || '';
}

function secretFor(connection, context) {
    if (typeof context.resolveSecret === 'function') return context.resolveSecret(connection);
    return context.apiKey || context.secret || '';
}

function messagesFor(plan, context) {
    return Array.isArray(plan?.messages) ? plan.messages : (Array.isArray(context.messages) ? context.messages : []);
}

function generationPrompt(plan, context) {
    const parts = [];
    for (const message of plan?.messages || []) {
        if (Array.isArray(message?.content)) for (const part of message.content) if (part?.type === 'text' && part.text) parts.push(part.text);
        else if (typeof message?.content === 'string' && message.content) parts.push(message.content);
    }
    return String(parts.join('\n\n') || plan?.prompt?.sourceMessage || context.prompt || '').trim();
}

function capabilityIsPositivelyEvidenced(capability) {
    return capability?.state === 'supported'
        && ['official-docs', 'curated-fixture', 'live-sanitized'].includes(capability.source)
        && (capability.source !== 'live-sanitized' || typeof capability.observedAt === 'string');
}

function requiresExperimentalPreflight(plan) {
    const sourceKind = plan?.resolved?.modelDefinition?.source?.kind;
    const imageGeneration = plan?.resolved?.capabilities?.imageGeneration || plan?.resolved?.modelDefinition?.capabilities?.imageGeneration;
    return ['manual', 'fetched'].includes(sourceKind)
        && imageGeneration?.state === 'unknown'
        && plan?.policy?.preflightAccepted !== true;
}

function imageEndpoint(baseUrl) {
    if (!baseUrl) return '';
    return /\/images\/generations\/?$/iu.test(baseUrl) ? baseUrl : `${String(baseUrl).replace(/\/$/u, '')}/images/generations`;
}

async function decodeProviderArtifact(input, options = {}) {
    if (input == null || (typeof input === 'object' && !input.data && !input.inlineData && !input.b64_json && !input.imageData && !input.url)) return input;
    if (input?.data && Array.isArray(input.data)) {
        const parsed = parseOpenAiImagesResponse(input);
        if (parsed.b64) return decodeGenerationArtifact({ b64_json: parsed.b64, mimeType: 'image/png' }, options);
        if (parsed.url) return decodeGenerationArtifact(parsed.url, options);
    }
    return decodeGenerationArtifact(input, options);
}

async function requestSillyTavern(plan, connection, signal, context, requestBody) {
    if (typeof context.requestSillyTavernImage === 'function') {
        const result = await context.requestSillyTavernImage(requestBody, { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, signal });
        return decodeGenerationArtifact(result?.imageData ? { b64_json: result.imageData, mimeType: result.mimeType || 'image/png' } : result, { signal, fetchImpl: context.fetchImpl, downloadLimits: context.downloadLimits });
    }
    const fetchImpl = context.fetchImpl || fetch;
    const response = await fetchImpl(context.sillyTavernEndpoint || '/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: typeof context.getRequestHeaders === 'function' ? context.getRequestHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal,
    });
    if (!response.ok) {
        const responseText = await response.text();
        throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, status: response.status, responseText });
    }
    const json = await response.json();
    for (const part of json?.responseContent?.parts || []) {
        if (part?.inlineData?.data) return decodeGenerationArtifact({ inlineData: part.inlineData }, { signal, fetchImpl, downloadLimits: context.downloadLimits });
    }
    throw new Error(json?.choices?.[0]?.message?.content ? 'Model returned text instead of image' : 'No image was returned by the API');
}

const sillyTavernGeminiProxy = {
    id: 'sillytavern-gemini-proxy',
    executionClass: 'sillytavern',
    async generate({ plan, connection, signal, transportContext = {} }) {
        const request = buildGeminiProxyRequest({
            model: plan.resolved.modelId,
            messages: messagesFor(plan, transportContext),
            apiKey: secretFor(connection, transportContext),
            baseUrl: endpointFor(plan, connection, transportContext),
            aspectRatio: plan.options?.aspectRatio,
            imageSize: plan.options?.imageSize,
            isFlash2: /gemini-3\.1/iu.test(plan.resolved.modelId),
            thinkingLevel: plan.options?.thinkingLevel,
            useGoogleSearch: plan.options?.useGoogleSearch === true,
        });
        return requestSillyTavern(plan, connection, signal, transportContext, request);
    },
};

const hostChatImage = {
    id: 'host-chat-image',
    executionClass: 'sillytavern',
    async generate({ plan, connection, signal, transportContext = {} }) {
        const request = {
            chat_completion_source: plan.resolved.providerId,
            model: plan.resolved.modelId,
            messages: messagesFor(plan, transportContext),
            max_tokens: 8192,
            temperature: 1,
            request_images: true,
            request_image_aspect_ratio: plan.options?.aspectRatio || '1:1',
            request_image_resolution: plan.options?.imageSize || undefined,
            stream: false,
            reverse_proxy: transportContext.reverseProxy || '',
            proxy_password: secretFor(connection, transportContext),
        };
        if (/gemini-3\.1/iu.test(plan.resolved.modelId)) {
            if (plan.options?.thinkingLevel && plan.options.thinkingLevel !== 'auto') request.reasoning_effort = plan.options.thinkingLevel;
            if (plan.options?.useGoogleSearch === true) request.enable_web_search = true;
        }
        return requestSillyTavern(plan, connection, signal, transportContext, request);
    },
};

const openAiImages = {
    id: 'openai-images',
    executionClass: 'browser',
    async generate({ plan, connection, signal, transportContext = {} }) {
        const fetchImpl = transportContext.fetchImpl || fetch;
        const baseUrl = endpointFor(plan, connection, transportContext);
        const url = imageEndpoint(baseUrl);
        if (!url) throw new TypeError('OpenAI Images endpoint is not configured.');
        const capabilities = plan.resolved?.capabilities || {};
        const sizesSupported = capabilityIsPositivelyEvidenced(capabilities.sizes);
        const size = sizesSupported && plan.options?.imageSize ? plan.options.imageSize : undefined;
        if (typeof transportContext.requestOpenAiImages === 'function') {
            const raw = await transportContext.requestOpenAiImages({
                apiKey: secretFor(connection, transportContext),
                model: plan.resolved.modelId,
                prompt: generationPrompt(plan, transportContext),
                size,
                baseUrl,
                providerId: plan.resolved.providerId,
            }, { signal });
            return decodeProviderArtifact(raw, { signal, fetchImpl, downloadLimits: transportContext.downloadLimits });
        }
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secretFor(connection, transportContext)}` },
            body: JSON.stringify(buildOpenAiImagesRequest({ model: plan.resolved.modelId, prompt: generationPrompt(plan, transportContext), size, responseFormat: 'b64_json', capabilities })),
            signal,
        });
        if (!response.ok) {
            const responseText = await response.text();
            throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, status: response.status, responseText });
        }
        const parsed = parseOpenAiImagesResponse(await response.json());
        if (parsed.b64) return decodeGenerationArtifact({ b64_json: parsed.b64, mimeType: 'image/png' }, { signal, fetchImpl, downloadLimits: transportContext.downloadLimits });
        return decodeGenerationArtifact(parsed.url, { fetchImpl, signal, downloadLimits: transportContext.downloadLimits });
    },
};

const linkApiLegacyRecovery = {
    id: 'linkapi-legacy-recovery',
    executionClass: 'browser',
    async generate(input) {
        if (input.plan.resolved.legacyKind === 'openai-images') return openAiImages.generate(input);
        if (input.plan.resolved.legacyKind === 'gemini-proxy') return sillyTavernGeminiProxy.generate(input);
        throw new TypeError('Legacy LinkAPI recovery requires an explicit legacy transport kind.');
    },
};

export const DEFAULT_TRANSPORTS = Object.freeze({
    'host-chat-image': hostChatImage,
    'sillytavern-gemini-proxy': sillyTavernGeminiProxy,
    'openai-images': openAiImages,
    'linkapi-legacy-recovery': linkApiLegacyRecovery,
    ...NATIVE_HOSTED_ADAPTERS,
});

export function createTransportRegistry(adapters = {}) {
    const registry = new Map(Object.entries(adapters));
    return {
        register(adapter) {
            if (!adapter?.id || typeof adapter.generate !== 'function') throw new TypeError('Transport adapter requires an id and generate function.');
            registry.set(adapter.id, adapter);
            return adapter;
        },
        get(id) { return registry.get(id); },
        has(id) { return registry.has(id); },
        ids() { return [...registry.keys()]; },
    };
}

const defaultRegistry = createTransportRegistry(DEFAULT_TRANSPORTS);

export async function dispatchProviderRoute({ plan, connection, signal, transportContext = {} } = {}) {
    // One-release compatibility boundary for callers from before schema 2.
    // Runtime entrypoints use the plan branch below; this preserves extension
    // integrations while they migrate without creating a second coordinator.
    if (!plan) {
        const legacy = arguments[0] || {};
        const route = legacy.route;
        const transportId = route?.transport === 'openAiImages' ? 'openai-images' : route?.transport === 'sillyTavernGeminiProxy' ? 'sillytavern-gemini-proxy' : '';
        if (transportId === 'openai-images' && typeof legacy.requestOpenAiImages === 'function') {
            const legacyPlan = {
                schema: 2,
                id: `legacy:${route.provider.id}:${legacy.modelId}`,
                idempotencyKey: `legacy:${route.provider.id}:${legacy.modelId}`,
                invocation: 'settings',
                target: null,
                resolved: { providerId: route.provider.id, modelId: legacy.modelId, transportId, endpoint: route.provider.transports.openAiImages.baseUrl, capabilities: route.model?.supportsSize ? { sizes: { state: 'supported', source: 'curated-fixture' } } : {} },
                prompt: { sourceMessage: legacy.prompt || '' },
                options: {
                    aspectRatio: route.model?.supportsSize ? legacy.aspectRatio : '',
                    imageSize: route.model?.supportsSize && typeof legacy.mapAspectRatioToSize === 'function'
                        ? legacy.mapAspectRatioToSize(legacy.aspectRatio)
                        : '',
                },
            };
            return openAiImages.generate({
                plan: legacyPlan,
                connection: { id: `${route.provider.id}:default`, providerId: route.provider.id, kind: 'browser-api-key', enabled: true },
                signal: new AbortController().signal,
                transportContext: { apiKey: legacy.apiKey, mapAspectRatioToSize: legacy.mapAspectRatioToSize, requestOpenAiImages: legacy.requestOpenAiImages },
            });
        }
        throw new TypeError('Dispatch requires a schema-2 plan, connection, and signal.');
    }
    if (!connection || !signal) throw new TypeError('Dispatch requires plan, connection, and signal.');
    if (connection.providerId !== plan.resolved?.providerId) throw new Error('Connection provider does not match the resolved provider route.');
    if (connection.id !== plan.resolved?.connectionId) throw new Error('Connection id does not match the resolved connection route.');
    if (requiresExperimentalPreflight(plan)) throw new Error('Experimental model route requires explicit preflight confirmation before generation.');
    const registry = transportContext.transports || defaultRegistry;
    const declaredProvider = getProviderDefinition(plan.resolved?.providerId);
    if (declaredProvider || !transportContext.transports) validateProviderRoute({
        providerId: plan.resolved?.providerId,
        modelId: plan.resolved?.modelId,
        transportId: plan.resolved?.transportId,
        endpoint: plan.resolved?.endpoint,
        modelDefinition: plan.resolved?.modelDefinition,
        adapterRegistry: registry,
    });
    const adapter = typeof registry.get === 'function' ? registry.get(plan.resolved?.transportId) : registry[plan.resolved?.transportId];
    if (!adapter) throw new Error(`No transport adapter is registered for: ${plan.resolved?.transportId || 'unknown'}`);
    const result = await adapter.generate({ plan, connection, signal, transportContext });
    return decodeProviderArtifact(result, { signal, fetchImpl: transportContext.fetchImpl, downloadLimits: transportContext.downloadLimits });
}

export { defaultRegistry as transportRegistry };

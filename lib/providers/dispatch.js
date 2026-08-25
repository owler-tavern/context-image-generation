import { buildGeminiProxyRequest } from './gemini-proxy.js';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from './openai-images.js';
import { attachNormalizedProviderError } from './errors.js';
import { downloadImageData } from './safe-image-download.js';

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
    return String(plan?.prompt?.sourceMessage || context.prompt || '').trim();
}

function imageEndpoint(baseUrl) {
    if (!baseUrl) return '';
    return /\/images\/generations\/?$/iu.test(baseUrl) ? baseUrl : `${String(baseUrl).replace(/\/$/u, '')}/images/generations`;
}

async function requestSillyTavern(plan, connection, signal, context, requestBody) {
    if (typeof context.requestSillyTavernImage === 'function') {
        return context.requestSillyTavernImage(requestBody, { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, signal });
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
        if (part?.inlineData?.data) return { imageData: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
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
        const size = typeof transportContext.mapAspectRatioToSize === 'function' && plan.options?.aspectRatio
            ? transportContext.mapAspectRatioToSize(plan.options.aspectRatio)
            : plan.options?.imageSize;
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secretFor(connection, transportContext)}` },
            body: JSON.stringify(buildOpenAiImagesRequest({ model: plan.resolved.modelId, prompt: generationPrompt(plan, transportContext), size, responseFormat: 'b64_json' })),
            signal,
        });
        if (!response.ok) {
            const responseText = await response.text();
            throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, status: response.status, responseText });
        }
        const parsed = parseOpenAiImagesResponse(await response.json());
        if (parsed.b64) return { imageData: parsed.b64, mimeType: 'image/png' };
        return downloadImageData(parsed.url, { fetchImpl, signal, ...(transportContext.downloadLimits || {}) });
    },
};

export const DEFAULT_TRANSPORTS = Object.freeze({
    'host-chat-image': hostChatImage,
    'sillytavern-gemini-proxy': sillyTavernGeminiProxy,
    'openai-images': openAiImages,
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
            return legacy.requestOpenAiImages({
                apiKey: legacy.apiKey,
                model: legacy.modelId,
                prompt: legacy.prompt,
                size: route.model?.supportsSize ? legacy.mapAspectRatioToSize?.(legacy.aspectRatio) : undefined,
                baseUrl: route.provider.transports.openAiImages.baseUrl,
                providerId: route.provider.id,
            });
        }
        throw new TypeError('Dispatch requires a schema-2 plan, connection, and signal.');
    }
    if (!connection || !signal) throw new TypeError('Dispatch requires plan, connection, and signal.');
    const registry = transportContext.transports || defaultRegistry;
    const adapter = typeof registry.get === 'function' ? registry.get(plan.resolved?.transportId) : registry[plan.resolved?.transportId];
    if (!adapter) throw new Error(`No transport adapter is registered for: ${plan.resolved?.transportId || 'unknown'}`);
    return adapter.generate({ plan, connection, signal, transportContext });
}

export { defaultRegistry as transportRegistry };

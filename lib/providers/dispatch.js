import { buildGeminiProxyRequest } from './gemini-proxy.js';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from './openai-images.js';
import { attachNormalizedProviderError } from './errors.js';
import { decodeGenerationArtifact } from './artifact-decoder.js';
import { getProviderDefinition, resolveAdapterId, validateProviderRoute } from './registry.js';
import { NATIVE_HOSTED_ADAPTERS } from './native-hosted.js';
import { connectionRevision, customModelRouteRevision, resolveCustomModelRoute, safeConnectionProjection, validateCustomConnection } from './custom-connections.js';

function validateRuntimeCustomConnection(connection) {
    if (!connection?.protocol) return null;
    return validateCustomConnection({
        schema: connection.schema,
        id: connection.id,
        label: connection.label,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        modelsPath: connection.modelsPath,
        ...(Object.hasOwn(connection, 'generationPath') ? { generationPath: connection.generationPath } : {}),
        ...(Object.hasOwn(connection, 'generationMethods') ? { generationMethods: connection.generationMethods } : {}),
        ...(Object.hasOwn(connection, 'catalogAuth') ? { catalogAuth: connection.catalogAuth } : {}),
        credentialRef: connection.credentialRef ?? null,
        enabled: connection.enabled,
    });
}

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

function requireRouteEvidence(plan, connection) {
    const evidence = plan?.resolved?.routeEvidence || plan?.resolved?.modelDefinition?.routeEvidence;
    const customValidation = validateRuntimeCustomConnection(connection);
    if (customValidation?.valid) {
        const revision = customModelRouteRevision(customValidation.connection, { id: plan?.resolved?.modelId, transportId: plan?.resolved?.transportId }) || connectionRevision(customValidation.connection);
        if (evidence?.revision !== revision) throw new Error('Custom route evidence does not match the current connection revision.');
        if (evidence?.state === 'verified') return;
        if (evidence?.state === 'configured') {
            const manualInvocation = ['settings', 'wand', 'slash', 'director'].includes(plan?.invocation);
            if (manualInvocation && plan?.policy?.source === 'manual' && plan?.policy?.routeConfirmationAccepted === true && connection?.confirmedRevision === revision) return;
            throw new Error('Configured route requires manual confirmation for the exact connection revision.');
        }
        throw new Error('Model route evidence is unverified; generation is unavailable until the route is verified.');
    }
    if (evidence?.state === 'verified') return;
    if (evidence?.state === 'configured') {
        const manualInvocation = !['automation', 'swipe'].includes(plan?.invocation);
        if (manualInvocation && plan?.policy?.source === 'manual' && plan?.policy?.routeConfirmationAccepted === true) return;
        throw new Error('Configured route requires an explicitly confirmed manual first request.');
    }
    throw new Error('Model route evidence is unverified; generation is unavailable until the route is verified.');
}

function imageEndpoint(baseUrl) {
    if (!baseUrl) return '';
    return /\/images\/generations\/?$/iu.test(baseUrl) ? baseUrl : `${String(baseUrl).replace(/\/$/u, '')}/images/generations`;
}

async function decodeRawProviderArtifact(input, options = {}) {
    if (input?.data && Array.isArray(input.data)) {
        const parsed = parseOpenAiImagesResponse(input);
        if (parsed.b64) return decodeGenerationArtifact({ b64_json: parsed.b64, mimeType: 'image/png' }, options);
        if (parsed.url) return decodeGenerationArtifact(parsed.url, options);
    }
    return decodeGenerationArtifact(input, options);
}

async function decodeWithTelemetry(input, options = {}) {
    options.telemetry?.record('decode', 'started');
    try {
        const result = await decodeRawProviderArtifact(input, options);
        options.telemetry?.record('decode', 'completed');
        return result;
    } catch (error) {
        options.telemetry?.record('decode', error?.name === 'AbortError' ? 'cancelled' : 'failed');
        throw error;
    }
}

async function requestSillyTavern(plan, connection, signal, context, requestBody) {
    if (typeof context.requestSillyTavernImage === 'function') {
        const result = await context.requestSillyTavernImage(requestBody, { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, signal });
        return result?.imageData ? { b64_json: result.imageData, mimeType: result.mimeType || 'image/png' } : result;
    }
    const fetchImpl = context.fetchImpl || fetch;
    context.telemetry?.record('host-post', 'started');
    const response = await fetchImpl(context.sillyTavernEndpoint || '/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: typeof context.getRequestHeaders === 'function' ? context.getRequestHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal,
    });
    context.telemetry?.record('host-post', 'response');
    if (!response.ok) {
        const responseText = await response.text();
        throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, status: response.status, responseText });
    }
    const json = await response.json();
    for (const part of json?.responseContent?.parts || []) {
        if (part?.inlineData?.data) return { inlineData: part.inlineData };
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
        const customProjection = connection?.protocol === 'openai-images' ? safeConnectionProjection(connection) : null;
        const url = customProjection && customProjection.valid !== false ? customProjection.routePreview.generation.url : imageEndpoint(baseUrl);
        if (!url) throw new TypeError('OpenAI Images endpoint is not configured.');
        const resolvedSecret = secretFor(connection, transportContext);
        if (customProjection && customProjection.valid !== false && connection.credentialRef !== null
            && (typeof resolvedSecret !== 'string' || !resolvedSecret.trim())) {
            throw new Error('Custom connection credential could not be resolved. No request was sent.');
        }
        const capabilities = plan.resolved?.capabilities || {};
        const sizesSupported = capabilityIsPositivelyEvidenced(capabilities.sizes);
        const size = sizesSupported && plan.options?.imageSize ? plan.options.imageSize : undefined;
        if (!customProjection && typeof transportContext.requestOpenAiImages === 'function') {
            return transportContext.requestOpenAiImages({
                apiKey: resolvedSecret,
                model: plan.resolved.modelId,
                prompt: generationPrompt(plan, transportContext),
                size,
                baseUrl,
                providerId: plan.resolved.providerId,
            }, { signal });
        }
        const headers = { 'Content-Type': 'application/json' };
        if (connection?.credentialRef !== null) headers.Authorization = `Bearer ${resolvedSecret}`;
        const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(buildOpenAiImagesRequest({ model: plan.resolved.modelId, prompt: generationPrompt(plan, transportContext), size, responseFormat: 'b64_json', capabilities })),
            signal,
            redirect: 'error',
        });
        if (response?.redirected) throw new Error('Custom generation redirects are not allowed.');
        if (!response.ok) {
            const responseText = await response.text();
            throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), { providerId: plan.resolved.providerId, modelId: plan.resolved.modelId, status: response.status, responseText });
        }
        const parsed = parseOpenAiImagesResponse(await response.json());
        if (parsed.b64) return { b64_json: parsed.b64, mimeType: 'image/png' };
        return parsed.url;
    },
};

export const DEFAULT_TRANSPORTS = Object.freeze({
    'host-chat-image': hostChatImage,
    'sillytavern-gemini-proxy': sillyTavernGeminiProxy,
    'openai-images': openAiImages,
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
        const transportId = resolveAdapterId(route?.transport);
        requireRouteEvidence({
            invocation: 'settings',
            policy: { source: 'manual' },
            resolved: { routeEvidence: route?.model?.routeEvidence },
        });
        if (transportId === 'openai-images' && typeof legacy.requestOpenAiImages === 'function') {
            const legacyPlan = {
                schema: 2,
                id: `legacy:${route.provider.id}:${legacy.modelId}`,
                idempotencyKey: `legacy:${route.provider.id}:${legacy.modelId}`,
                invocation: 'settings',
                target: null,
                resolved: { providerId: route.provider.id, modelId: legacy.modelId, transportId, endpoint: route.provider.transports.openAiImages.baseUrl, routeEvidence: route.model.routeEvidence, capabilities: route.model?.supportsSize ? { sizes: { state: 'supported', source: 'curated-fixture' } } : {} },
                prompt: { sourceMessage: legacy.prompt || '' },
                options: {
                    aspectRatio: route.model?.supportsSize ? legacy.aspectRatio : '',
                    imageSize: route.model?.supportsSize && typeof legacy.mapAspectRatioToSize === 'function'
                        ? legacy.mapAspectRatioToSize(legacy.aspectRatio)
                        : '',
                },
            };
            const rawArtifact = await openAiImages.generate({
                plan: legacyPlan,
                connection: { id: `${route.provider.id}:default`, providerId: route.provider.id, kind: 'browser-api-key', enabled: true },
                signal: new AbortController().signal,
                transportContext: { apiKey: legacy.apiKey, mapAspectRatioToSize: legacy.mapAspectRatioToSize, requestOpenAiImages: legacy.requestOpenAiImages },
            });
            return decodeRawProviderArtifact(rawArtifact);
        }
        throw new TypeError('Dispatch requires a schema-2 plan, connection, and signal.');
    }
    if (!connection || !signal) throw new TypeError('Dispatch requires plan, connection, and signal.');
    if (connection.providerId !== plan.resolved?.providerId) throw new Error('Connection provider does not match the resolved provider route.');
    if (connection.id !== plan.resolved?.connectionId) throw new Error('Connection id does not match the resolved connection route.');
    const customValidation = validateRuntimeCustomConnection(connection);
    const isCustomConnection = customValidation?.valid === true;
    let resolvedCustomCredential = '';
    if (connection?.protocol && !isCustomConnection) throw new TypeError('Custom connection configuration is invalid.');
    if (isCustomConnection) {
        if (!customValidation.connection.enabled) throw new Error('Custom connection is disabled.');
        const route = resolveCustomModelRoute(customValidation.connection, { id: plan.resolved?.modelId, transportId: plan.resolved?.transportId });
        if (!route || plan.resolved?.transportId !== route.transportId || plan.resolved?.endpointClass !== route.endpointClass || plan.resolved?.endpoint !== route.endpoint) {
            throw new Error('Custom connection route does not match the selected model method.');
        }
    }
    requireRouteEvidence(plan, connection);
    if (isCustomConnection) {
        resolvedCustomCredential = secretFor(connection, transportContext);
        if (customValidation.connection.credentialRef !== null && (typeof resolvedCustomCredential !== 'string' || !resolvedCustomCredential.trim())) {
            throw new Error('Custom connection credential could not be resolved. No request was sent.');
        }
    }
    const registry = isCustomConnection ? defaultRegistry : transportContext.transports || defaultRegistry;
    const declaredProvider = getProviderDefinition(plan.resolved?.providerId);
    if (!isCustomConnection && (declaredProvider || !transportContext.transports)) validateProviderRoute({
        providerId: plan.resolved?.providerId,
        modelId: plan.resolved?.modelId,
        transportId: plan.resolved?.transportId,
        endpoint: plan.resolved?.endpoint,
        modelDefinition: plan.resolved?.modelDefinition,
        adapterRegistry: registry,
    });
    const adapter = typeof registry.get === 'function' ? registry.get(plan.resolved?.transportId) : registry[plan.resolved?.transportId];
    if (!adapter) throw new Error(`No transport adapter is registered for: ${plan.resolved?.transportId || 'unknown'}`);
    const effectiveTransportContext = isCustomConnection
        ? {
            ...transportContext,
            apiKey: resolvedCustomCredential,
            resolveSecret: undefined,
            downloadLimits: { ...transportContext.downloadLimits, maxRedirects: 0 },
        }
        : transportContext;
    // Adapter output is always raw at this boundary. Decoding exactly once here
    // keeps built-in and injected adapters under the same validation contract.
    const rawArtifact = await adapter.generate({ plan, connection, signal, transportContext: effectiveTransportContext });
    return decodeWithTelemetry(rawArtifact, { signal, fetchImpl: effectiveTransportContext.fetchImpl, downloadLimits: effectiveTransportContext.downloadLimits, telemetry: effectiveTransportContext.telemetry });
}

export function promoteCustomConnectionEvidence({ connection, model, modelId, evidence, decodedResult, now = () => new Date().toISOString() } = {}) {
    const validation = validateCustomConnection(connection);
    if (!validation.valid) return evidence;
    const target = model || (modelId ? { id: modelId } : undefined);
    const revision = target ? customModelRouteRevision(validation.connection, target) : connectionRevision(validation.connection);
    if (evidence?.revision !== revision) return { state: 'configured', revision, observedAt: undefined };
    if (!decodedResult?.imageData || !/^image\//u.test(String(decodedResult.mimeType || ''))) return evidence;
    return { state: 'verified', revision, observedAt: now() };
}

export function promoteCustomModelEvidence({ connection, modelId, transportId, decodedResult, now = () => new Date().toISOString() } = {}) {
    const validation = validateCustomConnection(connection);
    const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
    if (!validation.valid || !normalizedModelId || normalizedModelId.length > 240 || /[\u0000-\u001f\u007f]/u.test(normalizedModelId)) return undefined;
    if (!decodedResult?.imageData || !/^image\//u.test(String(decodedResult.mimeType || ''))) return undefined;
    return {
        state: 'supported',
        revision: customModelRouteRevision(validation.connection, { id: normalizedModelId, transportId }) || connectionRevision(validation.connection),
        observedAt: now(),
    };
}

export { defaultRegistry as transportRegistry };

import { getNormalizedProviderDefinition, getProviderDefinition } from './registry.js';
import { normalizeModelDefinition, normalizeRouteEvidence } from './contracts.js';
import { normalizeModelId } from './model-manager.js';
import { normalizeProviderError } from './errors.js';
import { connectionRevision, safeConnectionProjection, validateCustomConnection } from './custom-connections.js';

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 2000;
const PROVIDER_LABELS = { makersuite: 'Google AI Studio', linkapi: 'LinkAPI', tokenreply: 'TokenReply', openrouter: 'OpenRouter' };

function buildDiscoveryUrl(baseUrl, endpoint = '') {
    if (!baseUrl) return endpoint;
    return `${String(baseUrl).replace(/\/$/, '')}${String(endpoint).startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function getSafeErrorMessage(errorText, status) {
    try {
        const json = JSON.parse(errorText);
        return json.error?.message || json.message || `HTTP ${status}`;
    } catch {
        return `HTTP ${status}`;
    }
}

function createAbortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw createAbortError();
}

function abortableDelay(delay, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (!signal) return;
        const onAbort = () => {
            clearTimeout(timer);
            reject(createAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

function isRetryableStatus(status) {
    return status === 429 || status >= 500 && status <= 599;
}

function isRetryableError(error) {
    if (error?.name === 'AbortError' || error?.status || error?.response?.status) return false;
    const code = String(error?.code || '').toUpperCase();
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_NETWORK'].includes(code)) return true;
    const message = String(error?.message || '').trim();
    if (/api[ _-]?key|authori[sz]|authentication|invalid\s+(?:model|parameter|request)|validation/iu.test(message)) return false;
    if (error?.name === 'TypeError') return /failed to fetch|fetch failed|network request failed|network error|load failed/iu.test(message);
    return /^(?:failed to fetch|fetch failed|network request failed|network error|load failed)$/iu.test(message);
}

function discoveryWarning(error, providerId, status, responseText) {
    const normalized = normalizeProviderError(error, { providerId, status, responseText });
    const provider = PROVIDER_LABELS[providerId] || providerId || 'Provider';
    const category = normalized.category === 'unknown' && isRetryableError(error) ? 'network' : normalized.category;
    switch (category) {
        case 'authentication':
            return { code: 'DISCOVERY_AUTH_FAILED', userMessage: `${provider} rejected the API key. Check it in extension settings.` };
        case 'rate_limit':
            return { code: 'DISCOVERY_RATE_LIMITED', userMessage: `${provider} is busy. Try again shortly.` };
        case 'network':
            return { code: 'DISCOVERY_NETWORK', userMessage: `Could not reach ${provider}. Check your connection and try again.` };
        case 'provider':
            return { code: 'DISCOVERY_PROVIDER_FAILED', userMessage: 'Provider model discovery failed. Try again or check provider settings.' };
        default:
            return { code: 'DISCOVERY_FAILED', userMessage: 'Model discovery failed.' };
    }
}

function staticDiscoveryWarning(code) {
    return code === 'DISCOVERY_MISCONFIGURED'
        ? { code, userMessage: 'Model discovery is not configured for this provider.' }
        : { code: 'DISCOVERY_UNSUPPORTED', userMessage: 'Model discovery is not available for this provider.' };
}

function catalogItems(json) {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.data)) return json.data;
    if (Array.isArray(json?.models)) return json.models;
    return [];
}

function normalizeCatalogId(item) {
    const id = normalizeModelId(item?.id || item?.model || item?.name || item?.slug);
    return id;
}

/**
 * @deprecated Pure compatibility parser for deterministic consumers only.
 * Live OpenAI-list discovery uses parseProviderCatalog so a catalog ID can
 * never acquire a generation route from this filter.
 */
export function parseOpenAiList(json, filter) {
    const seen = new Set();
    const entries = [];
    for (const item of Array.isArray(json?.data) ? json.data : []) {
        const id = normalizeModelId(item?.id);
        if (!id || seen.has(id)) continue;
        const outputModalities = [
            ...(Array.isArray(item?.output_modalities) ? item.output_modalities : []),
            ...(Array.isArray(item?.modalities) ? item.modalities : []),
            ...(Array.isArray(item?.architecture?.output_modalities) ? item.architecture.output_modalities : []),
        ].filter((value) => value != null).map((value) => String(value).toLowerCase());
        if (filter === 'image' && !/^(gpt-image|dall-e)/iu.test(id)) continue;
        if (filter === 'image-capable' && !outputModalities.includes('image')) continue;
        if (filter === 'tokenreply-image' && !/^grok-imagine-image/iu.test(id)) continue;
        seen.add(id);
        entries.push({ id, source: 'fetched' });
    }
    return entries;
}

function routeEvidenceIsVerified(routeEvidence) {
    return normalizeRouteEvidence(routeEvidence).state === 'verified';
}

function unresolvedCatalogModel(id, declaration = {}) {
    return {
        id,
        label: declaration.label || `${id} (Unverified)`,
        transportId: null,
        routeEvidence: { state: 'unverified' },
        modelNote: declaration.note || 'Unverified: no evidenced generation route is available for this model.',
        posture: 'experimental',
    };
}

/** Classify catalog records only through provider-declared route evidence. */
export function classifyDiscoveredModel(provider, item) {
    const id = normalizeCatalogId(item);
    if (!id || !provider || typeof provider !== 'object') return { classification: 'rejected', reason: 'missing-model-or-provider' };
    const injected = provider.authoritativeCatalogRoutes?.[id];
    if (injected) {
        const transportId = injected.transportId;
        const endpoint = injected.endpoint;
        if (typeof transportId === 'string' && endpoint === provider.transports?.[transportId]?.baseUrl && routeEvidenceIsVerified(injected.routeEvidence)) {
            return { classification: 'accepted', model: { id, label: injected.label || item?.label || item?.name || id, transportId, endpoint, routeEvidence: injected.routeEvidence, posture: 'experimental' } };
        }
        return { classification: 'rejected', reason: 'incomplete-authoritative-route' };
    }
    const declaration = provider.catalogModelRoutes?.[id];
    if (!declaration) return { classification: 'rejected', reason: 'no-declared-route' };
    if (declaration.classification === 'unresolved') return { classification: 'unresolved', model: unresolvedCatalogModel(id, declaration) };
    if (declaration.classification !== 'accepted') return { classification: 'rejected', reason: 'rejected-by-provider' };
    const model = (provider.models || []).find((candidate) => candidate?.id === (declaration.modelId || id));
    if (!model || !model.transport || !routeEvidenceIsVerified(model.routeEvidence)) return { classification: 'rejected', reason: 'declared-route-is-not-verified' };
    return { classification: 'accepted', model: { ...model, transportId: model.transportId || model.transport } };
}

/** Parse a provider catalog into route-safe records and sanitized counts. */
export function parseProviderCatalog(json, provider) {
    const seen = new Set();
    const accepted = [];
    const unresolved = [];
    const rejected = [];
    const items = catalogItems(json);
    for (const item of items) {
        const id = normalizeCatalogId(item);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const classified = classifyDiscoveredModel(provider, item);
        if (classified.classification === 'accepted') accepted.push(classified.model);
        else if (classified.classification === 'unresolved') unresolved.push(classified.model);
        else rejected.push({ id, reason: classified.reason || 'not-route-safe' });
    }
    return { accepted, unresolved, rejected, returnedCount: items.length };
}

/**
 * Parse Pollinations' public image catalog without asserting generation or
 * optional capability support from a model ID alone.
 */
export function parsePollinationsImageModels(json) {
    const seen = new Set();
    return catalogItems(json).map((item) => {
        const id = normalizeCatalogId(item);
        if (!id || seen.has(id)) return null;
        const declared = [
            item?.type,
            item?.modality,
            ...(Array.isArray(item?.modalities) ? item.modalities : []),
            ...(Array.isArray(item?.output_modalities) ? item.output_modalities : []),
        ].filter((value) => value != null).map((value) => String(value).toLowerCase());
        if (declared.includes('video') || (declared.length > 0 && !declared.includes('image'))) return null;
        seen.add(id);
        return {
            id,
            label: String(item?.name || item?.label || id),
            transport: 'openAiImages',
            capabilities: declared.includes('image')
                ? { imageGeneration: { state: 'supported', source: 'official-docs', confidence: 'high' } }
                : {},
        };
    }).filter(Boolean);
}

/**
 * Parse NanoGPT's detailed image-model catalog. Metadata is copied only when
 * the catalog explicitly declares it; the model ID itself is never treated as
 * proof that image generation works.
 */
export function parseNanoGptDetailedCatalog(json) {
    const seen = new Set();
    return catalogItems(json).map((item) => {
        const id = normalizeCatalogId(item);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        const architecture = item?.architecture && typeof item.architecture === 'object' ? item.architecture : {};
        const outputModalities = (architecture.output_modalities || architecture.outputModalities || item?.output_modalities || item?.outputModalities || []).map((value) => String(value).toLowerCase());
        const capabilities = {};
        if (outputModalities.includes('image')) {
            // The catalog's architecture output modality is positive evidence
            // for image generation. Input modalities, image_to_image, and
            // supported_parameters are intentionally not promoted: the shared
            // OpenAI adapter cannot safely send those fields yet.
            capabilities.imageGeneration = { state: 'supported', source: 'official-docs', confidence: 'high' };
        }
        return {
            id,
            label: String(item?.name || item?.display_name || item?.label || id),
            transport: 'openAiImages',
            capabilities,
        };
    }).filter(Boolean);
}

const BUILT_IN_NATIVE_PARSERS = Object.freeze({
    'pollinations-image-models': parsePollinationsImageModels,
    'nanogpt-image-models': parseNanoGptDetailedCatalog,
});

function resolveProvider(providerId, provider) {
    return provider || getProviderDefinition(providerId) || getNormalizedProviderDefinition(providerId);
}

function resolveDiscovery(provider) {
    if (provider?.discovery && typeof provider.discovery === 'object') return provider.discovery;
    const configured = provider?.ui?.modelDiscovery;
    if (configured && typeof configured === 'object') {
        const transports = Object.keys(provider?.transports || {});
        return {
            kind: configured.responseFormat === 'openai-list' ? 'openai-list' : 'native',
            endpoint: configured.endpoint,
            transportId: configured.transportId || transports.find((id) => /openai/i.test(id)) || transports[0],
            ...(configured.parserId ? { parserId: configured.parserId } : {}),
            retryable: true,
        };
    }
    if (provider?.ui && Object.hasOwn(provider.ui, 'modelDiscovery')) return { kind: 'curated-static' };
    return { kind: 'unsupported', reason: 'Model discovery is not configured for this provider.' };
}

function resolveBaseUrl(provider, discovery) {
    const transport = provider?.transports?.[discovery?.transportId];
    return transport?.baseUrl || provider?.transports?.openAiImages?.baseUrl;
}

function normalizeDiscoveredModels(entries, providerId, provider, observedAt, sourceLabel) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const id = normalizeModelId(typeof entry === 'string' ? entry : entry?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return normalizeModelDefinition({
            ...(typeof entry === 'object' ? entry : { id }),
            id,
            providerId,
            source: { kind: 'fetched', discoveredAt: observedAt, sourceLabel },
        }, provider || { id: providerId });
    }).filter(Boolean);
}

function normalizeStaticModels(providerId, provider, observedAt) {
    const models = provider?.builtInModels || provider?.models || [];
    return models.map((model) => normalizeModelDefinition({
        ...model,
        providerId,
        source: { kind: 'built-in', discoveredAt: model?.source?.discoveredAt || observedAt, sourceLabel: 'curated provider catalog' },
    }, provider || { id: providerId }));
}

async function requestDiscovery({ url, apiKey, fetchImpl, signal, sleep, retryable = true }) {
    let retryCount = 0;
    while (true) {
        throwIfAborted(signal);
        let response;
        try {
            response = await fetchImpl(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey || ''}` },
                signal,
            });
        } catch (error) {
            if (!retryable || !isRetryableError(error) || retryCount >= MAX_RETRIES) {
                error.retryCount = retryCount;
                throw error;
            }
            retryCount += 1;
            await sleep(Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** (retryCount - 1))), signal);
            continue;
        }

        if (response.ok) return { response, retryCount };
        const status = Number(response.status) || 0;
        if (!retryable || !isRetryableStatus(status) || retryCount >= MAX_RETRIES) {
            const errorText = await response.text();
            const error = new Error(`HTTP ${status}: ${getSafeErrorMessage(errorText, status)}`);
            error.status = status;
            error.retryCount = retryCount;
            error.responseText = errorText;
            throw error;
        }
        retryCount += 1;
        await sleep(Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** (retryCount - 1))), signal);
    }
}

export async function discoverProviderModels({
    providerId,
    provider: providerInput,
    apiKey,
    connection,
    fetchImpl = fetch,
    signal,
    now = () => new Date().toISOString(),
    sleep = abortableDelay,
    nativeParsers = BUILT_IN_NATIVE_PARSERS,
    parser,
} = {}) {
    const provider = resolveProvider(providerId, providerInput);
    const resolvedProviderId = providerId || provider?.id || 'unknown';
    const discovery = resolveDiscovery(provider);
    const observedAt = now();
    const evidence = {
        kind: discovery.kind,
        observedAt,
        source: discovery.kind === 'curated-static' ? 'curated provider catalog'
            : discovery.kind === 'unsupported' ? 'provider catalog'
                : 'provider /models endpoint',
        retryCount: 0,
        returnedCount: 0,
        acceptedCount: 0,
        unresolvedCount: 0,
        rejectedCount: 0,
    };

    if (discovery.kind === 'curated-static') {
        const models = normalizeStaticModels(resolvedProviderId, provider, observedAt);
        return { models, evidence: { ...evidence, returnedCount: models.length, acceptedCount: models.length } };
    }
    if (discovery.kind === 'unsupported') {
        return {
            models: [],
            evidence: { ...evidence, source: 'provider catalog' },
            warning: staticDiscoveryWarning('DISCOVERY_UNSUPPORTED'),
        };
    }

    const baseUrl = resolveBaseUrl(provider, discovery);
    if (!baseUrl || !discovery.endpoint) {
        return {
            models: [],
            evidence,
            warning: staticDiscoveryWarning('DISCOVERY_MISCONFIGURED'),
        };
    }

    try {
        const { response, retryCount } = await requestDiscovery({
            url: buildDiscoveryUrl(baseUrl, discovery.endpoint),
            apiKey,
            fetchImpl,
            signal,
            sleep,
            retryable: discovery.retryable !== false,
        });
        throwIfAborted(signal);
        const json = await response.json();
        let entries;
        let counts = {};
        if (discovery.kind === 'openai-list') {
            const catalog = parseProviderCatalog(json, provider);
            entries = [...catalog.accepted, ...catalog.unresolved];
            counts = {
                returnedCount: catalog.returnedCount,
                acceptedCount: catalog.accepted.length,
                unresolvedCount: catalog.unresolved.length,
                rejectedCount: catalog.rejected.length,
            };
        } else if (typeof parser === 'function') {
            entries = await parser(json, { providerId: resolvedProviderId, discovery, connection });
        } else if (typeof nativeParsers[discovery.parserId] === 'function') {
            entries = await nativeParsers[discovery.parserId](json, { providerId: resolvedProviderId, discovery, connection });
        } else {
            throw new Error(`No native model parser is registered for ${discovery.parserId || resolvedProviderId}.`);
        }
        return {
            models: normalizeDiscoveredModels(entries, resolvedProviderId, provider, observedAt, evidence.source),
            evidence: { ...evidence, ...counts, retryCount },
        };
    } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error?.name === 'AbortError' ? error : createAbortError();
        return {
            models: [],
            evidence: { ...evidence, retryCount: error?.retryCount || evidence.retryCount },
            warning: discoveryWarning(error, resolvedProviderId, error?.status, error?.responseText),
        };
    }
}

export async function fetchProviderModels(options = {}) {
    const result = await discoverProviderModels(options);
    if (result.warning) {
        const error = new Error(result.warning.userMessage);
        error.code = result.warning.code;
        throw error;
    }
    return result.models.map((model) => ({ id: model.id, source: 'fetched' }));
}

function safeSavedCustomModels(value, connection, existingEvidence) {
    const projection = safeConnectionProjection(connection);
    if (projection.valid === false) return [];
    const gemini = connection.protocol === 'gemini-compatible';
    const observedAt = typeof existingEvidence?.observedAt === 'string' && !Number.isNaN(Date.parse(existingEvidence.observedAt))
        ? new Date(existingEvidence.observedAt).toISOString() : '';
    const evidenceMatches = ['configured', 'verified'].includes(existingEvidence?.state)
        && existingEvidence?.revision === projection.revision && observedAt;
    const routeEvidence = evidenceMatches ? {
        state: existingEvidence.state,
        source: existingEvidence.state === 'verified' ? 'sanitized-probe' : 'user-configured-protocol',
        observedAt,
        protocol: connection.protocol,
        requestShapeRevision: gemini ? 'st-gemini-proxy-v1' : 'openai-images-v1',
        revision: projection.revision,
    } : { state: 'unverified' };
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map((entry) => {
        const id = normalizeModelId(entry?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
            id,
            label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 240) : id,
            providerId: connection.id,
            connectionId: connection.id,
            transportId: gemini ? 'sillytavern-gemini-proxy' : 'openai-images',
            endpointClass: gemini ? 'custom-gemini-proxy' : 'custom-openai-images',
            endpoint: gemini ? projection.routePreview.generation.upstreamProxyRoot : projection.routePreview.generation.url,
            source: { kind: entry?.source?.kind === 'manual' ? 'manual' : 'fetched' },
            capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' } },
            routeEvidence,
            posture: 'experimental',
        };
    }).filter(Boolean);
}

function customDiscoveryWarning(code) {
    const messages = {
        DISCOVERY_EMPTY: 'The custom connection returned no models. Your saved models were kept.',
        DISCOVERY_REDIRECTED: 'The custom connection redirected its model catalog request. Redirects are not allowed.',
        DISCOVERY_AUTH_FAILED: 'The custom connection rejected the credential. Check the masked key in extension settings.',
        DISCOVERY_MISCONFIGURED: 'The custom connection configuration is invalid. No request was sent.',
        DISCOVERY_BROWSER_BLOCKED: 'The browser blocked or could not reach this custom connection. Check its CORS headers and private-network access permissions, then try again.',
        DISCOVERY_PROVIDER_FAILED: 'The custom connection model request failed. Your saved models were kept.',
    };
    return { code, userMessage: messages[code] || messages.DISCOVERY_PROVIDER_FAILED };
}

/** Fetch an OpenAI-style catalog for one validated custom connection. */
export async function discoverCustomConnectionModels({
    connection: input,
    authPreset,
    credential,
    existingEvidence,
    savedModels = [],
    fetchImpl = fetch,
    signal,
    now = () => new Date().toISOString(),
} = {}) {
    const validation = validateCustomConnection(input);
    const connectionId = typeof input?.id === 'string' ? input.id : '';
    if (!validation.valid) return { models: [], evidence: { kind: 'openai-list', source: 'custom connection /models endpoint', retryCount: 0, returnedCount: 0, acceptedCount: 0, unresolvedCount: 0, rejectedCount: 0 }, warning: customDiscoveryWarning('DISCOVERY_MISCONFIGURED') };
    const connection = validation.connection;
    const saved = safeSavedCustomModels(savedModels, connection, existingEvidence);
    const requiredPreset = connection.credentialRef ? (connection.protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer') : 'none';
    if (!['bearer', 'gemini-api-key', 'none'].includes(authPreset) || authPreset !== requiredPreset || (authPreset !== 'none' && (typeof credential !== 'string' || !credential))) {
        return { models: saved, evidence: { kind: 'openai-list', source: 'custom connection /models endpoint', retryCount: 0, returnedCount: 0, acceptedCount: 0, unresolvedCount: 0, rejectedCount: 0, connectionId: connection.id, revision: connectionRevision(connection) }, warning: customDiscoveryWarning('DISCOVERY_MISCONFIGURED') };
    }
    const projection = safeConnectionProjection(connection);
    const revision = projection.revision;
    const observedAt = now();
    const evidence = {
        kind: 'openai-list',
        source: 'custom connection /models endpoint',
        observedAt,
        retryCount: 0,
        returnedCount: 0,
        acceptedCount: 0,
        unresolvedCount: 0,
        rejectedCount: 0,
        connectionId: connection.id,
        revision,
    };
    try {
        const headers = { Accept: 'application/json' };
        if (authPreset === 'bearer') headers.Authorization = `Bearer ${credential}`;
        if (authPreset === 'gemini-api-key') headers['x-goog-api-key'] = credential;
        const response = await fetchImpl(projection.routePreview.catalog.url, { method: 'GET', headers, redirect: 'error', signal });
        if (response?.redirected) return { models: saved, evidence, warning: customDiscoveryWarning('DISCOVERY_REDIRECTED') };
        if (!response?.ok) {
            const code = Number(response?.status) === 401 || Number(response?.status) === 403 ? 'DISCOVERY_AUTH_FAILED' : 'DISCOVERY_PROVIDER_FAILED';
            return { models: saved, evidence, warning: customDiscoveryWarning(code) };
        }
        const json = await response.json();
        const items = catalogItems(json);
        const seen = new Set();
        const retainsVerifiedRoute = existingEvidence?.state === 'verified'
            && existingEvidence?.revision === revision
            && typeof existingEvidence?.observedAt === 'string'
            && !Number.isNaN(Date.parse(existingEvidence.observedAt));
        const routeObservedAt = retainsVerifiedRoute ? new Date(existingEvidence.observedAt).toISOString() : observedAt;
        const routeEvidence = {
            state: retainsVerifiedRoute ? 'verified' : 'configured',
            source: retainsVerifiedRoute ? 'sanitized-probe' : 'user-configured-protocol',
            observedAt: routeObservedAt,
            protocol: connection.protocol,
            requestShapeRevision: connection.protocol === 'gemini-compatible' ? 'st-gemini-proxy-v1' : 'openai-images-v1',
            revision,
        };
        const models = items.map((item) => {
            const id = normalizeCatalogId(item);
            if (!id || seen.has(id)) return null;
            seen.add(id);
            return {
                id,
                label: id,
                providerId: connection.id,
                connectionId: connection.id,
                transportId: connection.protocol === 'gemini-compatible' ? 'sillytavern-gemini-proxy' : 'openai-images',
                endpointClass: connection.protocol === 'gemini-compatible' ? 'custom-gemini-proxy' : 'custom-openai-images',
                endpoint: connection.protocol === 'gemini-compatible' ? projection.routePreview.generation.upstreamProxyRoot : projection.routePreview.generation.url,
                source: { kind: 'fetched', discoveredAt: observedAt, sourceLabel: 'custom connection /models endpoint' },
                capabilities: {
                    imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' },
                },
                routeEvidence,
                posture: 'experimental',
            };
        }).filter(Boolean);
        const nextEvidence = { ...evidence, returnedCount: items.length, acceptedCount: models.length, rejectedCount: Math.max(0, items.length - models.length) };
        if (!models.length) return { models: saved, evidence: nextEvidence, warning: customDiscoveryWarning('DISCOVERY_EMPTY') };
        return { models, evidence: nextEvidence };
    } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error?.name === 'AbortError' ? error : createAbortError();
        const browserBlocked = error instanceof TypeError || error?.name === 'TypeError' || error?.name === 'SecurityError';
        return { models: saved, evidence, warning: customDiscoveryWarning(browserBlocked ? 'DISCOVERY_BROWSER_BLOCKED' : 'DISCOVERY_PROVIDER_FAILED') };
    }
}

export function createModelDiscoveryCoordinator() {
    const active = new Map();
    return {
        refresh(providerId, options = {}) {
            const previous = active.get(providerId);
            if (previous) {
                active.delete(providerId);
                previous.controller.abort();
            }
            const controller = new AbortController();
            const promise = discoverProviderModels({ ...options, providerId, signal: controller.signal })
                .then((result) => controller.signal.aborted ? { ...result, stale: true } : result)
                .catch((error) => controller.signal.aborted || error?.name === 'AbortError'
                    ? { models: [], evidence: { kind: 'unsupported', observedAt: new Date().toISOString(), source: 'cancelled', retryCount: 0 }, stale: true }
                    : Promise.reject(error))
                .finally(() => {
                    if (active.get(providerId)?.promise === promise) active.delete(providerId);
                });
            active.set(providerId, { controller, promise });
            return promise;
        },
        cancel(providerId) {
            const operation = active.get(providerId);
            if (!operation) return false;
            active.delete(providerId);
            operation.controller.abort();
            return true;
        },
        isActive(providerId) {
            return active.has(providerId);
        },
    };
}

export { buildDiscoveryUrl };

const CAPABILITY_STATES = new Set(['supported', 'unsupported', 'unknown']);
const EVIDENCE_SOURCES = new Set(['official-docs', 'curated-fixture', 'live-sanitized', 'manual-user', 'heuristic']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const POSTURES = new Set(['supported', 'experimental', 'future-server']);
const CONNECTION_KINDS = new Set(['browser-api-key', 'sillytavern-proxy', 'server-adapter']);

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

export function normalizeCapabilityEvidence(value = {}) {
    const source = EVIDENCE_SOURCES.has(value?.source) ? value.source : 'heuristic';
    const requestedState = CAPABILITY_STATES.has(value?.state) ? value.state : 'unknown';
    const observedAt = typeof value?.observedAt === 'string' && !Number.isNaN(Date.parse(value.observedAt)) ? value.observedAt : undefined;
    // Manual claims and heuristics are useful for search only; they never enable a request option.
    // Live observations are route-specific and must be dated before they can enable anything.
    const state = source === 'heuristic' || source === 'manual-user' || (source === 'live-sanitized' && !observedAt)
        ? 'unknown'
        : requestedState;
    const result = {
        state,
        source,
        confidence: CONFIDENCES.has(value?.confidence) ? value.confidence : 'low',
    };
    if (observedAt) result.observedAt = observedAt;
    if (typeof value?.note === 'string' && value.note.trim()) result.note = value.note.trim().slice(0, 240);
    return result;
}

export function capabilityIsSupported(capability) {
    if (!capability || capability.state !== 'supported' || !['official-docs', 'curated-fixture', 'live-sanitized'].includes(capability.source)) return false;
    return capability.source !== 'live-sanitized' || (typeof capability.observedAt === 'string' && !Number.isNaN(Date.parse(capability.observedAt)));
}

function legacyCapability(value, { positiveSource = 'curated-fixture', allowLegacyCurated = false } = {}) {
    if (allowLegacyCurated && value && typeof value === 'object' && Number.isInteger(value.maxCount) && value.maxCount > 0) return normalizeCapabilityEvidence({ state: 'supported', source: positiveSource, confidence: 'high' });
    if (value && typeof value === 'object' && (value.state || value.source || value.confidence)) return normalizeCapabilityEvidence(value);
    if (allowLegacyCurated && value === true) return normalizeCapabilityEvidence({ state: 'supported', source: positiveSource, confidence: 'high' });
    if (allowLegacyCurated && value === false) return normalizeCapabilityEvidence({ state: 'unsupported', source: positiveSource, confidence: 'high' });
    return normalizeCapabilityEvidence();
}

export function unknownCapabilities() {
    return {
        imageGeneration: normalizeCapabilityEvidence(),
        referenceImages: normalizeCapabilityEvidence(),
        editing: normalizeCapabilityEvidence(),
        multipleOutputs: normalizeCapabilityEvidence(),
        aspectRatios: normalizeCapabilityEvidence(),
        sizes: normalizeCapabilityEvidence(),
    };
}

export function normalizeModelCapabilities(value = {}, legacy = {}, { allowLegacyCurated = false } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {
        ...unknownCapabilities(),
        imageGeneration: legacyCapability(source.imageGeneration ?? legacy.imageGeneration, { allowLegacyCurated }),
        referenceImages: legacyCapability(source.referenceImages ?? legacy.referenceImages ?? legacy.supportsReferenceImages, { allowLegacyCurated }),
        editing: legacyCapability(source.editing ?? legacy.supportsEditing, { allowLegacyCurated }),
        multipleOutputs: legacyCapability(source.multipleOutputs ?? legacy.supportsMultipleOutputs, { allowLegacyCurated }),
        aspectRatios: legacyCapability(source.aspectRatios ?? legacy.supportsAspectRatios, { allowLegacyCurated }),
        sizes: legacyCapability(source.sizes ?? legacy.supportsSize, { allowLegacyCurated }),
    };
    const maxReferenceImages = source.maxReferenceImages ?? source.referenceImages?.maxCount ?? legacy.referenceImages?.maxCount;
    if (capabilityIsSupported(result.referenceImages) && Number.isInteger(maxReferenceImages) && maxReferenceImages > 0) result.maxReferenceImages = maxReferenceImages;
    const allowedSizes = source.allowedSizes ?? legacy.allowedSizes ?? legacy.imageSizeOptions?.map((item) => typeof item === 'string' ? item : item?.value);
    if (capabilityIsSupported(result.sizes) && Array.isArray(allowedSizes) && allowedSizes.length) result.allowedSizes = allowedSizes.filter((item) => typeof item === 'string' && item);
    const allowedAspectRatios = source.allowedAspectRatios ?? legacy.allowedAspectRatios;
    if (capabilityIsSupported(result.aspectRatios) && Array.isArray(allowedAspectRatios) && allowedAspectRatios.length) result.allowedAspectRatios = allowedAspectRatios.filter((item) => typeof item === 'string' && item);
    // Keep the predecessor shape available to reference selection during migration.
    result.referenceImages = { ...result.referenceImages };
    if (result.maxReferenceImages !== undefined) result.referenceImages.maxCount = result.maxReferenceImages;
    return result;
}

function normalizePosture(value, fallback = 'experimental') {
    if (POSTURES.has(value)) return value;
    if (value === 'verified') return 'supported';
    if (value === 'existing') return fallback;
    return fallback;
}

export function normalizeModelDefinition(input = {}, provider = {}) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) throw new TypeError('ModelDefinition requires an id');
    const providerId = String(input.providerId || provider.id || '');
    if (!providerId) throw new TypeError(`ModelDefinition ${id} requires a providerId`);
    const transportId = input.transportId || input.transport || (provider.transportIds || Object.keys(provider.transports || {})).at(0) || null;
    const availableTransports = provider.transportIds || Object.keys(provider.transports || {});
    if (transportId && availableTransports.length && !availableTransports.includes(transportId)) throw new TypeError(`ModelDefinition ${id} has an unknown transport`);
    const sourceKind = input.source?.kind || (input.source === 'fetched' || input.source === 'manual' ? input.source : 'built-in');
    const source = { kind: ['built-in', 'fetched', 'manual'].includes(sourceKind) ? sourceKind : 'manual' };
    if (typeof (input.source?.discoveredAt || input.discoveredAt) === 'string') source.discoveredAt = input.source?.discoveredAt || input.discoveredAt;
    if (typeof (input.source?.sourceLabel || input.sourceLabel) === 'string') source.sourceLabel = input.source?.sourceLabel || input.sourceLabel;
    const isBuiltIn = sourceKind === 'built-in';
    const model = {
        id,
        label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : id,
        providerId,
        transportId,
        capabilities: normalizeModelCapabilities(input.capabilities, {
            ...input,
            imageGeneration: isBuiltIn ? true : input.imageGeneration,
            supportsSize: isBuiltIn && Array.isArray(input.imageSizeOptions) && input.imageSizeOptions.length ? true : input.supportsSize,
        }, { allowLegacyCurated: isBuiltIn }),
        source,
        posture: normalizePosture(input.posture || input.status, 'experimental'),
    };
    if (input.variant) model.variant = input.variant;
    if (input.modelNote) model.modelNote = String(input.modelNote);
    return model;
}

function discoveryFromProvider(input, transportIds) {
    if (input.discovery && typeof input.discovery === 'object') {
        const discovery = {};
        for (const key of ['kind', 'endpoint', 'transportId', 'filterId', 'parserId', 'reason']) {
            if (typeof input.discovery[key] === 'string') discovery[key] = input.discovery[key];
        }
        if (input.discovery.retryable === true) discovery.retryable = true;
        return discovery;
    }
    const configured = input.ui?.modelDiscovery;
    if (configured && typeof configured === 'object') {
        return {
            kind: configured.responseFormat === 'openai-list' ? 'openai-list' : 'native',
            endpoint: configured.endpoint,
            transportId: configured.transportId || transportIds.find((id) => /openai/i.test(id)) || transportIds[0],
            ...(configured.filter ? { filterId: configured.filter } : {}),
            ...(configured.responseFormat === 'openai-list' ? { retryable: true } : { parserId: configured.parserId || 'default', retryable: true }),
        };
    }
    if (input.ui && Object.hasOwn(input.ui, 'modelDiscovery')) return { kind: 'curated-static' };
    return { kind: 'unsupported', reason: 'Model discovery is not configured for this provider.' };
}

const SECRET_FIELD = /(?:api.?key|token|secret|password|authorization|headers?|credential)/i;

function sanitizeNested(value, depth = 0) {
    if (depth > 4 || value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeNested(item, depth + 1));
    if (typeof value !== 'object') return undefined;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_FIELD.test(key)) continue;
        const sanitized = sanitizeNested(item, depth + 1);
        if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
}

function normalizeProviderUi(input = {}) {
    const ui = {};
    for (const key of ['requiresApiKey', 'apiKeyLabel', 'showsLegacyRecovery', 'adapterRequired', 'providerInfo']) {
        if (typeof input[key] === 'boolean' || typeof input[key] === 'string') ui[key] = input[key];
    }
    if (input.modelDiscovery === false) ui.modelDiscovery = false;
    else if (input.modelDiscovery && typeof input.modelDiscovery === 'object') ui.modelDiscovery = sanitizeNested(input.modelDiscovery);
    return ui;
}

export function normalizeProviderDefinition(input = {}) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new TypeError('ProviderDefinition requires a stable slug id');
    const transports = {};
    for (const [transportId, transport] of Object.entries(input.transports && typeof input.transports === 'object' ? input.transports : {})) {
        if (!/^[a-zA-Z0-9._-]+$/.test(transportId) || !transport || typeof transport !== 'object') continue;
        transports[transportId] = sanitizeNested(transport);
    }
    const transportIds = Array.isArray(input.transportIds) ? [...new Set(input.transportIds.filter((item) => typeof item === 'string' && item))] : Object.keys(transports);
    const connectionKinds = Array.isArray(input.connectionKinds) && input.connectionKinds.length
        ? [...new Set(input.connectionKinds.filter((item) => CONNECTION_KINDS.has(item)))]
        : [input.credentialKey ? 'browser-api-key' : 'sillytavern-proxy'];
    const builtInModels = (input.builtInModels || input.models || []).map((model) => normalizeModelDefinition({ ...model, providerId: id }, { id, transportIds }));
    return {
        id,
        label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : id,
        posture: normalizePosture(input.posture || input.status, 'experimental'),
        ...(typeof input.status === 'string' ? { status: input.status } : {}),
        ...(typeof input.credentialKey === 'string' ? { credentialKey: input.credentialKey } : {}),
        connectionKinds,
        transportIds,
        builtInModels,
        discovery: discoveryFromProvider(input, transportIds),
        ui: normalizeProviderUi(input.ui || {}),
        transports,
        ...(input.provenance && typeof input.provenance === 'object' ? {
            provenance: Object.fromEntries(['legacyRoute', 'sourceLicense', 'reviewedRevision'].filter((key) => typeof input.provenance[key] === 'string').map((key) => [key, input.provenance[key]])),
        } : {}),
    };
}

export function normalizeProviderConnection(input = {}, provider = {}) {
    const providerId = String(input.providerId || provider.id || '');
    if (!providerId) throw new TypeError('ProviderConnection requires a providerId');
    const allowedKinds = provider.connectionKinds || [...CONNECTION_KINDS];
    const kind = allowedKinds.includes(input.kind) ? input.kind : allowedKinds[0] || 'sillytavern-proxy';
    const connection = {
        id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `${providerId}:default`,
        providerId,
        kind,
        enabled: input.enabled !== false,
    };
    if (typeof input.secretRef === 'string' && input.secretRef.trim()) connection.secretRef = input.secretRef.trim();
    if (typeof input.routeId === 'string' && input.routeId.trim()) {
        const availableRoutes = provider.transportIds || Object.keys(provider.transports || {});
        if (!availableRoutes.length || availableRoutes.includes(input.routeId.trim())) connection.routeId = input.routeId.trim();
    }
    if (typeof input.lastValidatedAt === 'string' && !Number.isNaN(Date.parse(input.lastValidatedAt))) connection.lastValidatedAt = input.lastValidatedAt;
    return connection;
}

export { CAPABILITY_STATES, EVIDENCE_SOURCES, POSTURES, CONNECTION_KINDS };

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
    // Heuristics are useful for search only; they never enable a request option.
    const state = source === 'heuristic' ? 'unknown' : requestedState;
    const result = {
        state,
        source,
        confidence: CONFIDENCES.has(value?.confidence) ? value.confidence : 'low',
    };
    if (typeof value?.observedAt === 'string' && !Number.isNaN(Date.parse(value.observedAt))) result.observedAt = value.observedAt;
    if (typeof value?.note === 'string' && value.note.trim()) result.note = value.note.trim().slice(0, 240);
    return result;
}

export function capabilityIsSupported(capability) {
    return capability?.state === 'supported' && capability?.source !== 'heuristic';
}

function legacyCapability(value, { positiveSource = 'curated-fixture' } = {}) {
    if (value && typeof value === 'object' && Number.isInteger(value.maxCount) && value.maxCount > 0) return normalizeCapabilityEvidence({ state: 'supported', source: positiveSource, confidence: 'high' });
    if (value && typeof value === 'object' && (value.state || value.source || value.confidence)) return normalizeCapabilityEvidence(value);
    if (value === true) return normalizeCapabilityEvidence({ state: 'supported', source: positiveSource, confidence: 'high' });
    if (value === false) return normalizeCapabilityEvidence({ state: 'unsupported', source: positiveSource, confidence: 'high' });
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

export function normalizeModelCapabilities(value = {}, legacy = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {
        ...unknownCapabilities(),
        imageGeneration: legacyCapability(source.imageGeneration ?? legacy.imageGeneration),
        referenceImages: legacyCapability(source.referenceImages ?? legacy.supportsReferenceImages),
        editing: legacyCapability(source.editing ?? legacy.supportsEditing),
        multipleOutputs: legacyCapability(source.multipleOutputs ?? legacy.supportsMultipleOutputs),
        aspectRatios: legacyCapability(source.aspectRatios ?? legacy.supportsAspectRatios),
        sizes: legacyCapability(source.sizes ?? legacy.supportsSize),
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
    const transportId = input.transportId || input.transport || (provider.transportIds || []).at(0) || null;
    const sourceKind = input.source?.kind || (input.source === 'fetched' || input.source === 'manual' ? input.source : 'built-in');
    const source = { kind: ['built-in', 'fetched', 'manual'].includes(sourceKind) ? sourceKind : 'manual' };
    if (typeof (input.source?.discoveredAt || input.discoveredAt) === 'string') source.discoveredAt = input.source?.discoveredAt || input.discoveredAt;
    if (typeof (input.source?.sourceLabel || input.sourceLabel) === 'string') source.sourceLabel = input.source?.sourceLabel || input.sourceLabel;
    const model = {
        id,
        label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : id,
        providerId,
        transportId,
        capabilities: normalizeModelCapabilities(input.capabilities, {
            ...input,
            imageGeneration: sourceKind === 'built-in' ? true : input.imageGeneration,
        }),
        source,
        posture: normalizePosture(input.posture || input.status, 'experimental'),
    };
    if (input.variant) model.variant = input.variant;
    if (input.modelNote) model.modelNote = String(input.modelNote);
    return model;
}

function discoveryFromProvider(input, transportIds) {
    if (input.discovery && typeof input.discovery === 'object') return clone(input.discovery);
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

export function normalizeProviderDefinition(input = {}) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new TypeError('ProviderDefinition requires a stable slug id');
    const transports = input.transports && typeof input.transports === 'object' ? clone(input.transports) : {};
    const transportIds = Array.isArray(input.transportIds) ? [...new Set(input.transportIds.filter((item) => typeof item === 'string' && item))] : Object.keys(transports);
    const connectionKinds = Array.isArray(input.connectionKinds) && input.connectionKinds.length
        ? [...new Set(input.connectionKinds.filter((item) => CONNECTION_KINDS.has(item)))]
        : [input.credentialKey ? 'browser-api-key' : 'sillytavern-proxy'];
    const builtInModels = (input.builtInModels || input.models || []).map((model) => normalizeModelDefinition({ ...model, providerId: id }, { id, transportIds }));
    const safeInput = clone(input);
    for (const field of ['apiKey', 'key', 'secret', 'credential', 'credentialValue']) delete safeInput[field];
    return {
        ...safeInput,
        id,
        label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : id,
        posture: normalizePosture(input.posture || input.status, 'experimental'),
        connectionKinds,
        transportIds,
        builtInModels,
        discovery: discoveryFromProvider(input, transportIds),
        ui: clone(input.ui || {}),
        transports,
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
    if (typeof input.routeId === 'string' && input.routeId.trim()) connection.routeId = input.routeId.trim();
    if (typeof input.lastValidatedAt === 'string' && !Number.isNaN(Date.parse(input.lastValidatedAt))) connection.lastValidatedAt = input.lastValidatedAt;
    return connection;
}

export { CAPABILITY_STATES, EVIDENCE_SOURCES, POSTURES, CONNECTION_KINDS };

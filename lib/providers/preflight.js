const SAFE_CAPABILITY_FIELDS = ['imageGeneration', 'referenceImages', 'editing', 'multipleOutputs', 'responseFormat', 'aspectRatios', 'sizes'];

// Settings written before adapter IDs were normalized used registry transport
// names. Keep those persisted approvals valid while always writing one stable
// route tuple for future approvals.
const EXPERIMENTAL_TRANSPORT_ALIASES = Object.freeze({
    openAiImages: 'openai-images',
    'openai-images': 'openai-images',
    sillyTavernGeminiProxy: 'sillytavern-gemini-proxy',
    'sillytavern-gemini-proxy': 'sillytavern-gemini-proxy',
    'host-chat-image': 'host-chat-image',
    'zai-native': 'zai-native',
    'arliai-native': 'arliai-native',
});

function canonicalExperimentalTransportId(transportId) {
    return Object.hasOwn(EXPERIMENTAL_TRANSPORT_ALIASES, transportId)
        ? EXPERIMENTAL_TRANSPORT_ALIASES[transportId]
        : transportId;
}

function compatibleExperimentalTransportIds(transportId) {
    const canonicalTransportId = canonicalExperimentalTransportId(transportId);
    const compatible = new Set([transportId, canonicalTransportId]);
    for (const [alias, canonical] of Object.entries(EXPERIMENTAL_TRANSPORT_ALIASES)) {
        if (canonical === canonicalTransportId) compatible.add(alias);
    }
    return [...compatible].filter((candidate) => typeof candidate === 'string' && candidate);
}

export function experimentalModelPreflightKey({ providerId, modelId, transportId } = {}) {
    if (![providerId, modelId, transportId].every((value) => typeof value === 'string' && value.trim())) return '';
    return JSON.stringify([providerId, modelId, canonicalExperimentalTransportId(transportId)]);
}

export function hasExperimentalModelPreflightConsent(consents, route) {
    const key = experimentalModelPreflightKey(route);
    if (!key || !consents || typeof consents !== 'object' || Array.isArray(consents)) return false;
    const { providerId, modelId, transportId } = route || {};
    return compatibleExperimentalTransportIds(transportId)
        .some((candidate) => consents[JSON.stringify([providerId, modelId, candidate])] === true);
}

/** Remove every persisted spelling of one exact experimental provider route. */
export function clearExperimentalModelPreflightConsent(consents, route) {
    const key = experimentalModelPreflightKey(route);
    if (!key || !consents || typeof consents !== 'object' || Array.isArray(consents)) return;
    const { providerId, modelId, transportId } = route;
    for (const candidate of compatibleExperimentalTransportIds(transportId)) {
        delete consents[JSON.stringify([providerId, modelId, candidate])];
    }
}

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function safeCapability(capability) {
    if (!capability || typeof capability !== 'object') return { state: 'unknown' };
    return {
        state: ['supported', 'unsupported', 'unknown'].includes(capability.state) ? capability.state : 'unknown',
        ...(typeof capability.source === 'string' ? { source: capability.source } : {}),
        ...(typeof capability.confidence === 'string' ? { confidence: capability.confidence } : {}),
    };
}

/**
 * Return the Advanced-only, safe summary of an immutable GenerationPlan.
 * Content, target identifiers, endpoint URLs, headers, credentials and asset bytes
 * are intentionally never copied into this projection.
 */
export function inspectGenerationPlan(plan) {
    if (!plan || typeof plan !== 'object') throw new TypeError('GenerationPlan is required.');
    const resolved = plan.resolved || plan.route || {};
    const prompt = plan.prompt || {};
    const references = Array.isArray(plan.references) ? plan.references : [];
    const roles = [...new Set(references.map((reference) => typeof reference?.role === 'string' ? reference.role : 'reference').slice(0, 32))].sort();
    const capabilities = plan.provider?.capabilities || resolved.capabilities || {};
    const output = {
        schema: Number.isInteger(plan.schema) ? plan.schema : undefined,
        invocation: typeof plan.invocation === 'string' ? plan.invocation : undefined,
        route: {
            ...(typeof resolved.providerId === 'string' ? { providerId: resolved.providerId } : {}),
            ...(typeof resolved.modelId === 'string' ? { modelId: resolved.modelId } : {}),
            ...(typeof resolved.transportId === 'string' ? { transportId: resolved.transportId } : {}),
            ...(typeof resolved.connectionId === 'string' ? { connectionId: resolved.connectionId } : {}),
        },
        prompt: {
            hasSourceMessage: typeof prompt.sourceMessage === 'string' && prompt.sourceMessage.length > 0,
            hasFocusText: typeof prompt.focusText === 'string' && prompt.focusText.length > 0,
            nearbyMessageCount: Array.isArray(prompt.nearbyMessages) ? Math.min(prompt.nearbyMessages.length, 32) : 0,
            intent: typeof prompt.intent === 'string' ? prompt.intent : 'scene',
        },
        references: { count: Math.min(references.length, 32), roles },
        identities: { count: Array.isArray(plan.identities) ? Math.min(plan.identities.length, 32) : 0 },
        options: {
            ...(typeof plan.options?.aspectRatio === 'string' && plan.options.aspectRatio ? { aspectRatio: plan.options.aspectRatio } : {}),
            ...(typeof plan.options?.imageSize === 'string' && plan.options.imageSize ? { imageSize: plan.options.imageSize } : {}),
            ...(typeof plan.options?.thinkingLevel === 'string' && plan.options.thinkingLevel ? { thinkingLevel: plan.options.thinkingLevel } : {}),
            ...(plan.options?.useGoogleSearch === true ? { useGoogleSearch: true } : {}),
        },
        capabilities: Object.fromEntries(SAFE_CAPABILITY_FIELDS
            .filter((field) => capabilities[field] !== undefined)
            .map((field) => [field, safeCapability(capabilities[field])])),
        policy: {
            source: plan.policy?.source === 'automation' ? 'automation' : 'manual',
            preflightAccepted: plan.policy?.preflightAccepted === true,
        },
    };
    return freeze(output);
}

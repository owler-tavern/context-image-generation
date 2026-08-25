import { selectReferenceCandidates } from './rp/references.js';
import { buildAppearanceReferenceCandidates } from './rp/appearance-library.js';
import { normalizeModelCapabilities } from './providers/contracts.js';

const INVOCATIONS = new Set(['wand', 'settings', 'slash', 'swipe', 'automation']);
const INTENTS = new Set(['scene', 'portrait', 'establishing']);

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function copyProvider(provider = {}) {
    const legacyCuratedReferenceCap = Number.isInteger(provider.capabilities?.referenceImages?.maxCount);
    const capabilities = normalizeModelCapabilities(provider.capabilities || {}, provider, { allowLegacyCurated: legacyCuratedReferenceCap });
    return {
        providerId: String(provider.providerId || ''),
        modelId: String(provider.modelId || ''),
        transport: provider.transport || null,
        capabilities,
    };
}

export function createGenerationPlan(input = {}) {
    if (!input.id) throw new TypeError('GenerationPlan requires an id');
    if (!INVOCATIONS.has(input.invocation)) throw new TypeError(`Unsupported GenerationPlan invocation: ${input.invocation}`);
    const resolvedInput = input.resolved || input.provider || {};
    const provider = copyProvider({
        ...input.provider,
        providerId: resolvedInput.providerId || input.provider?.providerId,
        modelId: resolvedInput.modelId || input.provider?.modelId,
        transport: resolvedInput.transportId || resolvedInput.transport || input.provider?.transport,
        capabilities: resolvedInput.capabilities || input.provider?.capabilities,
    });
    const resolved = {
        connectionId: String(resolvedInput.connectionId || input.connectionId || `${provider.providerId}:default`),
        providerId: provider.providerId,
        modelId: provider.modelId,
        transportId: String(resolvedInput.transportId || provider.transport || ''),
        capabilities: provider.capabilities,
        ...(typeof resolvedInput.endpoint === 'string' && resolvedInput.endpoint ? { endpoint: resolvedInput.endpoint } : {}),
        ...(typeof resolvedInput.endpointClass === 'string' && resolvedInput.endpointClass ? { endpointClass: resolvedInput.endpointClass } : {}),
    };
    const prompt = input.prompt || {};
    const appearanceReferences = input.appearanceLibrary
        ? buildAppearanceReferenceCandidates(input.appearanceLibrary, input.gallery || [])
        : [];
    const providedReferences = Array.isArray(input.references) ? clone(input.references) : [];
    const references = [...providedReferences, ...appearanceReferences]
        .filter((reference, index, all) => all.findIndex((candidate) => candidate.id === reference.id) === index);
    const referenceSelection = selectReferenceCandidates(
        references,
        {
            ...input.referenceContext,
            focusText: prompt.focusText,
            sourceMessage: prompt.sourceMessage,
            nearbyMessages: prompt.nearbyMessages,
            capabilities: provider.capabilities,
        },
    );
    const plan = {
        schema: 2,
        id: String(input.id),
        idempotencyKey: String(input.idempotencyKey || input.policy?.idempotencyKey || input.id),
        invocation: input.invocation,
        target: input.target ? clone(input.target) : null,
        resolved,
        provider,
        ...(Array.isArray(input.messages) ? { messages: clone(input.messages) } : {}),
        prompt: {
            sourceMessage: String(prompt.sourceMessage || ''),
            focusText: prompt.focusText == null ? null : String(prompt.focusText),
            nearbyMessages: Array.isArray(prompt.nearbyMessages) ? clone(prompt.nearbyMessages) : [],
            intent: INTENTS.has(prompt.intent) ? prompt.intent : 'scene',
        },
        identities: Array.isArray(input.identities) ? clone(input.identities) : [],
        references: referenceSelection.selected,
        referenceOmissions: referenceSelection.omitted,
        options: {
            aspectRatio: input.options?.aspectRatio || '',
            imageSize: input.options?.imageSize || '',
            systemInstruction: input.options?.systemInstruction || '',
            ...(input.options?.thinkingLevel ? { thinkingLevel: String(input.options.thinkingLevel) } : {}),
            ...(input.options?.useGoogleSearch === true ? { useGoogleSearch: true } : {}),
        },
        policy: {
            source: input.policy?.source === 'automation' ? 'automation' : 'manual',
            idempotencyKey: String(input.idempotencyKey || input.policy?.idempotencyKey || input.id),
            preflightAccepted: input.policy?.preflightAccepted === true,
        },
    };
    return freeze(plan);
}

import { selectReferenceCandidates } from './rp/references.js';
import { alignContinuityReferencePlan } from './rp/continuity-shelf.js';
import { capabilityIsSupported, normalizeModelCapabilities, normalizeModelDefinition, normalizeRouteEvidence } from './providers/contracts.js';
import { getProviderDefinition } from './providers/registry.js';

const INVOCATIONS = new Set(['wand', 'settings', 'slash', 'swipe', 'automation', 'director']);
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

function copyResolvedModelDefinition(candidate, providerId, modelId) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const provider = getProviderDefinition(providerId);
    const transportIds = provider ? Object.keys(provider.transports || {}) : [];
    return normalizeModelDefinition({
        ...candidate,
        id: modelId,
        providerId: candidate.providerId || providerId,
        transportId: candidate.transportId || candidate.transport,
    }, { id: providerId, transportIds });
}

function copySceneSnapshot(scene) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return null;
    return {
        schema: Number.isInteger(scene.schema) ? scene.schema : 1,
        sourcePassage: typeof scene.sourcePassage === 'string' ? scene.sourcePassage : '',
        prompt: typeof scene.prompt === 'string' ? scene.prompt : '',
        state: scene.state && typeof scene.state === 'object' && !Array.isArray(scene.state) ? clone(scene.state) : {},
        inspection: scene.inspection && typeof scene.inspection === 'object' && !Array.isArray(scene.inspection) ? clone(scene.inspection) : null,
    };
}

export function mapAspectRatioToImageSize(aspectRatio) {
    switch (aspectRatio) {
        case '3:4':
        case '9:16':
            return '1024x1536';
        case '4:3':
        case '16:9':
            return '1536x1024';
        case '1:1':
        default:
            return '1024x1024';
    }
}

export function resolveEffectiveImageSize(savedImageSize, capabilities = {}, aspectRatio = '') {
    const saved = typeof savedImageSize === 'string' ? savedImageSize : '';
    const normalized = normalizeModelCapabilities(capabilities);
    if (!capabilityIsSupported(normalized.sizes)) return '';
    if (Array.isArray(normalized.allowedSizes)) return normalized.allowedSizes.includes(saved) ? saved : '';
    return mapAspectRatioToImageSize(aspectRatio);
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
        ...(resolvedInput.routeEvidence && typeof resolvedInput.routeEvidence === 'object' ? { routeEvidence: normalizeRouteEvidence(resolvedInput.routeEvidence) } : {}),
        ...(typeof resolvedInput.legacyKind === 'string' && resolvedInput.legacyKind ? { legacyKind: resolvedInput.legacyKind } : {}),
    };
    const capturedModel = copyResolvedModelDefinition(
        resolvedInput.modelDefinition || resolvedInput.model || input.modelDefinition || input.provider?.modelDefinition,
        resolved.providerId,
        resolved.modelId,
    );
    if (capturedModel) {
        resolved.modelDefinition = capturedModel;
        resolved.capabilities = capturedModel.capabilities;
        provider.capabilities = capturedModel.capabilities;
    }
    const effectiveImageSize = resolveEffectiveImageSize(input.options?.imageSize, provider.capabilities, input.options?.aspectRatio);
    const prompt = input.prompt || {};
    const canonSnapshot = input.canonSnapshot && typeof input.canonSnapshot === 'object' ? clone(input.canonSnapshot) : null;
    const availableReferenceIds = Array.isArray(input.availableReferenceIds)
        ? new Set(input.availableReferenceIds.map((id) => String(id)))
        : null;
    const appearanceReferences = (Array.isArray(canonSnapshot?.references) ? canonSnapshot.references : [])
        .filter((reference) => !availableReferenceIds || availableReferenceIds.has(String(reference.id)));
    const providedReferences = (Array.isArray(input.references) ? clone(input.references) : [])
        .filter((reference) => !availableReferenceIds || availableReferenceIds.has(String(reference.id)));
    const references = [...providedReferences, ...appearanceReferences]
        .filter((reference, index, all) => all.findIndex((candidate) => candidate.id === reference.id) === index);
    const referenceSelection = input.referencePlan && Array.isArray(input.referencePlan.selected) && Array.isArray(input.referencePlan.omitted)
        ? (() => {
            const selectedIds = new Set(input.referencePlan.selected.map((reference) => String(reference?.id || '')));
            const omittedById = new Map(input.referencePlan.omitted.map((entry) => [String(entry?.id || ''), entry]));
            const selected = references.filter((reference) => selectedIds.has(String(reference.id)));
            const omitted = references
                .filter((reference) => !selectedIds.has(String(reference.id)))
                .map((candidate) => ({ candidate, reason: omittedById.get(String(candidate.id))?.reason || 'reference-plan' }));
            return { selected, omitted };
        })()
        : selectReferenceCandidates(
            references,
            {
                ...input.referenceContext,
                focusText: prompt.focusText,
                sourceMessage: prompt.sourceMessage,
                nearbyMessages: prompt.nearbyMessages,
                capabilities: provider.capabilities,
            },
        );
    const hasContinuityShelfProjection = input.referencePlan && Array.isArray(input.referencePlan.identities) && input.referencePlan.identities.length > 0;
    const alignedReferencePlan = hasContinuityShelfProjection
        ? alignContinuityReferencePlan(input.referencePlan, {
            ...referenceSelection,
            omitted: [
                ...referenceSelection.omitted,
                ...(Array.isArray(input.referenceOmissions) ? input.referenceOmissions : []).map((omission) => ({
                    candidate: [
                        ...(Array.isArray(input.referencePlan.selected) ? input.referencePlan.selected : []),
                        ...(Array.isArray(input.referencePlan.omitted) ? input.referencePlan.omitted : []),
                        ...(Array.isArray(canonSnapshot?.references) ? canonSnapshot.references : []),
                    ].find((candidate) => String(candidate?.id || '') === String(omission?.id || '')) || { id: omission?.id },
                    reason: omission?.reason || 'asset-unavailable',
                })),
            ],
        })
        : null;
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
            ...(typeof prompt.sender === 'string' ? { sender: prompt.sender } : {}),
            ...(typeof prompt.messageContent === 'string' ? { messageContent: prompt.messageContent } : {}),
            ...(typeof prompt.descriptionText === 'string' ? { descriptionText: prompt.descriptionText } : {}),
            ...(typeof prompt.outfitText === 'string' ? { outfitText: prompt.outfitText } : {}),
        },
        ...(input.scene ? { scene: copySceneSnapshot(input.scene) } : {}),
        identities: Array.isArray(input.identities) ? clone(input.identities) : [],
        ...(alignedReferencePlan ? { referencePlan: alignedReferencePlan } : input.referencePlan && typeof input.referencePlan === 'object' ? { referencePlan: clone(input.referencePlan) } : {}),
        ...(Array.isArray(input.activeOutfits) ? { activeOutfits: clone(input.activeOutfits) } : {}),
        continuityRevision: String(canonSnapshot?.continuityRevision || ''),
        referenceAssets: canonSnapshot?.assets && typeof canonSnapshot.assets === 'object' ? clone(canonSnapshot.assets) : {},
        references: referenceSelection.selected,
        referenceOmissions: [...referenceSelection.omitted, ...(Array.isArray(canonSnapshot?.omissions) ? canonSnapshot.omissions : []), ...(Array.isArray(input.referenceOmissions) ? clone(input.referenceOmissions) : [])],
        options: {
            aspectRatio: input.options?.aspectRatio || '',
            imageSize: effectiveImageSize,
            systemInstruction: input.options?.systemInstruction || '',
            ...(input.options?.thinkingLevel ? { thinkingLevel: String(input.options.thinkingLevel) } : {}),
            ...(input.options?.useGoogleSearch === true ? { useGoogleSearch: true } : {}),
            ...(typeof input.options?.framing === 'string' ? { framing: input.options.framing } : {}),
            ...(typeof input.options?.continuity === 'string' ? { continuity: input.options.continuity } : {}),
            ...(typeof input.options?.visualDirection === 'string' ? { visualDirection: input.options.visualDirection } : {}),
        },
        policy: {
            source: input.policy?.source === 'automation' ? 'automation' : 'manual',
            idempotencyKey: String(input.idempotencyKey || input.policy?.idempotencyKey || input.id),
            preflightAccepted: input.policy?.preflightAccepted === true,
            routeConfirmationAccepted: input.policy?.routeConfirmationAccepted === true,
        },
    };
    return freeze(plan);
}

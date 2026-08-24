import { gateReferencesByCapability } from './rp/references.js';

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
    const rawCap = provider.capabilities?.referenceImages?.maxCount;
    const capabilities = Number.isInteger(rawCap) && rawCap >= 0 ? { referenceImages: { maxCount: rawCap } } : { referenceImages: {} };
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
    const provider = copyProvider(input.provider);
    const prompt = input.prompt || {};
    const plan = {
        schema: 1,
        id: String(input.id),
        invocation: input.invocation,
        target: input.target ? clone(input.target) : null,
        provider,
        prompt: {
            sourceMessage: String(prompt.sourceMessage || ''),
            focusText: prompt.focusText == null ? null : String(prompt.focusText),
            nearbyMessages: Array.isArray(prompt.nearbyMessages) ? clone(prompt.nearbyMessages) : [],
            intent: INTENTS.has(prompt.intent) ? prompt.intent : 'scene',
        },
        identities: Array.isArray(input.identities) ? clone(input.identities) : [],
        references: gateReferencesByCapability(Array.isArray(input.references) ? clone(input.references) : [], provider.capabilities),
        options: {
            aspectRatio: input.options?.aspectRatio || '',
            imageSize: input.options?.imageSize || '',
            systemInstruction: input.options?.systemInstruction || '',
        },
        policy: {
            source: input.policy?.source === 'automation' ? 'automation' : 'manual',
            idempotencyKey: String(input.policy?.idempotencyKey || input.id),
        },
    };
    return freeze(plan);
}

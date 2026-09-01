const ACTIONS = Object.freeze({
    VARY_SHOT: 'vary-shot',
    KEEP_CHARACTERS_CHANGE_SCENE: 'keep-characters-change-scene',
    EDIT_REGENERATE: 'edit-regenerate',
    REUSE_RECIPE: 'reuse-recipe',
    RETRY_REPAIRED_PROMPT: 'retry-repaired-prompt',
    MAKE_CANONICAL_ROLES: 'make-canonical-roles',
});

const ACTION_ALIASES = Object.freeze({
    'vary': ACTIONS.VARY_SHOT,
    'vary-shot': ACTIONS.VARY_SHOT,
    'keep-characters-change-scene': ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE,
    'keep-characters/change-scene': ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE,
    'edit-and-regenerate': ACTIONS.EDIT_REGENERATE,
    'edit-&-regenerate': ACTIONS.EDIT_REGENERATE,
    'edit-regenerate': ACTIONS.EDIT_REGENERATE,
    'reuse': ACTIONS.REUSE_RECIPE,
    'reuse-recipe': ACTIONS.REUSE_RECIPE,
    'retry-with-repaired-prompt': ACTIONS.RETRY_REPAIRED_PROMPT,
    'retry-repaired-prompt': ACTIONS.RETRY_REPAIRED_PROMPT,
    'make-canonical': ACTIONS.MAKE_CANONICAL_ROLES,
    'make-canonical-roles': ACTIONS.MAKE_CANONICAL_ROLES,
});

const IDENTITY_REFERENCE_ROLES = new Set([
    'active-look', 'identity-look', 'character-look', 'avatar', 'description', 'host-avatar', 'character',
]);
const DELIMITERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(DELIMITERS));

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function stableValue(value) {
    if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function fnv1a64(text) {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(text)) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
}

export function createStableArtifactId({ sourceArtifactId = 'artifact:root', action = 'source', actionId = '1', outputIndex = 0 } = {}) {
    return `artifact:${fnv1a64(stableValue({ sourceArtifactId: String(sourceArtifactId), action: String(action), actionId: String(actionId), outputIndex: Number(outputIndex) || 0 }))}`;
}

export function normalizeIterationAction(action) {
    const key = String(action || '').trim().toLocaleLowerCase('und').replaceAll(' ', '-');
    return ACTION_ALIASES[key] || key;
}

function cleanPrompt(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function normalizeReferences(value) {
    return (Array.isArray(value) ? value : []).map((reference) => {
        const normalized = clone(isRecord(reference) ? reference : {});
        delete normalized.data;
        delete normalized.imageData;
        return normalized;
    });
}

function normalizeCanonSnapshot(value) {
    const snapshot = isRecord(value) ? clone(value) : {};
    return {
        ...snapshot,
        activeLook: snapshot.activeLook === undefined ? null : snapshot.activeLook,
        priorScene: snapshot.priorScene === undefined ? null : snapshot.priorScene,
        chatBackground: snapshot.chatBackground === undefined ? null : snapshot.chatBackground,
        durableIdentityFacts: snapshot.durableIdentityFacts === undefined ? {} : snapshot.durableIdentityFacts,
    };
}

function artifactInput(value = {}) {
    const recipe = isRecord(value.recipe) ? value.recipe : value;
    return {
        sourcePassage: clone(recipe.sourcePassage || {}),
        effectivePrompt: cleanPrompt(recipe.effectivePrompt ?? recipe.prompt),
        references: normalizeReferences(recipe.references),
        model: clone(recipe.model || {}),
        route: clone(recipe.route || {}),
        options: clone(recipe.options || {}),
        canonSnapshot: normalizeCanonSnapshot(recipe.canonSnapshot),
    };
}

/** Creates a self-contained, immutable recipe and provenance record. */
export function createIterationArtifact({
    artifactId,
    parentArtifactId = null,
    action = 'source',
    sourcePassage = {},
    effectivePrompt = '',
    references = [],
    model = {},
    route = {},
    options = {},
    canonSnapshot = {},
    createdAt = null,
} = {}) {
    const recipe = {
        sourcePassage: clone(sourcePassage || {}),
        effectivePrompt: cleanPrompt(effectivePrompt),
        references: normalizeReferences(references),
        model: clone(model || {}),
        route: clone(route || {}),
        options: clone(options || {}),
        canonSnapshot: normalizeCanonSnapshot(canonSnapshot),
    };
    const stableId = artifactId || createStableArtifactId({
        sourceArtifactId: parentArtifactId || 'artifact:root',
        action,
        actionId: stableValue(recipe),
        outputIndex: 0,
    });
    const provenance = {
        sourcePassage: clone(recipe.sourcePassage),
        effectivePrompt: recipe.effectivePrompt,
        references: clone(recipe.references),
        model: clone(recipe.model),
        route: clone(recipe.route),
        options: clone(recipe.options),
        canonSnapshot: clone(recipe.canonSnapshot),
        action,
    };
    return deepFreeze({
        schema: 1,
        artifactId: String(stableId),
        parentArtifactId: parentArtifactId ? String(parentArtifactId) : null,
        action: String(action),
        createdAt: Number.isFinite(createdAt) ? createdAt : null,
        ...clone(recipe),
        recipe,
        provenance,
    });
}

function sourceDetails(sourceArtifact) {
    if (!isRecord(sourceArtifact)) throw new TypeError('sourceArtifact is required.');
    const id = String(sourceArtifact.artifactId || '');
    if (!id) throw new TypeError('sourceArtifact.artifactId is required.');
    return { id, recipe: artifactInput(sourceArtifact), snapshot: deepFreeze(clone(sourceArtifact)) };
}

function mergeOptions(base, changes) {
    return { ...clone(base), ...(isRecord(changes) ? clone(changes) : {}) };
}

function deriveRecipe(action, base, changes) {
    const recipe = artifactInput(base);
    const delta = isRecord(changes) ? changes : {};
    switch (action) {
        case ACTIONS.VARY_SHOT:
            recipe.options = mergeOptions(recipe.options, { composition: clone(delta.composition || {}) });
            return { recipe, stateRules: ['preserve-identity-facts', 'preserve-story-facts'] };
        case ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE:
            recipe.references = recipe.references.filter((reference) => IDENTITY_REFERENCE_ROLES.has(String(reference.role || '').toLowerCase()));
            recipe.canonSnapshot = {
                ...recipe.canonSnapshot,
                priorScene: clone(delta.scene || null),
            };
            return { recipe, stateRules: ['preserve-identity-facts', 'drop-obsolete-scene-state'] };
        case ACTIONS.EDIT_REGENERATE:
            recipe.effectivePrompt = cleanPrompt(delta.prompt ?? delta.effectivePrompt ?? recipe.effectivePrompt);
            return { recipe, stateRules: ['preserve-references', 'preserve-canon-snapshot'] };
        case ACTIONS.REUSE_RECIPE:
            return { recipe, stateRules: ['preserve-recipe'] };
        case ACTIONS.RETRY_REPAIRED_PROMPT: {
            const repair = repairPromptDraft(delta.prompt ?? delta.effectivePrompt ?? recipe.effectivePrompt);
            recipe.effectivePrompt = repair.repairedPrompt;
            return { recipe, repair, stateRules: ['preserve-references', 'preserve-canon-snapshot', 'manual-prompt-review'] };
        }
        case ACTIONS.MAKE_CANONICAL_ROLES: {
            const roles = isRecord(delta.roles) ? delta.roles : {};
            if (delta.role === 'active-look') roles.activeLook = delta.value;
            if (delta.role === 'prior-scene') roles.priorScene = delta.value;
            if (delta.role === 'chat-background') roles.chatBackground = delta.value;
            recipe.canonSnapshot = {
                ...recipe.canonSnapshot,
                ...(Object.prototype.hasOwnProperty.call(roles, 'activeLook') ? { activeLook: clone(roles.activeLook) } : {}),
                ...(Object.prototype.hasOwnProperty.call(roles, 'priorScene') ? { priorScene: clone(roles.priorScene) } : {}),
                ...(Object.prototype.hasOwnProperty.call(roles, 'chatBackground') ? { chatBackground: clone(roles.chatBackground) } : {}),
            };
            return { recipe, stateRules: ['update-selected-canonical-roles'] };
        }
        default:
            throw new TypeError(`Unknown iteration action: ${action}`);
    }
}

function normalizeConsent(value, outputCount) {
    const consent = isRecord(value) ? value : {};
    const approved = consent.approved === true;
    const cost = Number.isFinite(consent.cost) ? consent.cost : Number.isFinite(consent.estimatedCost) ? consent.estimatedCost : null;
    return {
        required: outputCount > 0,
        approved,
        outputCount,
        cost,
        costDisclosure: cost === null ? 'unknown' : 'estimate',
    };
}

export function repairPromptDraft(value) {
    const originalPrompt = typeof value === 'string' ? value : '';
    let repairedPrompt = cleanPrompt(originalPrompt);
    const changes = [];
    if (!repairedPrompt) return deepFreeze({ status: 'malformed', originalPrompt, repairedPrompt: '', changes: ['empty-prompt'], dispatchAllowed: false });
    const stack = [];
    let output = '';
    for (const character of repairedPrompt) {
        if (DELIMITERS[character]) stack.push(DELIMITERS[character]);
        else if (CLOSERS.has(character)) {
            if (stack.at(-1) === character) stack.pop();
            else if (stack.length) { output += stack.pop(); changes.push('repaired-delimiter-order'); }
        }
        output += character;
    }
    while (stack.length) { output += stack.pop(); changes.push('closed-unbalanced-delimiter'); }
    repairedPrompt = output;
    if (repairedPrompt !== originalPrompt.trim()) changes.unshift('normalized-prompt');
    return deepFreeze({
        status: changes.length ? 'repaired' : 'valid',
        originalPrompt,
        repairedPrompt,
        changes: [...new Set(changes)],
        dispatchAllowed: false,
    });
}

/** Builds a UI/runtime-ready plan. It performs no provider or network call. */
export function planIterationAction({
    action,
    sourceArtifact,
    actionId = '1',
    changes = {},
    twoUp = false,
    paidConsent,
} = {}) {
    const { id, recipe: base, snapshot: sourceSnapshot } = sourceDetails(sourceArtifact);
    const normalizedAction = normalizeIterationAction(action);
    const outputCount = twoUp ? 2 : 1;
    const derived = deriveRecipe(normalizedAction, base, changes);
    const artifacts = Array.from({ length: outputCount }, (_unused, outputIndex) => createIterationArtifact({
        ...derived.recipe,
        artifactId: createStableArtifactId({ sourceArtifactId: id, action: normalizedAction, actionId, outputIndex }),
        parentArtifactId: id,
        action: normalizedAction,
    }));
    const consent = normalizeConsent(paidConsent, outputCount);
    const isDraft = normalizedAction === ACTIONS.RETRY_REPAIRED_PROMPT;
    const isCanonUpdate = normalizedAction === ACTIONS.MAKE_CANONICAL_ROLES;
    const consentMatches = consent.approved && consent.outputCount === outputCount;
    const status = isDraft ? 'draft-review' : isCanonUpdate ? 'canon-ready' : consentMatches ? 'ready' : 'consent-required';
    const dispatch = {
        allowed: status === 'ready',
        network: false,
        reason: isDraft ? 'manual-confirmation-required' : isCanonUpdate ? 'canon-update-only' : status === 'ready' ? null : 'explicit-paid-consent-required',
    };
    return deepFreeze({
        schema: 1,
        planId: `plan:${fnv1a64(stableValue({ sourceArtifactId: id, action: normalizedAction, actionId, outputCount }))}`,
        action: normalizedAction,
        sourceArtifactId: id,
        originalArtifactId: id,
        sourceArtifact: sourceSnapshot,
        artifacts,
        stateRules: derived.stateRules,
        consent,
        repair: derived.repair || null,
        status,
        dispatch,
    });
}

export const createArtifact = createIterationArtifact;
export const planAction = planIterationAction;
export const repairPrompt = repairPromptDraft;
export { ACTIONS };

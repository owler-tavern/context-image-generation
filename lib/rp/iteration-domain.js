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
const CANONICAL_ROLE_KEYS = new Set(['activeLook', 'priorScene', 'chatBackground']);
const DURABLE_OPTION_KEYS = new Set(['aspectRatio', 'imageSize', 'systemInstruction', 'thinkingLevel', 'useGoogleSearch', 'seed', 'quality', 'style', 'size', 'width', 'height', 'negativePrompt']);

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

export function createStableArtifactId({ sourceArtifactId = 'artifact:root', action = 'source', invocationId, actionId, outputIndex = 0 } = {}) {
    const token = invocationId ?? actionId;
    if (typeof token !== 'string' || !token.trim()) throw new TypeError('invocationId is required to construct a stable artifact ID.');
    return `artifact:${fnv1a64(stableValue({ sourceArtifactId: String(sourceArtifactId), action: String(action), invocationId: token, outputIndex: Number(outputIndex) || 0 }))}`;
}

export function createIterationInvocationId({ randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto) } = {}) {
    if (typeof randomUUID !== 'function') throw new TypeError('A crypto UUID generator is required.');
    return String(randomUUID());
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
        invocationId: stableValue(recipe),
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
    const next = { ...clone(base), ...(isRecord(changes) ? clone(changes) : {}) };
    if (isRecord(base?.composition) || isRecord(changes?.composition)) {
        next.composition = { ...(isRecord(base?.composition) ? clone(base.composition) : {}), ...(isRecord(changes?.composition) ? clone(changes.composition) : {}) };
    }
    return next;
}

function compositionPrompt(prompt, composition) {
    const controls = Object.keys(composition || {}).sort().map((key) => `${key}=${typeof composition[key] === 'string' ? composition[key] : stableValue(composition[key])}`);
    const basePrompt = String(prompt || '').replace(/\nComposition controls:[\s\S]*$/u, '').trim();
    return controls.length ? `${basePrompt}\nComposition controls: ${controls.join(', ')}` : basePrompt;
}

function requiredFreshScene(changes, base) {
    const passage = changes.sourcePassage ?? changes.passage;
    const prompt = cleanPrompt(changes.prompt ?? changes.effectivePrompt);
    const scene = changes.scene ?? changes.currentScene;
    if (!passage || !prompt || !isRecord(scene) || !Object.keys(scene).length) throw new TypeError('change-scene requires a new source passage, effective prompt, and current scene state.');
    const sourcePassage = typeof passage === 'string' ? { text: cleanPrompt(passage) } : clone(passage);
    if (!cleanPrompt(sourcePassage.text)) throw new TypeError('change-scene requires a new source passage.');
    const priorLocation = cleanPrompt(base.canonSnapshot?.priorScene?.location).toLocaleLowerCase('und');
    const oldBackground = cleanPrompt(base.canonSnapshot?.chatBackground).toLocaleLowerCase('und');
    const promptLower = prompt.toLocaleLowerCase('und');
    const stale = [priorLocation, oldBackground].filter((term) => term.length > 2 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/gu, '\\\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(promptLower));
    if (stale.length) throw new TypeError(`change-scene prompt contains stale scene context: ${stale[0]}.`);
    return { sourcePassage, prompt, scene: clone(scene) };
}

function canonicalRoles(changes) {
    const delta = isRecord(changes) ? changes : {};
    const sourceRoles = isRecord(delta.roles) ? delta.roles : delta.role ? { [String(delta.role)]: delta.value } : {};
    const roles = {};
    for (const [key, value] of Object.entries(sourceRoles)) {
        const normalizedKey = key === 'active-look' ? 'activeLook' : key === 'prior-scene' ? 'priorScene' : key === 'chat-background' ? 'chatBackground' : key;
        if (!CANONICAL_ROLE_KEYS.has(normalizedKey)) throw new TypeError(`unknown canonical role: ${key}.`);
        if (value === null || value === undefined || (typeof value === 'string' && !cleanPrompt(value)) || (isRecord(value) && !Object.keys(value).length)) throw new TypeError(`Canonical role ${key} cannot be empty.`);
        if (normalizedKey === 'activeLook' && (!isRecord(value) || !cleanPrompt(value.identityId) || !cleanPrompt(value.lookId))) throw new TypeError('Canonical activeLook requires identityId and lookId.');
        roles[normalizedKey] = clone(value);
    }
    if (!Object.keys(roles).length) throw new TypeError('At least one canonical role is required.');
    return roles;
}

function durableOptions(value) {
    const options = isRecord(value) ? value : {};
    return Object.fromEntries(Object.entries(options).filter(([key]) => DURABLE_OPTION_KEYS.has(key)).map(([key, item]) => [key, clone(item)]));
}

function verifyGenerationAuthority({ generationPlan, verifyGenerationPlan, sourceArtifactId, invocationId } = {}) {
    const registryPlan = isRecord(generationPlan) ? deepFreeze(clone(generationPlan)) : null;
    const planId = String(registryPlan?.planId || '');
    const revision = String(registryPlan?.revision || registryPlan?.routeRevision || '');
    if (!registryPlan || !planId || !revision || typeof verifyGenerationPlan !== 'function') return false;
    const result = verifyGenerationPlan(Object.freeze({
        planId,
        revision,
        sourceArtifactId,
        invocationId,
        generationPlan: registryPlan,
    }));
    const valid = isRecord(result)
        && result.status === 'verified'
        && result.planId === planId
        && result.revision === revision
        && typeof result.authorityToken === 'string'
        && result.authorityToken.length > 0
        && result.routeResolved === true
        && result.capabilities?.imageGeneration === true;
    return valid ? { result, registryPlan } : null;
}

function deriveRecipe(action, base, changes) {
    const recipe = artifactInput(base);
    const delta = isRecord(changes) ? changes : {};
    switch (action) {
        case ACTIONS.VARY_SHOT:
            if (!isRecord(delta.composition) || !Object.keys(delta.composition).length) throw new TypeError('vary-shot requires composition controls.');
            recipe.options = mergeOptions(recipe.options, { composition: clone(delta.composition) });
            recipe.effectivePrompt = compositionPrompt(recipe.effectivePrompt, recipe.options.composition);
            return { recipe, stateRules: ['preserve-identity-facts', 'preserve-story-facts'] };
        case ACTIONS.KEEP_CHARACTERS_CHANGE_SCENE:
            {
            const fresh = requiredFreshScene(delta, base);
            recipe.options = durableOptions(recipe.options);
            recipe.references = recipe.references.filter((reference) => IDENTITY_REFERENCE_ROLES.has(String(reference.role || '').toLowerCase()));
            recipe.canonSnapshot = {
                ...recipe.canonSnapshot,
                priorScene: fresh.scene,
                chatBackground: null,
            };
            recipe.sourcePassage = fresh.sourcePassage;
            recipe.effectivePrompt = fresh.prompt;
            return { recipe, stateRules: ['preserve-identity-facts', 'drop-obsolete-scene-state'] };
            }
        case ACTIONS.EDIT_REGENERATE:
            recipe.effectivePrompt = cleanPrompt(delta.prompt ?? delta.effectivePrompt ?? recipe.effectivePrompt);
            if (!recipe.effectivePrompt) throw new TypeError('edit-regenerate requires a non-empty prompt.');
            return { recipe, stateRules: ['preserve-references', 'preserve-canon-snapshot'] };
        case ACTIONS.REUSE_RECIPE:
            return { recipe, stateRules: ['preserve-recipe'] };
        case ACTIONS.RETRY_REPAIRED_PROMPT: {
            const repair = repairPromptDraft(delta.prompt ?? delta.effectivePrompt ?? recipe.effectivePrompt);
            recipe.effectivePrompt = repair.repairedPrompt;
            return { recipe, repair, stateRules: ['preserve-references', 'preserve-canon-snapshot', 'manual-prompt-review'] };
        }
        case ACTIONS.MAKE_CANONICAL_ROLES: {
            const roles = canonicalRoles(delta);
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
    const candidateCost = Number.isFinite(consent.cost) ? consent.cost : Number.isFinite(consent.estimatedCost) ? consent.estimatedCost : null;
    const cost = candidateCost !== null && candidateCost >= 0 ? candidateCost : null;
    const acknowledgedUnavailable = consent.costUnavailableAcknowledged === true || consent.costUnavailable === true || consent.costUnavailableAcknowledgement === true;
    const claimedOutputCount = Number.isInteger(consent.outputCount) ? consent.outputCount : null;
    return {
        required: outputCount > 0,
        approved,
        outputCount: claimedOutputCount,
        cost,
        costDisclosure: cost === null ? 'unknown' : 'estimate',
        costUnavailableAcknowledged: acknowledgedUnavailable,
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
    changes = {},
    twoUp = false,
    paidConsent,
    invocationId,
    reserveInvocation,
    generationPlan,
    verifyGenerationPlan,
    verifyCanonicalEligibility,
} = {}) {
    if (typeof invocationId !== 'string' || !invocationId.trim()) throw new TypeError('An externally unique invocationId is required.');
    if (typeof reserveInvocation !== 'function') throw new TypeError('reserveInvocation is required to enforce invocation uniqueness.');
    if (reserveInvocation(invocationId) === false) throw new TypeError(`Invocation ${invocationId} is already reserved.`);
    const { id, recipe: base, snapshot: sourceSnapshot } = sourceDetails(sourceArtifact);
    const normalizedAction = normalizeIterationAction(action);
    const outputCount = twoUp ? 2 : 1;
    const derived = deriveRecipe(normalizedAction, base, changes);
    const isCanonUpdate = normalizedAction === ACTIONS.MAKE_CANONICAL_ROLES;
    const artifacts = isCanonUpdate
        ? [sourceSnapshot]
        : Array.from({ length: outputCount }, (_unused, outputIndex) => createIterationArtifact({
            ...derived.recipe,
            artifactId: createStableArtifactId({ sourceArtifactId: id, action: normalizedAction, invocationId, outputIndex }),
            parentArtifactId: id,
            action: normalizedAction,
        }));
    const consent = normalizeConsent(paidConsent, outputCount);
    const isDraft = normalizedAction === ACTIONS.RETRY_REPAIRED_PROMPT;
    const consentMatches = consent.approved
        && consent.outputCount === outputCount
        && (consent.cost !== null || consent.costUnavailableAcknowledged === true);
    const authority = verifyGenerationAuthority({ generationPlan, verifyGenerationPlan, sourceArtifactId: id, invocationId });
    const authorityReady = Boolean(authority);
    const status = isDraft ? 'draft-review' : isCanonUpdate ? 'canon-ready' : consentMatches ? 'ready' : 'consent-required';
    const dispatch = {
        allowed: status === 'ready' && authorityReady,
        network: false,
        reason: isDraft ? 'manual-confirmation-required' : isCanonUpdate ? 'canon-update-only' : !authorityReady ? 'verified-generation-plan-required' : status === 'ready' ? null : 'explicit-paid-consent-required',
    };
    const roles = isCanonUpdate ? canonicalRoles(changes) : null;
    if (isCanonUpdate) {
        if (typeof verifyCanonicalEligibility !== 'function') throw new TypeError('canonical eligibility authority is required.');
        const eligibility = verifyCanonicalEligibility(Object.freeze({
            artifactId: id,
            identityId: changes.identityId || roles.activeLook?.identityId || null,
            lookId: changes.lookId || roles.activeLook?.lookId || null,
            roles,
        }));
        if (!isRecord(eligibility) || eligibility.status !== 'eligible' || eligibility.artifactId !== id || typeof eligibility.authorityToken !== 'string' || !eligibility.authorityToken) throw new TypeError('canonical eligibility authority rejected the selected artifact.');
    }
    const retention = outputCount === 2
        ? { mode: 'chosen-only', status: 'awaiting-selection', chosenArtifactId: null, discardUnchosen: true }
        : { mode: 'single', status: 'selected', chosenArtifactId: artifacts[0]?.artifactId || null, discardUnchosen: false };
    return deepFreeze({
        schema: 1,
        planId: `plan:${fnv1a64(stableValue({ sourceArtifactId: id, action: normalizedAction, invocationId, outputCount }))}`,
        action: normalizedAction,
        sourceArtifactId: id,
        originalArtifactId: id,
        sourceArtifact: sourceSnapshot,
        artifacts,
        stateRules: derived.stateRules,
        consent,
        repair: derived.repair || null,
        generationPlan: authority?.registryPlan || (generationPlan ? deepFreeze(clone(generationPlan)) : null),
        mutation: isCanonUpdate ? { operation: 'update-canonical-roles', targetArtifactId: id, roles } : null,
        retention,
        status,
        dispatch,
    });
}

export function chooseTwoUpArtifact(plan, artifactId) {
    if (!isRecord(plan) || plan.retention?.mode !== 'chosen-only' || !plan.retention?.discardUnchosen) throw new TypeError('A chosen-only two-up plan is required.');
    const chosen = plan.artifacts.find((artifact) => artifact.artifactId === String(artifactId));
    if (!chosen) throw new TypeError('The chosen artifact is not part of this plan.');
    return deepFreeze({
        ...clone(plan),
        retention: {
            ...clone(plan.retention),
            status: 'selected',
            chosenArtifactId: chosen.artifactId,
            discardArtifactIds: plan.artifacts.filter((artifact) => artifact.artifactId !== chosen.artifactId).map((artifact) => artifact.artifactId),
        },
    });
}

export const createArtifact = createIterationArtifact;
export const planAction = planIterationAction;
export const repairPrompt = repairPromptDraft;
export { ACTIONS };

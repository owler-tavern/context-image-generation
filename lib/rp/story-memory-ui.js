/**
 * P4 user-facing seam for story memory.
 *
 * This module is deliberately a projection/controller boundary. Persistence,
 * Gallery hydration, and continue dispatch are injected by the host so this
 * surface cannot silently perform provider or network work.
 */
import {
    STORY_MEMORY_SCHEMA,
    addStoryCollectionMember,
    buildReproductionInput,
    createStoryCollection,
    createStoryMemory,
    getGenerationDetails,
    getStoryArtifactProvenance,
    getStoryTimeline,
    listStoryCollections,
    planContinueFromScene,
    removeStoryCollectionMember,
    resolveArtifactIdAlias,
    searchStoryArtifacts,
    toggleStoryFavorite,
} from './story-memory.js';
import { renderReferenceReceipt } from './reference-receipt.js';

export const STORY_MEMORY_UI_VERSION = 'p4-story-memory-ui-v1';
export const STORY_MEMORY_STYLE_ID = `cig-rp-story-memory-style-${STORY_MEMORY_UI_VERSION}`;

const REQUIRED_LOAD_DEPENDENCIES = Object.freeze(['readMemory', 'hydrateGallery', 'persistMemory', 'readbackMemory']);
const STYLE_OWNERS = new WeakMap();

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function text(value) { return String(value ?? '').trim(); }
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function json(value) { return escapeHtml(JSON.stringify(value ?? null, null, 2)); }
function dependencyError(name) { return `Required ${name} dependency is unavailable; story memory is blocked.`; }
function filterValue(value) {
    if (value === '' || value === null || value === undefined) return undefined;
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}
function stateSnapshot(state) { return clone(state); }
function emptyMemory() { return createStoryMemory({ schema: STORY_MEMORY_SCHEMA, artifacts: {}, collections: {} }); }
function artifactVersion(artifact) {
    if (!artifact) return null;
    return artifact.version ?? artifact.provenance?.version ?? artifact.generation?.version ?? null;
}
function requiredDependencies(deps, names) { return names.find((name) => typeof deps?.[name] !== 'function'); }
function responseMemory(response) {
    if (isRecord(response) && isRecord(response.memory)) return response.memory;
    if (isRecord(response) && isRecord(response.value)) return response.value;
    return response;
}
function responseGallery(response, fallback) {
    return isRecord(response) && Array.isArray(response.gallery) ? response.gallery : fallback;
}
function closest(target, selector) { return typeof target?.closest === 'function' ? target.closest(selector) : null; }

function sortedIds(value) { return Object.keys(value || {}).sort((left, right) => left.localeCompare(right)); }
function stableValue(value) {
    if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}
function sameValue(left, right) { return stableValue(left) === stableValue(right); }

function memoryDelta(before, after) {
    const oldArtifacts = before?.artifacts || {};
    const newArtifacts = after?.artifacts || {};
    const addedArtifactIds = sortedIds(newArtifacts).filter((id) => !oldArtifacts[id]);
    const changedArtifactIds = sortedIds(newArtifacts).filter((id) => oldArtifacts[id] && !sameValue(oldArtifacts[id], newArtifacts[id]));
    const removedArtifactIds = sortedIds(oldArtifacts).filter((id) => !newArtifacts[id]);
    const expectation = (ids, source) => Object.fromEntries(ids.map((id) => [id, artifactExpectation(source[id])]));
    return {
        addedArtifactIds,
        changedArtifactIds,
        removedArtifactIds,
        expectedArtifacts: {
            added: expectation(addedArtifactIds, newArtifacts),
            changed: expectation(changedArtifactIds, newArtifacts),
            removed: expectation(removedArtifactIds, oldArtifacts),
        },
    };
}

function artifactExpectation(artifact) {
    return artifact ? clone(artifact) : null;
}

function normalizeFilters(filters = {}) {
    const result = {};
    for (const key of ['chatId', 'taskId', 'prompt', 'promptText', 'characterId', 'character', 'model', 'from', 'to', 'startDate', 'endDate']) {
        if (filters[key] !== undefined && filters[key] !== '') result[key] = filters[key];
    }
    if (filters.favorite !== undefined && filters.favorite !== '') result.favorite = filterValue(filters.favorite);
    return result;
}

function projectedTimeline(memory, filters) {
    const normalized = normalizeFilters(filters);
    const timeline = Object.keys(normalized).length ? searchStoryArtifacts(memory, normalized) : getStoryTimeline(memory, normalized.chatId === undefined ? {} : { chatId: normalized.chatId });
    return timeline.sort((left, right) => {
        const leftMessage = Number.isFinite(left.messageId) ? left.messageId : Number.POSITIVE_INFINITY;
        const rightMessage = Number.isFinite(right.messageId) ? right.messageId : Number.POSITIVE_INFINITY;
        if (leftMessage !== rightMessage) return leftMessage - rightMessage;
        const leftOrder = Number.isFinite(Number(left.sequence)) ? Number(left.sequence) : (Number.isFinite(Number(left.order)) ? Number(left.order) : Number.POSITIVE_INFINITY);
        const rightOrder = Number.isFinite(Number(right.sequence)) ? Number(right.sequence) : (Number.isFinite(Number(right.order)) ? Number(right.order) : Number.POSITIVE_INFINITY);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
    });
}

function projectState(state) {
    const memory = state.memory || emptyMemory();
    const filters = normalizeFilters(state.filters);
    return {
        ...state,
        filters,
        timeline: projectedTimeline(memory, filters),
        collections: listStoryCollections(memory),
    };
}

function identityFor(memory, artifactId) {
    const canonicalId = resolveArtifactIdAlias(memory, artifactId);
    const artifact = canonicalId ? memory.artifacts?.[canonicalId] : null;
    return artifact ? { artifactId: canonicalId, artifactVersion: artifactVersion(artifact), artifact } : null;
}

function validateReadback(memory, request) {
    if (!isRecord(memory) || Number(memory.schema) !== STORY_MEMORY_SCHEMA) throw new TypeError('Story memory readback has an invalid schema.');
    if (request.artifactId) {
        const identity = identityFor(memory, request.artifactId);
        if (!identity || identity.artifactId !== request.artifactId) throw new TypeError(`Story memory readback lost artifact ${request.artifactId}.`);
        if (request.artifactVersion !== null && request.artifactVersion !== undefined && identity.artifactVersion !== request.artifactVersion) {
            throw new TypeError(`Story memory readback changed artifact version for ${request.artifactId}.`);
        }
    }
    if (request.collectionId && !memory.collections?.[request.collectionId]) throw new TypeError(`Story memory readback lost collection ${request.collectionId}.`);
    return memory;
}

export function compareStoryMemoryReadback(memoryValue, expected = {}) {
    const memory = createStoryMemory(memoryValue || {});
    if (expected.artifactId) {
        const identity = identityFor(memory, expected.artifactId);
        if (!identity) throw new TypeError(`Story memory readback lost artifact ${expected.artifactId}.`);
        if (expected.artifactVersion !== null && expected.artifactVersion !== undefined && identity.artifactVersion !== expected.artifactVersion) throw new TypeError(`Story memory readback changed artifact version for ${expected.artifactId}.`);
        if (expected.favorite !== undefined && identity.artifact.favorite !== expected.favorite) throw new TypeError(`Story memory readback has the wrong favorite value for ${expected.artifactId}.`);
    }
    for (const [bucket, shouldExist] of [['added', true], ['changed', true], ['removed', false]]) {
        for (const [id, artifact] of Object.entries(expected.expectedArtifacts?.[bucket] || {})) {
            const actual = memory.artifacts?.[id];
            if (shouldExist && !actual) throw new TypeError(`Story memory readback lost hydrated artifact ${id}.`);
            if (!shouldExist && actual) throw new TypeError(`Story memory readback resurrected removed artifact ${id}.`);
            if (!shouldExist) continue;
            const actualExpectation = artifactExpectation(actual);
            if (!sameValue(actualExpectation, artifact)) throw new TypeError(`Story memory readback has stale fields for artifact ${id}.`);
        }
    }
    if (expected.collectionId) {
        const collection = memory.collections?.[expected.collectionId];
        if (!collection) throw new TypeError(`Story memory readback lost collection ${expected.collectionId}.`);
        if (expected.label !== undefined && collection.label !== expected.label) throw new TypeError(`Story memory readback has the wrong label for ${expected.collectionId}.`);
        if (expected.kind !== undefined && collection.kind !== expected.kind) throw new TypeError(`Story memory readback has the wrong kind for ${expected.collectionId}.`);
        if (expected.memberIds && !sameValue(collection.memberIds, expected.memberIds)) throw new TypeError(`Story memory readback has the wrong membership for ${expected.collectionId}.`);
    }
    if (expected.addedArtifactIds && expected.addedArtifactIds.some((id) => !memory.artifacts?.[id])) throw new TypeError('Story memory readback did not contain every hydrated artifact.');
    return memory;
}

export function createStoryMemoryController(dependencies = {}) {
    const sourceDependencies = dependencies || {};
    const deps = {
        ...sourceDependencies,
        readMemory: sourceDependencies.readMemory || sourceDependencies.readStoryMemory,
        hydrateGallery: sourceDependencies.hydrateGallery || sourceDependencies.galleryHydrator,
        persistMemory: sourceDependencies.persistMemory || sourceDependencies.persist,
        readbackMemory: sourceDependencies.readbackMemory || sourceDependencies.readback,
        continuePlanner: sourceDependencies.continuePlanner || sourceDependencies.dispatchContinuePlanner || sourceDependencies.dispatchContinue,
    };
    let state = projectState({
        status: 'idle',
        message: 'Load story memory to see scene moments.',
        error: null,
        chatId: null,
        memory: emptyMemory(),
        filters: {},
        timeline: [],
        collections: [],
        selectedArtifactId: null,
        continuePreview: null,
        stagedContinuation: null,
        lastOperation: null,
        epoch: 0,
    });
    const listeners = new Set();
    let continueStageSequence = 0;
    const createContinueStageToken = (identity) => {
        continueStageSequence += 1;
        const supplied = typeof deps.createContinueStageToken === 'function'
            ? text(deps.createContinueStageToken({ artifactId: identity?.artifactId, artifactVersion: identity?.artifactVersion, sequence: continueStageSequence }))
            : '';
        const suffix = `${Date.now().toString(36)}-${continueStageSequence}`;
        return `${supplied || 'continue-stage'}:${suffix}`;
    };
    const update = (patch = {}) => {
        state = projectState({ ...state, ...clone(patch) });
        listeners.forEach((listener) => listener(stateSnapshot(state)));
        return stateSnapshot(state);
    };
    const failure = (error, operation = null) => update({ status: 'error', error: error?.message || String(error), message: 'Story memory action was blocked; no unverified change was accepted.', lastOperation: operation });

    async function load({ chatId, gallery = [] } = {}) {
        const targetChatId = chatId ?? state.chatId ?? null;
        const targetEpoch = state.epoch + 1;
        state = { ...state, chatId: targetChatId, epoch: targetEpoch, status: 'loading', error: null, message: 'Loading story memory…', filters: { ...state.filters, ...(targetChatId ? { chatId: targetChatId } : {}) }, continuePreview: null, stagedContinuation: null };
        const missing = requiredDependencies(deps, REQUIRED_LOAD_DEPENDENCIES);
        if (missing) return failure(new Error(dependencyError(missing)), 'load');
        try {
            const read = await deps.readMemory({ chatId: targetChatId, gallery: clone(gallery), schema: STORY_MEMORY_SCHEMA, uiVersion: STORY_MEMORY_UI_VERSION });
            const base = createStoryMemory(responseMemory(read) || {}, { chatId: targetChatId });
            const hydrated = await deps.hydrateGallery({ memory: base, gallery: responseGallery(read, gallery), chatId: targetChatId, schema: STORY_MEMORY_SCHEMA, uiVersion: STORY_MEMORY_UI_VERSION });
            const hydratedMemory = responseMemory(hydrated);
            const hydratedGallery = responseGallery(hydrated, responseGallery(read, gallery));
            const memory = createStoryMemory(hydratedMemory || base, { gallery: hydratedGallery, chatId: targetChatId });
            const normalizedBase = createStoryMemory(base, { chatId: targetChatId });
            const normalizedMemory = createStoryMemory(memory, { chatId: targetChatId });
            const delta = memoryDelta(normalizedBase, normalizedMemory);
            const expected = { operation: 'hydrate-gallery', chatId: targetChatId, ...delta };
            const confirmed = await persistAndReadback(normalizedMemory, { operation: 'hydrate-gallery', expected, delta, chatId: targetChatId, epoch: targetEpoch }, { chatId: targetChatId, epoch: targetEpoch });
            if (confirmed.stale || state.epoch !== targetEpoch) return confirmed;
            return update({ ...confirmed, status: 'ready', message: Object.keys(normalizedMemory.artifacts).length ? 'Story memory loaded.' : 'No scene moments have been saved yet.', error: null, chatId: targetChatId, lastOperation: 'load' });
        } catch (error) {
            if (state.epoch !== targetEpoch) return stateSnapshot({ ...state, stale: true });
            return failure(error, 'load');
        }
    }

    function setFilters(patch = {}, options = {}) {
        const replace = options === true || options?.replace === true;
        const next = replace ? clone(patch) : { ...state.filters, ...clone(patch) };
        return update({ filters: normalizeFilters(next), status: state.status === 'error' ? 'ready' : state.status, error: null });
    }

    function setSelectedArtifact(artifactId) {
        const identity = artifactId ? identityFor(state.memory, artifactId) : null;
        if (artifactId && !identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), 'select-details');
        const details = identity ? {
            [identity.artifactId]: {
                generation: getGenerationDetails(state.memory, identity.artifactId),
                provenance: getStoryArtifactProvenance(state.memory, identity.artifactId),
                reproduction: buildReproductionInput(state.memory, identity.artifactId),
            },
        } : {};
        return update({ selectedArtifactId: identity?.artifactId || null, details: { ...(state.details || {}), ...details }, error: null });
    }

    async function persistAndReadback(nextMemory, request, context = {}) {
        const memory = createStoryMemory(nextMemory);
        const targetChatId = context.chatId ?? request.chatId ?? state.chatId;
        const targetEpoch = context.epoch ?? request.epoch ?? state.epoch;
        const envelope = {
            memory,
            operation: request.operation,
            schema: STORY_MEMORY_SCHEMA,
            uiVersion: STORY_MEMORY_UI_VERSION,
            chatId: targetChatId,
            epoch: targetEpoch,
            artifactId: request.artifactId ?? null,
            artifactVersion: request.artifactVersion ?? null,
            collectionId: request.collectionId ?? null,
            expected: clone(request.expected || {}),
            delta: clone(request.delta || null),
        };
        const persistedResult = await deps.persistMemory(envelope);
        // Persistence seams may deliberately compact raw media metadata. Use
        // the seam's canonical saved artifact values for exact readback
        // expectations, while retaining the operation identity and deltas.
        const persistedMemory = responseMemory(persistedResult);
        if (isRecord(persistedMemory) && isRecord(persistedMemory.artifacts)) {
            for (const bucket of ['added', 'changed']) {
                for (const artifactId of Object.keys(envelope.expected?.expectedArtifacts?.[bucket] || {})) {
                    if (persistedMemory.artifacts[artifactId]) envelope.expected.expectedArtifacts[bucket][artifactId] = clone(persistedMemory.artifacts[artifactId]);
                }
            }
        }
        const { memory: _persistedMemory, ...readbackRequest } = envelope;
        readbackRequest.compareReadback = (readbackMemory) => compareStoryMemoryReadback(readbackMemory, envelope.expected);
        readbackRequest.readbackComparator = readbackRequest.compareReadback;
        const readback = await deps.readbackMemory(readbackRequest);
        const confirmed = validateReadback(createStoryMemory(responseMemory(readback) || {}), envelope);
        compareStoryMemoryReadback(confirmed, envelope.expected);
        if (targetEpoch !== state.epoch) return stateSnapshot({ ...state, stale: true });
        return update({ status: 'ready', memory: confirmed, error: null, message: 'Story memory saved and confirmed.', lastOperation: request.operation });
    }

    async function mutateArtifact(artifactId, operation, mutate) {
        const identity = identityFor(state.memory, artifactId);
        const target = { chatId: state.chatId, epoch: state.epoch };
        if (!identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), operation);
        const missing = requiredDependencies(deps, ['persistMemory', 'readbackMemory']);
        if (missing) return failure(new Error(dependencyError(missing)), operation);
        try {
            const next = mutate(state.memory);
            const expected = { operation, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion };
            if (operation === 'toggle-favorite') expected.favorite = next.artifacts[identity.artifactId].favorite === true;
            return await persistAndReadback(next, { operation, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, expected }, target);
        } catch (error) { return failure(error, operation); }
    }

    async function toggleFavorite(artifactId, favorite) {
        return mutateArtifact(artifactId, 'toggle-favorite', (memory) => toggleStoryFavorite(memory, artifactId, favorite));
    }

    async function createCollection({ collectionId, kind = 'moment', label } = {}) {
        const id = text(collectionId);
        if (!id) return failure(new Error('A collection ID is required.'), 'create-collection');
        const missing = requiredDependencies(deps, ['persistMemory', 'readbackMemory']);
        if (missing) return failure(new Error(dependencyError(missing)), 'create-collection');
        try {
            const next = createStoryCollection(state.memory, { collectionId: id, kind, label });
            const collection = next.collections[id];
            const expected = { operation: 'create-collection', collectionId: id, label: collection.label, kind: collection.kind };
            return await persistAndReadback(next, { operation: 'create-collection', collectionId: id, expected }, { chatId: state.chatId, epoch: state.epoch });
        }
        catch (error) { return failure(error, 'create-collection'); }
    }

    async function collectionMember(operation, collectionId, artifactId) {
        const id = text(collectionId);
        const identity = identityFor(state.memory, artifactId);
        if (!id || !identity) return failure(new Error('A valid collection and story artifact are required.'), operation);
        const missing = requiredDependencies(deps, ['persistMemory', 'readbackMemory']);
        if (missing) return failure(new Error(dependencyError(missing)), operation);
        try {
            const next = operation === 'add-member'
                ? addStoryCollectionMember(state.memory, { collectionId: id, artifactId: identity.artifactId })
                : removeStoryCollectionMember(state.memory, id, identity.artifactId);
            const expected = { operation, collectionId: id, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, memberIds: clone(next.collections[id]?.memberIds || []) };
            return await persistAndReadback(next, { operation, collectionId: id, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, expected }, { chatId: state.chatId, epoch: state.epoch });
        } catch (error) { return failure(error, operation); }
    }

    function previewContext(identity) {
        const context = typeof deps.getContinuePreviewContext === 'function'
            ? deps.getContinuePreviewContext({ artifact: clone(identity.artifact), artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, chatId: state.chatId, epoch: state.epoch })
            : {};
        return isRecord(context) ? context : {};
    }

    function openContinuePreview(artifactId) {
        const identity = identityFor(state.memory, artifactId);
        if (!identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), 'continue-preview');
        const context = previewContext(identity);
        return update({
            continuePreview: {
                artifactId: identity.artifactId,
                artifactVersion: identity.artifactVersion,
                chatId: state.chatId,
                epoch: state.epoch,
                selectedImage: { artifactId: identity.artifactId, url: identity.artifact.url, mimeType: identity.artifact.mimeType || null },
                sourceMoment: { sender: text(identity.artifact.sourceMoment?.sender || identity.artifact.sourceMoment?.name), passage: text(identity.artifact.sourceMoment?.passage || identity.artifact.generation?.sourcePassage || identity.artifact.prompt).slice(0, 320) },
                title: text(identity.artifact.title || identity.artifact.generation?.effectivePrompt || identity.artifact.prompt).slice(0, 160),
                identityLabel: text(context.identityLabel || identity.artifact.sourceMoment?.sender || 'Current chat'),
                previousImageEnabled: context.previousImageEnabled === true,
                readiness: text(context.readiness || 'Readiness will be checked when you stage this scene.'),
            },
            status: state.status === 'error' ? 'ready' : state.status,
            error: null,
            message: 'Review this scene before staging it for the next wand.',
            lastOperation: 'continue-preview',
        });
    }

    function cancelContinuePreview() {
        return update({ continuePreview: null, error: null, message: 'Continue preview cancelled.', lastOperation: 'cancel-continue' });
    }

    async function enablePreviousImage() {
        if (typeof deps.enablePreviousImage !== 'function') return update({ status: 'ready', error: null, message: 'Turn on Use previous image in Settings before staging this scene.', lastOperation: 'enable-previous-image' });
        try {
            const result = await deps.enablePreviousImage({ chatId: state.chatId, epoch: state.epoch });
            const preview = state.continuePreview ? { ...state.continuePreview, previousImageEnabled: result?.previousImageEnabled !== false } : null;
            return update({ continuePreview: preview, status: 'ready', error: null, message: 'Use previous image is on. Review the scene, then choose Use for next wand.', lastOperation: 'enable-previous-image' });
        } catch (error) { return failure(error, 'enable-previous-image'); }
    }

    async function clearStagedContinuation(requestedStageToken = null) {
        const staged = state.stagedContinuation;
        const capturedTarget = { chatId: state.chatId, epoch: state.epoch, stageToken: text(requestedStageToken || staged?.stageToken) };
        if (!staged || !capturedTarget.stageToken || staged.stageToken !== capturedTarget.stageToken) {
            return stateSnapshot({ ...state, stale: true, message: 'This staged scene is no longer current and was kept.' });
        }
        try {
            const result = typeof deps.clearContinue === 'function'
                ? await deps.clearContinue(capturedTarget)
                : { status: 'cleared' };
            if (result?.stale === true || state.chatId !== capturedTarget.chatId || state.epoch !== capturedTarget.epoch || state.stagedContinuation?.stageToken !== capturedTarget.stageToken) {
                return stateSnapshot({ ...state, stale: true, message: 'This staged scene is no longer current and was kept.' });
            }
        } catch (error) { return failure(error, 'clear-continue'); }
        return update({ stagedContinuation: null, error: null, message: 'The staged scene was cleared. Story Memory was kept.', lastOperation: 'clear-continue' });
    }

    async function stageContinueFromScene(artifactId, options = {}) {
        const identity = identityFor(state.memory, artifactId);
        const capturedTarget = { chatId: state.chatId, epoch: state.epoch };
        const stageToken = text(options.stageToken) || createContinueStageToken(identity);
        if (!identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), 'continue-from-scene');
        if (typeof deps.continuePlanner !== 'function') return failure(new Error(dependencyError('continuePlanner')), 'continue-from-scene');
        try {
            if (typeof deps.canContinueFromScene === 'function') {
                const capability = await deps.canContinueFromScene({ artifact: clone(identity.artifact), artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, chatId: state.chatId, epoch: state.epoch });
                if (capability === false || (isRecord(capability) && capability.allowed !== true)) {
                    throw new Error(capability?.reason || 'The current image route cannot accept a prior scene image. Choose a model with image-reference support before continuing.');
                }
            }
            const plan = planContinueFromScene(state.memory, identity.artifactId, options);
            if (!plan || plan.sourceArtifactId !== identity.artifactId) throw new TypeError('Continue-from-scene plan is not bound to the selected artifact.');
            const requestId = text(options.requestId || (typeof deps.createRequestId === 'function' ? deps.createRequestId({ artifactId: identity.artifactId, artifactVersion: identity.artifactVersion }) : `continue:${identity.artifactId}:${identity.artifactVersion ?? 'unknown'}`));
            if (!requestId) throw new TypeError('Continue planner requestId is required.');
            const request = {
                action: 'continue-from-scene',
                plan,
                artifactId: identity.artifactId,
                artifactVersion: identity.artifactVersion,
                sourceArtifactId: identity.artifactId,
                sourceArtifactVersion: identity.artifactVersion,
                requestId,
                stageToken,
                schema: STORY_MEMORY_SCHEMA,
                uiVersion: STORY_MEMORY_UI_VERSION,
                chatId: state.chatId,
                epoch: state.epoch,
            };
            const result = await deps.continuePlanner(request);
            if (!isRecord(result)) throw new TypeError('Continue planner returned no result.');
            if (state.chatId !== capturedTarget.chatId || state.epoch !== capturedTarget.epoch) return stateSnapshot({ ...state, stale: true });
            // Preserve an explicit null version: null is the valid identity
            // for migrated media without a durable version, while `??` would
            // turn it into undefined and reject an otherwise exact receipt.
            const receiptId = result.artifactId !== undefined ? result.artifactId : result.sourceArtifactId;
            const receiptVersion = result.artifactVersion !== undefined ? result.artifactVersion : result.sourceArtifactVersion;
            const authorityToken = text(result.authorityToken);
            if (!authorityToken && receiptId !== identity.artifactId) throw new TypeError('Continue planner receipt is not bound to the selected artifact.');
            if (!authorityToken && receiptVersion !== identity.artifactVersion) throw new TypeError('Continue planner receipt has a different artifact version.');
            if (!authorityToken && result.requestId !== requestId) throw new TypeError('Continue planner receipt is missing the exact requestId or authority token.');
            if (authorityToken && receiptId !== undefined && receiptId !== identity.artifactId) throw new TypeError('Continue planner authority receipt has a different artifact ID.');
            if (authorityToken && receiptVersion !== undefined && receiptVersion !== identity.artifactVersion) throw new TypeError('Continue planner authority receipt has a different artifact version.');
            if (result.requestId !== undefined && result.requestId !== requestId) throw new TypeError('Continue planner receipt has a different requestId.');
            if (authorityToken) {
                if (typeof deps.verifyContinueAuthority !== 'function') throw new TypeError('Continue planner authority receipt requires verification.');
                const verified = await deps.verifyContinueAuthority({ request, receipt: result });
                if (verified?.verified !== true || verified.artifactId !== identity.artifactId || verified.artifactVersion !== identity.artifactVersion || verified.requestId !== requestId) throw new TypeError('Continue planner authority receipt is not bound to the exact request.');
            }
            return update({ status: result.status || 'ready', error: null, message: 'Scene staged for the next wand. Story Memory was kept.', lastOperation: 'continue-from-scene', lastPlan: clone(plan), lastPlannerResult: clone(result), continuePreview: null, stagedContinuation: { artifactId: identity.artifactId, artifactVersion: identity.artifactVersion, stageToken, chatId: capturedTarget.chatId, epoch: capturedTarget.epoch, selectedImage: clone(plan.selectedImage) } });
        } catch (error) { return failure(error, 'continue-from-scene'); }
    }

    async function continueFromScene(artifactId, options = {}) { return stageContinueFromScene(artifactId, options); }

    async function confirmContinuePreview() {
        const preview = state.continuePreview;
        if (!preview) return failure(new Error('Open a scene preview before staging it.'), 'confirm-continue');
        if (preview.chatId !== state.chatId || preview.epoch !== state.epoch) return failure(new Error('This scene preview is stale. Open it again from the current chat.'), 'confirm-continue');
        const identity = identityFor(state.memory, preview.artifactId);
        if (!identity || identity.artifactVersion !== preview.artifactVersion) return failure(new Error('This scene preview is stale. Open it again from the current chat.'), 'confirm-continue');
        const context = previewContext(identity);
        if (context.previousImageEnabled !== true) return update({ status: 'ready', error: null, message: 'Turn on Use previous image in Settings before staging this scene.', lastOperation: 'confirm-continue' });
        const result = await stageContinueFromScene(preview.artifactId, { ...clone(preview), stageToken: createContinueStageToken({ artifactId: preview.artifactId, artifactVersion: preview.artifactVersion }), ...(context.sceneScope ? { sceneScope: context.sceneScope } : {}) });
        return result;
    }

    return {
        getState: () => stateSnapshot(state),
        load,
        hydrate: load,
        setFilters,
        setSelectedArtifact,
        toggleFavorite,
        createCollection,
        addCollectionMember: (collectionId, artifactId) => collectionMember('add-member', collectionId, artifactId),
        removeCollectionMember: (collectionId, artifactId) => collectionMember('remove-member', collectionId, artifactId),
        getGenerationDetails: (artifactId) => getGenerationDetails(state.memory, artifactId),
        getProvenance: (artifactId) => getStoryArtifactProvenance(state.memory, artifactId),
        getReproductionInput: (artifactId, options) => buildReproductionInput(state.memory, artifactId, options),
        openContinuePreview,
        cancelContinuePreview,
        confirmContinuePreview,
        enablePreviousImage,
        clearStagedContinuation,
        continueFromScene,
        subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    };
}

function filterControl(name, label, value, type = 'text') {
    return `<label class="cig-rp-story-memory-filter">${escapeHtml(label)}<input type="${type}" name="${escapeHtml(name)}" value="${type === 'date' ? escapeHtml(value || '') : escapeHtml(value || '')}" style="min-height:44px" /></label>`;
}

function activeCollections(value) {
    return (Array.isArray(value) ? value : []).filter((collection) => collection?.kind !== 'outfit');
}

function collectionListItem(collection) {
    const id = escapeHtml(collection.id);
    const label = escapeHtml(collection.label || collection.id);
    const members = Array.isArray(collection.memberIds) ? collection.memberIds : [];
    if (collection.kind === 'outfit') {
        const historicalMembers = members.map((memberId) => `<span data-story-legacy-member="${escapeHtml(memberId)}">${escapeHtml(memberId)}</span>`).join('');
        return `<li data-story-legacy-collection="${id}"><span>${label}</span><small>Legacy outfit collection · read-only</small>${historicalMembers}</li>`;
    }
    const memberControls = members.map((memberId) => `<button type="button" data-story-action="remove-member" data-story-collection-id="${id}" data-story-artifact-id="${escapeHtml(memberId)}" style="min-height:44px">Remove ${escapeHtml(memberId)}</button>`).join('');
    return `<li><span>${label}</span><small>${escapeHtml(collection.kind || 'moment')}</small>${memberControls}</li>`;
}

function artifactCard(artifact, state) {
    const id = escapeHtml(artifact.id);
    const selected = state.selectedArtifactId === artifact.id;
    const details = state.details?.[artifact.id] || {
        generation: artifact.generation || {},
        provenance: artifact.provenance || {},
        reproduction: null,
    };
    const assignableCollections = activeCollections(state.collections);
    const collectionControl = assignableCollections.length
        ? `<label class="cig-rp-story-memory-collection-control">Add to collection<select data-story-collection-select="${id}" style="min-height:44px"><option value="">Choose a collection</option>${assignableCollections.map((collection) => `<option value="${escapeHtml(collection.id)}">${escapeHtml(collection.label || collection.id)}</option>`).join('')}</select><button type="button" data-story-action="add-member-from-card" data-story-artifact-id="${id}" style="min-height:44px">Add</button></label>`
        : '<small class="cig-rp-story-memory-collection-empty">Create a collection below to assign this moment.</small>';
    const preview = state.continuePreview?.artifactId === artifact.id ? state.continuePreview : null;
    const staged = state.stagedContinuation?.artifactId === artifact.id ? state.stagedContinuation : null;
    const referenceReceipt = details.generation?.referenceReceipt || details.provenance?.referenceReceipt || null;
    const receiptHtml = renderReferenceReceipt(referenceReceipt);
    const previewHtml = preview ? `<section class="cig-rp-story-memory-continue-preview" data-story-continue-preview="${id}" aria-label="Continue scene preview"><h4>Continue from this scene</h4><img src="${escapeHtml(preview.selectedImage?.url || artifact.url || '')}" alt="Selected story moment" loading="lazy" /><p><strong>Source:</strong> ${escapeHtml(preview.title || 'Selected story moment')}</p><p>${escapeHtml(preview.sourceMoment?.passage || 'Source moment unavailable')}</p><p><strong>Current chat:</strong> ${escapeHtml(preview.chatId || 'Unavailable')} · <strong>Identity:</strong> ${escapeHtml(preview.identityLabel || 'Current chat')}</p><p><strong>Readiness:</strong> ${escapeHtml(preview.readiness || 'Will be checked when staged.')}</p>${preview.previousImageEnabled ? '<p>One prior image will be used by the next wand generation.</p><button type="button" data-story-action="confirm-continue" data-story-artifact-id="' + id + '" style="min-height:44px">Use for next wand</button>' : '<p>One prior image will be used by the next wand generation.</p><p role="status">Turn on Use previous image in Settings to continue.</p><button type="button" data-story-action="enable-previous-image" data-story-artifact-id="' + id + '" style="min-height:44px">Turn on Use previous image</button>'}<button type="button" data-story-action="cancel-continue" data-story-artifact-id="${id}" style="min-height:44px">Cancel</button></section>` : staged ? `<section class="cig-rp-story-memory-continue-staged" data-story-continue-staged="${id}" role="status"><p>Staged for the next wand. Only this selected image will be used. Story Memory was kept.</p><button type="button" data-story-action="clear-continue" data-story-artifact-id="${id}" data-story-stage-token="${escapeHtml(staged.stageToken || '')}" style="min-height:44px">Clear staged scene</button></section>` : '';
    return `<article class="cig-rp-story-memory-card" data-story-artifact-id="${id}"><div class="cig-rp-story-memory-media">${artifact.url ? `<img src="${escapeHtml(artifact.url)}" alt="Story moment from ${escapeHtml(artifact.sourceMoment?.sender || 'chat')}" loading="lazy" />` : '<div role="img" aria-label="No image available">No image available</div>'}</div><div class="cig-rp-story-memory-card-body"><p class="cig-rp-story-memory-source"><strong>Source moment</strong><br />${escapeHtml(artifact.sourceMoment?.passage || artifact.generation?.sourcePassage || 'Source moment unavailable')}</p><p class="cig-rp-story-memory-meta">${escapeHtml(artifact.chatId || 'chat unavailable')} · message ${escapeHtml(artifact.messageId ?? 'unknown')}</p><div class="cig-rp-story-memory-actions"><button type="button" data-story-action="toggle-favorite" data-story-artifact-id="${id}" data-story-favorite="${artifact.favorite ? 'false' : 'true'}" style="min-height:44px" aria-pressed="${artifact.favorite ? 'true' : 'false'}">${artifact.favorite ? 'Remove favorite' : 'Favorite'}</button><button type="button" data-story-action="continue-from-scene" data-story-artifact-id="${id}" style="min-height:44px">Continue from scene</button><button type="button" data-story-action="select-details" data-story-artifact-id="${id}" style="min-height:44px" aria-expanded="${selected ? 'true' : 'false'}">${selected ? 'Hide details' : 'Details'}</button></div>${previewHtml}${collectionControl}${selected ? `<div class="cig-rp-story-memory-details"><h4>Generation details</h4><pre>${json(details.generation)}</pre>${receiptHtml}<h4>Provenance</h4><pre>${json(details.provenance)}</pre><h4>Reproduction input</h4><pre>${json(details.reproduction || { artifactId: artifact.id })}</pre></div>` : ''}</div></article>`;
}

export function renderStoryMemorySurface(input = {}) {
    const state = { status: 'idle', message: '', error: null, filters: {}, timeline: [], collections: [], ...clone(input) };
    const favorite = state.filters.favorite;
    const timeline = Array.isArray(state.timeline) ? state.timeline : [];
    const empty = state.status === 'error' ? '' : timeline.length ? '' : `<div class="cig-rp-story-memory-empty" role="status">${Object.keys(state.filters || {}).length ? 'No story moments match these filters.' : 'No story moments saved yet.'}</div>`;
    const collections = (state.collections || []).map(collectionListItem).join('');
    return `<section data-cig-rp-story-memory-surface data-story-memory-status="${escapeHtml(state.status)}" aria-busy="${state.status === 'loading' ? 'true' : 'false'}"><header><h2>Story memory</h2><p role="status" aria-live="polite">${escapeHtml(state.message || '')}</p>${state.error ? `<div role="alert">${escapeHtml(state.error)}</div>` : ''}</header><form data-story-form="filters" class="cig-rp-story-memory-filters" aria-label="Search and filter story memory">${filterControl('prompt', 'Search prompt or passage', state.filters.prompt || '')}${filterControl('characterId', 'Character', state.filters.characterId || '')}${filterControl('taskId', 'Task', state.filters.taskId || '')}${filterControl('model', 'Model', state.filters.model || '')}${filterControl('from', 'From', state.filters.from || '', 'date')}${filterControl('to', 'To', state.filters.to || '', 'date')}<label class="cig-rp-story-memory-filter">Favorite<select name="favorite" style="min-height:44px"><option value=""${favorite === undefined ? ' selected' : ''}>Any</option><option value="true"${favorite === true ? ' selected' : ''}>Favorites</option><option value="false"${favorite === false ? ' selected' : ''}>Not favorites</option></select></label><button type="submit" data-story-action="apply-filters" style="min-height:44px">Apply filters</button><button type="button" data-story-action="clear-filters" style="min-height:44px">Clear filters</button></form><div class="cig-rp-story-memory-layout"><main aria-label="Story timeline"><h3>Timeline</h3>${empty}<div class="cig-rp-story-memory-timeline">${timeline.map((artifact) => artifactCard(artifact, state)).join('')}</div></main><aside aria-label="Story collections"><h3>Collections</h3><form data-story-form="create-collection"><label>Collection name<input name="collectionId" required style="min-height:44px" /></label><label>Kind<select name="kind" style="min-height:44px"><option value="moment">Moment</option><option value="canon-look">Canon look</option><option value="location">Location</option></select></label><button type="submit" data-story-action="create-collection" style="min-height:44px">Create collection</button></form><ul>${collections || '<li>No collections yet.</li>'}</ul><form data-story-form="add-member"><label>Collection ID<input name="collectionId" required style="min-height:44px" /></label><label>Artifact ID<input name="artifactId" required style="min-height:44px" /></label><button type="submit" data-story-action="add-member" style="min-height:44px">Add to collection</button></form></aside></div></section>`;
}

export function mountStoryMemorySurface(host, controller, options = {}) {
    if (!host || typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') throw new TypeError('A story memory host element is required.');
    if (!controller || typeof controller.getState !== 'function') throw new TypeError('A story memory controller is required.');
    const read = (selector, fallback = '') => host.querySelector?.(selector)?.value ?? fallback;
    let filterDraft = clone(controller.getState().filters || {});
    const render = ({ syncDraft = true } = {}) => {
        if (syncDraft) filterDraft = clone(controller.getState().filters || {});
        host.innerHTML = renderStoryMemorySurface(controller.getState());
        return host.innerHTML;
    };
    const styleDocument = options.documentLike || globalThis.document;
    let ownedStyle = null;
    if (options.installStyles === true) {
        const before = styleDocument?.getElementById?.(STORY_MEMORY_STYLE_ID);
        const style = installStoryMemoryStyles(styleDocument);
        const ownership = STYLE_OWNERS.get(styleDocument);
        if (style && (!before || (ownership?.style === style && ownership.owners > 0))) {
            if (ownership) ownership.owners += 1;
            ownedStyle = style;
        }
    }
    const click = (event) => {
        const target = closest(event.target, '[data-story-action]');
        if (!target) return;
        event.preventDefault?.();
        const action = target.getAttribute?.('data-story-action');
        const artifactId = target.getAttribute?.('data-story-artifact-id');
        if (action === 'toggle-favorite') void controller.toggleFavorite(artifactId, target.getAttribute('data-story-favorite') === 'true').then(render);
        else if (action === 'continue-from-scene') { controller.openContinuePreview?.(artifactId); render(); }
        else if (action === 'confirm-continue') void controller.confirmContinuePreview?.().then(render);
        else if (action === 'cancel-continue') { controller.cancelContinuePreview?.(); render(); }
        else if (action === 'enable-previous-image') void controller.enablePreviousImage?.().then(render);
        else if (action === 'clear-continue') void controller.clearStagedContinuation?.(target.getAttribute('data-story-stage-token')).then(render);
        else if (action === 'add-member-from-card') {
            const select = target.closest('[data-story-artifact-id]')?.querySelector?.('[data-story-collection-select]');
            const collectionId = select?.getAttribute?.('data-story-collection-select') === artifactId ? select.value : '';
            if (collectionId) void controller.addCollectionMember(collectionId, artifactId).then(render);
        }
        else if (action === 'remove-member') void controller.removeCollectionMember(target.getAttribute('data-story-collection-id'), artifactId).then(render);
        else if (action === 'select-details') { controller.getState().selectedArtifactId === artifactId ? controller.setSelectedArtifact?.(null) : controller.setSelectedArtifact?.(artifactId); render(); }
        else if (action === 'clear-filters') { filterDraft = {}; controller.setFilters({}, { replace: true }); }
    };
    const input = (event) => {
        if (event.target?.closest?.('[data-story-form="filters"]')) filterDraft[event.target.name] = event.target.value;
    };
    const change = (event) => {
        if (event.target?.closest?.('[data-story-form="filters"]')) filterDraft[event.target.name] = event.target.value;
    };
    const submit = (event) => {
        const form = event.target?.closest?.('[data-story-form]');
        if (!form) return;
        event.preventDefault?.();
        if (form.getAttribute('data-story-form') === 'filters') { filterDraft = { prompt: read('[name="prompt"]', filterDraft.prompt), characterId: read('[name="characterId"]', filterDraft.characterId), taskId: read('[name="taskId"]', filterDraft.taskId), model: read('[name="model"]', filterDraft.model), from: read('[name="from"]', filterDraft.from), to: read('[name="to"]', filterDraft.to), favorite: read('[name="favorite"]', filterDraft.favorite) }; controller.setFilters(filterDraft, { replace: true }); }
        if (form.getAttribute('data-story-form') === 'create-collection') void controller.createCollection({ collectionId: read('[data-story-form="create-collection"] [name="collectionId"]'), kind: read('[data-story-form="create-collection"] [name="kind"]', 'moment'), label: read('[data-story-form="create-collection"] [name="collectionId"]') }).then(render);
        if (form.getAttribute('data-story-form') === 'add-member') void controller.addCollectionMember(read('[data-story-form="add-member"] [name="collectionId"]'), read('[data-story-form="add-member"] [name="artifactId"]')).then(render);
    };
    host.addEventListener('click', click);
    host.addEventListener('input', input);
    host.addEventListener('change', change);
    host.addEventListener('submit', submit);
    const unsubscribe = controller.subscribe(() => render());
    render();
    if (options.autoLoad !== false && typeof controller.load === 'function' && controller.getState().status === 'idle') void controller.load().then(render);
    let destroyed = false;
    return { render, destroy() { if (destroyed) return; destroyed = true; unsubscribe(); host.removeEventListener('click', click); host.removeEventListener('input', input); host.removeEventListener('change', change); host.removeEventListener('submit', submit); if (ownedStyle) { const ownership = STYLE_OWNERS.get(styleDocument); if (ownership?.style === ownedStyle) ownership.owners = Math.max(0, ownership.owners - 1); if (!ownership || ownership.owners === 0) uninstallStoryMemoryStyles(styleDocument); } } };
}

export function installStoryMemoryStyles(documentLike = globalThis.document) {
    if (!documentLike?.createElement || !documentLike?.head?.appendChild) return null;
    const existing = documentLike.getElementById?.(STORY_MEMORY_STYLE_ID);
    if (existing) return existing;
    const style = documentLike.createElement('style');
    style.id = STORY_MEMORY_STYLE_ID;
    style.textContent = STORY_MEMORY_SURFACE_CSS;
    documentLike.head.appendChild(style);
    STYLE_OWNERS.set(documentLike, { style, owners: 0 });
    return style;
}

export function uninstallStoryMemoryStyles(documentLike = globalThis.document) {
    const style = documentLike?.getElementById?.(STORY_MEMORY_STYLE_ID);
    const ownership = STYLE_OWNERS.get(documentLike);
    if (ownership?.owners > 0) return false;
    if (style?.remove) style.remove();
    else if (style?.parentNode?.removeChild) style.parentNode.removeChild(style);
    else if (style && typeof documentLike?.head?.removeChild === 'function') documentLike.head.removeChild(style);
    if (style && ownership?.style === style) STYLE_OWNERS.delete(documentLike);
    return !style;
}

export const STORY_MEMORY_SURFACE_CSS = `.cig-rp-story-memory-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:1rem}.cig-rp-story-memory-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.65rem;align-items:end}.cig-rp-story-memory-filters label,.cig-rp-story-memory-layout label{display:grid;gap:.25rem}.cig-rp-story-memory-timeline{display:grid;gap:.8rem}.cig-rp-story-memory-card{display:grid;grid-template-columns:minmax(120px,30%) minmax(0,1fr);gap:.8rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);padding:.8rem}.cig-rp-story-memory-media img,.cig-rp-story-memory-continue-preview img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}.cig-rp-story-memory-actions{display:flex;flex-wrap:wrap;gap:.5rem}.cig-rp-story-memory-actions button,.cig-rp-story-memory-filters button,.cig-rp-story-memory-layout button,.cig-rp-story-memory-continue-preview button,.cig-rp-story-memory-continue-staged button{min-height:44px;touch-action:manipulation}.cig-rp-story-memory-actions button:focus-visible,.cig-rp-story-memory-filters button:focus-visible,.cig-rp-story-memory-layout button:focus-visible,.cig-rp-story-memory-continue-preview button:focus-visible,.cig-rp-story-memory-continue-staged button:focus-visible{outline:2px solid currentColor;outline-offset:2px}.cig-rp-story-memory-continue-preview,.cig-rp-story-memory-continue-staged{border:1px solid color-mix(in srgb,currentColor 35%,transparent);padding:.75rem;margin-top:.75rem}.cig-rp-story-memory-continue-preview img{max-width:180px}.cig-rp-story-memory-details{overflow:auto}.cig-rp-story-memory-details pre{white-space:pre-wrap;overflow-wrap:anywhere}.cig-rp-story-memory-empty{padding:1rem;border:1px dashed currentColor}@media(max-width:700px){.cig-rp-story-memory-layout{grid-template-columns:1fr}.cig-rp-story-memory-card{grid-template-columns:1fr}.cig-rp-story-memory-filters{grid-template-columns:1fr}.cig-rp-story-memory-actions button{flex:1 1 100%}.cig-rp-story-memory-continue-preview img{max-width:100%}}`;

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

export const STORY_MEMORY_UI_VERSION = 'p4-story-memory-ui-v1';
export const STORY_MEMORY_STYLE_ID = `cig-rp-story-memory-style-${STORY_MEMORY_UI_VERSION}`;

const REQUIRED_LOAD_DEPENDENCIES = Object.freeze(['readMemory', 'hydrateGallery', 'persistMemory', 'readbackMemory']);

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
        lastOperation: null,
    });
    const listeners = new Set();
    const update = (patch = {}) => {
        state = projectState({ ...state, ...clone(patch) });
        listeners.forEach((listener) => listener(stateSnapshot(state)));
        return stateSnapshot(state);
    };
    const failure = (error, operation = null) => update({ status: 'error', error: error?.message || String(error), message: 'Story memory action was blocked; no unverified change was accepted.', lastOperation: operation });

    async function load({ chatId, gallery = [] } = {}) {
        const missing = requiredDependencies(deps, REQUIRED_LOAD_DEPENDENCIES);
        if (missing) return failure(new Error(dependencyError(missing)), 'load');
        try {
            const read = await deps.readMemory({ chatId: chatId ?? state.chatId, gallery: clone(gallery), schema: STORY_MEMORY_SCHEMA, uiVersion: STORY_MEMORY_UI_VERSION });
            const base = createStoryMemory(responseMemory(read) || {}, { chatId: chatId ?? state.chatId });
            const hydrated = await deps.hydrateGallery({ memory: base, gallery: responseGallery(read, gallery), chatId: chatId ?? state.chatId, schema: STORY_MEMORY_SCHEMA, uiVersion: STORY_MEMORY_UI_VERSION });
            const hydratedMemory = responseMemory(hydrated);
            const hydratedGallery = responseGallery(hydrated, responseGallery(read, gallery));
            const memory = createStoryMemory(hydratedMemory || base, { gallery: hydratedGallery, chatId: chatId ?? state.chatId });
            return update({ status: 'ready', message: Object.keys(memory.artifacts).length ? 'Story memory loaded.' : 'No scene moments have been saved yet.', error: null, chatId: chatId ?? state.chatId ?? null, memory, lastOperation: 'load' });
        } catch (error) {
            return failure(error, 'load');
        }
    }

    function setFilters(patch = {}) {
        const next = { ...state.filters, ...clone(patch) };
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

    async function persistAndReadback(nextMemory, request) {
        const memory = createStoryMemory(nextMemory);
        const envelope = {
            memory,
            operation: request.operation,
            schema: STORY_MEMORY_SCHEMA,
            uiVersion: STORY_MEMORY_UI_VERSION,
            chatId: state.chatId,
            artifactId: request.artifactId ?? null,
            artifactVersion: request.artifactVersion ?? null,
            collectionId: request.collectionId ?? null,
        };
        await deps.persistMemory(envelope);
        const { memory: _persistedMemory, ...readbackRequest } = envelope;
        const readback = await deps.readbackMemory(readbackRequest);
        const confirmed = validateReadback(createStoryMemory(responseMemory(readback) || {}), envelope);
        return update({ status: 'ready', memory: confirmed, error: null, message: 'Story memory saved and confirmed.', lastOperation: request.operation });
    }

    async function mutateArtifact(artifactId, operation, mutate) {
        const identity = identityFor(state.memory, artifactId);
        if (!identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), operation);
        const missing = requiredDependencies(deps, ['persistMemory', 'readbackMemory']);
        if (missing) return failure(new Error(dependencyError(missing)), operation);
        try {
            return await persistAndReadback(mutate(state.memory), { operation, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion });
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
        try { return await persistAndReadback(createStoryCollection(state.memory, { collectionId: id, kind, label }), { operation: 'create-collection', collectionId: id }); }
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
            return await persistAndReadback(next, { operation, collectionId: id, artifactId: identity.artifactId, artifactVersion: identity.artifactVersion });
        } catch (error) { return failure(error, operation); }
    }

    async function continueFromScene(artifactId, options = {}) {
        const identity = identityFor(state.memory, artifactId);
        if (!identity) return failure(new Error(`Unknown story artifact ${text(artifactId)}.`), 'continue-from-scene');
        if (typeof deps.continuePlanner !== 'function') return failure(new Error(dependencyError('continuePlanner')), 'continue-from-scene');
        try {
            const plan = planContinueFromScene(state.memory, identity.artifactId, options);
            if (!plan || plan.sourceArtifactId !== identity.artifactId) throw new TypeError('Continue-from-scene plan is not bound to the selected artifact.');
            const request = {
                action: 'continue-from-scene',
                plan,
                sourceArtifactId: identity.artifactId,
                sourceArtifactVersion: identity.artifactVersion,
                schema: STORY_MEMORY_SCHEMA,
                uiVersion: STORY_MEMORY_UI_VERSION,
                chatId: state.chatId,
            };
            const result = await deps.continuePlanner(request);
            if (!isRecord(result)) throw new TypeError('Continue planner returned no result.');
            if (result.sourceArtifactId !== undefined && result.sourceArtifactId !== identity.artifactId) throw new TypeError('Continue planner returned a different artifact ID.');
            if (result.sourceArtifactVersion !== undefined && result.sourceArtifactVersion !== identity.artifactVersion) throw new TypeError('Continue planner returned a different artifact version.');
            return update({ status: result.status || 'ready', error: null, message: 'Continue-from-scene plan prepared.', lastOperation: 'continue-from-scene', lastPlan: clone(plan), lastPlannerResult: clone(result) });
        } catch (error) { return failure(error, 'continue-from-scene'); }
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
        continueFromScene,
        subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    };
}

function filterControl(name, label, value, type = 'text') {
    return `<label class="cig-rp-story-memory-filter">${escapeHtml(label)}<input type="${type}" name="${escapeHtml(name)}" value="${type === 'date' ? escapeHtml(value || '') : escapeHtml(value || '')}" style="min-height:44px" /></label>`;
}

function artifactCard(artifact, state) {
    const id = escapeHtml(artifact.id);
    const selected = state.selectedArtifactId === artifact.id;
    const details = state.details?.[artifact.id] || {
        generation: artifact.generation || {},
        provenance: artifact.provenance || {},
        reproduction: null,
    };
    return `<article class="cig-rp-story-memory-card" data-story-artifact-id="${id}"><div class="cig-rp-story-memory-media">${artifact.url ? `<img src="${escapeHtml(artifact.url)}" alt="Story moment from ${escapeHtml(artifact.sourceMoment?.sender || 'chat')}" loading="lazy" />` : '<div role="img" aria-label="No image available">No image available</div>'}</div><div class="cig-rp-story-memory-card-body"><p class="cig-rp-story-memory-source"><strong>Source moment</strong><br />${escapeHtml(artifact.sourceMoment?.passage || artifact.generation?.sourcePassage || 'Source moment unavailable')}</p><p class="cig-rp-story-memory-meta">${escapeHtml(artifact.chatId || 'chat unavailable')} · message ${escapeHtml(artifact.messageId ?? 'unknown')}</p><div class="cig-rp-story-memory-actions"><button type="button" data-story-action="toggle-favorite" data-story-artifact-id="${id}" data-story-favorite="${artifact.favorite ? 'false' : 'true'}" style="min-height:44px" aria-pressed="${artifact.favorite ? 'true' : 'false'}">${artifact.favorite ? 'Remove favorite' : 'Favorite'}</button><button type="button" data-story-action="continue-from-scene" data-story-artifact-id="${id}" style="min-height:44px">Continue from scene</button><button type="button" data-story-action="select-details" data-story-artifact-id="${id}" style="min-height:44px" aria-expanded="${selected ? 'true' : 'false'}">${selected ? 'Hide details' : 'Details'}</button></div>${selected ? `<div class="cig-rp-story-memory-details"><h4>Generation details</h4><pre>${json(details.generation)}</pre><h4>Provenance</h4><pre>${json(details.provenance)}</pre><h4>Reproduction input</h4><pre>${json(details.reproduction || { artifactId: artifact.id })}</pre></div>` : ''}</div></article>`;
}

export function renderStoryMemorySurface(input = {}) {
    const state = { status: 'idle', message: '', error: null, filters: {}, timeline: [], collections: [], ...clone(input) };
    const favorite = state.filters.favorite;
    const timeline = Array.isArray(state.timeline) ? state.timeline : [];
    const empty = state.status === 'error' ? '' : timeline.length ? '' : `<div class="cig-rp-story-memory-empty" role="status">${Object.keys(state.filters || {}).length ? 'No story moments match these filters.' : 'No story moments saved yet.'}</div>`;
    const collections = (state.collections || []).map((collection) => `<li><span>${escapeHtml(collection.label || collection.id)}</span><small>${escapeHtml(collection.kind || 'moment')}</small>${(collection.memberIds || []).map((id) => `<button type="button" data-story-action="remove-member" data-story-collection-id="${escapeHtml(collection.id)}" data-story-artifact-id="${escapeHtml(id)}" style="min-height:44px">Remove ${escapeHtml(id)}</button>`).join('')}</li>`).join('');
    return `<section data-cig-rp-story-memory-surface data-story-memory-status="${escapeHtml(state.status)}" aria-busy="${state.status === 'loading' ? 'true' : 'false'}"><header><h2>Story memory</h2><p role="status" aria-live="polite">${escapeHtml(state.message || '')}</p>${state.error ? `<div role="alert">${escapeHtml(state.error)}</div>` : ''}</header><form data-story-form="filters" class="cig-rp-story-memory-filters" aria-label="Search and filter story memory">${filterControl('prompt', 'Search prompt or passage', state.filters.prompt || '')}${filterControl('characterId', 'Character', state.filters.characterId || '')}${filterControl('model', 'Model', state.filters.model || '')}${filterControl('from', 'From', state.filters.from || '', 'date')}${filterControl('to', 'To', state.filters.to || '', 'date')}<label class="cig-rp-story-memory-filter">Favorite<select name="favorite" style="min-height:44px"><option value=""${favorite === undefined ? ' selected' : ''}>Any</option><option value="true"${favorite === true ? ' selected' : ''}>Favorites</option><option value="false"${favorite === false ? ' selected' : ''}>Not favorites</option></select></label><button type="submit" data-story-action="apply-filters" style="min-height:44px">Apply filters</button><button type="button" data-story-action="clear-filters" style="min-height:44px">Clear filters</button></form><div class="cig-rp-story-memory-layout"><main aria-label="Story timeline"><h3>Timeline</h3>${empty}<div class="cig-rp-story-memory-timeline">${timeline.map((artifact) => artifactCard(artifact, state)).join('')}</div></main><aside aria-label="Story collections"><h3>Collections</h3><form data-story-form="create-collection"><label>Collection name<input name="collectionId" required style="min-height:44px" /></label><label>Kind<select name="kind" style="min-height:44px"><option value="moment">Moment</option><option value="canon-look">Canon look</option><option value="location">Location</option><option value="outfit">Outfit</option></select></label><button type="submit" data-story-action="create-collection" style="min-height:44px">Create collection</button></form><ul>${collections || '<li>No collections yet.</li>'}</ul><form data-story-form="add-member"><label>Collection ID<input name="collectionId" required style="min-height:44px" /></label><label>Artifact ID<input name="artifactId" required style="min-height:44px" /></label><button type="submit" data-story-action="add-member" style="min-height:44px">Add to collection</button></form></aside></div></section>`;
}

export function mountStoryMemorySurface(host, controller) {
    if (!host || typeof host.addEventListener !== 'function' || typeof host.removeEventListener !== 'function') throw new TypeError('A story memory host element is required.');
    if (!controller || typeof controller.getState !== 'function') throw new TypeError('A story memory controller is required.');
    const read = (selector, fallback = '') => host.querySelector?.(selector)?.value ?? fallback;
    const render = () => { host.innerHTML = renderStoryMemorySurface(controller.getState()); return host.innerHTML; };
    const click = (event) => {
        const target = closest(event.target, '[data-story-action]');
        if (!target) return;
        event.preventDefault?.();
        const action = target.getAttribute?.('data-story-action');
        const artifactId = target.getAttribute?.('data-story-artifact-id');
        if (action === 'toggle-favorite') void controller.toggleFavorite(artifactId, target.getAttribute('data-story-favorite') === 'true').then(render);
        else if (action === 'continue-from-scene') void controller.continueFromScene(artifactId).then(render);
        else if (action === 'remove-member') void controller.removeCollectionMember(target.getAttribute('data-story-collection-id'), artifactId).then(render);
        else if (action === 'select-details') { controller.getState().selectedArtifactId === artifactId ? controller.setSelectedArtifact?.(null) : controller.setSelectedArtifact?.(artifactId); render(); }
        else if (action === 'clear-filters') { controller.setFilters({}); render(); }
    };
    const input = (event) => {
        if (event.target?.closest?.('[data-story-form="filters"]')) controller.setFilters({ [event.target.name]: event.target.value });
        render();
    };
    const submit = (event) => {
        const form = event.target?.closest?.('[data-story-form]');
        if (!form) return;
        event.preventDefault?.();
        if (form.getAttribute('data-story-form') === 'filters') { controller.setFilters({ prompt: read('[name="prompt"]'), characterId: read('[name="characterId"]'), model: read('[name="model"]'), from: read('[name="from"]'), to: read('[name="to"]'), favorite: read('[name="favorite"]') }); render(); }
        if (form.getAttribute('data-story-form') === 'create-collection') void controller.createCollection({ collectionId: read('[data-story-form="create-collection"] [name="collectionId"]'), kind: read('[data-story-form="create-collection"] [name="kind"]', 'moment'), label: read('[data-story-form="create-collection"] [name="collectionId"]') }).then(render);
        if (form.getAttribute('data-story-form') === 'add-member') void controller.addCollectionMember(read('[data-story-form="add-member"] [name="collectionId"]'), read('[data-story-form="add-member"] [name="artifactId"]')).then(render);
    };
    host.addEventListener('click', click);
    host.addEventListener('input', input);
    host.addEventListener('submit', submit);
    const unsubscribe = controller.subscribe(() => render());
    render();
    if (typeof controller.load === 'function' && controller.getState().status === 'idle') void controller.load().then(render);
    return { render, destroy() { unsubscribe(); host.removeEventListener('click', click); host.removeEventListener('input', input); host.removeEventListener('submit', submit); } };
}

export function installStoryMemoryStyles(documentLike = globalThis.document) {
    if (!documentLike?.createElement || !documentLike?.head?.appendChild) return null;
    const existing = documentLike.getElementById?.(STORY_MEMORY_STYLE_ID);
    if (existing) return existing;
    const style = documentLike.createElement('style');
    style.id = STORY_MEMORY_STYLE_ID;
    style.textContent = STORY_MEMORY_SURFACE_CSS;
    documentLike.head.appendChild(style);
    return style;
}

export function uninstallStoryMemoryStyles(documentLike = globalThis.document) {
    const style = documentLike?.getElementById?.(STORY_MEMORY_STYLE_ID);
    if (style?.remove) style.remove();
    else if (style?.parentNode?.removeChild) style.parentNode.removeChild(style);
    else if (style && typeof documentLike?.head?.removeChild === 'function') documentLike.head.removeChild(style);
    return !style;
}

export const STORY_MEMORY_SURFACE_CSS = `.cig-rp-story-memory-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:1rem}.cig-rp-story-memory-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.65rem;align-items:end}.cig-rp-story-memory-filters label,.cig-rp-story-memory-layout label{display:grid;gap:.25rem}.cig-rp-story-memory-timeline{display:grid;gap:.8rem}.cig-rp-story-memory-card{display:grid;grid-template-columns:minmax(120px,30%) minmax(0,1fr);gap:.8rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);padding:.8rem}.cig-rp-story-memory-media img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}.cig-rp-story-memory-actions{display:flex;flex-wrap:wrap;gap:.5rem}.cig-rp-story-memory-actions button,.cig-rp-story-memory-filters button,.cig-rp-story-memory-layout button{min-height:44px;touch-action:manipulation}.cig-rp-story-memory-actions button:focus-visible,.cig-rp-story-memory-filters button:focus-visible,.cig-rp-story-memory-layout button:focus-visible{outline:2px solid currentColor;outline-offset:2px}.cig-rp-story-memory-details{overflow:auto}.cig-rp-story-memory-details pre{white-space:pre-wrap;overflow-wrap:anywhere}.cig-rp-story-memory-empty{padding:1rem;border:1px dashed currentColor}@media(max-width:700px){.cig-rp-story-memory-layout{grid-template-columns:1fr}.cig-rp-story-memory-card{grid-template-columns:1fr}.cig-rp-story-memory-filters{grid-template-columns:1fr}.cig-rp-story-memory-actions button{flex:1 1 100%}}`;

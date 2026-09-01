import test from 'node:test';
import assert from 'node:assert/strict';

import {
    STORY_MEMORY_UI_VERSION,
    STORY_MEMORY_SURFACE_CSS,
    createStoryMemoryController,
    installStoryMemoryStyles,
    mountStoryMemorySurface,
    renderStoryMemorySurface,
    uninstallStoryMemoryStyles,
} from '../lib/rp/story-memory-ui.js';

function artifact({ id, messageId = 1, favorite = false, version = 1, characterId = 'ava', prompt = `scene ${id}` } = {}) {
    return {
        id,
        url: `/images/${id}.png`,
        chatId: 'chat-a',
        messageId,
        createdAt: `2026-08-${String(messageId).padStart(2, '0')}T10:00:00.000Z`,
        characterIds: [characterId],
        prompt,
        favorite,
        version,
        sourceMoment: { passage: `Ava at moment ${messageId}`, sender: 'Ava' },
        generation: {
            sourcePassage: `Ava at moment ${messageId}`,
            effectivePrompt: `effective ${prompt}`,
            references: [{ id: 'look:ava', role: 'active-look' }],
            model: 'image-model',
            settings: { aspectRatio: '16:9' },
        },
        provenance: { schema: 1, source: 'test', version },
        facts: [{ id: `fact-${id}`, text: 'accepted fact', version, sceneScope: 'scene-a' }],
    };
}

function memory() {
    return {
        schema: 2,
        artifacts: {
            'story:a': artifact({ id: 'story:a', messageId: 2, prompt: 'quiet station' }),
            'story:b': artifact({ id: 'story:b', messageId: 1, favorite: true, prompt: 'bright garden' }),
        },
        collections: {},
    };
}

function dependencies(overrides = {}) {
    const calls = { persist: [], readback: [], hydrate: [], continue: [] };
    let current = memory();
    const deps = {
        readMemory: async () => current,
        hydrateGallery: async ({ memory: value, gallery }) => {
            calls.hydrate.push({ memory: value, gallery });
            return { memory: value, gallery: gallery || [{ id: 'gallery-only', url: '/images/gallery-only.png', chatId: 'chat-a', messageId: 3 }] };
        },
        persistMemory: async (request) => {
            calls.persist.push(request);
            current = request.memory;
            return { status: 'saved', memory: request.memory };
        },
        readbackMemory: async (request) => {
            calls.readback.push(request);
            return { status: 'confirmed', memory: current };
        },
        continuePlanner: async (request) => {
            calls.continue.push(request);
            return { status: 'planned', artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId };
        },
        ...overrides,
    };
    return { deps, calls };
}

test('surface renders chat-ordered moments, compound filters, collections, provenance, and native 44px controls', () => {
    const html = renderStoryMemorySurface({
        status: 'ready',
        timeline: [artifact({ id: 'story:a', messageId: 2 })],
        collections: [{ id: 'fav', label: 'Favorites', kind: 'moment', memberIds: ['story:a'] }],
        filters: { prompt: 'station', characterId: 'ava', model: 'image-model', from: '2026-08-01', to: '2026-08-31', favorite: true },
        selectedArtifactId: 'story:a',
        details: { 'story:a': { generation: artifact({ id: 'story:a' }).generation, provenance: { schema: 1, source: 'test' }, reproduction: { artifactId: 'story:a' } } },
    });

    assert.match(html, /data-cig-rp-story-memory-surface/u);
    assert.match(html, /data-story-artifact-id="story:a"/u);
    assert.match(html, /Ava at moment 2/u);
    assert.match(html, /name="prompt"/u);
    assert.match(html, /name="characterId"/u);
    assert.match(html, /name="model"/u);
    assert.match(html, /name="from"/u);
    assert.match(html, /name="to"/u);
    assert.match(html, /name="favorite"/u);
    assert.match(html, /data-story-action="toggle-favorite"/u);
    assert.match(html, /data-story-action="continue-from-scene"/u);
    assert.match(html, /data-story-action="create-collection"/u);
    assert.match(html, /data-story-action="add-member"/u);
    assert.match(html, /data-story-action="remove-member"/u);
    assert.match(html, /Generation details/u);
    assert.match(html, /Provenance/u);
    assert.match(html, /Reproduction input/u);
    assert.match(html, /min-height:44px/u);
    assert.match(STORY_MEMORY_SURFACE_CSS, /@media/u);
});

test('controller hydrates Gallery through the injected seam and searches compound filters', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    const result = await controller.load({ chatId: 'chat-a', gallery: [{ id: 'gallery-only', url: '/images/gallery-only.png', chatId: 'chat-a', messageId: 3 }] });
    assert.equal(result.status, 'ready');
    assert.equal(calls.hydrate.length, 1);
    assert.equal(result.timeline.length, 3);
    const filtered = controller.setFilters({ prompt: 'garden', favorite: true });
    assert.deepEqual(filtered.timeline.map((entry) => entry.id), ['story:b']);
});

test('favorite and collection mutations persist exact IDs and read back before reporting success', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    const favorite = await controller.toggleFavorite('story:a', true);
    assert.equal(favorite.status, 'ready');
    assert.equal(calls.persist.at(-1).artifactId, 'story:a');
    assert.equal(calls.persist.at(-1).artifactVersion, 1);
    assert.equal(calls.readback.at(-1).artifactId, 'story:a');
    assert.equal(controller.getState().timeline.find((entry) => entry.id === 'story:a').favorite, true);

    await controller.createCollection({ collectionId: 'mood', kind: 'moment', label: 'Mood' });
    await controller.addCollectionMember('mood', 'story:a');
    const removed = await controller.removeCollectionMember('mood', 'story:a');
    assert.equal(removed.status, 'ready');
    assert.equal(calls.persist.at(-1).collectionId, 'mood');
    assert.equal(calls.persist.at(-1).artifactId, 'story:a');
});

test('details, reproduction, and continue action bind canonical artifact ID and version', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    assert.equal(controller.getGenerationDetails('story:a').model, 'image-model');
    assert.equal(controller.getProvenance('story:a').version, 1);
    assert.equal(controller.getReproductionInput('story:a').artifactId, 'story:a');
    const result = await controller.continueFromScene('story:a', { sceneScope: 'scene-a', at: '2026-08-02T12:00:00.000Z' });
    assert.equal(result.status, 'planned');
    assert.equal(calls.continue.at(-1).sourceArtifactId, 'story:a');
    assert.equal(calls.continue.at(-1).sourceArtifactVersion, 1);
    assert.equal(calls.continue.at(-1).plan.action, 'continue-from-scene');
});

test('controller fails closed when required persistence/readback or continue seams are unavailable', async () => {
    for (const missing of ['persistMemory', 'readbackMemory', 'hydrateGallery', 'continuePlanner']) {
        const { deps, calls } = dependencies({ [missing]: undefined });
        const controller = createStoryMemoryController(deps);
        const loaded = await controller.load({ chatId: 'chat-a' });
        if (missing === 'continuePlanner') {
            assert.equal(loaded.status, 'ready');
            const blocked = await controller.continueFromScene('story:a');
            assert.equal(blocked.status, 'error');
            assert.match(blocked.error, /continuePlanner/u);
        } else {
            assert.equal(loaded.status, 'error');
            const blocked = await controller.toggleFavorite('story:a', true);
            assert.equal(blocked.status, 'error');
            assert.equal(calls.persist.length, 0);
        }
    }
});

test('readback identity conflict is an error and never reports a successful mutation', async () => {
    const { deps } = dependencies({
        readbackMemory: async () => ({ memory: { schema: 2, artifacts: {}, collections: {} } }),
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    const result = await controller.toggleFavorite('story:a', true);
    assert.equal(result.status, 'error');
    assert.match(result.error, /story:a/u);
});

test('mount renders, delegates native events, and removes all listeners', async () => {
    const { deps } = dependencies();
    const controller = createStoryMemoryController(deps);
    const listeners = new Map();
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    };
    const mounted = mountStoryMemorySurface(host, controller);
    assert.match(host.innerHTML, /data-cig-rp-story-memory-surface/u);
    assert.equal(listeners.has('click'), true);
    assert.equal(listeners.has('input'), true);
    await controller.load({ chatId: 'chat-a' });
    mounted.destroy();
    assert.equal(listeners.size, 0);
});

test('stylesheet install and uninstall are idempotent and scoped', () => {
    const styles = [];
    const documentLike = {
        getElementById(id) { return styles.find((style) => style.id === id) || null; },
        createElement() { return { id: '', textContent: '', setAttribute() {} }; },
        head: { appendChild(style) { styles.push(style); }, removeChild(style) { const index = styles.indexOf(style); if (index >= 0) styles.splice(index, 1); } },
    };
    assert.equal(installStoryMemoryStyles(documentLike).id, `cig-rp-story-memory-style-${STORY_MEMORY_UI_VERSION}`);
    assert.equal(installStoryMemoryStyles(documentLike).id, styles[0].id);
    assert.equal(styles.length, 1);
    uninstallStoryMemoryStyles(documentLike);
    assert.equal(styles.length, 0);
});

test('Gallery hydration persists the exact migrated delta and confirms readback before ready', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    const loaded = await controller.load({ chatId: 'chat-a', gallery: [{ id: 'hydrate-me', url: '/images/hydrate-me.png', chatId: 'chat-a', messageId: 9 }] });
    assert.equal(loaded.status, 'ready');
    const persist = calls.persist.find((entry) => entry.operation === 'hydrate-gallery');
    assert.ok(persist);
    assert.deepEqual(persist.delta.addedArtifactIds, ['story:v1:6:chat-a:10:hydrate-me']);
    assert.equal(calls.readback.at(-1).operation, 'hydrate-gallery');
    assert.equal(calls.readback.at(-1).expected.addedArtifactIds[0], persist.delta.addedArtifactIds[0]);
});

test('every mutation sends an exact expected operation state to persistence and readback', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    await controller.toggleFavorite('story:a', true);
    assert.deepEqual(calls.persist.at(-1).expected, { operation: 'toggle-favorite', artifactId: 'story:a', artifactVersion: 1, favorite: true });
    await controller.createCollection({ collectionId: 'mood', kind: 'location', label: 'Mood' });
    assert.deepEqual(calls.persist.at(-1).expected, { operation: 'create-collection', collectionId: 'mood', label: 'Mood', kind: 'location' });
    await controller.addCollectionMember('mood', 'story:a');
    assert.deepEqual(calls.persist.at(-1).expected, { operation: 'add-member', collectionId: 'mood', artifactId: 'story:a', artifactVersion: 1, memberIds: ['story:a'] });
    await controller.removeCollectionMember('mood', 'story:a');
    assert.deepEqual(calls.readback.at(-1).expected, { operation: 'remove-member', collectionId: 'mood', artifactId: 'story:a', artifactVersion: 1, memberIds: [] });
});

test('stale favorite readback and missing continue receipt fail closed', async () => {
    const { deps } = dependencies({
        readbackMemory: async () => ({ memory: { ...memory(), artifacts: { ...memory().artifacts, 'story:a': artifact({ id: 'story:a', messageId: 2, favorite: false }) } } }),
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    const stale = await controller.toggleFavorite('story:a', true);
    assert.equal(stale.status, 'error');

    const receiptMissing = dependencies({ continuePlanner: async () => ({ status: 'planned' }) });
    const second = createStoryMemoryController(receiptMissing.deps);
    await second.load({ chatId: 'chat-a' });
    const blocked = await second.continueFromScene('story:a');
    assert.equal(blocked.status, 'error');
    assert.match(blocked.error, /receipt|requestId|artifact/u);

});

test('setFilters supports replacement so Clear filters removes the complete compound query', async () => {
    const { deps } = dependencies();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    controller.setFilters({ prompt: 'garden', favorite: true });
    const cleared = controller.setFilters({}, { replace: true });
    assert.deepEqual(cleared.filters, {});
    assert.equal(cleared.timeline.length, 2);
});

test('filter input keeps draft focus and does not replace the host until Apply', async () => {
    const { deps } = dependencies();
    const controller = createStoryMemoryController(deps);
    let renders = 0;
    const listeners = new Map();
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
        querySelector(selector) { return { value: selector.includes('prompt') ? 'draft' : '', checked: false }; },
    };
    const mounted = mountStoryMemorySurface(host, controller);
    const originalRender = mounted.render;
    mounted.render = () => { renders += 1; return originalRender(); };
    const before = host.innerHTML;
    listeners.get('input')({ target: { name: 'prompt', value: 'draft', closest: () => ({}) } });
    assert.equal(host.innerHTML, before);
    assert.equal(controller.getState().filters.prompt, undefined);
    mounted.destroy();
});

test('mount optionally owns stylesheet installation and removal', () => {
    const { deps } = dependencies();
    const styles = [];
    const documentLike = {
        getElementById(id) { return styles.find((style) => style.id === id) || null; },
        createElement() { return { id: '', textContent: '' }; },
        head: { appendChild(style) { styles.push(style); }, removeChild(style) { styles.splice(styles.indexOf(style), 1); } },
    };
    const controller = createStoryMemoryController(deps);
    const host = { innerHTML: '', addEventListener() {}, removeEventListener() {} };
    const mounted = mountStoryMemorySurface(host, controller, { documentLike, installStyles: true });
    assert.equal(styles.length, 1);
    mounted.destroy();
    assert.equal(styles.length, 0);
});

test('load binds the requested target chat to hydration persistence and readback', async () => {
    const { deps, calls } = dependencies();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-target' });
    assert.equal(calls.persist.at(-1).chatId, 'chat-target');
    assert.equal(calls.readback.at(-1).chatId, 'chat-target');
    assert.equal(controller.getState().chatId, 'chat-target');
});

test('hydration readback rejects stale changed fields and resurrected removals', async () => {
    const changed = dependencies({
        readbackMemory: async (request) => ({ memory: { ...request.memory, artifacts: { ...request.memory.artifacts, [request.expected.addedArtifactIds[0]]: { ...request.memory.artifacts[request.expected.addedArtifactIds[0]], url: '/images/wrong.png' } } } }),
    });
    const changedController = createStoryMemoryController(changed.deps);
    const changedResult = await changedController.load({ chatId: 'chat-a', gallery: [{ id: 'changed', url: '/images/changed.png', chatId: 'chat-a', messageId: 8 }] });
    assert.equal(changedResult.status, 'error');

    const removed = dependencies({
        hydrateGallery: async ({ memory: value }) => ({ memory: { ...value, artifacts: { 'story:a': value.artifacts['story:a'] }, collections: {} } }),
        readbackMemory: async (request) => ({ memory: { ...request.memory, artifacts: { ...request.memory.artifacts, 'story:b': artifact({ id: 'story:b', messageId: 1 }) } } }),
    });
    const removedController = createStoryMemoryController(removed.deps);
    const removedResult = await removedController.load({ chatId: 'chat-a' });
    assert.equal(removedResult.status, 'error');
});

test('authority-token Continue receipts require injected verification bound to exact identity and request', async () => {
    const plain = dependencies({ continuePlanner: async () => ({ status: 'planned', authorityToken: 'arbitrary' }) });
    const plainController = createStoryMemoryController(plain.deps);
    await plainController.load({ chatId: 'chat-a' });
    assert.equal((await plainController.continueFromScene('story:a')).status, 'error');

    const verified = dependencies({
        continuePlanner: async (request) => ({ status: 'planned', authorityToken: 'verified-token' }),
        verifyContinueAuthority: async ({ request, receipt }) => ({ verified: true, artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId, token: receipt.authorityToken }),
    });
    const verifiedController = createStoryMemoryController(verified.deps);
    await verifiedController.load({ chatId: 'chat-a' });
    assert.equal((await verifiedController.continueFromScene('story:a')).status, 'planned');
});

test('mounted stylesheet ownership is shared and never removes an external pre-existing style', () => {
    const { deps } = dependencies();
    const styles = [];
    const documentLike = {
        getElementById(id) { return styles.find((style) => style.id === id) || null; },
        createElement() { return { id: '', textContent: '' }; },
        head: { appendChild(style) { styles.push(style); }, removeChild(style) { styles.splice(styles.indexOf(style), 1); } },
    };
    const host = () => ({ innerHTML: '', addEventListener() {}, removeEventListener() {} });
    const first = mountStoryMemorySurface(host(), createStoryMemoryController(deps), { documentLike, installStyles: true });
    const second = mountStoryMemorySurface(host(), createStoryMemoryController(deps), { documentLike, installStyles: true });
    assert.equal(styles.length, 1);
    first.destroy();
    assert.equal(styles.length, 1);
    second.destroy();
    assert.equal(styles.length, 0);

    styles.push({ id: 'cig-rp-story-memory-style-p4-story-memory-ui-v1', textContent: 'external' });
    const external = mountStoryMemorySurface(host(), createStoryMemoryController(deps), { documentLike, installStyles: true });
    external.destroy();
    assert.equal(styles.length, 1);
});

test('hydration readback compares the full normalized artifact, including facts and provenance', async () => {
    const { deps } = dependencies({
        readbackMemory: async (request) => ({ memory: { ...request.memory, artifacts: { ...request.memory.artifacts, [request.expected.addedArtifactIds[0]]: { ...request.memory.artifacts[request.expected.addedArtifactIds[0]], facts: [{ id: 'stale-fact' }], provenance: { schema: 1, source: 'stale' } } } } }),
    });
    const controller = createStoryMemoryController(deps);
    const result = await controller.load({ chatId: 'chat-a', gallery: [{ id: 'full-check', url: '/images/full-check.png', chatId: 'chat-a', messageId: 11, facts: [{ id: 'accepted-fact' }], provenance: { schema: 1, source: 'expected' } }] });
    assert.equal(result.status, 'error');
    assert.match(result.error, /stale fields|artifact/u);
});

test('concurrent loads retain captured target chat and ignore stale completion state', async () => {
    const saved = [];
    const base = memory();
    const deps = {
        readMemory: async () => base,
        hydrateGallery: async ({ memory: value }) => ({ memory: value }),
        persistMemory: async (request) => { await new Promise((resolve) => setTimeout(resolve, request.chatId === 'chat-a' ? 25 : 0)); saved.push({ chatId: request.chatId, epoch: request.epoch }); },
        readbackMemory: async () => ({ memory: base }),
    };
    const controller = createStoryMemoryController(deps);
    const first = controller.load({ chatId: 'chat-a' });
    const second = controller.load({ chatId: 'chat-b' });
    await Promise.all([first, second]);
    assert.deepEqual(saved.map((entry) => entry.chatId).sort(), ['chat-a', 'chat-b']);
    assert.equal(saved.every((entry) => Number.isInteger(entry.epoch)), true);
    assert.equal(controller.getState().chatId, 'chat-b');
});

test('mount destroy is idempotent and does not remove a style while a second owner remains', () => {
    const { deps } = dependencies();
    const styles = [];
    const documentLike = {
        getElementById(id) { return styles.find((style) => style.id === id) || null; },
        createElement() { return { id: '', textContent: '' }; },
        head: { appendChild(style) { styles.push(style); }, removeChild(style) { styles.splice(styles.indexOf(style), 1); } },
    };
    const host = () => ({ innerHTML: '', addEventListener() {}, removeEventListener() {} });
    const first = mountStoryMemorySurface(host(), createStoryMemoryController(deps), { documentLike, installStyles: true });
    const second = mountStoryMemorySurface(host(), createStoryMemoryController(deps), { documentLike, installStyles: true });
    first.destroy();
    first.destroy();
    assert.equal(styles.length, 1);
    second.destroy();
    assert.equal(styles.length, 0);
});

test('Continue opens a provider-free preview with the selected image and explicit opt-in guidance', async () => {
    const { deps, calls } = dependencies({
        getContinuePreviewContext: () => ({ previousImageEnabled: false, identityLabel: 'Ava', readiness: 'Ready' }),
        continuePlanner: async () => { calls.continue.push('must-not-run'); },
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    const preview = controller.openContinuePreview('story:a');
    assert.equal(preview.status, 'ready');
    assert.equal(preview.continuePreview.artifactId, 'story:a');
    assert.equal(preview.continuePreview.chatId, 'chat-a');
    assert.equal(preview.continuePreview.previousImageEnabled, false);
    assert.equal(calls.continue.length, 0);
    const html = renderStoryMemorySurface(preview);
    assert.match(html, /Continue from this scene/u);
    assert.match(html, /One prior image will be used by the next wand generation/u);
    assert.match(html, /Turn on Use previous image/u);
    assert.match(html, /data-story-action="enable-previous-image"/u);
    assert.match(html, /data-story-action="cancel-continue"/u);
});

test('Continue confirmation stages only the exact selected artifact after the second explicit action', async () => {
    const { deps, calls } = dependencies({
        getContinuePreviewContext: () => ({ previousImageEnabled: true, identityLabel: 'Ava', readiness: 'Ready' }),
        continuePlanner: async (request) => { calls.continue.push(request); return { status: 'planned', artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId }; },
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    controller.openContinuePreview('story:a');
    assert.equal(calls.continue.length, 0);
    const cancelled = controller.cancelContinuePreview();
    assert.equal(cancelled.continuePreview, null);
    controller.openContinuePreview('story:a');
    const staged = await controller.confirmContinuePreview();
    assert.equal(staged.stagedContinuation.artifactId, 'story:a');
    assert.equal(calls.continue.length, 1);
    assert.equal(calls.continue[0].plan.selectedImage.artifactId, 'story:a');
    assert.equal(calls.continue[0].plan.selectedImage.url, '/images/story:a.png');
    assert.match(renderStoryMemorySurface(staged), /Staged for the next wand/u);
    assert.match(renderStoryMemorySurface(staged), /data-story-action="clear-continue"/u);
});

test('Continue confirmation remains blocked with previous image Off and can explicitly enable it without planning', async () => {
    const { deps, calls } = dependencies({
        getContinuePreviewContext: () => ({ previousImageEnabled: false, identityLabel: 'Ava', readiness: 'Ready' }),
        enablePreviousImage: async () => { calls.enable = (calls.enable || 0) + 1; },
        continuePlanner: async () => { calls.continue.push('must-not-run'); },
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    controller.openContinuePreview('story:a');
    const blocked = await controller.confirmContinuePreview();
    assert.equal(blocked.status, 'ready');
    assert.match(blocked.message, /Turn on Use previous image/u);
    assert.equal(calls.continue.length, 0);
    assert.equal(calls.enable, undefined);
    const enabled = await controller.enablePreviousImage();
    assert.equal(enabled.status, 'ready');
    assert.equal(calls.enable, 1);
});

test('Continue confirmation does not stage an old scene after the chat changes while planning', async () => {
    let release;
    const { deps, calls } = dependencies({
        getContinuePreviewContext: () => ({ previousImageEnabled: true, identityLabel: 'Ava', readiness: 'Ready' }),
        continuePlanner: async (request) => { calls.continue.push(request); await new Promise((resolve) => { release = resolve; }); return { status: 'planned', artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId }; },
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    controller.openContinuePreview('story:a');
    const pending = controller.confirmContinuePreview();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const switched = controller.load({ chatId: 'chat-b' });
    await switched;
    release();
    const result = await pending;
    assert.equal(result.stale, true);
    assert.equal(controller.getState().chatId, 'chat-b');
    assert.equal(controller.getState().stagedContinuation, null);
    assert.equal(calls.continue.length, 1);
});

test('same-artifact restaging receives a new nonce and stale clear cannot remove the newer stage', async () => {
    const { deps } = dependencies({
        getContinuePreviewContext: () => ({ previousImageEnabled: true, identityLabel: 'Ava', readiness: 'Ready' }),
    });
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });

    controller.openContinuePreview('story:a');
    const first = await controller.confirmContinuePreview();
    const firstToken = first.stagedContinuation.stageToken;
    assert.ok(firstToken);

    controller.openContinuePreview('story:a');
    const second = await controller.confirmContinuePreview();
    const secondToken = second.stagedContinuation.stageToken;
    assert.ok(secondToken);
    assert.notEqual(secondToken, firstToken);

    const stale = await controller.clearStagedContinuation(firstToken);
    assert.equal(stale.stale, true);
    assert.equal(controller.getState().stagedContinuation.stageToken, secondToken);
});

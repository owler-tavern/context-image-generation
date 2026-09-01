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
            return { status: 'planned', sourceArtifactId: request.sourceArtifactId, sourceArtifactVersion: request.sourceArtifactVersion };
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

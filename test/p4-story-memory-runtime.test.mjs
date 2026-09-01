import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    buildStoryMemoryFactSnapshot,
    compactStoryMemory,
    collectStoryMemoryMedia,
    createStoryMemoryRuntime,
    STORY_MEMORY_PERSISTENCE_LIMITS,
    STORY_MEMORY_SETTINGS_KEY,
} from '../lib/rp/story-memory-runtime.js';
import { createStoryMemoryController, renderStoryMemorySurface } from '../lib/rp/story-memory-ui.js';

const extensionName = 'context-image-generation';

function media(url, overrides = {}) {
    return {
        url,
        type: 'image',
        title: 'A quiet station',
        source: 'generated',
        cig_owner: extensionName,
        ...overrides,
    };
}

function chat() {
    return [
        { mes: 'An unrelated message.' },
        { name: 'Ava', mes: 'Ava enters the station.', send_date: 1722500000000, extra: { media: [media('/images/station.png', { id: 'media:station', cig_iteration_artifact: { artifactId: 'artifact:station', taskId: 'task-station', effectivePrompt: 'Ava at a quiet station', sourcePassage: { text: 'Ava enters the station.', userVisible: true }, references: [{ identityId: 'ava' }], model: { modelId: 'image-model' }, options: { aspectRatio: '16:9' } } })] } },
        { name: 'Ava', mes: 'Ava leaves.', send_date: 1722500100000, extra: { media: [media('/images/other.png', { id: 'media:other' })] } },
    ];
}

test('collects only current-chat CIG media with source moment and generation provenance', () => {
    const entries = collectStoryMemoryMedia({ chatId: 'chat-a', chat: chat(), gallery: [], extensionName });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].chatId, 'chat-a');
    assert.equal(entries[0].messageId, 1);
    assert.equal(entries[0].sourceMoment.passage, 'Ava enters the station.');
    assert.equal(entries[0].generation.model, 'image-model');
    assert.equal(entries[0].generation.effectivePrompt, 'Ava at a quiet station');
    assert.equal(entries[0].provenance.source, 'chat-media');
});

test('runtime hydrates inline media and retained Gallery without duplicating files', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} }, gallery: [{ id: 'gallery-station', url: '/images/station.png', chatId: 'chat-a', messageId: 1, prompt: 'Ava at a quiet station' }] };
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChat: () => chat(), getChatId: () => 'chat-a', saveSettings: async () => {}, fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }) });
    const read = await runtime.readMemory({ chatId: 'chat-a' });
    const hydrated = await runtime.hydrateGallery({ memory: read.memory, gallery: read.gallery, chatId: 'chat-a' });
    assert.equal(Object.keys(hydrated.memory.artifacts).length, 2);
    assert.equal(Object.values(hydrated.memory.artifacts).filter((entry) => entry.url === '/images/station.png').length, 1);
});

test('runtime persists exact chat and epoch, and readback returns the saved memory', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} } };
    const calls = [];
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChat: () => [], getChatId: () => 'chat-a', saveSettings: async () => { calls.push('save'); }, fetchImpl: async (url, request) => { calls.push({ url, request }); return { ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }; } });
    const memory = { schema: 2, artifacts: { 'story:v1:6:chat-a:1:x': { id: 'story:v1:6:chat-a:1:x', url: '/images/x.png', chatId: 'chat-a', messageId: 1, createdAt: 1722500000000, prompt: 'x', generation: {}, sourceMoment: {}, facts: [], favorite: true, provenance: { schema: 1, source: 'test', version: 1 } } }, collections: {} };
    await runtime.persistMemory({ memory, chatId: 'chat-a', epoch: 9, operation: 'toggle-favorite' });
    const readback = await runtime.readbackMemory({ chatId: 'chat-a', epoch: 9 });
    assert.equal(calls[0], 'save');
    assert.equal(calls[1].url, '/api/settings/get');
    assert.equal(calls[1].request.method, 'POST');
    assert.equal(readback.status, 'confirmed');
    assert.equal(readback.memory.artifacts['story:v1:6:chat-a:1:x'].favorite, true);
});

test('runtime blocks stale mutation after chat switch and never invokes a provider', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} } };
    let activeChat = 'chat-b';
    let saves = 0;
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChat: () => [], getChatId: () => activeChat, isCurrent: ({ chatId }) => chatId === activeChat, saveSettings: async () => { saves += 1; }, fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }) });
    await assert.rejects(() => runtime.persistMemory({ memory: { schema: 2, artifacts: {}, collections: {} }, chatId: 'chat-a', epoch: 1 }), /chat changed/i);
    assert.equal(saves, 0);
    assert.equal(typeof runtime.generate, 'undefined');
});

test('a current story memory reload clears an obsolete prior load error', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} } };
    let failRead = true;
    const deps = {
        readMemory: async () => {
            if (failRead) throw new Error('Story memory action was blocked because the chat changed.');
            return { memory: settings[STORY_MEMORY_SETTINGS_KEY], gallery: [] };
        },
        hydrateGallery: async ({ memory }) => ({ memory, gallery: [] }),
        persistMemory: async ({ memory }) => ({ memory }),
        readbackMemory: async () => ({ memory: settings[STORY_MEMORY_SETTINGS_KEY] }),
    };
    const controller = createStoryMemoryController(deps);
    const failed = await controller.load({ chatId: 'chat-a' });
    assert.equal(failed.status, 'error');
    assert.match(failed.error, /chat changed/i);
    failRead = false;
    const reloading = controller.load({ chatId: 'chat-a' });
    assert.equal(controller.getState().status, 'loading');
    assert.equal(controller.getState().error, null);
    const loaded = await reloading;
    assert.equal(loaded.status, 'ready');
    assert.equal(loaded.error, null);
});

test('Gallery-only current-chat media remains ready across hydration, persistence, and readback', async () => {
    const settings = {
        [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} },
        gallery: [{ id: 'gallery-only', url: '/images/gallery-only.png', chatId: 'chat-a', messageId: 7, prompt: 'A remembered station' }],
    };
    const runtime = createStoryMemoryRuntime({
        extensionName,
        settings,
        getChat: () => [],
        getChatId: () => 'chat-a',
        saveSettings: async () => {},
        fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }),
    });
    const controller = createStoryMemoryController(runtime);
    const loaded = await controller.load({ chatId: 'chat-a' });
    assert.equal(loaded.status, 'ready');
    assert.deepEqual(loaded.timeline.map((entry) => entry.url), ['/images/gallery-only.png']);
    assert.equal(loaded.memory.artifacts[loaded.timeline[0].id].sourceMoment, null);
});

test('mounted seam behavior searches, persists favorite/collection, and stages Continue without generation', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} }, gallery: [] };
    let providerCalls = 0;
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChat: () => chat(), getChatId: () => 'chat-a', saveSettings: async () => {}, fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }) });
    const controller = createStoryMemoryController({ ...runtime, canContinueFromScene: () => ({ allowed: true }), continuePlanner: async (request) => { providerCalls += 1; return { status: 'planned', artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId }; } });
    await controller.load({ chatId: 'chat-a' });
    const filtered = controller.setFilters({ characterId: 'ava', taskId: 'task-station' });
    assert.deepEqual(filtered.timeline.map((entry) => entry.url), ['/images/station.png']);
    const station = controller.getState().timeline.find((entry) => entry.url === '/images/station.png');
    const favorite = await controller.toggleFavorite(station.id, true);
    assert.equal(favorite.status, 'ready');
    await controller.createCollection({ collectionId: 'canon', kind: 'moment', label: 'Canon' });
    await controller.addCollectionMember('canon', station.id);
    const planned = await controller.continueFromScene(station.id);
    assert.equal(planned.status, 'planned');
    assert.equal(providerCalls, 1, 'Continue only stages an explicit planner action; it does not call a provider');
    assert.equal(settings[STORY_MEMORY_SETTINGS_KEY].artifacts[station.id].favorite, true);
    assert.deepEqual(settings[STORY_MEMORY_SETTINGS_KEY].collections.canon.memberIds, [station.id]);
});

test('production index imports and mounts the story memory surface in Images & Cast', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);
    assert.match(index, /story-memory-ui\.js/u);
    assert.match(index, /story-memory-runtime\.js/u);
    assert.match(index, /mountStoryMemorySurface/u);
    assert.match(index, /storyMemoryController/u);
    assert.match(settings, /Visual story memory/u);
    assert.match(settings, /cig_story_memory_surface/u);
});

test('production initializes the shared chat epoch before the first scoped story memory load', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /renderProviderDropdown\(\);[\s\S]*chatLifecycleEpoch\.advance\(\);[\s\S]*await loadSettings\(\)/u);
});

test('production story memory mount disables the unscoped auto-load before explicit chat-scoped load', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /mountStoryMemorySurface\(host, storyMemoryController, \{ installStyles: true, autoLoad: false \}\)/u);
    assert.match(index, /void storyMemoryController\.load\(\{ chatId: getContext\(\)\.chatId \}\)/u);
});

test('production story memory opener reveals host and extension drawers before selecting and focusing the entry', async () => {
    const [index, entry] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../lib/rp/story-memory-entry.js', import.meta.url), 'utf8'),
    ]);
    assert.match(index, /revealStoryMemoryEntry\(/u);
    assert.match(entry, /#rm_extensions_block/u);
    assert.match(entry, /#extensions-settings-button > \.drawer-toggle/u);
    assert.match(entry, /\.inline-drawer-content/u);
    assert.match(index, /activateTab: \(tab\) => activateSettingsTab\(tab\)/u);
    assert.match(index, /selectArtifact: \(targetMessageId\)/u);
    assert.match(index, /storyMemoryController\.setSelectedArtifact\(entry\.id\)/u);
    assert.match(entry, /scrollIntoView/u);
});

test('real P2 scene state becomes bounded valid story facts on CIG media', () => {
    const facts = buildStoryMemoryFactSnapshot({ schema: 1, sceneFacts: {
        cast: [{ identityId: 'ava', label: 'Ava', confidence: 'high' }],
        location: 'Quiet station',
        objects: [{ identityId: 'ava', value: 'silver key', confidence: 'medium' }],
    } });
    assert.ok(facts.length > 0);
    const entries = collectStoryMemoryMedia({ chatId: 'chat-a', extensionName, chat: [{ extra: { media: [media('/images/facts.png', { cig_story_memory_facts: facts })] } }] });
    assert.ok(entries[0].facts.length > 0);
    assert.match(entries[0].facts[0].text, /Ava|station|key/u);
    assert.equal(JSON.stringify(entries[0].facts).includes('provider'), false);
});

test('P3 iteration output keeps scene facts on saved media and story hydration', () => {
    const iterationOutput = {
        imageData: 'provider-bytes-never-persisted',
        __cigStoryMemoryFacts: buildStoryMemoryFactSnapshot({ sceneFacts: {
            cast: [{ identityId: 'ava', label: 'Ava', confidence: 'high' }],
            location: 'Quiet station',
        } }),
    };
    const entries = collectStoryMemoryMedia({
        chatId: 'chat-a',
        extensionName,
        chat: [{ extra: { media: [{
            url: '/images/iteration.png',
            cig_owner: extensionName,
            cig_iteration_artifact: { artifactId: 'artifact:iteration', taskId: 'task-iteration' },
            cig_story_memory_facts: iterationOutput.__cigStoryMemoryFacts,
        }] } }],
    });
    assert.equal(entries.length, 1);
    assert.ok(entries[0].facts.length > 0);
    assert.match(entries[0].facts.map((fact) => fact.text).join(' '), /Ava|station/u);
    assert.doesNotMatch(JSON.stringify(entries[0]), /provider-bytes-never-persisted/u);
});

test('stale persistence compensates a remote write after chat switches mid-save', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} } };
    const previous = JSON.parse(JSON.stringify(settings[STORY_MEMORY_SETTINGS_KEY]));
    let activeChat = 'chat-a';
    let release;
    let saves = 0;
    let backing;
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChatId: () => activeChat, isCurrent: ({ chatId }) => chatId === activeChat, saveSettings: async () => {
        saves += 1;
        if (saves === 1) {
            activeChat = 'chat-b';
            await new Promise((resolve) => { release = resolve; });
        }
        backing = JSON.parse(JSON.stringify(settings[STORY_MEMORY_SETTINGS_KEY]));
    }, fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: { [STORY_MEMORY_SETTINGS_KEY]: backing } } }; } }) });
    const pending = runtime.persistMemory({ chatId: 'chat-a', epoch: 1, memory: { schema: 2, artifacts: { x: { id: 'x', chatId: 'chat-a', url: '/images/x.png', favorite: true } }, collections: {} } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await assert.rejects(pending, /chat changed/i);
    assert.deepEqual(backing, previous);
    assert.equal(saves, 2);
});

test('story-memory persistence is bounded and strips unknown provider content', () => {
    const artifacts = Object.fromEntries(Array.from({ length: STORY_MEMORY_PERSISTENCE_LIMITS.maxArtifacts + 40 }, (_, index) => [`a-${index}`, {
        id: `a-${index}`, chatId: 'chat-a', url: `/images/${index}.png`, messageId: index, prompt: 'x'.repeat(5000), sourceMoment: { passage: 'y'.repeat(5000) }, providerMessages: 'secret'.repeat(1000), facts: [{ text: 'fact'.repeat(1000) }],
    }]));
    const compact = compactStoryMemory({ schema: 2, artifacts, collections: { huge: { id: 'huge', label: 'z'.repeat(1000), memberIds: Object.keys(artifacts) } } });
    assert.ok(Object.keys(compact.artifacts).length <= STORY_MEMORY_PERSISTENCE_LIMITS.maxArtifacts);
    assert.ok(Object.values(compact.artifacts).filter((entry) => entry.chatId === 'chat-a').length <= STORY_MEMORY_PERSISTENCE_LIMITS.maxArtifactsPerChat);
    assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= STORY_MEMORY_PERSISTENCE_LIMITS.maxBytes);
    assert.equal(JSON.stringify(compact).includes('providerMessages'), false);
});

test('Continue blocks before planning when the current route cannot accept image references', async () => {
    const { deps, calls } = (() => {
        const result = { calls: 0 };
        const memory = { schema: 2, artifacts: { x: { id: 'x', url: '/images/x.png', chatId: 'chat-a', messageId: 1, version: 1, facts: [], sourceMoment: {}, generation: {} } }, collections: {} };
        return { calls: result, deps: { readMemory: async () => memory, hydrateGallery: async ({ memory: value }) => ({ memory: value }), persistMemory: async () => ({ memory }), readbackMemory: async () => ({ memory }), canContinueFromScene: () => ({ allowed: false, reason: 'The current model cannot accept a prior image.' }), continuePlanner: async () => { result.calls += 1; return { status: 'planned', artifactId: 'x', artifactVersion: 1, requestId: 'x' }; } } };
    })();
    const controller = createStoryMemoryController(deps);
    await controller.load({ chatId: 'chat-a' });
    const result = await controller.continueFromScene('x');
    assert.equal(result.status, 'error');
    assert.match(result.error, /cannot accept a prior image/u);
    assert.equal(calls.calls, 0);
});

test('story cards expose named collection assignment controls', () => {
    const html = renderStoryMemorySurface({ status: 'ready', timeline: [{ id: 'x', url: '/images/x.png', chatId: 'chat-a', messageId: 1, sourceMoment: { passage: 'A moment' }, facts: [], generation: {} }], collections: [{ id: 'canon-id', label: 'Canon moments', kind: 'moment', memberIds: [] }] });
    assert.match(html, /data-story-action="add-member-from-card"/u);
    assert.match(html, /Canon moments/u);
    assert.doesNotMatch(html, />canon-id</u);
});

test('inline opener follows the active media index rather than the first CIG media', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /const activeMedia = activeMediaForMessage\(message\)/u);
    assert.match(index, /activeMedia\?\.item/u);
    assert.doesNotMatch(index, /message\?\.extra\?\.media\?\.find\(\(item\) => isCigOwnedMedia\(item\)\)/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    collectStoryMemoryMedia,
    createStoryMemoryRuntime,
    STORY_MEMORY_SETTINGS_KEY,
} from '../lib/rp/story-memory-runtime.js';
import { createStoryMemoryController } from '../lib/rp/story-memory-ui.js';

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

test('mounted seam behavior searches, persists favorite/collection, and stages Continue without generation', async () => {
    const settings = { [STORY_MEMORY_SETTINGS_KEY]: { schema: 2, artifacts: {}, collections: {} }, gallery: [] };
    let providerCalls = 0;
    const runtime = createStoryMemoryRuntime({ extensionName, settings, getChat: () => chat(), getChatId: () => 'chat-a', saveSettings: async () => {}, fetchImpl: async () => ({ ok: true, async json() { return { extension_settings: { [extensionName]: settings } }; } }) });
    const controller = createStoryMemoryController({ ...runtime, continuePlanner: async (request) => { providerCalls += 1; return { status: 'planned', artifactId: request.artifactId, artifactVersion: request.artifactVersion, requestId: request.requestId }; } });
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

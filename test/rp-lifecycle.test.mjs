import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAppearanceLifecycleController, createChatLifecycleEpoch } from '../lib/rp-lifecycle.js';
import * as lifecycleModule from '../lib/rp-lifecycle.js';

test('epoch changes invalidate a save even when the user switches away and back', () => {
    const lifecycle = createChatLifecycleEpoch();
    const captured = lifecycle.capture();
    lifecycle.advance();
    lifecycle.advance();
    assert.equal(lifecycle.isCurrent(captured), false);
    assert.equal(lifecycle.isCurrent(lifecycle.capture()), true);
});

test('chat replacement and creation each advance the epoch and hydrate the active chat without caching another chat', async () => {
    assert.equal(typeof lifecycleModule.createAppearanceLifecycleController, 'function');
    const handlers = new Map();
    const eventSource = { on(type, handler) { handlers.set(type, handler); } };
    const eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_CREATED: 'chat-created' };
    let active = { chatId: 'chat-a', chatMetadata: { contextImageGeneration: { schema: 1, bindings: { a: { activeLookId: 'look:a' } } } } };
    const renders = [];
    const lifecycle = createChatLifecycleEpoch();

    const controller = createAppearanceLifecycleController({
        eventSource,
        eventTypes,
        lifecycle,
        readActiveContext: async () => active,
        render: (view) => renders.push(view),
    });
    controller.bind();
    await handlers.get('chat-changed')();
    active = { chatId: 'chat-b', chatMetadata: { contextImageGeneration: { schema: 1, bindings: { b: { activeLookId: 'look:b' } } } } };
    await handlers.get('chat-created')();

    assert.deepEqual(renders.map(({ chatId, reason, epoch }) => ({ chatId, reason, epoch })), [
        { chatId: 'chat-a', reason: 'changed', epoch: 1 },
        { chatId: 'chat-b', reason: 'created', epoch: 2 },
    ]);
    assert.equal(renders[0].chatState.bindings.a.activeLookId, 'look:a');
    assert.equal(renders[1].chatState.bindings.b.activeLookId, 'look:b');
});

test('fresh chat hydration exposes absent metadata without writing it', async () => {
    const handlers = new Map();
    const renders = [];
    const chatMetadata = {};
    const controller = createAppearanceLifecycleController({
        eventSource: { on(type, handler) { handlers.set(type, handler); } },
        eventTypes: { CHAT_CHANGED: 'changed', CHAT_CREATED: 'created' },
        lifecycle: createChatLifecycleEpoch(),
        readActiveContext: async () => ({ chatId: 'fresh-chat', chatMetadata }),
        render: (view) => renders.push(view),
    });
    controller.bind();
    await handlers.get('created')();

    assert.equal(renders.length, 1);
    assert.equal(renders[0].chatId, 'fresh-chat');
    assert.equal(renders[0].chatState, undefined);
    assert.deepEqual(chatMetadata, {});
});

test('A to B to A invalidates slow hydration from the first A epoch', async () => {
    const handlers = new Map();
    const pending = [];
    let activeChatId = 'chat-a';
    const renders = [];
    const controller = createAppearanceLifecycleController({
        eventSource: { on(type, handler) { handlers.set(type, handler); } },
        eventTypes: { CHAT_CHANGED: 'changed', CHAT_CREATED: 'created' },
        lifecycle: createChatLifecycleEpoch(),
        readActiveContext: () => new Promise((resolve) => pending.push({ chatId: activeChatId, resolve })),
        render: (view) => renders.push(view),
    });
    controller.bind();

    const firstA = handlers.get('changed')();
    activeChatId = 'chat-b';
    const chatB = handlers.get('changed')();
    activeChatId = 'chat-a';
    const secondA = handlers.get('changed')();
    pending[2].resolve({ chatId: 'chat-a', chatMetadata: { contextImageGeneration: { schema: 1, bindings: { current: {} } } } });
    pending[0].resolve({ chatId: 'chat-a', chatMetadata: { contextImageGeneration: { schema: 1, bindings: { stale: {} } } } });
    pending[1].resolve({ chatId: 'chat-b', chatMetadata: { contextImageGeneration: { schema: 1, bindings: { stale: {} } } } });
    await Promise.all([firstA, chatB, secondA]);

    assert.equal(renders.length, 1);
    assert.equal(renders[0].epoch, 3);
    assert.ok(renders[0].chatState.bindings.current);
});

test('reload refresh hydrates the current chat without advancing its epoch', async () => {
    const renders = [];
    const lifecycle = createChatLifecycleEpoch();
    const controller = createAppearanceLifecycleController({
        eventSource: { on() {} },
        eventTypes: {},
        lifecycle,
        readActiveContext: async () => ({ chatId: 'reopened', chatMetadata: { contextImageGeneration: { schema: 1, bindings: {} } } }),
        render: (view) => renders.push(view),
    });
    await controller.refresh('reload');
    assert.equal(renders[0].chatId, 'reopened');
    assert.equal(renders[0].reason, 'reload');
    assert.equal(renders[0].epoch, 0);
});

test('settings runtime delegates Appearance hydration to the lifecycle controller', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /import \{[^}]*createAppearanceLifecycleController[^}]*createChatLifecycleEpoch[^}]*\} from '\.\/lib\/rp-lifecycle\.js';/);
    assert.match(index, /appearanceLifecycleController\.bind\(\)/);
    assert.match(index, /appearanceLifecycleController\.refresh\('reload'\)/);
});

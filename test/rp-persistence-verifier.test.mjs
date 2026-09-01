import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueLibraryMutation, readPersistedExtensionLibrary, verifyPersistedExtensionLibrary, verifyPersistedChatBinding, persistVerifiedChatMutation } from '../lib/rp/persistence-verifier.js';

test('library verification is three-state and checks exact revision', async () => {
    let method;
    const confirmed = await verifyPersistedExtensionLibrary({ expectedRevision: 'rev:1', fetchImpl: async (_url, options) => { method = options.method; return { ok: true, json: async () => ({ extension_settings: { 'context-image-generation': { rp_library: { revision: 'rev:1' } } } }) }; } });
    const absent = await verifyPersistedExtensionLibrary({ expectedRevision: 'rev:2', fetchImpl: async () => ({ ok: true, json: async () => ({ extension_settings: { 'context-image-generation': { rp_library: { revision: 'rev:1' } } } }) }) });
    const unknown = await verifyPersistedExtensionLibrary({ expectedRevision: 'rev:2', fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(method, 'POST');
    assert.equal(absent.status, 'confirmed-absent');
    assert.equal(unknown.status, 'indeterminate');
    const realShape = await verifyPersistedExtensionLibrary({ expectedRevision: 'rev:3', fetchImpl: async () => ({ ok: true, json: async () => ({ settings: JSON.stringify({ extension_settings: { 'context-image-generation': { rp_library: { revision: 'rev:3' } } } }) }) }) });
    assert.equal(realShape.status, 'confirmed');
});

test('chat verification checks the captured target binding and revision', async () => {
    const result = await verifyPersistedChatBinding({ target: { chatId: 'a', identityId: 'character:ava', expectedRevision: 'r1', activeLookId: 'look:1' }, fetchImpl: async () => ({ ok: true, json: async () => ({ chat_metadata: { contextImageGeneration: { revision: 'r1', bindings: { 'character:ava': { activeLookId: 'look:1' } } } } }) }) });
    assert.equal(result.status, 'confirmed');
});

test('chat verifier understands real single and group JSONL responses and exact request bodies', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => [{ chat_metadata: { contextImageGeneration: { revision: 'r', bindings: { who: { activeLookId: 'look' } } } } }] }; };
    assert.equal((await verifyPersistedChatBinding({ target: { chatId: 'c', identityId: 'who', expectedRevision: 'r', activeLookId: 'look', requestBody: { avatar_url: 'a.png', file_name: 'c' } }, fetchImpl })).status, 'confirmed');
    assert.equal((await verifyPersistedChatBinding({ target: { chatId: 'g', groupId: 'group', identityId: 'who', expectedRevision: 'r', activeLookId: 'look', requestBody: { id: 'g' } }, fetchImpl })).status, 'confirmed');
    assert.deepEqual(calls, [['/api/chats/get', { avatar_url: 'a.png', file_name: 'c' }], ['/api/chats/group/get', { id: 'g' }]]);
});

test('verified chat mutation reports confirmed absent and indeterminate distinctly without false success', async () => {
    const base = { schema: 1, bindings: {} };
    for (const status of ['confirmed', 'confirmed-absent', 'indeterminate']) {
        let current = base;
        let scheduled = false;
        const result = await persistVerifiedChatMutation({
            captured: { chatId: 'c', epoch: 1 }, isCurrent: () => true, getState: () => current, setState: (value) => { current = value; },
            nextState: { schema: 1, bindings: { who: { activeLookId: 'look', expectedAssetId: 'asset', isLocked: false, selectedAt: 1 } }, revision: 'r' },
            saveMetadata: async () => {}, verify: async () => ({ status }), scheduleReconcile: () => { scheduled = true; },
        });
        assert.equal(result.status, status);
        assert.equal(scheduled, status === 'indeterminate');
        if (status !== 'confirmed') assert.deepEqual(current, base);
    }
});

test('library mutations are serialized after failures', async () => {
    const events = [];
    const first = enqueueLibraryMutation(async () => { events.push('a'); throw new Error('no'); });
    const second = enqueueLibraryMutation(async () => events.push('b'));
    await assert.rejects(first);
    await second;
    assert.deepEqual(events, ['a', 'b']);
});

test('queued mutation can rebase from the latest authoritative server library', async () => {
    const result = await readPersistedExtensionLibrary({ fetchImpl: async () => ({ ok: true, json: async () => ({ settings: JSON.stringify({ extension_settings: { 'context-image-generation': { rp_library: { revision: 'latest', identities: {} } } } }) }) }) });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.library.revision, 'latest');
});

test('Remember Remember, Remember Delete, and migration Remember mutations serialize and rebase in order', async () => {
    const state = { revision: 0, events: [] };
    const mutate = (name) => enqueueLibraryMutation(async () => {
        const seen = state.revision;
        await Promise.resolve();
        state.events.push([name, seen]);
        state.revision = seen + 1;
    });
    await Promise.all([mutate('remember-1'), mutate('remember-2'), mutate('delete'), mutate('migration'), mutate('remember-3')]);
    assert.deepEqual(state.events, [['remember-1', 0], ['remember-2', 1], ['delete', 2], ['migration', 3], ['remember-3', 4]]);
});

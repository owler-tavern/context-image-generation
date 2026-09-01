import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueLibraryMutation, verifyPersistedExtensionLibrary, verifyPersistedChatBinding } from '../lib/rp/persistence-verifier.js';

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

test('library mutations are serialized after failures', async () => {
    const events = [];
    const first = enqueueLibraryMutation(async () => { events.push('a'); throw new Error('no'); });
    const second = enqueueLibraryMutation(async () => events.push('b'));
    await assert.rejects(first);
    await second;
    assert.deepEqual(events, ['a', 'b']);
});

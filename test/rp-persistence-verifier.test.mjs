import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueLibraryMutation, readPersistedExtensionLibrary, verifyPersistedExtensionLibrary, verifyPersistedChatBinding, verifyPersistedChatMediaLink, persistVerifiedChatMutation, verifyPersistedGalleryArtifact, verifyPersistedGalleryClear } from '../lib/rp/persistence-verifier.js';

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

test('Gallery clear verification requires both the exact library revision and empty persisted history', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ extension_settings: { 'context-image-generation': { rp_library: { revision: 'clear:1' }, gallery: [] } } }) });
    assert.equal((await verifyPersistedGalleryClear({ expectedRevision: 'clear:1', fetchImpl })).status, 'confirmed');
    assert.equal((await verifyPersistedGalleryClear({ expectedRevision: 'other', fetchImpl })).status, 'confirmed-absent');
});

test('Gallery artifact verification confirms the selected identity/look link and distinguishes absent read-back', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ extension_settings: { 'context-image-generation': {
        gallery: [{ url: '/selected.png', cig_identity_id: 'persona:sam', cig_look_id: 'look:selected' }],
    } } }) });
    assert.equal((await verifyPersistedGalleryArtifact({ artifactId: 'url:/selected.png', expectedIdentityId: 'persona:sam', expectedLookId: 'look:selected', fetchImpl })).status, 'confirmed');
    assert.equal((await verifyPersistedGalleryArtifact({ artifactId: 'url:/selected.png', expectedIdentityId: 'npc:guard', expectedLookId: 'look:selected', fetchImpl })).status, 'confirmed-absent');
});

test('chat verification checks the captured target binding and revision', async () => {
    const result = await verifyPersistedChatBinding({ target: { chatId: 'a', identityId: 'character:ava', expectedRevision: 'r1', activeLookId: 'look:1' }, fetchImpl: async () => ({ ok: true, json: async () => ({ chat_metadata: { contextImageGeneration: { revision: 'r1', bindings: { 'character:ava': { activeLookId: 'look:1' } } } } }) }) });
    assert.equal(result.status, 'confirmed');
});

test('chat verification confirms an explicit Stop when the captured binding is absent', async () => {
    const result = await verifyPersistedChatBinding({ target: { chatId: 'a', identityId: 'character:ava', expectedRevision: 'r2', activeLookId: null }, fetchImpl: async () => ({ ok: true, json: async () => ({ chat_metadata: { contextImageGeneration: { revision: 'r2', bindings: {} } } }) }) });
    assert.equal(result.status, 'confirmed');
});

test('chat media verification checks exact message and artifact identity/look link', async () => {
    const target = { messageId: 4, artifactId: 'message:4:url:/sam.png', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:sam', requestBody: { file_name: 'chat' } };
    const payload = [
        { chat_metadata: {} },
        ...Array.from({ length: 4 }, () => ({})),
        { extra: { media: [{ url: '/sam.png', cig_visible_canon: { artifactId: target.artifactId, identityId: target.identityId, lookId: target.lookId } }] } },
    ];
    const fetchImpl = async () => ({ ok: true, json: async () => payload });
    assert.equal((await verifyPersistedChatMediaLink({ target, fetchImpl })).status, 'confirmed');
    assert.equal((await verifyPersistedChatMediaLink({ target: { ...target, identityId: 'npc:guard' }, fetchImpl })).status, 'confirmed-absent');
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

test('thrown chat save is indeterminate, restores prior UI state, and schedules reconciliation', async () => {
    const base = { schema: 1, bindings: {} };
    let current = base;
    let scheduled = false;
    const result = await persistVerifiedChatMutation({ captured: { chatId: 'c' }, isCurrent: () => true, getState: () => current, setState: (value) => { current = value; }, nextState: { schema: 1, bindings: { who: {} } }, saveMetadata: async () => { throw new Error('offline'); }, verify: async () => ({ status: 'confirmed' }), scheduleReconcile: () => { scheduled = true; } });
    assert.equal(result.status, 'indeterminate');
    assert.deepEqual(current, base);
    assert.equal(scheduled, true);
});

test('chat rollback never writes old state into a switched chat or over a newer same-chat revision', async () => {
    const old = { revision: 'old' };
    const candidate = { revision: 'candidate' };
    let current = old;
    let targetCurrent = true;
    const switched = persistVerifiedChatMutation({ captured: {}, isCurrent: () => targetCurrent, getState: () => current, setState: (v) => { current = v; }, nextState: candidate, saveMetadata: async () => { targetCurrent = false; }, verify: async () => ({ status: 'confirmed' }) });
    assert.equal((await switched).status, 'stale');
    assert.equal(current, candidate);
    targetCurrent = true;
    current = old;
    const newer = { revision: 'newer' };
    const raced = persistVerifiedChatMutation({ captured: {}, isCurrent: () => true, getState: () => current, setState: (v) => { current = v; }, nextState: candidate, getRevision: (v) => v?.revision, saveMetadata: async () => { current = newer; }, verify: async () => ({ status: 'confirmed-absent' }) });
    assert.equal((await raced).status, 'confirmed-absent');
    assert.equal(current, newer);
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

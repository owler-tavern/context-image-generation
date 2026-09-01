import test from 'node:test';
import assert from 'node:assert/strict';
import { runStopUsingInChat, runGlobalLookDeletion, resumeGlobalLookDeletion } from '../lib/rp/appearance-removal.js';
import { getChatBinding, setChatBinding } from '../lib/rp/chat-canon.js';
import { materializeAppearanceAssets } from '../lib/rp/appearance-library.js';
import { resolveEffectiveLook } from '../lib/rp/canon-reference-resolver.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const url = `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`;

function library() {
    return { schema: 2, revision: 'r0', identities: { 'character:ava': { id: 'character:ava', label: 'Ava', looks: [{ id: 'look:one', assetId: 'asset:one', label: 'Canon' }] } }, assets: { 'asset:one': { id: 'asset:one', kind: 'appearance', url } }, operations: {} };
}

test('player Stop using action persists only the captured chat binding removal', async () => {
    const canon = setChatBinding(setChatBinding({}, 'character:ava', { activeLookId: 'look:one', expectedAssetId: 'asset:one', isLocked: true, selectedAt: 1 }), 'user:sam', { activeLookId: 'look:sam', expectedAssetId: 'asset:sam', isLocked: false, selectedAt: 2 });
    let persisted;
    const result = await runStopUsingInChat({ captured: { chatId: 'a', epoch: 1 }, identityId: 'character:ava', canon, io: { isCurrent: () => true, persistChat: async ({ candidate }) => { persisted = candidate; return { status: 'confirmed' }; }, uuid: () => uuid } });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.message, 'Stopped using this look in this chat.');
    assert.equal(getChatBinding(persisted, 'character:ava'), null);
    assert.ok(getChatBinding(persisted, 'user:sam'));
});

test('global player deletion verifies tombstone before deleting and final removal after', async () => {
    const events = [];
    let current = library();
    const io = {
        runExclusive: (fn) => fn(), readLibrary: async () => ({ status: 'confirmed', library: current }),
        saveLibrary: async (candidate) => { current = structuredClone(candidate); events.push(candidate.operations['delete:one'] ? 'stage' : 'final'); },
        verifyLibrary: async () => ({ status: 'confirmed' }), setLocalLibrary: (value) => { current = structuredClone(value); },
        deleteFile: async () => { events.push('delete'); return { deleted: true }; }, uuid: () => uuid,
    };
    const result = await runGlobalLookDeletion({ lookId: 'look:one', operationId: 'delete:one', io });
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(events, ['stage', 'delete', 'final']);
    assert.equal(current.identities['character:ava'].looks.length, 0);
    assert.equal(current.assets['asset:one'], undefined);
});

test('failed deletion remains immediately unavailable and reload resume treats recorded 404 as success', async () => {
    let current = library();
    const base = {
        runExclusive: (fn) => fn(), readLibrary: async () => ({ status: 'confirmed', library: current }),
        saveLibrary: async (candidate) => { current = structuredClone(candidate); }, verifyLibrary: async () => ({ status: 'confirmed' }),
        setLocalLibrary: (value) => { current = structuredClone(value); }, uuid: () => uuid,
    };
    const failed = await runGlobalLookDeletion({ lookId: 'look:one', operationId: 'delete:one', io: { ...base, deleteFile: async () => { throw new Error('offline'); } } });
    assert.equal(failed.status, 'retryable');
    assert.equal(materializeAppearanceAssets(current, []).assets['asset:one'], undefined);
    const resumed = await resumeGlobalLookDeletion({ operationId: 'delete:one', io: { ...base, deleteFile: async () => ({ deleted: true, reason: 'already-absent' }) } });
    assert.equal(resumed.status, 'confirmed');
    assert.equal(current.operations['delete:one'], undefined);
});

test('shared-file deletion tombstones only the selected look while another look remains usable', async () => {
    const current = library();
    current.identities['character:ava'].looks.push({ id: 'look:two', assetId: 'asset:one', label: 'Alternate' });
    current.operations['delete:one'] = { status: 'deleting', lookId: 'look:one', identityId: 'character:ava', assetId: 'asset:one', url: null, sharedReferenceCount: 1 };
    const first = resolveEffectiveLook({ library: current, chatState: setChatBinding({}, 'character:ava', { activeLookId: 'look:one', expectedAssetId: 'asset:one', isLocked: true, selectedAt: 1 }), identityId: 'character:ava' });
    const second = resolveEffectiveLook({ library: { ...current, identities: { 'character:ava': { ...current.identities['character:ava'], activeLookId: 'look:two' } } }, chatState: {}, identityId: 'character:ava' });
    assert.equal(first.reason, 'deleting');
    assert.equal(second.status, 'resolved');
});

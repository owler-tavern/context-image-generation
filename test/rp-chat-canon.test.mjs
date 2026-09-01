import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateChatCanon, setChatBinding, setChatLock, getChatBinding, selectLookForChat, chatCanonRevisionFingerprint, clearChatBinding } from '../lib/rp/chat-canon.js';

test('chat canon contains only schema and bindings', () => {
    const state = migrateChatCanon({ bindings: {} });
    assert.deepEqual(Object.keys(state).sort(), ['bindings', 'schema']);
    assert.equal(state.schema, 1);
});

test('binding and lock transitions are immutable and unlock preserves the selected look', () => {
    const input = { schema: 1, bindings: {}, harmless: { note: 'preserve' } };
    const bound = setChatBinding(input, 'character:ava', { activeLookId: 'look:one', expectedAssetId: 'asset:one', isLocked: true, selectedAt: 10 });
    const unlocked = setChatLock(bound, 'character:ava', false);
    assert.deepEqual(input.bindings, {});
    assert.equal(getChatBinding(unlocked, 'character:ava').activeLookId, 'look:one');
    assert.equal(getChatBinding(unlocked, 'character:ava').isLocked, false);
    assert.deepEqual(unlocked.harmless, { note: 'preserve' });
});

test('Stop using in this chat clears only the selected binding without mutating input', () => {
    const original = setChatBinding(setChatBinding({}, 'character:ava', { activeLookId: 'look:ava', expectedAssetId: 'asset:ava', isLocked: true, selectedAt: 1 }), 'user:sam', { activeLookId: 'look:sam', expectedAssetId: 'asset:sam', isLocked: false, selectedAt: 2 });
    const before = structuredClone(original);
    const stopped = clearChatBinding(original, 'character:ava');
    assert.equal(getChatBinding(stopped, 'character:ava'), null);
    assert.deepEqual(getChatBinding(stopped, 'user:sam'), before.bindings['user:sam']);
    assert.deepEqual(original, before);
});

test('future schemas are read-only and unsafe or oversized unknown fields are discarded', () => {
    assert.equal(migrateChatCanon({ schema: 2, bindings: {} }).status, 'unsupported-schema');
    const state = migrateChatCanon({ bindings: {}, fn: () => {}, huge: 'x'.repeat(9000), safe: ['ok'] });
    assert.equal('fn' in state, false);
    assert.equal('huge' in state, false);
    assert.deepEqual(state.safe, ['ok']);
    const total = migrateChatCanon({ bindings: {}, a: 'x'.repeat(5000), b: 'y'.repeat(5000) });
    assert.ok(JSON.stringify(total).length <= 8400);
});

test('using a different look protects a locked binding unless confirmed and rejects stale revisions', () => {
    const state = setChatBinding({}, 'character:ava', { activeLookId: 'look:a', expectedAssetId: 'asset:a', isLocked: true, selectedAt: 1 });
    assert.equal(selectLookForChat(state, 'character:ava', { activeLookId: 'look:b', expectedAssetId: 'asset:b', selectedAt: 2 }).status, 'confirmation-required');
    assert.equal(selectLookForChat(state, 'character:ava', { activeLookId: 'look:b', expectedAssetId: 'asset:b', selectedAt: 2, confirmed: true, expectedLookId: 'look:other' }).status, 'stale');
    const changed = selectLookForChat(state, 'character:ava', { activeLookId: 'look:b', expectedAssetId: 'asset:b', selectedAt: 2, confirmed: true, expectedLookId: 'look:a' });
    assert.equal(changed.status, 'selected');
    assert.equal(getChatBinding(changed.state, 'character:ava').activeLookId, 'look:b');
    assert.equal(getChatBinding(changed.state, 'character:ava').isLocked, true);
});

test('binding fingerprint changes across A to B to A revisions', () => {
    const a1 = { ...setChatBinding({}, 'character:ava', { activeLookId: 'look:a', expectedAssetId: 'asset:a', selectedAt: 1 }), revision: 'r1' };
    const b = { ...setChatBinding(a1, 'character:ava', { activeLookId: 'look:b', expectedAssetId: 'asset:b', selectedAt: 2 }), revision: 'r2' };
    const a2 = { ...setChatBinding(b, 'character:ava', { activeLookId: 'look:a', expectedAssetId: 'asset:a', selectedAt: 3 }), revision: 'r3' };
    assert.notEqual(chatCanonRevisionFingerprint(a1, 'character:ava'), chatCanonRevisionFingerprint(a2, 'character:ava'));
});

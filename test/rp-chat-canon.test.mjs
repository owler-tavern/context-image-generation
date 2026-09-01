import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateChatCanon, setChatBinding, setChatLock, getChatBinding, selectLookForChat } from '../lib/rp/chat-canon.js';

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

test('future schemas are read-only and unsafe or oversized unknown fields are discarded', () => {
    assert.equal(migrateChatCanon({ schema: 2, bindings: {} }).status, 'unsupported-schema');
    const state = migrateChatCanon({ bindings: {}, fn: () => {}, huge: 'x'.repeat(9000), safe: ['ok'] });
    assert.equal('fn' in state, false);
    assert.equal('huge' in state, false);
    assert.deepEqual(state.safe, ['ok']);
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

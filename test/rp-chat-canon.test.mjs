import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateChatCanon, setChatBinding, setChatLock, getChatBinding, selectLookForChat, chatCanonRevisionFingerprint, clearChatBinding, getChatAppearanceSource, getChatWandPreferences, setChatAppearanceSource, setChatWandPreferences, clearChatAppearanceSource, getChatIdentityPin, setChatIdentityPin, clearChatIdentityPin } from '../lib/rp/chat-canon.js';

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

test('chat canon stores bounded appearance source choices as stable identity data', () => {
    const original = { schema: 1, bindings: {}, appearanceSources: {
        'user:persona-a.png': { identityId: 'user:persona-a.png', sourceType: 'avatar', role: 'persona', sourceId: 'user:persona-a.png', selectedAt: 1 },
        unsafe: { identityId: 'user:persona-a.png', sourceType: 'description', sourceId: '/raw/path/should-drop' },
    } };
    const state = migrateChatCanon(original);
    assert.deepEqual(getChatAppearanceSource(state, 'user:persona-a.png'), {
        identityId: 'user:persona-a.png', sourceType: 'avatar', role: 'persona', sourceId: 'user:persona-a.png', selectedAt: 1,
    });
    assert.equal(getChatAppearanceSource(state, 'user:persona-b.png', 'persona'), null);
    const changed = setChatAppearanceSource(state, 'user:persona-b.png', { identityId: 'user:persona-b.png', sourceType: 'description', role: 'persona', sourceId: 'user:persona-b.png', selectedAt: 2 });
    assert.equal(getChatAppearanceSource(changed, 'user:persona-b.png', 'persona').sourceType, 'description');
    assert.equal('unsafe' in changed.appearanceSources, false);
    const cleared = clearChatAppearanceSource(changed, 'user:persona-a.png');
    assert.equal(getChatAppearanceSource(cleared, 'user:persona-b.png', 'persona').sourceType, 'description');
    assert.equal(getChatAppearanceSource(clearChatAppearanceSource(cleared, 'user:persona-b.png'), 'user:persona-b.png', 'persona'), null);
    assert.deepEqual(original.appearanceSources.unsafe.sourceId, '/raw/path/should-drop');
});

test('wand framing, continuity, and direction are isolated per chat and bounded', () => {
    const original = { schema: 1, bindings: {} };
    const changed = setChatWandPreferences(original, { framing: 'wide', continuity: 'strong', visualDirection: '  blue   hour '.repeat(120) });
    assert.deepEqual(getChatWandPreferences(original), null);
    assert.equal(getChatWandPreferences(changed).framing, 'wide');
    assert.equal(getChatWandPreferences(changed).continuity, 'strong');
    assert.ok(getChatWandPreferences(changed).visualDirection.length <= 1000);
    assert.equal(getChatWandPreferences(setChatWandPreferences({}, { framing: 'bad', continuity: 'bad' })).framing, 'auto');
});

test('Auto source preference is separate from deliberate identity pinning', () => {
    const auto = setChatAppearanceSource({}, 'user:persona-a', { sourceType: 'auto', sourceId: 'user:persona-a', role: 'persona' });
    assert.equal(getChatIdentityPin(auto, 'user:persona-a', 'persona'), null);
    const pinned = setChatIdentityPin(auto, 'user:persona-a', { sourceId: 'user:persona-a', role: 'persona' });
    assert.deepEqual(getChatIdentityPin(pinned, 'user:persona-a', 'persona'), { identityId: 'user:persona-a', sourceId: 'user:persona-a', role: 'persona' });
    const unpinned = clearChatIdentityPin(pinned, 'user:persona-a');
    assert.equal(getChatIdentityPin(unpinned, 'user:persona-a', 'persona'), null);
    assert.equal(getChatAppearanceSource(unpinned, 'user:persona-a', 'persona').sourceType, 'auto');
});

test('wand preferences retain a bounded staged cinematic shot without provider data', () => {
    const state = setChatWandPreferences({}, { stagedSuggestion: { suggestionId: 'suggestion:one', shot: 'Wide lakeside scene', kind: 'location' } });
    assert.deepEqual(getChatWandPreferences(state).stagedSuggestion, { suggestionId: 'suggestion:one', shot: 'Wide lakeside scene', kind: 'location' });
    assert.equal(JSON.stringify(state).includes('api'), false);
});

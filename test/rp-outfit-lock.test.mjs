import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createOutfit,
    migrateChatOutfitState,
    migrateOutfitCatalog,
    selectChatOutfit,
    setChatOutfitLock,
    getChatOutfitBinding,
} from '../lib/rp/outfit-lock.js';
import { isStableIdentityId } from '../lib/rp/identities.js';

const catalog = migrateOutfitCatalog({ outfits: [
    { id: 'outfit:casual', identityId: 'character:ava', name: 'Casual', items: ['blue shirt', 'jeans'] },
    { id: 'outfit:formal', identityId: 'character:ava', name: 'Formal', items: ['black dress', 'boots'] },
    { id: 'outfit:leo', identityId: 'character:leo', name: 'Leo travel', items: ['coat', 'boots'] },
] });

test('named complete outfits normalize into one catalog entry per stable identity and reject incomplete names', () => {
    const created = createOutfit({ id: 'outfit:work', identityId: 'character:ava', name: 'Work', items: ['jacket'] });
    assert.equal(created.status, 'created');
    assert.deepEqual(created.outfit, { id: 'outfit:work', identityId: 'character:ava', name: 'Work', items: ['jacket'], description: null });
    assert.equal(createOutfit({ id: 'outfit:bad', identityId: 'character:ava', name: '', items: ['jacket'] }).status, 'invalid');
    assert.equal(createOutfit({ id: 'outfit:partial', identityId: 'character:ava', name: 'Partial', items: [] }).status, 'invalid');
});

test('chat selection keeps exactly one active outfit per identity and lock survives reload', () => {
    const selected = selectChatOutfit({}, 'character:ava', 'outfit:casual', { catalog, lock: true });
    assert.equal(selected.status, 'selected');
    assert.deepEqual(getChatOutfitBinding(selected.state, 'character:ava'), { activeOutfitId: 'outfit:casual', isLocked: true });
    const reloaded = migrateChatOutfitState(selected.state);
    assert.deepEqual(getChatOutfitBinding(reloaded, 'character:ava'), { activeOutfitId: 'outfit:casual', isLocked: true });
    assert.equal(Object.keys(reloaded.identities).length, 1);
});

test('locked selection refuses implicit replacement but explicit change keeps the lock', () => {
    const first = selectChatOutfit({}, 'character:ava', 'outfit:casual', { catalog, lock: true }).state;
    const refused = selectChatOutfit(first, 'character:ava', 'outfit:formal', { catalog });
    assert.equal(refused.status, 'confirmation-required');
    assert.deepEqual(refused.state, first);
    const changed = selectChatOutfit(first, 'character:ava', 'outfit:formal', { catalog, confirmed: true });
    assert.equal(changed.status, 'selected');
    assert.deepEqual(getChatOutfitBinding(changed.state, 'character:ava'), { activeOutfitId: 'outfit:formal', isLocked: true });
});

test('lock and selection are isolated by stable identity and stale expected selection is rejected', () => {
    const ava = selectChatOutfit({}, 'character:ava', 'outfit:casual', { catalog, lock: true }).state;
    const leo = selectChatOutfit(ava, 'character:leo', 'outfit:leo', { catalog }).state;
    assert.equal(Object.keys(leo.identities).length, 2);
    const stale = selectChatOutfit(leo, 'character:ava', 'outfit:formal', { catalog, confirmed: true, expectedOutfitId: 'outfit:other' });
    assert.equal(stale.status, 'stale');
});

test('unknown identities and outfits cannot create a binding', () => {
    assert.equal(selectChatOutfit({}, 'Ava', 'outfit:casual', { catalog }).status, 'invalid-identity');
    assert.equal(selectChatOutfit({}, 'character:ava', 'outfit:nope', { catalog }).status, 'outfit-not-found');
    const unlocked = setChatOutfitLock(selectChatOutfit({}, 'character:ava', 'outfit:casual', { catalog, lock: true }).state, 'character:ava', false);
    assert.equal(getChatOutfitBinding(unlocked, 'character:ava').isLocked, false);
});

test('catalog maps may provide the outfit id as the map key', () => {
    const mapped = migrateOutfitCatalog({ outfits: {
        'outfit:casual': { identityId: 'character:ava', name: 'Casual', items: ['blue shirt'] },
    } });
    assert.equal(mapped.outfits[0].id, 'outfit:casual');
});

test('chat outfit revision survives metadata reload for persistence read-back', () => {
    const reloaded = migrateChatOutfitState({ revision: 'outfit:revision-1', identities: { 'character:ava': { activeOutfitId: 'outfit:casual', isLocked: true } } });
    assert.equal(reloaded.revision, 'outfit:revision-1');
    assert.deepEqual(getChatOutfitBinding(reloaded, 'character:ava'), { activeOutfitId: 'outfit:casual', isLocked: true });
});

test('canonical stable identity validation accepts character, persona, and multi-part NPC IDs with spaces', () => {
    for (const id of [
        'character:ava file.png',
        'user:persona portrait 01.png',
        'persona:Sam Morgan',
        'npc:chat-42:Captain Mira Vale',
    ]) assert.equal(isStableIdentityId(id), true, id);
    for (const id of ['Ava', 'npc:chat-42', 'character:', 'npc::', 'character:avatar\\file.png']) assert.equal(isStableIdentityId(id), false, id);
});

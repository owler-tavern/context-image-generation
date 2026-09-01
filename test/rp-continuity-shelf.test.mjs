import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAppearanceTruths,
    buildContinuityReferenceCandidates,
    buildOutfitPrompt,
    projectContinuityShelf,
} from '../lib/rp/continuity-shelf.js';

const identities = [
    { id: 'character:ava', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
    { id: 'character:leo', kind: 'character', label: 'Leo', hostKey: 'leo.png' },
];

test('truth projection prefers an informative identity avatar and retains raw description for missing detail', () => {
    const truths = buildAppearanceTruths({
        identities,
        sources: {
            'character:ava': {
                avatar: { url: '/characters/ava.png', characterId: 'character:ava', visibleTraits: [{ key: 'hair', value: 'black' }] },
                description: 'Ava has black hair and a silver scar.',
            },
            'character:leo': {
                avatar: { url: '/img/default-avatar.png', characterId: 'character:leo' },
                description: 'Leo wears a green coat.',
            },
        },
    });
    assert.deepEqual(truths.map((truth) => [truth.identityId, truth.sourceType]), [
        ['character:ava', 'avatar'],
        ['character:leo', 'description'],
    ]);
    assert.equal(truths[0].description.text, 'Ava has black hair and a silver scar.');
    assert.equal(truths[1].source.text, 'Leo wears a green coat.');
});

test('reference candidates keep each identity separate and expose remembered, avatar, and description sources', () => {
    const truths = buildAppearanceTruths({
        identities,
        sources: {
            'character:ava': { avatar: { url: '/ava.png', characterId: 'character:ava' }, description: 'Ava description.' },
            'character:leo': { description: 'Leo description.' },
        },
    });
    const candidates = buildContinuityReferenceCandidates({
        identities,
        truths,
        remembered: [{ id: 'look:ava', role: 'identity-look', identityId: 'character:ava', assetId: 'asset:ava', label: 'Ava' }],
        avatarReferences: [{ id: 'host:character:ava', role: 'host-avatar', identityId: 'character:ava', assetId: 'asset:avatar:ava' }],
    });
    assert.deepEqual(candidates.map(({ id, identityId, sourceType }) => [id, identityId, sourceType]), [
        ['look:ava', 'character:ava', 'remembered'],
        ['host:character:ava', 'character:ava', 'avatar'],
        ['description:character:ava', 'character:ava', 'description'],
        ['description:character:leo', 'character:leo', 'description'],
    ]);
});

test('shelf projection reports selected and omitted references plus independent named outfits', () => {
    const truths = buildAppearanceTruths({
        identities,
        sources: {
            'character:ava': { avatar: { url: '/ava.png', characterId: 'character:ava' }, description: 'Ava description.' },
            'character:leo': { description: 'Leo description.' },
        },
    });
    const shelf = projectContinuityShelf({
        identities,
        truths,
        candidates: buildContinuityReferenceCandidates({ identities, truths, remembered: [], avatarReferences: [
            { id: 'host:character:ava', role: 'host-avatar', identityId: 'character:ava', assetId: 'asset:avatar:ava' },
        ] }),
        modelLimit: 1,
        outfitCatalog: { outfits: [
            { id: 'outfit:ava:travel', identityId: 'character:ava', name: 'Travel', items: ['blue coat', 'boots'] },
            { id: 'outfit:leo:formal', identityId: 'character:leo', name: 'Formal', description: 'black suit' },
        ] },
        outfitState: { identities: {
            'character:ava': { activeOutfitId: 'outfit:ava:travel', isLocked: true },
        } },
    });
    assert.deepEqual(shelf.identities.map(({ identityId, sourceType, thumbnail, selected, omitted }) => [identityId, sourceType, thumbnail, selected.length, omitted.length]), [
        ['character:ava', 'avatar', '/ava.png', 1, 1],
        ['character:leo', 'description', null, 1, 0],
    ]);
    assert.deepEqual(shelf.identities[0].activeOutfit, { id: 'outfit:ava:travel', name: 'Travel', items: ['blue coat', 'boots'], description: null, isLocked: true });
    assert.equal(shelf.modelLimit.maxReferences, 1);
});

test('outfit prompt is deterministic and independent for two identities', () => {
    assert.equal(buildOutfitPrompt([
        { identityId: 'character:ava', identityLabel: 'Ava', outfit: { name: 'Travel', items: ['blue coat', 'boots'] } },
        { identityId: 'character:leo', identityLabel: 'Leo', outfit: { name: 'Formal', description: 'black suit' } },
    ]), '[Active outfits]\nAva — Travel: blue coat, boots.\nLeo — Formal: black suit.');
    assert.equal(buildOutfitPrompt([]), '');
});

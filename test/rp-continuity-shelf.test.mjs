import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAppearanceTruths,
    buildContinuityReferenceCandidates,
    alignContinuityReferencePlan,
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

test('shelf projection reports selected and omitted references without outfit state', () => {
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
    });
    assert.deepEqual(shelf.identities.map(({ identityId, sourceType, thumbnail, selected, omitted }) => [identityId, sourceType, thumbnail, selected.length, omitted.length]), [
        ['character:ava', 'avatar', '/ava.png', 1, 1],
        ['character:leo', 'description', null, 1, 0],
    ]);
    assert.equal(shelf.modelLimit.maxReferences, 1);
});

test('description candidates follow the captured use-descriptions option', () => {
    const truths = buildAppearanceTruths({ identities, sources: {
        'character:ava': { description: 'Ava written details.' },
        'character:leo': { description: 'Leo written details.' },
    } });
    const candidates = buildContinuityReferenceCandidates({
        identities,
        truths,
        includeDescriptions: false,
    });
    assert.deepEqual(candidates, []);
});

test('aligned shelf projection exposes exactly the references sent by the immutable plan', () => {
    const shelf = projectContinuityShelf({
        identities,
        truths: buildAppearanceTruths({ identities, sources: { 'character:ava': { description: 'Ava.' }, 'character:leo': { description: 'Leo.' } } }),
        candidates: [
            { id: 'host:ava', identityId: 'character:ava', sourceType: 'avatar', role: 'host-avatar', assetId: 'asset:ava' },
            { id: 'host:leo', identityId: 'character:leo', sourceType: 'avatar', role: 'host-avatar', assetId: 'asset:leo' },
        ],
        modelLimit: 1,
    });
    const aligned = alignContinuityReferencePlan(shelf, {
        selected: [{ id: 'host:leo', identityId: 'character:leo', role: 'host-avatar', assetId: 'asset:leo' }],
        omitted: [{ candidate: { id: 'host:ava', identityId: 'character:ava', role: 'host-avatar', assetId: 'asset:ava' }, reason: 'provider-cap' }],
    });
    assert.deepEqual(aligned.selected.map((entry) => entry.id), ['host:leo']);
    assert.deepEqual(aligned.omitted.map((entry) => [entry.id, entry.reason]), [['host:ava', 'provider-cap']]);
    assert.deepEqual(aligned.identities.map((entry) => [entry.identityId, entry.selected.map((row) => row.id), entry.omitted.map((row) => row.id)]), [
        ['character:ava', [], ['host:ava']],
        ['character:leo', ['host:leo'], []],
    ]);
});

test('description-disabled projection does not show unsent written fallback', () => {
    const identity = { id: 'character:ava', kind: 'character', label: 'Ava' };
    const truth = buildAppearanceTruths({ identities: [identity], sources: { 'character:ava': { description: 'Ava written details.' } } });
    const shelf = projectContinuityShelf({ identities: [identity], truths: truth, candidates: [], modelLimit: 1, includeDescriptions: false, includeAvatars: false });
    assert.equal(shelf.identities[0].sourceType, 'none');
    assert.equal(shelf.identities[0].description, null);
    assert.equal(shelf.identities[0].thumbnail, null);
});

test('missing selected visual is shown as unavailable rather than a falsely active avatar', () => {
    const identity = { id: 'character:ava', kind: 'character', label: 'Ava' };
    const truth = buildAppearanceTruths({ identities: [identity], sources: { 'character:ava': { avatar: { url: '/ava.png', characterId: 'character:ava' }, description: 'Ava details.' } } });
    const shelf = projectContinuityShelf({ identities: [identity], truths: truth, candidates: [{ id: 'look:ava', identityId: identity.id, sourceType: 'remembered', role: 'identity-look', assetId: 'asset:missing' }], modelLimit: 1 });
    const aligned = alignContinuityReferencePlan(shelf, { selected: [], omitted: [{ candidate: { id: 'look:ava', identityId: identity.id, role: 'identity-look', assetId: 'asset:missing' }, reason: 'asset-unavailable' }] });
    assert.equal(aligned.identities[0].sourceType, 'unavailable');
    assert.equal(aligned.identities[0].thumbnail, null);
});

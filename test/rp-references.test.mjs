import test from 'node:test';
import assert from 'node:assert/strict';
import {
    materializeReferences,
    rankReferenceCandidates,
    selectReferenceCandidates,
} from '../lib/rp/references.js';

const candidates = [
    { id: 'scene:old', role: 'prior-scene', identityId: null, assetId: 'asset:scene', label: 'old scene' },
    { id: 'avatar:leo', role: 'host-avatar', identityId: 'character:leo', assetId: 'asset:leo', label: 'Leo' },
    { id: 'look:ava', role: 'identity-look', identityId: 'character:ava', assetId: 'asset:ava-look', label: 'Ava' },
    { id: 'avatar:ava', role: 'host-avatar', identityId: 'character:ava', assetId: 'asset:ava-avatar', label: 'Ava' },
    { id: 'legacy:previous', role: 'legacy-previous', identityId: null, assetId: 'asset:previous', label: 'previous' },
];

test('ranks focus mention, target mention, speaker, nearby mention, and group presence while keeping people before scene', () => {
    const ranked = rankReferenceCandidates(candidates, {
        focusText: 'Ava looks toward the window.',
        sourceMessage: 'Leo enters.',
        speakerIdentityId: 'character:leo',
        nearbyMessages: [{ text: 'Ava waits outside.' }],
        groupIdentityIds: ['character:leo'],
    });
    assert.deepEqual(ranked.map((candidate) => candidate.id), [
        'look:ava',
        'avatar:ava',
        'avatar:leo',
        'scene:old',
        'legacy:previous',
    ]);
});

test('selected looks precede host avatars and cap omissions carry reasons', () => {
    const result = selectReferenceCandidates(candidates, {
        focusText: 'Ava looks toward the window.',
        sourceMessage: 'Leo enters.',
        speakerIdentityId: 'character:leo',
        nearbyMessages: [{ text: 'Ava waits outside.' }],
        maxCount: 2,
    });
    assert.deepEqual(result.selected.map((candidate) => candidate.id), ['look:ava', 'avatar:ava']);
    assert.deepEqual(result.omitted.map((item) => [item.candidate.id, item.reason]), [
        ['avatar:leo', 'provider-cap'],
        ['scene:old', 'provider-cap'],
        ['legacy:previous', 'provider-cap'],
    ]);
});

test('unknown caps select no new identity or scene references', () => {
    const result = selectReferenceCandidates(candidates, { maxCount: undefined });
    assert.deepEqual(result.selected.map((candidate) => candidate.id), ['avatar:ava', 'avatar:leo', 'legacy:previous']);
    assert.deepEqual(result.omitted.map((item) => [item.candidate.id, item.reason]), [
        ['look:ava', 'unknown-cap'],
        ['scene:old', 'unknown-cap'],
    ]);
});

test('materialization omits missing assets without decoding, cropping, or replacing them', () => {
    const result = materializeReferences([
        { id: 'look:ava', role: 'identity-look', identityId: 'character:ava', assetId: 'asset:ava' },
        { id: 'look:missing', role: 'identity-look', identityId: 'character:ava', assetId: 'asset:missing' },
    ], {
        assets: { 'asset:ava': { id: 'asset:ava', url: '/assets/ava.png', mimeType: 'image/png' } },
    });
    assert.deepEqual(result.references, [{
        id: 'look:ava',
        role: 'identity-look',
        identityId: 'character:ava',
        assetId: 'asset:ava',
        asset: { url: '/assets/ava.png', mimeType: 'image/png' },
    }]);
    assert.deepEqual(result.omitted, [{ candidate: {
        id: 'look:missing', role: 'identity-look', identityId: 'character:ava', assetId: 'asset:missing',
    }, reason: 'missing-asset' }]);
});

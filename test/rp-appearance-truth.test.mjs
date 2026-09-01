import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppearanceTruth } from '../lib/rp/appearance-truth.js';

test('a character-specific avatar wins and text only fills traits not visibly established', () => {
    const result = resolveAppearanceTruth({
        identity: { id: 'character:ava', label: 'Ava' },
        avatar: {
            url: '/user/images/ava.png',
            characterId: 'character:ava',
            visibleTraits: [{ key: 'hair', value: 'black' }, { key: 'eyes', value: 'green' }],
        },
        description: 'Ava has black hair and green eyes and a silver scar.',
        textTraits: [
            { key: 'hair', value: 'blonde', text: 'blonde hair' },
            { key: 'scar', value: 'silver', text: 'a silver scar' },
        ],
    });

    assert.equal(result.sourceType, 'avatar');
    assert.equal(result.source.url, '/user/images/ava.png');
    assert.deepEqual(result.textTraits, [{ key: 'scar', value: 'silver', text: 'a silver scar' }]);
    assert.deepEqual(result.evidence.map(({ source, decision }) => [source, decision]), [
        ['avatar', 'selected'],
        ['description', 'available-as-fallback'],
        ['text', 'trait-added'],
        ['text', 'trait-omitted-visible'],
    ]);
});

test('generic, default, and missing avatars fall back to written description', () => {
    for (const avatar of [
        { url: '/img/default-avatar.png', characterId: 'character:ava' },
        { url: '/img/placeholder.png', characterId: 'character:ava', isGeneric: true },
        null,
    ]) {
        const result = resolveAppearanceTruth({
            identity: { id: 'character:ava', label: 'Ava' },
            avatar,
            description: 'Ava wears a red coat.',
        });
        assert.equal(result.sourceType, 'description');
        assert.equal(result.source.text, 'Ava wears a red coat.');
        assert.equal(result.evidence.find((item) => item.source === 'avatar').decision, 'rejected');
    }
});

test('an avatar belonging to another identity is rejected with deterministic evidence', () => {
    const result = resolveAppearanceTruth({
        identity: { id: 'character:ava', label: 'Ava' },
        avatar: { url: '/user/images/leo.png', characterId: 'character:leo' },
        description: 'Ava has a red coat.',
        textTraits: ['red coat'],
    });

    assert.equal(result.sourceType, 'description');
    assert.deepEqual(result.evidence[0], {
        source: 'avatar', decision: 'rejected', reason: 'different-identity', identityId: 'character:ava', avatarIdentityId: 'character:leo',
    });
});

test('the result is stable and does not mutate caller inputs', () => {
    const input = {
        identity: { id: 'character:ava', label: 'Ava' },
        avatar: { url: '/user/images/ava.png', characterId: 'character:ava', visibleTraits: ['hair'] },
        description: 'Ava has a coat.',
        textTraits: ['coat'],
    };
    const before = structuredClone(input);
    const first = resolveAppearanceTruth(input);
    const second = resolveAppearanceTruth(input);
    assert.deepEqual(first, second);
    assert.deepEqual(input, before);
});

test('identity-owned avatar and description are accepted when explicit arguments are omitted', () => {
    const result = resolveAppearanceTruth({
        identity: {
            id: 'character:ava',
            avatar: { url: '/user/images/ava.png', characterId: 'character:ava', visibleTraits: { hair: 'black' } },
            description: { text: 'Ava wears a coat.', traits: [{ key: 'hair', value: 'black' }] },
        },
        textTraits: { coat: 'red' },
    });
    assert.equal(result.sourceType, 'avatar');
    assert.deepEqual(result.textTraits, [{ key: 'coat', value: 'red', text: 'red' }]);
});

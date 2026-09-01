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

test('character avatar filename identity matches the canonical character ID and raw description remains available', () => {
    const result = resolveAppearanceTruth({
        identity: { id: 'character:ava portrait 01.png' },
        avatar: { url: '/user/images/ava portrait 01.png', characterId: 'ava portrait 01.png' },
        description: 'Ava has a scar that the image cannot establish.',
    });
    assert.equal(result.sourceType, 'avatar');
    assert.deepEqual(result.description, { text: 'Ava has a scar that the image cannot establish.' });
});

test('explicit description rejects even an informative avatar while auto rejects generic metadata', () => {
    const identity = { id: 'user:persona-b.png', label: 'Persona B' };
    const avatar = { url: '/user/images/persona-b.png', characterId: identity.id };
    const description = 'Persona B has short dark hair and a blue jacket.';
    assert.equal(resolveAppearanceTruth({ identity, avatar, description, sourcePreference: 'description' }).sourceType, 'description');
    const generic = resolveAppearanceTruth({
        identity,
        avatar: { url: '/user/images/generic-avatar.png', characterId: identity.id },
        description,
        sourcePreference: 'auto',
    });
    assert.equal(generic.sourceType, 'description');
    assert.equal(generic.evidence.find((item) => item.source === 'avatar').reason, 'generic-avatar');
});

test('explicit avatar does not silently fall back when its source is unavailable', () => {
    const result = resolveAppearanceTruth({
        identity: { id: 'user:persona-b.png' },
        avatar: { url: '/user/images/generic-avatar.png', characterId: 'user:persona-b.png' },
        description: 'Persona B has a written appearance.',
        sourcePreference: 'avatar',
    });
    assert.equal(result.sourceType, 'none');
    assert.equal(result.source, null);
    assert.equal(result.sourcePreference, 'avatar');
});

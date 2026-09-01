import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectorCastOverrides, inferDirectorCast, normalizeDirectorCastOverrides } from '../lib/rp/director-cast.js';

const identities = [
    { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
    { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
    { id: 'user:me', label: 'Me', kind: 'user', aliases: ['Me'] },
];

test('Director cast inference exposes only unambiguous interpreted identities with honest defaults', () => {
    const candidates = inferDirectorCast({
        identities,
        interpretation: {
            cast: [{ identityId: 'character:ava', label: 'Ava', kind: 'character', confidence: 'high' }],
            excluded: [{ identityId: 'character:rowan', reason: 'absent' }],
            ambiguities: [{ alias: 'Me', candidates: ['user:me', 'character:ava'] }],
        },
    });
    assert.deepEqual(candidates.map(({ identityId, action }) => [identityId, action]), [
        ['character:ava', 'include'],
        ['character:rowan', 'exclude'],
    ]);
});

test('Director cast overrides normalize to bounded actions with at most one focus', () => {
    const overrides = normalizeDirectorCastOverrides([
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
        { identityId: 'user:me', action: 'focus' },
        { identityId: 'unknown', action: 'include' },
    ], { allowedIdentityIds: identities.map(({ id }) => id) });
    assert.deepEqual(overrides, [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'include' },
        { identityId: 'user:me', action: 'focus' },
    ]);
});

test('Director cast overrides explicitly omit excluded people and prioritize one focused identity in scene state', () => {
    const result = applyDirectorCastOverrides({
        cast: [{ identityId: 'character:ava', label: 'Ava', kind: 'character' }, { identityId: 'character:rowan', label: 'Rowan', kind: 'character' }],
        identities,
        overrides: [
            { identityId: 'character:ava', action: 'exclude' },
            { identityId: 'character:rowan', action: 'focus' },
            { identityId: 'user:me', action: 'include' },
        ],
    });
    assert.deepEqual(result.cast.map(({ identityId }) => identityId), ['character:rowan', 'user:me']);
    assert.deepEqual(result.excluded, ['character:ava']);
    assert.equal(result.focusedIdentityId, 'character:rowan');
    assert.match(result.promptLine, /Composition priority: Rowan/);
    assert.match(result.promptLine, /Explicitly omit: Ava/);
});

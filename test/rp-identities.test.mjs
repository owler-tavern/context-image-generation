import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildIdentityCatalogue,
    findMentionedIdentities,
    migrateRpLibrary,
    normalizeAlias,
} from '../lib/rp/identities.js';

test('normalizes aliases with Unicode compatibility and whitespace folding', () => {
    assert.equal(normalizeAlias('  Ａva\u00a0Stone  '), 'ava stone');
});

test('merges solo character and group membership without duplicate identities', () => {
    const catalogue = buildIdentityCatalogue({
        activeCharacter: { avatar: 'ava.png', name: 'Ava', aliases: ['Ava Stone'] },
        persona: { avatar: 'sam.png', name: 'Sam' },
        groupMembers: [{ avatar: 'ava.png', name: 'Ava Stone' }, { avatar: 'leo.png', name: 'Leo' }],
    });
    assert.deepEqual(catalogue.map((identity) => identity.id), ['character:ava.png', 'user:sam.png', 'character:leo.png']);
    assert.equal(catalogue[0].aliases.includes('ava stone'), true);
});

test('keeps legacy library inclusion when no library scope allowlist is supplied', () => {
    const catalogue = buildIdentityCatalogue({
        activeCharacter: { avatar: 'current.png', name: 'Current' },
        persona: { avatar: 'current-user.png', name: 'Current user' },
        library: {
            identities: {
                'character:legacy.png': { id: 'character:legacy.png', kind: 'character', label: 'Legacy character' },
                'user:legacy.png': { id: 'user:legacy.png', kind: 'user', label: 'Legacy persona' },
            },
        },
    });

    assert.deepEqual(catalogue.map((identity) => identity.id), [
        'character:current.png',
        'user:current-user.png',
        'character:legacy.png',
        'user:legacy.png',
    ]);
});

test('ambiguous aliases resolve to no identity while unique Unicode phrase matches resolve', () => {
    const identities = [
        { id: 'npc:one', kind: 'npc', label: 'Alex', aliases: ['Alex'] },
        { id: 'npc:two', kind: 'npc', label: 'Alex Two', aliases: ['Alex'] },
        { id: 'character:ava', kind: 'character', label: 'Ava Stone', aliases: ['Ａva Stone'] },
    ];
    assert.deepEqual(findMentionedIdentities('Alex waits. Ava Stone enters.', identities).map((identity) => identity.id), ['character:ava']);
    assert.deepEqual(findMentionedIdentities('Alex waits.', identities), []);
    assert.deepEqual(findMentionedIdentities('Ava Stones enters.', identities), []);
});

test('library migration is additive and idempotent', () => {
    const legacy = { identities: { 'character:ava.png': { id: 'character:ava.png', kind: 'character', label: 'Ava' } }, assets: null };
    const migrated = migrateRpLibrary(legacy);
    assert.equal(migrated.schema, 1);
    assert.deepEqual(migrateRpLibrary(migrated), migrated);
    assert.deepEqual(migrated.assets, {});
    assert.deepEqual(migrated.preferences, {});
    assert.deepEqual(migrateRpLibrary({ preferences: { sceneContinuity: true } }).preferences, { sceneContinuity: true });
});

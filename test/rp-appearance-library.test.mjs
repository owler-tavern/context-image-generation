import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addAppearanceLook,
    buildAppearanceReferenceCandidates,
    listAppearanceIdentityChoices,
    materializeAppearanceAssets,
    migrateAppearanceLibrary,
    removeAppearanceLook,
} from '../lib/rp/appearance-library.js';

const galleryItem = {
    id: 'gallery:one',
    url: '/user/images/cig_gallery_one.png',
    prompt: 'Ava at the window',
    timestamp: 1710000000000,
    sourceMetadata: { providerId: 'makersuite', modelId: 'gemini-image' },
};

test('appearance migration is additive and idempotent without copying image data', () => {
    const legacy = {
        identities: {
            'character:ava.png': { id: 'character:ava.png', kind: 'character', label: 'Ava' },
        },
        assets: null,
    };
    const migrated = migrateAppearanceLibrary(legacy);
    assert.equal(migrated.schema, 1);
    assert.deepEqual(migrateAppearanceLibrary(migrated), migrated);
    assert.deepEqual(migrated.assets, {});
    assert.deepEqual(migrated.identities['character:ava.png'].looks, []);
    assert.equal(JSON.stringify(migrated).includes('imageData'), false);
});

test('adding a gallery look creates a stable identity record and deduplicates the same artifact', () => {
    const first = addAppearanceLook({}, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        galleryItem,
        label: 'Window look',
        now: 1710000001000,
    });
    const second = addAppearanceLook(first.library, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        galleryItem,
        label: 'Window look',
        now: 1710000002000,
    });

    assert.equal(first.look.id, 'look:gallery:one');
    assert.equal(second.library.identities['character:ava.png'].looks.length, 1);
    assert.equal(second.library.assets['asset:gallery:one'].source.galleryId, 'gallery:one');
    assert.equal('imageData' in second.library.assets['asset:gallery:one'], false);
});

test('materialization omits a look when its gallery artifact was removed', () => {
    const saved = addAppearanceLook({}, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava' },
        galleryItem,
    }).library;
    assert.deepEqual(materializeAppearanceAssets(saved, [galleryItem]), {
        assets: {
            'asset:gallery:one': {
                id: 'asset:gallery:one',
                url: galleryItem.url,
                mimeType: 'image/png',
            },
        },
        unavailable: [],
    });
    const missing = materializeAppearanceAssets(saved, []);
    assert.deepEqual(missing.assets, {});
    assert.deepEqual(missing.unavailable, ['asset:gallery:one']);
});

test('reference candidates only expose saved looks that still exist in the gallery', () => {
    const saved = addAppearanceLook({}, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava' },
        galleryItem,
    }).library;
    const candidates = buildAppearanceReferenceCandidates(saved, [galleryItem]);
    assert.deepEqual(candidates, [{
        id: 'look:gallery:one',
        role: 'identity-look',
        identityId: 'character:ava.png',
        assetId: 'asset:gallery:one',
        label: 'Ava',
        aliases: ['ava'],
    }]);
    assert.deepEqual(buildAppearanceReferenceCandidates(saved, []), []);
});

test('identity choices include current hosts, group members, and named chat NPCs without guessing', () => {
    const choices = listAppearanceIdentityChoices({
        activeCharacter: { avatar: 'ava.png', name: 'Ava' },
        persona: { avatar: 'sam.png', name: 'Sam' },
        groupMembers: [{ avatar: 'leo.png', name: 'Leo' }],
        chatIdentities: [{ id: 'npc:guard', kind: 'npc', label: 'The Guard', durable: false }],
    });
    assert.deepEqual(choices.map((choice) => choice.id), [
        'character:ava.png', 'user:sam.png', 'character:leo.png', 'npc:guard',
    ]);
});

test('removing a saved look leaves the identity record valid and removes only that look', () => {
    const saved = addAppearanceLook({}, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava' },
        galleryItem,
    }).library;
    const result = removeAppearanceLook(saved, 'character:ava.png', 'look:gallery:one');
    assert.deepEqual(result.identities['character:ava.png'].looks, []);
    assert.deepEqual(result.assets, {});
});

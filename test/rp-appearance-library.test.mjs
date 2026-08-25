import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addAppearanceLook,
    applyGalleryClear,
    buildAppearanceReferenceCandidates,
    listAppearanceIdentityChoices,
    materializeAppearanceAssets,
    migrateAppearanceLibrary,
    removeAppearanceLook,
    getProtectedGalleryArtifactIds,
    listVisibleAppearanceEntries,
    removeVisibleAppearanceLook,
    setVisibleAppearanceLook,
    trimGalleryToLimit,
    setActiveAppearanceLook,
} from '../lib/rp/appearance-library.js';
import * as appearanceLibrary from '../lib/rp/appearance-library.js';

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

test('confirmed gallery clear removes every image and its dependent appearance records', () => {
    const saved = addAppearanceLook({}, {
        identity: { id: 'character:ava.png', kind: 'character', label: 'Ava' },
        galleryItem,
    }).library;
    const untouched = applyGalleryClear({ gallery: [galleryItem], library: saved, confirmed: false });
    assert.equal(untouched.gallery.length, 1);
    assert.equal(untouched.library.identities['character:ava.png'].looks.length, 1);

    const cleared = applyGalleryClear({ gallery: [galleryItem], library: saved, confirmed: true });
    assert.deepEqual(cleared.gallery, []);
    assert.deepEqual(cleared.library.identities['character:ava.png'].looks, []);
    assert.deepEqual(cleared.library.assets, {});
});

test('only the current chat can view or act on chat-local NPC appearances', () => {
    const library = {
        identities: {
            'character:ava': { id: 'character:ava', kind: 'character', durable: true, label: 'Ava', activeLookId: 'look:ava', looks: [{ id: 'look:ava', assetId: 'asset:ava', label: 'Day look' }] },
            'npc:current:guard': { id: 'npc:current:guard', kind: 'npc', durable: false, chatId: 'current', label: 'Guard', activeLookId: 'look:guard', looks: [{ id: 'look:guard', assetId: 'asset:guard', label: 'Uniform' }] },
            'npc:other:guide': { id: 'npc:other:guide', kind: 'npc', durable: false, chatId: 'other', label: 'Guide', activeLookId: 'look:guide', looks: [{ id: 'look:guide', assetId: 'asset:guide', label: 'Travel look' }] },
        },
        assets: {},
    };
    const visible = listVisibleAppearanceEntries(library, { currentChatId: 'current' });
    assert.deepEqual(visible.map(({ identity }) => identity.id), ['character:ava', 'npc:current:guard']);

    const hiddenRemoval = removeVisibleAppearanceLook(library, 'npc:other:guide', 'look:guide', { currentChatId: 'current' });
    assert.equal(hiddenRemoval.identities['npc:other:guide'].looks.length, 1, 'foreign NPC look cannot be removed');
    const foreignWithTwoLooks = { ...library, identities: { ...library.identities, 'npc:other:guide': { ...library.identities['npc:other:guide'], looks: [...library.identities['npc:other:guide'].looks, { id: 'look:guide-evening', assetId: 'asset:guide-evening', label: 'Evening look' }] } } };
    const hiddenActivation = setVisibleAppearanceLook(foreignWithTwoLooks, 'npc:other:guide', 'look:guide-evening', { currentChatId: 'current' });
    assert.equal(hiddenActivation.identities['npc:other:guide'].activeLookId, 'look:guide', 'foreign NPC look cannot be activated');

    const currentRemoval = removeVisibleAppearanceLook(library, 'npc:current:guard', 'look:guard', { currentChatId: 'current' });
    assert.equal(currentRemoval.identities['npc:current:guard'].looks.length, 0, 'current chat NPC remains actionable');
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

test('chat-scoped identities are only offered for the active chat', () => {
    const library = migrateAppearanceLibrary({ identities: {
        'npc:chat-a:guard': { id: 'npc:chat-a:guard', kind: 'npc', label: 'Guard A', chatId: 'chat-a', durable: false },
        'npc:chat-b:guard': { id: 'npc:chat-b:guard', kind: 'npc', label: 'Guard B', chatId: 'chat-b', durable: false },
    } });
    assert.deepEqual(listAppearanceIdentityChoices({ library, currentChatId: 'chat-a', chatIdentities: Object.values(library.identities) }).map((item) => item.id), ['npc:chat-a:guard']);
});

test('first saved look becomes active while later looks remain selectable but inactive', () => {
    const first = addAppearanceLook({}, { identity: { id: 'character:ava', kind: 'character', label: 'Ava' }, galleryItem, now: 1 }).library;
    const second = addAppearanceLook(first, { identity: { id: 'character:ava', kind: 'character', label: 'Ava' }, galleryItem: { ...galleryItem, id: 'gallery:two', url: '/two.png' }, now: 2 }).library;
    assert.equal(second.identities['character:ava'].activeLookId, 'look:gallery:one');
    assert.equal(buildAppearanceReferenceCandidates(second, [galleryItem, { ...galleryItem, id: 'gallery:two', url: '/two.png' }]).map((item) => item.id).join(','), 'look:gallery:one');
    const switched = setActiveAppearanceLook(second, 'character:ava', 'look:gallery:two');
    assert.equal(switched.identities['character:ava'].activeLookId, 'look:gallery:two');
    assert.deepEqual(buildAppearanceReferenceCandidates(switched, [galleryItem, { ...galleryItem, id: 'gallery:two', url: '/two.png' }]).map((item) => item.id), ['look:gallery:two']);
});

test('protected gallery artifacts survive cap trimming and expose their ids', () => {
    const library = addAppearanceLook({}, { identity: { id: 'character:ava', kind: 'character', label: 'Ava' }, galleryItem }).library;
    assert.deepEqual([...getProtectedGalleryArtifactIds(library)], ['gallery:one']);
    const result = trimGalleryToLimit([
        { ...galleryItem, timestamp: 1 },
        { id: 'gallery:two', url: '/two.png', timestamp: 2 },
        { id: 'gallery:three', url: '/three.png', timestamp: 3 },
    ], 1, library);
    assert.deepEqual(result.gallery.map((item) => item.id), ['gallery:one']);
    assert.equal(result.evictedCount, 2);
});

test('orphan gallery assets do not protect unrelated gallery items', () => {
    const library = migrateAppearanceLibrary({ assets: {
        'asset:orphan': { id: 'asset:orphan', source: { galleryId: 'gallery:orphan' } },
    } });
    assert.deepEqual([...getProtectedGalleryArtifactIds(library)], []);
});

test('only confirmed unprotected gallery deletion mutates the gallery', () => {
    assert.equal(typeof appearanceLibrary.applyGalleryImageDeletion, 'function');
    const gallery = [galleryItem, { ...galleryItem, id: 'gallery:two', url: '/two.png' }];
    const cancelled = appearanceLibrary.applyGalleryImageDeletion({ gallery, targetItem: gallery[1], protectedIds: new Set(['gallery:one']), confirmed: false });
    const protectedResult = appearanceLibrary.applyGalleryImageDeletion({ gallery, targetItem: gallery[0], protectedIds: new Set(['gallery:one']), confirmed: false });
    const confirmed = appearanceLibrary.applyGalleryImageDeletion({ gallery, targetItem: gallery[1], protectedIds: new Set(['gallery:one']), confirmed: true });

    assert.deepEqual(cancelled, { decision: 'cancelled', gallery });
    assert.deepEqual(protectedResult, { decision: 'protected', gallery });
    assert.deepEqual(confirmed, { decision: 'deleted', gallery: [galleryItem] });
});

test('confirmed gallery deletion resolves the captured artifact after gallery order changes', () => {
    const target = { ...galleryItem, id: 'gallery:two', url: '/two.png' };
    const addedDuringConfirmation = { ...galleryItem, id: 'gallery:three', url: '/three.png' };
    const reordered = [addedDuringConfirmation, galleryItem, target];
    const deleted = appearanceLibrary.applyGalleryImageDeletion({
        gallery: reordered,
        targetArtifactId: 'gallery:two',
        protectedIds: new Set(),
        confirmed: true,
    });
    const missing = appearanceLibrary.applyGalleryImageDeletion({
        gallery: [addedDuringConfirmation, galleryItem],
        targetArtifactId: 'gallery:two',
        protectedIds: new Set(),
        confirmed: true,
    });

    assert.deepEqual(deleted, { decision: 'deleted', gallery: [addedDuringConfirmation, galleryItem] });
    assert.deepEqual(missing, { decision: 'not-found', gallery: [addedDuringConfirmation, galleryItem] });
});

test('confirmed legacy image-data gallery deletion resolves the captured object after reordering', () => {
    const legacyTarget = { imageData: 'aGVsbG8=', mimeType: 'image/png', prompt: 'Legacy image' };
    const other = { ...galleryItem, id: 'gallery:other', url: '/other.png' };
    const addedDuringConfirmation = { ...galleryItem, id: 'gallery:new', url: '/new.png' };
    const reordered = [addedDuringConfirmation, other, legacyTarget];
    const deleted = appearanceLibrary.applyGalleryImageDeletion({
        gallery: reordered,
        targetItem: legacyTarget,
        protectedIds: new Set(),
        confirmed: true,
    });
    const missing = appearanceLibrary.applyGalleryImageDeletion({
        gallery: [addedDuringConfirmation, other],
        targetItem: legacyTarget,
        protectedIds: new Set(),
        confirmed: true,
    });

    assert.deepEqual(deleted, { decision: 'deleted', gallery: [addedDuringConfirmation, other] });
    assert.deepEqual(missing, { decision: 'not-found', gallery: [addedDuringConfirmation, other] });
});

test('only confirmed visible Appearance look removal mutates the library', () => {
    assert.equal(typeof appearanceLibrary.applyAppearanceLookRemoval, 'function');
    const library = addAppearanceLook({}, {
        identity: { id: 'character:ava', kind: 'character', label: 'Ava' },
        galleryItem,
    }).library;
    const cancelled = appearanceLibrary.applyAppearanceLookRemoval({
        library,
        identityId: 'character:ava',
        lookId: 'look:gallery:one',
        currentChatId: 'chat-a',
        confirmed: false,
    });
    const confirmed = appearanceLibrary.applyAppearanceLookRemoval({
        library,
        identityId: 'character:ava',
        lookId: 'look:gallery:one',
        currentChatId: 'chat-a',
        confirmed: true,
    });

    assert.equal(cancelled.decision, 'cancelled');
    assert.deepEqual(cancelled.library, library);
    assert.equal(confirmed.decision, 'removed');
    assert.deepEqual(confirmed.library.identities['character:ava'].looks, []);
});

test('appearance removal keeps the current-chat guard before asking for confirmation', () => {
    const library = migrateAppearanceLibrary({
        identities: {
            'npc:other:guide': {
                id: 'npc:other:guide', kind: 'npc', label: 'Guide', chatId: 'other', durable: false,
                looks: [{ id: 'look:guide', assetId: 'asset:guide', label: 'Guide' }],
            },
        },
        assets: { 'asset:guide': { id: 'asset:guide', source: { galleryId: 'gallery:guide' } } },
    });
    const result = appearanceLibrary.applyAppearanceLookRemoval({
        library,
        identityId: 'npc:other:guide',
        lookId: 'look:guide',
        currentChatId: 'current',
        confirmed: false,
    });

    assert.equal(result.decision, 'not-found');
    assert.deepEqual(result.library, library);
});

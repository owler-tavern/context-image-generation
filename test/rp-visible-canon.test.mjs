import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    buildVisibleCanonActionPayload,
    buildVisibleCanonMediaArtifactId,
    createVisibleCanonActionController,
    createVisibleCanonDomController,
    linkVisibleCanonMediaArtifact,
    linkVisibleCanonGalleryArtifact,
    projectVisibleCanon,
    resolveVisibleCanonIdentityId,
    VISIBLE_CANON_MIN_TOUCH_TARGET,
    visibleCanonKeyActivation,
    visibleCanonActionLabels,
    visibleCanonStatus,
} from '../lib/rp/visible-canon.js';

const identity = {
    id: 'character:ava.png',
    kind: 'character',
    label: 'Ava',
    activeLookId: null,
    looks: [
        { id: 'look:day', assetId: 'asset:day', label: 'Day outfit' },
        { id: 'look:night', assetId: 'asset:night', label: 'Night outfit' },
    ],
};
const library = {
    schema: 2,
    identities: { [identity.id]: identity },
    assets: {
        'asset:day': { id: 'asset:day', kind: 'appearance', url: '/day.png', mimeType: 'image/png' },
        'asset:night': { id: 'asset:night', kind: 'appearance', url: '/night.png', mimeType: 'image/png' },
    },
};

test('unactivated inline canon projection exposes Remember and saved-look choices', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: { schema: 1, bindings: {} },
        identityId: identity.id,
    });

    assert.equal(projection.identityLabel, 'Ava');
    assert.equal(projection.active, false);
    assert.equal(projection.locked, false);
    assert.deepEqual(projection.looks.map((look) => look.id), ['look:day', 'look:night']);
    assert.deepEqual(visibleCanonActionLabels(projection), [
        'Remember character look',
        'Change look',
    ]);
    assert.equal(visibleCanonStatus(projection), 'Identity: Ava · No look active in this chat.');
});

test('activated inline canon projection states the active lock and keeps every chat action available', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: {
            schema: 1,
            bindings: {
                [identity.id]: {
                    activeLookId: 'look:day',
                    expectedAssetId: 'asset:day',
                    isLocked: true,
                    selectedAt: 1,
                },
            },
        },
        identityId: identity.id,
    });

    assert.equal(projection.active, true);
    assert.equal(projection.activeLookLabel, 'Day outfit');
    assert.equal(projection.locked, true);
    assert.deepEqual(visibleCanonActionLabels(projection), [
        'Remember character look',
        'Change look',
        'Unlock look',
        'Stop using look',
    ]);
    assert.equal(visibleCanonStatus(projection), 'Identity: Ava · Look: Day outfit · Locked');
});

test('unlocked active look is explicit and unavailable saved files are not offered', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: {
            schema: 1,
            bindings: {
                [identity.id]: {
                    activeLookId: 'look:night',
                    expectedAssetId: 'asset:night',
                    isLocked: false,
                    selectedAt: 1,
                },
            },
        },
        identityId: identity.id,
        availableAssetIds: ['asset:night'],
    });

    assert.deepEqual(projection.looks.map((look) => look.id), ['look:night']);
    assert.equal(visibleCanonStatus(projection), 'Identity: Ava · Look: Night outfit · Unlocked');
    assert.ok(visibleCanonActionLabels(projection).includes('Lock look'));
});

test('visible canon domain remains provider-free after message controls move to Settings', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(VISIBLE_CANON_MIN_TOUCH_TARGET, 44);
    assert.doesNotMatch(index, /function renderVisibleCanonControls/u);
    assert.match(index, /function renderChatAppearanceSources/u);
    const settingsSurface = index.slice(index.indexOf('function renderChatAppearanceSources'), index.indexOf('function renderExtraStoryTools'));
    assert.doesNotMatch(settingsSurface, /dispatchProviderRoute|attachGeneratedImage|generateImageFromPrompt/u);
});

test('remembered artifact identity wins over the message sender for persona or NPC selections', () => {
    const persona = { id: 'user:persona.png', kind: 'user', label: 'Sam', looks: [{ id: 'look:sam', assetId: 'asset:sam', label: 'Sam look' }] };
    const npc = { id: 'npc:chat:guard', kind: 'npc', label: 'The guard', looks: [{ id: 'look:guard', assetId: 'asset:guard', label: 'Guard look' }] };
    const sharedLibrary = {
        schema: 2,
        identities: { [persona.id]: persona, [npc.id]: npc },
        assets: {
            'asset:sam': { id: 'asset:sam', kind: 'appearance', url: '/sam.png' },
            'asset:guard': { id: 'asset:guard', kind: 'appearance', url: '/guard.png' },
        },
    };
    const chatState = { schema: 1, bindings: {
        [persona.id]: { activeLookId: 'look:sam', expectedAssetId: 'asset:sam', isLocked: true, selectedAt: 1 },
        [npc.id]: { activeLookId: 'look:guard', expectedAssetId: 'asset:guard', isLocked: false, selectedAt: 1 },
    } };

    const linkedId = resolveVisibleCanonIdentityId({
        fallbackIdentityId: 'character:ava.png',
        media: { url: '/sam.png' },
        messageId: 4,
        gallery: [{ url: '/sam.png', messageId: 4, cig_identity_id: persona.id, cig_look_id: 'look:sam' }],
    });
    const projection = projectVisibleCanon({ library: sharedLibrary, chatState, identityId: linkedId });
    assert.equal(linkedId, persona.id);
    assert.equal(projection.identityLabel, 'Sam');
    assert.equal(visibleCanonStatus(projection), 'Identity: Sam · Look: Sam look · Locked');
});

test('artifact linking keeps the selected identity and look as one durable Gallery record', () => {
    assert.deepEqual(linkVisibleCanonGalleryArtifact({ url: '/sam.png', messageId: 4 }, {
        identityId: 'user:persona.png',
        lookId: 'look:sam',
    }), {
        url: '/sam.png',
        messageId: 4,
        cig_identity_id: 'user:persona.png',
        cig_look_id: 'look:sam',
    });
});

test('active media identity link changes with swipe-selected media', () => {
    const gallery = [{ id: 'gallery:guard', url: '/guard.png', messageId: 9, sourceMetadata: { cig_identity_id: 'npc:chat:guard' } }];
    const media = [
        { url: '/character.png', cig_owner: 'context-image-generation', cig_identity_id: 'character:ava.png' },
        { url: '/guard.png', cig_owner: 'context-image-generation' },
    ];
    assert.equal(resolveVisibleCanonIdentityId({ fallbackIdentityId: 'character:ava.png', media: media[0], messageId: 9, gallery }), 'character:ava.png');
    assert.equal(resolveVisibleCanonIdentityId({ fallbackIdentityId: 'character:ava.png', media: media[1], messageId: 9, gallery }), 'npc:chat:guard');
});

test('chat-owned media identity link wins over Gallery fallback and survives media reload shape', () => {
    const media = linkVisibleCanonMediaArtifact({ url: '/sam.png', cig_owner: 'context-image-generation' }, {
        messageId: 4,
        identityId: 'user:persona.png',
        lookId: 'look:sam',
    });
    assert.equal(buildVisibleCanonMediaArtifactId({ messageId: 4, media }), 'message:4:url:/sam.png');
    assert.deepEqual(media.cig_visible_canon, {
        artifactId: 'message:4:url:/sam.png',
        identityId: 'user:persona.png',
        lookId: 'look:sam',
    });
    assert.equal(resolveVisibleCanonIdentityId({
        fallbackIdentityId: 'character:ava.png', messageId: 4, media,
        gallery: [{ url: '/sam.png', messageId: 4, cig_identity_id: 'npc:guard' }],
    }), 'user:persona.png');
});

test('visible canon DOM action payload binds every state-changing action to displayed identity', () => {
    const dataset = {
        messageId: '4', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:sam',
    };
    for (const action of ['change', 'lock', 'stop']) {
        assert.deepEqual(buildVisibleCanonActionPayload({ dataset, action, lookId: 'look:chosen' }), {
            messageId: '4', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:chosen',
        });
    }
});

test('visible canon DOM controller executes button activation and keyboard Enter/Space without provider dispatch', async () => {
    const calls = [];
    let providerCalls = 0;
    const providerDispatch = () => { providerCalls++; throw new Error('provider must not be called'); };
    const controller = createVisibleCanonDomController({ dispatch: async (action, payload) => {
        if (action === 'generate') providerDispatch();
        calls.push([action, payload]);
    } });
    const element = {
        classList: { contains: (name) => name === 'cig_visible_canon_lock' },
        dataset: { messageId: '4', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:sam' },
    };
    const keyEvent = { type: 'keydown', key: ' ', preventDefault() {}, stopPropagation() {} };
    assert.equal(await controller.activate(element, keyEvent), true);
    assert.equal(await controller.activate(element, { type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} }), true);
    assert.deepEqual(calls, [
        ['lock', { messageId: '4', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:sam' }],
        ['lock', { messageId: '4', mediaUrl: '/sam.png', identityId: 'user:persona.png', lookId: 'look:sam' }],
    ]);
    assert.equal(providerCalls, 0);
});

test('visible canon action controller handles keyboard-equivalent actions without a provider dependency', async () => {
    const calls = [];
    let refreshes = 0;
    const controller = createVisibleCanonActionController({
        actions: {
            remember: (payload) => { calls.push(['remember', payload]); return { status: 'confirmed' }; },
            change: (payload) => { calls.push(['change', payload]); return { status: 'confirmed' }; },
            lock: (payload) => { calls.push(['lock', payload]); return { status: 'confirmed' }; },
            stop: (payload) => { calls.push(['stop', payload]); return { status: 'confirmed' }; },
        },
        refresh: () => { refreshes++; },
    });
    for (const [action, payload] of [['remember', { mediaUrl: '/x.png' }], ['change', { lookId: 'look:2' }], ['lock', { identityId: 'user:persona.png' }], ['stop', { lookId: 'look:2' }]]) {
        await controller.run(action, payload);
    }
    assert.deepEqual(calls, [
        ['remember', { mediaUrl: '/x.png' }],
        ['change', { lookId: 'look:2' }],
        ['lock', { identityId: 'user:persona.png' }],
        ['stop', { lookId: 'look:2' }],
    ]);
    assert.equal(refreshes, 4);
    assert.equal(visibleCanonKeyActivation({ key: 'Enter' }), true);
    assert.equal(visibleCanonKeyActivation({ key: ' ' }), true);
    assert.equal(visibleCanonKeyActivation({ key: 'Tab' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    captureReferenceContributorSnapshot,
    createAvatarReferenceContributor,
    createCapturedReferenceContributors,
    createPreviousImageReferenceContributor,
    createReferenceContributorPipeline,
    createSavedAppearanceReferenceContributor,
} from '../lib/scene-generation/reference-contributors.js';
import { createSceneGenerationKernel } from '../lib/scene-generation/kernel.js';

test('an empty contributor pipeline returns immutable empty collections', async () => {
    const result = await createReferenceContributorPipeline().collect({}, {});

    assert.deepEqual(result, { references: [], assets: {}, truths: [], omissions: [], notices: [] });
    assert.equal(Object.isFrozen(result), true);
});

test('an unavailable optional contributor becomes a notice without blocking the other contributors', async () => {
    const pipeline = createReferenceContributorPipeline([
        { id: 'unavailable', contribute: async () => { throw new Error('asset store offline'); } },
        { id: 'available', contribute: async () => ({ references: [{ id: 'avatar:ava' }] }) },
    ]);

    const result = await pipeline.collect({}, {});

    assert.deepEqual(result.references, [{ id: 'avatar:ava' }]);
    assert.deepEqual(result.notices, [{ contributor: 'unavailable', status: 'unavailable', message: 'asset store offline' }]);
});

test('duplicate reference and asset IDs are fatal contributor-pipeline invariants', async () => {
    for (const duplicate of [
        [{ id: 'first', contribute: async () => ({ references: [{ id: 'same' }] }) }, { id: 'second', contribute: async () => ({ references: [{ id: 'same' }] }) }],
        [{ id: 'first', contribute: async () => ({ assets: { same: { data: 'one' } } }) }, { id: 'second', contribute: async () => ({ assets: { same: { data: 'two' } } }) }],
    ]) {
        await assert.rejects(createReferenceContributorPipeline(duplicate).collect({}, {}), /Duplicate (or missing )?reference (id|asset): same/u);
    }
});

test('the standard contributor order is avatar, previous image, then saved appearance', async () => {
    const order = [];
    const pipeline = createReferenceContributorPipeline([
        createAvatarReferenceContributor({ contribute: async () => (order.push('avatar'), {}) }),
        createPreviousImageReferenceContributor({ contribute: async () => (order.push('previous'), {}) }),
        createSavedAppearanceReferenceContributor({ contribute: async () => (order.push('appearance'), {}) }),
    ]);

    await pipeline.collect({ referencesEnabled: true, avatarEnabled: true, previousImageEnabled: true, savedAppearanceEnabled: true }, {});

    assert.deepEqual(order, ['avatar', 'previous', 'appearance']);
});

test('saved appearance does not read its library while disabled', async () => {
    let reads = 0;
    const contributor = createSavedAppearanceReferenceContributor({
        contribute: async () => { reads += 1; return {}; },
    });

    const result = await createReferenceContributorPipeline([contributor]).collect({ savedAppearanceEnabled: false }, {});

    assert.equal(reads, 0);
    assert.deepEqual(result, { references: [], assets: {}, truths: [], omissions: [], notices: [] });
});

test('wand and slash dispatch valid text-only plans when optional sources are disabled, empty, or missing', async () => {
    const cases = [
        [],
        [createAvatarReferenceContributor({ contribute: async () => ({}) })],
        [createPreviousImageReferenceContributor({ contribute: async () => ({}) })],
        [createSavedAppearanceReferenceContributor({ contribute: async () => ({}) })],
    ];

    for (const contributors of cases) {
        const pipeline = createReferenceContributorPipeline(contributors);
        const dispatched = [];
        const kernel = createSceneGenerationKernel({
            capture: async (request) => ({ request, referencesEnabled: true, avatarEnabled: false, previousImageEnabled: false, savedAppearanceEnabled: false }),
            collectReferences: (snapshot, request) => pipeline.collect(snapshot, request),
            createPlan: ({ request, references }) => ({ request, references, messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }] }),
            coordinate: async (_key, run) => run(),
            dispatch: async (plan) => (dispatched.push(plan), { imageData: 'AA==', mimeType: 'image/png' }),
            generationKey: (request) => request.source,
        });

        for (const request of [
            { source: 'wand', destination: 'message', prompt: 'a harbor at dusk' },
            { source: 'slash', destination: 'preview-gallery', prompt: 'a harbor at dusk' },
        ]) await kernel.generate(request);

        assert.equal(dispatched.length, 2);
        assert.deepEqual(dispatched.map((plan) => plan.references.references), [[], []]);
        assert.deepEqual(dispatched.map((plan) => plan.messages[0].content), [
            [{ type: 'text', text: 'a harbor at dusk' }],
            [{ type: 'text', text: 'a harbor at dusk' }],
        ]);
    }
});

test('disabled appearance memory cannot influence captured identities, truths, avatar policy, or saved inputs', async () => {
    const host = {
        identities: [{ id: 'character:host.png', kind: 'character', label: 'Host character', hostKey: 'host.png' }],
        truths: [{ identityId: 'character:host.png', sourceType: 'avatar', description: { text: 'host description' } }],
        activeCharacterAvatar: 'host.png',
        personaAvatar: 'persona.png',
        groupCharacterAvatars: [],
        assetSources: { 'character:host.png': { url: '/characters/host.png' } },
    };
    const poisonedAppearance = {};
    for (const key of ['identities', 'truths', 'sourcePreferences', 'savedInput']) {
        Object.defineProperty(poisonedAppearance, key, { enumerable: true, get() { throw new Error(`appearance ${key} was read`); } });
    }

    const captured = captureReferenceContributorSnapshot({
        referencesEnabled: true,
        avatarEnabled: true,
        previousImageEnabled: false,
        savedAppearanceEnabled: false,
        host,
        previous: { item: null },
        appearance: poisonedAppearance,
    });

    assert.deepEqual(captured.identities, host.identities);
    assert.deepEqual(captured.avatar.truths, host.truths);
    assert.deepEqual(captured.avatar.sourcePreferences, {});
    assert.equal(captured.saved.enabled, false);
    assert.equal(captured.saved.input, null);
    assert.doesNotMatch(JSON.stringify(captured), /rp_library|bindings|identityPins|appearanceSources/u);
});

test('contributors use one immutable capture when live chat state changes during delayed materialization', async () => {
    let releaseAvatar;
    let avatarStarted;
    const started = new Promise((resolve) => { avatarStarted = resolve; });
    const waitForRelease = new Promise((resolve) => { releaseAvatar = resolve; });
    const live = {
        host: {
            identities: [{ id: 'character:a.png', kind: 'character', label: 'A', hostKey: 'a.png' }],
            truths: [{ identityId: 'character:a.png', sourceType: 'avatar' }],
            activeCharacterAvatar: 'a.png', personaAvatar: '', groupCharacterAvatars: [], assetSources: {},
        },
        appearance: {
            identities: [{ id: 'character:a.png', kind: 'character', label: 'A', hostKey: 'a.png' }],
            truths: [{ identityId: 'character:a.png', sourceType: 'avatar' }],
            sourcePreferences: { 'character:a.png': { sourceType: 'avatar' } },
            savedInput: { chatId: 'chat-a', library: { active: 'look-a' }, gallery: [{ id: 'gallery-a' }], chatState: { binding: 'look-a' } },
        },
    };
    const captured = captureReferenceContributorSnapshot({
        referencesEnabled: true, avatarEnabled: true, previousImageEnabled: false, savedAppearanceEnabled: true,
        host: live.host, previous: { item: null }, appearance: live.appearance,
    });
    const contributors = createCapturedReferenceContributors({
        resolveAvatarReferences: (input) => [{ id: `avatar:${input.activeCharacterAvatar}`, role: 'host-avatar', assetId: 'asset:avatar' }],
        materializeAvatarAssets: async (input) => {
            avatarStarted();
            await waitForRelease;
            return { 'asset:avatar': { data: input.activeCharacterAvatar } };
        },
        resolveSavedAppearance: (input) => ({
            references: [{ id: input.library.active, role: 'identity-look', assetId: 'asset:saved' }],
            assets: { 'asset:saved': { data: input.chatState.binding } },
            omissions: [],
        }),
    });

    const collecting = createReferenceContributorPipeline(contributors).collect(captured, { source: 'wand' });
    await started;
    live.host.activeCharacterAvatar = 'b.png';
    live.appearance.savedInput.chatId = 'chat-b';
    live.appearance.savedInput.library.active = 'look-b';
    live.appearance.savedInput.chatState.binding = 'look-b';
    releaseAvatar();
    const result = await collecting;

    assert.deepEqual(result.references.map((entry) => entry.id), ['avatar:a.png', 'look-a']);
    assert.equal(result.assets['asset:avatar'].data, 'a.png');
    assert.equal(result.assets['asset:saved'].data, 'look-a');
    assert.equal(Object.isFrozen(captured), true);
    assert.equal(Object.isFrozen(captured.saved.input), true);
});

test('saved appearance resolves from its own captured assets when previous-image use is disabled', async () => {
    let previousReads = 0;
    let savedInput;
    const captured = captureReferenceContributorSnapshot({
        referencesEnabled: true,
        avatarEnabled: false,
        previousImageEnabled: false,
        savedAppearanceEnabled: true,
        host: { identities: [], truths: [], assetSources: {} },
        previous: { item: null },
        appearance: {
            identities: [], truths: [], sourcePreferences: {},
            savedInput: { library: { active: 'look-a' }, gallery: [{ id: 'appearance-gallery-a' }], chatState: {} },
        },
    });
    const contributors = createCapturedReferenceContributors({
        materializePreviousImage: async () => { previousReads += 1; return null; },
        resolveSavedAppearance: (input) => {
            savedInput = input;
            return { references: [{ id: 'look-a', role: 'identity-look', assetId: 'asset:a' }], assets: { 'asset:a': { data: 'saved' } }, omissions: [] };
        },
    });

    const result = await createReferenceContributorPipeline(contributors).collect(captured, { source: 'slash' });

    assert.equal(previousReads, 0);
    assert.deepEqual(savedInput.gallery, [{ id: 'appearance-gallery-a' }]);
    assert.deepEqual(result.references.map((entry) => entry.id), ['look-a']);
});

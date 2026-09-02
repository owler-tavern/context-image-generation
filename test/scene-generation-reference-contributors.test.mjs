import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createAvatarReferenceContributor,
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

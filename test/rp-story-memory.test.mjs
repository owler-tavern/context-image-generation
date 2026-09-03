import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addStoryArtifact,
    addStoryCollectionMember,
    buildStoryArtifactId,
    createStoryCollection,
    createStoryMemory,
    buildReproductionInput,
    getGenerationDetails,
    getStoryArtifactProvenance,
    getStoryTimeline,
    listStoryCollectionMembers,
    migrateGalleryEntries,
    migrateStoryMemory,
    planContinueFromScene,
    removeStoryCollectionMember,
    resolveArtifactIdAlias,
    resolveArtifactIdAliasStatus,
    searchStoryArtifacts,
    STORY_MEMORY_SCHEMA,
    toggleStoryFavorite,
} from '../lib/rp/story-memory.js';

function generated({ chatId = 'chat-a', messageId = 1, id = `gallery-${chatId}-${messageId}`, ...overrides } = {}) {
    return {
        id,
        url: `/user/images/${id}.png`,
        chatId,
        messageId,
        createdAt: `2026-08-${String(messageId).padStart(2, '0')}T10:00:00.000Z`,
        taskId: `task-${messageId}`,
        characterIds: ['character:ava'],
        prompt: `prompt ${messageId}`,
        model: 'model-a',
        sourceMoment: { passage: `Ava scene ${messageId}`, sender: 'Ava' },
        generation: {
            sourcePassage: `Ava scene ${messageId}`,
            effectivePrompt: `effective prompt ${messageId}`,
            references: [{ role: 'character', id: 'look:ava' }],
            model: 'model-a',
            settings: { width: 512, height: 768, steps: 24 },
        },
        facts: [
            { id: 'location:harbor', value: 'old harbor', status: 'valid' },
            { id: 'outfit:coat', value: 'blue coat', status: 'obsolete' },
        ],
        ...overrides,
    };
}

test('migrates Gallery entries to stable, reference-only artifacts and preserves unknown metadata honestly', () => {
    const gallery = [{
        id: 'gallery-1', url: '/images/one.png', messageId: 7, prompt: 'harbor',
        timestamp: '2026-08-07T00:00:00.000Z',
        sourceMetadata: { model: 'model-x', customFlag: 'kept', nested: { value: 1 } },
        imageData: 'data:image/png;base64,do-not-copy',
    }];
    const first = migrateGalleryEntries(gallery, { chatId: 'chat-a' });
    const second = migrateGalleryEntries(gallery, { chatId: 'chat-a' });
    assert.deepEqual(first, second);
    assert.equal(first[0].id, 'story:v1:6:chat-a:9:gallery-1');
    assert.equal(first[0].url, '/images/one.png');
    assert.equal(first[0].model, 'model-x');
    assert.equal(first[0].createdAt, '2026-08-07T00:00:00.000Z');
    assert.equal('imageData' in first[0], false);
    assert.deepEqual(first[0].legacyMetadata.sourceMetadata.nested, { value: 1 });
    assert.deepEqual(first[0].legacyMetadata.omittedFields, ['imageData']);
});

test('upgrades legacy story IDs, merges the matching Gallery physical artifact, and remaps collection membership idempotently', () => {
    const gallery = [{ id: 'gallery-legacy', url: '/legacy.png', chatId: 'chat-a', messageId: 8, prompt: 'legacy scene' }];
    const legacyId = 'story:chat-a:gallery-legacy';
    const legacy = {
        schema: 1,
        artifacts: {
            [legacyId]: {
                id: legacyId, url: '/legacy.png', chatId: 'chat-a', messageId: 8,
                favorite: true, customNote: 'retain',
                provenance: { schema: 1, source: 'story-memory', chatId: 'chat-a', galleryArtifactId: 'gallery-legacy' },
            },
        },
        collections: { canon: { id: 'canon', kind: 'canon-look', label: 'Canon', memberIds: [legacyId] } },
    };
    const migrated = migrateStoryMemory(legacy, { gallery, chatId: 'chat-a' });
    const canonicalId = 'story:v1:6:chat-a:14:gallery-legacy';
    assert.equal(migrated.schema, STORY_MEMORY_SCHEMA);
    assert.deepEqual(Object.keys(migrated.artifacts), [canonicalId]);
    assert.equal(migrated.artifacts[canonicalId].favorite, true);
    assert.equal(migrated.artifacts[canonicalId].customNote, 'retain');
    assert.ok(migrated.artifacts[canonicalId].aliases.includes(legacyId));
    assert.deepEqual(migrated.collections.canon.memberIds, [canonicalId]);
    assert.deepEqual(migrated, migrateStoryMemory(migrated, { gallery, chatId: 'chat-a' }));
});

test('resolves migrated artifact aliases across every ID-based story-memory entrypoint', () => {
    const canonicalId = 'story:v1:6:chat-a:14:gallery-legacy';
    const legacyId = 'story:chat-a:gallery-legacy';
    const artifact = generated({ id: canonicalId, url: '/legacy.png', chatId: 'chat-a', messageId: 8 });
    let memory = addStoryArtifact(createStoryMemory(), { ...artifact, aliases: [legacyId] });

    assert.equal(resolveArtifactIdAlias(memory, legacyId), canonicalId);
    assert.deepEqual(getGenerationDetails(memory, legacyId), getGenerationDetails(memory, canonicalId));
    assert.deepEqual(getStoryArtifactProvenance(memory, legacyId), getStoryArtifactProvenance(memory, canonicalId));
    assert.deepEqual(buildReproductionInput(memory, legacyId), buildReproductionInput(memory, canonicalId));
    assert.deepEqual(planContinueFromScene(memory, legacyId, { at: '2026-08-01' }), planContinueFromScene(memory, canonicalId, { at: '2026-08-01' }));

    memory = toggleStoryFavorite(memory, legacyId, true);
    assert.equal(memory.artifacts[canonicalId].favorite, true);
    assert.equal(memory.artifacts[legacyId], undefined);

    memory = addStoryCollectionMember(memory, { collectionId: 'legacy-members', artifactId: legacyId });
    assert.deepEqual(memory.collections['legacy-members'].memberIds, [canonicalId]);
    assert.deepEqual(listStoryCollectionMembers(memory, 'legacy-members').map((item) => item.id), [canonicalId]);
    memory = removeStoryCollectionMember(memory, 'legacy-members', legacyId);
    assert.deepEqual(memory.collections['legacy-members'].memberIds, []);

    memory = addStoryArtifact(memory, { ...artifact, id: legacyId, prompt: 'updated through alias' });
    assert.equal(memory.artifacts[canonicalId].prompt, 'updated through alias');
    assert.equal(Object.keys(memory.artifacts).length, 1);
    assert.ok(memory.artifacts[canonicalId].aliases.includes(legacyId));
});

test('migrates collection aliases and rejects unknown or ambiguous alias resolution safely', () => {
    const canonicalId = 'canonical-artifact';
    const legacyId = 'legacy-artifact';
    const migrated = migrateStoryMemory({
        artifacts: { [canonicalId]: { ...generated({ id: canonicalId }), aliases: [legacyId] } },
        collections: { canon: { id: 'canon', memberIds: [legacyId] } },
    });
    assert.equal(resolveArtifactIdAlias(migrated, legacyId), canonicalId);
    assert.deepEqual(migrated.collections.canon.memberIds, [canonicalId]);
    assert.equal(resolveArtifactIdAlias(migrated, 'missing-artifact'), null);

    const ambiguous = {
        artifacts: {
            first: { ...generated({ id: 'first' }), aliases: ['shared-alias'] },
            second: { ...generated({ id: 'second' }), aliases: ['shared-alias'] },
        },
    };
    assert.equal(resolveArtifactIdAlias(ambiguous, 'shared-alias'), null);

    const cyclic = {
        artifacts: {
            first: { ...generated({ id: 'first' }), aliases: ['second'] },
            second: { ...generated({ id: 'second' }), aliases: ['first'] },
        },
    };
    assert.equal(resolveArtifactIdAlias(cyclic, 'first'), null);
    assert.equal(resolveArtifactIdAlias(cyclic, 'second'), null);
});

test('reports alias resolution status and rejects conflicted IDs before artifact mutation', () => {
    const ambiguous = {
        artifacts: {
            first: { ...generated({ id: 'first' }), aliases: ['shared-alias'] },
            second: { ...generated({ id: 'second' }), aliases: ['shared-alias'] },
        },
    };
    assert.deepEqual(resolveArtifactIdAliasStatus(ambiguous, 'first'), { status: 'resolved', canonicalId: 'first' });
    assert.deepEqual(resolveArtifactIdAliasStatus(ambiguous, 'shared-alias'), { status: 'ambiguous', canonicalId: null });
    assert.deepEqual(resolveArtifactIdAliasStatus(ambiguous, 'missing-alias'), { status: 'missing', canonicalId: null });
    assert.throws(() => addStoryArtifact(ambiguous, { ...generated({ id: 'shared-alias' }), url: '/same.png' }), /ambiguous/i);
    assert.equal(ambiguous.artifacts['shared-alias'], undefined);

    const canonicalCollision = {
        artifacts: {
            first: { ...generated({ id: 'first' }) },
            second: { ...generated({ id: 'second' }), aliases: ['first'] },
        },
    };
    assert.deepEqual(resolveArtifactIdAliasStatus(canonicalCollision, 'first'), { status: 'ambiguous', canonicalId: null });
    assert.throws(() => addStoryArtifact(canonicalCollision, { ...generated({ id: 'first' }), url: '/same.png' }), /ambiguous/i);

    const cyclic = {
        artifacts: {
            first: { ...generated({ id: 'first' }), aliases: ['second'] },
            second: { ...generated({ id: 'second' }), aliases: ['first'] },
        },
    };
    assert.deepEqual(resolveArtifactIdAliasStatus(cyclic, 'first'), { status: 'cycle', canonicalId: null });
    assert.throws(() => addStoryArtifact(cyclic, { ...generated({ id: 'first' }), url: '/same.png' }), /cycle/i);
    assert.equal(cyclic.artifacts.first.prompt, 'prompt 1');

    const fallbackId = buildStoryArtifactId({ item: { id: 'legacy-id', chatId: 'chat-b', messageId: 7 }, chatId: 'chat-b' });
    const fallbackCollision = {
        artifacts: {
            target: { ...generated({ id: 'target', chatId: 'chat-a' }), aliases: ['legacy-id'] },
            [fallbackId]: { ...generated({ id: fallbackId, chatId: 'chat-a' }), url: '/user/images/legacy-id.png' },
            other: { ...generated({ id: 'other', chatId: 'chat-a' }), aliases: [fallbackId] },
        },
    };
    assert.throws(() => addStoryArtifact(fallbackCollision, generated({ id: 'legacy-id', chatId: 'chat-b', messageId: 7 })), /ambiguous/i);
});

test('artifact IDs are unambiguous for delimiter-heavy chat/source values', () => {
    const first = buildStoryArtifactId({ chatId: 'a:b', item: { id: 'c', url: '/one.png' } });
    const second = buildStoryArtifactId({ chatId: 'a', item: { id: 'b:c', url: '/one.png' } });
    assert.notEqual(first, second);
    assert.equal(first, buildStoryArtifactId({ chatId: 'a:b', item: { id: 'c', url: '/one.png' } }));
});

test('conflicting duplicate explicit IDs are rejected while idempotent reingestion preserves user fields', () => {
    const first = addStoryArtifact(createStoryMemory(), { ...generated({ id: 'same-id' }), favorite: true, customNote: 'keep me' });
    assert.throws(() => addStoryArtifact(first, { ...generated({ id: 'same-id' }), url: '/different.png' }), /duplicate|conflict/i);
    const reingested = addStoryArtifact(first, { ...generated({ id: 'same-id' }), prompt: 'updated prompt' });
    assert.equal(reingested.artifacts['same-id'].favorite, true);
    assert.equal(reingested.artifacts['same-id'].customNote, 'keep me');
    assert.equal(reingested.artifacts['same-id'].prompt, 'updated prompt');
});

test('nested binary fields are omitted from references, provenance, and legacy metadata', () => {
    const artifact = generated({ id: 'nested-binary', generation: {
        sourcePassage: 'passage', effectivePrompt: 'prompt',
        references: [{ id: 'look:1', data: 'bytes', nested: { base64: 'bytes', blob: 'bytes' } }],
        model: 'model-a', settings: {},
    }, provenance: { source: 'test', nested: { imageData: 'bytes', data: 'bytes' } }, metadata: { nested: { blob: 'bytes', keep: true } } });
    const memory = addStoryArtifact(createStoryMemory(), artifact);
    const saved = memory.artifacts[artifact.id];
    assert.equal('data' in saved.generation.references[0], false);
    assert.equal('base64' in saved.generation.references[0].nested, false);
    assert.equal('blob' in saved.generation.references[0].nested, false);
    assert.equal('imageData' in saved.provenance.nested, false);
    assert.equal(saved.metadata.nested.keep, true);
    assert.equal('blob' in saved.metadata.nested, false);
});

test('timeline remains chat-scoped, ordered for long histories, and does not mutate input', () => {
    let memory = createStoryMemory();
    const entries = Array.from({ length: 120 }, (_, index) => generated({ messageId: 120 - index }));
    entries.push(generated({ chatId: 'chat-b', messageId: 1, id: 'other-chat-image' }));
    const before = structuredClone(memory);
    for (const entry of entries) memory = addStoryArtifact(memory, entry);
    assert.deepEqual(memory.schema, 2);
    assert.deepEqual(memory.artifacts['gallery-chat-a-120'].messageId, 120);
    assert.deepEqual(getStoryTimeline(memory, { chatId: 'chat-a' }).map((item) => item.messageId), Array.from({ length: 120 }, (_, index) => index + 1));
    assert.deepEqual(getStoryTimeline(memory, { chatId: 'chat-b' }).map((item) => item.id), ['other-chat-image']);
    assert.deepEqual(before, createStoryMemory());
});

test('timeline uses source sequence/order before date and ID tie-breakers', () => {
    let memory = createStoryMemory();
    memory = addStoryArtifact(memory, generated({ id: 'tie-z', messageId: 4, sequence: 2, createdAt: '2026-08-01T00:00:00Z' }));
    memory = addStoryArtifact(memory, generated({ id: 'tie-a', messageId: 4, sequence: 1, createdAt: '2026-08-02T00:00:00Z' }));
    memory = addStoryArtifact(memory, generated({ id: 'order-2', messageId: 5, order: 2 }));
    memory = addStoryArtifact(memory, generated({ id: 'order-1', messageId: 5, order: 1 }));
    assert.deepEqual(getStoryTimeline(memory, { chatId: 'chat-a' }).map((item) => item.id), ['tie-a', 'tie-z', 'order-1', 'order-2']);
});

test('favorites persist on the artifact record without creating or moving media', () => {
    const artifact = generated({ id: 'favorite-1' });
    const memory = addStoryArtifact(createStoryMemory(), artifact);
    const favored = toggleStoryFavorite(memory, artifact.id, true);
    assert.equal(favored.artifacts[artifact.id].favorite, true);
    assert.equal(Object.keys(favored.artifacts).length, 1);
    assert.equal(favored.artifacts[artifact.id].url, artifact.url);
    assert.equal(memory.artifacts[artifact.id].favorite, false);
    assert.equal(toggleStoryFavorite(favored, artifact.id).artifacts[artifact.id].favorite, false);
});

test('search composes character, chat, task, model, prompt, and date filters', () => {
    let memory = createStoryMemory();
    memory = addStoryArtifact(memory, generated({ id: 'match', chatId: 'chat-a', messageId: 5, taskId: 'task-target', model: 'model-target', prompt: 'moonlit harbor', createdAt: '2026-08-05T00:00:00Z', characterIds: ['character:ava'] }));
    memory = addStoryArtifact(memory, generated({ id: 'wrong-chat', chatId: 'chat-b', messageId: 5, taskId: 'task-target', model: 'model-target', prompt: 'moonlit harbor', createdAt: '2026-08-05T00:00:00Z' }));
    memory = addStoryArtifact(memory, generated({ id: 'wrong-prompt', chatId: 'chat-a', messageId: 6, taskId: 'task-target', model: 'model-target', prompt: 'sunny room', createdAt: '2026-08-05T00:00:00Z' }));
    assert.deepEqual(searchStoryArtifacts(memory, {
        characterId: 'character:ava', chatId: 'chat-a', taskId: 'task-target', model: 'model-target',
        prompt: 'MOONLIT', from: '2026-08-01', to: '2026-08-10',
    }).map((item) => item.id), ['match']);
});

test('date aliases are inclusive for date-only end bounds and invalid bounds fail explicitly', () => {
    let memory = createStoryMemory();
    memory = addStoryArtifact(memory, generated({ id: 'boundary', createdAt: '2026-08-10T23:59:59.999Z' }));
    assert.deepEqual(searchStoryArtifacts(memory, { dateFrom: '2026-08-10', dateTo: '2026-08-10' }).map((item) => item.id), ['boundary']);
    assert.throws(() => searchStoryArtifacts(memory, { from: 'not-a-date' }), /date|bound|invalid/i);
    assert.throws(() => searchStoryArtifacts(memory, { from: '2026-08-11', to: '2026-08-10' }), /range|bound|before/i);
});

test('active collections contain artifact IDs only and support non-outfit labels', () => {
    let memory = addStoryArtifact(createStoryMemory(), generated({ id: 'collection-image' }));
    memory = addStoryCollectionMember(memory, { collectionId: 'canon-harbor', kind: 'location', label: 'Harbor', artifactId: 'collection-image' });
    memory = addStoryCollectionMember(memory, { collectionId: 'canon-harbor', kind: 'location', label: 'Harbor', artifactId: 'collection-image' });
    assert.deepEqual(listStoryCollectionMembers(memory, 'canon-harbor').map((member) => member.id), ['collection-image']);
    assert.equal(memory.collections['canon-harbor'].kind, 'location');
    assert.equal(memory.artifacts['collection-image'].url, '/user/images/collection-image.png');
});

test('historical outfit collections remain readable but reject every active mutation', () => {
    const first = generated({ id: 'look-one' });
    const second = generated({ id: 'look-two', messageId: 2 });
    const legacy = createStoryMemory({
        schema: 2,
        artifacts: { [first.id]: first, [second.id]: second },
        collections: {
            wardrobe: {
                id: 'wardrobe',
                kind: 'outfit',
                label: 'Old wardrobe',
                memberIds: [first.id],
                legacyNote: 'preserve me',
            },
        },
    });

    assert.equal(legacy.collections.wardrobe.kind, 'outfit');
    assert.equal(legacy.collections.wardrobe.legacyNote, 'preserve me');
    assert.deepEqual(listStoryCollectionMembers(legacy, 'wardrobe').map((member) => member.id), [first.id]);
    assert.throws(() => createStoryCollection(legacy, { collectionId: 'new-wardrobe', kind: 'outfit' }), /legacy outfit collections are read-only/i);
    assert.throws(() => createStoryCollection(legacy, { collectionId: 'spaced-wardrobe', kind: ' outfit ' }), /legacy outfit collections are read-only/i);
    assert.throws(() => createStoryCollection(legacy, { collectionId: 'wardrobe', kind: 'location' }), /legacy outfit collections are read-only/i);
    assert.throws(() => addStoryCollectionMember(legacy, { collectionId: 'wardrobe', artifactId: second.id }), /legacy outfit collections are read-only/i);
    assert.throws(() => removeStoryCollectionMember(legacy, 'wardrobe', first.id), /legacy outfit collections are read-only/i);
    assert.deepEqual(legacy.collections.wardrobe.memberIds, [first.id]);
});

test('memory migration repairs and reports dangling collection members', () => {
    const migrated = migrateStoryMemory({
        artifacts: { keep: generated({ id: 'keep' }) },
        collections: { moments: { id: 'moments', kind: 'moment', label: 'Moments', memberIds: ['keep', 'missing'] } },
    });
    assert.deepEqual(migrated.collections.moments.memberIds, ['keep']);
    assert.deepEqual(migrated.migrationReport.danglingCollectionMembers, [{ collectionId: 'moments', artifactId: 'missing' }]);
});

test('generation details and reproduction inputs are stable value snapshots', () => {
    const artifact = generated({ id: 'details-1' });
    const memory = addStoryArtifact(createStoryMemory(), artifact);
    const details = getGenerationDetails(memory, artifact.id);
    assert.deepEqual(details, artifact.generation);
    details.settings.width = 1;
    assert.equal(getGenerationDetails(memory, artifact.id).settings.width, 512);
    assert.deepEqual(getGenerationDetails(memory, artifact.id), getGenerationDetails(memory, artifact.id));
    const recipe = buildReproductionInput(memory, artifact.id);
    assert.deepEqual(recipe, buildReproductionInput(memory, artifact.id));
    assert.equal(recipe.sourcePassage, artifact.generation.sourcePassage);
    assert.deepEqual(recipe.references, artifact.generation.references);
    recipe.settings.width = 1;
    assert.equal(buildReproductionInput(memory, artifact.id).settings.width, 512);
    assert.deepEqual(recipe.sourceMoment, artifact.sourceMoment);
    assert.deepEqual(recipe.facts, [{ id: 'location:harbor', value: 'old harbor', status: 'valid' }]);
    assert.equal(recipe.chatId, artifact.chatId);
    assert.equal(recipe.messageId, artifact.messageId);
    assert.equal(recipe.taskId, artifact.taskId);
});

test('Continue from this scene selects the prior image and excludes obsolete facts', () => {
    const artifact = generated({ id: 'continue-1' });
    const memory = addStoryArtifact(createStoryMemory(), artifact);
    const plan = planContinueFromScene(memory, artifact.id);
    assert.equal(plan.sourceArtifactId, artifact.id);
    assert.equal(plan.selectedImage.url, artifact.url);
    assert.deepEqual(plan.facts, [{ id: 'location:harbor', value: 'old harbor', status: 'valid' }]);
    assert.deepEqual(plan.generation, artifact.generation);
    assert.equal(plan.facts.some((fact) => fact.status === 'obsolete'), false);
});

test('Continue filters temporal, superseded, unauthorized, and unrelated-scene facts', () => {
    const artifact = generated({ id: 'validity-1', sourceMoment: { id: 'scene-1', scope: 'scene-1', passage: 'scene' }, facts: [
        { id: 'before', value: 1, validFrom: '2026-09-02' },
        { id: 'after', value: 2, validUntil: '2026-08-31' },
        { id: 'superseded', value: 3, supersededBy: 'newer' },
        { id: 'old-version', value: 4, version: 1, currentVersion: 2 },
        { id: 'untrusted', value: 5, reconciliation: { isAuthoritative: false } },
        { id: 'other-scene', value: 6, scope: 'scene-2' },
        { id: 'accepted', value: 7, scope: 'scene-1', validFrom: '2026-08-01', validUntil: '2026-09-30' },
    ] });
    const memory = addStoryArtifact(createStoryMemory(), artifact);
    const plan = planContinueFromScene(memory, artifact.id, { at: '2026-09-01' });
    assert.deepEqual(plan.facts.map((fact) => fact.id), ['accepted']);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addStoryArtifact,
    addStoryCollectionMember,
    createStoryMemory,
    buildReproductionInput,
    getGenerationDetails,
    getStoryTimeline,
    listStoryCollectionMembers,
    migrateGalleryEntries,
    planContinueFromScene,
    searchStoryArtifacts,
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
    assert.equal(first[0].id, 'story:chat-a:gallery-1');
    assert.equal(first[0].url, '/images/one.png');
    assert.equal(first[0].model, 'model-x');
    assert.equal(first[0].createdAt, '2026-08-07T00:00:00.000Z');
    assert.equal('imageData' in first[0], false);
    assert.deepEqual(first[0].legacyMetadata.sourceMetadata.nested, { value: 1 });
    assert.deepEqual(first[0].legacyMetadata.omittedFields, ['imageData']);
});

test('timeline remains chat-scoped, ordered for long histories, and does not mutate input', () => {
    let memory = createStoryMemory();
    const entries = Array.from({ length: 120 }, (_, index) => generated({ messageId: 120 - index }));
    entries.push(generated({ chatId: 'chat-b', messageId: 1, id: 'other-chat-image' }));
    const before = structuredClone(memory);
    for (const entry of entries) memory = addStoryArtifact(memory, entry);
    assert.deepEqual(memory.schema, 1);
    assert.deepEqual(memory.artifacts['gallery-chat-a-120'].messageId, 120);
    assert.deepEqual(getStoryTimeline(memory, { chatId: 'chat-a' }).map((item) => item.messageId), Array.from({ length: 120 }, (_, index) => index + 1));
    assert.deepEqual(getStoryTimeline(memory, { chatId: 'chat-b' }).map((item) => item.id), ['other-chat-image']);
    assert.deepEqual(before, createStoryMemory());
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

test('collections contain artifact IDs only and support canon look, location, outfit, and moment labels', () => {
    let memory = addStoryArtifact(createStoryMemory(), generated({ id: 'collection-image' }));
    memory = addStoryCollectionMember(memory, { collectionId: 'canon-harbor', kind: 'location', label: 'Harbor', artifactId: 'collection-image' });
    memory = addStoryCollectionMember(memory, { collectionId: 'canon-harbor', kind: 'location', label: 'Harbor', artifactId: 'collection-image' });
    assert.deepEqual(listStoryCollectionMembers(memory, 'canon-harbor').map((member) => member.id), ['collection-image']);
    assert.equal(memory.collections['canon-harbor'].kind, 'location');
    assert.equal(memory.artifacts['collection-image'].url, '/user/images/collection-image.png');
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

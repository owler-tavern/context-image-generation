import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSceneGenerationSnapshot,
    buildScenePrompt,
    createSceneStatePending,
    createSceneArtifactMetadata,
    persistAcceptedSceneState,
    sceneStatePendingKey,
} from '../lib/rp/scene-generation.js';

const identities = [
    { id: 'character:ava', kind: 'character', label: 'Ava', aliases: ['Ava'] },
    { id: 'user:sam', kind: 'user', label: 'Sam', aliases: ['Sam'] },
];

test('selected passage is the immutable scene focus while recent context only enriches state', () => {
    const snapshot = buildSceneGenerationSnapshot({
        selectedPassage: 'Ava raises the lantern.',
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava waits at the library.' },
        recentContext: [{ name: 'Sam', role: 'character', mes: 'Sam waits at the library.' }],
        identities,
        priorStoryState: { sceneFacts: { location: 'station' } },
        settings: { framing_preference: 'medium', continuity_strength: 'strong' },
    });

    assert.equal(snapshot.interpretation.focusPassage.source, 'selected-passage');
    assert.equal(snapshot.interpretation.focusPassage.text, 'Ava raises the lantern.');
    assert.equal(snapshot.state.sceneFacts.location, 'library');
    assert.match(snapshot.prompt, /Ava raises the lantern\./);
    assert.match(snapshot.prompt, /Location: library/);
    assert.match(snapshot.prompt, /Framing: medium/);
    assert.equal(snapshot.sourcePassage, 'Ava raises the lantern.');
});

test('prompt excludes narrator, absent, and obsolete facts while preserving unknown state as unknown', () => {
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava is at the library.' },
        recentContext: [
            { name: 'Narrator', role: 'narrator', mes: 'Sam is at the station.' },
            { name: 'Sam', role: 'character', mes: 'Sam is absent.' },
        ],
        identities,
        priorStoryState: { sceneFacts: { location: 'station', cast: [{ identityId: 'user:sam', label: 'Sam' }] } },
    });

    assert.equal(snapshot.state.sceneFacts.location, 'library');
    assert.equal(snapshot.state.sceneFacts.cast.some((entry) => entry.identityId === 'user:sam'), false);
    assert.doesNotMatch(snapshot.prompt, /Sam is at the station/);
    assert.doesNotMatch(snapshot.prompt, /Narrator/);
});

test('scene state pending entries are chat-scoped and clone inputs', () => {
    const state = { schema: 1, sceneFacts: { location: 'library' } };
    const entry = createSceneStatePending({ chatId: 'chat-a', epoch: 2, state, target: { messageId: 4 } });
    state.sceneFacts.location = 'mutated';
    assert.equal(sceneStatePendingKey(entry), 'chat-a');
    assert.equal(entry.state.sceneFacts.location, 'library');
    assert.equal(entry.target.messageId, 4);
});

test('prompt builder captures durable visual defaults without provider calls', () => {
    const prompt = buildScenePrompt({
        sourcePassage: 'Ava smiles.',
        state: { sceneFacts: { cast: [{ label: 'Ava' }] } },
        settings: { framing_preference: 'close-up', continuity_strength: 'minimal', custom_visual_instruction: 'Warm dusk light.' },
    });
    assert.match(prompt, /Framing: close-up/);
    assert.match(prompt, /Continuity strength: minimal/);
    assert.match(prompt, /Warm dusk light\./);
});

test('scene artifact metadata preserves the safe inspection and exact source moment', () => {
    const snapshot = buildSceneGenerationSnapshot({
        selectedPassage: 'Ava raises the lantern.',
        identities,
        settings: { framing_preference: 'close-up' },
    });
    const metadata = createSceneArtifactMetadata(snapshot);

    assert.equal(metadata.schema, 1);
    assert.equal(metadata.sourcePassage, 'Ava raises the lantern.');
    assert.deepEqual(metadata.inspection, snapshot.inspection);
    assert.equal(metadata.prompt, snapshot.prompt);
    assert.equal(Object.hasOwn(metadata, 'state'), false);
    assert.equal(Object.hasOwn(metadata, 'interpretation'), false);
});

test('accepted scene state is read back before pending state is cleared', async () => {
    const calls = [];
    const pending = createSceneStatePending({ chatId: 'chat-a', epoch: 1, state: { sceneFacts: { location: 'library' } } });
    let current = { sceneFacts: { location: 'station' } };
    const result = await persistAcceptedSceneState({
        pending,
        isCurrent: () => true,
        getState: () => current,
        setState: (value) => { current = value; calls.push('set'); },
        savePending: async () => calls.push('pending'),
        saveChat: async () => { calls.push('chat'); return { saved: true }; },
        readback: async () => { calls.push('readback'); return { status: 'confirmed' }; },
        removePending: async () => calls.push('remove'),
    });

    assert.equal(result.status, 'confirmed');
    assert.deepEqual(calls, ['pending', 'set', 'chat', 'readback', 'remove']);
    assert.deepEqual(current, { sceneFacts: { location: 'library' } });
});

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
import { resolveHostAvatarIdentityReferences, selectSceneRelevantAvatarReferences } from '../lib/rp/canon-generation-capture.js';

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
    assert.doesNotMatch(snapshot.prompt, /Framing:|Continuity strength:/);
    assert.equal(snapshot.sourcePassage, 'Ava raises the lantern.');
});

test('a long clicked message is bounded instead of losing the scene moment', () => {
    const opening = 'Ava crosses the desert with thirty riders while a sandstorm gathers. ';
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: opening + 'x'.repeat(13000) },
        identities,
        settings: { framing_preference: 'wide', continuity_strength: 'balanced' },
    });

    assert.equal(snapshot.interpretation.focusPassage.source, 'clicked-message');
    assert.match(snapshot.sourcePassage, /^Ava crosses the desert with thirty riders/u);
    assert.match(snapshot.prompt, /^Ava crosses the desert with thirty riders/u);
    assert.doesNotMatch(snapshot.prompt, /Scene moment unavailable/u);
    assert.ok(snapshot.sourcePassage.length <= 12000);
});

test('the ordinary wand keeps the exact clicked message as primary source when no highlight is selected', () => {
    const clicked = 'A quiet exchange happens under the old bridge, with no named location cue.';
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: clicked },
        identities,
    });
    assert.equal(snapshot.sourcePassage, clicked);
    assert.match(snapshot.prompt, new RegExp(`^${clicked.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`));
});

test('a selected highlight wins over the clicked message while interpretation remains supporting context', () => {
    const snapshot = buildSceneGenerationSnapshot({
        focusText: 'Ava lifts the blue lantern.',
        selectedPassage: 'Ava lifts the blue lantern.',
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava waits beside the old bridge.' },
        identities,
    });
    assert.equal(snapshot.sourcePassage, 'Ava lifts the blue lantern.');
    assert.match(snapshot.prompt, /^Ava lifts the blue lantern\./u);
    assert.doesNotMatch(snapshot.prompt, /^Ava waits beside/u);
});

test('an uncertain or empty interpretation cannot replace a non-empty original source', () => {
    const source = 'Ava pauses in a moment the interpreter does not classify.';
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: source },
        recentContext: [],
        identities: [],
    });
    assert.equal(snapshot.sourcePassage, source);
    assert.doesNotMatch(snapshot.prompt, /Scene moment unavailable/u);
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

test('production scene snapshots retain inferred cast confidence only for transient avatar selection', () => {
    const castIdentities = [
        { id: 'character:ava', kind: 'character', label: 'Ava', hostKey: 'ava.png', aliases: ['Ava'] },
        { id: 'character:leo', kind: 'character', label: 'Leo', hostKey: 'leo.png', aliases: ['Leo'] },
    ];
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Leo', role: 'character', mes: 'Leo raises the lantern.' },
        identities: castIdentities,
    });
    const references = resolveHostAvatarIdentityReferences({
        identities: castIdentities, activeCharacterAvatar: 'ava.png', groupCharacterAvatars: ['ava.png', 'leo.png'],
    });

    assert.deepEqual(snapshot.state.sceneFacts.cast, [{ identityId: 'character:leo', label: 'Leo', kind: 'character' }]);
    assert.deepEqual(snapshot.avatarSceneCast, [{ identityId: 'character:leo', label: 'Leo', kind: 'character', confidence: 'high' }]);
    assert.deepEqual(selectSceneRelevantAvatarReferences({ references, sceneCast: snapshot.avatarSceneCast }).map((reference) => reference.identityId), ['character:leo']);
});

test('production avatar cast excludes stale persisted members when a director exclusion is present', () => {
    const castIdentities = [
        { id: 'character:ava', kind: 'character', label: 'Ava', hostKey: 'ava.png', aliases: ['Ava'] },
        { id: 'character:leo', kind: 'character', label: 'Leo', hostKey: 'leo.png', aliases: ['Leo'] },
        { id: 'user:sam', kind: 'user', label: 'Sam', hostKey: 'sam.png', aliases: ['Sam'] },
    ];
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava raises the lantern.' },
        identities: castIdentities,
        priorStoryState: { sceneFacts: { cast: [{ identityId: 'character:leo', label: 'Leo', kind: 'character' }] } },
        castOverrides: [{ identityId: 'user:sam', action: 'exclude' }],
    });
    const references = resolveHostAvatarIdentityReferences({
        identities: castIdentities, activeCharacterAvatar: 'ava.png', personaAvatar: 'sam.png', groupCharacterAvatars: ['ava.png', 'leo.png'],
    });

    assert.deepEqual(snapshot.avatarSceneCast, [
        { identityId: 'character:leo', label: 'Leo', kind: 'character' },
        { identityId: 'character:ava', label: 'Ava', kind: 'character', confidence: 'high' },
    ]);
    assert.deepEqual(selectSceneRelevantAvatarReferences({
        references,
        sceneCast: snapshot.avatarSceneCast,
        castOverrides: snapshot.castOverrides,
    }).map((reference) => reference.identityId), ['character:ava']);
});

test('scene state pending entries are chat-scoped and clone inputs', () => {
    const state = { schema: 1, sceneFacts: { location: 'library' } };
    const entry = createSceneStatePending({ chatId: 'chat-a', epoch: 2, state, target: { messageId: 4 } });
    state.sceneFacts.location = 'mutated';
    assert.equal(sceneStatePendingKey(entry), 'chat-a');
    assert.equal(entry.state.sceneFacts.location, 'library');
    assert.equal(entry.target.messageId, 4);
});

test('retired visual overrides do not enter the scene prompt', () => {
    const prompt = buildScenePrompt({
        sourcePassage: 'Ava smiles.',
        state: { sceneFacts: { cast: [{ label: 'Ava' }] } },
        settings: { framing_preference: 'close-up', continuity_strength: 'minimal', custom_visual_instruction: 'Warm dusk light.' },
    });
    assert.doesNotMatch(prompt, /Framing:|Continuity strength:|Warm dusk light/);
    assert.match(prompt, /Ava smiles/);
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

test('successful wand scene persistence carries opaque legacy outfits without prompt injection', async () => {
    const legacyOutfits = {
        schema: 9,
        records: [{ owner: 'character:ava', privateLegacyValue: 'opaque-red-coat-marker' }],
        futureField: { keep: true },
    };
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava waits at the library.' },
        identities,
        priorStoryState: { sceneFacts: { location: 'station', outfits: legacyOutfits } },
    });
    const pending = createSceneStatePending({
        chatId: 'chat-a',
        epoch: 1,
        state: snapshot.state,
        target: { chatId: 'chat-a', messageId: 4 },
    });
    let persistedState = { sceneFacts: { location: 'station', outfits: legacyOutfits } };

    const outcome = await persistAcceptedSceneState({
        pending,
        isCurrent: () => true,
        getState: () => persistedState,
        setState: (value) => { persistedState = value; },
        savePending: async () => {},
        saveChat: async () => ({ saved: true }),
        readback: async (entry) => ({ status: 'confirmed', state: entry.state }),
        removePending: async () => {},
    });

    assert.equal(outcome.status, 'confirmed');
    assert.deepEqual(persistedState.sceneFacts.outfits, legacyOutfits);
    assert.notEqual(persistedState.sceneFacts.outfits, legacyOutfits);
    assert.doesNotMatch(snapshot.prompt, /opaque-red-coat-marker/u);
});

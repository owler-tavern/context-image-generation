import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    clearChatAppearanceSource,
    clearChatBinding,
    clearChatIdentityPin,
    migrateChatCanon,
    selectLookForChat,
    setChatAppearanceSource,
    setChatBinding,
    setChatCastOverride,
    setChatIdentityPin,
    setChatLock,
    setChatWandPreferences,
} from '../lib/rp/chat-canon.js';
import * as persistenceVerifier from '../lib/rp/persistence-verifier.js';
import { deriveCinematicEvents } from '../lib/rp/cinematic-automation.js';
import { buildSceneGenerationSnapshot, createSceneArtifactMetadata } from '../lib/rp/scene-generation.js';
import { buildStoryMemoryFactSnapshot, collectStoryMemoryMedia } from '../lib/rp/story-memory-runtime.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import * as settingsMigrationChange from '../lib/settings-migration-change.js';

const legacySettings = {
    rp_outfits: { schema: 1, outfits: [{ id: 'outfit:1', identityId: 'char:1', name: 'Evening', description: 'blue coat' }] },
    outfit_pending: { schema: 1, pending: { 'chat:1\u0000char:1': { chatId: 'chat:1', identityId: 'char:1' } } },
};
const legacyOutfitState = { schema: 1, bindings: { 'char:1': { activeOutfitId: 'outfit:1', isLocked: true } } };
const largeLegacyOutfitState = {
    schema: 1,
    bindings: Object.fromEntries(Array.from({ length: 180 }, (_, index) => [
        `character:legacy-${index}`,
        { activeOutfitId: `outfit:legacy-${index}`, isLocked: index % 2 === 0, note: `historical-note-${index}` },
    ])),
};
const [index, settings, cinematicRuntimeSource] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/cinematic-runtime.js', import.meta.url), 'utf8'),
]);

test('real extension-settings load and save seams preserve legacy outfit records without migration or replay', async () => {
    assert.equal(typeof settingsMigrationChange.loadExtensionSettings, 'function');
    assert.equal(typeof settingsMigrationChange.persistExtensionSettings, 'function');
    const loaded = settingsMigrationChange.loadExtensionSettings({ use_avatars: false, provider: 'makersuite' }, structuredClone(legacySettings));
    loaded.settings.use_avatars = true;
    let saved = null;
    await settingsMigrationChange.persistExtensionSettings(loaded.settings, async (value) => { saved = structuredClone(value); });
    assert.deepEqual(saved.rp_outfits, legacySettings.rp_outfits);
    assert.deepEqual(saved.outfit_pending, legacySettings.outfit_pending);
    assert.doesNotMatch(index, /replaceWhenChanged\(cigSettings\.rp_outfits|replaceWhenChanged\(cigSettings\.outfit_pending|resumePendingOutfitState|scheduleOutfitPendingRetry/);
});

test('every ordinary chat-canon writer preserves realistic opaque legacy outfit state larger than 8192 characters', () => {
    assert.ok(JSON.stringify(largeLegacyOutfitState).length > 8192);
    const writers = [
        (state) => setChatBinding(state, 'character:ava', { activeLookId: 'look:1', expectedAssetId: 'asset:1', selectedAt: 1 }),
        (state) => setChatLock({ ...state, bindings: { 'character:ava': { activeLookId: 'look:1', expectedAssetId: 'asset:1', isLocked: false, selectedAt: 1 } } }, 'character:ava', true),
        (state) => clearChatBinding(state, 'character:ava'),
        (state) => selectLookForChat(state, 'character:ava', { activeLookId: 'look:1', expectedAssetId: 'asset:1', selectedAt: 1 }).state,
        (state) => setChatAppearanceSource(state, 'character:ava', { sourceType: 'avatar', sourceId: 'character:ava', role: 'character', selectedAt: 1 }),
        (state) => clearChatAppearanceSource(state, 'character:ava'),
        (state) => setChatWandPreferences(state, { framing: 'wide', continuity: 'strong', visualDirection: 'night rain' }),
        (state) => setChatIdentityPin(state, 'character:ava', { sourceId: 'character:ava', role: 'character' }),
        (state) => clearChatIdentityPin(state, 'character:ava'),
        (state) => setChatCastOverride(state, 'character:ava', 'include'),
    ];
    for (const write of writers) {
        const next = write({ outfitState: largeLegacyOutfitState });
        assert.deepEqual(next.outfitState, largeLegacyOutfitState);
    }
    assert.deepEqual(migrateChatCanon({ outfitState: largeLegacyOutfitState }).outfitState, largeLegacyOutfitState);
});

test('real one-to-one and group metadata writer/save seams preserve large opaque legacy outfit state', async () => {
    assert.equal(typeof persistenceVerifier.persistChatCanonMetadata, 'function');
    for (const groupId of [null, 'group-1']) {
        const calls = [];
        const metadata = { contextImageGeneration: { outfitState: largeLegacyOutfitState } };
        const candidate = setChatWandPreferences(metadata.contextImageGeneration, { framing: 'wide' });
        await persistenceVerifier.persistChatCanonMetadata({
            metadata,
            candidate,
            groupId,
            chatName: 'chat-1',
            chatData: [{ mes: 'current scene' }],
            saveOneToOne: async (payload) => calls.push(['one-to-one', structuredClone(payload)]),
            saveGroup: async (id, withMetadata) => calls.push(['group', id, withMetadata, structuredClone(metadata)]),
        });
        assert.deepEqual(metadata.contextImageGeneration.outfitState, largeLegacyOutfitState);
        assert.equal(calls[0][0], groupId ? 'group' : 'one-to-one');
        const savedMetadata = groupId ? calls[0][3] : calls[0][1].withMetadata;
        assert.deepEqual(savedMetadata.contextImageGeneration.outfitState, largeLegacyOutfitState);
    }
});

test('new generation plans ignore retired outfit inputs while a real historical artifact reader accepts activeOutfits', () => {
    const plan = createGenerationPlan({
        id: 'outfit-retirement', invocation: 'wand',
        provider: { providerId: 'openai', modelId: 'gpt-image-1', capabilities: {} },
        prompt: { sourceMessage: 'Ava wears a blue coat.', outfitText: '[Active outfits] Ava' },
        activeOutfits: [{ identityId: 'char:1', outfit: { name: 'Evening' } }],
    });
    assert.equal('outfitText' in plan.prompt, false);
    assert.equal('activeOutfits' in plan, false);
    const historicalArtifact = collectStoryMemoryMedia({
        chatId: 'chat-1',
        chat: [{ extra: { media: [{
            url: '/user/images/context-image-generation/historical.png',
            cig_owner: 'context-image-generation',
            cig_continuity_snapshot: { activeOutfits: [{ identityId: 'char:1', outfit: { name: 'Evening' } }] },
        }] } }],
    })[0];
    assert.deepEqual(historicalArtifact.cig_continuity_snapshot.activeOutfits[0].outfit, { name: 'Evening' });
});

test('current scene attire stays ordinary prompt text and never becomes extracted, retained, inspected, or provenance state', () => {
    const snapshot = buildSceneGenerationSnapshot({
        clickedMessage: { name: 'Ava', mes: 'Ava wears a blue coat. Ava holds a silver lantern. Ava is in the library.' },
        identities: [{ id: 'character:ava', kind: 'character', label: 'Ava' }],
        priorStoryState: { sceneFacts: {
            outfits: [{ identityId: 'character:ava', value: 'red dress' }],
            objects: [{ holderIdentityId: 'character:ava', value: 'map' }],
            injuries: [{ identityId: 'character:ava', value: 'scar' }],
        } },
    });
    assert.match(snapshot.prompt, /Ava wears a blue coat/u);
    assert.equal(Object.hasOwn(snapshot.interpretation, 'outfits'), false);
    assert.equal(Object.hasOwn(snapshot.interpretation.sceneSignals, 'outfits'), false);
    assert.equal(Object.hasOwn(snapshot.state.sceneFacts, 'outfits'), false);
    assert.doesNotMatch(snapshot.prompt, /^Outfits:/mu);
    assert.doesNotMatch(JSON.stringify(snapshot.inspection), /outfit|red dress/iu);
    assert.deepEqual(snapshot.state.sceneFacts.objects, [
        { holderIdentityId: 'character:ava', value: 'map' },
        { value: 'silver lantern', holderIdentityId: 'character:ava' },
    ]);
    assert.deepEqual(snapshot.state.sceneFacts.injuries, [{ identityId: 'character:ava', value: 'scar' }]);
    assert.doesNotMatch(JSON.stringify(createSceneArtifactMetadata(snapshot)), /outfit|red dress/iu);
    assert.equal(buildStoryMemoryFactSnapshot(snapshot.state).some((fact) => fact.kind === 'outfit'), false);
});

test('cinematic automation ignores retired outfit deltas while preserving non-outfit scene events', () => {
    assert.deepEqual(deriveCinematicEvents({ accepted: true, revision: 'r-outfit', updatedSceneFacts: {
        outfits: [{ identityId: 'character:ava', from: 'red dress', to: 'blue coat' }],
    } }), []);
    const mixed = deriveCinematicEvents({ accepted: true, revision: 'r-mixed', updatedSceneFacts: {
        location: { from: 'station', to: 'library' },
        outfits: [{ identityId: 'character:ava', from: 'red dress', to: 'blue coat' }],
        cast: [{ identityId: 'character:ava', value: 'present' }],
    } });
    assert.deepEqual(mixed.map((event) => event.kind), ['location', 'cast']);
});

test('production code has no outfit controls, prompt projection, persistence imports, or new outfit provenance', () => {
    assert.doesNotMatch(settings, /cig_chat_outfit_controls|outfit controls/i);
    assert.doesNotMatch(index, /from '\.\/lib\/rp\/outfit-(?:lock|persistence)\.js'/);
    assert.doesNotMatch(index, /renderChatOutfitControls|buildOutfitPrompt|outfitStateSnapshot|outfitText|activeOutfits/);
    assert.doesNotMatch(index, /createOutfit\(|selectChatOutfit\(|setChatOutfitLock\(|persistChatOutfitState\(/);
    assert.match(index, /loadExtensionSettings\(defaultSettings, persistedSettings\)/u);
    assert.match(index, /persistExtensionSettings\(cigSettings, saveSettingsDebounced\)/u);
    assert.match(index, /persistChatCanonMetadata\(\{/u);
    assert.doesNotMatch(cinematicRuntimeSource, /event\?\.kind === 'outfit'/u);
});

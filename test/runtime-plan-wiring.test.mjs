import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Remember promotes a distinct asset and binds only the captured current chat', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const runtime = await readFile(new URL('../lib/rp/appearance-runtime.js', import.meta.url), 'utf8');
    assert.match(runtime, /promoteGalleryArtifact/);
    assert.match(source, /createAppearanceFeatureController/);
    assert.match(runtime, /Saved and active in this chat\./);
    assert.match(runtime, /Saved as an alternate; your locked look was not changed\./);
    assert.match(runtime, /Saved to the appearance library, but the chat changed before it could be activated\./);
    assert.match(source, /chatLifecycleEpoch\.isCurrent/);
    assert.match(source, /saveMetadata/);
});

test('Appearance UI exposes per-chat use and lock actions', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /Active in this chat/);
    assert.match(source, /Locked for this chat/);
    assert.match(source, /Use in this chat/);
    assert.match(source, /Lock for this chat/);
    assert.match(source, /Replace the locked look for this chat\?/);
});

test('wand and slash are the only production adapters into one scene-generation kernel', async () => {
    const [index, entrypoints] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../lib/scene-generation/production-entrypoints.js', import.meta.url), 'utf8'),
    ]);
    assert.match(index, /createSceneGenerationKernel\(/);
    assert.match(index, /createProductionGenerationEntrypoints\(/u);
    assert.match(index, /registerProductionGenerationEntrypoints\(/u);
    assert.match(entrypoints, /createWandEntryAdapter\(/u);
    assert.match(entrypoints, /createSlashEntryAdapter\(/u);
    assert.match(index, /createGenerationPlan\(/);
    assert.match(index, /buildReferenceMessageParts\(/);
    assert.match(entrypoints, /generateFromWand: \(input\) => wand\.generate\(input\)/u);
    assert.match(entrypoints, /generateFromSlash: \(prompt\) => slash\.generate\(prompt\)/u);
    assert.match(index, /registerWand: \(generate\)/u);
    assert.match(index, /registerSlash: \(generate\)/u);
    assert.doesNotMatch(index, /wandGenerationEntry|slashGenerationEntry/u);
    assert.doesNotMatch(index, /invocation:\s*'automation'|'swipe'\s*,\s*\)|'director'\s*,\s*\{/u);
});

test('runtime dispatch does not reference a removed SillyTavern request callback', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(index, /\brequestSillyTavernImage\b/u);
});

test('runtime snapshots resolve adapter IDs through the shared route contract', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const snapshot = index.slice(index.indexOf('function captureGenerationSnapshot'), index.indexOf('async function captureSceneGenerationRequest'));
    assert.match(snapshot, /resolveAdapterId\(legacyTransport\)/);
    assert.doesNotMatch(snapshot, /openAiImages:\s*'openai-images'/);
});

test('normal inline flow captures reference evidence without adding a post-image chat shelf or outfit state', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /projectContinuityShelf/);
    assert.doesNotMatch(source, /renderContinuityShelf/);
    assert.match(source, /referencePlan/);
    assert.match(source, /saveChatConditional/);
    assert.doesNotMatch(source, /outfitStateSnapshot|outfitText|activeOutfits/);
});

test('captured continuity metadata remains available to Settings and Story Memory without a chat shelf', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /cig_continuity_snapshot/);
    assert.match(source, /useAvatars: snapshot\.settingsSnapshot\.use_avatars === true/);
    assert.match(source, /useDescriptions: snapshot\.settingsSnapshot\.include_descriptions === true/);
    assert.doesNotMatch(source, /function renderContinuityShelf/);
    assert.doesNotMatch(source, /function renderVisibleCanonControls/);
    assert.doesNotMatch(source, /function renderSceneInspection/);
});

test('production passes captured avatar and description preferences into the contributor boundary', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const snapshot = source.slice(source.indexOf('function captureGenerationSnapshot'), source.indexOf('async function collectSceneGenerationReferences'));
    assert.match(snapshot, /captureReferenceContributorSnapshot\(\{/u);
    assert.match(snapshot, /avatarEnabled: settingsSnapshot\.use_avatars === true/u);
    assert.match(snapshot, /host: hostReferenceState/u);
    assert.match(snapshot, /sceneCast: sceneSnapshot\.avatarSceneCast/u);
    assert.match(snapshot, /settings: settingsSnapshot/);
    assert.match(source, /descriptionText: snapshot\.settingsSnapshot\.include_descriptions === true/u);
    assert.match(source, /notifyBrokenCanon\(contributed\.omissions\.filter\(isCanonReferenceOmission\)/u);
});

test('saved appearance storage is captured by the contributor boundary and never read during async collection', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const capture = source.slice(source.indexOf('function captureGenerationSnapshot'), source.indexOf('async function captureSceneGenerationRequest'));
    const contributorAssembly = source.slice(source.indexOf('const referenceContributorPipeline'), source.indexOf('async function collectSceneGenerationReferences'));
    const collection = source.slice(source.indexOf('async function collectSceneGenerationReferences'), source.indexOf('const sceneGenerationDispatchContexts'));
    assert.doesNotMatch(capture, /rp_library|captureCanonForGeneration|referenceCandidates/u);
    assert.match(source, /captureReferenceContributorSnapshot\(/u);
    assert.match(contributorAssembly, /createCapturedReferenceContributors\(/u);
    assert.doesNotMatch(contributorAssembly, /getContext\(|chat_metadata|extension_settings/u);
    assert.doesNotMatch(collection, /getContext\(|chat_metadata|extension_settings/u);
    assert.match(collection, /referenceContributorSnapshot/u);
});

test('production leaves historical outfit persistence modules unreachable', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /outfit-persistence\.js|outfit-lock\.js/);
    assert.doesNotMatch(source, /persistChatOutfitState|resumePendingOutfitState|queueOutfitPending/);
});

test('wand integration makes scene interpretation visible, persistent, and chat-scoped', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(source, /buildSceneGenerationSnapshot/);
    assert.doesNotMatch(source, /messageContent = sceneSnapshot\.prompt/);
    assert.match(source, /getRecentMessages\(1, messageId\)/);
    assert.match(source, /cig_scene_inspection/);
    assert.match(source, /persistSceneStateForAttachment/);
    assert.match(source, /scene_state_pending/);
    assert.match(source, /SCENE_STATE_METADATA_KEY/);
    assert.doesNotMatch(settings, /id="cig_(?:framing_preference|continuity_strength|custom_visual_instruction|message_depth)"/);
});

test('successful attachment passes the generated result into scene-state persistence', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const attachment = source.slice(source.indexOf('function createMessageDeliveryDependencies('), source.indexOf('const wandGenerationDelivery'));
    assert.match(attachment, /saveChat: async \(result\) =>/);
    assert.match(attachment, /persistSceneStateForAttachment\(result, effectiveTarget, saveEpoch\)/);
});

test('scene state stays internal while the inline artifact keeps a public inspection wrapper', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const snapshot = source.slice(source.indexOf('const sceneSnapshot = buildSceneGenerationSnapshot'), source.indexOf('const connectionId = routeModel.connectionId'));
    const dispatch = source.slice(source.indexOf('async function dispatchSceneGenerationPlan'), source.indexOf('const sceneGenerationKernel'));
    assert.match(snapshot, /const scenePlan = \{ \.\.\.sceneMetadata, state: cloneSnapshot\(sceneSnapshot\.state\),/);
    assert.match(source, /scene: scenePlan/);
    assert.match(dispatch, /__cigSceneMetadata: createSceneArtifactMetadata\(dispatchedPlan\.scene\)/);
    assert.match(dispatch, /__cigSceneState: cloneSnapshot\(dispatchedPlan\.scene\?\.state\)/);
    assert.doesNotMatch(source, /function renderSceneInspection/);
    assert.match(source, /removeRetiredMessageSurfaces[\s\S]*?\.cig_scene_inspection/u);
});

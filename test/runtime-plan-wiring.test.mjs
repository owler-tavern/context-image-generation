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

test('normal inline flow captures outfit/reference evidence without adding a post-image chat shelf', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /projectContinuityShelf/);
    assert.doesNotMatch(source, /renderContinuityShelf/);
    assert.match(source, /migrateOutfitCatalog/);
    assert.match(source, /migrateChatOutfitState/);
    assert.match(source, /buildOutfitPrompt/);
    assert.match(source, /referencePlan/);
    assert.match(source, /saveChatConditional/);
    assert.match(source, /verifyPersistedChatOutfitState/);
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

test('contributor wiring gates avatar candidates while the captured settings retain description preference', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const snapshot = source.slice(source.indexOf('function captureGenerationSnapshot'), source.indexOf('async function collectSceneGenerationReferences'));
    const contributors = source.slice(source.indexOf('const avatarReferenceContributor'), source.indexOf('async function collectSceneGenerationReferences'));
    assert.match(contributors, /const references = snapshot\.avatarEnabled/);
    assert.match(snapshot, /settings: settingsSnapshot/);
    assert.match(source, /descriptionText: snapshot\.settingsSnapshot\.include_descriptions === true/u);
});

test('saved appearance storage is owned by the contributor rather than kernel capture', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const capture = source.slice(source.indexOf('function captureGenerationSnapshot'), source.indexOf('async function captureSceneGenerationRequest'));
    const collection = source.slice(source.indexOf('const savedAppearanceReferenceContributor'), source.indexOf('async function collectSceneGenerationReferences'));
    assert.doesNotMatch(capture, /rp_library|captureCanonForGeneration|referenceCandidates/u);
    assert.match(source, /createReferenceContributorPipeline\(\[\s*avatarReferenceContributor,\s*previousImageReferenceContributor,\s*savedAppearanceReferenceContributor,/u);
    assert.match(collection, /library: extension_settings\[extensionName\]\?\.rp_library/u);
    assert.match(collection, /chatState: chat_metadata\[CHAT_CANON_KEY\]/u);
});

test('outfit persistence queues durable pending state and saves only through the captured target gate', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const outfit = source.slice(source.indexOf('async function persistChatOutfitState'), source.indexOf('async function activateChatOutfit'));
    assert.match(outfit, /queueOutfitPending/);
    assert.match(outfit, /verifyPersistedOutfitPending/);
    assert.match(outfit, /persistTargetedOutfitMutation/);
    assert.match(outfit, /saveChatForCapturedTarget/);
    assert.doesNotMatch(outfit, /saveChatConditional\(\)/);
    assert.match(source, /resumePendingOutfitState/);
    assert.match(source, /splitOutfitPendingByChat/);
});

test('wand integration makes scene interpretation visible, persistent, and chat-scoped', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(source, /buildSceneGenerationSnapshot/);
    assert.match(source, /messageContent = sceneSnapshot\.prompt/);
    assert.match(source, /cig_scene_inspection/);
    assert.match(source, /persistSceneStateForAttachment/);
    assert.match(source, /scene_state_pending/);
    assert.match(source, /SCENE_STATE_METADATA_KEY/);
    assert.match(settings, /id="cig_framing_preference"/);
    assert.match(settings, /id="cig_continuity_strength"/);
    assert.match(settings, /id="cig_custom_visual_instruction"/);
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

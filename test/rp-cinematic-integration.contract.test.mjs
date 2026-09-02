import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, settings, style, cinematicUi] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/cinematic-ui.js', import.meta.url), 'utf8'),
]);

test('cinematic automation is mounted into real chat lifecycle hooks and uses story interpretation', () => {
    assert.match(index, /createCinematicRuntime/);
    assert.match(index, /createCinematicSurface\(\)/);
    assert.match(index, /eventSource\.on\(event_types\.CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /eventSource\.on\(event_types\.USER_MESSAGE_RENDERED/);
    assert.match(index, /observeCinematicMessage\(messageId\)/);
    assert.match(index, /buildSceneGenerationSnapshot\(/);
    assert.match(index, /getMessageFingerprint/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt/);
    assert.match(index, /if \(result !== true\).*attachmentStatus: 'not-attached'/s);
    assert.match(index, /writeState: \(value, \{ chatId \} = \{\}\)/);
    assert.match(index, /readDurableState: \(\{ chatId \} = \{\}\)/);
    assert.match(index, /writeDurableState: \(value, \{ chatId \} = \{\}\)/);
    assert.match(index, /saveDurableState: async \(\) => \{ await saveSettings\(\); \}/);
    assert.match(index, /compactCinematicRuntimeState\(value\.cinematicAutomation\)/);
    assert.match(index, /cinematicRuntime\.stage/);
});

test('settings expose explicit cinematic controls and honest cost fallback', () => {
    for (const id of ['cig_cinematic_enabled', 'cig_cinematic_mode', 'cig_cinematic_budget_type', 'cig_cinematic_generation_limit', 'cig_cinematic_cost_ceiling', 'cig_cinematic_retrigger_beat', 'cig_cinematic_retrigger', 'cig_cinematic_status']) assert.match(settings, new RegExp(`id="${id}"`));
    assert.match(settings, /Suggestions never call a provider/);
    assert.match(settings, /No currency is invented/);
    assert.match(index, /cinematic_automation/);
    assert.match(index, /cinematic_automation_sessions/);
    assert.match(index, /cinematicRuntime\?\.retrigger/);
});

test('suggestion actions and narrow-safe controls are accessible', () => {
    assert.match(index, /data-cig-cinematic-action/);
    assert.match(index, /data-cig-cinematic-adjust-input/);
    assert.match(style, /\.cig_cinematic_suggestion[\s\S]*min-height:\s*44px/);
    assert.match(style, /@media \(max-width: 480px\)[\s\S]*cig_cinematic_suggestion_actions/);
});

test('production dismiss refreshes the card from the settled runtime result', () => {
    assert.match(index, /if \(result\?\.status === 'dismissed'\) refreshCinematicSurface\(null, 'Cinematic suggestion dismissed\./u);
    assert.match(index, /data-cig-cinematic-id/);
});

test('cinematic suggestions stage the next wand and never dispatch from the card', () => {
    assert.match(cinematicUi, /Use for next wand/u);
    assert.match(index, /cinematicRuntime(?:\?\.)?\.dismiss/u);
    assert.match(index, /setChatWandPreferences/u);
    assert.match(index, /invocation === 'wand' && chatPreferences\.stagedSuggestion\?\.shot/u);
    assert.match(index, /Cinematic shot: \$\{chatPreferences\.stagedSuggestion\.shot\}/u);
    assert.match(index, /stagedSuggestion: null/u);
    assert.doesNotMatch(index, /cinematicRuntime\?\.approve/u);
    assert.doesNotMatch(settings, />Approve</u);
});

test('manual cinematic retrigger reports a visible suggestion result even before a message card can mount', () => {
    assert.match(index, /refreshCinematicSurface\(result\?\.suggestion, status\)/u);
    assert.match(index, /Manual cinematic suggestion is ready/u);
    assert.match(index, /No chat event was replayed/u);
    assert.match(index, /focusCinematicSuggestionCard\(\{ documentLike: document, suggestionId: result\.suggestion\?\.suggestionId \}\)/u);
});

test('production cinematic runtime binds manual retriggers to the current chat messages', () => {
    assert.match(index, /createCinematicRuntime\(\{[\s\S]*getChat: \(\) => getContext\(\)\.chat \|\| \[\]/u);
    assert.match(index, /renderCinematicSuggestion\(suggestionOverride\)/u);
});

test('production manual retrigger captures lifecycle identity and skips stale refreshes', () => {
    assert.match(index, /const captured = \{ chatId: getContext\(\)\.chatId, epoch: chatLifecycleEpoch\.capture\(\) \};[\s\S]*cinematicRuntime\?\.retrigger\([\s\S]*captured\)/u);
    assert.match(index, /if \(chatCaptureIsCurrent\(captured\)\) \{[\s\S]*refreshCinematicSurface\(result\?\.suggestion, status\)/u);
    assert.match(index, /suggestion\.target\.epoch[\s\S]*chatLifecycleEpoch\.capture\(\)/u);
});

test('previous image is a strict opt-in at capture and pending continuation is cleared when turned off', () => {
    assert.match(index, /const hadExplicitPreviousImageOptIn = Number\(extension_settings\[extensionName\]\.previous_image_opt_in_version\) >= 1/u);
    assert.match(index, /if \(!hadExplicitPreviousImageOptIn\) \{[\s\S]*?cigSettings\.use_previous_image = false;[\s\S]*?cigSettings\.previous_image_opt_in_version = 1;/u);
    assert.match(index, /const previousImageEnabled = settingsSnapshot\.use_previous_image === true/u);
    assert.match(index, /settingsSnapshot\.gallery\.filter\(\(item\) => currentChatId && String\(item\?\.chatId \|\| ''\) === currentChatId\)/u);
    assert.match(index, /const continuationGallery = previousImageEnabled[\s\S]*?: \[\]/u);
    assert.match(index, /if \(capability && previousImageEnabled && continuationGallery\.length > 0\) referenceCandidates\.push\(\{ id: 'legacy:previous'/u);
    assert.match(index, /if \(!extension_settings\[extensionName\]\.use_previous_image\) \{[\s\S]*?pendingStoryMemoryContinuation = null;/u);
    assert.match(index, /extension_settings\[extensionName\]\.previous_image_opt_in_version = 1/u);
    assert.match(index, /assetId: 'asset:previous'/u);
    assert.match(index, /assets\['asset:previous'\]/u);
    assert.doesNotMatch(index, /asset:legacy-previous/u);
    assert.match(index, /buildReferenceMessageParts\(plan, referenceAssets\)/u);
});

test('disabled extras do not create new Story Memory or iteration provenance', () => {
    assert.match(index, /const iterationFeatureForGeneration = extraStoryToolEnabled\('iteration'\) \? await ensureIterationFeature\(\) : null/u);
    assert.match(index, /const storyMemoryFeatureForGeneration = extraStoryToolEnabled\('storyMemory'\) \? await ensureStoryMemoryFeature\(\) : null/u);
    assert.match(index, /iterationFeatureForGeneration \? \{/u);
    assert.match(index, /storyMemoryFeatureForGeneration \? \{ __cigStoryMemoryFacts/u);
});

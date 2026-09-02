import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [indexSource, attachmentSource, sceneGenerationSource, castSettingsSource, generationPlanSource] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp-attachment.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/scene-generation.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/cast-settings-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/generation-plan.js', import.meta.url), 'utf8'),
]);

test('stable settings load does not delete and recreate retired director sessions', () => {
    const start = indexSource.indexOf('async function loadSettings()');
    const end = indexSource.indexOf('function toggleProviderSpecificSettings()', start);
    const loadSettings = start >= 0 && end > start ? indexSource.slice(start, end) : '';

    assert.ok(loadSettings, 'loadSettings source should be available');
    assert.doesNotMatch(
        loadSettings,
        /delete cigSettings\.director_sessions;[\s\S]*cigSettings\.director_sessions\s*=/u,
        'a stable load must not force a full SillyTavern settings save by recreating retired state',
    );
});

test('loadSettings avoids serializing the five targeted migration comparisons while serialization outside that slice remains available', () => {
    const start = indexSource.indexOf('async function loadSettings()');
    const end = indexSource.indexOf('function toggleProviderSpecificSettings()', start);
    const loadSettings = start >= 0 && end > start ? indexSource.slice(start, end) : '';

    assert.ok(loadSettings, 'loadSettings source should be available');
    for (const value of [
        'existingProviderSettings',
        'cigSettings.extra_story_tools',
        'cigSettings.rp_library',
        'cigSettings.rp_outfits',
        'cigSettings.outfit_pending',
    ]) {
        assert.doesNotMatch(loadSettings, new RegExp(`JSON\\.stringify\\(${value.replaceAll('.', '\\.')}`, 'u'));
    }
    assert.match(indexSource, /body: JSON\.stringify\(\{\}\)/u, 'request serialization outside loadSettings remains allowed');
});

test('ordinary message rendering and chat startup do not schedule full image-navigation scans', () => {
    const renderedStart = indexSource.indexOf('function onCigMessageRendered(messageId)');
    const eventsEnd = indexSource.indexOf('SlashCommandParser.addCommandObject', renderedStart);
    const runtimeEvents = renderedStart >= 0 && eventsEnd > renderedStart
        ? indexSource.slice(renderedStart, eventsEnd)
        : '';

    assert.ok(runtimeEvents, 'message lifecycle source should be available');
    assert.doesNotMatch(
        runtimeEvents,
        /scheduleImageArrowConfiguration|configureAllCigImageArrows/u,
        'idle message and chat lifecycle must not add image-navigation timers or full DOM scans',
    );
});

test('startup defers recovery and hidden Characters and Library rendering until after first paint', () => {
    const loadStart = indexSource.indexOf('async function loadSettings()');
    const loadEnd = indexSource.indexOf('function toggleProviderSpecificSettings()', loadStart);
    const loadSettings = loadStart >= 0 && loadEnd > loadStart ? indexSource.slice(loadStart, loadEnd) : '';

    assert.ok(loadSettings, 'loadSettings source should be available');
    assert.doesNotMatch(loadSettings, /await (?:enqueueLibraryMutation|resumePending)/u);
    assert.doesNotMatch(loadSettings, /renderAppearanceList\(|renderChatAppearanceSources\(/u);
    assert.match(loadSettings, /schedulePendingRecovery\(\)/u);
});

test('chat lifecycle marks hidden Characters and Library settings stale instead of rebuilding them', () => {
    const eventsStart = indexSource.indexOf('eventSource.on(event_types.CHAT_CHANGED');
    const eventsEnd = indexSource.indexOf('eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED', eventsStart);
    const chatEvents = eventsStart >= 0 && eventsEnd > eventsStart ? indexSource.slice(eventsStart, eventsEnd) : '';

    assert.ok(chatEvents, 'chat lifecycle event source should be available');
    assert.doesNotMatch(chatEvents, /renderChatAppearanceSources\(/u);
    assert.match(chatEvents, /markImagesCastSettingsStale/u);
});

test('chat switching advances stale-work protection without cloning metadata or updating hidden settings', () => {
    const eventsStart = indexSource.indexOf('eventSource.on(event_types.CHAT_CHANGED');
    const eventsEnd = indexSource.indexOf('eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED', eventsStart);
    const chatEvents = eventsStart >= 0 && eventsEnd > eventsStart ? indexSource.slice(eventsStart, eventsEnd) : '';

    assert.ok(chatEvents, 'chat lifecycle event source should be available');
    assert.doesNotMatch(indexSource, /bindAppearanceLifecycle\(/u);
    assert.match(chatEvents, /chatLifecycleEpoch\.advance\(\)/u);
    assert.doesNotMatch(chatEvents, /removeRetiredMessageSurfaces|syncChatWandPreferenceControls/u);
});

test('hidden Images and Cast mutations leave the Gallery dirty instead of rebuilding its tiles', () => {
    const start = indexSource.indexOf('function markImagesCastSettingsStale()');
    const end = indexSource.indexOf('async function loadSettings()', start);
    const staleMarker = start >= 0 && end > start ? indexSource.slice(start, end) : '';

    assert.ok(staleMarker, 'Images and Cast stale marker should be available');
    assert.match(staleMarker, /galleryRenderState\.markDirty\(\)/u);
    assert.doesNotMatch(staleMarker, /renderGallery\(\)/u);
});

test('ordinary chat typing has no document-level CIG keyboard handler', () => {
    assert.doesNotMatch(indexSource, /document\.addEventListener\('keydown',\s*onCigImageArrowKeydown/u);
    assert.match(indexSource, /\.on\('keydown\.cigImageNavigation',\s*onCigImageArrowKeydown\)/u);
});

test('normal chats schedule no deferred recovery timer when no work is pending', () => {
    const start = indexSource.indexOf('function schedulePendingRecovery()');
    const end = indexSource.indexOf('function imagesCastSettingsAreVisible()', start);
    const scheduler = start >= 0 && end > start ? indexSource.slice(start, end) : '';

    assert.ok(scheduler, 'pending recovery scheduler should be available');
    assert.match(scheduler, /if \(!hasPendingRecoveryWork\(\)\) return false;/u);
});

test('optional story features are dynamically loaded before their exports are used', () => {
    for (const path of [
        './lib/rp/iteration-domain.js',
        './lib/rp/iteration-ui.js',
        './lib/rp/story-memory-ui.js',
        './lib/rp/story-memory-runtime.js',
        './lib/rp/cinematic-runtime.js',
        './lib/rp/cinematic-ui.js',
        './lib/rp/director-runtime.js',
        './lib/rp/director-ui.js',
        './lib/rp/director-cast.js',
    ]) {
        assert.doesNotMatch(indexSource, new RegExp(`^import .*${path.replaceAll('.', '\\.')}`, 'mu'));
    }

    for (const feature of ['storyMemory', 'cinematic']) {
        assert.match(indexSource, new RegExp(`${feature}: async \\(\\) =>`, 'u'));
        assert.match(indexSource, new RegExp(`async function ensure${feature[0].toUpperCase()}${feature.slice(1)}Feature\\(\\)`, 'u'));
    }

    assert.match(indexSource, /storyMemoryLifecycle = createOptionalFeatureLifecycle\([\s\S]*?load: ensureStoryMemoryFeature[\s\S]*?setup: \(feature\) => createStoryMemorySurface\(feature\)/u);
    assert.match(indexSource, /cinematicLifecycle = createOptionalFeatureLifecycle\([\s\S]*?load: ensureCinematicFeature[\s\S]*?setup: \(feature\) => createCinematicSurface\(feature\)/u);
    assert.doesNotMatch(indexSource, /iteration: async \(\) =>|ensureIterationFeature|renderIterationActionSurface/u);
    assert.doesNotMatch(indexSource, /director: async \(\) =>|ensureDirectorFeature|createDirectorSurface/u);
});

test('core generation and settings modules do not eagerly import optional iteration or director code', () => {
    assert.doesNotMatch(attachmentSource, /^import .*iteration-domain\.js/mu);
    assert.doesNotMatch(sceneGenerationSource, /^import .*director-cast\.js/mu);
    assert.doesNotMatch(castSettingsSource, /^import .*director-cast\.js/mu);
    assert.doesNotMatch(generationPlanSource, /^import .*director-cast\.js/mu);
});

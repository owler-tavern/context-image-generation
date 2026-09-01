import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { focusVisualStorySurface, renderVisualStorySurface, revealVisualStorySurface } from '../lib/rp/visual-story-ui.js';
import * as visualStoryUi from '../lib/rp/visual-story-ui.js';

const [index, settings, ui] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/visual-story-ui.js', import.meta.url), 'utf8'),
]);

test('Visual Story remains a settings surface while chat keeps the sole host wand', () => {
    assert.doesNotMatch(index, /cig_message_director|cig_message_visual_story/);
    assert.match(settings, /Visual story memory/i);
    assert.match(index, /revealVisualStorySurface/);
    assert.match(index, /data-cig-visual-story-action/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CHANGED[\s\S]*refreshStoryMemorySurface\(\);[\s\S]*refreshCinematicSurface\(\)/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CREATED[\s\S]*refreshStoryMemorySurface\(\);[\s\S]*refreshCinematicSurface\(\)/);
});

test('Visual Story does not inject chat-level controls', () => {
    const injection = index.slice(index.indexOf('function injectMessageButton'), index.indexOf('function visibleCanonMessageSender'));
    assert.match(injection, /cig_message_gen/);
    assert.doesNotMatch(injection, /cig_message_director|cig_message_visual_story/);
});

test('Visual Story never presents a previous chat timeline while the current chat is loading', () => {
    const html = renderVisualStorySurface({
        currentChatId: 'chat-b',
        memoryState: { chatId: 'chat-a', status: 'ready', timeline: [{ id: 'private-a-moment' }] },
        appearanceSummary: 'Appearance is ready.',
    });
    assert.match(html, /Loading story memory for this chat/);
    assert.doesNotMatch(html, /1 generated moment is ready/);
    const changed = index.slice(index.indexOf('eventSource.on(event_types.CHAT_CHANGED'), index.indexOf('eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED'));
    assert.ok(changed.indexOf('refreshStoryMemorySurface();') < changed.indexOf('refreshCinematicSurface();'));
});

test('Visual Story lifecycle refresh projects the loading state before the async memory read completes', () => {
    const refresh = index.slice(index.indexOf('function refreshStoryMemorySurface'), index.indexOf('function openStoryMemoryArtifact'));
    assert.match(refresh, /void loadStoryMemoryForCurrentChat\(\);\s*renderVisualStoryOverview\(\);/);
});

test('Visual Story surface explains empty Story Memory, continuity readiness, and cinematic On or Off state', () => {
    assert.match(settings, /cig_visual_story_surface/);
    assert.match(ui, /Visual Story Memory/);
    assert.match(ui, /No generated moments yet/);
    assert.match(ui, /Character continuity/);
    assert.match(ui, /Cinematic suggestions/);
    assert.match(ui, /Turn on cinematic suggestions|Configure cinematic suggestions/);
});

test('Visual Story entry is provider-free, keyboard-safe, and narrow-layout safe', () => {
    assert.doesNotMatch(ui, /attachGeneratedImage|dispatchProviderRoute|fetch\(/);
    assert.doesNotMatch(index, /keydown[\s\S]*cig_message_visual_story/);
    assert.match(ui, /focusVisualStorySurface/);
    assert.match(settings, /cig_visual_story_surface[\s\S]*cig_story_memory_surface/);
});

test('Visual Story renders an honest empty state and focuses the surface after opening closed drawers', () => {
    const html = renderVisualStorySurface({ memoryState: { timeline: [] }, appearanceSummary: '1 of 2 identities have appearance readiness.', cinematicEnabled: false });
    assert.match(html, /No generated moments yet/);
    assert.match(html, /Use the wand/);
    assert.match(html, /<strong>Off<\/strong>/);
    assert.match(ui, /min-height:44px/);
    assert.match(html, /data-cig-visual-story-action="open-memory"/);
    const enabledHtml = renderVisualStorySurface({ memoryState: { timeline: [{ id: 'moment-1' }] }, cinematicEnabled: true });
    assert.match(enabledHtml, /<strong>On<\/strong>/);
    assert.match(enabledHtml, /Configure cinematic suggestions/);

    const calls = { host: 0, extension: 0, tab: [], scroll: 0, focus: 0 };
    const heading = { setAttribute() {}, focus() { calls.focus += 1; } };
    const surface = { scrollIntoView() { calls.scroll += 1; }, querySelector(selector) { return selector === 'h2' ? heading : null; } };
    const host = { hidden: true, style: { display: 'none' } };
    const hostToggle = { click() { calls.host += 1; host.style.display = 'block'; } };
    const extensionContent = { style: { display: 'none' } };
    const extensionToggle = { click() { calls.extension += 1; extensionContent.style.display = 'block'; } };
    const extension = { querySelector(selector) { return selector === '.inline-drawer-content' ? extensionContent : extensionToggle; } };
    const documentLike = {
        querySelector(selector) {
            return { '#rm_extensions_block': host, '#extensions-settings-button > .drawer-toggle': hostToggle, '#cig_settings': extension, '#cig_visual_story_surface': surface }[selector] || null;
        },
        defaultView: { getComputedStyle: (element) => element.style },
    };
    const result = revealVisualStorySurface({ documentLike, activateTab: (tab) => calls.tab.push(tab) });
    assert.equal(result.status, 'revealed');
    assert.equal(calls.host, 1);
    assert.equal(calls.extension, 1);
    assert.deepEqual(calls.tab, ['images-cast']);
    assert.equal(calls.scroll, 1);
    assert.equal(calls.focus, 1);
    assert.equal(focusVisualStorySurface({ documentLike }).status, 'focused');
});

test('Visual Story retries heading focus after host tab activation mounts the surface', async () => {
    let ready = false;
    let focusCount = 0;
    const heading = { setAttribute() {}, focus() { focusCount += 1; documentLike.activeElement = heading; } };
    const surface = { scrollIntoView() {}, querySelector() { return heading; } };
    const host = { hidden: false, style: { display: 'block' } };
    const extensionContent = { style: { display: 'block' } };
    const extension = { querySelector(selector) { return selector === '.inline-drawer-content' ? extensionContent : null; } };
    const documentLike = {
        querySelector(selector) {
            if (selector === '#rm_extensions_block') return host;
            if (selector === '#cig_settings') return extension;
            if (selector === '#cig_visual_story_surface') return ready ? surface : null;
            return null;
        },
        activeElement: null,
        defaultView: { getComputedStyle: (element) => element.style },
    };
    const result = revealVisualStorySurface({
        documentLike,
        activateTab: () => setTimeout(() => { ready = true; }, 10),
    });
    assert.equal(result.status, 'pending');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(focusCount, 1);
});

test('Visual Story focus retry stops after success, respects user focus, and cancels stale chat work', () => {
    assert.equal(typeof visualStoryUi.createVisualStoryFocusController, 'function');
    const create = visualStoryUi.createVisualStoryFocusController;
    const origin = {};
    const userControl = {};
    const timers = [];
    const heading = { setAttribute() {}, focus() { this.focused = true; } };
    const surface = { style: { display: 'block' }, scrollIntoView() {}, querySelector() { return heading; } };
    const documentLike = {
        activeElement: origin,
        body: {},
        querySelector(selector) { return selector === '#cig_visual_story_surface' ? surface : null; },
        defaultView: { getComputedStyle: (element) => element.style },
    };
    const controller = create({ documentLike, setTimeoutLike: (callback) => { timers.push(callback); return timers.length; }, clearTimeoutLike() {}, queueMicrotaskLike: (callback) => callback() });
    controller.schedule({ origin });
    assert.equal(heading.focused, true);
    assert.equal(timers.length, 0);

    const pendingTimers = [];
    const pendingDocument = { ...documentLike, activeElement: origin, querySelector(selector) { return null; } };
    const pendingController = create({ documentLike: pendingDocument, setTimeoutLike: (callback) => { pendingTimers.push(callback); return pendingTimers.length; }, clearTimeoutLike() {}, queueMicrotaskLike: (callback) => callback() });
    pendingController.schedule({ origin });
    pendingDocument.activeElement = userControl;
    pendingTimers.shift()?.();
    assert.equal(pendingTimers.length, 0);

    let current = true;
    const staleTimers = [];
    const staleDocument = { ...pendingDocument, activeElement: origin };
    const staleController = create({ documentLike: staleDocument, isCurrent: () => current, setTimeoutLike: (callback) => { staleTimers.push(callback); return staleTimers.length; }, clearTimeoutLike() {}, queueMicrotaskLike: (callback) => callback() });
    staleController.schedule({ origin });
    current = false;
    staleTimers.shift()?.();
    assert.equal(staleTimers.length, 0);
});

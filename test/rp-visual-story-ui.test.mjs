import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { focusVisualStorySurface, renderVisualStorySurface, revealVisualStorySurface } from '../lib/rp/visual-story-ui.js';

const [index, settings, ui] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/visual-story-ui.js', import.meta.url), 'utf8'),
]);

test('Visual Story adds one visible chat entry beside Direct this scene and opens the current chat surface', () => {
    assert.match(index, /cig_message_director[\s\S]*cig_message_visual_story/);
    assert.match(index, /Visual Story/);
    assert.match(index, /revealVisualStorySurface/);
    assert.match(index, /data-cig-visual-story-action/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CHANGED[\s\S]*renderVisualStoryOverview\(\)/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CREATED[\s\S]*renderVisualStoryOverview\(\)/);
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
    assert.match(index, /keydown[\s\S]*cig_message_visual_story/);
    assert.match(index, /Enter[\s\S]*Space/);
    assert.match(ui, /focusVisualStorySurface/);
    assert.match(settings, /cig_visual_story_surface[\s\S]*cig_story_memory_surface/);
});

test('Visual Story renders an honest empty state and focuses the surface after opening closed drawers', () => {
    const html = renderVisualStorySurface({ memoryState: { timeline: [] }, appearanceSummary: '1 of 2 identities have appearance readiness.', cinematicEnabled: false });
    assert.match(html, /No generated moments yet/);
    assert.match(html, /Use the wand or Direct this scene/);
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

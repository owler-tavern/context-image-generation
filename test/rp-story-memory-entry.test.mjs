import test from 'node:test';
import assert from 'node:assert/strict';
import { revealStoryMemoryEntry, selectStoryMemoryEntryWhenReady } from '../lib/rp/story-memory-entry.js';

function fixture({ hostVisible = false, contentVisible = false } = {}) {
    const calls = { hostToggle: 0, contentToggle: 0, tab: [], selected: [], focus: 0, scroll: 0 };
    const documentLike = { querySelector, defaultView: { getComputedStyle: (element) => element.style } };
    const host = { style: { display: hostVisible ? 'block' : 'none' } };
    const hostToggle = { click() { calls.hostToggle += 1; host.style.display = 'block'; } };
    const content = { style: { display: contentVisible ? 'block' : 'none' } };
    const contentToggle = { click() { calls.contentToggle += 1; content.style.display = 'block'; } };
    const heading = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { calls.focus += 1; },
    };
    const surface = {
        querySelector(selector) { return selector === 'h2' ? heading : null; },
        scrollIntoView() { calls.scroll += 1; },
    };
    const cigSettings = {
        querySelector(selector) {
            if (selector === '.inline-drawer-content') return content;
            if (selector === '.inline-drawer-toggle') return contentToggle;
            return null;
        },
    };
    function querySelector(selector) {
        return {
            '#rm_extensions_block': host,
            '#extensions-settings-button > .drawer-toggle': hostToggle,
            '#cig_settings': cigSettings,
            '#cig_story_memory_surface': surface,
        }[selector] || null;
    }
    return { documentLike, calls, host, content, heading };
}

test('story memory entry opens closed host and extension drawers, then focuses the surface', () => {
    const fixtureState = fixture();
    const result = revealStoryMemoryEntry({
        documentLike: fixtureState.documentLike,
        activateTab: (tab) => fixtureState.calls.tab.push(tab),
        selectArtifact: (messageId) => fixtureState.calls.selected.push(messageId),
        messageId: '12',
    });
    assert.deepEqual(fixtureState.calls, { hostToggle: 1, contentToggle: 1, tab: ['images-cast'], selected: ['12'], focus: 1, scroll: 1 });
    assert.equal(fixtureState.heading.attributes.tabindex, '-1');
    assert.equal(result.status, 'revealed');
    assert.equal(result.hostOpened, true);
    assert.equal(result.extensionOpened, true);
});

test('story memory entry preserves already-open drawers and is idempotent', () => {
    const fixtureState = fixture({ hostVisible: true, contentVisible: true });
    revealStoryMemoryEntry({ documentLike: fixtureState.documentLike, activateTab: (tab) => fixtureState.calls.tab.push(tab), messageId: 4 });
    revealStoryMemoryEntry({ documentLike: fixtureState.documentLike, activateTab: (tab) => fixtureState.calls.tab.push(tab), messageId: 4 });
    assert.equal(fixtureState.calls.hostToggle, 0);
    assert.equal(fixtureState.calls.contentToggle, 0);
    assert.deepEqual(fixtureState.calls.tab, ['images-cast', 'images-cast']);
    assert.equal(fixtureState.calls.focus, 2);
    assert.equal(fixtureState.calls.scroll, 2);
});

test('story memory entry selects the exact artifact after a pending scoped load', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const selected = [];
    const selecting = selectStoryMemoryEntryWhenReady({
        loadPromise: pending,
        isCurrent: () => true,
        getTimeline: () => [{ id: 'story:12', messageId: 12, url: '/images/olivia.png' }],
        messageId: 12,
        mediaUrl: '/images/olivia.png',
        selectArtifact: (id) => selected.push(id),
    });
    assert.deepEqual(selected, []);
    release({ status: 'ready' });
    assert.deepEqual(await selecting, { status: 'selected', artifactId: 'story:12' });
    assert.deepEqual(selected, ['story:12']);
});

test('story memory entry refuses a pending artifact selection after chat switch', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let current = true;
    let selected = 0;
    const selecting = selectStoryMemoryEntryWhenReady({
        loadPromise: pending,
        isCurrent: () => current,
        getTimeline: () => [{ id: 'story:12', messageId: 12, url: '/images/olivia.png' }],
        messageId: 12,
        mediaUrl: '/images/olivia.png',
        selectArtifact: () => { selected += 1; },
    });
    current = false;
    release({ status: 'ready' });
    const result = await selecting;
    assert.equal(result.status, 'stale');
    assert.equal(selected, 0);
});

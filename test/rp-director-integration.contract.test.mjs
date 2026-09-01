import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, settings] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
]);

test('ordinary chat exposes only the existing host wand and no extension-owned second entry', () => {
    const mount = index.slice(index.indexOf('function injectMessageButton'), index.indexOf('function visibleCanonMessageSender'));
    assert.match(mount, /cig_message_gen/);
    assert.doesNotMatch(mount, /cig_message_director|cig_message_visual_story|cig_story_memory_inline|Direct this scene|Visual Story/);
    assert.doesNotMatch(index, /\.cig_message_director|\.cig_message_visual_story|\.cig_story_memory_inline/);
});

test('settings owns chat-scoped appearance controls and has no second Generate action', () => {
    assert.match(settings, /id="cig_chat_appearance_sources"/);
    assert.match(settings, /Auto, Avatar, or Description/);
    assert.doesNotMatch(settings, /id="cig_generate_btn"/);
    assert.match(index, /setChatAppearanceSource\(/);
    assert.match(index, /setChatWandPreference\(/);
    assert.match(index, /Auto \(recommended\)/);
    assert.match(index, /Pinned in this chat/);
});

test('ordinary chat keeps image navigation clean and does not render post-image extras', () => {
    assert.match(index, /cig_scene_inspection/); // artifact metadata remains inspectable in Story Memory
    assert.match(index, /cig_continuity_snapshot/); // persisted continuity data remains available to planning
    assert.doesNotMatch(index, /renderVisibleCanonControls\(messageElement/);
    assert.doesNotMatch(index, /renderSceneInspection\(messageElement/);
    assert.doesNotMatch(index, /renderContinuityShelf\(messageElement/);
    assert.doesNotMatch(index, /renderContinuityShelves\(\)/);
    assert.doesNotMatch(index, /renderSceneInspection\(\$\(this\)\)/);
    assert.match(settings, /id="cig_chat_outfit_controls"/u);
    assert.match(index, /cig_chat_outfit_select/u);
    assert.match(index, /function removeRetiredMessageSurfaces\(\)[\s\S]*?\.cig_visible_canon, \.cig_scene_inspection, \.cig_continuity_shelf/u);
    assert.match(index, /Initializing extension[\s\S]*?removeRetiredMessageSurfaces\(\)/u);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CHANGED[\s\S]*?removeRetiredMessageSurfaces\(\)/u);
});

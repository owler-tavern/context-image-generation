import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const referenceReadiness = await readFile(new URL('../lib/rp/reference-readiness.js', import.meta.url), 'utf8');

function panelMarkup(id) {
    const opening = settings.match(new RegExp(`<section\\b[^>]*id="${id}"[^>]*>`));
    assert.ok(opening, `missing #${id}`);
    const closing = settings.indexOf('</section>', opening.index);
    assert.notEqual(closing, -1, `missing closing tag for #${id}`);
    return settings.slice(opening.index, closing + '</section>'.length);
}

function countId(id) {
    return (settings.match(new RegExp(`id="${id}"`, 'g')) || []).length;
}

test('Preferences presents the four scannable groups in the intended order', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    const groupIds = [
        'cig_preferences_image',
        'cig_preferences_scene_context',
        'cig_preferences_references',
        'cig_preferences_automation',
    ];
    const positions = groupIds.map((id) => preferences.indexOf(`id="${id}"`));
    assert.ok(positions.every((position) => position >= 0), 'all preference groups are present');
    assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]), 'preference groups keep their scan order');
    assert.match(preferences, /id="cig_preferences_image"[\s\S]*?<h2>Visual style<\/h2>/);
    assert.match(preferences, /id="cig_preferences_scene_context"[\s\S]*?<h2[^>]*>Scene details<\/h2>/);
    assert.match(preferences, /id="cig_preferences_references"[\s\S]*?<h2[^>]*>Consistency options<\/h2>/);
    assert.match(preferences, /id="cig_preferences_automation"[\s\S]*?<h2>Automation<\/h2>/);
    assert.equal((preferences.match(/<details\b/g) || []).length, 0, 'Preferences has no nested disclosure');
});

test('each existing preference control remains once in its user-facing group', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    const expected = {
        cig_preferences_image: ['cig_aspect_ratio', 'cig_image_size', 'cig_thinking_level', 'cig_use_google_search'],
        cig_preferences_scene_context: ['cig_message_depth', 'cig_system_instruction'],
        cig_preferences_references: ['cig_use_avatars', 'cig_include_descriptions', 'cig_use_previous_image'],
        cig_preferences_automation: ['cig_regenerate_on_swipe', 'cig_auto_generate'],
    };
    const groupIds = Object.keys(expected);
    for (const [position, groupId] of groupIds.entries()) {
        const ids = expected[groupId];
        const start = preferences.indexOf(`id="${groupId}"`);
        const next = position + 1 < groupIds.length
            ? preferences.indexOf(`id="${groupIds[position + 1]}"`)
            : -1;
        const group = preferences.slice(start, next === -1 ? undefined : next);
        for (const id of ids) {
            assert.equal(countId(id), 1, `${id} appears exactly once`);
            assert.match(group, new RegExp(`id="${id}"`), `${id} belongs to ${groupId}`);
        }
    }
});

test('overswipe generation setting explains the image boundary and retains one persisted control', () => {
    const preference = settings.match(/<label[^>]*>[^<]*<input[^>]*id="cig_regenerate_on_swipe"[^>]*>[\s\S]*?<\/label>/)?.[0] || '';
    assert.equal((settings.match(/id="cig_regenerate_on_swipe"/g) || []).length, 1);
    assert.match(preference, />Generate past the last image</);
    assert.match(preference, /title="[^"]*(swipe left|right arrow)[^"]*(swipe left|right arrow)[^"]*"/i);
    assert.match(preference, /cig-setting-help[^>]*>[\s\S]*?(swipe left|right arrow)[\s\S]*?(swipe left|right arrow)/i);
    assert.doesNotMatch(settings, /id="cig_regenerate_on_swipe"[\s\S]*?id="cig_regenerate_on_swipe"/);
});

test('Images and Cast leads with current chat characters and progressively discloses extras', () => {
    const imagesCast = panelMarkup('cig_settings_panel_images_cast');
    assert.ok(imagesCast.indexOf('id="cig_chat_appearance_sources"') < imagesCast.indexOf('id="cig_extra_story_tools"'));
    assert.match(imagesCast, /id="cig_gallery"[^>]*>[\s\S]*?<h2>Gallery<\/h2>/);
    assert.match(imagesCast, /id="cig_appearances"[\s\S]*?<h2>Appearance memory<\/h2>/);
    assert.equal((imagesCast.match(/<details\b/g) || []).length, 0, 'Images and Cast has no nested details');
    assert.match(imagesCast, /Use the wand on any RP message to generate an image\./);
    assert.match(imagesCast, /Generate an image, then use Remember latest generated image here\./);
    assert.match(imagesCast, /Remember a generated image as a reusable character appearance\./);
});

test('Gallery keeps only semantic non-generative controls; the wand is the sole generation entry', () => {
    assert.equal(settings.includes('id="cig_generate_btn"'), false);
    for (const id of ['cig_clear_gallery']) {
        const button = settings.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`));
        assert.ok(button, `${id} is a button`);
        assert.match(button[0], /type="button"/);
        assert.match(button[0], /aria-label="[^"]+"/);
    }
});

test('Images and Cast exposes current-chat appearance source configuration without a second Generate action', () => {
    const imagesCast = panelMarkup('cig_settings_panel_images_cast');
    assert.match(imagesCast, /id="cig_chat_appearance_sources"/);
    assert.match(imagesCast, /<h2>Current chat characters<\/h2>/);
    assert.match(imagesCast, /Auto, Avatar, or Description/);
    assert.doesNotMatch(imagesCast, /Generate image from the last message/);
});

test('Current chat characters includes one collapsed provider-free reference readiness summary', () => {
    const imagesCast = panelMarkup('cig_settings_panel_images_cast');
    assert.match(imagesCast, /id="cig_reference_readiness"[^>]*hidden/);
    assert.match(index, /projectReferenceReadiness\(/u);
    assert.match(index, /renderReferenceReadiness\(/u);
    assert.match(referenceReadiness, /Reference readiness for this chat/u);
    assert.match(index, /modelMax: capability\?\.maxCount/u);
    assert.doesNotMatch(index, /projectReferenceReadiness\([\s\S]{0,1200}(?:fetch|dispatchProviderRoute|generateImage|saveSettings)/u);
    assert.match(index, /REFERENCE_READINESS_CSS/);
    assert.match(index, /allowAvatars: currentSettings\.use_avatars === true/u);
    assert.match(index, /allowDescriptions: currentSettings\.include_descriptions === true/u);
    assert.match(index, /sourcePreferences: appearanceSourcePreferences\(\)/u);
    assert.match(index, /#cig_use_avatars[\s\S]{0,180}renderChatAppearanceSources\(\)/u);
    assert.match(index, /#cig_include_descriptions[\s\S]{0,180}renderChatAppearanceSources\(\)/u);
    assert.match(index, /#cig_use_previous_image[\s\S]{0,700}renderChatAppearanceSources\(\)/u);
});

test('everyday settings use plain task groups and keep advanced/provider language out of them', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    const imagesCast = panelMarkup('cig_settings_panel_images_cast');
    assert.match(preferences, /<h2>Visual style<\/h2>/);
    assert.match(preferences, /<h2>Automation<\/h2>/);
    assert.match(imagesCast, /<h2>Current chat characters<\/h2>/);
    assert.match(imagesCast, /id="cig_extra_story_tools"[\s\S]*?Story Memory/);
    assert.doesNotMatch(`${preferences}${imagesCast}`, /canon|reference plan|revision|cast override|route contract/i);
    assert.match(preferences, /Framing, continuity, and custom visual direction are saved for the current chat/);
    assert.match(preferences, /Message depth and system instruction apply to every chat/);
});

test('story extras are opt-in, grouped once, and keep the ordinary view core-only by default', () => {
    const imagesCast = panelMarkup('cig_settings_panel_images_cast');
    assert.match(imagesCast, /id="cig_extra_story_tools"/);
    assert.match(imagesCast, /id="cig_extra_story_tools_enabled"[^>]*type="checkbox"/);
    for (const id of ['cig_extra_story_memory', 'cig_extra_appearance_memory', 'cig_extra_cinematic', 'cig_extra_iteration', 'cig_extra_gallery']) {
        assert.equal(countId(id), 1, `${id} appears exactly once`);
        assert.match(imagesCast, new RegExp(`id="${id}"`));
    }
    assert.match(imagesCast, /Turn off all extras/);
    assert.match(imagesCast, /Nothing is deleted/);
    assert.ok(imagesCast.indexOf('id="cig_chat_appearance_sources"') < imagesCast.indexOf('id="cig_extra_story_tools"'));
});

test('Appearance memory can create its first look without enabling the visible Gallery', () => {
    assert.match(settings, /id="cig_appearance_remember_latest"/u);
    assert.match(index, /!extraStoryToolEnabled\('gallery'\) && !extraStoryToolEnabled\('appearanceMemory'\)/u);
    assert.match(index, /#cig_appearance_remember_latest/u);
    assert.match(index, /findIndex\(\(item\) => currentChatId && String\(item\?\.chatId \|\| ''\) === currentChatId\)/u);
    assert.match(index, /rememberGalleryAppearance\(index\)/u);
});

test('gallery preview and appearance actions are semantic and identify their outcome', () => {
    assert.match(index, /<button type="button" class="cig_gallery_preview"/);
    assert.match(index, /aria-label="View generated image"/);
    assert.match(index, /on\('click', '\.cig_gallery_preview'/);
    assert.match(index, /Use \$\{look\.label\} for \$\{identity\.label\}/);
    assert.match(index, /Stop using \$\{look\.label\} in this chat/);
    assert.match(index, /Delete \$\{look\.label\} everywhere for \$\{identity\.label\}/);
});

test('reference capability feedback preserves saved preferences and clears when support returns', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    assert.match(preferences, /id="cig_reference_capability_note"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(preferences, /id="cig_avatar_reference_option"/);
    assert.match(preferences, /id="cig_previous_image_reference_option"/);
    assert.match(index, /projectReferencePreferences\(/);
    assert.match(index, /#cig_avatar_reference_option'\)\.toggle\(referencePreferences\.showAvatarControl\)/);
    assert.match(index, /#cig_previous_image_reference_option'\)\.toggle\(referencePreferences\.showPreviousImageControl\)/);
    assert.match(index, /#cig_reference_capability_note'\)\.text\(referencePreferences\.note\)\.prop\('hidden', !referencePreferences\.note\)/);
    assert.doesNotMatch(index, /settings\.use_avatars\s*=\s*false/);
    assert.doesNotMatch(index, /settings\.use_previous_image\s*=\s*false/);
});

test('image-size capability feedback preserves its saved value and the gallery popup is a real dialog', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    assert.match(preferences, /id="cig_image_size_capability_note"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(index, /projectImageSizePreference\(settings\.image_size, ui\.imageSizeOptions\)/);
    assert.doesNotMatch(index, /settings\.image_size\s*=\s*ui\.imageSize/);
    assert.match(index, /role="dialog" aria-modal="true" aria-labelledby="cig_popup_title"/);
    assert.match(index, /<button type="button" class="cig_popup_close" aria-label="Close image preview">/);
    assert.match(index, /createAccessibleDialogController/);
    assert.match(index, /Image preview —/);
});

test('gallery and dialog controls retain visible, touch-safe focus affordances', () => {
    assert.match(style, /\.cig_gallery_preview:focus-visible\s*\{[\s\S]*outline-offset:\s*-4px/);
    const closeRule = style.match(/\.cig_popup_close\s*\{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(closeRule, /min-width:\s*44px/);
    assert.match(closeRule, /min-height:\s*44px/);
    assert.match(style, /\.cig_popup_close:focus-visible\s*\{[\s\S]*outline:/);
});

test('plain-language preference UI excludes diagnostic vocabulary and duplicate Retry actions', () => {
    const preferences = panelMarkup('cig_settings_panel_preferences');
    assert.doesNotMatch(preferences, /API|endpoint|proxy|adapter|transport|model ID|diagnostic/i);
    assert.ok((settings.match(/>\s*Retry\s*</g) || []).length <= 1, 'settings does not duplicate Retry');
});

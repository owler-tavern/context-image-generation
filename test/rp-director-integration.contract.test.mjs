import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, manifest, ui, dispatch] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/director-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/providers/dispatch.js', import.meta.url), 'utf8'),
]);

test('Director is mounted on real message and chat lifecycle entry points', () => {
    assert.match(index, /createDirectorRuntime/);
    assert.match(index, /createDirectorSurface\(\)/);
    assert.match(index, /cig_message_director/);
    assert.match(index, /Direct this scene/);
    assert.match(index, /eventSource\.on\(event_types\.CHAT_CHANGED/);
    assert.match(index, /directorRuntime\?\.load\(\{ chatId: getContext\(\)\.chatId/);
    assert.match(index, /eventSource\.on\(event_types\.CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /eventSource\.on\(event_types\.USER_MESSAGE_RENDERED/);
    assert.match(index, /buildSceneGenerationSnapshot\(/);
});

test('Director has a provider-free draft surface and one explicit dispatch action', () => {
    assert.match(ui, /No image is made until Generate/);
    assert.match(ui, /Generate directed image/);
    assert.match(ui, /data-director-action="close"/);
    assert.match(index, /directorRuntime\.open\(payload\)/);
    assert.match(index, /directorRuntime\.update\(payload\)/);
    assert.match(index, /directorRuntime\.close\(\)/);
    assert.match(index, /directorRuntime\.generate\(\)/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt, sender, messageId,\s*focusText \|\| null, target, 'director', \{ framing, continuity, visualDirection \}\)/);
    assert.match(index, /if \(attached !== true\) return \{ status: 'failed'/);
});

test('Director exposes bounded accessible controls and coherent release identity', () => {
    assert.match(ui, /min-height:44px/);
    assert.match(ui, /maxlength="1000"/);
    assert.match(ui, /@media \(max-width:480px\)/);
    assert.match(index, /captureWandGenerationInput\(\{/);
    assert.match(index, /selectionText: captured\.focusText/);
    assert.equal(JSON.parse(manifest).version, '1.8.0');
    assert.match(index, /Version 1\.8\.0/);
});

test('Director uses the shared invocation and immutable P2 override seams', () => {
    assert.match(index, /continuation = null, generationOverrides = null/);
    assert.match(index, /generationOverrides/);
    assert.match(index, /invocation, finalize, null, generationOverrides/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt, sender, messageId, focusText \|\| null, target, 'director', \{ framing, continuity, visualDirection \}\)/);
    assert.doesNotMatch(index, /const direction = \[framing/);
    assert.match(index, /readDurableState: \(\{ chatId \} = \{\}\)/);
    assert.match(index, /saveDurableState: async \(\) => \{ await saveSettings\(\); \}/);
    assert.match(index, /Exact provider cost is unavailable; one generation will be requested only when Generate is pressed/);
    assert.match(dispatch, /\['settings', 'wand', 'slash', 'director'\]/);
});

test('Director trigger is one visible semantic inline action outside the host button strip', () => {
    const mount = index.slice(index.indexOf('function injectMessageButton'), index.indexOf('function visibleCanonMessageSender'));
    assert.match(mount, /messageElement\.find\('\.cig_message_director'\)\.remove\(\)/);
    assert.match(mount, /<button type="button" class="menu_button cig_message_director cig_message_director_inline">Direct this scene<\/button>/);
    assert.match(mount, /const textAnchor = messageElement\.find\('\.mes_text'\)\.last\(\)/);
    assert.match(mount, /textAnchor\.length\) textAnchor\.after\(directorButton\)/);
    assert.doesNotMatch(mount, /directorButton\)\.after|extraButtons\.(?:after|prepend)\(directorButton\)/);
    assert.match(ui, /cig_message_director_inline[^{]*\{[^}]*min-height:\s*44px/s);
});

test('Director keyboard disclosure enters the panel and guarded close restores its exact opener', () => {
    assert.match(index, /async function openDirectorFromTrigger\(trigger\)/);
    assert.match(index, /const focusCapture = \{ trigger, chatId, epoch, messageId \}/);
    assert.match(index, /focusDirectorPanel\(\{ documentLike: document, messageId \}\)/);
    assert.match(index, /keydown', '\.cig_message_director'/);
    assert.match(index, /e\.key !== 'Enter' && e\.key !== ' ' && e\.key !== 'Spacebar'/);
    assert.match(index, /\$\(e\.currentTarget\)\.trigger\('click'\)/);
    assert.match(index, /restoreDirectorTriggerFocus\(\{/);
    assert.match(index, /directorFocusCaptureIsCurrent\(focusCapture\)/);
    assert.match(index, /directorFocusCapture = null/);
    assert.match(ui, /data-director-field="framing"/);
    assert.match(ui, /data-director-action="generate".*data-director-action="close"/s);
});

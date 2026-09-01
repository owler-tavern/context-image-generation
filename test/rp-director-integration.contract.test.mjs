import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, manifest, ui] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/director-ui.js', import.meta.url), 'utf8'),
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
    assert.match(index, /attachGeneratedImage\(message, element, prompt, sender, messageId, focusText \|\| null, target, 'director'\)/);
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

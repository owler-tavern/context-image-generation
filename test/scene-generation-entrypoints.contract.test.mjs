import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, settings, navigation, cinematicUi] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/image-navigation.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/cinematic-ui.js', import.meta.url), 'utf8'),
]);

test('ADR-002 removes every known secondary generation dispatcher atomically', () => {
    for (const prohibited of [
        'autoGenerateForMessage',
        'generatePastLastImage',
        'dispatchIterationPlan',
        'createDirectorSurface',
        'directorRuntime',
        'directorUiController',
    ]) {
        assert.doesNotMatch(index, new RegExp(`\\b${prohibited}\\b`, 'u'), `${prohibited} must not remain in production`);
    }

    assert.doesNotMatch(index, /Cinematic image generated/u);
    assert.doesNotMatch(index, /attachGeneratedImage\([^)]*'director'/su);
    assert.doesNotMatch(navigation, /generatePastLast|generationActive|action:\s*'generate'|\bgenerate\b/u);
    assert.doesNotMatch(cinematicUi, /\bapprove\b/u);
});

test('wand and slash remain registered through the shared production entry-point seam', () => {
    assert.match(index, /createSceneGenerationKernel\(/u);
    assert.match(index, /createProductionGenerationEntrypoints\(/u);
    assert.match(index, /registerProductionGenerationEntrypoints\(/u);
    assert.doesNotMatch(index, /createWandEntryAdapter\(|createSlashEntryAdapter\(/u);
    assert.match(index, /on\('click',\s*'\.cig_message_gen'/u);
    assert.match(index, /name:\s*'proimagine'/u);
    assert.match(index, /aliases:\s*\['proimg',\s*'geminiimg'\]/u);
});

test('retired settings values remain stored but have no visible or bound controls', () => {
    assert.match(index, /auto_generate:\s*'off'/u);
    assert.match(index, /regenerate_on_swipe:\s*false/u);
    assert.doesNotMatch(settings, /id="cig_(?:auto_generate|regenerate_on_swipe)"/u);
    assert.doesNotMatch(index, /\$\('#cig_(?:auto_generate|regenerate_on_swipe)'\)/u);
});

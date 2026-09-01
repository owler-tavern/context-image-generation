import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('production Director wiring captures cast correction and sends it through the shared plan path', () => {
    assert.match(index, /inferDirectorCast/);
    assert.match(index, /castCandidates/);
    assert.match(index, /castOverrides/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt, sender, messageId, focusText \|\| null, target, 'director', \{ framing, continuity, visualDirection, castOverrides \}\)/);
});

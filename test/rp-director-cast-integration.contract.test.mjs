import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, scene, plan, directorCast, castPolicy] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/scene-generation.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/generation-plan.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/director-cast.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/rp/cast-policy.js', import.meta.url), 'utf8'),
]);

test('production Director wiring captures cast correction and sends it through the shared plan path', () => {
    assert.match(index, /inferDirectorCast/);
    assert.match(index, /castCandidates/);
    assert.match(index, /castOverrides/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt, sender, messageId, focusText \|\| null, target, 'director', \{ framing, continuity, visualDirection, castOverrides \}\)/);
    assert.match(index, /const effectiveCastOverrides =/);
    assert.match(index, /castOverrides: effectiveCastOverrides/);
    assert.match(scene, /validateDirectorCastOverrides/);
    assert.match(scene, /castCorrection\?\.promptLine/);
    assert.match(directorCast, /from '\.\/cast-policy\.js'/);
    assert.match(castPolicy, /Do not depict/);
    assert.match(plan, /applyDirectorCastToReferences/);
    assert.match(castPolicy, /cast-excluded/);
});

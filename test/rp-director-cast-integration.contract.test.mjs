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

test('wand cast correction remains in the shared plan after Director dispatch removal', () => {
    assert.doesNotMatch(index, /createDirectorSurface|directorRuntime|directorUiController/u);
    assert.match(index, /castOverrides/);
    assert.match(index, /const effectiveCastOverrides = invocation === 'wand' \? chatCastPreferences\(\) : \[\]/u);
    assert.match(index, /castOverrides: effectiveCastOverrides/);
    assert.match(scene, /validateDirectorCastOverrides/);
    assert.match(scene, /castCorrection\?\.promptLine/);
    assert.match(directorCast, /from '\.\/cast-policy\.js'/);
    assert.match(castPolicy, /Do not depict/);
    assert.match(plan, /applyDirectorCastToReferences/);
    assert.match(castPolicy, /cast-excluded/);
});

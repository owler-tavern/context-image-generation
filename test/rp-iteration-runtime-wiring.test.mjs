import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production runtime has no generation-capable iteration controller or dispatcher', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    for (const prohibited of ['dispatchIterationPlan', 'renderIterationActionSurface', 'createIterationSurfaceController', 'mountIterationSurface']) {
        assert.doesNotMatch(source, new RegExp(`\\b${prohibited}\\b`, 'u'));
    }
    assert.doesNotMatch(source, /data-cig-iteration-(?:open|improve)/u);
});

test('historical iteration recipe and provenance remain readable without dispatch wiring', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const storyMemory = await readFile(new URL('../lib/rp/story-memory-runtime.js', import.meta.url), 'utf8');
    const iterationDomain = await readFile(new URL('../lib/rp/iteration-domain.js', import.meta.url), 'utf8');
    assert.match(storyMemory, /item\.cig_iteration_artifact/u);
    assert.match(iterationDomain, /sanitizeIterationArtifactForStorage/u);
    assert.doesNotMatch(source, /__cigIterationArtifact/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production runtime imports and mounts the iteration controller for active inline media', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /createIterationSurfaceController/);
    assert.match(source, /mountIterationSurface/);
    assert.match(source, /data-cig-iteration-improve/);
    assert.match(source, /cig_iteration_artifact/);
    assert.match(source, /Improve/);
});

test('production runtime stores the dispatched recipe and provenance on generated media', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /createIterationArtifact\(/);
    assert.match(source, /__cigIterationArtifact/);
    assert.match(source, /__cigStoryMemoryFacts/);
    assert.match(source, /iterationArtifact/);
});

test('iteration submit is distinct from action selection and uses coordinator/persistence seams', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /data-cig-iteration-open/);
    assert.match(source, /dispatchCoordinator/);
    assert.match(source, /dispatchIterationPlan/);
    assert.match(source, /generateImageFromPromptInternal/);
    assert.match(source, /dispatchProviderRoute/);
    assert.match(source, /readbackArtifact/);
    assert.match(source, /readbackOriginalArtifact/);
    assert.match(source, /verifyCanonicalEligibility/);
    assert.match(source, /readbackCanonical/);
    assert.match(source, /cig_iteration_persistence/);
    assert.match(source, /reserveInvocation:/);
    assert.match(source, /releaseInvocation:/);
});

test('iteration dispatch reuses the outer coordinator signal instead of nesting a target run', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const dispatchStart = source.indexOf('async function dispatchIterationPlan');
    const dispatchEnd = source.indexOf('async function persistIterationCanonicalRoles');
    const dispatch = source.slice(dispatchStart, dispatchEnd);
    assert.match(dispatch, /generateImageFromPromptInternal\([\s\S]*,\s*null,\s*signal\)/);
    assert.match(dispatch, /generated\.imageData[\s\S]*generated\.__cigStoryMemoryFacts/);
    assert.match(source, /const execution = coordinatorOverride\s*\?\s*coordinatorOverride\.enqueue/);
});

test('iteration lifecycle is refreshed after message render, swipe navigation, chat change, and chat creation', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /renderIterationActionSurface/);
    assert.match(source, /onCigMessageRendered/);
    assert.match(source, /CHAT_CHANGED/);
    assert.match(source, /CHARACTER_MESSAGE_RENDERED/);
    assert.match(source, /USER_MESSAGE_RENDERED/);
    assert.match(source, /CHAT_CREATED/);
    assert.match(source, /configureCigImageArrows/);
});

test('Improve is a visible action before opening, while submit remains the only dispatch trigger and originals are retained', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../lib/rp/iteration-ui.js', import.meta.url), 'utf8');
    const render = source.slice(source.indexOf('function renderIterationActionSurface'));
    assert.match(render, /data-cig-iteration-open="true"/);
    assert.match(render, /\.text\('Improve'\)/);
    assert.match(render, /mountIterationSurface/);
    assert.match(source, /originalArtifact/);
    assert.match(source, /cig_iteration_artifact: await iterationArtifactForStorage/);
    assert.match(ui, /data-iteration-submit/);
    assert.match(ui, /controller\.submit/);
});

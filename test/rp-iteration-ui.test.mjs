import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTION_LABELS,
    createIterationSurfaceController,
    mountIterationSurface,
    renderIterationSurface,
} from '../lib/rp/iteration-ui.js';

const sourceArtifact = Object.freeze({
    artifactId: 'artifact:original',
    sourcePassage: { text: 'Ava waits in the station.' },
    effectivePrompt: 'Ava waits in the station.',
    references: [{ id: 'ref:ava', role: 'active-look', identityId: 'ava' }],
    model: { providerId: 'test', modelId: 'image-model' },
    route: { providerId: 'test', connectionId: 'verified' },
    options: { aspectRatio: '16:9' },
    canonSnapshot: { activeLook: { identityId: 'ava', lookId: 'look:1' } },
});

function dependencies(overrides = {}) {
    const calls = { dispatch: [], persist: [], readback: [], canonical: [], canonicalReadback: [] };
    const deps = {
        sourceArtifact,
        generationPlan: { planId: 'registry:plan', revision: 'revision:1', capabilities: { imageGeneration: true } },
        verifyGenerationPlan: () => ({
            status: 'verified', planId: 'registry:plan', revision: 'revision:1',
            authorityToken: 'authority', routeResolved: true, capabilities: { imageGeneration: true },
        }),
        verifyCanonicalEligibility: ({ artifactId }) => ({ status: 'eligible', artifactId, authorityToken: 'canon' }),
        reserveInvocation: () => true,
        estimateCost: ({ outputCount }) => outputCount * 0.04,
        dispatchCoordinator: async (plan) => {
            calls.dispatch.push(plan);
            return { artifacts: plan.artifacts };
        },
        persistArtifact: async (input) => { calls.persist.push(input); return { status: 'saved' }; },
        readbackArtifact: async (input) => { calls.readback.push(input); return { status: 'confirmed' }; },
        mutateCanonical: async (input) => { calls.canonical.push(input); return { status: 'mutated' }; },
        readbackCanonical: async (input) => { calls.canonicalReadback.push(input); return { status: 'confirmed' }; },
        invocationId: 'ui-test-invocation',
        ...overrides,
    };
    return { deps, calls };
}

test('surface projects the five visible actions, compact editors, status, and keyboard-safe controls', () => {
    const html = renderIterationSurface({
        status: 'idle',
        action: 'vary-shot',
        prompt: 'Ava waits',
        composition: { framing: 'wide', camera: 'eye level' },
        twoUp: true,
        originalArtifact: sourceArtifact,
    });

    for (const label of Object.values(ACTION_LABELS)) assert.match(html, new RegExp(label.replace(/[&]/gu, '&amp;')));
    assert.match(html, /textarea[^>]+aria-label="Prompt"/u);
    assert.match(html, /name="framing"/u);
    assert.match(html, /name="camera"/u);
    assert.match(html, /type="checkbox"[^>]+name="twoUp"/u);
    assert.match(html, /role="status"/u);
    assert.match(html, /min-height:44px/u);
    assert.match(html, /data-iteration-action="vary-shot"/u);
    assert.match(html, /Original retained/u);
});

test('controller quotes finite two-up cost and requires matching explicit consent before dispatch', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'vary-shot', twoUp: true, changes: { composition: { framing: 'wide' } } });
    assert.deepEqual(quote, { outputCount: 2, cost: 0.08, finite: true });

    const blocked = await controller.submit({ action: 'vary-shot', twoUp: true, changes: { composition: { framing: 'wide' } } });
    assert.equal(blocked.status, 'consent-required');
    assert.equal(calls.dispatch.length, 0);

    const ready = await controller.submit({
        action: 'vary-shot', twoUp: true,
        changes: { composition: { framing: 'wide' } },
        consent: { approved: true, outputCount: 2 },
    });
    assert.equal(ready.status, 'awaiting-selection');
    assert.equal(ready.artifacts.length, 2);
    assert.equal(ready.originalArtifact.artifactId, sourceArtifact.artifactId);
    assert.equal(calls.dispatch.length, 1);
});

test('two-up chooser persists only the chosen output and keeps the original artifact', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    await controller.submit({
        action: 'reuse-recipe', twoUp: true,
        consent: { approved: true, outputCount: 2 },
    });
    const chosenId = controller.getState().artifacts[1].artifactId;
    const result = await controller.chooseArtifact(chosenId);
    assert.equal(result.status, 'completed');
    assert.equal(calls.persist.length, 1);
    assert.equal(calls.persist[0].artifact.artifactId, chosenId);
    assert.equal(calls.readback.length, 1);
    assert.equal(result.originalArtifact.artifactId, sourceArtifact.artifactId);
});

test('repaired prompt is shown for confirmation and cannot dispatch before confirmation', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const draft = controller.preparePrompt('Ava (waits');
    assert.equal(draft.status, 'repaired');
    assert.equal(controller.getState().status, 'draft-review');
    const blocked = await controller.submit({ action: 'retry-repaired-prompt', consent: { approved: true, outputCount: 1 } });
    assert.equal(blocked.status, 'draft-review');
    assert.equal(calls.dispatch.length, 0);
    controller.confirmRepairedPrompt();
    const completed = await controller.submit({ action: 'retry-repaired-prompt', consent: { approved: true, outputCount: 1 } });
    assert.equal(completed.status, 'completed');
});

test('missing authoritative dependencies fail closed without dispatch', async () => {
    for (const missing of ['verifyGenerationPlan', 'estimateCost', 'reserveInvocation', 'dispatchCoordinator', 'persistArtifact', 'readbackArtifact']) {
        const { deps, calls } = dependencies({ [missing]: undefined });
        const controller = createIterationSurfaceController(deps);
        const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1 } });
        assert.equal(result.status, 'error', missing);
        assert.match(result.error, new RegExp(missing), missing);
        assert.equal(calls.dispatch.length, 0, missing);
    }
});

test('canonical action uses injected mutation and readback, never generation dispatch', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const result = await controller.submit({ action: 'make-canonical', changes: { roles: { chatBackground: 'quiet suspense' } } });
    assert.equal(result.status, 'completed');
    assert.equal(calls.dispatch.length, 0);
    assert.equal(calls.canonical.length, 1);
    assert.equal(calls.canonicalReadback.length, 1);
});

test('mount exposes a stable render seam and cleans up event listeners', () => {
    const { deps } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    };
    const mounted = mountIterationSurface(host, controller);
    assert.match(host.innerHTML, /data-cig-rp-iteration-surface/u);
    assert.equal(typeof mounted.render, 'function');
    assert.equal(listeners.has('click'), true);
    mounted.destroy();
    assert.equal(listeners.size, 0);
});

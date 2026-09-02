import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationCoordinator } from '../lib/generation-coordinator.js';
import { createSceneGenerationKernel } from '../lib/scene-generation/kernel.js';

function createEntryAdapters(kernel) {
    return Object.freeze({
        wand: (overrides = {}) => kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene', ...overrides }),
        slash: (overrides = {}) => kernel.generate({ source: 'slash', destination: 'preview-gallery', prompt: 'scene', ...overrides }),
    });
}

function createDependencies(overrides = {}) {
    return {
        capture: async (request) => ({ request, captured: true }),
        collectReferences: async () => ({ references: [], assets: {} }),
        createPlan: ({ snapshot, references, request }) => ({ snapshot, references, request, ready: true }),
        coordinate: async (_key, run) => run(),
        dispatch: async (plan) => ({ imageData: 'AA==', mimeType: 'image/png', plan }),
        generationKey: (request) => `${request.source}:${request.destination}`,
        ...overrides,
    };
}

function normalizedError(error, scope) {
    return Object.assign(new Error(`normalized ${scope}`), {
        category: 'scene-generation',
        code: 'GENERATION_FAILED',
        scope,
        causeName: error.name,
    });
}

test('kernel captures, contributes references, plans, coordinates, and dispatches once', async () => {
    const calls = [];
    const kernel = createSceneGenerationKernel({
        capture: async request => (calls.push('capture'), { request }),
        collectReferences: async snapshot => (calls.push('references'), { snapshot, assets: {} }),
        createPlan: input => (calls.push('plan'), { input }),
        coordinate: async (_key, run) => (calls.push('coordinate'), run()),
        dispatch: async plan => (calls.push('dispatch'), { imageData: 'AA==', mimeType: 'image/png', plan }),
        generationKey: () => 'wand:chat:message',
    });

    const result = await kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene' });

    assert.deepEqual(calls, ['capture', 'references', 'plan', 'coordinate', 'dispatch']);
    assert.equal(result.artifact.mimeType, 'image/png');
    assert.equal(result.plan.input.snapshot.request, result.request);
    assert.deepEqual(result.plan.input.references, { snapshot: result.plan.input.snapshot, assets: {} });
    assert.equal(Object.isFrozen(result), true);
});

test('kernel allows a text-only plan when no references are available', async () => {
    let dispatchedPlan;
    const kernel = createSceneGenerationKernel(createDependencies({
        collectReferences: async () => undefined,
        dispatch: async (plan) => {
            dispatchedPlan = plan;
            return { imageData: 'AA==', mimeType: 'image/png' };
        },
    }));

    const result = await kernel.generate({ source: 'slash', destination: 'preview-gallery', prompt: 'castle' });

    assert.equal(result.artifact.mimeType, 'image/png');
    assert.equal(dispatchedPlan.references, undefined);
});

test('both entry adapters normalize invalid requests before capture with identical fields', async () => {
    let captures = 0;
    let normalizations = 0;
    const kernel = createSceneGenerationKernel(createDependencies({
        capture: async () => { captures += 1; },
        normalizeError: (error, scope) => {
            normalizations += 1;
            return normalizedError(error, scope);
        },
    }));
    const entries = createEntryAdapters(kernel);

    for (const entry of Object.values(entries)) {
        await assert.rejects(
            entry({ source: 'settings' }),
            (error) => error.category === 'scene-generation'
                && error.code === 'GENERATION_FAILED'
                && error.scope === 'scene-generation'
                && error.causeName === 'Error',
        );
    }

    assert.equal(captures, 0);
    assert.equal(normalizations, 2);
});

test('both entry adapters normalize readiness failures exactly once with identical fields', async () => {
    let normalizations = 0;
    const kernel = createSceneGenerationKernel(createDependencies({
        capture: async () => { throw new Error('route is not ready'); },
        normalizeError: (error, scope) => {
            normalizations += 1;
            return normalizedError(error, scope);
        },
    }));
    const entries = createEntryAdapters(kernel);

    for (const entry of Object.values(entries)) {
        await assert.rejects(entry(), (error) => error.category === 'scene-generation'
            && error.code === 'GENERATION_FAILED'
            && error.scope === 'scene-generation'
            && error.causeName === 'Error');
    }

    assert.equal(normalizations, 2);
});

test('both entry adapters normalize dispatch failures exactly once with identical fields', async () => {
    let normalizations = 0;
    const kernel = createSceneGenerationKernel(createDependencies({
        dispatch: async () => { throw new Error('provider rejected request'); },
        normalizeError: (error, scope) => {
            normalizations += 1;
            return normalizedError(error, scope);
        },
    }));
    const entries = createEntryAdapters(kernel);

    for (const entry of Object.values(entries)) {
        await assert.rejects(entry(), (error) => error.category === 'scene-generation'
            && error.code === 'GENERATION_FAILED'
            && error.scope === 'scene-generation'
            && error.causeName === 'Error');
    }

    assert.equal(normalizations, 2);
});

test('kernel passes Task 4 adapter seams through capture, materialization, plan construction, and dispatch', async () => {
    const received = {};
    const kernel = createSceneGenerationKernel(createDependencies({
        capture: async (request) => (received.captureRequest = request, { captured: request }),
        collectReferences: async (snapshot, request) => (received.materialization = { snapshot, request }, { assets: { 'asset:avatar': 'AA==' } }),
        createPlan: (input) => (received.planInput = input, { id: 'plan:1', ...input }),
        coordinate: async (key, run, plan) => (received.key = key, received.coordinatedPlan = plan, run(new AbortController().signal)),
        dispatch: async (plan, signal) => (received.dispatch = { plan, signal }, { imageData: 'AA==', mimeType: 'image/png' }),
    }));

    const result = await kernel.generate({ source: 'wand', destination: 'message', prompt: 'harbour' });

    assert.equal(received.captureRequest, result.request);
    assert.equal(received.materialization.snapshot, result.plan.snapshot);
    assert.equal(received.materialization.request, result.request);
    assert.equal(received.planInput.request, result.request);
    assert.equal(received.coordinatedPlan, result.plan);
    assert.equal(received.dispatch.plan, result.plan);
    assert.equal(received.dispatch.signal.aborted, false);
});

test('duplicate coordination prevents a second dispatch for the same generation key', async () => {
    const coordinator = createGenerationCoordinator();
    let release;
    let dispatches = 0;
    const kernel = createSceneGenerationKernel(createDependencies({
        coordinate: coordinator.run,
        generationKey: () => 'wand:chat:message',
        dispatch: async () => {
            dispatches += 1;
            await new Promise((resolve) => { release = resolve; });
            return { imageData: 'AA==', mimeType: 'image/png' };
        },
    }));

    const first = kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene' });
    await new Promise((resolve) => setImmediate(resolve));
    const second = kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene' });

    await assert.rejects(second, /already in progress/);
    assert.equal(dispatches, 1);
    release();
    await first;
});

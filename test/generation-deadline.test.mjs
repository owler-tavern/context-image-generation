import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { createRunCoordinator } from '../lib/generation-coordinator.js';
import { DEFAULT_TRANSPORTS, dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { getModelDefinition } from '../lib/providers/registry.js';
import { createCapturedReferenceContributors, createReferenceContributorPipeline } from '../lib/scene-generation/reference-contributors.js';
import { createSceneGenerationKernel } from '../lib/scene-generation/kernel.js';
import { createDiagnosticsExport } from '../lib/providers/diagnostics.js';
import { attachGeneratedImageSafely } from '../lib/rp-attachment.js';
import { createMessageDeliveryAdapter } from '../lib/scene-generation/delivery.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settlesWithin(promise, ms = 100) {
    return Promise.race([
        promise.then(
            (value) => ({ status: 'fulfilled', value }),
            (error) => ({ status: 'rejected', error }),
        ),
        wait(ms).then(() => ({ status: 'timed-out' })),
    ]);
}

function plan(id, target = 'chat:deadline') {
    return {
        schema: 2,
        id,
        idempotencyKey: id,
        invocation: 'wand',
        target: { chatId: target },
        resolved: { providerId: 'linkapi', modelId: 'gemini-3.1-flash-image-preview', transportId: 'sillytavern-gemini-proxy' },
    };
}

function injectedPlan(id = 'injected-result') {
    return createGenerationPlan({
        id,
        invocation: 'wand',
        resolved: {
            connectionId: 'fixture:default',
            providerId: 'fixture',
            modelId: 'fixture-image',
            transportId: 'fixture-transport',
            endpoint: 'https://fixture.invalid',
            routeEvidence: {
                state: 'verified',
                source: 'official-docs',
                observedAt: '2026-09-02T00:00:00.000Z',
                protocol: 'openai-images',
                requestShapeRevision: 'openai-images-v1',
            },
        },
        prompt: { sourceMessage: 'scene' },
    });
}

test('generation-wide deadline settles a never-ending avatar materialization and releases its target', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    let avatarSignal;
    const contributors = createCapturedReferenceContributors({
        resolveAvatarReferences: () => [{ id: 'host:character', role: 'host-avatar', assetId: 'asset:character' }],
        materializeAvatarAssets: async (_input, _references, { signal }) => {
            avatarSignal = signal;
            await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
            return {};
        },
    });
    const pipeline = createReferenceContributorPipeline(contributors);
    const pending = coordinator.enqueue(plan('avatar-timeout'), (signal, run) => pipeline.collect({
        referencesEnabled: true,
        avatar: { enabled: true },
    }, {}, { signal, telemetry: run.telemetry }));

    const settled = await settlesWithin(pending);

    assert.equal(settled.status, 'rejected');
    assert.equal(settled.error.code, 'GENERATION_TIMEOUT');
    assert.equal(avatarSignal.aborted, true);
    assert.equal(coordinator.get('run:1').state, 'failed');
    await coordinator.enqueue(plan('avatar-after-timeout'), async () => ({ imageData: 'AA==' }));
    assert.equal(coordinator.get('run:2').state, 'completed');
});

test('generation-wide deadline aborts a never-settling Gemini host proxy POST through its original signal', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    let postSignal;
    const dispatchedPlan = createGenerationPlan({
        ...plan('host-post-timeout'),
        resolved: {
            ...plan('host-post-timeout').resolved,
            connectionId: 'linkapi:default',
            endpoint: 'https://api.linkapi.ai',
            routeEvidence: { state: 'verified', source: 'built-in', observedAt: '2026-09-02T00:00:00.000Z', protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1' },
        },
        prompt: { sourceMessage: 'private prompt' },
        messages: [{ role: 'user', content: 'private prompt' }],
    });
    const pending = coordinator.enqueue(dispatchedPlan, (signal, run) => dispatchProviderRoute({
        plan: dispatchedPlan,
        connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal,
        transportContext: {
            apiKey: 'credential-not-for-telemetry',
            telemetry: run.telemetry,
            fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
                postSignal = init.signal;
                init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
            }),
        },
    }));

    const settled = await settlesWithin(pending);

    assert.equal(settled.status, 'rejected');
    assert.equal(settled.error.code, 'GENERATION_TIMEOUT');
    assert.equal(postSignal.aborted, true);
    assert.equal(coordinator.get('run:1').state, 'failed');
});

test('terminal telemetry is allowlisted, redacted, and does not retain a stuck run', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    const pending = coordinator.enqueue(plan('telemetry-timeout'), (_signal, run) => {
        run.telemetry.record('reference', 'started', {
            prompt: 'private prompt', credential: 'credential-not-for-telemetry', url: 'https://private.invalid/avatar.png', message: 'private message', asset: 'base64-data',
        });
        return new Promise(() => {});
    });

    const settled = await settlesWithin(pending);
    const record = coordinator.get('run:1');
    const serialized = JSON.stringify(record);

    assert.equal(settled.status, 'rejected');
    assert.equal(record.state, 'failed');
    assert.deepEqual(Object.keys(record.telemetry[0]).sort(), ['durationMs', 'runId', 'stage', 'status', 'timestamp']);
    assert.deepEqual(record.telemetry.map((event) => [event.stage, event.status]), [
        ['coordinate', 'started'],
        ['reference', 'started'],
        ['coordinate', 'timed_out'],
    ]);
    assert.doesNotMatch(serialized, /private prompt|credential-not-for-telemetry|private\.invalid|private message|base64-data/i);
});

test('the coordination boundary begins before reference collection and shares its signal with dispatch', async () => {
    const calls = [];
    const signal = new AbortController().signal;
    const kernel = createSceneGenerationKernel({
        capture: async (request) => (calls.push('capture'), { request, planInput: { ...plan('kernel-deadline'), prompt: { sourceMessage: request.prompt } } }),
        createCoordinationPlan: ({ snapshot }) => snapshot.planInput,
        collectReferences: async (_snapshot, _request, context) => (calls.push('references'), { signal: context.signal }),
        createPlan: ({ references }) => (calls.push('plan'), { id: 'final-plan', references }),
        coordinateEarly: async (_key, run, coordinationPlan) => {
            calls.push('coordinate');
            assert.equal(coordinationPlan.id, 'kernel-deadline');
            return run(signal, { runId: 'run:kernel', telemetry: { record: () => {} } });
        },
        coordinate: () => { throw new Error('legacy coordinate must not run'); },
        dispatch: async (_plan, receivedSignal) => (calls.push('dispatch'), { imageData: 'AA==', receivedSignal }),
        generationKey: () => 'kernel-deadline',
    });

    const result = await kernel.generate({ source: 'wand', destination: 'message', prompt: 'scene' });

    assert.deepEqual(calls, ['capture', 'coordinate', 'references', 'plan', 'dispatch']);
    assert.equal(result.artifact.receivedSignal, signal);
    assert.equal(result.plan.references.signal, signal);
});

test('diagnostic exports retain only allowlisted stage telemetry', async () => {
    const coordinator = createRunCoordinator();
    await coordinator.enqueue(plan('telemetry-export'), async (_signal, run) => {
        run.telemetry.record('reference', 'started', { prompt: 'private prompt', credential: 'secret' });
        run.telemetry.record('reference', 'completed', { asset: 'base64-data' });
        return { imageData: 'AA==' };
    });

    const exported = createDiagnosticsExport({ runs: coordinator.list() });

    assert.deepEqual(exported.runs[0].telemetry.map((event) => Object.keys(event).sort()), [
        ['durationMs', 'runId', 'stage', 'status', 'timestamp'],
        ['durationMs', 'runId', 'stage', 'status', 'timestamp'],
        ['durationMs', 'runId', 'stage', 'status', 'timestamp'],
        ['durationMs', 'runId', 'stage', 'status', 'timestamp'],
    ]);
    assert.doesNotMatch(JSON.stringify(exported), /private prompt|secret|base64-data/i);
});

test('deadline settles the caller while an uncooperative operation still owns its target and slot', async () => {
    const coordinator = createRunCoordinator({ maxConcurrent: 1, generationDeadlineMs: 10 });
    let release;
    let secondCalls = 0;
    const first = coordinator.enqueue(plan('occupancy:first', 'chat:occupied'), async (signal) => {
        await new Promise((resolve) => {
            release = resolve;
            signal.addEventListener('abort', () => {}, { once: true });
        });
        return { imageData: 'late' };
    });
    const settled = await settlesWithin(first);
    const second = coordinator.enqueue(plan('occupancy:second', 'chat:occupied'), async () => {
        secondCalls += 1;
        return { imageData: 'second' };
    });

    assert.equal(settled.error.code, 'GENERATION_TIMEOUT');
    assert.equal(coordinator.get('run:1').state, 'failed');
    assert.equal(coordinator.get('run:2').state, 'queued');
    assert.equal(secondCalls, 0);

    release();
    assert.deepEqual(await second, { imageData: 'second' });
    assert.equal(secondCalls, 1);
});

test('pre-commit deadline aborts dispatch and does not start delivery', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    let dispatchSignal;
    let deliveryCalls = 0;
    const kernel = createSceneGenerationKernel({
        capture: async (request) => ({ request, planInput: plan('pre-commit-timeout') }),
        createCoordinationPlan: ({ snapshot }) => snapshot.planInput,
        collectReferences: async () => ({ references: [] }),
        createPlan: () => ({ id: 'delivery-final' }),
        coordinateEarly: (_key, run, coordinationPlan, options) => coordinator.enqueue(coordinationPlan, run, options),
        coordinate: () => { throw new Error('legacy coordinate must not run'); },
        dispatch: async (_plan, signal) => new Promise((_resolve, reject) => {
            dispatchSignal = signal;
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
        generationKey: () => 'pre-commit-timeout',
        getDeadlineMs: () => 10,
    });

    const settled = await settlesWithin(kernel.generate(
        { source: 'wand', destination: 'message', prompt: 'scene' },
        { deliver: async () => { deliveryCalls += 1; } },
    ));

    assert.equal(settled.status, 'rejected');
    assert.equal(settled.error.code, 'GENERATION_TIMEOUT');
    assert.equal(dispatchSignal.aborted, true);
    assert.equal(deliveryCalls, 0);
    assert.equal(coordinator.get('run:1').state, 'failed');
});

test('commit boundary disarms timeout and ignores cancellation until persistence completes', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    let runId;
    let releaseSave;
    let saveStarted;
    const kernel = createSceneGenerationKernel({
        capture: async (request) => ({ request, planInput: plan('commit-success') }),
        createCoordinationPlan: ({ snapshot }) => snapshot.planInput,
        collectReferences: async () => ({ references: [] }),
        createPlan: () => ({ id: 'commit-success-final' }),
        coordinateEarly: (_key, run, coordinationPlan, options) => {
            const pending = coordinator.enqueue(coordinationPlan, run, options);
            runId = pending.runId;
            return pending;
        },
        coordinate: () => { throw new Error('legacy coordinate must not run'); },
        dispatch: async () => ({ imageData: 'AA==', mimeType: 'image/png' }),
        generationKey: () => 'commit-success',
        getDeadlineMs: () => 10,
    });
    const delivery = createMessageDeliveryAdapter({
        saveImage: async () => 'gallery/cig.png',
        getCurrentTarget: () => ({ safe: true, message: { extra: {} } }),
        appendMedia: async () => ({ id: 'attachment' }),
        saveChat: async () => {
            saveStarted();
            return new Promise((resolve) => { releaseSave = resolve; });
        },
        addToGallery: async () => {},
        notify: () => {},
    });

    const pending = kernel.generate(
        { source: 'wand', destination: 'message', prompt: 'scene', target: { chatId: 'chat-a', messageId: 1, messageFingerprint: 'v1-a' } },
        { deliver: (value) => delivery.deliver(value) },
    );
    await new Promise((resolve) => { saveStarted = resolve; });
    await wait(20);

    assert.equal(coordinator.cancel(runId), false);
    assert.equal(coordinator.get(runId).state, 'running');
    releaseSave({ saved: true });

    const result = await pending;
    assert.equal(result.deliveryResult, true);
    assert.equal(coordinator.get(runId).state, 'completed');
    assert.deepEqual(result.telemetry.list().filter((event) => event.stage === 'chat-save' || event.stage === 'gallery-save' || event.stage === 'coordinate').map((event) => [event.stage, event.status]), [
        ['coordinate', 'started'],
        ['chat-save', 'started'],
        ['chat-save', 'completed'],
        ['gallery-save', 'started'],
        ['gallery-save', 'completed'],
        ['coordinate', 'completed'],
    ]);
});

test('a committed delivery reports its actual persistence failure', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    const kernel = createSceneGenerationKernel({
        capture: async (request) => ({ request, planInput: plan('commit-failure') }),
        createCoordinationPlan: ({ snapshot }) => snapshot.planInput,
        collectReferences: async () => ({ references: [] }),
        createPlan: () => ({ id: 'commit-failure-final' }),
        coordinateEarly: (_key, run, coordinationPlan, options) => coordinator.enqueue(coordinationPlan, run, options),
        coordinate: () => { throw new Error('legacy coordinate must not run'); },
        dispatch: async () => ({ imageData: 'AA==', mimeType: 'image/png' }),
        generationKey: () => 'commit-failure',
        getDeadlineMs: () => 10,
    });

    await assert.rejects(
        kernel.generate(
            { source: 'wand', destination: 'message', prompt: 'scene' },
            { deliver: async () => { await wait(20); throw new Error('Chat persistence failed.'); } },
        ),
        /Chat persistence failed\./,
    );
    assert.equal(coordinator.get('run:1').state, 'failed');
    assert.equal(coordinator.get('run:1').terminal.error.code, 'PROVIDER_ERROR');
});

test('host proxy decoding emits one decode lifecycle for one returned image', async () => {
    const events = [];
    const dispatchedPlan = createGenerationPlan({
        ...plan('decode-once'),
        resolved: {
            ...plan('decode-once').resolved,
            connectionId: 'linkapi:default', endpoint: 'https://api.linkapi.ai',
            routeEvidence: { state: 'verified', source: 'built-in', observedAt: '2026-09-02T00:00:00.000Z', protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1' },
        },
        prompt: { sourceMessage: 'private prompt' }, messages: [{ role: 'user', content: 'private prompt' }],
    });
    await dispatchProviderRoute({
        plan: dispatchedPlan,
        connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'fixture-secret', telemetry: { record: (stage, status) => events.push([stage, status]) },
            fetchImpl: async () => new Response(JSON.stringify({ responseContent: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' } }] } }), { status: 200 }),
        },
    });
    assert.deepEqual(events.filter(([stage]) => stage === 'decode'), [['decode', 'started'], ['decode', 'completed']]);
});

test('disabled avatar references produce no avatar telemetry or materialization attempt', async () => {
    const events = [];
    let materializations = 0;
    const contributors = createCapturedReferenceContributors({
        materializeAvatarAssets: async () => { materializations += 1; return {}; },
    });
    await createReferenceContributorPipeline(contributors).collect({
        referencesEnabled: true,
        avatar: { enabled: false },
    }, {}, { telemetry: { record: (stage, status) => events.push([stage, status]) } });

    assert.equal(materializations, 0);
    assert.deepEqual(events.filter(([stage]) => stage === 'avatar'), []);
});

test('a committed saveChat completion persists Gallery without rollback after cancellation', async () => {
    const controller = new AbortController();
    const calls = [];
    let releaseSave;
    let saveStarted;
    const pending = attachGeneratedImageSafely({
        target: { chatId: 'chat-a', messageId: 1, messageFingerprint: 'v1-a' },
        prompt: 'scene', sender: 'Mira', signal: controller.signal,
        beginCommit: () => calls.push('begin-commit'),
        generate: async () => ({ imageData: 'AA==', mimeType: 'image/png' }),
        saveImage: async () => (calls.push('save-image'), 'gallery/cig.png'),
        getCurrentTarget: () => ({ safe: true, message: { extra: {} } }),
        appendMedia: async () => (calls.push('attach'), { id: 'attachment' }),
        rollbackMedia: async () => calls.push('rollback'),
        saveChat: async () => {
            calls.push('save-chat');
            saveStarted();
            return new Promise((resolve) => { releaseSave = resolve; });
        },
        addToGallery: async () => calls.push('gallery'),
        notify: () => calls.push('notify'),
    });
    await new Promise((resolve) => { saveStarted = resolve; });
    controller.abort();
    releaseSave({ saved: true });

    assert.equal(await pending, true);
    assert.deepEqual(calls, ['begin-commit', 'save-image', 'attach', 'save-chat', 'gallery']);
});

test('a public injected sillytavern adapter cannot bypass shared artifact validation', async () => {
    const fixturePlan = createGenerationPlan({
        id: 'injected-invalid', invocation: 'wand',
        resolved: {
            connectionId: 'fixture:default', providerId: 'fixture', modelId: 'fixture-image', transportId: 'fixture-transport',
            endpoint: 'https://fixture.invalid',
            routeEvidence: { state: 'verified', source: 'official-docs', observedAt: '2026-09-02T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
        },
        prompt: { sourceMessage: 'scene' },
    });
    await assert.rejects(dispatchProviderRoute({
        plan: fixturePlan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { get: () => ({ executionClass: 'sillytavern', generate: async () => ({ imageData: 'not-a-valid-image', mimeType: 'image/png' }) }) } },
}), /base64|magic|image/i);
});

test('a mutated replay of an earlier decoded artifact is validated again', async () => {
    const hostPlan = createGenerationPlan({
        ...plan('decoded-artifact-source'),
        resolved: {
            ...plan('decoded-artifact-source').resolved,
            connectionId: 'linkapi:default', endpoint: 'https://api.linkapi.ai',
            routeEvidence: { state: 'verified', source: 'built-in', observedAt: '2026-09-02T00:00:00.000Z', protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1' },
        },
        prompt: { sourceMessage: 'scene' }, messages: [{ role: 'user', content: 'scene' }],
    });
    const replay = await dispatchProviderRoute({
        plan: hostPlan,
        connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: {
            fetchImpl: async () => new Response(JSON.stringify({ responseContent: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' } }] } }), { status: 200 }),
        },
    });
    replay.imageData = 'not-a-valid-image';
    const fixturePlan = createGenerationPlan({
        id: 'replayed-invalid', invocation: 'wand',
        resolved: {
            connectionId: 'fixture:default', providerId: 'fixture', modelId: 'fixture-image', transportId: 'fixture-transport', endpoint: 'https://fixture.invalid',
            routeEvidence: { state: 'verified', source: 'official-docs', observedAt: '2026-09-02T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
        },
        prompt: { sourceMessage: 'scene' },
    });

    await assert.rejects(dispatchProviderRoute({
        plan: fixturePlan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { get: () => ({ generate: async () => replay }) } },
    }), /base64|magic|image/i);
});

test('message delivery records committed chat-save failure and final Gallery persistence separately', async () => {
    const failedEvents = [];
    const failed = createMessageDeliveryAdapter({
        saveImage: async () => 'gallery/cig.png',
        getCurrentTarget: () => ({ safe: true, message: { extra: {} } }),
        appendMedia: async () => ({ id: 'attachment' }),
        rollbackMedia: async () => {},
        saveChat: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
        addToGallery: async () => { throw new Error('Gallery must not be reached'); },
        notify: () => {},
    }).deliver({
        artifact: { imageData: 'AA==', mimeType: 'image/png' },
        request: { prompt: 'scene', sender: 'Mira', focusText: null, target: { chatId: 'chat-a', messageId: 1, messageFingerprint: 'v1-a' } },
        telemetry: { record: (stage, status) => failedEvents.push([stage, status]) },
        signal: new AbortController().signal,
    });
    await assert.rejects(failed, (error) => error?.name === 'AbortError');
    assert.deepEqual(failedEvents.filter(([stage]) => stage === 'chat-save'), [['chat-save', 'started'], ['chat-save', 'failed']]);
    assert.deepEqual(failedEvents.filter(([stage]) => stage === 'gallery-save'), []);

    const completeEvents = [];
    await createMessageDeliveryAdapter({
        saveImage: async () => 'gallery/cig.png',
        getCurrentTarget: () => ({ safe: true, message: { extra: {} } }),
        appendMedia: async () => ({ id: 'attachment' }),
        saveChat: async () => ({ saved: true }),
        addToGallery: async () => {},
        notify: () => {},
    }).deliver({
        artifact: { imageData: 'AA==', mimeType: 'image/png' },
        request: { prompt: 'scene', sender: 'Mira', focusText: null, target: { chatId: 'chat-a', messageId: 1, messageFingerprint: 'v1-a' } },
        telemetry: { record: (stage, status) => completeEvents.push([stage, status]) },
        signal: new AbortController().signal,
    });
    assert.deepEqual(completeEvents.filter(([stage]) => stage === 'gallery-save'), [['gallery-save', 'started'], ['gallery-save', 'completed']]);
});

test('reference and provider dependencies cannot obtain the private commit capability', async () => {
    const coordinator = createRunCoordinator({ generationDeadlineMs: 10 });
    let referenceContext;
    let dispatchContext;
    let deliveryCalls = 0;
    const kernel = createSceneGenerationKernel({
        capture: async (request) => ({ request, planInput: plan('private-commit-capability') }),
        createCoordinationPlan: ({ snapshot }) => snapshot.planInput,
        collectReferences: async (_snapshot, _request, context) => {
            referenceContext = context;
            return { references: [] };
        },
        createPlan: () => ({ id: 'private-commit-capability-final' }),
        coordinateEarly: (_key, run, coordinationPlan, options) => coordinator.enqueue(coordinationPlan, run, options),
        coordinate: () => { throw new Error('legacy coordinate must not run'); },
        dispatch: async (_plan, _signal, context) => {
            dispatchContext = context;
            context.beginCommit?.();
            await wait(30);
            return { imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', mimeType: 'image/png' };
        },
        generationKey: () => 'private-commit-capability',
        getDeadlineMs: () => 10,
    });

    const settled = await settlesWithin(kernel.generate(
        { source: 'wand', destination: 'message', prompt: 'scene' },
        { deliver: async () => { deliveryCalls += 1; } },
    ));

    assert.equal(settled.status, 'rejected');
    assert.equal(settled.error.code, 'GENERATION_TIMEOUT');
    assert.equal(Object.hasOwn(referenceContext, 'beginCommit'), false);
    assert.equal(Object.hasOwn(dispatchContext, 'beginCommit'), false);
    assert.deepEqual(Object.keys(referenceContext).sort(), ['runId', 'signal', 'telemetry']);
    assert.deepEqual(Object.keys(dispatchContext).sort(), ['runId', 'signal', 'telemetry']);
    assert.equal(deliveryCalls, 0);
    await wait(30);
});

test('shared decode boundary rejects empty adapter results without reporting decode completion', async () => {
    const cases = [
        ['null', null],
        ['fieldless object', {}],
        ['empty image field', { imageData: '', mimeType: 'image/png' }],
        ['malformed image field', { imageData: 'not-an-image', mimeType: 'image/png' }],
    ];
    for (const [name, adapterResult] of cases) {
        const events = [];
        await assert.rejects(dispatchProviderRoute({
            plan: injectedPlan(`invalid-adapter-result:${name}`),
            connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
            signal: new AbortController().signal,
            transportContext: {
                telemetry: { record: (stage, status) => events.push([stage, status]) },
                transports: { get: () => ({ generate: async () => adapterResult }) },
            },
        }), /image|artifact|result|base64|magic/i, name);
        assert.deepEqual(events.filter(([stage]) => stage === 'decode'), [['decode', 'started'], ['decode', 'failed']], name);
    }
});

test('built-in and injected adapters cross one raw-result boundary before shared decoding', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const signal = new AbortController().signal;
    const hostRaw = await DEFAULT_TRANSPORTS['host-chat-image'].generate({
        plan: { resolved: { providerId: 'fixture', modelId: 'fixture-image' }, messages: [], options: {} },
        connection: { id: 'fixture:default', providerId: 'fixture' },
        signal,
        transportContext: { requestSillyTavernImage: async () => ({ imageData: png, mimeType: 'image/png' }) },
    });
    const openAiRaw = await DEFAULT_TRANSPORTS['openai-images'].generate({
        plan: { resolved: { providerId: 'fixture', modelId: 'fixture-image', endpoint: 'https://fixture.invalid/v1', capabilities: {} }, messages: [], options: {} },
        connection: { id: 'fixture:default', providerId: 'fixture' },
        signal,
        transportContext: { requestOpenAiImages: async () => ({ b64_json: png, mimeType: 'image/png' }) },
    });
    const zaiModel = getModelDefinition('zai', 'cogview-4-250304');
    const zaiPlan = createGenerationPlan({
        id: 'raw-boundary:zai',
        invocation: 'settings',
        resolved: {
            connectionId: 'zai:default', providerId: 'zai', modelId: zaiModel.id,
            transportId: 'zai-native', endpoint: 'https://api.z.ai/api/paas/v4/images/generations',
            modelDefinition: zaiModel,
        },
        prompt: { sourceMessage: 'scene' },
        policy: { preflightAccepted: true },
    });
    const nativeRaw = await DEFAULT_TRANSPORTS['zai-native'].generate({
        plan: zaiPlan,
        connection: { id: 'zai:default', providerId: 'zai' },
        signal,
        transportContext: {
            apiKey: 'fixture-key',
            fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 }),
        },
    });

    assert.deepEqual(hostRaw, { b64_json: png, mimeType: 'image/png' });
    assert.deepEqual(openAiRaw, { b64_json: png, mimeType: 'image/png' });
    assert.deepEqual(nativeRaw, { b64_json: png, mimeType: 'image/png' });

    const events = [];
    const decoded = await dispatchProviderRoute({
        plan: injectedPlan('injected-raw-boundary'),
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal,
        transportContext: {
            telemetry: { record: (stage, status) => events.push([stage, status]) },
            transports: { get: () => ({ generate: async () => ({ b64_json: png, mimeType: 'image/png' }) }) },
        },
    });
    assert.equal(decoded.imageData, png);
    assert.equal(decoded.mimeType, 'image/png');
    assert.equal(Number.isFinite(decoded.bytes), true);
    assert.deepEqual(events.filter(([stage]) => stage === 'decode'), [['decode', 'started'], ['decode', 'completed']]);
});

test('post-commit AbortError is serialized as a failed operation rather than a cancellation', async () => {
    const coordinator = createRunCoordinator();
    const pending = coordinator.enqueue(plan('post-commit-abort'), async (_signal, { beginCommit }) => {
        beginCommit();
        throw Object.assign(new Error('Persistence aborted after commit began.'), {
            name: 'AbortError', category: 'cancelled', code: 'ABORTED',
        });
    });

    await assert.rejects(pending, (error) => error.name === 'AbortError');
    const record = coordinator.get('run:1');
    assert.equal(record.state, 'failed');
    assert.equal(record.terminal.error.category, 'unknown');
    assert.equal(record.terminal.error.code, 'PROVIDER_ERROR');
});

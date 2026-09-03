import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunCoordinator } from '../lib/generation-coordinator.js';
import { cancelCancellableRuns, listCancellableRunIds } from '../lib/generation-controls.js';

const plan = (id, target = 'chat:1') => ({
    schema: 2, id, idempotencyKey: id, target: { chatId: target },
});

test('RunCoordinator queues above two runs and emits lifecycle transitions', async () => {
    const coordinator = createRunCoordinator({ maxConcurrent: 2 });
    const releases = [];
    const events = [];
    coordinator.subscribe((event) => events.push(`${event.runId}:${event.to}`));
    const jobs = ['a', 'b', 'c'].map((id) => coordinator.enqueue(plan(id, `chat:${id}`), (signal) => new Promise((resolve) => releases.push({ id, signal, resolve }))));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(coordinator.get('run:3').state, 'queued');
    releases[0].resolve({ imageData: 'a', mimeType: 'image/png' });
    releases[1].resolve({ imageData: 'b', mimeType: 'image/png' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(coordinator.get('run:3').state, 'running');
    releases[2].resolve({ imageData: 'c', mimeType: 'image/png' });
    await Promise.all(jobs);
    assert.ok(events.some((event) => event.endsWith(':queued')));
    assert.ok(events.filter((event) => event.endsWith(':completed')).length === 3);
});

test('RunCoordinator suppresses duplicate paid work and cancels queued work', async () => {
    const coordinator = createRunCoordinator({ maxConcurrent: 1 });
    let calls = 0;
    const first = coordinator.enqueue(plan('same', 'chat:first'), async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { imageData: 'ok', mimeType: 'image/png' };
    });
    const duplicate = coordinator.enqueue(plan('same', 'chat:first'), async () => { calls += 1; return {}; });
    assert.strictEqual(first, duplicate);
    const queued = coordinator.enqueue(plan('queued', 'chat:second'), async () => { calls += 1; return {}; });
    assert.equal(coordinator.cancel('run:2'), true);
    await assert.rejects(queued, (error) => error.name === 'AbortError');
    await first;
    assert.equal(calls, 1);
    assert.equal(coordinator.get('run:2').state, 'cancelled');
});

test('RunCoordinator starts a fresh run for the same message after completion', async () => {
    const coordinator = createRunCoordinator({ maxConcurrent: 1 });
    let calls = 0;

    const first = await coordinator.enqueue(plan('same-message', 'chat:first'), async () => {
        calls += 1;
        return { imageData: 'first', mimeType: 'image/png' };
    });
    const second = await coordinator.enqueue(plan('same-message', 'chat:first'), async () => {
        calls += 1;
        return { imageData: 'second', mimeType: 'image/png' };
    });

    assert.equal(first.imageData, 'first');
    assert.equal(second.imageData, 'second');
    assert.equal(calls, 2);
    assert.equal(coordinator.get('run:2').state, 'completed');
});

test('cancellation control retains an older pre-commit run after a newer run completes', async () => {
    const coordinator = createRunCoordinator({ maxConcurrent: 2 });
    let releaseFirst;
    const first = coordinator.enqueue(plan('run-a', 'chat:a'), async () => new Promise((resolve) => { releaseFirst = resolve; }));
    const second = await coordinator.enqueue(plan('run-b', 'chat:b'), async () => ({ imageData: 'second', mimeType: 'image/png' }));

    assert.equal(second.imageData, 'second');
    assert.deepEqual(listCancellableRunIds(coordinator.list()), ['run:1']);
    assert.deepEqual(cancelCancellableRuns(coordinator), ['run:1']);
    await assert.rejects(first, (error) => error.name === 'AbortError');
    releaseFirst({ imageData: 'late', mimeType: 'image/png' });
});

test('commit transition notifies the cancellation control when no pre-commit runs remain', async () => {
    const coordinator = createRunCoordinator();
    const controlStates = [];
    let release;
    let resolveCommitted;
    const committed = new Promise((resolve) => { resolveCommitted = resolve; });
    coordinator.subscribe(() => controlStates.push(listCancellableRunIds(coordinator.list())));
    const pending = coordinator.enqueue(plan('committed-only'), async (_signal, { beginCommit }) => {
        beginCommit();
        resolveCommitted();
        return new Promise((resolve) => { release = resolve; });
    });

    await committed;

    assert.deepEqual(controlStates.at(-1), []);
    assert.equal(cancelCancellableRuns(coordinator).length, 0);
    release({ imageData: 'saved', mimeType: 'image/png' });
    await pending;
});

test('RunCoordinator terminal records contain normalized provider fields only', async () => {
    const coordinator = createRunCoordinator();
    const error = Object.assign(new Error('Bearer sk-secret raw upstream body'), {
        category: 'authentication', code: 'AUTH_FAILED', status: 401, providerId: 'fixture', modelId: 'image-1', requestId: 'req-1',
    });
    await assert.rejects(coordinator.enqueue(plan('terminal'), async () => { throw error; }));
    const record = coordinator.get('run:1');
    assert.deepEqual(record.terminal, { error: { category: 'authentication', code: 'AUTH_FAILED', status: 401, providerId: 'fixture', modelId: 'image-1', requestId: 'req-1' } });
    assert.doesNotMatch(JSON.stringify(record), /Bearer|sk-secret|raw upstream body/);
});

test('RunCoordinator marks gallery-only persistence as stale instead of completed', async () => {
    const coordinator = createRunCoordinator();
    const result = await coordinator.enqueue(plan('stale'), async () => ({ persistence: { attached: false, stale: true }, stale: true }));
    assert.equal(result.stale, true);
    assert.equal(coordinator.get('run:1').state, 'stale');
});

test('RunCoordinator does not retain completed artifacts in public terminal records', async () => {
    const coordinator = createRunCoordinator();
    await coordinator.enqueue(plan('artifact'), async () => ({ imageData: 'secret-payload', providerRequestId: 'req-1' }));
    const record = coordinator.get('run:1');
    assert.equal('result' in record, false);
    assert.doesNotMatch(JSON.stringify(record), /secret-payload/);
});

test('RunCoordinator public snapshots project plan metadata without prompt, refs, or secrets', async () => {
    const coordinator = createRunCoordinator();
    const sensitivePlan = {
        ...plan('projection'),
        resolved: { providerId: 'fixture', modelId: 'image-1', transportId: 'openai-images', endpoint: 'https://provider.example/v1' },
        prompt: { sourceMessage: 'private prompt', nearbyMessages: [{ content: 'private context' }] },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'private prompt' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,secret-bytes' } }] }],
        references: [{ id: 'ref-1', asset: { data: 'secret-bytes' } }],
        secretRef: 'provider_keys.fixture',
    };
    const pending = coordinator.enqueue(sensitivePlan, async () => new Promise(() => {}));
    const record = coordinator.get('run:1');
    assert.equal(record.plan.prompt, undefined);
    assert.equal(record.plan.messages, undefined);
    assert.equal(record.plan.references, undefined);
    assert.doesNotMatch(JSON.stringify(record), /private prompt|secret-bytes|provider_keys/);
    coordinator.cancel('run:1');
    await assert.rejects(pending, (error) => error.name === 'AbortError');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunCoordinator } from '../lib/generation-coordinator.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { createTransportRegistry, dispatchProviderRoute } from '../lib/providers/dispatch.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function plan(overrides = {}) {
    return createGenerationPlan({
        id: 'plan:dispatch',
        invocation: 'wand',
        resolved: {
            connectionId: 'fixture:default',
            providerId: 'fixture',
            modelId: 'fixture-image',
            transportId: 'fixture-transport',
            endpoint: 'https://fixture.example/v1',
            routeEvidence: {
                state: 'verified', source: 'official-docs', observedAt: '2026-08-31T00:00:00.000Z',
                protocol: 'openai-images', requestShapeRevision: 'openai-images-v1',
            },
            capabilities: {},
            ...overrides,
        },
        prompt: { sourceMessage: 'a red fox', focusText: null, nearbyMessages: [] },
    });
}

test('dispatch accepts only a resolved plan and registered transport and forwards its signal', async () => {
    const controller = new AbortController();
    let received;
    const transports = createTransportRegistry({
        'fixture-transport': {
            id: 'fixture-transport',
            executionClass: 'browser',
            generate: async (input) => { received = input; return { imageData: PNG, mimeType: 'image/png' }; },
        },
    });
    const result = await dispatchProviderRoute({
        plan: plan(),
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: controller.signal,
        transportContext: { transports },
    });
    assert.equal(result.imageData, PNG);
    assert.equal(received.signal, controller.signal);
    assert.equal(received.plan.resolved.endpoint, 'https://fixture.example/v1');
});

test('dispatch never rereads a changed endpoint from the connection', async () => {
    let received;
    const transports = createTransportRegistry({
        'fixture-transport': { id: 'fixture-transport', generate: async (input) => { received = input; return {}; } },
    });
    const connection = { id: 'fixture:default', providerId: 'fixture', baseUrl: 'https://mutable.example', enabled: true };
    await dispatchProviderRoute({ plan: plan(), connection, signal: new AbortController().signal, transportContext: { transports } });
    connection.baseUrl = 'https://changed.example';
    assert.equal(received.plan.resolved.endpoint, 'https://fixture.example/v1');
});

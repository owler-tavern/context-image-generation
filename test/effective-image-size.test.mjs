import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { DEFAULT_TRANSPORTS, dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { buildOpenAiImagesRequest } from '../lib/providers/openai-images.js';

const savedSettings = { image_size: '4K' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const supportedSizes = {
    imageGeneration: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
    sizes: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
    allowedSizes: ['1K', '4K'],
};
const unsupportedSizes = {
    imageGeneration: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
    sizes: { state: 'unsupported', source: 'curated-fixture', confidence: 'high' },
};
const VERIFIED_OPENAI_ROUTE = {
    state: 'verified', source: 'built-in', observedAt: '2026-08-31T00:00:00.000Z',
    protocol: 'openai-images', requestShapeRevision: 'openai-images-v1',
};
const VERIFIED_GEMINI_ROUTE = {
    state: 'verified', source: 'built-in', observedAt: '2026-08-31T00:00:00.000Z',
    protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1',
};

function planFor(capabilities, transportId = 'host-chat-image') {
    return createGenerationPlan({
        id: `effective-size:${transportId}:${capabilities.sizes.state}`,
        invocation: 'settings',
        resolved: {
            connectionId: 'fixture:default',
            providerId: 'fixture',
            modelId: 'fixture-image',
            transportId,
            endpoint: 'https://fixture.example/v1',
            modelDefinition: { id: 'fixture-image', providerId: 'fixture', transportId, capabilities },
        },
        prompt: { sourceMessage: 'A scene' },
        options: { aspectRatio: '16:9', imageSize: savedSettings.image_size },
    });
}

function indexStylePlan({ providerId, modelId, transport, transportId, endpoint, modelDefinition, aspectRatio = '16:9', imageSize = savedSettings.image_size }) {
    return createGenerationPlan({
        id: `effective-size:${providerId}:${modelId}:${aspectRatio}`,
        invocation: 'settings',
        resolved: {
            connectionId: `${providerId}:default`,
            providerId,
            modelId,
            transportId,
            endpoint,
            modelDefinition: { id: modelId, providerId, transport, ...modelDefinition },
        },
        prompt: { sourceMessage: 'A scene' },
        options: { aspectRatio, imageSize },
    });
}

test('generation plans preserve a saved size preference but only expose an allowed effective route option', () => {
    const unsupported = planFor(unsupportedSizes);
    assert.equal(savedSettings.image_size, '4K', 'the persisted preference is never changed');
    assert.equal(unsupported.options.imageSize, '', 'unsupported route has no effective size');

    const restored = planFor(supportedSizes);
    assert.equal(savedSettings.image_size, '4K');
    assert.equal(restored.options.imageSize, '4K', 'returning to a supported route restores the saved choice');
});

test('an explicit discrete size list never falls back to aspect-ratio mapping', () => {
    const unavailableDiscreteSize = planFor({
        imageGeneration: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
        sizes: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
        allowedSizes: [],
    }, 'openai-images');
    assert.equal(unavailableDiscreteSize.options.imageSize, '');
});

test('host and OpenAI transports omit an unsupported saved size from request payloads', async () => {
    const unsupportedHostPlan = planFor(unsupportedSizes);
    const hostRequests = [];
    await DEFAULT_TRANSPORTS['host-chat-image'].generate({
        plan: unsupportedHostPlan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'sillytavern-proxy', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestSillyTavernImage: async (request) => { hostRequests.push(request); return { imageData: PNG, mimeType: 'image/png' }; } },
    });
    assert.equal(JSON.parse(JSON.stringify(hostRequests[0])).request_image_resolution, undefined);

    const unsupportedOpenAiPlan = planFor(unsupportedSizes, 'openai-images');
    const openAiRequests = [];
    await DEFAULT_TRANSPORTS['openai-images'].generate({
        plan: unsupportedOpenAiPlan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: {
            mapAspectRatioToSize: () => '1536x1024',
            requestOpenAiImages: async (request) => { openAiRequests.push(request); return { imageData: PNG, mimeType: 'image/png' }; },
        },
    });
    assert.equal(openAiRequests[0].size, undefined, 'adapter must not infer a size from aspect ratio');
    assert.equal(buildOpenAiImagesRequest({
        model: 'fixture-image',
        prompt: 'A scene',
        size: openAiRequests[0].size,
        capabilities: unsupportedOpenAiPlan.resolved.capabilities,
    }).size, undefined);
});

test('schema-2 LinkAPI curated OpenAI Images plan derives its size from aspect ratio', async () => {
    const calls = [];
    for (const modelId of ['gpt-image-2-c']) {
        const plan = indexStylePlan({
            providerId: 'linkapi',
            modelId,
            transport: 'openAiImages',
            transportId: 'openai-images',
            endpoint: 'https://linkapi.ai/v1',
            modelDefinition: { supportsSize: true, routeEvidence: VERIFIED_OPENAI_ROUTE },
        });
        assert.equal(plan.options.imageSize, '1536x1024');
        await dispatchProviderRoute({
            plan,
            connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
            signal: new AbortController().signal,
            transportContext: { requestOpenAiImages: async (request) => { calls.push(request); return { imageData: PNG, mimeType: 'image/png' }; } },
        });
    }
    assert.deepEqual(calls.map((request) => request.size), ['1536x1024']);
});

test('schema-2 Gemini omission does not replace a saved discrete 4K preference', async () => {
    const unsupportedGemini = indexStylePlan({
        providerId: 'openrouter',
        modelId: 'google/gemini-2.5-flash-image-preview',
        transport: 'host-chat-image',
        transportId: 'host-chat-image',
        modelDefinition: { capabilities: unsupportedSizes, routeEvidence: VERIFIED_GEMINI_ROUTE },
    });
    const requests = [];
    await dispatchProviderRoute({
        plan: unsupportedGemini,
        connection: { id: 'openrouter:default', providerId: 'openrouter', kind: 'sillytavern-proxy', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestSillyTavernImage: async (request) => { requests.push(request); return { imageData: PNG, mimeType: 'image/png' }; } },
    });
    assert.equal(unsupportedGemini.options.imageSize, '');
    assert.equal(requests[0].request_image_resolution, undefined);
    assert.equal(savedSettings.image_size, '4K');
    assert.equal(planFor(supportedSizes).options.imageSize, '4K');
});

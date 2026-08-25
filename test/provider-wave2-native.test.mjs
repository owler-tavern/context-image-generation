import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, FUTURE_SERVER_PROVIDERS, getModelDefinition } from '../lib/providers/registry.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { dispatchProviderRoute, transportRegistry } from '../lib/providers/dispatch.js';
import {
    buildZaiImageRequest,
    buildArliAiImageRequest,
    parseNativeImageResponse,
} from '../lib/providers/native-hosted.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function nativePlan(providerId, modelId, options = {}) {
    const provider = PROVIDERS[providerId];
    const model = getModelDefinition(providerId, modelId);
    const transportId = model.transport;
    return createGenerationPlan({
        id: `native:${providerId}`,
        invocation: 'settings',
        resolved: {
            connectionId: `${providerId}:default`,
            providerId,
            modelId,
            transportId,
            endpoint: provider.transports[transportId].baseUrl,
            modelDefinition: model,
        },
        prompt: { sourceMessage: 'a red fox in snow' },
        options,
        policy: { preflightAccepted: true },
    });
}

function connection(providerId) {
    return { id: `${providerId}:default`, providerId, kind: 'browser-api-key', enabled: true };
}

test('registers native providers with curated built-in models and registry credentials', () => {
    const expected = {
        zai: ['zai-native', 'https://api.z.ai/api/paas/v4/images/generations'],
        arliai: ['arliai-native', 'https://api.arliai.com/v1/txt2img'],
    };
    for (const [providerId, [transportId, endpoint]] of Object.entries(expected)) {
        const provider = PROVIDERS[providerId];
        assert.ok(provider, providerId);
        assert.equal(provider.status, 'experimental', providerId);
        assert.equal(provider.posture, 'experimental', providerId);
        assert.equal(provider.credentialKey, providerId, providerId);
        assert.equal(provider.ui.requiresApiKey, true, providerId);
        assert.equal(provider.transports[transportId].baseUrl, endpoint, providerId);
        assert.ok(provider.models.length > 0, providerId);
        assert.ok(provider.models.every((model) => model.transport === transportId), providerId);
        assert.ok(provider.models.every((model) => model.status === 'experimental'), providerId);
    }
});

test('native request builders preserve source-verified endpoint payload fields', () => {
    assert.deepEqual(buildZaiImageRequest({ model: 'cogview-4-250304', prompt: 'scene' }), {
        model: 'cogview-4-250304', prompt: 'scene', size: '1024x1024',
    });
    assert.deepEqual(buildArliAiImageRequest({ model: 'stable-diffusion-xl', prompt: 'scene' }), {
        sd_model_checkpoint: 'stable-diffusion-xl', prompt: 'scene', negative_prompt: '',
        width: 1024, height: 1024, steps: 20, cfg_scale: 7, sampler_name: 'DPM++ 2M Karras', seed: -1,
    });
});

test('native response parser handles the curated JSON image forms and rejects empty responses', () => {
    assert.deepEqual(parseNativeImageResponse('zai', { data: [{ b64_json: PNG }] }), { b64_json: PNG, mimeType: 'image/png' });
    assert.deepEqual(parseNativeImageResponse('zai', { data: [{ url: 'https://cdn.example/image.png' }] }), 'https://cdn.example/image.png');
    assert.deepEqual(parseNativeImageResponse('arliai', { images: [PNG] }), { b64_json: PNG, mimeType: 'image/png' });
    assert.throws(() => parseNativeImageResponse('zai', { data: [] }), /did not include an image/i);
    assert.throws(() => parseNativeImageResponse('arliai', {}), /did not include an image/i);
});

test('Z.AI sends the exact curated endpoint and bearer-authenticated body, then decodes base64', async () => {
    const calls = [];
    const plan = nativePlan('zai', 'cogview-4-250304');
    const result = await dispatchProviderRoute({
        plan,
        connection: connection('zai'),
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'zai-test-key',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200, headers: { 'content-type': 'application/json' } });
            },
        },
    });
    assert.equal(calls[0].url, 'https://api.z.ai/api/paas/v4/images/generations');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer zai-test-key');
    assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'cogview-4-250304', prompt: 'a red fox in snow', size: '1024x1024' });
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.imageData, PNG);
});

test('ArliAI sends source-verified SD-style JSON and decodes its images array', async () => {
    const calls = [];
    const plan = nativePlan('arliai', 'stable-diffusion-xl');
    const result = await dispatchProviderRoute({
        plan,
        connection: connection('arliai'),
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'arliai-test-key',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response(JSON.stringify({ images: [PNG], info: '{}' }), { status: 200 });
            },
        },
    });
    assert.equal(calls[0].url, 'https://api.arliai.com/v1/txt2img');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer arliai-test-key');
    assert.deepEqual(JSON.parse(calls[0].init.body), buildArliAiImageRequest({ model: 'stable-diffusion-xl', prompt: 'a red fox in snow' }));
    assert.equal(result.imageData, PNG);
});

test('native errors normalize without exposing credentials', async () => {
    const plan = nativePlan('zai', 'cogview-4-250304');
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: connection('zai'),
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'zai-secret-value',
            fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'invalid API key zai-secret-value' } }), { status: 401 }),
        },
    }), (error) => error.name === 'ProviderError'
        && error.category === 'authentication'
        && !error.message.includes('zai-secret-value'));
});

test('native adapters propagate AbortSignal and stop before a provider call', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await assert.rejects(dispatchProviderRoute({
        plan: nativePlan('zai', 'cogview-4-250304'),
        connection: connection('zai'),
        signal: controller.signal,
        transportContext: { apiKey: 'zai-test-key', fetchImpl: async () => { called = true; throw new Error('must not fetch'); } },
    }), (error) => error.name === 'AbortError');
    assert.equal(called, false);
});

test('native adapters abort an in-flight provider fetch through the same signal', async () => {
    const controller = new AbortController();
    let receivedSignal;
    const pending = dispatchProviderRoute({
        plan: nativePlan('zai', 'cogview-4-250304'),
        connection: connection('zai'),
        signal: controller.signal,
        transportContext: {
            apiKey: 'zai-test-key',
            fetchImpl: async (_url, init) => {
                receivedSignal = init.signal;
                await new Promise((resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), { once: true });
                });
                return resolve();
            },
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(receivedSignal, controller.signal);
});

test('native adapters snapshot the provider secret once for auth and redaction', async () => {
    const plan = nativePlan('zai', 'cogview-4-250304');
    let reads = 0;
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: connection('zai'),
        signal: new AbortController().signal,
        transportContext: {
            resolveSecret: () => (++reads === 1 ? 'old-key' : 'new-key'),
            fetchImpl: async (_url, init) => {
                assert.equal(init.headers.Authorization, 'Bearer old-key');
                return new Response(JSON.stringify({ error: { message: 'provider echoed old-key' } }), { status: 401 });
            },
        },
    }), (error) => error.category === 'authentication' && !error.message.includes('old-key'));
    assert.equal(reads, 1);
});

test('native error-body handling caps hostile provider responses before parsing', async () => {
    const hostileBody = JSON.stringify({ error: { message: 'x'.repeat(70 * 1024) } });
    await assert.rejects(dispatchProviderRoute({
        plan: nativePlan('zai', 'cogview-4-250304'),
        connection: connection('zai'),
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'zai-test-key',
            fetchImpl: async () => new Response(hostileBody, { status: 401, headers: { 'content-type': 'application/json' } }),
        },
    }), (error) => error.name === 'ProviderError' && error.category === 'authentication' && error.message.length < 600);
});

test('Chutes is entirely Future Server and has no native runtime route', () => {
    assert.equal(PROVIDERS.chutes.posture, 'future-server');
    assert.equal(PROVIDERS.chutes.status, 'future-server');
    assert.equal(PROVIDERS.chutes.available, false);
    assert.equal(PROVIDERS.chutes.transports, undefined);
    assert.equal(PROVIDERS.chutes.models?.length || 0, 0);
    assert.equal(transportRegistry.has('chutes-native'), false);
});

test('manual model records fail closed while binary and conflicting providers remain Future Server', async () => {
    for (const providerId of ['novelai', 'stability', 'naistera', 'chutes']) {
        assert.equal(PROVIDERS[providerId].posture, 'future-server', providerId);
        assert.equal(PROVIDERS[providerId].available, false, providerId);
    }
    const provider = PROVIDERS.zai;
    const model = { ...provider.models[0], source: 'manual' };
    const plan = nativePlan('zai', provider.models[0].id);
    const manualPlan = createGenerationPlan({
        ...plan,
        resolved: { ...plan.resolved, modelDefinition: model },
        policy: { preflightAccepted: true },
    });
    await assert.rejects(dispatchProviderRoute({
        plan: manualPlan,
        connection: connection('zai'),
        signal: new AbortController().signal,
        transportContext: { apiKey: 'zai-test-key', fetchImpl: async () => { throw new Error('must not fetch'); } },
    }), /curated built-in|unsupported|unavailable|model route/i);
    assert.ok(FUTURE_SERVER_PROVIDERS.some((item) => item.id === 'novelai'));
});

test('native adapters are registered without provider-name dispatch branches', () => {
    for (const adapterId of ['zai-native', 'arliai-native']) assert.equal(transportRegistry.has(adapterId), true, adapterId);
});

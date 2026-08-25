import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, resolveProviderRoute } from '../lib/providers/registry.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';

test('dispatches a declarative fixture OpenAI Images provider through its configured URL', async () => {
    PROVIDERS.fixture = {
        id: 'fixture',
        credentialKey: 'fixture',
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
        models: [{ id: 'fixture-image', transport: 'openAiImages', supportsReferenceImages: false, supportsSize: true, status: 'fixture' }],
    };

    const calls = [];
    try {
        await dispatchProviderRoute({
            route: resolveProviderRoute('fixture', 'fixture-image'),
            modelId: 'fixture-image',
            messages: [],
            prompt: 'fixture scene',
            apiKey: 'fixture-key',
            aspectRatio: '16:9',
            mapAspectRatioToSize: () => '1536x1024',
            requestOpenAiImages: async (request) => { calls.push(request); return { imageData: 'image', mimeType: 'image/png' }; },
            requestSillyTavernImage: async () => { throw new Error('unexpected Gemini dispatch'); },
        });
    } finally {
        delete PROVIDERS.fixture;
    }

    assert.deepEqual(calls, [{
        apiKey: 'fixture-key',
        model: 'fixture-image',
        prompt: 'fixture scene',
        size: '1536x1024',
        baseUrl: 'https://fixture.example/v1',
    }]);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    PROVIDERS,
    FUTURE_SERVER_PROVIDERS,
    getProviderDefinition,
    getModelDefinition,
    resolveTransport,
} from '../lib/providers/registry.js';
import { projectProviderOptions, projectProviderUi } from '../lib/providers/ui-projection.js';
import { parseNanoGptDetailedCatalog, parsePollinationsImageModels } from '../lib/providers/model-discovery.js';

test('registers Wave 1 providers on the validated OpenAI Images transport', () => {
    const expected = {
        openai: 'https://api.openai.com/v1',
        pollinations: 'https://gen.pollinations.ai/v1',
        nanogpt: 'https://nano-gpt.com/v1',
        together: 'https://api.together.xyz/v1',
        routeway: 'https://api.routeway.ai/v1',
        navy: 'https://api.navy/v1',
    };

    for (const [providerId, baseUrl] of Object.entries(expected)) {
        const provider = getProviderDefinition(providerId);
        assert.ok(provider, providerId);
        assert.equal(provider.credentialKey, providerId);
        assert.equal(provider.transports.openAiImages.baseUrl, baseUrl, providerId);
        assert.equal(provider.models.length > 0, true, providerId);
        assert.equal(resolveTransport(providerId, provider.models[0].id), 'openAiImages', providerId);
        assert.equal(provider.status, 'experimental', providerId);
    }
});

test('Wave 1 models keep optional capabilities conservative until live evidence exists', () => {
    for (const providerId of ['openai', 'pollinations', 'nanogpt', 'together', 'routeway', 'navy']) {
        const provider = getProviderDefinition(providerId);
        for (const model of provider.models) {
            const projected = projectProviderUi(providerId, model.id);
            assert.equal(projected.supportsReferenceImages, false, `${providerId}/${model.id}`);
            assert.equal(projected.imageSizeOptions.length, 0, `${providerId}/${model.id}`);
            assert.equal(model.status, 'experimental', `${providerId}/${model.id}`);
        }
    }
});

test('Pollinations uses paid JSON generation and image-model discovery, never query-key URLs', () => {
    const provider = getProviderDefinition('pollinations');
    assert.equal(provider.discovery.kind, 'native');
    assert.equal(provider.discovery.endpoint, '/image/models');
    assert.equal(provider.discovery.transportId, 'pollinationsCatalog');
    assert.equal(provider.discovery.parserId, 'pollinations-image-models');
    assert.equal(provider.transports.openAiImages.baseUrl.endsWith('/v1'), true);
    assert.doesNotMatch(JSON.stringify(provider), /[?&](?:key|token)=/i);
});

test('NanoGPT uses the verified v1 Images route and exposes a detailed catalog parser seam', () => {
    const provider = getProviderDefinition('nanogpt');
    assert.equal(provider.discovery.kind, 'native');
    assert.equal(provider.discovery.endpoint, '/v1/image-models?detailed=true');
    assert.equal(provider.discovery.transportId, 'nanogptCatalog');
    assert.equal(provider.discovery.parserId, 'nanogpt-image-models');

    const entries = parseNanoGptDetailedCatalog({ data: [
        { id: 'flux-pro', name: 'Flux Pro', input_modalities: ['text', 'image'], output_modalities: ['image'], max_images: 2 },
        { model: 'text-only', display_name: 'Text only', output_modalities: ['text'] },
        { id: 'flux-pro' },
    ] });
    assert.deepEqual(entries, [
        {
            id: 'flux-pro',
            label: 'Flux Pro',
            transport: 'openAiImages',
            capabilities: {
                imageGeneration: { state: 'supported', source: 'official-docs', confidence: 'high' },
            },
        },
        {
            id: 'text-only',
            label: 'Text only',
            transport: 'openAiImages',
            capabilities: {},
        },
    ]);
});

test('native catalog parsers return IDs without treating exact IDs as generation proof', () => {
    assert.deepEqual(parsePollinationsImageModels([
        { name: 'flux', description: 'image model' },
        { id: 'turbo' },
        { id: 'turbo' },
    ]), [
        { id: 'flux', label: 'flux', transport: 'openAiImages', capabilities: {} },
        { id: 'turbo', label: 'turbo', transport: 'openAiImages', capabilities: {} },
    ]);
});

test('Z.AI stays future-server because its quality/size payload is not OpenAI Images compatible', () => {
    const provider = getProviderDefinition('zai');
    assert.equal(provider.posture, 'future-server');
    assert.equal(provider.status, 'future-server');
    assert.equal(provider.transports?.openAiImages, undefined);
    assert.equal(provider.unavailableReason, 'Z.AI uses a native quality/size payload; server adapter required.');
    assert.equal(projectProviderUi('zai').models.length, 0);
});

test('future-server inventory records are visible but cannot resolve a browser transport', () => {
    for (const provider of FUTURE_SERVER_PROVIDERS) {
        assert.equal(provider.posture, 'future-server', provider.id);
        assert.equal(provider.connectionKinds.includes('server-adapter'), true, provider.id);
        assert.equal(provider.transports, undefined, provider.id);
        assert.equal(provider.models?.length || 0, 0, provider.id);
        assert.equal(resolveTransport(provider.id, 'any-model'), undefined, provider.id);
        const option = projectProviderOptions().find((candidate) => candidate.id === provider.id);
        assert.equal(option.available, false, provider.id);
        assert.match(option.unavailableReason, /server adapter/i, provider.id);
    }
});

test('provider dropdown disables future-server entries from registry metadata', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /provider\.available === false/);
    assert.match(source, /provider\.unavailableReason/);
});

test('provider key settings are registry-driven for Wave 1 entries', () => {
    for (const providerId of ['openai', 'pollinations', 'nanogpt', 'together', 'routeway', 'navy']) {
        assert.equal(getProviderDefinition(providerId).ui.requiresApiKey, true, providerId);
        assert.equal(getProviderDefinition(providerId).ui.apiKeyLabel, `${getProviderDefinition(providerId).label} API Key`, providerId);
    }
    assert.equal(Object.keys(PROVIDERS).includes('openai'), true);
});

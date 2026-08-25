import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROVIDERS, getModelDefinition, getProviderDefinition, resolveProviderRoute, resolveTransport } from '../lib/providers/registry.js';
import { projectProviderUi } from '../lib/providers/ui-projection.js';

test('routes LinkAPI Gemini and OpenAI image models by model contract', () => {
    assert.equal(resolveTransport('linkapi', 'gemini-2.5-flash-image'), 'sillyTavernGeminiProxy');
    assert.equal(resolveTransport('linkapi', 'gpt-image-2-c'), 'openAiImages');
});

test('routes every LinkAPI model exposed by the built-in UI', () => {
    const expectedTransports = {
        'gemini-2.5-flash-image': 'sillyTavernGeminiProxy',
        'gemini-3.1-flash-image-preview': 'sillyTavernGeminiProxy',
        'gemini-3-pro-image-preview': 'sillyTavernGeminiProxy',
        'gpt-image-2-c': 'openAiImages',
    };

    for (const [model, transport] of Object.entries(expectedTransports)) {
        assert.equal(resolveTransport('linkapi', model), transport, model);
    }
});
test('routes both built-in TokenReply image models through OpenAI Images', () => {
    for (const modelId of ['grok-imagine-image', 'grok-imagine-image-quality']) {
        assert.equal(resolveTransport('tokenreply', modelId), 'openAiImages');
    }
});

test('TokenReply Grok starts with a minimal experimental Images payload', () => {
    const provider = getProviderDefinition('tokenreply');
    assert.equal(provider.transports.openAiImages.baseUrl, 'https://api.tokenreply.com/v1');
    assert.equal(getModelDefinition('tokenreply', 'grok-imagine-image').supportsReferenceImages, false);
    assert.equal(getModelDefinition('tokenreply', 'grok-imagine-image').supportsSize, undefined);
    assert.equal(getModelDefinition('tokenreply', 'grok-imagine-image').status, 'experimental');
});
test('declares TokenReply as an experimental discovery profile', () => {
    const provider = getProviderDefinition('tokenreply');
    const ui = projectProviderUi('tokenreply', 'grok-imagine-image');
    assert.equal(provider.label, 'TokenReply (Experimental)');
    assert.equal(provider.transports.openAiImages.baseUrl, 'https://api.tokenreply.com/v1');
    assert.equal(ui.supportsModelDiscovery, true);
    assert.equal(ui.modelDiscoveryExperimental, true);
    assert.equal(ui.requiresApiKey, true);
    assert.match(ui.providerInfo, /images\/generations/);
});

test('projects reference and size controls from model capabilities', () => {
    const tokenReply = projectProviderUi('tokenreply', 'grok-imagine-image');
    const linkApiImage = projectProviderUi('linkapi', 'gpt-image-2-c');
    const flash2 = projectProviderUi('linkapi', 'gemini-3.1-flash-image-preview');
    assert.equal(tokenReply.supportsReferenceImages, false);
    assert.equal(tokenReply.imageSizeOptions.length, 0);
    assert.equal(linkApiImage.supportsReferenceImages, false);
    assert.equal(flash2.imageSizeOptions.length > 0, true);
    assert.equal(flash2.supportsThinking, true);
});
test('resolves a declarative OpenAI Images fixture without a provider-name branch', async () => {
    PROVIDERS.fixture = {
        id: 'fixture',
        credentialKey: 'fixture',
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
        models: [{ id: 'fixture-image', transport: 'openAiImages', supportsReferenceImages: false, status: 'fixture' }],
    };

    try {
        const route = resolveProviderRoute('fixture', 'fixture-image');
        assert.equal(route.transport, 'openAiImages');
        assert.equal(route.provider.transports.openAiImages.baseUrl, 'https://fixture.example/v1');
        assert.equal(route.model.id, 'fixture-image');
    } finally {
        delete PROVIDERS.fixture;
    }

    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = index.indexOf('async function generateImageFromPrompt');
    const end = index.indexOf('// Resolve the <img> src', start);
    const generation = index.slice(start, end);
    assert.match(generation, /let providerRoute = resolveProviderRoute\(selectedProvider, settings\.model\);/);
    assert.doesNotMatch(generation, /selectedProvider === 'tokenreply'/);
});

test('gives dynamic LinkAPI gpt-image and dall-e models explicit image capabilities', () => {
    for (const modelId of ['gpt-image-1', 'dall-e-3']) {
        const model = getModelDefinition('linkapi', modelId);
        assert.equal(model.transport, 'openAiImages', modelId);
        assert.equal(model.supportsSize, true, modelId);
        assert.equal(model.supportsReferenceImages, false, modelId);
    }
});

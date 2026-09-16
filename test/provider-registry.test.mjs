import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROVIDERS, getModelDefinition, getNormalizedProviderDefinition, getProviderDefinition, getReferenceImageCapability, resolveAdapterId, resolveProviderRoute, resolveTransport } from '../lib/providers/registry.js';
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
    assert.match(ui.credential.advancedHelp, /images\/generations/);
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

test('resolves legacy transport names through one adapter contract', () => {
    assert.equal(resolveAdapterId('openAiImages'), 'openai-images');
    assert.equal(resolveAdapterId('sillyTavernGeminiProxy'), 'sillytavern-gemini-proxy');
    assert.equal(resolveAdapterId('missing-transport'), null);
});

test('normalizes built-in LinkAPI models with verified route evidence', () => {
    const provider = getNormalizedProviderDefinition('linkapi');
    for (const model of provider.builtInModels) {
        assert.equal(model.routeEvidence.state, 'verified', model.id);
        assert.equal(typeof model.routeEvidence.protocol, 'string', model.id);
        assert.equal(typeof model.routeEvidence.requestShapeRevision, 'string', model.id);
    }
});

test('normalizes Z.AI and ArliAI built-ins with their explicit native route evidence', () => {
    const zai = getNormalizedProviderDefinition('zai');
    const arliai = getNormalizedProviderDefinition('arliai');
    assert.equal(zai.builtInModels.find((model) => model.id === 'glm-image').routeEvidence.state, 'verified');
    assert.equal(zai.builtInModels.find((model) => model.id === 'glm-image').routeEvidence.protocol, 'zai-native');
    assert.equal(arliai.builtInModels.find((model) => model.id === 'stable-diffusion-xl').routeEvidence.state, 'verified');
    assert.equal(arliai.builtInModels.find((model) => model.id === 'stable-diffusion-xl').routeEvidence.protocol, 'arliai-native');
});

test('preserves Gemini reference caps through Google AI Studio and LinkAPI proxy routes', () => {
    assert.deepEqual(getReferenceImageCapability('makersuite', 'gemini-2.5-flash-image'), { maxCount: 3 });
    assert.deepEqual(getReferenceImageCapability('makersuite', 'gemini-3-pro-image'), { maxCount: 14 });
    assert.deepEqual(getReferenceImageCapability('makersuite', 'gemini-3-pro-image-preview'), { maxCount: 14 });
    assert.deepEqual(getReferenceImageCapability('makersuite', 'gemini-3.1-flash-image'), { maxCount: 4 });
    assert.deepEqual(getReferenceImageCapability('makersuite', 'gemini-3.1-flash-image-preview'), { maxCount: 4 });
    assert.deepEqual(getReferenceImageCapability('linkapi', 'gemini-2.5-flash-image'), { maxCount: 3 });
    assert.deepEqual(getReferenceImageCapability('linkapi', 'gemini-3.1-flash-image-preview'), { maxCount: 4 });
    assert.deepEqual(getReferenceImageCapability('linkapi', 'gemini-3-pro-image-preview'), { maxCount: 14 });
    assert.equal(projectProviderUi('makersuite', 'gemini-2.5-flash-image').referenceImageMaxCount, 3);
    assert.equal(projectProviderUi('linkapi', 'gemini-2.5-flash-image').referenceImageMaxCount, 3);
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
    const start = index.indexOf('function captureGenerationSnapshot');
    const end = index.indexOf('async function materializeSnapshotAssets', start);
    const generation = index.slice(start, end);
    assert.match(generation, /resolveProviderRoute\(providerId, modelId\)/u);
    assert.doesNotMatch(generation, /providerId === 'tokenreply'|providerId === 'fixture'/u);
});

test('does not turn unlisted LinkAPI catalog IDs into curated models', () => {
    for (const modelId of ['gpt-image-1', 'dall-e-3']) {
        const model = getModelDefinition('linkapi', modelId);
        assert.equal(model, undefined, modelId);
    }
});

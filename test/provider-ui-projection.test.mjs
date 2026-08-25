import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROVIDERS, requiresAdapterRoute, resolveProviderRoute } from '../lib/providers/registry.js';
import { getModelFallback, projectProviderControls, projectProviderOptions, projectProviderUi } from '../lib/providers/ui-projection.js';

test('projects a fixture provider UI entirely from registry metadata', () => {
    PROVIDERS.fixture = {
        id: 'fixture',
        label: 'Fixture Images',
        credentialKey: 'fixture',
        ui: {
            requiresApiKey: true,
            apiKeyLabel: 'Fixture API Key',
            modelDiscovery: false,
            adapterRequired: true,
        },
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
        models: [{
            id: 'fixture-image',
            label: 'Fixture Image',
            transport: 'openAiImages',
            supportsReferenceImages: false,
            imageSizeOptions: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }],
            supportsThinking: false,
            supportsGoogleSearch: false,
            status: 'fixture',
        }],
    };

    try {
        assert.deepEqual(projectProviderOptions().find((option) => option.id === 'fixture'), {
            id: 'fixture',
            label: 'Fixture Images',
            status: undefined,
        });
        assert.deepEqual(projectProviderUi('fixture', 'fixture-image'), {            id: 'fixture',
            label: 'Fixture Images',
            status: undefined,
            requiresApiKey: true,
            apiKeyLabel: 'Fixture API Key',
            supportsModelDiscovery: false,
            modelDiscoveryExperimental: false,
            showsLegacyRecovery: false,
            providerInfo: undefined,
            modelNote: undefined,
            models: [{ id: 'fixture-image', label: 'Fixture Image' }],
            supportsReferenceImages: false,
            imageSizeOptions: [{ value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }],
            supportsThinking: false,
            supportsGoogleSearch: false,
        });
        const controls = projectProviderControls('fixture', 'fixture-image', 'large');
        assert.deepEqual(controls.imageSizeOptions, [
            { value: 'small', label: 'Small' },
            { value: 'large', label: 'Large' },
        ]);
        assert.equal(controls.imageSize, 'large');
    } finally {
        delete PROVIDERS.fixture;    }
});

test('renders provider controls from the registry rather than static provider names', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);

    assert.match(index, /projectProviderOptions/);
    assert.match(index, /renderProviderDropdown/);
    assert.doesNotMatch(index, /const PROVIDER_MODELS/);
    assert.doesNotMatch(settings, /<option value="(?:makersuite|linkapi|tokenreply|openrouter)">/);
});

test('keeps native SillyTavern providers out of adapter dispatch', () => {
    assert.equal(requiresAdapterRoute(resolveProviderRoute('makersuite', 'gemini-2.5-flash-image')), false);
    assert.equal(requiresAdapterRoute(resolveProviderRoute('openrouter', 'google/gemini-2.5-flash-image-preview')), false);
    assert.equal(requiresAdapterRoute(resolveProviderRoute('linkapi', 'gemini-2.5-flash-image')), true);
});

test('retains dynamic LinkAPI models and validates image size metadata', () => {
    for (const modelId of ['gpt-image-1', 'dall-e-3']) assert.equal(getModelFallback('linkapi', modelId), modelId);
    const pro = projectProviderControls('linkapi', 'gemini-3-pro-image-preview', '512');
    assert.equal(pro.imageSize, '');
    assert.deepEqual(pro.imageSizeOptions[0], { value: '1K', label: '1K' });
});

test('projects a persisted custom TokenReply model with conservative image capabilities', () => {
    const ui = projectProviderUi('tokenreply', 'custom-tokenreply-image', {
        localEntries: [{ id: 'custom-tokenreply-image', source: 'manual' }],
    });

    assert.equal(ui.models.at(-1).id, 'custom-tokenreply-image');
    assert.equal(ui.supportsReferenceImages, false);
    assert.equal(ui.imageSizeOptions.length, 0);
});

test('keeps LinkAPI advanced recovery controls separate from generic model discovery', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(index, /#cig_linkapi_container'\)\.toggle\(ui\.supportsModelDiscovery \|\| ui\.showsLegacyRecovery\)/);
    assert.match(settings, /id="cig_provider_advanced_container"/);
});

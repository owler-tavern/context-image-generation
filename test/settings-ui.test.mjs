import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SETTINGS_TABS,
    normalizeSettingsTab,
    deriveSetupReadiness,
    resolveInitialSettingsTab,
} from '../lib/settings-ui.js';

const provider = (overrides = {}) => ({
    id: 'makersuite',
    available: true,
    requiresApiKey: false,
    models: [{ id: 'image-model', label: 'Image model' }],
    ...overrides,
});

test('normalizes settings tabs and defaults invalid values to setup', () => {
    assert.deepEqual(SETTINGS_TABS, ['setup', 'preferences', 'images-cast']);
    assert.equal(normalizeSettingsTab('preferences'), 'preferences');
    assert.equal(normalizeSettingsTab('images-cast'), 'images-cast');
    assert.equal(normalizeSettingsTab('unknown'), 'setup');
    assert.equal(normalizeSettingsTab(undefined), 'setup');
});

test('reports a missing provider as needing provider setup', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: undefined, providerId: '' }), {
        state: 'needs-provider', label: 'Choose a provider',
    });
});

test('reports an unavailable provider explicitly', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider({ available: false }), providerId: 'missing' }), {
        state: 'unavailable', label: 'Provider unavailable',
    });
});

test('requires an API key when the provider requires one', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider({ requiresApiKey: true }), providerId: 'maker', modelId: 'image-model', apiKey: '  ' }), {
        state: 'needs-key', label: 'Add your API key',
    });
});

test('requires a model when the model is missing or not in the provider model list', () => {
    const ui = provider();
    assert.deepEqual(deriveSetupReadiness({ providerUi: ui, providerId: ui.id, modelId: '' }), {
        state: 'needs-model', label: 'Choose an image model',
    });
    assert.deepEqual(deriveSetupReadiness({ providerUi: ui, providerId: ui.id, modelId: 'other' }), {
        state: 'needs-model', label: 'Choose an image model',
    });
});

test('reports ready only for a listed model and complete credentials', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider(), providerId: 'makersuite', modelId: 'image-model', apiKey: '' }), {
        state: 'ready', label: 'Ready to generate',
    });
});

test('forces setup while incomplete and restores saved tab when ready', () => {
    assert.equal(resolveInitialSettingsTab({ savedTab: 'preferences', readiness: { state: 'needs-model' } }), 'setup');
    assert.equal(resolveInitialSettingsTab({ savedTab: 'images-cast', readiness: { state: 'ready' } }), 'images-cast');
    assert.equal(resolveInitialSettingsTab({ savedTab: 'invalid', readiness: { state: 'ready' } }), 'setup');
});

test('does not use network-health language in readiness labels', () => {
    const labels = [
        deriveSetupReadiness({ providerUi: undefined, providerId: '' }).label,
        deriveSetupReadiness({ providerUi: provider({ available: false }), providerId: 'missing' }).label,
        deriveSetupReadiness({ providerUi: provider({ requiresApiKey: true }), providerId: 'maker', modelId: 'image-model' }).label,
        deriveSetupReadiness({ providerUi: provider(), providerId: 'maker', modelId: 'other' }).label,
        deriveSetupReadiness({ providerUi: provider(), providerId: 'maker', modelId: 'image-model' }).label,
    ];
    assert.ok(labels.every((label) => !/connected|online|verified/i.test(label)));
});

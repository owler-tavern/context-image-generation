import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SETTINGS_TABS,
    normalizeSettingsTab,
    deriveSetupReadiness,
    formatSetupRuntimeIssue,
    projectImageSizePreference,
    resolveInitialSettingsTab,
} from '../lib/settings-ui.js';
import * as settingsUi from '../lib/settings-ui.js';

const provider = (overrides = {}) => ({
    id: 'makersuite',
    available: true,
    requiresApiKey: false,
    models: [{ id: 'image-model', label: 'Image model' }],
    ...overrides,
});

test('formats a distinct Setup runtime issue only from an already safe message', () => {
    assert.equal(formatSetupRuntimeIssue({ context: 'Provider model discovery', userMessage: 'Could not reach LinkAPI. Check your connection and try again.' }), 'Provider model discovery: Could not reach LinkAPI. Check your connection and try again.');
    assert.equal(formatSetupRuntimeIssue({ context: 'Provider model discovery', userMessage: '' }), '');
    assert.equal(formatSetupRuntimeIssue({ context: '', userMessage: 'Model discovery failed. Your current model list was kept.' }), 'Provider issue: Model discovery failed. Your current model list was kept.');
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
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider({ available: false }), providerId: 'makersuite' }), {
        state: 'unavailable', label: 'Provider unavailable',
    });
});

test('rejects a stale provider projection whose identity does not match the selected provider', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider({ id: 'makersuite' }), providerId: 'linkapi', modelId: 'image-model' }), {
        state: 'needs-provider', label: 'Choose a provider',
    });
});

test('requires an API key when the provider requires one', () => {
    assert.deepEqual(deriveSetupReadiness({ providerUi: provider({ requiresApiKey: true }), providerId: 'makersuite', modelId: 'image-model', apiKey: '  ' }), {
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

test('requires an explicit route, then reports configured status without claiming a live generation', () => {
    const input = { providerUi: provider(), providerId: 'makersuite', modelId: 'image-model', apiKey: '' };
    assert.deepEqual(deriveSetupReadiness(input), {
        state: 'needs-method', label: 'Choose a generation method for this model.',
    });
    assert.deepEqual(deriveSetupReadiness({
        ...input,
        route: { transportId: 'host', model: { routeEvidence: { state: 'configured' } } },
    }), {
        state: 'ready', label: 'Configured. Image generation has not been tried with this model. Use the wand to try it.',
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
        deriveSetupReadiness({ providerUi: provider({ available: false }), providerId: 'makersuite' }).label,
        deriveSetupReadiness({ providerUi: provider({ requiresApiKey: true }), providerId: 'makersuite', modelId: 'image-model' }).label,
        deriveSetupReadiness({ providerUi: provider(), providerId: 'makersuite', modelId: 'other' }).label,
        deriveSetupReadiness({ providerUi: provider(), providerId: 'maker', modelId: 'image-model' }).label,
    ];
    assert.ok(labels.every((label) => !/connected|online|verified/i.test(label)));
});

test('preserves a saved image size while unsupported models hide it and restores it when capability returns', () => {
    const saved = '4K';
    const unsupported = projectImageSizePreference(saved, []);
    assert.deepEqual(unsupported, {
        savedValue: '4K',
        selectedValue: '',
        showControl: false,
        note: 'Image size is unavailable for this model; your 4K preference is saved.',
    });

    const partial = projectImageSizePreference(saved, [{ value: '1K' }, { value: '2K' }]);
    assert.equal(partial.savedValue, '4K');
    assert.equal(partial.selectedValue, '');
    assert.match(partial.note, /4K preference is saved/);

    const restored = projectImageSizePreference(saved, [{ value: '1K' }, { value: '4K' }]);
    assert.deepEqual(restored, {
        savedValue: '4K',
        selectedValue: '4K',
        showControl: true,
        note: '',
    });
});

test('keeps visual-reference controls visible without losing saved preferences and restores them when support returns', () => {
    assert.equal(typeof settingsUi.projectReferencePreferences, 'function');
    const saved = Object.freeze({ useAvatars: true, usePreviousImage: true });
    const supported = settingsUi.projectReferencePreferences(saved, true);
    const unsupported = settingsUi.projectReferencePreferences(saved, false);
    const restored = settingsUi.projectReferencePreferences(saved, true);

    assert.deepEqual(supported, {
        showAvatarControl: true,
        showPreviousImageControl: true,
        enabled: true,
        note: '',
    });
    assert.deepEqual(unsupported, {
        showAvatarControl: true,
        showPreviousImageControl: true,
        enabled: false,
        note: 'Visual references are unavailable for this model. Your saved reference preferences are kept and will be available when you choose a supported model.',
    });
    assert.deepEqual(settingsUi.projectReferencePreferences(saved, 'unknown'), {
        showAvatarControl: true,
        showPreviousImageControl: true,
        enabled: false,
        note: 'Visual references have not been verified for this model. Your saved reference preferences are kept and will be available when you choose a supported model.',
    });
    assert.deepEqual(restored, supported);
    assert.deepEqual(saved, { useAvatars: true, usePreviousImage: true });
});

test('projects visible and accessible Setup tab status for readiness and runtime issues', () => {
    assert.equal(typeof settingsUi.projectSetupTabStatus, 'function');
    assert.deepEqual(settingsUi.projectSetupTabStatus({ state: 'needs-key', label: 'Add your API key' }, ''), {
        state: 'incomplete',
        text: 'Setup incomplete',
        icon: 'fa-triangle-exclamation',
        accessibleLabel: 'Setup incomplete: Add your API key',
    });
    assert.deepEqual(settingsUi.projectSetupTabStatus({ state: 'ready', label: 'Ready to generate' }, 'Provider model discovery: Try again.'), {
        state: 'issue',
        text: 'Setup issue',
        icon: 'fa-circle-exclamation',
        accessibleLabel: 'Setup issue: Provider model discovery: Try again.',
    });
    assert.deepEqual(settingsUi.projectSetupTabStatus({ state: 'ready', label: 'Ready to generate' }, ''), {
        state: 'ready',
        text: '',
        icon: '',
        accessibleLabel: 'Setup',
    });
});

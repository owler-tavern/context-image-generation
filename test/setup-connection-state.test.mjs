import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../lib/setup-connection-state.js';
import { deriveSetupReadiness } from '../lib/settings-ui.js';

test('explicit activation remembers each connection model without modifying saved credentials', () => {
    const settings = { provider: 'linkapi', model: 'gemini-image', provider_keys: { linkapi: 'fixture' } };
    state.activateImageConnection(settings, 'custom', ['gpt-image']);
    assert.equal(settings.provider, 'custom');
    assert.equal(settings.model, '');
    state.rememberImageModel(settings, 'gpt-image');
    state.activateImageConnection(settings, 'linkapi', ['gemini-image']);
    assert.equal(settings.model, 'gemini-image');
    state.activateImageConnection(settings, 'custom', ['gpt-image']);
    assert.equal(settings.model, 'gpt-image');
    assert.equal(settings.provider_keys.linkapi, 'fixture');
});

test('model filtering preserves active selection and retains access to unknown catalog models', () => {
    const models = [{ id: 'image', knownImage: true }, { id: 'unknown' }];
    assert.deepEqual(state.projectSetupModels(models, {}).map(x => x.id), ['image']);
    assert.deepEqual(state.projectSetupModels(models, { selectedModelId: 'unknown' }).map(x => x.id), ['image', 'unknown']);
    assert.deepEqual(state.projectSetupModels(models, { showAll: true, query: 'unknown' }).map(x => x.id), ['unknown']);
    assert.equal(state.projectSetupModels([{ id: 'unknown' }], {}).length, 1);
});

test('readiness does not call an unresolved catalog model ready or demand experimental consent', () => {
    const args = { providerUi: { id: 'proxy', requiresApiKey: true, models: [{ id: 'image' }] }, providerId: 'proxy', modelId: 'image', apiKey: 'fixture' };
    assert.equal(deriveSetupReadiness(args).state, 'needs-method');
    const route = { transportId: 'openai-images', model: { routeEvidence: { state: 'configured' } } };
    assert.equal(deriveSetupReadiness({ ...args, route }).state, 'ready');
    assert.match(deriveSetupReadiness({ ...args, route }).label, /not.*tried|try.*wand/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiscoveredModel, parseProviderCatalog } from '../lib/providers/model-discovery.js';
import { getProviderDefinition, validateProviderRoute } from '../lib/providers/registry.js';

test('keeps TokenReply Grok on its verified OpenAI Images route', () => {
    const model = classifyDiscoveredModel(getProviderDefinition('tokenreply'), { id: 'grok-imagine-image' });
    assert.equal(model.classification, 'accepted');
    assert.equal(model.model.transportId || model.model.transport, 'openAiImages');
    assert.equal(model.model.routeEvidence.state, 'verified');
});

test('shows TokenReply Nano Banana as unresolved without an endpoint or generation adapter', () => {
    const catalog = parseProviderCatalog({ data: [{ id: 'gemini-2.5-flash-image' }] }, getProviderDefinition('tokenreply'));
    const model = catalog.unresolved[0];
    let adapterChecks = 0;

    assert.equal(model.id, 'gemini-2.5-flash-image');
    assert.equal(model.transportId, null);
    assert.equal(model.routeEvidence.state, 'unverified');
    assert.match(model.modelNote, /Unverified/i);
    assert.throws(() => validateProviderRoute({
        providerId: 'tokenreply',
        modelId: model.id,
        modelDefinition: model,
        adapterRegistry: { has() { adapterChecks += 1; return true; } },
    }), /transport route is not allowlisted/i);
    assert.equal(adapterChecks, 0);
});

test('accepts TokenReply Nano Banana only when injected authoritative Gemini route evidence is complete', () => {
    const provider = {
        ...getProviderDefinition('tokenreply'),
        transports: {
            ...getProviderDefinition('tokenreply').transports,
            sillyTavernGeminiProxy: { baseUrl: 'https://tokenreply.example/gemini' },
        },
        authoritativeCatalogRoutes: {
            'gemini-2.5-flash-image': {
                transportId: 'sillyTavernGeminiProxy',
                endpoint: 'https://tokenreply.example/gemini',
                routeEvidence: {
                    state: 'verified', source: 'official-docs', observedAt: '2026-08-31T00:00:00.000Z',
                    protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1',
                },
            },
        },
    };
    const model = classifyDiscoveredModel(provider, { id: 'gemini-2.5-flash-image' });

    assert.equal(model.classification, 'accepted');
    assert.equal(model.model.transportId, 'sillyTavernGeminiProxy');
    assert.equal(model.model.endpoint, 'https://tokenreply.example/gemini');
    assert.equal(model.model.routeEvidence.protocol, 'gemini-compatible');
});

test('does not turn unknown TokenReply catalog records into generatable models', () => {
    const model = classifyDiscoveredModel(getProviderDefinition('tokenreply'), { id: 'unknown-image-model' });
    assert.equal(model.classification, 'rejected');
    assert.equal(model.model, undefined);
});

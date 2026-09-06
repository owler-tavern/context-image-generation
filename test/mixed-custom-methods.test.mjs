import test from 'node:test';
import assert from 'node:assert/strict';
import {
    customModelRouteRevision,
    migrateCustomConnections,
    resolveCustomModelRoute,
    validateCustomConnection,
} from '../lib/providers/custom-connections.js';
import { discoverCustomConnectionModels } from '../lib/providers/model-discovery.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { promoteCustomModelEvidence } from '../lib/providers/dispatch.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw0NqQAAAABJRU5ErkJggg==';

const connection = {
    schema: 1,
    id: 'connection:123e4567-e89b-42d3-a456-426614174111',
    label: 'Mixed Gateway',
    protocol: 'openai-images',
    baseUrl: 'https://catalog.example',
    modelsPath: '/v1/models',
    generationPath: '/v1/images/generations',
    generationMethods: {
        'openai-images': { baseUrl: 'https://images.example', generationPath: '/v1/images/generations' },
        'gemini-compatible': { baseUrl: 'https://gemini.example' },
    },
    credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174111',
    enabled: true,
};

test('a custom connection resolves each explicitly assigned model to its own method and origin', () => {
    const valid = validateCustomConnection(connection);
    assert.equal(valid.valid, true);
    const openai = resolveCustomModelRoute(valid.connection, { id: 'image-openai', transportId: 'openai-images' });
    const gemini = resolveCustomModelRoute(valid.connection, { id: 'image-gemini', transportId: 'sillytavern-gemini-proxy' });

    assert.deepEqual(openai, {
        protocol: 'openai-images', transportId: 'openai-images', endpointClass: 'custom-openai-images',
        endpoint: 'https://images.example/v1/images/generations', revision: customModelRouteRevision(valid.connection, { id: 'image-openai', transportId: 'openai-images' }),
    });
    assert.deepEqual(gemini, {
        protocol: 'gemini-compatible', transportId: 'sillytavern-gemini-proxy', endpointClass: 'custom-gemini-proxy',
        endpoint: 'https://gemini.example', revision: customModelRouteRevision(valid.connection, { id: 'image-gemini', transportId: 'sillytavern-gemini-proxy' }),
    });
    assert.equal(resolveCustomModelRoute(valid.connection, { id: 'unassigned' }), null);
    assert.notEqual(openai.revision, gemini.revision);
});

test('migration and catalog refresh preserve an explicit model method without model-name inference', async () => {
    const saved = migrateCustomConnections({
        connections: { [connection.id]: connection },
        models: { [connection.id]: [{ id: 'not-a-gemini-name', transportId: 'sillytavern-gemini-proxy' }] },
    });
    assert.equal(saved.models[connection.id][0].transportId, 'sillytavern-gemini-proxy');
    assert.equal(saved.models[connection.id][0].endpoint, 'https://gemini.example');
    assert.equal(saved.models[connection.id][0].routeEvidence.state, 'configured');

    const result = await discoverCustomConnectionModels({
        connection,
        authPreset: 'bearer', credential: 'shared-key',
        savedModels: saved.models[connection.id],
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'not-a-gemini-name' }, { id: 'new-catalog-model' }] }), { status: 200 }),
    });
    const kept = result.models.find(({ id }) => id === 'not-a-gemini-name');
    const newModel = result.models.find(({ id }) => id === 'new-catalog-model');
    assert.equal(kept.transportId, 'sillytavern-gemini-proxy');
    assert.equal(kept.endpoint, 'https://gemini.example');
    assert.equal(newModel.transportId, 'openai-images');
    assert.equal(newModel.endpoint, 'https://images.example/v1/images/generations');
});

test('dispatch sends the selected Gemini model through its configured proxy origin', async () => {
    const model = { id: 'openai-looking-name', transportId: 'sillytavern-gemini-proxy' };
    const route = resolveCustomModelRoute(connection, model);
    const requests = [];
    const result = await dispatchProviderRoute({
        plan: {
            invocation: 'wand', policy: { source: 'manual', routeConfirmationAccepted: true },
            messages: [{ role: 'user', content: 'scene' }], options: {},
            resolved: {
                providerId: connection.id, connectionId: connection.id, modelId: model.id,
                transportId: route.transportId, endpointClass: route.endpointClass, endpoint: route.endpoint,
                routeEvidence: { state: 'configured', protocol: route.protocol, requestShapeRevision: 'st-gemini-proxy-v1', revision: route.revision },
                modelDefinition: { source: { kind: 'manual' } }, capabilities: {},
            },
        },
        connection: { ...connection, providerId: connection.id, confirmedRevision: route.revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'shared-key',
            requestSillyTavernImage: async (request) => { requests.push(request); return { imageData: PNG, mimeType: 'image/png' }; },
            fetchImpl: async () => { throw new Error('Gemini dispatch must use the host proxy'); },
        },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].reverse_proxy, 'https://gemini.example');
    assert.equal(requests[0].model, 'openai-looking-name');
    assert.equal(result.mimeType, 'image/png');
});

test('mixed assignments persist configured evidence and only the successful model reloads as verified', () => {
    const assignedAt = '2026-09-06T00:00:00.000Z';
    const modelA = { id: 'image-a', transportId: 'openai-images', routeEvidence: { state: 'configured', observedAt: assignedAt } };
    const modelB = { id: 'image-b', transportId: 'sillytavern-gemini-proxy', routeEvidence: { state: 'configured', observedAt: assignedAt } };
    const success = promoteCustomModelEvidence({ connection, modelId: modelA.id, transportId: modelA.transportId, decodedResult: { imageData: PNG, mimeType: 'image/png' }, now: () => '2026-09-06T00:05:00.000Z' });
    const store = migrateCustomConnections({ connections: { [connection.id]: connection }, models: { [connection.id]: [modelA, modelB] }, modelEvidence: { [connection.id]: { [modelA.id]: success } } });
    const [reloadedA, reloadedB] = store.models[connection.id];
    assert.deepEqual(reloadedA.routeEvidence, { state: 'verified', source: 'sanitized-probe', observedAt: '2026-09-06T00:05:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1', revision: success.revision });
    assert.deepEqual(reloadedB.routeEvidence, { state: 'configured', source: 'user-configured-protocol', observedAt: assignedAt, protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1', revision: customModelRouteRevision(connection, modelB) });
});

test('method map order does not alter revisions and catalog authentication is independent of the default method', async () => {
    const geminiDefault = {
        ...connection,
        protocol: 'gemini-compatible', baseUrl: 'https://catalog.example',
        catalogAuth: 'bearer',
        generationMethods: {
            'gemini-compatible': { baseUrl: 'https://gemini.example' },
            'openai-images': { baseUrl: 'https://images.example', generationPath: '/v1/images/generations' },
        },
    };
    delete geminiDefault.generationPath;
    const reversed = { ...geminiDefault, generationMethods: Object.fromEntries(Object.entries(geminiDefault.generationMethods).reverse()) };
    assert.equal(customModelRouteRevision(geminiDefault, { id: 'a', transportId: 'openai-images' }), customModelRouteRevision(reversed, { id: 'a', transportId: 'openai-images' }));
    const result = await discoverCustomConnectionModels({ connection: geminiDefault, authPreset: 'bearer', credential: 'shared', fetchImpl: async (_url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer shared');
        return new Response(JSON.stringify({ data: [{ id: 'image' }] }), { status: 200 });
    } });
    assert.equal(result.models[0].transportId, 'sillytavern-gemini-proxy');
});

test('a single-method explicit manual assignment persists configured route evidence', () => {
    const single = { ...connection };
    delete single.generationMethods;
    const store = migrateCustomConnections({ connections: { [single.id]: single }, models: { [single.id]: [{ id: 'manual-image', transportId: 'openai-images', source: 'manual' }] } });
    const model = store.models[single.id][0];
    assert.equal(model.routeEvidence.state, 'configured');
    assert.match(model.routeEvidence.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a Gemini-default mixed connection dispatches an explicitly assigned OpenAI model to its method URL', async () => {
    const mixed = { ...connection, protocol: 'gemini-compatible', catalogAuth: 'bearer' };
    delete mixed.generationPath;
    const model = { id: 'not-an-openai-name', transportId: 'openai-images' };
    const route = resolveCustomModelRoute(mixed, model);
    const urls = [];
    await dispatchProviderRoute({
        plan: { invocation: 'wand', policy: { source: 'manual', routeConfirmationAccepted: true }, prompt: { sourceMessage: 'scene' }, messages: [], options: {}, resolved: { providerId: mixed.id, connectionId: mixed.id, modelId: model.id, transportId: route.transportId, endpointClass: route.endpointClass, endpoint: route.endpoint, routeEvidence: { state: 'configured', revision: route.revision }, modelDefinition: { source: { kind: 'manual' } } } },
        connection: { ...mixed, providerId: mixed.id, confirmedRevision: route.revision }, signal: new AbortController().signal,
        transportContext: { apiKey: 'shared', fetchImpl: async (url) => { urls.push(url); return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }); } },
    });
    assert.deepEqual(urls, ['https://images.example/v1/images/generations']);
});

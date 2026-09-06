import test from 'node:test';
import assert from 'node:assert/strict';
import {
    connectionRevision,
    migrateCustomConnections,
    safeConnectionProjection,
    validateCustomConnection,
} from '../lib/providers/custom-connections.js';
import { discoverCustomConnectionModels } from '../lib/providers/model-discovery.js';
import { dispatchProviderRoute, promoteCustomConnectionEvidence } from '../lib/providers/dispatch.js';
import { readFile } from 'node:fs/promises';
import { projectCustomConnectionEditor, projectCustomFirstRequestConfirmation } from '../lib/providers/ui-projection.js';

const settingsMarkup = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw0NqQAAAABJRU5ErkJggg==';
const connection = {
    schema: 1,
    id: 'connection:123e4567-e89b-42d3-a456-426614174099',
    label: 'Gemini Gateway',
    protocol: 'gemini-compatible',
    baseUrl: 'https://gemini.example',
    modelsPath: '/v1beta/models',
    credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174099',
    enabled: true,
};

test('Gemini connection accepts only its constrained schema and projects the ST proxy route', () => {
    const valid = validateCustomConnection(connection);
    assert.equal(valid.valid, true);
    assert.equal(Object.hasOwn(valid.connection, 'generationPath'), false);
    const projection = safeConnectionProjection(connection);
    assert.equal(projection.protocol, 'gemini-compatible');
    assert.deepEqual(projection.routePreview.generation, {
        method: 'POST',
        url: '/api/backends/chat-completions/generate',
        transport: 'SillyTavern Gemini proxy',
        upstreamProxyRoot: 'https://gemini.example',
    });
    assert.equal(projectCustomConnectionEditor(connection).protocol.fixed, false);
    assert.equal(projection.credential.preset, 'gemini-api-key');
    for (const field of ['generationPath', 'headers', 'template', 'responseSelector', 'redirects']) {
        assert.equal(validateCustomConnection({ ...connection, [field]: field === 'generationPath' ? '/v1/images/generations' : {} }).valid, false, field);
    }
});

test('Gemini discovery binds every catalog ID to the saved connection without model-name routing', async () => {
    const calls = [];
    const result = await discoverCustomConnectionModels({
        connection,
        authPreset: 'gemini-api-key',
        credential: 'secret-fixture',
        now: () => '2026-08-31T16:00:00.000Z',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ models: [{ name: 'models/nano-banana-2' }, { name: 'models/not-an-image-name' }] }), { status: 200 });
        },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gemini.example/v1beta/models');
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'secret-fixture');
    assert.deepEqual(result.models.map(({ id }) => id), ['models/nano-banana-2', 'models/not-an-image-name']);
    for (const model of result.models) {
        assert.equal(model.connectionId, connection.id);
        assert.equal(model.transportId, 'sillytavern-gemini-proxy');
        assert.equal(model.endpointClass, 'custom-gemini-proxy');
        assert.equal(model.endpoint, connection.baseUrl);
        assert.equal(model.routeEvidence.protocol, 'gemini-compatible');
        assert.equal(model.routeEvidence.requestShapeRevision, 'st-gemini-proxy-v1');
        assert.equal(model.capabilities.imageGeneration.state, 'unknown');
    }
});

test('configured Gemini route uses only the SillyTavern proxy request and verifies the exact revision after decode', async () => {
    const revision = connectionRevision(connection);
    const requests = [];
    const plan = {
        invocation: 'settings',
        messages: [{ role: 'user', content: 'scene' }],
        options: { aspectRatio: '16:9' },
        policy: { source: 'manual', routeConfirmationAccepted: true, preflightAccepted: true },
        resolved: {
            providerId: connection.id,
            connectionId: connection.id,
            modelId: 'models/not-an-image-name',
            transportId: 'sillytavern-gemini-proxy',
            endpointClass: 'custom-gemini-proxy',
            endpoint: connection.baseUrl,
            capabilities: { imageGeneration: { state: 'unknown' } },
            modelDefinition: { source: { kind: 'fetched' } },
            routeEvidence: { state: 'configured', source: 'user-configured-protocol', protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1', revision },
        },
    };
    const decoded = await dispatchProviderRoute({
        plan,
        connection: { ...connection, providerId: connection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'secret-fixture',
            requestSillyTavernImage: async (body) => { requests.push(body); return { imageData: PNG, mimeType: 'image/png' }; },
            fetchImpl: async () => { throw new Error('custom origin must not be called for generation'); },
        },
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].reverse_proxy, connection.baseUrl);
    assert.equal(requests[0].proxy_password, 'secret-fixture');
    assert.equal(requests[0].model, 'models/not-an-image-name');
    assert.equal(requests[0].request_image_aspect_ratio, '16:9');
    assert.equal(promoteCustomConnectionEvidence({ connection, evidence: plan.resolved.routeEvidence, decodedResult: decoded }).state, 'verified');
});

test('Gemini route mismatch, missing credential, stale revision, and automation all fail before I/O', async () => {
    const revision = connectionRevision(connection);
    const basePlan = {
        invocation: 'settings', policy: { source: 'manual', routeConfirmationAccepted: true, preflightAccepted: true },
        resolved: { providerId: connection.id, connectionId: connection.id, modelId: 'm', transportId: 'sillytavern-gemini-proxy', endpointClass: 'custom-gemini-proxy', endpoint: connection.baseUrl, capabilities: { imageGeneration: { state: 'unknown' } }, modelDefinition: { source: { kind: 'fetched' } }, routeEvidence: { state: 'configured', revision, protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1' } },
    };
    const cases = [
        ['wrong transport', { ...basePlan, resolved: { ...basePlan.resolved, transportId: 'openai-images', endpointClass: 'custom-openai-images', endpoint: `${connection.baseUrl}/v1/images/generations` } }, 'secret'],
        ['missing credential', basePlan, ''],
        ['stale revision', { ...basePlan, resolved: { ...basePlan.resolved, routeEvidence: { ...basePlan.resolved.routeEvidence, revision: 'connection-revision:stale' } } }, 'secret'],
        ['automation', { ...basePlan, invocation: 'automation' }, 'secret'],
    ];
    for (const [name, plan, apiKey] of cases) {
        let io = 0;
        await assert.rejects(dispatchProviderRoute({ plan, connection: { ...connection, providerId: connection.id, confirmedRevision: revision }, signal: new AbortController().signal, transportContext: { apiKey, requestSillyTavernImage: async () => { io += 1; } } }), /route|credential|revision|manual|configured/i, name);
        assert.equal(io, 0, name);
    }
});

test('same-revision refresh preserves verified Gemini evidence and route edits invalidate it', () => {
    const revision = connectionRevision(connection);
    const store = migrateCustomConnections({
        connections: { [connection.id]: connection },
        models: { [connection.id]: [{ id: 'models/nano-banana-2' }] },
        evidence: { [connection.id]: { state: 'verified', revision, observedAt: '2026-08-31T16:00:00.000Z' } },
    });
    assert.equal(store.evidence[connection.id].state, 'verified');
    assert.equal(store.models[connection.id][0].transportId, 'sillytavern-gemini-proxy');
    assert.equal(store.models[connection.id][0].routeEvidence.requestShapeRevision, 'st-gemini-proxy-v1');
    const edited = { ...connection, modelsPath: '/models' };
    const editedStore = migrateCustomConnections({ connections: { [connection.id]: edited }, models: store.models, evidence: store.evidence });
    assert.equal(editedStore.evidence[connection.id], undefined);
});

test('settings makes Gemini an explicit protocol and hides its generation path', () => {
    const editor = projectCustomConnectionEditor(connection, { credentialConfigured: true });
    assert.equal(editor.protocol.label, 'Gemini-compatible');
    assert.deepEqual(editor.authPresets.map(({ value }) => value), ['gemini-api-key', 'none']);
    assert.match(settingsMarkup, /option value="gemini-compatible">Gemini-compatible/);
    assert.doesNotMatch(settingsMarkup, /id="cig_custom_connection_protocol"[^>]*disabled/);
    assert.match(runtimeSource, /protocol === 'gemini-compatible'/);
    assert.match(runtimeSource, /#cig_custom_connection_generation_path[^\n]+toggle/);
});

test('Gemini first-request confirmation names the saved protocol, transport, host endpoint, and upstream proxy root', () => {
    const confirmation = projectCustomFirstRequestConfirmation(connection);
    assert.equal(confirmation.protocolLabel, 'Gemini-compatible');
    assert.equal(confirmation.transportLabel, 'SillyTavern Gemini proxy');
    assert.equal(confirmation.endpoint, '/api/backends/chat-completions/generate');
    assert.equal(confirmation.upstreamProxyRoot, 'https://gemini.example');
    assert.match(confirmation.message, /Protocol: Gemini-compatible/);
    assert.match(confirmation.message, /Transport: SillyTavern Gemini proxy/);
    assert.match(confirmation.message, /POST \/api\/backends\/chat-completions\/generate/);
    assert.match(confirmation.message, /Upstream proxy root: https:\/\/gemini\.example/);
    assert.doesNotMatch(confirmation.message, /Protocol: OpenAI Images/);
    assert.match(runtimeSource, /resolveCustomModelRoute\(connection, model\)/);
});

test('Gemini discovery fallbacks preserve the exact saved connection route and evidence', async () => {
    const revision = connectionRevision(connection);
    const savedModels = [{ id: 'models/saved', source: { kind: 'fetched' } }];
    const existingEvidence = { state: 'configured', revision, observedAt: '2026-08-31T16:00:00.000Z' };
    const cases = [
        ['empty', 'gemini-api-key', async () => new Response(JSON.stringify({ models: [] }), { status: 200 })],
        ['error', 'gemini-api-key', async () => new Response('no', { status: 503 })],
        ['redirect', 'gemini-api-key', async () => ({ ok: true, redirected: true })],
        ['invalid auth', 'bearer', async () => { throw new Error('must not fetch'); }],
    ];
    for (const [name, authPreset, fetchImpl] of cases) {
        const result = await discoverCustomConnectionModels({ connection, authPreset, credential: 'secret', savedModels, existingEvidence, fetchImpl });
        assert.equal(result.models.length, 1, name);
        assert.deepEqual(result.models[0], {
            id: 'models/saved', label: 'models/saved', providerId: connection.id, connectionId: connection.id,
            transportId: 'sillytavern-gemini-proxy', endpointClass: 'custom-gemini-proxy', endpoint: connection.baseUrl,
            source: { kind: 'fetched' }, capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' } },
            routeEvidence: { state: 'configured', source: 'user-configured-protocol', observedAt: existingEvidence.observedAt, protocol: 'gemini-compatible', requestShapeRevision: 'st-gemini-proxy-v1', revision },
            posture: 'experimental',
        }, name);
    }
});

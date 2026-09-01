import test from 'node:test';
import assert from 'node:assert/strict';
import {
    connectionRevision,
    migrateCustomConnections,
    nextCustomDiscoveryEvidence,
    safeConnectionProjection,
    removeCustomConnection,
    removeCustomConnectionFromSettings,
    projectCurrentCustomDiscoveryState,
    selectCustomConnection,
    upsertCustomConnection,
    validateCustomConnection,
} from '../lib/providers/custom-connections.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';

const CONNECTION_ID = 'connection:123e4567-e89b-42d3-a456-426614174000';

function validConnection(overrides = {}) {
    return {
        schema: 1,
        id: CONNECTION_ID,
        label: 'My Gateway',
        protocol: 'openai-images',
        baseUrl: 'https://gateway.example',
        modelsPath: '/v1/models',
        generationPath: '/v1/images/generations',
        credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174000',
        enabled: true,
        ...overrides,
    };
}

test('validates and normalizes one immutable OpenAI Images connection record', () => {
    const input = validConnection({ label: '  My Gateway  ', baseUrl: 'https://gateway.example/' });
    const before = structuredClone(input);

    const result = validateCustomConnection(input);

    assert.deepEqual(input, before);
    assert.equal(result.valid, true);
    assert.deepEqual(result.connection, validConnection());
    assert.equal(result.localInsecure, false);
    assert.equal(Object.isFrozen(result.connection), true);
});

test('deleting a connection removes its route data while returning only its redacted identity', () => {
    const store = upsertCustomConnection({}, validConnection());
    const result = removeCustomConnection(store, CONNECTION_ID);
    assert.equal(result.store.connections[CONNECTION_ID], undefined);
    assert.deepEqual(result.removed, { id: CONNECTION_ID, label: 'My Gateway', protocol: 'openai-images' });
    assert.doesNotMatch(JSON.stringify(result), /custom:123e|gateway\.example/i);
});

test('selected connection deletion cleans only its models, evidence, consent, discovery, and credential', () => {
    const other = validConnection({
        id: 'connection:123e4567-e89b-42d3-a456-426614174001', label: 'Other Gateway',
        baseUrl: 'https://other.example', credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174001',
    });
    const customConnections = upsertCustomConnection(upsertCustomConnection({}, validConnection()), other);
    const targetConsent = JSON.stringify([CONNECTION_ID, 'gpt-image-1', 'openai-images']);
    const otherConsent = JSON.stringify([other.id, 'other-model', 'openai-images']);
    const result = removeCustomConnectionFromSettings({
        provider: CONNECTION_ID, model: 'gpt-image-1', custom_connection_editor_id: CONNECTION_ID,
        custom_connections: customConnections,
        custom_connection_keys: { [validConnection().credentialRef]: 'target-secret', [other.credentialRef]: 'other-secret' },
        model_discovery: { [CONNECTION_ID]: { evidence: { returnedCount: 2 } }, [other.id]: { evidence: { returnedCount: 1 } } },
        experimental_model_preflight: { [targetConsent]: true, [otherConsent]: true },
    }, CONNECTION_ID);
    assert.equal(result.removed.id, CONNECTION_ID);
    assert.equal(result.settings.provider, 'makersuite');
    assert.equal(result.settings.model, '');
    assert.equal(result.settings.custom_connection_editor_id, '');
    assert.equal(result.settings.custom_connections.connections[CONNECTION_ID], undefined);
    assert.equal(result.settings.custom_connection_keys[validConnection().credentialRef], undefined);
    assert.equal(result.settings.model_discovery[CONNECTION_ID], undefined);
    assert.equal(result.settings.experimental_model_preflight[targetConsent], undefined);
    assert.equal(result.settings.custom_connections.connections[other.id].label, 'Other Gateway');
    assert.equal(result.settings.custom_connection_keys[other.credentialRef], 'other-secret');
    assert.equal(result.settings.model_discovery[other.id].evidence.returnedCount, 1);
    assert.equal(result.settings.experimental_model_preflight[otherConsent], true);
});

test('custom discovery counts and warning are visible only for the exact current route revision', () => {
    const routeA = validConnection();
    const routeB = validConnection({ baseUrl: 'https://route-b.example', modelsPath: '/models-b' });
    const stateA = { evidence: {
        connectionId: CONNECTION_ID, revision: connectionRevision(routeA),
        returnedCount: 8, acceptedCount: 2, unresolvedCount: 1, rejectedCount: 5,
    }, warning: { code: 'DISCOVERY_PROVIDER_FAILED' } };
    assert.equal(projectCurrentCustomDiscoveryState(routeA, stateA).evidence.returnedCount, 8);
    assert.deepEqual(projectCurrentCustomDiscoveryState(routeB, stateA), {});
    const stateB = { evidence: {
        connectionId: CONNECTION_ID, revision: connectionRevision(routeB),
        returnedCount: 3, acceptedCount: 1, unresolvedCount: 0, rejectedCount: 2,
    } };
    assert.equal(projectCurrentCustomDiscoveryState(routeB, stateB).evidence.returnedCount, 3);
    assert.equal(projectCurrentCustomDiscoveryState(routeB, stateB).warning, undefined);
});

test('requires UUID connection and credential references and fixes protocol to openai-images', () => {
    for (const [name, patch] of [
        ['non-UUID id', { id: 'connection:mine' }],
        ['bare UUID id', { id: '123e4567-e89b-42d3-a456-426614174000' }],
        ['mismatched credential UUID', { credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174001' }],
        ['Gemini protocol', { protocol: 'gemini-compatible' }],
        ['arbitrary protocol', { protocol: 'openai-compatible' }],
    ]) {
        const result = validateCustomConnection(validConnection(patch));
        assert.equal(result.valid, false, name);
    }

    assert.equal(validateCustomConnection(validConnection({ credentialRef: null })).valid, true, 'no-auth is allowed');
});

test('rejects empty or overlong labels and accepts the 80-character boundary', () => {
    assert.equal(validateCustomConnection(validConnection({ label: '   ' })).valid, false);
    assert.equal(validateCustomConnection(validConnection({ label: 'x'.repeat(80) })).valid, true);
    assert.equal(validateCustomConnection(validConnection({ label: 'x'.repeat(81) })).valid, false);
});

test('accepts HTTPS origins and loopback-only HTTP origins', () => {
    for (const baseUrl of [
        'https://gateway.example',
        'http://localhost:8080',
        'http://127.0.0.1:1234',
        'http://[::1]:5000',
    ]) assert.equal(validateCustomConnection(validConnection({ baseUrl })).valid, true, baseUrl);

    for (const baseUrl of [
        'http://gateway.example',
        'http://192.168.1.10',
        'ftp://gateway.example',
        '//gateway.example',
        'https://user:secret@gateway.example',
        'https://gateway.example/root',
        'https://gateway.example?target=other',
        'https://gateway.example#fragment',
    ]) assert.equal(validateCustomConnection(validConnection({ baseUrl })).valid, false, baseUrl);

    assert.equal(validateCustomConnection(validConnection({ baseUrl: 'http://localhost:8080' })).localInsecure, true);
});

test('accepts safe relative-absolute paths and rejects path confusion and decoded traversal', () => {
    for (const path of ['/v1/models', '/api/image-models.v2', '/nested/a_b-c']) {
        assert.equal(validateCustomConnection(validConnection({ modelsPath: path })).valid, true, path);
    }

    for (const path of [
        '',
        'v1/models',
        '//evil.example/models',
        'https://evil.example/models',
        '/v1/../admin',
        '/v1/%2e%2e/admin',
        '/v1/%252e%252e/admin',
        `/v1/${encodeURIComponent(encodeURIComponent(encodeURIComponent(encodeURIComponent(encodeURIComponent('../')))))}admin`,
        `/v1/${'%25'.repeat(40)}2e%252e/admin`,
        '/v1/%E0%A4%A/admin',
        '/v1\\models',
        '/v1/models?redirect=https://evil.example',
        '/v1/models#fragment',
        '/v1/user@example.com',
        '/v1/models\u0000',
        '/v1/%0d%0aAuthorization:secret',
    ]) {
        assert.equal(validateCustomConnection(validConnection({ modelsPath: path })).valid, false, path);
        assert.equal(validateCustomConnection(validConnection({ generationPath: path })).valid, false, path);
    }
});

test('rejects arbitrary headers, templates, redirect settings, credentials, and unknown fields', () => {
    for (const patch of [
        { headers: { 'X-Api-Key': 'secret' } },
        { requestTemplate: '{"model":"{{model}}"}' },
        { responseSelector: '$.data[0].url' },
        { followRedirects: true },
        { redirect: 'follow' },
        { apiKey: 'sk-raw-secret' },
        { credential: 'sk-raw-secret' },
    ]) assert.equal(validateCustomConnection(validConnection(patch)).valid, false, Object.keys(patch)[0]);
});

test('computes a stable route revision that changes only when route authority changes', () => {
    const connection = validConnection();
    const revision = connectionRevision(connection);
    assert.match(revision, /^connection-revision:[a-f0-9]{16}$/);
    assert.equal(connectionRevision(structuredClone(connection)), revision);
    assert.equal(connectionRevision({ ...connection, label: 'Renamed' }), revision);
    assert.equal(connectionRevision({ ...connection, enabled: false }), revision);
    for (const patch of [
        { baseUrl: 'https://other.example' },
        { modelsPath: '/catalog' },
        { generationPath: '/generate' },
        { credentialRef: null },
    ]) assert.notEqual(connectionRevision({ ...connection, ...patch }), revision, JSON.stringify(patch));
});

test('migrates only valid records and clears evidence and confirmations for stale revisions', () => {
    const connection = validConnection();
    const revision = connectionRevision(connection);
    const migrated = migrateCustomConnections({
        schema: 1,
        connections: {
            [connection.id]: connection,
            'connection:unsafe': validConnection({ id: 'connection:unsafe', baseUrl: 'http://evil.example' }),
        },
        models: {
            [connection.id]: [{ id: 'gpt-image-1', label: 'GPT Image', connectionId: connection.id, transportId: 'openai-images' }],
        },
        evidence: {
            [connection.id]: { state: 'verified', revision, observedAt: '2026-08-31T12:00:00.000Z' },
            'connection:unsafe': { state: 'verified', revision: 'stale', observedAt: '2026-08-31T12:00:00.000Z' },
        },
        confirmations: {
            [connection.id]: { revision: 'stale', confirmedAt: '2026-08-31T12:01:00.000Z' },
        },
        rawCatalog: [{ id: 'must-not-survive' }],
    });

    assert.deepEqual(Object.keys(migrated.connections), [connection.id]);
    assert.equal(migrated.evidence[connection.id].revision, revision);
    assert.equal(migrated.confirmations[connection.id], undefined);
    assert.deepEqual(migrated.models[connection.id].map((model) => model.id), ['gpt-image-1']);
    assert.equal(Object.hasOwn(migrated, 'rawCatalog'), false);

    const edited = migrateCustomConnections({ ...migrated, connections: { [connection.id]: { ...connection, generationPath: '/v2/generate' } } });
    assert.equal(edited.evidence[connection.id], undefined);
});

test('projects a masked connection and sanitized method-bound route preview', () => {
    const connection = validConnection();
    const projected = safeConnectionProjection({ ...connection, apiKey: 'sk-never-project' });

    assert.deepEqual(projected.credential, { preset: 'bearer', masked: true });
    assert.equal(projected.credentialRef, undefined);
    assert.equal(projected.apiKey, undefined);
    assert.equal(JSON.stringify(projected).includes('sk-never-project'), false);
    assert.deepEqual(projected.routePreview, {
        catalog: { method: 'GET', url: 'https://gateway.example/v1/models' },
        generation: { method: 'POST', url: 'https://gateway.example/v1/images/generations' },
    });
});

test('provider settings migration keeps custom keys only behind valid credential references', () => {
    const connection = validConnection();
    const settings = migrateProviderSettings({
        custom_connections: { schema: 1, connections: { [connection.id]: connection } },
        custom_connection_keys: {
            [connection.credentialRef]: 'sk-browser-side-secret',
            'custom:orphan': 'must-drop',
        },
    });

    assert.deepEqual(Object.keys(settings.custom_connections.connections), [connection.id]);
    assert.deepEqual(settings.custom_connection_keys, { [connection.credentialRef]: 'sk-browser-side-secret' });
    assert.equal(JSON.stringify(settings.custom_connections).includes('sk-browser-side-secret'), false);
});

test('saving structural custom configuration is pure and invalidates edited route evidence', () => {
    let networkCalls = 0;
    const connection = validConnection();
    const revision = connectionRevision(connection);
    const store = migrateCustomConnections({
        connections: { [connection.id]: connection },
        evidence: { [connection.id]: { state: 'verified', revision, observedAt: '2026-08-31T12:00:00.000Z' } },
    });

    const saved = upsertCustomConnection(store, { ...connection, generationPath: '/v2/images' }, {
        onNetworkRequest: () => { networkCalls += 1; },
    });

    assert.equal(networkCalls, 0);
    assert.equal(saved.connections[connection.id].generationPath, '/v2/images');
    assert.equal(saved.evidence[connection.id], undefined);
});

test('successful catalog refresh preserves verified evidence only for the exact connection revision', () => {
    const connection = validConnection();
    const revision = connectionRevision(connection);
    const verified = { state: 'verified', revision, observedAt: '2026-08-31T12:00:00.000Z' };

    assert.deepEqual(nextCustomDiscoveryEvidence({
        connection,
        currentEvidence: verified,
        observedAt: '2026-08-31T13:00:00.000Z',
    }), verified);

    const edited = { ...connection, generationPath: '/v2/images' };
    assert.deepEqual(nextCustomDiscoveryEvidence({
        connection: edited,
        currentEvidence: verified,
        observedAt: '2026-08-31T13:00:00.000Z',
    }), {
        state: 'configured',
        revision: connectionRevision(edited),
        observedAt: '2026-08-31T13:00:00.000Z',
    });
});

test('migration projects current configured or verified evidence onto saved custom models', () => {
    const connection = validConnection();
    const revision = connectionRevision(connection);
    const store = migrateCustomConnections({
        connections: { [connection.id]: connection },
        models: { [connection.id]: [{ id: 'gpt-image-custom' }] },
        evidence: { [connection.id]: { state: 'configured', revision, observedAt: '2026-08-31T14:00:00.000Z' } },
    });

    assert.deepEqual(store.models[connection.id][0].routeEvidence, {
        state: 'configured', source: 'user-configured-protocol', observedAt: '2026-08-31T14:00:00.000Z',
        protocol: 'openai-images', requestShapeRevision: 'openai-images-v1', revision,
    });
    assert.equal(store.models[connection.id][0].endpoint, 'https://gateway.example/v1/images/generations');
    assert.deepEqual(store.models[connection.id][0].capabilities.imageGeneration, {
        state: 'unknown', source: 'heuristic', confidence: 'low',
    });
});

test('verified connection routing is separate from exact-model image capability evidence', () => {
    const connection = validConnection();
    const revision = connectionRevision(connection);
    const store = migrateCustomConnections({
        connections: { [connection.id]: connection },
        models: { [connection.id]: [{ id: 'image-success' }, { id: 'text-only-peer' }, { id: 'toString' }] },
        evidence: {
            [connection.id]: { state: 'verified', revision, observedAt: '2026-08-31T14:00:00.000Z' },
        },
        modelEvidence: {
            [connection.id]: {
                'image-success': { state: 'supported', revision, observedAt: '2026-08-31T14:05:00.000Z' },
            },
        },
    });

    const [succeeded, peer, inheritedName] = store.models[connection.id];
    assert.equal(succeeded.routeEvidence.state, 'verified');
    assert.deepEqual(succeeded.capabilities.imageGeneration, {
        state: 'supported', source: 'live-sanitized', confidence: 'high', observedAt: '2026-08-31T14:05:00.000Z',
    });
    assert.equal(peer.routeEvidence.state, 'verified');
    assert.deepEqual(peer.capabilities.imageGeneration, {
        state: 'unknown', source: 'heuristic', confidence: 'low',
    });
    assert.deepEqual(inheritedName.capabilities.imageGeneration, {
        state: 'unknown', source: 'heuristic', confidence: 'low',
    });
});

test('new unsaved connection ids do not fall back to an existing saved connection', () => {
    const saved = validConnection();
    const store = migrateCustomConnections({ connections: { [saved.id]: saved } });
    assert.equal(selectCustomConnection(store, 'connection:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), undefined);
    assert.deepEqual(selectCustomConnection(store, ''), store.connections[saved.id]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoSpendInterceptionGate, runControlledNoSpendUat } from './support/live-uat.mjs';
import { discoverCustomConnectionModels } from '../lib/providers/model-discovery.js';
import { createCustomConnectionId, migrateCustomConnections, removeCustomConnectionFromSettings, selectCustomConnection, upsertCustomConnection, validateCustomConnection } from '../lib/providers/custom-connections.js';

test('interception is installed before actions and allows only the exact catalog GET', async () => {
    const events = [];
    const originalFetch = async () => { throw new Error('original fetch must be replaced'); };
    const globalObject = { fetch: originalFetch };
    const gate = createNoSpendInterceptionGate({
        catalogUrl: 'https://fixture.invalid/v1/models',
        fetchImpl: async (url, init) => {
            events.push(`fetch:${init.method}:${url}`);
            return { ok: true, redirected: false, url, json: async () => ({ data: [{ id: 'fixture-image' }] }) };
        },
    });
    const result = await runControlledNoSpendUat({
        installInterception: () => { events.push('installed'); return gate; },
        globalObject,
        actions: async () => {
            events.push('actions');
            await globalObject.fetch('https://fixture.invalid/v1/models', { method: 'GET' });
        },
    });
    assert.deepEqual(events.slice(0, 2), ['installed', 'actions']);
    assert.equal(globalObject.fetch, originalFetch, 'global fetch is restored');
    assert.deepEqual(result.requests, [{ method: 'GET', urlClass: 'expected-catalog' }]);
});

test('direct global fetch and XHR cannot bypass the installed gate and originals restore after failure', async () => {
    const originalFetch = async () => ({ ok: true });
    class OriginalXhr { open() {} send() {} }
    const globalObject = { fetch: originalFetch, XMLHttpRequest: OriginalXhr };
    const gate = createNoSpendInterceptionGate({
        catalogUrl: 'https://fixture.invalid/v1/models',
        fetchImpl: async (url) => ({ ok: true, redirected: false, url }),
    });
    await assert.rejects(runControlledNoSpendUat({
        installInterception: () => gate,
        globalObject,
        actions: async () => globalObject.fetch('https://fixture.invalid/v1/images/generations', { method: 'POST' }),
    }), /blocked/i);
    assert.equal(globalObject.fetch, originalFetch);
    assert.equal(globalObject.XMLHttpRequest, OriginalXhr);

    await assert.rejects(runControlledNoSpendUat({
        installInterception: () => gate,
        globalObject,
        actions: async () => {
            const xhr = new globalObject.XMLHttpRequest();
            xhr.open('POST', 'https://fixture.invalid/v1/images/generations');
        },
    }), /blocked/i);
    assert.equal(globalObject.XMLHttpRequest, OriginalXhr);
});

test('no-spend gate rejects posts, generation paths, mismatched routes, and redirects', async () => {
    const allowed = 'https://fixture.invalid/v1/models';
    for (const [url, init] of [
        ['https://fixture.invalid/v1/models', { method: 'POST' }],
        ['https://fixture.invalid/v1/images/generations', { method: 'GET' }],
        ['https://other.invalid/v1/models', { method: 'GET' }],
    ]) {
        const gate = createNoSpendInterceptionGate({ catalogUrl: allowed, fetchImpl: async () => ({ ok: true, redirected: false }) });
        await assert.rejects(gate.fetch(url, init), /No-spend UAT blocked/);
    }
    const redirectGate = createNoSpendInterceptionGate({
        catalogUrl: allowed,
        fetchImpl: async () => ({ ok: true, redirected: true, url: 'https://other.invalid/v1/models' }),
    });
    await assert.rejects(redirectGate.fetch(allowed, { method: 'GET' }), /redirect/i);
    const manualRedirectGate = createNoSpendInterceptionGate({
        catalogUrl: allowed,
        fetchImpl: async (url) => ({ ok: false, status: 302, redirected: false, url }),
    });
    await assert.rejects(manualRedirectGate.fetch(allowed), /redirect/i);
});

test('no-spend gate permits plain HTTP only for controlled loopback fixtures', () => {
    assert.doesNotThrow(() => createNoSpendInterceptionGate({
        catalogUrl: 'http://127.0.0.1:43210/v1/models', fetchImpl: async () => ({ ok: true }),
    }));
    assert.throws(() => createNoSpendInterceptionGate({
        catalogUrl: 'http://fixture.invalid/v1/models', fetchImpl: async () => ({ ok: true }),
    }), /safe catalog URL/i);
});

test('request records retain only method and sanitized URL class', async () => {
    const gate = createNoSpendInterceptionGate({
        catalogUrl: 'https://fixture.invalid/v1/models',
        fetchImpl: async (url) => ({ ok: true, redirected: false, url }),
    });
    await gate.fetch('https://fixture.invalid/v1/models', { method: 'GET', headers: { Authorization: 'Bearer secret' } });
    await assert.rejects(gate.fetch('https://user:password@fixture.invalid/v1/models'), /credential/i);
    assert.doesNotMatch(JSON.stringify(gate.requests), /secret|authorization|bearer|fixture|models|user|password/i);
    assert.deepEqual(gate.requests, [
        { method: 'GET', urlClass: 'expected-catalog' },
        { method: 'GET', urlClass: 'credentialed-url' },
    ]);
});

test('controlled no-spend flow creates, validates, fetches, selects, and deletes one connection', async () => {
    const id = createCustomConnectionId(() => '123e4567-e89b-42d3-a456-426614174099');
    const connection = {
        schema: 1, id, label: 'Fixture Gateway', protocol: 'openai-images',
        baseUrl: 'https://fixture.invalid', modelsPath: '/v1/models',
        generationPath: '/v1/images/generations', credentialRef: null, enabled: true,
    };
    assert.equal(validateCustomConnection(connection).valid, true);
    let store = upsertCustomConnection({}, connection);
    const globalObject = { fetch: async () => { throw new Error('ungated fetch'); } };
    const gate = createNoSpendInterceptionGate({
        catalogUrl: 'https://fixture.invalid/v1/models',
        fetchImpl: async (url) => ({
            ok: true, status: 200, redirected: false, url,
            json: async () => ({ data: [{ id: 'fixture-image-model' }] }),
        }),
    });
    let discovery;
    await runControlledNoSpendUat({
        installInterception: () => gate, globalObject,
        actions: async () => {
            discovery = await discoverCustomConnectionModels({
                connection, authPreset: 'none', fetchImpl: globalObject.fetch,
                now: () => '2026-08-31T14:00:00.000Z',
            });
        },
    });
    store = migrateCustomConnections({
        ...store, models: { [id]: discovery.models },
        evidence: { [id]: { state: 'configured', revision: discovery.evidence.revision, observedAt: discovery.evidence.observedAt } },
    });
    assert.equal(selectCustomConnection(store, id).label, 'Fixture Gateway');
    assert.deepEqual(discovery.evidence, {
        kind: 'openai-list', source: 'custom connection /models endpoint', observedAt: '2026-08-31T14:00:00.000Z',
        retryCount: 0, returnedCount: 1, acceptedCount: 1, unresolvedCount: 0, rejectedCount: 0,
        connectionId: id, revision: discovery.evidence.revision,
    });
    const removed = removeCustomConnectionFromSettings({
        provider: id, model: 'fixture-image-model', custom_connection_editor_id: id,
        custom_connections: store, custom_connection_keys: {}, model_discovery: {}, experimental_model_preflight: {},
    }, id);
    assert.equal(removed.removed.id, id);
    assert.equal(removed.settings.custom_connections.connections[id], undefined);
    assert.deepEqual(gate.requests, [{ method: 'GET', urlClass: 'expected-catalog' }]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchProviderModels, discoverProviderModels, discoverCustomConnectionModels, createModelDiscoveryCoordinator, parseProviderCatalog } from '../lib/providers/model-discovery.js';
import { connectionRevision } from '../lib/providers/custom-connections.js';
import { getProviderDefinition } from '../lib/providers/registry.js';
import { mergeDiscoveryModelRecords, getDiscoveryRefreshMessage } from '../lib/providers/model-manager.js';

test('requests TokenReply standard models endpoint with the key only in the request header', async () => {
    const calls = [];
    const models = await fetchProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ data: [{ id: 'grok-imagine-image-quality' }] }), { status: 200 });
        },
    });

    assert.equal(calls[0].url, 'https://api.tokenreply.com/v1/models');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(models, [{ id: 'grok-imagine-image-quality', source: 'fetched' }]);
});

test('classifies curated LinkAPI image catalog records through their verified built-in routes', () => {
    const catalog = parseProviderCatalog({
        data: [
            { id: 'gemini-3.1-flash-image-preview' },
            { id: 'gpt-image-2-c' },
            { id: 'gpt-4.1' },
        ],
    }, getProviderDefinition('linkapi'));

    assert.equal(catalog.returnedCount, 3);
    assert.equal(catalog.accepted.length, 2);
    assert.equal(catalog.unresolved.length, 1);
    assert.equal(catalog.rejected.length, 0);
    assert.deepEqual(catalog.accepted.map((entry) => [entry.id, entry.transportId || entry.transport]), [
        ['gemini-3.1-flash-image-preview', 'sillyTavernGeminiProxy'],
        ['gpt-image-2-c', 'openAiImages'],
    ]);
});

test('rejects a failed model fetch without returning partial entries', async () => {
    await assert.rejects(
        fetchProviderModels({
            providerId: 'tokenreply',
            apiKey: 'test-key',
            fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Upstream unavailable' } }), { status: 503 }),
        }),
        /Provider model discovery failed/,
    );
});
test('preserves catalog outcome counts without retaining raw catalog records', async () => {
    const result = await discoverProviderModels({
        providerId: 'linkapi',
        apiKey: 'test-key',
        now: () => '2026-08-31T12:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }] }), { status: 200 }),
    });

    assert.deepEqual(result.models.map(model => model.id), ['gpt-4.1']);
    assert.equal(result.models[0].transportId, null);
    assert.deepEqual(result.evidence, {
        kind: 'openai-list',
        source: 'provider /models endpoint',
        observedAt: '2026-08-31T12:00:00.000Z',
        retryCount: 0,
        returnedCount: 1,
        acceptedCount: 0,
        unresolvedCount: 1,
        rejectedCount: 0,
    });
    assert.equal(Object.hasOwn(result.evidence, 'catalog'), false);
});

test('merges only non-empty accepted or unresolved discovery records', () => {
    const provider = getProviderDefinition('linkapi');
    const saved = [{ id: 'saved-model', source: 'manual', transport: 'openAiImages' }];
    const discovered = [{
        id: 'fresh-verified', transportId: 'openAiImages',
        routeEvidence: {
            state: 'verified', source: 'official-docs', observedAt: '2026-08-31T00:00:00.000Z',
            protocol: 'openai-images', requestShapeRevision: 'openai-images-v1',
        },
    }];
    const outcomes = [
        { name: 'accepted records', result: { models: discovered, evidence: { returnedCount: 1, acceptedCount: 1, unresolvedCount: 0, rejectedCount: 0 } }, expected: ['saved-model', 'fresh-verified'] },
        { name: 'empty response', result: { models: [], evidence: { returnedCount: 0, acceptedCount: 0, unresolvedCount: 0, rejectedCount: 0 } }, expected: ['saved-model'] },
        { name: 'fully filtered response', result: { models: [], evidence: { returnedCount: 3, acceptedCount: 0, unresolvedCount: 0, rejectedCount: 3 } }, expected: ['saved-model'] },
        { name: 'request failure', result: { models: discovered, warning: { code: 'DISCOVERY_NETWORK' }, evidence: { returnedCount: 0, acceptedCount: 0, unresolvedCount: 0, rejectedCount: 0 } }, expected: ['saved-model'] },
    ];

    for (const { name, result, expected } of outcomes) {
        assert.deepEqual(mergeDiscoveryModelRecords(saved, result, 'linkapi', provider).map((entry) => entry.id), expected, name);
    }
});

test('reports an unresolved-only TokenReply discovery as having no verified image route while retaining the record', () => {
    const result = {
        models: [{ id: 'gemini-2.5-flash-image', transportId: null, routeEvidence: { state: 'unverified' } }],
        evidence: { returnedCount: 1, acceptedCount: 0, unresolvedCount: 1, rejectedCount: 0 },
    };

    assert.deepEqual(getDiscoveryRefreshMessage(result), {
        level: 'warning',
        message: 'Catalog refreshed in Setup → Model: 0 with known image routes; 1 marked Unverified. Unverified entries need a documented protocol in a custom connection before generation.',
    });
    assert.deepEqual(mergeDiscoveryModelRecords([], result, 'tokenreply').map((entry) => entry.id), ['gemini-2.5-flash-image']);
});

test('returns a structured openai-list DiscoveryResult with evidence and observed time', async () => {
    const result = await discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        now: () => '2026-08-25T12:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'grok-imagine-image-quality' }] }), { status: 200 }),
    });

    assert.deepEqual(result.models.map(({ id }) => id), ['grok-imagine-image-quality']);
    assert.deepEqual(result.evidence, {
        kind: 'openai-list',
        observedAt: '2026-08-25T12:00:00.000Z',
        source: 'provider /models endpoint',
        retryCount: 0,
        returnedCount: 1,
        acceptedCount: 1,
        unresolvedCount: 0,
        rejectedCount: 0,
    });
    assert.equal(result.warning, undefined);
});

test('supports curated-static discovery without making a request', async () => {
    let requests = 0;
    const result = await discoverProviderModels({
        providerId: 'makersuite',
        now: () => '2026-08-25T12:00:00.000Z',
        fetchImpl: async () => { requests += 1; throw new Error('must not fetch'); },
    });

    assert.equal(requests, 0);
    assert.ok(result.models.some((model) => model.id === 'gemini-2.5-flash-image'));
    assert.equal(result.evidence.kind, 'curated-static');
    assert.equal(result.evidence.source, 'curated provider catalog');
    assert.equal(result.evidence.retryCount, 0);
});

test('supports native discovery through an injected parser seam', async () => {
    const result = await discoverProviderModels({
        provider: {
            id: 'native-test',
            discovery: { kind: 'native', endpoint: '/models', transportId: 'native', parserId: 'native-test', retryable: true },
            transports: { native: { baseUrl: 'https://example.test/v1' } },
            models: [],
        },
        providerId: 'native-test',
        apiKey: 'test-key',
        now: () => '2026-08-25T12:00:00.000Z',
        nativeParsers: {
            'native-test': (json) => [{ id: json.models[0].name, label: 'Native Image' }],
        },
        fetchImpl: async () => new Response(JSON.stringify({ models: [{ name: 'native-image-v1' }] }), { status: 200 }),
    });

    assert.deepEqual(result.models.map(({ id, label }) => ({ id, label })), [{ id: 'native-image-v1', label: 'Native Image' }]);
    assert.equal(result.evidence.kind, 'native');
});

test('returns an unsupported warning without making a request', async () => {
    let requests = 0;
    const result = await discoverProviderModels({
        provider: { id: 'unsupported-test', discovery: { kind: 'unsupported', reason: 'Available after server adapter.' }, models: [] },
        providerId: 'unsupported-test',
        fetchImpl: async () => { requests += 1; throw new Error('must not fetch'); },
    });

    assert.equal(requests, 0);
    assert.deepEqual(result.models, []);
    assert.deepEqual(result.warning, { code: 'DISCOVERY_UNSUPPORTED', userMessage: 'Model discovery is not available for this provider.' });
    assert.equal(result.evidence.kind, 'unsupported');
});

test('retries only retryable GET failures at most twice with bounded delays', async () => {
    let calls = 0;
    const delays = [];
    const result = await discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        now: () => '2026-08-25T12:00:00.000Z',
        sleep: async (delay) => delays.push(delay),
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) return new Response('', { status: 503 });
            return new Response(JSON.stringify({ data: [{ id: 'grok-imagine-image' }] }), { status: 200 });
        },
    });

    assert.equal(calls, 3);
    assert.equal(result.evidence.retryCount, 2);
    assert.equal(delays.length, 2);
    assert.ok(delays[1] >= delays[0]);
    assert.ok(delays.every((delay) => delay <= 2000));
});

test('does not retry authentication or other client failures', async () => {
    let calls = 0;
    const result = await discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        fetchImpl: async () => { calls += 1; return new Response('no', { status: 401 }); },
    });
    assert.equal(calls, 1);
    assert.equal(result.warning.code, 'DISCOVERY_AUTH_FAILED');
});

test('normalizes discovery warnings to stable safe messages and redacts echoed secrets and payloads', async () => {
    const result = await discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        fetchImpl: async () => new Response(JSON.stringify({
            error: {
                message: 'Bearer sk-live-123456789 echoed prompt: draw this scene data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            },
        }), { status: 401 }),
    });
    assert.deepEqual(result.warning, {
        code: 'DISCOVERY_AUTH_FAILED',
        userMessage: 'TokenReply rejected the API key. Check it in extension settings.',
    });
    assert.doesNotMatch(result.warning.userMessage, /sk-live|Bearer|draw this scene|base64/i);
});

test('does not retry thrown authentication or validation errors without an HTTP status', async () => {
    for (const thrown of [new Error('invalid api key sk-live-123456789'), new Error('invalid model name')]) {
        let calls = 0;
        let delays = 0;
        const result = await discoverProviderModels({
            providerId: 'tokenreply',
            apiKey: 'test-key',
            sleep: async () => { delays += 1; },
            fetchImpl: async () => { calls += 1; throw thrown; },
        });
        assert.equal(calls, 1);
        assert.equal(delays, 0);
        assert.match(result.warning.code, /^DISCOVERY_(AUTH_FAILED|FAILED)$/);
        assert.doesNotMatch(result.warning.userMessage, /sk-live|invalid api key|invalid model/i);
    }
});

test('reports retry count when a retryable request ultimately fails', async () => {
    const result = await discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        sleep: async () => {},
        fetchImpl: async () => new Response('', { status: 503 }),
    });
    assert.equal(result.warning.code, 'DISCOVERY_PROVIDER_FAILED');
    assert.equal(result.evidence.retryCount, 2);
});

test('aborts retry delay and fetch when signal is aborted', async () => {
    const controller = new AbortController();
    const delays = [];
    const pending = discoverProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        signal: controller.signal,
        sleep: async (_delay, signal) => await new Promise((resolve) => {
            delays.push(signal);
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', resolve, { once: true });
        }),
        fetchImpl: async () => new Response('', { status: 503 }),
    });
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === 'AbortError');
    assert.equal(delays.length, 1);
});

test('stale and duplicate refreshes cannot overwrite the current operation', async () => {
    const coordinator = createModelDiscoveryCoordinator();
    let resolveFirst;
    const first = coordinator.refresh('tokenreply', {
        apiKey: 'test-key',
        fetchImpl: () => new Promise((resolve) => { resolveFirst = resolve; }),
    });
    const duplicate = coordinator.refresh('tokenreply', { apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    assert.notEqual(duplicate, first);
    resolveFirst(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await first;
    assert.equal(result.stale, true);
});

test('allows a fresh refresh after cancellation while the old result is stale', async () => {
    const coordinator = createModelDiscoveryCoordinator();
    let resolveFirst;
    let resolveSecond;
    const first = coordinator.refresh('tokenreply', { apiKey: 'test-key', fetchImpl: () => new Promise((resolve) => { resolveFirst = resolve; }) });
    coordinator.cancel('tokenreply');
    const second = coordinator.refresh('tokenreply', { apiKey: 'test-key', fetchImpl: () => new Promise((resolve) => { resolveSecond = resolve; }) });
    resolveFirst(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    resolveSecond(new Response(JSON.stringify({ data: [{ id: 'grok-imagine-image' }] }), { status: 200 }));
    assert.equal((await first).stale, true);
    assert.equal((await second).models[0].id, 'grok-imagine-image');
});

test('coordinator aborts a custom refresh when its provider is cancelled', async () => {
    const coordinator = createModelDiscoveryCoordinator();
    assert.equal(typeof coordinator.refreshCustom, 'function');
    let observedSignal;
    const pending = coordinator.refreshCustom(customConnection.id, {
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'test-key',
        fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
            observedSignal = init.signal;
            const fail = () => {
                const error = new Error('cancelled');
                error.name = 'AbortError';
                reject(error);
            };
            if (init.signal.aborted) fail();
            else init.signal.addEventListener('abort', fail, { once: true });
        }),
    });

    assert.equal(coordinator.cancel(customConnection.id), true);
    assert.equal(observedSignal.aborted, true);
    assert.equal((await pending).stale, true);
    assert.equal(coordinator.isActive(customConnection.id), false);
});

test('keeps Refresh Models and model search in the main Setup flow while manual IDs remain optional', async () => {
    const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(settings, /id="cig_model_refresh"/);
    assert.match(settings, /id="cig_model_search"/);
    assert.match(settings, /id="cig_model_discovery_status"/);
    assert.match(settings, /<details id="cig_model_manager"[\s\S]*?<summary>Enter a model ID<\/summary>/);
    assert.match(settings, /id="cig_show_all_models"/);
    assert.match(settings, /id="cig_model_method_container"/);
    assert.doesNotMatch(settings, /id="cig_managed_model_list"/);
    assert.doesNotMatch(settings, /cig_fetch_provider_models/);
    assert.match(index, /#cig_model_refresh/);
    assert.match(index, /#cig_model_search/);
    assert.doesNotMatch(index, /#cig_fetch_provider_models/);
    assert.match(index, /modelDiscoveryCoordinator\.cancel/);
});

const customConnection = {
    schema: 1,
    id: 'connection:123e4567-e89b-42d3-a456-426614174000',
    label: 'Private Gateway',
    protocol: 'openai-images',
    baseUrl: 'https://gateway.example',
    modelsPath: '/catalog/models',
    generationPath: '/api/images/create',
    credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174000',
    enabled: true,
};

test('custom discovery performs one validated GET with Bearer auth and returns configured connection routes', async () => {
    const calls = [];
    const result = await discoverCustomConnectionModels({
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'sk-test-secret',
        now: () => '2026-08-31T14:00:00.000Z',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ data: [{ id: 'gpt-image-custom', owned_by: 'private' }] }), { status: 200 });
        },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gateway.example/catalog/models');
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/json', Authorization: 'Bearer sk-test-secret' });
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual(result.models.map((model) => ({
        id: model.id,
        providerId: model.providerId,
        connectionId: model.connectionId,
        transportId: model.transportId,
        endpoint: model.endpoint,
        routeEvidence: model.routeEvidence,
    })), [{
        id: 'gpt-image-custom',
        providerId: customConnection.id,
        connectionId: customConnection.id,
        transportId: 'openai-images',
        endpoint: 'https://gateway.example/api/images/create',
        routeEvidence: {
            state: 'configured',
            source: 'user-configured-protocol',
            observedAt: '2026-08-31T14:00:00.000Z',
            protocol: 'openai-images',
            requestShapeRevision: 'openai-images-v1',
            revision: connectionRevision(customConnection),
        },
    }]);
    assert.deepEqual(result.evidence, {
        kind: 'openai-list',
        source: 'custom connection /models endpoint',
        observedAt: '2026-08-31T14:00:00.000Z',
        retryCount: 0,
        returnedCount: 1,
        acceptedCount: 1,
        unresolvedCount: 0,
        rejectedCount: 0,
        connectionId: customConnection.id,
        revision: connectionRevision(customConnection),
    });
    assert.equal(JSON.stringify(result).includes('sk-test-secret'), false);
    assert.equal(JSON.stringify(result).includes('owned_by'), false);
});

test('custom discovery omits authorization for the none preset', async () => {
    const calls = [];
    await discoverCustomConnectionModels({
        connection: { ...customConnection, credentialRef: null },
        authPreset: 'none',
        credential: '',
        fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: [] }), { status: 200 }); },
    });
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
});

test('successful custom catalog refresh preserves verified routes for the same revision', async () => {
    const revision = connectionRevision(customConnection);
    const result = await discoverCustomConnectionModels({
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'sk-test-secret',
        existingEvidence: { state: 'verified', revision, observedAt: '2026-08-31T13:00:00.000Z' },
        now: () => '2026-08-31T14:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'gpt-image-refreshed' }] }), { status: 200 }),
    });

    assert.equal(result.models[0].routeEvidence.state, 'verified');
    assert.equal(result.models[0].routeEvidence.revision, revision);
    assert.equal(result.models[0].routeEvidence.observedAt, '2026-08-31T13:00:00.000Z');
    assert.deepEqual(result.models[0].capabilities.imageGeneration, {
        state: 'unknown', source: 'heuristic', confidence: 'low',
    });
});

test('mixed custom catalogs never treat catalog presence or image-like names as image capability proof', async () => {
    const result = await discoverCustomConnectionModels({
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'sk-test-secret',
        existingEvidence: {
            state: 'verified',
            revision: connectionRevision(customConnection),
            observedAt: '2026-08-31T13:00:00.000Z',
        },
        now: () => '2026-08-31T14:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({
            data: [{ id: 'chat-only-model' }, { id: 'gpt-image-looking-name' }],
        }), { status: 200 }),
    });

    assert.deepEqual(result.models.map(({ id, capabilities, routeEvidence }) => ({
        id,
        imageGeneration: capabilities.imageGeneration,
        routeState: routeEvidence.state,
    })), [
        {
            id: 'chat-only-model',
            imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' },
            routeState: 'verified',
        },
        {
            id: 'gpt-image-looking-name',
            imageGeneration: { state: 'unknown', source: 'heuristic', confidence: 'low' },
            routeState: 'verified',
        },
    ]);
});

test('custom discovery keeps saved models on empty, error, redirect, or invalid auth preset', async () => {
    const savedModels = [{ id: 'saved-image', connectionId: customConnection.id, transportId: 'openai-images' }];
    const cases = [
        ['empty', async () => new Response(JSON.stringify({ data: [] }), { status: 200 }), 'bearer'],
        ['error', async () => new Response('private upstream payload', { status: 503 }), 'bearer'],
        ['redirect', async () => ({ ok: true, status: 200, redirected: true, url: 'https://evil.example/models', json: async () => ({ data: [{ id: 'wrong' }] }) }), 'bearer'],
        ['invalid auth preset', async () => { throw new Error('must not fetch'); }, 'custom-header'],
    ];

    for (const [name, fetchImpl, authPreset] of cases) {
        let calls = 0;
        const result = await discoverCustomConnectionModels({
            connection: customConnection,
            authPreset,
            credential: 'sk-test-secret',
            savedModels,
            fetchImpl: async (...args) => { calls += 1; return fetchImpl(...args); },
        });
        assert.deepEqual(result.models.map((model) => model.id), ['saved-image'], name);
        assert.ok(result.warning, name);
        assert.equal(Object.hasOwn(result, 'rawPayload'), false, name);
        assert.equal(JSON.stringify(result).includes('private upstream payload'), false, name);
        assert.equal(calls, name === 'invalid auth preset' ? 0 : 1, name);
    }
});

test('custom discovery distinguishes browser CORS or private-network blocking from provider HTTP failure', async () => {
    const browserBlocked = await discoverCustomConnectionModels({
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'sk-test-secret',
        fetchImpl: async () => { throw new TypeError('Failed to fetch private internal detail'); },
    });
    assert.equal(browserBlocked.warning.code, 'DISCOVERY_BROWSER_BLOCKED');
    assert.match(browserBlocked.warning.userMessage, /CORS/i);
    assert.match(browserBlocked.warning.userMessage, /private-network/i);
    assert.equal(JSON.stringify(browserBlocked).includes('private internal detail'), false);

    const providerFailure = await discoverCustomConnectionModels({
        connection: customConnection,
        authPreset: 'bearer',
        credential: 'sk-test-secret',
        fetchImpl: async () => new Response('', { status: 503 }),
    });
    assert.equal(providerFailure.warning.code, 'DISCOVERY_PROVIDER_FAILED');
    assert.doesNotMatch(providerFailure.warning.userMessage, /CORS|private-network/i);
});

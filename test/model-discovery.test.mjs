import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchProviderModels, discoverProviderModels, createModelDiscoveryCoordinator } from '../lib/providers/model-discovery.js';

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

test('filters LinkAPI discovery to image model IDs', async () => {
    const models = await fetchProviderModels({
        providerId: 'linkapi',
        apiKey: 'test-key',
        fetchImpl: async () => new Response(JSON.stringify({
            data: [{ id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'gpt-4.1' }],
        }), { status: 200 }),
    });

    assert.deepEqual(models, [
        { id: 'gpt-image-1', source: 'fetched' },
        { id: 'dall-e-3', source: 'fetched' },
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
test('filters TokenReply discovery to Grok image model IDs', async () => {
    const models = await fetchProviderModels({
        providerId: 'tokenreply',
        apiKey: 'test-key',
        fetchImpl: async () => new Response(JSON.stringify({
            data: [{ id: 'grok-imagine-image' }, { id: 'gpt-4o' }],
        }), { status: 200 }),
    });

    assert.deepEqual(models, [{ id: 'grok-imagine-image', source: 'fetched' }]);
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

test('keeps Refresh Models beside the selector while Manage Models stays advanced', async () => {
    const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(settings, /id="cig_model_refresh"/);
    assert.match(settings, /id="cig_model_search"/);
    assert.match(settings, /id="cig_model_discovery_status"/);
    assert.match(settings, /<details id="cig_model_manager"/);
    assert.doesNotMatch(settings, /cig_fetch_provider_models/);
    assert.match(index, /#cig_model_refresh/);
    assert.match(index, /#cig_model_search/);
    assert.doesNotMatch(index, /#cig_fetch_provider_models/);
    assert.match(index, /modelDiscoveryCoordinator\.cancel/);
});

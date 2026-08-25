import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../lib/providers/model-discovery.js';

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
        /503.*Upstream unavailable/,
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

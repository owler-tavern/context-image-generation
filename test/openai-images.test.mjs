import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAiImagesRequest, parseOpenAiImagesResponse } from '../lib/providers/openai-images.js';
import { getModelDefinition } from '../lib/providers/registry.js';

test('omits size when a model has no verified size contract', () => {
    assert.deepEqual(
        buildOpenAiImagesRequest({ model: 'grok-imagine-image', prompt: 'scene', responseFormat: 'b64_json' }),
        { model: 'grok-imagine-image', prompt: 'scene', n: 1, response_format: 'b64_json' },
    );
});

test('accepts either base64 or URL response shapes', () => {
    assert.deepEqual(parseOpenAiImagesResponse({ data: [{ b64_json: 'abc' }] }), { b64: 'abc', url: null });
    assert.deepEqual(parseOpenAiImagesResponse({ data: [{ url: 'https://example.test/image.png' }] }), { b64: null, url: 'https://example.test/image.png' });
});

test('TokenReply Grok uses the adapter payload without an assumed size or resolution', () => {
    const model = getModelDefinition('tokenreply', 'grok-imagine-image');
    assert.equal(model.status, 'experimental');
    assert.deepEqual(
        buildOpenAiImagesRequest({ model: model.id, prompt: 'scene', responseFormat: 'b64_json' }),
        { model: 'grok-imagine-image', prompt: 'scene', n: 1, response_format: 'b64_json' },
    );
});
test('unlisted LinkAPI image-like IDs never become executable fallback models', () => {
    for (const modelId of ['gpt-image-1', 'dall-e-3']) {
        assert.equal(getModelDefinition('linkapi', modelId), undefined, modelId);
    }
    const curated = getModelDefinition('linkapi', 'gpt-image-2-c');
    assert.equal(curated.id, 'gpt-image-2-c');
    assert.equal(curated.routeEvidence.state, 'verified');
});

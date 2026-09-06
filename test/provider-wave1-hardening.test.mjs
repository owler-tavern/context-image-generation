import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOpenAiImagesRequest } from '../lib/providers/openai-images.js';
import { parseNanoGptDetailedCatalog, parsePollinationsImageModels, parseOpenAiList } from '../lib/providers/model-discovery.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';

test('OpenAI Images omits size, n, and response_format unless plan capabilities positively evidence them', () => {
    assert.deepEqual(buildOpenAiImagesRequest({
        model: 'routeway-image',
        prompt: 'scene',
        size: '1536x1024',
        responseFormat: 'b64_json',
        capabilities: {
            sizes: { state: 'unknown', source: 'heuristic' },
            multipleOutputs: { state: 'unknown', source: 'heuristic' },
            responseFormat: { state: 'unknown', source: 'heuristic' },
        },
    }), { model: 'routeway-image', prompt: 'scene' });
});

test('OpenAI Images emits optional fields only for positively evidenced capabilities', () => {
    assert.deepEqual(buildOpenAiImagesRequest({
        model: 'documented-image',
        prompt: 'scene',
        size: '1536x1024',
        responseFormat: 'b64_json',
        capabilities: {
            sizes: { state: 'supported', source: 'official-docs', confidence: 'high' },
            multipleOutputs: { state: 'supported', source: 'official-docs', confidence: 'high' },
            responseFormat: { state: 'supported', source: 'official-docs', confidence: 'high' },
        },
    }), { model: 'documented-image', prompt: 'scene', size: '1536x1024', n: 1, response_format: 'b64_json' });
});

test('NanoGPT detailed catalog does not promote architecture image inputs or speculative n support', () => {
    const entries = parseNanoGptDetailedCatalog({ data: [{
        id: 'nano-image',
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
        capabilities: { image_to_image: true },
        supported_parameters: ['n', 'size'],
    }] });
    assert.deepEqual(entries, [{ id: 'nano-image', label: 'nano-image', transport: 'openAiImages', capabilities: {
        imageGeneration: { state: 'supported', source: 'official-docs', confidence: 'high' },
    } }]);
});

test('Pollinations catalog excludes explicit video/non-image entries and keeps missing modality evidence unknown', () => {
    assert.deepEqual(parsePollinationsImageModels([
        { id: 'flux', type: 'image', modalities: ['text', 'image'] },
        { id: 'video-model', type: 'video', modalities: ['text', 'video'] },
        { id: 'text-model', type: 'text', modalities: ['text'] },
        { id: 'unclassified-model' },
    ]), [
        { id: 'flux', label: 'flux', transport: 'openAiImages', capabilities: { imageGeneration: { state: 'supported', source: 'official-docs', confidence: 'high' } } },
        { id: 'unclassified-model', label: 'unclassified-model', transport: 'openAiImages', capabilities: {} },
    ]);
});

test('Routeway image-capable discovery requires explicit output image metadata', () => {
    assert.deepEqual(parseOpenAiList({ data: [
        { id: 'flux-without-metadata' },
        { id: 'image-explicit', output_modalities: ['text', 'image'] },
    ] }, 'image-capable'), [{ id: 'image-explicit', source: 'fetched' }]);
});

test('future-server and unresolved providers fail before dispatch can reach host/default transport', async () => {
    for (const providerId of ['not-registered']) {
        const plan = createGenerationPlan({
            id: `hardening:${providerId}`,
            invocation: 'wand',
            resolved: { providerId, modelId: 'image', transportId: 'host-chat-image', capabilities: {} },
            prompt: { sourceMessage: 'scene' },
        });
        let called = false;
        await assert.rejects(dispatchProviderRoute({
            plan,
            connection: { id: `${providerId}:default`, providerId, kind: 'browser-api-key', enabled: true },
            signal: new AbortController().signal,
            transportContext: { fetchImpl: async () => { called = true; throw new Error('host dispatch must not run'); } },
        }), /unavailable|future.server|unresolved|provider/i);
        assert.equal(called, false, providerId);
    }
});

test('unavailable provider metadata remains available to the active-connection Setup flow', async () => {
    const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(settings, /id="cig_provider"/);
    assert.match(settings, /id="cig_model_note"/);
    assert.match(settings, /id="cig_setup_status"/);
    assert.match(settings, /id="cig_connection_editor"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { createTransportRegistry, dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { decodeGenerationArtifact } from '../lib/providers/artifact-decoder.js';
import { downloadImageData } from '../lib/providers/safe-image-download.js';

const plan = (transportId = 'openai-images') => createGenerationPlan({
    id: 'residual', invocation: 'wand', resolved: { providerId: 'fixture', modelId: 'image-1', transportId, endpoint: 'https://fixture.example/v1' },
    prompt: { sourceMessage: 'scene' },
});

test('OpenAI callback artifacts pass through the shared decoder', async () => {
    const transports = createTransportRegistry();
    const fakePng = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    transports.register({ id: 'openai-images', generate: async () => ({ imageData: Buffer.from(fakePng).toString('base64'), mimeType: 'image/png' }) });
    const result = await dispatchProviderRoute({ plan: plan(), connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key' }, signal: new AbortController().signal, transportContext: { transports } });
    assert.equal(result.mimeType, 'image/png');
});

test('invalid normalized callback artifacts are rejected instead of bypassing validation', async () => {
    const transports = createTransportRegistry();
    transports.register({ id: 'openai-images', generate: async () => ({ imageData: 'not-an-image', mimeType: 'image/png' }) });
    await assert.rejects(dispatchProviderRoute({ plan: plan(), connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key' }, signal: new AbortController().signal, transportContext: { transports } }), /base64|magic|image/i);
});

test('percent-encoded data URLs are bounded before URI decoding', async () => {
    await assert.rejects(decodeGenerationArtifact(`data:image/png,${'%41'.repeat(16)}`, { maxBytes: 4 }), /encoded|size limit/i);
});

test('safe downloader fails closed when no bounded streaming reader exists', async () => {
    await assert.rejects(downloadImageData('https://fixture.example/image.png', {
        fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new ArrayBuffer(8) }),
    }), /stream|bounded|body/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGenerationArtifact } from '../lib/providers/artifact-decoder.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const pngDataUrl = `data:image/png;base64,${PNG}`;

test('artifact decoder normalizes data URLs, OpenAI b64_json, and Gemini inlineData', async () => {
    const data = await decodeGenerationArtifact(pngDataUrl);
    assert.equal(data.mimeType, 'image/png');
    assert.equal(data.imageData, PNG);
    assert.deepEqual(await decodeGenerationArtifact({ b64_json: PNG, mimeType: 'image/png' }), data);
    assert.deepEqual(await decodeGenerationArtifact({ inlineData: { data: PNG, mimeType: 'image/png' } }), data);
});

test('artifact decoder checks abort and rejects invalid or oversized encoded payloads before decoding', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(decodeGenerationArtifact(pngDataUrl, { signal: controller.signal }), (error) => error.name === 'AbortError');
    await assert.rejects(decodeGenerationArtifact('data:image/png,%E0%A4%A'), /invalid image data/i);
    await assert.rejects(decodeGenerationArtifact({ b64_json: '%%%not-base64%%%', mimeType: 'image/png' }), /base64/i);
    await assert.rejects(decodeGenerationArtifact({ b64_json: 'A'.repeat(14 * 1024 * 1024), mimeType: 'image/png' }), /encoded payload/i);
});

test('artifact decoder rejects inline MIME and magic-byte mismatches', async () => {
    await assert.rejects(decodeGenerationArtifact({ inlineData: { data: PNG, mimeType: 'image/jpeg' } }), /magic|mime/i);
});

test('artifact decoder validates downloaded URL artifacts through the bounded downloader', async () => {
    await assert.rejects(decodeGenerationArtifact('https://images.example/result.png', {
        fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
    }), /magic|image/i);
});

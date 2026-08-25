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

test('artifact decoder accepts a valid 4K-class inline image larger than 10 MiB', async () => {
    const bytes = new Uint8Array((10 * 1024 * 1024) + 1);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const encoded = Buffer.from(bytes).toString('base64');

    const decoded = await decodeGenerationArtifact({
        inlineData: { data: encoded, mimeType: 'image/png' },
    });

    assert.equal(decoded.bytes, bytes.byteLength);
    assert.equal(decoded.mimeType, 'image/png');
});

test('artifact decoder checks abort and rejects invalid or oversized encoded payloads before decoding', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(decodeGenerationArtifact(pngDataUrl, { signal: controller.signal }), (error) => error.name === 'AbortError');
    await assert.rejects(decodeGenerationArtifact('data:image/png,%E0%A4%A'), /invalid image data/i);
    await assert.rejects(decodeGenerationArtifact({ b64_json: '%%%not-base64%%%', mimeType: 'image/png' }), /base64/i);
    await assert.rejects(decodeGenerationArtifact({ b64_json: PNG, mimeType: 'image/png' }, { maxBytes: 8 }), /encoded payload/i);
});

test('artifact decoder rejects inline MIME and magic-byte mismatches', async () => {
    await assert.rejects(decodeGenerationArtifact({ inlineData: { data: PNG, mimeType: 'image/jpeg' } }), /magic|mime/i);
});

test('artifact decoder validates downloaded URL artifacts through the bounded downloader', async () => {
    await assert.rejects(decodeGenerationArtifact('https://images.example/result.png', {
        fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: Uint8Array.from([1, 2, 3]) }; }, releaseLock() {} }; } } }),
    }), /magic|image/i);
});

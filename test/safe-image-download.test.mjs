import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadImageData } from '../lib/providers/safe-image-download.js';

function response(body, headers = { 'content-type': 'image/png' }, status = 200) {
    const bytes = new Uint8Array(body);
    let consumed = false;
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        body: { getReader() { return { async read() { if (consumed) return { done: true }; consumed = true; return { done: false, value: bytes }; }, releaseLock() {} }; } },
        arrayBuffer: async () => body,
        text: async () => String(body),
    };
}

test('safe image download accepts HTTPS images and forwards AbortSignal', async () => {
    let signal;
    const result = await downloadImageData('https://images.example/a.png', {
        signal: (signal = new AbortController().signal),
        fetchImpl: async (_url, options) => { assert.equal(typeof options.signal?.aborted, 'boolean'); return response(new Uint8Array([1, 2, 3]).buffer); },
    });
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.bytes, 3);
});

test('safe image download checks abort before decoding a data URL', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(downloadImageData('data:image/png;base64,aGVsbG8=', { signal: controller.signal }), (error) => error.name === 'AbortError');
});

test('safe image downloader does not independently accept data URLs', async () => {
    await assert.rejects(downloadImageData('data:image/png;base64,aGVsbG8='), /HTTPS|data|decoder/i);
});

test('safe image download rejects non-HTTPS URLs, non-images, and oversized responses', async () => {
    await assert.rejects(downloadImageData('http://images.example/a.png'), /HTTPS/);
    await assert.rejects(downloadImageData('https://images.example/a.txt', { fetchImpl: async () => response(new ArrayBuffer(1), { 'content-type': 'text/plain' }) }), /image content/);
    await assert.rejects(downloadImageData('https://images.example/a.png', { maxBytes: 2, fetchImpl: async () => response(new Uint8Array([1, 2, 3]).buffer) }), /size limit/);
});

test('safe image download follows only bounded HTTPS redirects', async () => {
    let calls = 0;
    await assert.rejects(downloadImageData('https://images.example/a.png', {
        maxRedirects: 1,
        fetchImpl: async () => { calls += 1; return { ok: false, status: 302, headers: new Headers({ location: 'https://images.example/b.png' }) }; },
    }), /redirect limit/);
    assert.equal(calls, 2);
});

test('safe image download aborts a fetch that exceeds its timeout', async () => {
    const pending = downloadImageData('https://images.example/slow.png', { timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) });
    const result = await Promise.race([pending.then(() => null, (error) => error), new Promise((resolve) => setTimeout(() => resolve(new Error('test timeout')), 50))]);
    assert.equal(result?.name, 'AbortError');
});

test('safe image download enforces the byte cap while reading a streaming body', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    await assert.rejects(downloadImageData('https://images.example/stream.png', {
        maxBytes: 3,
        fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: { getReader() { return { async read() { return chunks.length ? { done: false, value: chunks.shift() } : { done: true }; }, releaseLock() {} }; } } }),
    }), /size limit/i);
});

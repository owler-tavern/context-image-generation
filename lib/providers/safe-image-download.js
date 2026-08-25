const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    if (typeof btoa === 'function') return btoa(binary);
    return Buffer.from(bytes).toString('base64');
}

function decodeDataUrl(rawUrl, maxBytes) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/su.exec(rawUrl);
    if (!match) throw new TypeError('Invalid data image URL.');
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith('image/')) throw new TypeError('image content is required.');
    let bytes;
    if (match[2]) {
        const value = match[3].replace(/\s/gu, '');
        if (typeof atob === 'function') {
            const binary = atob(value);
            bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        } else bytes = new Uint8Array(Buffer.from(value, 'base64'));
    } else bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    if (bytes.byteLength > maxBytes) throw new RangeError('Image exceeds the size limit.');
    return { imageData: bytesToBase64(bytes), mimeType, bytes: bytes.byteLength };
}

function makeSignal(signal, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        signal: controller.signal,
        cleanup() {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        },
    };
}

function headerValue(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    return headers[name] || headers[name.toLowerCase()] || '';
}

function awaitWithAbort(promise, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const onAbort = () => { signal?.removeEventListener('abort', onAbort); reject(abortError()); };
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then((value) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}


export async function downloadImageData(rawUrl, {
    fetchImpl = fetch,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
    if (typeof rawUrl !== 'string' || !rawUrl) throw new TypeError('Image URL is required.');
    if (rawUrl.startsWith('data:')) return decodeDataUrl(rawUrl, maxBytes);
    let currentUrl;
    try { currentUrl = new URL(rawUrl); } catch { throw new TypeError('Image URL must use HTTPS.'); }
    if (currentUrl.protocol !== 'https:') throw new TypeError('Image URL must use HTTPS.');
    const request = makeSignal(signal, timeoutMs);
    try {
        for (let redirectCount = 0; ; redirectCount += 1) {
            throwIfAborted(request.signal);
            const response = await awaitWithAbort(fetchImpl(currentUrl.toString(), { method: 'GET', redirect: 'manual', signal: request.signal }), request.signal);
            const status = Number(response?.status) || 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
                if (redirectCount >= maxRedirects) throw new RangeError('Image redirect limit exceeded.');
                const location = headerValue(response.headers, 'location');
                if (!location) throw new Error('Image redirect did not include a location.');
                currentUrl = new URL(location, currentUrl);
                if (currentUrl.protocol !== 'https:') throw new TypeError('Image redirect must use HTTPS.');
                continue;
            }
            if (!response?.ok) throw new Error(`Failed to download generated image: HTTP ${status}`);
            const mimeType = headerValue(response.headers, 'content-type').split(';', 1)[0].trim().toLowerCase();
            if (!mimeType.startsWith('image/')) throw new TypeError('image content is required.');
            const contentLength = Number(headerValue(response.headers, 'content-length'));
            if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new RangeError('Image exceeds the size limit.');
            const buffer = await awaitWithAbort(response.arrayBuffer(), request.signal);
            throwIfAborted(request.signal);
            if (buffer.byteLength > maxBytes) throw new RangeError('Image exceeds the size limit.');
            const bytes = new Uint8Array(buffer);
            return { imageData: bytesToBase64(bytes), mimeType, bytes: bytes.byteLength };
        }
    } catch (error) {
        if (request.signal.aborted) throw abortError();
        throw error;
    } finally {
        request.cleanup();
    }
}

export const SAFE_IMAGE_DOWNLOAD_LIMITS = Object.freeze({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: DEFAULT_MAX_BYTES,
    maxRedirects: DEFAULT_MAX_REDIRECTS,
});

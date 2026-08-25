import { downloadImageData } from './safe-image-download.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = (bytes) => Math.ceil(bytes * 4 / 3) + 4;

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function base64ToBytes(value, maxBytes) {
    const encoded = String(value || '').replace(/\s/gu, '');
    if (!encoded) throw new TypeError('Invalid base64 image payload.');
    if (encoded.length > MAX_BASE64_CHARS(maxBytes)) throw new RangeError('Encoded payload exceeds the image size limit.');
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 === 1) throw new TypeError('Invalid base64 image payload.');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    let binary;
    try { binary = atob(padded); } catch { throw new TypeError('Invalid base64 image payload.'); }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > maxBytes) throw new RangeError('Decoded image exceeds the size limit.');
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function hasMagic(bytes, mimeType) {
    const text = new TextDecoder().decode(bytes.subarray(0, 12));
    if (mimeType === 'image/png') return bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === 'image/gif') return text.startsWith('GIF8');
    if (mimeType === 'image/webp') return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
    if (mimeType === 'image/avif') return text.slice(4, 12).includes('avif');
    return /^(?:image\/|application\/octet-stream)/u.test(mimeType) && (hasMagic(bytes, 'image/png') || hasMagic(bytes, 'image/jpeg') || hasMagic(bytes, 'image/gif') || hasMagic(bytes, 'image/webp'));
}

function validate(bytes, mimeType, maxBytes) {
    if (!/^image\//u.test(mimeType)) throw new TypeError('Image content type is required.');
    if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new RangeError('Image exceeds the size limit.');
    if (!hasMagic(bytes, mimeType)) throw new TypeError('Image MIME type does not match its magic bytes.');
    return { imageData: bytesToBase64(bytes), mimeType, bytes: bytes.byteLength };
}

function decodeDataUrl(rawUrl, maxBytes) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/su.exec(rawUrl);
    if (!match) throw new TypeError('Invalid image data URL.');
    const mimeType = match[1].toLowerCase();
    let bytes;
    try {
        if (match[2]) bytes = base64ToBytes(match[3], maxBytes);
        else {
            // Percent decoding can expand the string and allocate before the byte
            // cap is checked. Bound the encoded representation first (three UTF-8
            // bytes may be represented by up to nine URI characters).
            const encoded = match[3];
            if (encoded.length > (maxBytes * 3) + 1024) throw new RangeError('Encoded image payload exceeds the size limit.');
            if (/%(?![0-9A-Fa-f]{2})/u.test(encoded)) throw new TypeError('Invalid image data URL encoding.');
            bytes = new TextEncoder().encode(decodeURIComponent(encoded));
        }
    } catch (error) {
        if (error instanceof URIError) throw new TypeError('Invalid image data URL encoding.');
        throw error;
    }
    return validate(bytes, mimeType, maxBytes);
}

export async function decodeGenerationArtifact(input, { signal, fetchImpl, maxBytes = DEFAULT_MAX_BYTES, downloadLimits = {} } = {}) {
    throwIfAborted(signal);
    if (typeof input === 'string') {
        if (input.startsWith('data:')) return decodeDataUrl(input, maxBytes);
        const downloaded = await downloadImageData(input, { signal, fetchImpl, maxBytes, ...downloadLimits });
        throwIfAborted(signal);
        return validate(base64ToBytes(downloaded.imageData, maxBytes), downloaded.mimeType, maxBytes);
    }
    const inline = input?.inlineData || input;
    const encoded = inline?.b64_json ?? inline?.data ?? inline?.imageData;
    if (typeof encoded !== 'string') throw new TypeError('Provider response did not include an image artifact.');
    throwIfAborted(signal);
    return validate(base64ToBytes(encoded, maxBytes), String(inline.mimeType || 'image/png').toLowerCase(), maxBytes);
}

export const ARTIFACT_LIMITS = Object.freeze({ maxBytes: DEFAULT_MAX_BYTES });

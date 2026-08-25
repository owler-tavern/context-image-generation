import { decodeGenerationArtifact } from './artifact-decoder.js';
import { attachNormalizedProviderError } from './errors.js';
import { getModelDefinition } from './registry.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_MAX_ERROR_BYTES = 64 * 1024;

const NATIVE_SPECS = Object.freeze({
    'zai-native': Object.freeze({
        id: 'zai-native',
        providerId: 'zai',
        endpoint: 'https://api.z.ai/api/paas/v4/images/generations',
        build: buildZaiImageRequest,
        parse: (response) => parseNativeImageResponse('zai', response),
    }),
    'arliai-native': Object.freeze({
        id: 'arliai-native',
        providerId: 'arliai',
        endpoint: 'https://api.arliai.com/v1/txt2img',
        build: buildArliAiImageRequest,
        parse: (response) => parseNativeImageResponse('arliai', response),
    }),
});

function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function finiteNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Source-verified Z.AI CogView/GLM image request. Optional fields have fixed curated defaults. */
export function buildZaiImageRequest({ model, prompt, quality, size = '1024x1024' } = {}) {
    const request = {
        model: nonEmptyString(model),
        prompt: nonEmptyString(prompt),
        size: nonEmptyString(size, '1024x1024'),
    };
    if (quality === 'standard' || quality === 'hd') request.quality = quality;
    return request;
}

/** Source-verified ArliAI SD-style text-to-image request. */
export function buildArliAiImageRequest({
    model,
    prompt,
    negativePrompt = '',
    width = 1024,
    height = 1024,
    steps = 20,
    cfgScale = 7,
    samplerName = 'DPM++ 2M Karras',
    seed = -1,
} = {}) {
    return {
        sd_model_checkpoint: nonEmptyString(model),
        prompt: nonEmptyString(prompt),
        negative_prompt: String(negativePrompt || ''),
        width: positiveInteger(width, 1024),
        height: positiveInteger(height, 1024),
        steps: positiveInteger(steps, 20),
        cfg_scale: finiteNumber(cfgScale, 7),
        sampler_name: nonEmptyString(samplerName, 'DPM++ 2M Karras'),
        seed: Number.isInteger(seed) ? seed : -1,
    };
}

function imageValue(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim();
}

function base64Artifact(value) {
    const image = imageValue(value);
    if (!image) return null;
    if (image.startsWith('data:') || image.startsWith('https://')) return image;
    return { b64_json: image, mimeType: 'image/png' };
}

function firstImageValue(value) {
    if (Array.isArray(value)) return firstImageValue(value[0]);
    if (typeof value === 'string') return base64Artifact(value);
    if (!value || typeof value !== 'object') return null;
    return base64Artifact(value.b64_json || value.imageData || value.data_url || value.url || value.image_url);
}

/** Parse only response forms present in the provider/source fixtures. */
export function parseNativeImageResponse(providerId, response) {
    const dataImage = firstImageValue(response?.data?.[0]);
    if (dataImage) return dataImage;
    if (providerId === 'arliai') {
        const images = firstImageValue(response?.images);
        if (images) return images;
    }
    const image = firstImageValue(response?.image || response?.image_url || response?.url);
    if (image) return image;
    throw new Error(`${providerId} response did not include an image.`);
}

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function awaitWithAbort(promise, signal) {
    if (!signal) return Promise.resolve(promise);
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError()); };
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}

function headerValue(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    return headers[name] || headers[name.toLowerCase()] || '';
}

async function readResponseBytes(response, maxBytes, signal) {
    throwIfAborted(signal);
    if (!response?.body?.getReader) throw new TypeError('Bounded provider response stream is required.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            throwIfAborted(signal);
            const result = await awaitWithAbort(reader.read(), signal);
            if (result.done) break;
            const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value || []);
            total += chunk.byteLength;
            if (total > maxBytes) {
                await reader.cancel?.();
                throw new RangeError('Provider response exceeds the size limit.');
            }
            chunks.push(chunk);
        }
    } catch (error) {
        if (signal?.aborted) await reader.cancel?.();
        throw error;
    } finally {
        reader.releaseLock?.();
    }
    throwIfAborted(signal);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

async function parseResponse(response, providerId, signal, maxBytes) {
    const contentType = headerValue(response?.headers, 'content-type').split(';', 1)[0].trim().toLowerCase();
    if (contentType.startsWith('image/')) {
        const bytes = await readResponseBytes(response, maxBytes, signal);
        return { b64_json: bytesToBase64(bytes), mimeType: contentType };
    }
    const bytes = await readResponseBytes(response, Math.min(maxBytes, DEFAULT_MAX_JSON_BYTES), signal);
    let json;
    try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TypeError(`${providerId} returned invalid JSON.`); }
    return parseNativeImageResponse(providerId, json);
}

function curatedModel(plan, spec) {
    if (plan?.resolved?.providerId !== spec.providerId) return false;
    if (plan?.resolved?.transportId !== spec.id) return false;
    const model = getModelDefinition(spec.providerId, plan?.resolved?.modelId);
    if (!model || model.id !== plan?.resolved?.modelId) return false;
    return plan?.resolved?.modelDefinition?.source?.kind === 'built-in';
}

function promptFromPlan(plan) {
    const parts = [];
    for (const message of plan?.messages || []) {
        if (Array.isArray(message?.content)) {
            for (const part of message.content) if (part?.type === 'text' && part.text) parts.push(part.text);
        } else if (typeof message?.content === 'string' && message.content) parts.push(message.content);
    }
    return String(parts.join('\n\n') || plan?.prompt?.sourceMessage || '').trim();
}

function secretFor(connection, transportContext) {
    if (typeof transportContext.resolveSecret === 'function') return transportContext.resolveSecret(connection);
    return transportContext.apiKey || transportContext.secret || '';
}

function nativeAdapter(spec) {
    return {
        id: spec.id,
        executionClass: 'browser',
        async generate({ plan, connection, signal, transportContext = {} }) {
            if (!curatedModel(plan, spec)) throw new Error(`${spec.providerId} native transport accepts curated built-in models only.`);
            throwIfAborted(signal);
            const fetchImpl = transportContext.fetchImpl || fetch;
            const prompt = promptFromPlan(plan);
            const secret = secretFor(connection, transportContext);
            const response = await fetchImpl(spec.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
                body: JSON.stringify(spec.build({ model: plan.resolved.modelId, prompt })),
                signal,
            });
            throwIfAborted(signal);
            if (!response?.ok) {
                let responseText = '';
                try {
                    const bytes = await readResponseBytes(response, DEFAULT_MAX_ERROR_BYTES, signal);
                    responseText = new TextDecoder().decode(bytes);
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                }
                if (secret) responseText = responseText.split(String(secret)).join('[redacted credential]');
                throw attachNormalizedProviderError(new Error(`API Error: ${response?.status || 0}`), {
                    providerId: spec.providerId,
                    modelId: plan.resolved.modelId,
                    status: response?.status,
                    responseText,
                });
            }
            const raw = await parseResponse(response, spec.providerId, signal, transportContext.downloadLimits?.maxBytes || DEFAULT_MAX_BYTES);
            return decodeGenerationArtifact(raw, { signal, fetchImpl, downloadLimits: transportContext.downloadLimits });
        },
    };
}

export const NATIVE_HOSTED_ADAPTERS = Object.freeze(Object.fromEntries(Object.entries(NATIVE_SPECS).map(([id, spec]) => [id, nativeAdapter(spec)])));
export const nativeHostedSpecs = NATIVE_SPECS;

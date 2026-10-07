import { getModelDefinition, getProviderDefinition } from './registry.js';
import { readProviderResponseBytes } from './native-hosted.js';
import { attachNormalizedProviderError } from './errors.js';

const TRANSPORT_ID = 'linkapi-gemini-native';
const MODEL_ID = 'gemini-nano-banana-2.1';
const MAX_JSON_BYTES = 48 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

/** Preserve the normal instruction/scene ordering without host-specific fields. */
export function buildLinkApiNanoRequest(plan, context = {}) {
    const messages = Array.isArray(plan?.messages) ? plan.messages : context.messages || [];
    const parts = [];
    let referenceCount = 0;
    for (const message of messages) {
        if (typeof message?.content === 'string') {
            if (message.content) parts.push({ text: message.content });
        } else if (Array.isArray(message?.content)) {
            for (const part of message.content) {
                if (part?.type === 'text' && typeof part.text === 'string') {
                    if (part.text) parts.push({ text: part.text });
                } else if (part?.type === 'image_url') {
                    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(part.image_url?.url || '');
                    if (!match) throw new TypeError('Reference images must be materialized as base64 image data before LinkAPI dispatch.');
                    referenceCount += 1;
                    if (referenceCount > getModelDefinition('linkapi', MODEL_ID).referenceImages.maxCount) {
                        throw new TypeError('Too many reference images for this LinkAPI model route.');
                    }
                    parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                } else {
                    throw new TypeError('Unsupported message part for LinkAPI Gemini image generation.');
                }
            }
        }
    }
    if (!parts.length) {
        const prompt = plan?.prompt?.messageContent || plan?.prompt?.sourceMessage || context.prompt;
        if (typeof prompt === 'string' && prompt.trim()) parts.push({ text: prompt });
    }
    if (!parts.length) throw new TypeError('A scene prompt is required for LinkAPI image generation.');
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    const options = plan?.options || {};
    if (options.aspectRatio || options.imageSize) {
        generationConfig.imageConfig = {
            ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
            ...(options.imageSize ? { imageSize: options.imageSize } : {}),
        };
    }
    if (options.thinkingLevel && options.thinkingLevel !== 'auto') {
        generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel.toUpperCase() };
    }
    return {
        contents: [{ role: 'user', parts }],
        generationConfig,
        ...(options.useGoogleSearch === true ? { tools: [{ googleSearch: {} }] } : {}),
    };
}

export function parseLinkApiNanoResponse(json, apiKey = '') {
    if (json?.error) {
        const message = typeof json.error?.message === 'string' ? json.error.message
            : typeof json.error === 'string' ? json.error : 'The provider reported a generation error without details.';
        throw Object.assign(new Error(apiKey ? message.split(apiKey).join('[redacted credential]') : message), { code: 'PROVIDER_GENERATION_ERROR' });
    }
    if (json?.promptFeedback?.blockReason) throw new Error('The provider blocked the image request because of its content policy.');
    for (const candidate of json?.candidates || []) {
        if (['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate?.finishReason)) {
            throw new Error('The provider blocked the image request because of its content policy.');
        }
        for (const part of candidate?.content?.parts || []) {
            if (part?.thought === true) continue;
            const inline = part?.inlineData || part?.inline_data;
            const mimeType = inline?.mimeType || inline?.mime_type;
            if (typeof inline?.data === 'string' && inline.data && /^image\//u.test(mimeType || '')) {
                return { inlineData: { data: inline.data, mimeType } };
            }
        }
    }
    throw new Error('LinkAPI returned no image in the Gemini response.');
}

export const linkApiGeminiNative = {
    id: TRANSPORT_ID,
    executionClass: 'browser',
    async generate({ plan, connection, signal, transportContext = {} }) {
        const endpoint = getProviderDefinition('linkapi').transports[TRANSPORT_ID].baseUrl;
        if (plan?.resolved?.providerId !== 'linkapi' || plan?.resolved?.modelId !== MODEL_ID
            || plan?.resolved?.transportId !== TRANSPORT_ID || plan?.resolved?.endpoint !== endpoint
            || getModelDefinition('linkapi', MODEL_ID)?.transport !== TRANSPORT_ID) {
            throw new Error('LinkAPI native transport accepts only its curated Nano Banana 2.1 route.');
        }
        signal?.throwIfAborted();
        const apiKey = typeof transportContext.resolveSecret === 'function'
            ? transportContext.resolveSecret(connection) : transportContext.apiKey || transportContext.secret || '';
        if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('LinkAPI API key is required. No request was sent.');
        const body = buildLinkApiNanoRequest(plan, transportContext);
        const response = await (transportContext.fetchImpl || fetch)(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body), signal, redirect: 'error',
        });
        signal?.throwIfAborted();
        if (response.redirected) throw new Error('LinkAPI generation redirects are not allowed.');
        const bytes = await readProviderResponseBytes(response, response.ok ? MAX_JSON_BYTES : MAX_ERROR_BYTES, signal);
        const responseText = new TextDecoder().decode(bytes);
        if (!response.ok) {
            throw attachNormalizedProviderError(new Error(`API Error: ${response.status}`), {
                providerId: 'linkapi', modelId: MODEL_ID, status: response.status,
                responseText: responseText.split(apiKey).join('[redacted credential]'),
            });
        }
        let json;
        try { json = JSON.parse(responseText); } catch { throw new Error('LinkAPI returned invalid Gemini JSON.'); }
        return parseLinkApiNanoResponse(json, apiKey);
    },
};

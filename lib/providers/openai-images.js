/**
 * Build the shared, OpenAI-compatible Images API request body.
 *
 * @param {{ model: string, prompt: string, size?: string, responseFormat: 'b64_json' }} input
 * @returns {{ model: string, prompt: string, n: 1, response_format: 'b64_json', size?: string }}
 */
export function buildOpenAiImagesRequest({ model, prompt, size, responseFormat }) {
    const request = {
        model,
        prompt,
        n: 1,
        response_format: responseFormat,
    };

    if (size) {
        request.size = size;
    }

    return request;
}

/**
 * Normalize OpenAI-compatible Images API response data.
 *
 * @param {{ data?: Array<{ b64_json?: string, url?: string }> }} response
 * @returns {{ b64: string | null, url: string | null }}
 */
export function parseOpenAiImagesResponse(response) {
    const image = response?.data?.[0];

    if (typeof image?.b64_json === 'string' && image.b64_json) {
        return { b64: image.b64_json, url: null };
    }

    if (typeof image?.url === 'string' && image.url) {
        return { b64: null, url: image.url };
    }

    throw new Error('OpenAI Images response did not include an image URL or base64 payload.');
}

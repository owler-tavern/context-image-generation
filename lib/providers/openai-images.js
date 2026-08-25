/**
 * Build the shared, OpenAI-compatible Images API request body.
 *
 * @param {{ model: string, prompt: string, size?: string, responseFormat: 'b64_json' }} input
 * @returns {{ model: string, prompt: string, n: 1, response_format: 'b64_json', size?: string }}
 */
function positivelyEvidenced(capability) {
    return capability?.state === 'supported'
        && ['official-docs', 'curated-fixture', 'live-sanitized'].includes(capability.source)
        && (capability.source !== 'live-sanitized' || typeof capability.observedAt === 'string');
}

export function buildOpenAiImagesRequest({ model, prompt, size, responseFormat, capabilities }) {
    const request = {
        model,
        prompt,
    };

    // Calls made through a resolved plan always pass capabilities. The
    // capability-free shape remains as a compatibility helper for older
    // integrations and unit callers; runtime dispatch never uses it.
    const strict = capabilities !== undefined;
    if ((!strict || positivelyEvidenced(capabilities?.multipleOutputs))) request.n = 1;
    if ((!strict || positivelyEvidenced(capabilities?.responseFormat)) && responseFormat) request.response_format = responseFormat;
    if ((!strict || positivelyEvidenced(capabilities?.sizes)) && size) {
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

import { getProviderDefinition } from './registry.js';
import { normalizeModelId } from './model-manager.js';

function buildDiscoveryUrl(baseUrl, endpoint) {
    return `${baseUrl.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function getSafeErrorMessage(errorText, status) {
    try {
        const json = JSON.parse(errorText);
        return json.error?.message || json.message || `HTTP ${status}`;
    } catch {
        return `HTTP ${status}`;
    }
}

function parseOpenAiList(json, filter) {
    const seen = new Set();
    const entries = [];
    for (const item of Array.isArray(json?.data) ? json.data : []) {
        const id = normalizeModelId(item?.id);
        if (!id || seen.has(id)) continue;
        if (filter === 'image' && !/^(gpt-image|dall-e)/i.test(id)) continue;
        if (filter === 'tokenreply-image' && !/^grok-imagine-image/i.test(id)) continue;
        seen.add(id);
        entries.push({ id, source: 'fetched' });
    }
    return entries;
}

export async function fetchProviderModels({ providerId, apiKey, fetchImpl = fetch }) {
    const provider = getProviderDefinition(providerId);
    const discovery = provider?.ui?.modelDiscovery;
    const baseUrl = provider?.transports?.openAiImages?.baseUrl;
    if (!discovery || typeof discovery !== 'object' || !baseUrl) {
        throw new Error(`Model discovery is not available for ${providerId}.`);
    }

    const response = await fetchImpl(buildDiscoveryUrl(baseUrl, discovery.endpoint), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey || ''}` },
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${getSafeErrorMessage(errorText, response.status)}`);
    }

    if (discovery.responseFormat !== 'openai-list') {
        throw new Error(`Unsupported model discovery response format: ${discovery.responseFormat}`);
    }
    return parseOpenAiList(await response.json(), discovery.filter);
}
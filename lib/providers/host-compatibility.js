const HOST_PROXY_TRANSPORTS = new Set(['host-chat-image', 'sillytavern-gemini-proxy']);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Read SillyTavern's public model migration declarations without assuming that
 * every host exposes the same frontend assets. Missing or unfamiliar assets
 * produce an unknown result rather than disabling a valid Tauri route.
 */
export function inspectHostImageModelCompatibility({ modelId, transportId, hostScriptText = '' } = {}) {
    const selectedModelId = String(modelId || '').trim();
    if (!selectedModelId || !HOST_PROXY_TRANSPORTS.has(transportId)) {
        return Object.freeze({ state: 'not-applicable' });
    }
    if (typeof hostScriptText !== 'string' || !hostScriptText.trim()) {
        return Object.freeze({ state: 'unknown', reason: 'Host image-model capabilities are not advertised.' });
    }

    const quotedModel = escapeRegExp(selectedModelId);
    const migration = new RegExp(`oldValue:\\s*['\"]${quotedModel}['\"][\\s\\S]{0,240}?newValue:\\s*['\"]([^'\"]+)['\"]`, 'u').exec(hostScriptText);
    if (!migration) return Object.freeze({ state: 'unknown', reason: 'The host does not advertise an exact compatibility decision for this model.' });

    const alternativeModelId = migration[1]?.trim();
    if (!alternativeModelId || alternativeModelId === selectedModelId) return Object.freeze({ state: 'unknown' });
    return Object.freeze({
        state: 'advisory',
        selectedModelId,
        alternativeModelId,
        userMessage: `This host advertises ${alternativeModelId} as the replacement for ${selectedModelId}. The extension will not silently change the model you selected. If aspect ratio is ignored, choose ${alternativeModelId} only if your provider offers that exact model.`,
    });
}

export async function readHostImageModelCompatibility({ modelId, transportId, fetchImpl = globalThis.fetch, signal } = {}) {
    if (!HOST_PROXY_TRANSPORTS.has(transportId)) return Object.freeze({ state: 'not-applicable' });
    if (typeof fetchImpl !== 'function') return Object.freeze({ state: 'unknown', reason: 'Host frontend assets are unavailable.' });
    try {
        const response = await fetchImpl('/scripts/openai.js', { method: 'GET', signal, cache: 'no-store' });
        if (!response?.ok) return Object.freeze({ state: 'unknown', reason: 'Host frontend assets are unavailable.' });
        return inspectHostImageModelCompatibility({ modelId, transportId, hostScriptText: await response.text() });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return Object.freeze({ state: 'unknown', reason: 'Host frontend assets are unavailable.' });
    }
}

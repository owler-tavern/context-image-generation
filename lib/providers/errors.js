const PROVIDER_LABELS = {
    makersuite: 'Google AI Studio',
    linkapi: 'LinkAPI',
    tokenreply: 'TokenReply',
    openrouter: 'OpenRouter',
};

function getStatus(error, status) {
    return status ?? error?.status ?? error?.response?.status;
}

function getRawMessage(error, responseText) {
    if (responseText) {
        try {
            const json = JSON.parse(responseText);
            const message = json?.error?.message || json?.message || json?.error;
            if (typeof message === 'string') return message;
        } catch { /* keep the exception message */ }
    }
    return error?.message || String(error || 'Unknown provider error');
}

function redact(text) {
    return String(text || '')
        .replace(/Bearer\s+[^\s,;]+/giu, '[redacted credential]')
        .replace(/\b(?:sk-(?:proj-)?|sk-ant-|sk-or-|xai-|hf_|r8_|gh[opurs]_|AIza|gsk_)[A-Za-z0-9._-]{8,}\b/gu, '[redacted credential]')
        .replace(/\b(?:api[_-]?key|proxy[_-]?password|secret|token)[_-][A-Za-z0-9._-]{12,}\b/giu, '[redacted credential]')
        .replace(/\b(?:api|key|secret|token)[_-][A-Za-z0-9._-]{12,}\b/giu, '[redacted credential]')
        .replace(/(?:api[_-]?key|proxy[_-]?password|secret|token)\s*[:=]\s*['"]?[^\s,'"}]+/giu, '$1=[redacted]')
        .replace(/data:[^\s,;]+;base64,[A-Za-z0-9+/=]{20,}/gu, 'data:[redacted]')
        .replace(/[A-Za-z0-9+/]{80,}={0,2}/gu, '[redacted payload]')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

function classify(message, status, error) {
    const text = String(message || '').toLowerCase();
    if (/experimental model route|preflight confirmation|experimental text-only generation/iu.test(text)) return 'preflight_required';
    if (/content policy|safety|blocked|prohibited|moderation|policy violation/iu.test(text)) return 'content_policy';
    if (status === 401 || status === 403 || /api[ _-]?key|unauthori[sz]ed|authentication|invalid key|bearer/iu.test(text)) return 'authentication';
    if (status === 429 || /rate[ -]?limit|too many requests|overloaded|temporarily busy|capacity/iu.test(text)) return 'rate_limit';
    if (status === 404 || /model\b.*(?:not found|unavailable|does not exist)|unknown model|no such model/iu.test(text)) return 'model_unavailable';
    if (/unsupported|not support|cannot use|invalid parameter|unknown parameter|reference image|image.*(?:size|input)|aspect[ -]?ratio/iu.test(text)) return 'unsupported_capability';
    if (typeof status === 'number' && status >= 500) return 'provider';
    if (!status && (error?.name === 'TypeError' || /network|fetch|timeout|timed out|aborted|offline|connection/iu.test(text))) return 'network';
    if (/no image|returned no image|instead of image|did not include an image|empty result/iu.test(text)) return 'empty_result';
    return 'unknown';
}

function userMessage(category, providerLabel) {
    const provider = providerLabel || 'Provider';
    return {
        authentication: `${provider} rejected the API key. Check it in extension settings.`,
        rate_limit: `${provider} is busy. Try again shortly.`,
        model_unavailable: 'This image model is unavailable. Choose another model in extension settings.',
        unsupported_capability: 'This model cannot use one of the selected image features.',
        content_policy: 'The provider declined this image request because of its content policy.',
        preflight_required: 'This model is unverified. Open Advanced → Manage models and enable “Allow experimental text-only generation” before generating.',
        network: `Could not reach ${provider}. Check your connection and try again.`,
        empty_result: `${provider} completed the request but returned no image.`,
        provider: 'Image generation failed. Try again or check provider settings.',
        unknown: 'Image generation failed. Try again or check provider settings.',
    }[category];
}

export function normalizeProviderError(error, {
    providerId = error?.providerId || 'unknown',
    providerLabel = PROVIDER_LABELS[providerId] || providerId || 'Provider',
    modelId,
    status,
    requestId,
    responseText,
} = {}) {
    if (error?.code === 'GENERATION_TIMEOUT') {
        return {
            category: 'timeout',
            userMessage: 'Image generation timed out. Try again.',
            technicalMessage: 'Image generation timed out.',
            providerId,
            modelId,
        };
    }
    const resolvedStatus = getStatus(error, status);
    const rawMessage = getRawMessage(error, responseText);
    const category = classify(rawMessage, resolvedStatus, error);
    return {
        category,
        userMessage: userMessage(category, providerLabel),
        technicalMessage: redact(rawMessage),
        status: resolvedStatus,
        providerId,
        modelId,
        ...(requestId || error?.requestId ? { requestId: requestId || error.requestId } : {}),
    };
}

export function attachNormalizedProviderError(error, context = {}) {
    const normalized = normalizeProviderError(error, context);
    const output = error instanceof Error ? error : new Error(normalized.technicalMessage);
    Object.assign(output, normalized);
    output.message = normalized.technicalMessage;
    output.name = 'ProviderError';
    return output;
}

export function getSafeProviderErrorLogFields(normalized) {
    return {
        category: normalized?.category,
        status: normalized?.status,
        providerId: normalized?.providerId,
        modelId: normalized?.modelId,
        requestId: normalized?.requestId,
    };
}

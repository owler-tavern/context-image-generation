export const SETTINGS_TABS = Object.freeze(['setup', 'preferences', 'images-cast']);

const READINESS = Object.freeze({
    needsProvider: Object.freeze({ state: 'needs-provider', label: 'Choose a provider' }),
    unavailable: Object.freeze({ state: 'unavailable', label: 'Provider unavailable' }),
    needsKey: Object.freeze({ state: 'needs-key', label: 'Add your API key' }),
    needsModel: Object.freeze({ state: 'needs-model', label: 'Choose an image model' }),
    ready: Object.freeze({ state: 'ready', label: 'Ready to generate' }),
});

export function normalizeSettingsTab(tab) {
    return SETTINGS_TABS.includes(tab) ? tab : 'setup';
}

export function deriveSetupReadiness({ providerUi, providerId, modelId, apiKey } = {}) {
    if (!providerUi || typeof providerId !== 'string' || !providerId.trim() || providerUi.id !== providerId) return READINESS.needsProvider;
    if (providerUi.available === false) return READINESS.unavailable;
    if (providerUi.requiresApiKey === true && (typeof apiKey !== 'string' || !apiKey.trim())) return READINESS.needsKey;
    const models = Array.isArray(providerUi.models) ? providerUi.models : [];
    if (typeof modelId !== 'string' || !modelId.trim() || !models.some((model) => model && model.id === modelId)) return READINESS.needsModel;
    return READINESS.ready;
}

export function formatSetupRuntimeIssue({ context, userMessage } = {}) {
    const message = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!message) return '';
    const label = typeof context === 'string' && context.trim() ? context.trim() : 'Provider issue';
    return `${label}: ${message}`;
}

export function resolveInitialSettingsTab({ savedTab, readiness } = {}) {
    return readiness?.state === 'ready' ? normalizeSettingsTab(savedTab) : 'setup';
}

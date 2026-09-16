export const SETTINGS_TABS = Object.freeze(['setup', 'preferences', 'images-cast']);

const READINESS = Object.freeze({
    needsProvider: Object.freeze({ state: 'needs-provider', label: 'Choose a provider' }),
    unavailable: Object.freeze({ state: 'unavailable', label: 'Provider unavailable' }),
    needsKey: Object.freeze({ state: 'needs-key', label: 'Add your API key' }),
    needsModel: Object.freeze({ state: 'needs-model', label: 'Choose an image model' }),
    needsMethod: Object.freeze({ state: 'needs-method', label: 'Choose a generation method for this model.' }),
    ready: Object.freeze({ state: 'ready', label: 'Configured. Image generation has not been tried with this model. Use the wand to try it.' }),
});

export function normalizeSettingsTab(tab) {
    return SETTINGS_TABS.includes(tab) ? tab : 'setup';
}

export function deriveSetupReadiness({ providerUi, providerId, modelId, apiKey, route } = {}) {
    if (!providerUi || typeof providerId !== 'string' || !providerId.trim() || providerUi.id !== providerId) return READINESS.needsProvider;
    if (providerUi.available === false) return READINESS.unavailable;
    if (providerUi.requiresApiKey === true && (typeof apiKey !== 'string' || !apiKey.trim())) return READINESS.needsKey;
    const models = Array.isArray(providerUi.models) ? providerUi.models : [];
    if (typeof modelId !== 'string' || !modelId.trim() || !models.some((model) => model && model.id === modelId)) return READINESS.needsModel;
    const selectedRoute = route || providerUi.selectedRoute;
    if (!selectedRoute?.transportId || !['configured', 'verified'].includes(selectedRoute.model?.routeEvidence?.state || selectedRoute.routeEvidence?.state)) return READINESS.needsMethod;
    if (selectedRoute.model?.capabilities?.imageGeneration?.source === 'live-sanitized'
        && selectedRoute.model?.capabilities?.imageGeneration?.state === 'supported') {
        return { state: 'ready', label: 'An image was generated successfully with this connection and model.' };
    }
    return READINESS.ready;
}

export function formatSetupRuntimeIssue({ context, userMessage } = {}) {
    const message = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!message) return '';
    const label = typeof context === 'string' && context.trim() ? context.trim() : 'Provider issue';
    return `${label}: ${message}`;
}

export function projectImageSizePreference(savedValue, imageSizeOptions = []) {
    const saved = typeof savedValue === 'string' ? savedValue : '';
    const options = Array.isArray(imageSizeOptions) ? imageSizeOptions : [];
    const selectedValue = options.some((option) => option?.value === saved) ? saved : '';
    const unavailable = Boolean(saved) && selectedValue !== saved;
    return {
        savedValue: saved,
        selectedValue,
        showControl: options.length > 0,
        note: unavailable ? `Image size is unavailable for this model; your ${saved} preference is saved.` : '',
    };
}

export function projectReferencePreferences(_savedPreferences, capability = 'unknown') {
    const state = capability === true ? 'supported'
        : capability === false ? 'unsupported'
            : capability?.state || capability;
    const supported = state === 'supported';
    return {
        showAvatarControl: true,
        showPreviousImageControl: true,
        enabled: supported,
        note: supported ? '' : state === 'unknown'
            ? 'Visual references have not been verified for this model. Your saved reference preferences are kept and will be available when you choose a supported model.'
            : 'Visual references are unavailable for this model. Your saved reference preferences are kept and will be available when you choose a supported model.',
    };
}

export function projectSetupTabStatus(readiness, runtimeIssue) {
    const issue = typeof runtimeIssue === 'string' ? runtimeIssue.trim() : '';
    if (issue) {
        return {
            state: 'issue',
            text: 'Setup issue',
            icon: 'fa-circle-exclamation',
            accessibleLabel: `Setup issue: ${issue}`,
        };
    }
    if (readiness?.state !== 'ready') {
        const label = typeof readiness?.label === 'string' && readiness.label.trim() ? readiness.label.trim() : 'Complete Setup';
        return {
            state: 'incomplete',
            text: 'Setup incomplete',
            icon: 'fa-triangle-exclamation',
            accessibleLabel: `Setup incomplete: ${label}`,
        };
    }
    return {
        state: 'ready',
        text: '',
        icon: '',
        accessibleLabel: 'Setup',
    };
}

export function resolveInitialSettingsTab({ savedTab, readiness } = {}) {
    return readiness?.state === 'ready' ? normalizeSettingsTab(savedTab) : 'setup';
}

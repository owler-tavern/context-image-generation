import { getModelDefinition, getProviderDefinition, getProviderDefinitions } from './registry.js';
import { mergeProviderModels } from './model-manager.js';

export function projectProviderOptions() {
    return getProviderDefinitions().map((provider) => ({
        id: provider.id,
        label: provider.label || provider.id,
        status: provider.status,
    }));
}

export function projectProviderUi(providerId, modelId, { localEntries = [] } = {}) {
    const provider = getProviderDefinition(providerId);
    if (!provider) return undefined;

    const ui = provider.ui || {};
    const models = mergeProviderModels(providerId, localEntries);
    const model = models.find((candidate) => candidate.id === modelId) || models[0];
    return {
        id: provider.id,
        label: provider.label || provider.id,
        status: provider.status,
        requiresApiKey: ui.requiresApiKey === true,
        apiKeyLabel: ui.apiKeyLabel || 'Provider API Key',
        supportsModelDiscovery: typeof ui.modelDiscovery === 'object',
        modelDiscoveryExperimental: ui.modelDiscovery?.experimental === true,
        showsLegacyRecovery: ui.showsLegacyRecovery === true,
        providerInfo: ui.providerInfo,
        modelNote: model?.modelNote,
        models: models.map(({ id, label }) => ({ id, label: label || id })),
        supportsReferenceImages: model?.supportsReferenceImages !== false,
        imageSizeOptions: (model?.imageSizeOptions || []).map((option) => typeof option === 'string' ? { value: option, label: option } : option),
        supportsThinking: model?.supportsThinking === true,
        supportsGoogleSearch: model?.supportsGoogleSearch === true,
    };
}

export function getModelFallback(providerId, currentModelId, localEntries = []) {
    if (getModelDefinition(providerId, currentModelId)) return currentModelId;
    const ui = projectProviderUi(providerId, currentModelId, { localEntries });
    if (!ui) return undefined;
    if (ui.models.some((model) => model.id === currentModelId)) return currentModelId;

    const preferredVariant = /(?:3-pro|\bpro\b)/.test(currentModelId || '') ? 'pro'
        : /(?:3\.1|3-1)/.test(currentModelId || '') ? 'flash2'
            : 'flash';
    return mergeProviderModels(providerId, localEntries).find((model) => model.variant === preferredVariant)?.id || ui.models[0]?.id;
}

export function projectProviderControls(providerId, modelId, currentImageSize = '', { localEntries = [] } = {}) {
    const ui = projectProviderUi(providerId, modelId, { localEntries });
    if (!ui) return undefined;
    const imageSize = ui.imageSizeOptions.some((option) => option.value === currentImageSize) ? currentImageSize : '';
    return { ...ui, imageSize };
}
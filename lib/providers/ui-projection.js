import { getModelDefinition, getProviderDefinition, getProviderDefinitions, normalizeProviderDefinition } from './registry.js';
import { mergeProviderModels } from './model-manager.js';
import { capabilityIsSupported, normalizeCapabilityEvidence, normalizeModelDefinition } from './contracts.js';

const DISCOVERY_WARNING_CODES = new Set(['DISCOVERY_AUTH_FAILED', 'DISCOVERY_RATE_LIMITED', 'DISCOVERY_NETWORK', 'DISCOVERY_PROVIDER_FAILED', 'DISCOVERY_UNSUPPORTED', 'DISCOVERY_MISCONFIGURED', 'DISCOVERY_FAILED']);

function normalizeDiscoveryWarning(code, providerLabel) {
    switch (code) {
        case 'DISCOVERY_AUTH_FAILED': return `${providerLabel} rejected the API key. Check it in extension settings.`;
        case 'DISCOVERY_RATE_LIMITED': return `${providerLabel} is busy. Try again shortly.`;
        case 'DISCOVERY_NETWORK': return `Could not reach ${providerLabel}. Check your connection and try again.`;
        case 'DISCOVERY_PROVIDER_FAILED': return 'Provider model discovery failed. Try again or check provider settings.';
        case 'DISCOVERY_UNSUPPORTED': return 'Model discovery is not available for this provider.';
        case 'DISCOVERY_MISCONFIGURED': return 'Model discovery is not configured for this provider.';
        default: return 'Model discovery failed. Your current model list was kept.';
    }
}

/** Project a tri-state capability without ever treating unknown as enabled. */
export function projectCapability(value) {
    const evidence = normalizeCapabilityEvidence(value);
    return {
        state: evidence.state,
        source: evidence.source,
        confidence: evidence.confidence,
        ...(evidence.observedAt ? { observedAt: evidence.observedAt } : {}),
        ...(evidence.note ? { note: evidence.note } : {}),
        enabled: capabilityIsSupported(evidence),
        disabledReason: capabilityIsSupported(evidence) ? undefined : evidence.state === 'unsupported' ? 'Provider/model does not support this option.' : 'Capability has not been verified for this model route.',
    };
}

function projectModelCapabilities(providerId, provider, model) {
    if (!model?.id) {
        return {
            supportsReferenceImages: false,
            referenceImageMaxCount: undefined,
            imageSizeOptions: [],
        };
    }
    const normalized = model?.capabilities
        ? model
        : normalizeModelDefinition({ ...model, providerId }, { id: providerId, transportIds: Object.keys(provider?.transports || {}) });
    const reference = normalized.capabilities?.referenceImages;
    const maxReferenceImages = normalized.capabilities?.maxReferenceImages || reference?.maxCount;
    const sizeEvidence = normalized.capabilities?.sizes;
    const imageSizeOptions = capabilityIsSupported(sizeEvidence) && Array.isArray(normalized.capabilities.allowedSizes)
        ? normalized.capabilities.allowedSizes.map((value) => {
            const option = (model?.imageSizeOptions || []).find((candidate) => (typeof candidate === 'string' ? candidate : candidate?.value) === value);
            return { value, label: typeof option === 'object' && option?.label ? option.label : value };
        })
        : [];
    return {
        supportsReferenceImages: capabilityIsSupported(reference) && Number.isInteger(maxReferenceImages) && maxReferenceImages > 0,
        referenceImageMaxCount: Number.isInteger(maxReferenceImages) && maxReferenceImages > 0 ? maxReferenceImages : undefined,
        imageSizeOptions,
    };
}

export function projectProviderOptions() {
    return getProviderDefinitions().map((provider) => ({
        id: provider.id,
        label: provider.label || provider.id,
        status: provider.status,
        ...(provider.available === false ? {
            available: false,
            unavailableReason: provider.unavailableReason || 'Available after the optional server adapter is installed.',
        } : {}),
    }));
}

export function projectProviderUi(providerId, modelId, { localEntries = [], discoveryEvidence, discoveryWarning } = {}) {
    const provider = getProviderDefinition(providerId);
    if (!provider) return undefined;

    const ui = provider.ui || {};
    const models = mergeProviderModels(providerId, localEntries);
    const model = models.find((candidate) => candidate.id === modelId) || models[0];
    const projectedCapabilities = projectModelCapabilities(providerId, provider, model);
    const normalizedProvider = normalizeProviderDefinition(provider);
    const discoveryKind = normalizedProvider.discovery?.kind || 'unsupported';
    const refreshEnabled = discoveryKind === 'openai-list' || discoveryKind === 'native';
    const evidence = discoveryEvidence && typeof discoveryEvidence === 'object' ? {
        kind: typeof discoveryEvidence.kind === 'string' ? discoveryEvidence.kind : discoveryKind,
        source: typeof discoveryEvidence.source === 'string' ? discoveryEvidence.source : 'provider catalog',
        ...(typeof discoveryEvidence.observedAt === 'string' ? { observedAt: discoveryEvidence.observedAt } : {}),
        retryCount: Number.isInteger(discoveryEvidence.retryCount) && discoveryEvidence.retryCount >= 0 ? discoveryEvidence.retryCount : 0,
    } : undefined;
    const warningCode = DISCOVERY_WARNING_CODES.has(discoveryWarning?.code) ? discoveryWarning.code : undefined;
    const warning = warningCode ? {
        code: warningCode,
        userMessage: normalizeDiscoveryWarning(warningCode, provider.label || provider.id),
    } : undefined;
    const modelDiscovery = {
        kind: discoveryKind,
        refreshEnabled,
        ...(refreshEnabled ? {} : {
            disabledReason: discoveryKind === 'curated-static'
                ? 'Models are curated for this provider; refresh is not needed.'
                : normalizedProvider.discovery?.reason || 'Model discovery is not available for this provider.',
        }),
        ...(evidence ? { evidence, lastRefresh: evidence.observedAt } : {}),
        ...(warning ? { warning } : {}),
    };
    return {
        id: provider.id,
        label: provider.label || provider.id,
        status: provider.status,
        ...(provider.available === false ? {
            available: false,
            unavailableReason: provider.unavailableReason || 'Available after the optional server adapter is installed.',
        } : {}),
        requiresApiKey: ui.requiresApiKey === true,
        apiKeyLabel: ui.apiKeyLabel || 'Provider API Key',
        supportsModelDiscovery: typeof ui.modelDiscovery === 'object',
        modelDiscoveryExperimental: ui.modelDiscovery?.experimental === true,
        modelDiscovery,
        showsLegacyRecovery: ui.showsLegacyRecovery === true,
        providerInfo: ui.providerInfo,
        modelNote: model?.modelNote,
        models: models.map(({ id, label }) => ({ id, label: label || id })),
        supportsReferenceImages: projectedCapabilities.supportsReferenceImages,
        ...(projectedCapabilities.referenceImageMaxCount ? { referenceImageMaxCount: projectedCapabilities.referenceImageMaxCount } : {}),
        imageSizeOptions: projectedCapabilities.imageSizeOptions,
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

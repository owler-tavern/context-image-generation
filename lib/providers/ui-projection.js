import { getModelDefinition, getProviderDefinition, getProviderDefinitions, normalizeProviderDefinition } from './registry.js';
import { mergeProviderModels } from './model-manager.js';
import { capabilityIsSupported, normalizeCapabilityEvidence, normalizeModelDefinition } from './contracts.js';
import { connectionRevision, safeConnectionProjection, validateCustomConnection } from './custom-connections.js';

const DISCOVERY_WARNING_CODES = new Set(['DISCOVERY_AUTH_FAILED', 'DISCOVERY_RATE_LIMITED', 'DISCOVERY_NETWORK', 'DISCOVERY_BROWSER_BLOCKED', 'DISCOVERY_PROVIDER_FAILED', 'DISCOVERY_UNSUPPORTED', 'DISCOVERY_MISCONFIGURED', 'DISCOVERY_FAILED']);

export function getCustomCatalogRefreshMessage(models = []) {
    const count = Array.isArray(models) ? models.length : 0;
    if (!count) return 'Connection reached; it returned no model IDs.';
    return `Received ${count} catalog model ID${count === 1 ? '' : 's'}. Catalog presence does not verify image generation.`;
}

/** Keep the primary Setup selector independent from Advanced model-management filtering. */
export function projectModelSelectorLists({ models = [], managedSearch = '' } = {}) {
    const allModels = (Array.isArray(models) ? models : []).filter((model) => model?.id);
    const query = String(managedSearch || '').trim().toLowerCase();
    return {
        setup: allModels,
        managed: query
            ? allModels.filter((model) => `${model.id} ${model.label || model.id}`.toLowerCase().includes(query))
            : allModels,
    };
}

function safeCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Produce a bounded route/status projection. Extra input fields are intentionally ignored. */
export function projectRouteDiagnostics({ label, protocol, transportId, endpointClass, originClass, modelId, imageCapability, routeEvidence, discoveryEvidence } = {}) {
    const evidence = routeEvidence && typeof routeEvidence === 'object' ? routeEvidence : {};
    const discovery = discoveryEvidence && typeof discoveryEvidence === 'object' ? discoveryEvidence : {};
    return {
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : 'Unknown route',
        protocol: typeof protocol === 'string' && protocol ? protocol : 'unknown',
        transport: typeof transportId === 'string' && transportId ? transportId : 'unavailable',
        endpointClass: typeof endpointClass === 'string' && endpointClass ? endpointClass : 'unavailable',
        originClass: ['secure-remote', 'local-loopback'].includes(originClass) ? originClass : 'unknown',
        evidence: {
            state: ['verified', 'configured', 'unverified'].includes(evidence.state) ? evidence.state : 'unverified',
            source: typeof evidence.source === 'string' && evidence.source ? evidence.source : 'none',
            ...(typeof evidence.observedAt === 'string' && !Number.isNaN(Date.parse(evidence.observedAt))
                ? { observedAt: new Date(evidence.observedAt).toISOString() } : {}),
        },
        model: {
            id: typeof modelId === 'string' && modelId.trim()
                ? modelId.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 240) || 'Not selected'
                : 'Not selected',
            imageCapability: ['supported', 'unsupported', 'unknown'].includes(imageCapability?.state) ? imageCapability.state : 'unknown',
        },
        catalog: {
            returned: safeCount(discovery.returnedCount), accepted: safeCount(discovery.acceptedCount),
            unresolved: safeCount(discovery.unresolvedCount), rejected: safeCount(discovery.rejectedCount),
        },
    };
}

function normalizeDiscoveryWarning(code, providerLabel) {
    switch (code) {
        case 'DISCOVERY_AUTH_FAILED': return `${providerLabel} rejected the API key. Check it in extension settings.`;
        case 'DISCOVERY_RATE_LIMITED': return `${providerLabel} is busy. Try again shortly.`;
        case 'DISCOVERY_NETWORK': return `Could not reach ${providerLabel}. Check your connection and try again.`;
        case 'DISCOVERY_BROWSER_BLOCKED': return `The browser blocked or could not reach ${providerLabel}. Check CORS headers and private-network access permissions.`;
        case 'DISCOVERY_PROVIDER_FAILED': return 'Provider model discovery failed. Try again or check provider settings.';
        case 'DISCOVERY_UNSUPPORTED': return 'Model discovery is not available for this provider.';
        case 'DISCOVERY_MISCONFIGURED': return 'Model discovery is not configured for this provider.';
        default: return 'Model discovery failed. Your current model list was kept.';
    }
}

function projectCredentialUi(provider) {
    const ui = provider.ui || {};
    const configured = ui.credential && typeof ui.credential === 'object' ? ui.credential : {};
    const ownership = ['extension', 'sillytavern', 'unavailable', 'none'].includes(ui.credentialOwnership)
        ? ui.credentialOwnership
        : 'unavailable';
    const requiresApiKey = ownership === 'extension';
    const label = typeof configured.label === 'string' && configured.label.trim()
        ? configured.label.trim()
        : ownership === 'extension'
            ? typeof ui.apiKeyLabel === 'string' && ui.apiKeyLabel.trim() ? ui.apiKeyLabel.trim() : `${provider.label || provider.id} API Key`
            : ownership === 'sillytavern'
                ? `${provider.label || provider.id} connection`
                : `${provider.label || provider.id} unavailable`;
    const setupHelp = typeof configured.setupHelp === 'string' && configured.setupHelp.trim()
        ? configured.setupHelp.trim()
        : ownership === 'extension'
            ? `Enter the API key for ${provider.label || provider.id}.`
            : ownership === 'sillytavern'
                ? `Configure ${provider.label || provider.id} in SillyTavern’s AI Response → Chat Completion Source.`
                : '';
    return {
        mode: ownership === 'extension' ? 'extension-key' : ownership,
        label,
        placeholder: ownership === 'extension' && typeof configured.placeholder === 'string' && configured.placeholder.trim()
            ? configured.placeholder.trim()
            : ownership === 'extension' ? 'Enter API key' : '',
        setupHelp,
        advancedHelp: typeof configured.advancedHelp === 'string' && configured.advancedHelp.trim()
            ? configured.advancedHelp.trim()
            : typeof ui.advancedHelp === 'string' && ui.advancedHelp.trim()
                ? ui.advancedHelp.trim()
                : '',
    };
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
        referenceCapabilityState: reference?.state || 'unknown',
        referenceImageMaxCount: Number.isInteger(maxReferenceImages) && maxReferenceImages > 0 ? maxReferenceImages : undefined,
        imageSizeOptions,
    };
}

export function projectProviderOptions({ customConnections = [] } = {}) {
    const providers = getProviderDefinitions().map((provider) => ({
        id: provider.id,
        label: provider.label || provider.id,
        status: provider.status,
        ...(provider.available === false ? {
            available: false,
            unavailableReason: provider.unavailableReason || 'Available after the optional server adapter is installed.',
        } : {}),
    }));
    const custom = (Array.isArray(customConnections) ? customConnections : []).map((connection) => {
        const validation = validateCustomConnection(connection);
        if (!validation.valid || !validation.connection.enabled) return null;
        return {
            id: validation.connection.id,
            label: validation.connection.label,
            status: 'configured',
            connectionId: validation.connection.id,
            protocol: validation.connection.protocol,
        };
    }).filter(Boolean);
    return [...providers, ...custom];
}

export function projectCustomConnectionEditor(connection, { credentialConfigured = false, evidence } = {}) {
    const safe = safeConnectionProjection(connection);
    if (safe.valid === false) return safe;
    const revision = connectionRevision(connection);
    const evidenceMatches = evidence?.revision === revision && ['configured', 'verified'].includes(evidence?.state);
    const state = evidenceMatches ? evidence.state : 'untested';
    return {
        schema: safe.schema,
        id: safe.id,
        label: safe.label,
        protocol: { value: safe.protocol, label: safe.protocol === 'gemini-compatible' ? 'Gemini-compatible' : 'OpenAI Images', fixed: false },
        baseUrl: safe.baseUrl,
        modelsPath: safe.modelsPath,
        generationPath: safe.generationPath,
        enabled: safe.enabled,
        localInsecure: safe.localInsecure,
        revision,
        authPresets: [
            { value: safe.protocol === 'gemini-compatible' ? 'gemini-api-key' : 'bearer', label: safe.protocol === 'gemini-compatible' ? 'Gemini/API-key proxy password' : 'Bearer token' },
            { value: 'none', label: 'No authentication' },
        ],
        credential: {
            preset: safe.credential.preset,
            configured: safe.credential.preset !== 'none' && credentialConfigured,
            maskedValue: safe.credential.preset !== 'none' && credentialConfigured ? '••••••••' : '',
            browserSideWarning: 'This key is stored in browser-side SillyTavern extension settings.',
        },
        status: {
            state,
            label: state === 'verified' ? 'Verified' : state === 'configured' ? 'Configured' : 'Not tested',
            ...(state === 'configured' ? { firstRequestWarning: 'First request will test this endpoint' } : {}),
            ...(evidenceMatches && evidence?.observedAt ? { observedAt: evidence.observedAt } : {}),
        },
        routePreview: safe.routePreview,
    };
}

export function projectCustomFirstRequestConfirmation(connection) {
    const editor = projectCustomConnectionEditor(connection);
    if (editor.valid === false) return editor;
    const generation = editor.routePreview.generation;
    const protocolLabel = editor.protocol.label;
    const transportLabel = generation.transport || 'Direct provider request';
    const upstreamLine = generation.upstreamProxyRoot ? `\nUpstream proxy root: ${generation.upstreamProxyRoot}` : '';
    return {
        protocolLabel,
        transportLabel,
        endpoint: generation.url,
        ...(generation.upstreamProxyRoot ? { upstreamProxyRoot: generation.upstreamProxyRoot } : {}),
        message: `First request will test this route.\n\n${generation.method} ${generation.url}\nProtocol: ${protocolLabel}\nTransport: ${transportLabel}${upstreamLine}\nThis request may incur provider cost. Continue?`,
    };
}

export function projectProviderUi(providerId, modelId, { localEntries = [], discoveryEvidence, discoveryWarning } = {}) {
    const provider = getProviderDefinition(providerId);
    if (!provider) return undefined;

    const ui = provider.ui || {};
    const credential = projectCredentialUi(provider);
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
        credential,
        supportsModelDiscovery: typeof ui.modelDiscovery === 'object',
        modelDiscoveryExperimental: ui.modelDiscovery?.experimental === true,
        modelDiscovery,
        showsLegacyRecovery: ui.showsLegacyRecovery === true,
        modelNote: model?.modelNote,
        models: models.map(({ id, label }) => ({ id, label: label || id })),
        supportsReferenceImages: projectedCapabilities.supportsReferenceImages,
        referenceCapabilityState: projectedCapabilities.referenceCapabilityState,
        ...(projectedCapabilities.referenceImageMaxCount ? { referenceImageMaxCount: projectedCapabilities.referenceImageMaxCount } : {}),
        imageSizeOptions: projectedCapabilities.imageSizeOptions,
        supportsThinking: model?.supportsThinking === true,
        supportsGoogleSearch: model?.supportsGoogleSearch === true,
    };
}

export function projectCustomConnectionProviderUi(connection, modelId, { localEntries = [], discoveryEvidence, discoveryWarning, credentialConfigured = false } = {}) {
    const editor = projectCustomConnectionEditor(connection, { evidence: discoveryEvidence, credentialConfigured });
    if (editor.valid === false) return undefined;
    const models = (Array.isArray(localEntries) ? localEntries : [])
        .filter((model) => model?.connectionId === editor.id || !model?.connectionId)
        .map((model) => ({ id: model.id, label: model.label || model.id }));
    const warningCode = DISCOVERY_WARNING_CODES.has(discoveryWarning?.code) || ['DISCOVERY_EMPTY', 'DISCOVERY_REDIRECTED'].includes(discoveryWarning?.code)
        ? discoveryWarning.code
        : undefined;
    return {
        id: editor.id,
        label: editor.label,
        available: connection.enabled !== false,
        status: editor.status.state,
        requiresApiKey: editor.credential.preset !== 'none',
        credential: {
            mode: editor.credential.preset !== 'none' ? 'extension-key' : 'none',
            label: 'Custom connection API key',
            placeholder: editor.credential.configured ? 'Saved key (enter to replace)' : 'Enter API key',
            setupHelp: editor.credential.browserSideWarning,
            advancedHelp: '',
        },
        supportsModelDiscovery: true,
        modelDiscoveryExperimental: true,
        modelDiscovery: {
            kind: 'openai-list',
            refreshEnabled: true,
            ...(discoveryEvidence ? { evidence: discoveryEvidence, lastRefresh: discoveryEvidence.observedAt } : {}),
            ...(warningCode ? { warning: {
                code: warningCode,
                userMessage: typeof discoveryWarning?.userMessage === 'string' && discoveryWarning.userMessage
                    ? discoveryWarning.userMessage
                    : 'Custom connection model discovery failed. Your saved models were kept.',
            } } : {}),
        },
        showsLegacyRecovery: false,
        models,
        supportsReferenceImages: false,
        referenceCapabilityState: 'unknown',
        imageSizeOptions: [],
        supportsThinking: false,
        supportsGoogleSearch: false,
        selectedModelId: models.some((model) => model.id === modelId) ? modelId : models[0]?.id,
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

export function projectProviderControls(providerId, modelId, currentImageSize = '', { localEntries = [], connection, discoveryEvidence, discoveryWarning, credentialConfigured } = {}) {
    const ui = connection
        ? projectCustomConnectionProviderUi(connection, modelId, { localEntries, discoveryEvidence, discoveryWarning, credentialConfigured })
        : projectProviderUi(providerId, modelId, { localEntries, discoveryEvidence, discoveryWarning });
    if (!ui) return undefined;
    const imageSize = ui.imageSizeOptions.some((option) => option.value === currentImageSize) ? currentImageSize : '';
    return { ...ui, imageSize };
}

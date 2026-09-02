import { getModelDefinition, getProviderDefinition } from './registry.js';
import { normalizeModelDefinition, normalizeModelCapabilities } from './contracts.js';
import { connectionRevision, validateCustomConnection } from './custom-connections.js';

export { normalizeModelDefinition, normalizeModelCapabilities };

export function normalizeModelRecords(providerId, entries, provider = getProviderDefinition(providerId)) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const id = normalizeModelId(entry?.id);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return normalizeModelDefinition({ ...entry, id, providerId, source: entry?.source || 'manual' }, provider || { id: providerId });
    }).filter(Boolean);
}

export function mergeFetchedModelRecords(entries, fetched, providerId, provider = getProviderDefinition(providerId)) {
    const current = normalizeModelRecords(providerId, entries, provider);
    const byId = new Map(current.map((entry) => [entry.id, entry]));
    for (const candidate of Array.isArray(fetched) ? fetched : []) {
        const id = normalizeModelId(candidate?.id || candidate);
        if (!id || byId.has(id)) continue;
        byId.set(id, normalizeModelDefinition({
            ...(typeof candidate === 'object' ? candidate : { id }),
            id,
            providerId,
            source: {
                kind: 'fetched',
                discoveredAt: candidate?.discoveredAt || new Date().toISOString(),
                sourceLabel: candidate?.sourceLabel || 'provider discovery',
            },
        }, provider || { id: providerId }));
    }
    return [...byId.values()];
}

/** Keep saved records unless discovery supplied at least one route-safe record. */
export function mergeDiscoveryModelRecords(entries, result, providerId, provider = getProviderDefinition(providerId)) {
    const current = normalizeModelRecords(providerId, entries, provider);
    if (result?.warning || !Array.isArray(result?.models) || result.models.length === 0) return current;
    return mergeFetchedModelRecords(current, result.models, providerId, provider);
}

/** Keep manual custom entries while replacing the last successful fetched catalog snapshot. */
export function mergeCustomDiscoveryModelRecords(entries, result, inputConnection) {
    const validation = validateCustomConnection(inputConnection);
    if (!validation.valid) return [];
    const connection = validation.connection;
    const transportId = connection.protocol === 'gemini-compatible' ? 'sillytavern-gemini-proxy' : 'openai-images';
    const provider = { id: connection.id, transportIds: [transportId] };
    const current = normalizeModelRecords(connection.id, entries, provider);
    if (result?.warning || !Array.isArray(result?.models) || result.models.length === 0) return current;

    const revision = connectionRevision(connection);
    if (result?.evidence?.connectionId !== connection.id || result.evidence.revision !== revision) return current;
    const manual = current.filter((entry) => entry.source?.kind === 'manual');
    const seen = new Set(manual.map((entry) => entry.id));
    const fetched = [];
    let routeSafeCount = 0;
    for (const candidate of result.models) {
        const id = normalizeModelId(candidate?.id);
        if (!id) continue;
        const routeEvidence = candidate?.routeEvidence;
        if (candidate?.connectionId !== connection.id
            || candidate?.providerId !== connection.id
            || candidate?.transportId !== transportId
            || !['configured', 'verified'].includes(routeEvidence?.state)
            || routeEvidence?.revision !== revision) continue;
        routeSafeCount += 1;
        if (seen.has(id)) continue;
        fetched.push(normalizeModelDefinition({ ...candidate, id, source: candidate.source || { kind: 'fetched' } }, provider));
        seen.add(id);
    }
    return routeSafeCount ? [...manual, ...fetched] : current;
}

/** Describe discovery results without mistaking unresolved records for verified routes. */
export function getDiscoveryRefreshMessage(result = {}) {
    const evidence = result?.evidence || {};
    const acceptedCount = Number.isInteger(evidence.acceptedCount) && evidence.acceptedCount > 0 ? evidence.acceptedCount : 0;
    const returnedCount = Number.isInteger(evidence.returnedCount) && evidence.returnedCount > 0 ? evidence.returnedCount : 0;
    if (acceptedCount > 0) return { level: 'success', message: `Refreshed ${acceptedCount} discovered image model${acceptedCount === 1 ? '' : 's'} in Setup → Model. Choose one from that dropdown; discovery does not verify image generation.` };
    if (returnedCount === 0) return { level: 'info', message: 'Provider returned no models. Your saved models were kept.' };
    return { level: 'warning', message: `Provider returned ${returnedCount} models, but none have a verified image route. Your saved models were kept.` };
}

export function updateModelRecords(entries, operation, providerId, provider = getProviderDefinition(providerId)) {
    const current = normalizeModelRecords(providerId, entries, provider || { id: providerId });
    const id = normalizeModelId(operation?.id);
    if (!id) return current;
    if (operation.type === 'remove') return current.filter((entry) => entry.id !== id);
    const previousId = normalizeModelId(operation.previousId);
    const remaining = current.filter((entry) => entry.id !== id && (operation.type !== 'replace' || entry.id !== previousId));
    if (!['upsert', 'replace'].includes(operation.type)) return current;
    return [...remaining, normalizeModelDefinition({
        id,
        providerId,
        transportId: operation.transportId || operation.transport,
        source: { kind: operation.source === 'fetched' ? 'fetched' : 'manual', ...(operation.discoveredAt ? { discoveredAt: operation.discoveredAt } : {}), ...(operation.sourceLabel ? { sourceLabel: operation.sourceLabel } : {}) },
        capabilities: operation.capabilities,
    }, provider || { id: providerId })];
}

export function toLegacyModelEntries(entries) {
    return (Array.isArray(entries) ? entries : []).filter((entry) => entry?.id).map((entry) => ({
        id: entry.id,
        source: entry.source?.kind === 'fetched' || entry.source === 'fetched' ? 'fetched' : 'manual',
        ...(entry.transportId || entry.transport ? { transport: entry.transportId || entry.transport } : {}),
    }));
}

export function normalizeModelId(id) {
    return typeof id === 'string' ? id.trim() : '';
}

function normalizeEntries(entries) {
    const seen = new Set();
    const result = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const id = normalizeModelId(entry?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const normalized = { id, source: entry?.source === 'fetched' ? 'fetched' : 'manual' };
        if (typeof entry?.transport === 'string' && entry.transport) normalized.transport = entry.transport;
        if (typeof entry?.supportsReferenceImages === 'boolean') normalized.supportsReferenceImages = entry.supportsReferenceImages;
        if (typeof entry?.supportsSize === 'boolean') normalized.supportsSize = entry.supportsSize;
        result.push(normalized);
    }
    return result;
}

export function updateLocalModelEntries(entries, operation) {
    const current = normalizeEntries(entries);
    const id = normalizeModelId(operation?.id);
    if (!id) return current;

    if (operation.type === 'remove') {
        return current.filter((entry) => entry.id !== id);
    }

    if (operation.type === 'replace') {
        const previousId = normalizeModelId(operation.previousId);
        return normalizeEntries([
            ...current.filter((entry) => entry.id !== previousId && entry.id !== id),
            { id, source: operation.source, transport: operation.transport, supportsReferenceImages: operation.supportsReferenceImages, supportsSize: operation.supportsSize },
        ]);
    }

    if (operation.type === 'upsert') {
        return normalizeEntries([
            ...current.filter((entry) => entry.id !== id),
            { id, source: operation.source, transport: operation.transport, supportsReferenceImages: operation.supportsReferenceImages, supportsSize: operation.supportsSize },
        ]);
    }

    return current;
}

export function mergeFetchedModelEntries(entries, fetchedIds) {
    let merged = normalizeEntries(entries);
    for (const id of Array.isArray(fetchedIds) ? fetchedIds : []) {
        const normalizedId = normalizeModelId(id);
        if (!normalizedId || merged.some((entry) => entry.id === normalizedId)) continue;
        merged = [...merged, { id: normalizedId, source: 'fetched' }];
    }
    return merged;
}

function getConservativeModel(provider, id) {
    const usesOpenAiImages = Boolean(provider?.transports?.openAiImages);
    return {
        id,
        label: id,
        transport: usesOpenAiImages ? 'openAiImages' : undefined,
        supportsReferenceImages: usesOpenAiImages ? false : undefined,
        supportsSize: false,
        status: 'local',
    };
}

export function mergeProviderModels(providerId, localEntries) {
    const provider = getProviderDefinition(providerId);
    if (!provider) return [];

    const seen = new Set();
    const models = [];
    const add = (model) => {
        if (!model?.id || seen.has(model.id)) return;
        seen.add(model.id);
        models.push(model);
    };

    for (const model of provider.models || []) add({ ...model });
    const hasStructuredRecords = Array.isArray(localEntries) && localEntries.some((entry) => entry?.source && typeof entry.source === 'object' || entry?.capabilities);
    if (hasStructuredRecords) {
        for (const entry of normalizeModelRecords(providerId, localEntries, provider)) {
            add({ ...(getModelDefinition(providerId, entry.id) || getConservativeModel(provider, entry.id)), id: entry.id, label: entry.label || entry.id, transport: entry.transportId || undefined, capabilities: entry.capabilities, source: entry.source });
        }
        return models;
    }
    for (const entry of normalizeEntries(localEntries)) {
        add({ ...(getModelDefinition(providerId, entry.id) || getConservativeModel(provider, entry.id)), ...entry });
    }
    return models;
}

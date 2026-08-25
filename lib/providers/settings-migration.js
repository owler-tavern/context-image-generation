import { getProviderDefinitions, getProviderDefinition } from './registry.js';
import { normalizeModelDefinition, normalizeProviderConnection, isSafeSecretRef } from './contracts.js';

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function validObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLegacyModels(providerId, entries, provider) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return normalizeModelDefinition({ ...entry, id, providerId, source: entry.source || 'manual' }, provider);
    }).filter(Boolean);
}

function safeLegacyModelEntries(entries) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) return null;
        seen.add(id);
        const result = { id, source: entry?.source === 'fetched' ? 'fetched' : 'manual' };
        if (typeof entry.transport === 'string' && entry.transport) result.transport = entry.transport;
        // These fields are retained only in the legacy compatibility mirror.
        if (typeof entry.supportsReferenceImages === 'boolean') result.supportsReferenceImages = entry.supportsReferenceImages;
        if (typeof entry.supportsSize === 'boolean') result.supportsSize = entry.supportsSize;
        return result;
    }).filter(Boolean);
}

const DISCOVERY_KINDS = new Set(['openai-list', 'native', 'curated-static', 'unsupported']);
const DISCOVERY_SOURCES = new Set(['provider /models endpoint', 'curated provider catalog', 'provider catalog', 'cancelled']);
const DISCOVERY_WARNING_CODES = new Set(['DISCOVERY_AUTH_FAILED', 'DISCOVERY_RATE_LIMITED', 'DISCOVERY_NETWORK', 'DISCOVERY_PROVIDER_FAILED', 'DISCOVERY_UNSUPPORTED', 'DISCOVERY_MISCONFIGURED', 'DISCOVERY_FAILED']);

function safeDiscoveryEvidence(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const evidence = {};
    if (DISCOVERY_KINDS.has(value.kind)) evidence.kind = value.kind;
    if (typeof value.observedAt === 'string' && !Number.isNaN(Date.parse(value.observedAt))) evidence.observedAt = new Date(value.observedAt).toISOString();
    if (DISCOVERY_SOURCES.has(value.source)) evidence.source = value.source;
    if (Number.isInteger(value.retryCount) && value.retryCount >= 0 && value.retryCount <= 2) evidence.retryCount = value.retryCount;
    return Object.keys(evidence).length ? evidence : undefined;
}

function safeModelDiscovery(value) {
    const input = validObject(value);
    const result = {};
    for (const [providerId, entry] of Object.entries(input)) {
        if (!getProviderDefinition(providerId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const safe = {};
        const evidence = safeDiscoveryEvidence(entry.evidence);
        if (evidence) safe.evidence = evidence;
        if (DISCOVERY_WARNING_CODES.has(entry.warning?.code)) safe.warning = { code: entry.warning.code };
        if (Object.keys(safe).length) result[providerId] = safe;
    }
    return result;
}

function quarantineItem(bucket, id, reason) {
    bucket.push({ id: typeof id === 'string' ? id.slice(0, 120) : '', reason });
}

/**
 * Add the Phase-A provider contracts to legacy extension settings. This never
 * removes or rewrites provider keys/model entries; new fields are a derived
 * compatibility projection and can be discarded independently.
 */
export function migrateProviderSettings(input = {}) {
    const settings = clone(validObject(input));
    const providerKeys = validObject(settings.provider_keys);
    if (typeof providerKeys.linkapi !== 'string' && typeof settings.linkapi_key === 'string' && settings.linkapi_key) providerKeys.linkapi = settings.linkapi_key;
    if ((!settings.linkapi_key || typeof settings.linkapi_key !== 'string') && typeof providerKeys.linkapi === 'string') settings.linkapi_key = providerKeys.linkapi;
    settings.provider_keys = providerKeys;
    const legacyModels = validObject(settings.provider_models);
    settings.provider_models = Object.fromEntries(Object.entries(legacyModels).map(([providerId, entries]) => [providerId, safeLegacyModelEntries(entries)]));
    settings.model_discovery = safeModelDiscovery(settings.model_discovery);

    const quarantineInput = validObject(settings.provider_contracts_quarantine);
    const quarantine = {
        connections: Array.isArray(quarantineInput.connections) ? quarantineInput.connections.filter((item) => item && typeof item.id === 'string' && typeof item.reason === 'string').map((item) => ({ id: item.id.slice(0, 120), reason: item.reason.slice(0, 160) })) : [],
        modelRecords: Array.isArray(quarantineInput.modelRecords) ? quarantineInput.modelRecords.filter((item) => item && typeof item.id === 'string' && typeof item.reason === 'string').map((item) => ({ id: item.id.slice(0, 120), reason: item.reason.slice(0, 160) })) : [],
    };

    const existingConnections = validObject(settings.connections);
    const connections = {};
    for (const [connectionId, entry] of Object.entries(existingConnections)) {
        const providerId = entry?.providerId || String(connectionId).split(':')[0];
        const provider = getProviderDefinition(providerId);
        if (!provider || !entry || typeof entry !== 'object' || !String(connectionId).startsWith(`${providerId}:`) || (entry.kind && !['browser-api-key', 'sillytavern-proxy', 'server-adapter'].includes(entry.kind)) || (entry.secretRef && !isSafeSecretRef(entry.secretRef, entry.kind, provider))) {
            quarantineItem(quarantine.connections, connectionId, 'malformed-or-unknown-provider');
            continue;
        }
        try {
            connections[connectionId] = normalizeProviderConnection({ ...entry, id: connectionId, providerId }, provider);
        } catch {
            quarantineItem(quarantine.connections, connectionId, 'invalid-connection');
        }
    }

    const existingModelRecords = validObject(settings.model_records);
    const modelRecords = {};
    for (const provider of getProviderDefinitions()) {
        const credentialKey = provider.credentialKey;
        const connectionId = `${provider.id}:default`;
        if (!connections[connectionId]) {
            connections[connectionId] = normalizeProviderConnection({
                id: connectionId,
                providerId: provider.id,
                kind: credentialKey ? 'browser-api-key' : 'sillytavern-proxy',
                secretRef: credentialKey ? `provider_keys.${credentialKey}` : undefined,
                enabled: true,
            }, provider);
        }
        if (Array.isArray(existingModelRecords[provider.id])) {
            modelRecords[provider.id] = [];
            for (const entry of existingModelRecords[provider.id]) {
                try {
                    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim() || (entry.providerId && entry.providerId !== provider.id)) throw new Error('invalid-model');
                    modelRecords[provider.id].push(normalizeModelDefinition({ ...entry, providerId: provider.id }, provider));
                } catch {
                    quarantineItem(quarantine.modelRecords, entry?.id, 'invalid-model-record');
                }
            }
        } else {
            modelRecords[provider.id] = normalizeLegacyModels(provider.id, legacyModels[provider.id], provider);
        }
    }

    for (const providerId of Object.keys(existingModelRecords)) {
        if (!getProviderDefinition(providerId)) quarantineItem(quarantine.modelRecords, providerId, 'unknown-provider');
    }

    const activeProvider = typeof settings.provider === 'string' && settings.provider ? settings.provider : getProviderDefinitions()[0]?.id || '';
    const activeModel = typeof settings.model === 'string' ? settings.model : '';
    const presets = validObject(settings.generation_presets);
    if (!presets.active) {
        presets.active = {
            id: 'legacy-active',
            connectionId: `${activeProvider}:default`,
            modelId: activeModel,
            options: {
                aspectRatio: settings.aspect_ratio || '',
                imageSize: settings.image_size || '',
                thinkingLevel: settings.thinking_level || '',
                useGoogleSearch: settings.use_google_search === true,
            },
        };
    }
    settings.connections = connections;
    settings.model_records = modelRecords;
    settings.provider_contracts_quarantine = quarantine;
    settings.generation_presets = presets;
    settings.provider_contracts_version = 1;
    return settings;
}

export function projectConnection(settings, providerId) {
    const migrated = migrateProviderSettings(settings);
    return migrated.connections?.[`${providerId}:default`];
}

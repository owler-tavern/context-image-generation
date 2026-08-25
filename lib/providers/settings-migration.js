import { getProviderDefinitions } from './registry.js';
import { normalizeModelDefinition, normalizeProviderConnection } from './contracts.js';

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
    settings.provider_models = legacyModels;

    const connections = validObject(settings.connections);
    const modelRecords = validObject(settings.model_records);
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
        if (!Array.isArray(modelRecords[provider.id])) modelRecords[provider.id] = normalizeLegacyModels(provider.id, legacyModels[provider.id], provider);
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
    settings.generation_presets = presets;
    settings.provider_contracts_version = 1;
    return settings;
}

export function projectConnection(settings, providerId) {
    const migrated = migrateProviderSettings(settings);
    return migrated.connections?.[`${providerId}:default`];
}

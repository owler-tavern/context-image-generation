import { migrateCustomConnections } from './custom-connections.js';
import { toLegacyModelEntries } from './model-manager.js';

export function getProviderModelEntries(settings, providerId) {
    const custom = migrateCustomConnections(settings?.custom_connections);
    if (custom.connections[providerId]) return custom.models[providerId] || [];
    const records = settings?.model_records?.[providerId];
    if (Array.isArray(records)) return records;
    const entries = settings?.provider_models?.[providerId];
    return Array.isArray(entries) ? entries : [];
}

export const getProviderModelRecords = getProviderModelEntries;

export function setProviderModelRecords(settings, providerId, records) {
    const custom = migrateCustomConnections(settings?.custom_connections);
    if (custom.connections[providerId]) {
        settings.custom_connections = migrateCustomConnections({
            ...custom,
            models: { ...custom.models, [providerId]: records },
        });
        return;
    }
    if (!settings.model_records || typeof settings.model_records !== 'object' || Array.isArray(settings.model_records)) settings.model_records = {};
    if (!settings.provider_models || typeof settings.provider_models !== 'object' || Array.isArray(settings.provider_models)) settings.provider_models = {};
    settings.model_records[providerId] = records;
    settings.provider_models[providerId] = toLegacyModelEntries(records);
}

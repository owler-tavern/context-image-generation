import { getChatBinding, migrateChatCanon } from './chat-canon.js';
import { materializeAppearanceAssets, migrateAppearanceLibrary } from './appearance-library.js';

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function operationReason(library, assetId) {
    const operation = Object.values(library.operations || {}).find((entry) => entry?.assetId === assetId && ['pending', 'deleting'].includes(entry?.status));
    return operation?.status === 'pending' ? 'pending-operation' : operation?.status === 'deleting' ? 'deleting' : null;
}

export function resolveEffectiveLook({ library: libraryValue, chatState, identityId, gallery = [] } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    const binding = getChatBinding(chatState, identityId);
    if (binding) {
        const look = identity?.looks?.find((entry) => entry.id === binding.activeLookId);
        if (!look) return { status: 'broken', source: 'chat', reason: 'missing-look', binding };
        if (look.assetId !== binding.expectedAssetId) return { status: 'broken', source: 'chat', reason: 'asset-mismatch', binding, look };
        const guarded = operationReason(library, look.assetId);
        if (guarded) return { status: 'broken', source: 'chat', reason: guarded, binding, look };
        const asset = materializeAppearanceAssets(library, gallery).assets[look.assetId];
        if (!asset) return { status: 'broken', source: 'chat', reason: 'missing-asset', binding, look };
        return { status: 'resolved', source: 'chat', binding, look, asset };
    }
    const look = identity?.looks?.find((entry) => entry.id === identity.activeLookId);
    if (!look) return { status: 'none', source: 'no-binding' };
    if (operationReason(library, look.assetId)) return { status: 'none', source: 'no-binding' };
    const asset = materializeAppearanceAssets(library, gallery).assets[look.assetId];
    return asset ? { status: 'resolved', source: 'legacy-default', look, asset } : { status: 'none', source: 'no-binding' };
}

function revisionOf(records) {
    const source = JSON.stringify(records);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `canon-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function resolveCanonReferenceSnapshot({ library: libraryValue, gallery = [], chatState, identities = [] } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const canon = migrateChatCanon(chatState);
    const unique = new Map();
    for (const identity of identities) {
        const id = String(identity?.id || '').trim();
        if (id && !unique.has(id)) unique.set(id, identity);
    }
    const references = [];
    const assets = {};
    const omissions = [];
    const revisionRecords = [];
    for (const [identityId, suppliedIdentity] of [...unique].sort(([left], [right]) => left.localeCompare(right))) {
        const result = resolveEffectiveLook({ library, gallery, chatState: canon, identityId });
        if (result.status === 'resolved') {
            const identity = library.identities[identityId] || suppliedIdentity;
            references.push({
                id: result.look.id,
                role: 'identity-look',
                identityId,
                assetId: result.look.assetId,
                label: identity.label || identityId,
                aliases: clone(identity.aliases || []),
            });
            assets[result.look.assetId] = clone(result.asset);
            revisionRecords.push([identityId, result.source, result.look.id, result.look.assetId]);
        } else if (result.status === 'broken') {
            const binding = result.binding || {};
            omissions.push({ identityId, lookId: binding.activeLookId, assetId: binding.expectedAssetId, reason: result.reason });
            revisionRecords.push([identityId, 'broken', binding.activeLookId, binding.expectedAssetId, result.reason]);
        } else {
            revisionRecords.push([identityId, 'none']);
        }
    }
    return deepFreeze({ references, assets, omissions, continuityRevision: revisionOf(revisionRecords) });
}

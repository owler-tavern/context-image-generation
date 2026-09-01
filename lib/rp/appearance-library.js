import { buildIdentityCatalogue, migrateRpLibrary, normalizeAlias } from './identities.js';

const APPEARANCE_SCHEMA = 1;

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function galleryArtifactId(item) {
    if (!isRecord(item)) return null;
    const explicitId = item.id || item.assetId || item.sourceMetadata?.artifactId;
    if (explicitId) return String(explicitId);
    if (item.url) return `url:${String(item.url)}`;
    return null;
}

function assetIdForGallery(item) {
    const artifactId = galleryArtifactId(item);
    return artifactId ? `asset:${artifactId}` : null;
}

function lookIdForGallery(item) {
    const artifactId = galleryArtifactId(item);
    return artifactId ? `look:${artifactId}` : null;
}

function sanitizeSourceMetadata(metadata) {
    if (!isRecord(metadata)) return undefined;
    const safe = clone(metadata);
    delete safe.data;
    delete safe.imageData;
    return safe;
}

function normalizeAsset(asset, fallbackId) {
    const source = isRecord(asset) ? asset : {};
    const id = String(source.id || fallbackId);
    const sourceRecord = isRecord(source.source) ? clone(source.source) : {};
    delete sourceRecord.data;
    delete sourceRecord.imageData;
    const normalized = {
        ...clone(source),
        id,
        kind: source.kind || 'gallery',
        source: sourceRecord,
        mimeType: source.mimeType || 'image/png',
    };
    // Appearance records must never become a second image store.
    delete normalized.data;
    delete normalized.imageData;
    if (normalized.kind !== 'appearance') delete normalized.url;
    return normalized;
}

function normalizeLook(look, fallbackId, fallbackAssetId) {
    const source = isRecord(look) ? look : {};
    const id = String(source.id || fallbackId);
    const assetId = String(source.assetId || fallbackAssetId || `asset:${id}`);
    const normalized = {
        ...clone(source),
        id,
        assetId,
        label: String(source.label || 'Saved appearance'),
        createdAt: Number.isFinite(source.createdAt) ? source.createdAt : null,
    };
    delete normalized.data;
    delete normalized.imageData;
    return normalized;
}

function normalizeIdentityLooks(identity) {
    if (!isRecord(identity)) return identity;
    const looks = Array.isArray(identity.looks) ? identity.looks : [];
    const seen = new Set();
    const normalizedLooks = looks.map((look) => normalizeLook(look, look?.id || `look:${identity.id}`, look?.assetId))
        .filter((look) => {
            if (seen.has(look.id)) return false;
            seen.add(look.id);
            return true;
        });
    const activeLookId = identity.activeLookId && normalizedLooks.some((look) => look.id === identity.activeLookId)
        ? identity.activeLookId
        : (normalizedLooks[0]?.id || null);
    return {
        ...clone(identity),
        looks: normalizedLooks,
        activeLookId,
    };
}

export function migrateAppearanceLibrary(value) {
    const base = migrateRpLibrary(value);
    const schema = Number(value?.schema) >= 2 ? 2 : APPEARANCE_SCHEMA;
    const identities = Object.fromEntries(
        Object.entries(base.identities).map(([id, identity]) => [id, normalizeIdentityLooks(identity)]),
    );
    const assets = Object.fromEntries(
        Object.entries(base.assets).map(([id, asset]) => [id, normalizeAsset(asset, id)]),
    );
    return {
        ...base,
        schema,
        identities,
        assets,
        ...(isRecord(value?.operations) ? { operations: clone(value.operations) } : {}),
        ...(typeof value?.revision === 'string' ? { revision: value.revision } : {}),
    };
}

export function listAppearanceIdentityChoices({ activeCharacter, persona, groupMembers = [], chatIdentities = [], currentChatId, library, chatState = null } = {}) {
    const scoped = (Array.isArray(chatIdentities) ? chatIdentities : Object.values(chatIdentities || {}))
        .filter((identity) => identity?.kind !== 'npc' || identity.chatId === currentChatId);
    const hostIds = [
        activeCharacter?.avatar ? `character:${activeCharacter.avatar}` : null,
        persona?.avatar ? `user:${persona.avatar}` : 'user:display',
        ...groupMembers.map((member) => member?.avatar ? `character:${member.avatar}` : null),
    ].filter(Boolean);
    const canon = isRecord(chatState) ? chatState : {};
    const explicitlyBound = [
        ...Object.keys(isRecord(canon.bindings) ? canon.bindings : {}),
        ...Object.keys(isRecord(canon.appearanceSources) ? canon.appearanceSources : {}),
        ...Object.keys(isRecord(canon.identityPins) ? canon.identityPins : {}),
        ...scoped.map((identity) => identity?.id),
    ];
    const merged = buildIdentityCatalogue({
        activeCharacter,
        persona,
        groupMembers,
        chatIdentities: scoped,
        library,
        currentChatId,
        allowedLibraryIdentityIds: [...new Set([...hostIds, ...explicitlyBound])],
    });
    return merged.filter((identity) => identity.kind !== 'npc' || identity.chatId === currentChatId);
}

function appearanceIdentityIsVisible(identity, currentChatId) {
    return identity?.kind !== 'npc' || identity.chatId === currentChatId;
}

export function listVisibleAppearanceEntries(libraryValue, { currentChatId } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const entries = [];
    for (const identity of Object.values(library.identities)) {
        if (!appearanceIdentityIsVisible(identity, currentChatId)) continue;
        for (const look of identity.looks || []) entries.push({ identity, look });
    }
    return entries;
}

export function removeVisibleAppearanceLook(libraryValue, identityId, lookId, { currentChatId } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    return appearanceIdentityIsVisible(identity, currentChatId)
        ? removeAppearanceLook(library, identityId, lookId)
        : library;
}

export function applyAppearanceLookRemoval({ library: libraryValue, identityId, lookId, currentChatId, confirmed } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    if (!appearanceIdentityIsVisible(identity, currentChatId) || !identity?.looks.some((look) => look.id === lookId)) {
        return { decision: 'not-found', library: libraryValue };
    }
    if (!confirmed) return { decision: 'cancelled', library: libraryValue };
    return {
        decision: 'removed',
        library: removeAppearanceLook(library, identityId, lookId),
    };
}

export function setVisibleAppearanceLook(libraryValue, identityId, lookId, { currentChatId } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    return appearanceIdentityIsVisible(identity, currentChatId)
        ? setActiveAppearanceLook(library, identityId, lookId)
        : library;
}

export function addAppearanceLook(libraryValue, { identity, galleryItem, label, now = Date.now() } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const artifactId = galleryArtifactId(galleryItem);
    const assetId = assetIdForGallery(galleryItem);
    const lookId = lookIdForGallery(galleryItem);
    if (!identity?.id || !artifactId || !assetId || !lookId) {
        return { library, look: null, reason: 'invalid-identity-or-gallery-item' };
    }

    const identityId = String(identity.id);
    const existingIdentity = library.identities[identityId] || {
        id: identityId,
        kind: identity.kind || 'npc',
        label: identity.label || identityId,
        aliases: [],
        hostKey: identity.hostKey ?? null,
        durable: identity.durable !== false,
        activeLookId: null,
        looks: [],
    };
    const normalizedIdentity = normalizeIdentityLooks({
        ...existingIdentity,
        ...clone(identity),
        id: identityId,
        looks: existingIdentity.looks || [],
    });
    const existingLook = normalizedIdentity.looks.find((look) => look.id === lookId);
    const look = existingLook || {
        id: lookId,
        assetId,
        label: String(label || galleryItem.prompt || 'Saved appearance').slice(0, 120),
        createdAt: Number.isFinite(now) ? now : Date.now(),
        source: { galleryId: galleryItem.id || null },
    };
    const sourceMetadata = sanitizeSourceMetadata(galleryItem.sourceMetadata);
    const asset = normalizeAsset({
        id: assetId,
        kind: 'gallery',
        source: {
            galleryId: galleryItem.id || null,
            url: galleryItem.url || null,
            ...(sourceMetadata ? { metadata: sourceMetadata } : {}),
        },
        mimeType: galleryItem.mimeType || 'image/png',
    }, assetId);

    library.identities[identityId] = {
        ...normalizedIdentity,
        aliases: [...new Set([normalizedIdentity.label, ...(normalizedIdentity.aliases || [])].map(normalizeAlias).filter(Boolean))],
        activeLookId: normalizedIdentity.activeLookId || lookId,
        looks: normalizedIdentity.looks.some((entry) => entry.id === lookId)
            ? normalizedIdentity.looks
            : [...normalizedIdentity.looks, look],
    };
    library.assets[assetId] = library.assets[assetId] || asset;
    return { library, look };
}

export function addPromotedAppearanceLook(libraryValue, { identity, asset, look } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    if (!identity?.id || !asset?.id || asset.kind !== 'appearance' || !asset.url || !look?.id || look.assetId !== asset.id) {
        return { library, look: null, reason: 'invalid-promoted-appearance' };
    }
    const identityId = String(identity.id);
    const existing = library.identities[identityId] || {
        id: identityId, kind: identity.kind || 'character', label: identity.label || identityId,
        aliases: [], hostKey: identity.hostKey ?? null, durable: identity.durable !== false,
        activeLookId: null, looks: [],
    };
    library.schema = 2;
    library.assets[asset.id] = normalizeAsset(asset, asset.id);
    library.identities[identityId] = normalizeIdentityLooks({
        ...existing,
        ...clone(identity),
        id: identityId,
        activeLookId: existing.activeLookId,
        looks: existing.looks.some((entry) => entry.id === look.id) ? existing.looks : [...existing.looks, normalizeLook(look, look.id, asset.id)],
    });
    library.identities[identityId].activeLookId = existing.activeLookId ?? null;
    return { library, look: library.identities[identityId].looks.find((entry) => entry.id === look.id) };
}

export function removeAppearanceLook(libraryValue, identityId, lookId) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    if (!identity) return library;
    const removed = identity.looks.find((look) => look.id === lookId);
    identity.looks = identity.looks.filter((look) => look.id !== lookId);
    if (identity.activeLookId === lookId) identity.activeLookId = null;
    if (removed?.assetId && !Object.values(library.identities).some((entry) => entry.looks.some((look) => look.assetId === removed.assetId))) {
        delete library.assets[removed.assetId];
    }
    return library;
}

export function setActiveAppearanceLook(libraryValue, identityId, lookId) {
    const library = migrateAppearanceLibrary(libraryValue);
    const identity = library.identities[String(identityId)];
    if (identity?.looks.some((look) => look.id === lookId)) identity.activeLookId = lookId;
    return library;
}

export function getProtectedGalleryArtifactIds(libraryValue) {
    const library = migrateAppearanceLibrary(libraryValue);
    const referencedAssetIds = new Set(Object.values(library.identities).flatMap((identity) => (identity.looks || []).map((look) => look.assetId)));
    const protectedIds = new Set();
    for (const asset of Object.values(library.assets).filter((entry) => referencedAssetIds.has(entry.id))) {
        const galleryId = asset.source?.galleryId;
        if (galleryId) protectedIds.add(String(galleryId));
    }
    return protectedIds;
}

export function applyGalleryImageDeletion({ gallery = [], targetArtifactId, targetItem, protectedIds = new Set(), confirmed } = {}) {
    const items = Array.isArray(gallery) ? gallery : [];
    const requestedArtifactId = typeof targetArtifactId === 'string' && targetArtifactId ? targetArtifactId : null;
    const targetIndex = requestedArtifactId
        ? items.findIndex((entry) => galleryArtifactId(entry) === requestedArtifactId)
        : items.indexOf(targetItem);
    const item = items[targetIndex];
    const artifactId = galleryArtifactId(item);
    if (!item) return { decision: 'not-found', gallery: items };
    if (artifactId && protectedIds.has(artifactId)) return { decision: 'protected', gallery: items };
    if (!confirmed) return { decision: 'cancelled', gallery: items };
    return { decision: 'deleted', gallery: items.filter((_entry, entryIndex) => entryIndex !== targetIndex) };
}

export function applyGalleryClear({ gallery = [], library: libraryValue = {}, confirmed } = {}) {
    if (!confirmed) return { decision: 'cancelled', gallery, library: libraryValue };
    return { decision: 'cleared', gallery: [], library: clone(libraryValue) };
}

function findLook(library, lookId) {
    for (const [identityId, identity] of Object.entries(library.identities || {})) {
        const look = (identity.looks || []).find((entry) => entry.id === lookId);
        if (look) return { identityId, identity, look };
    }
    return null;
}

export function planGlobalLookDeletion(libraryValue, lookId) {
    const library = migrateAppearanceLibrary(libraryValue);
    const found = findLook(library, String(lookId));
    if (!found) return { decision: 'not-found', nextLibrary: library, fileToDelete: null, sharedReferenceCount: 0 };
    const references = Object.values(library.identities).flatMap((identity) => identity.looks || []).filter((look) => look.assetId === found.look.assetId);
    const sharedReferenceCount = Math.max(0, references.length - 1);
    const asset = library.assets[found.look.assetId];
    return { decision: sharedReferenceCount ? 'remove-shared-look' : 'delete-owned-asset', nextLibrary: library, fileToDelete: sharedReferenceCount ? null : asset?.url || null, sharedReferenceCount, identityId: found.identityId, look: found.look, asset };
}

export function stageGlobalLookDeletion(libraryValue, lookId, operationId) {
    const plan = planGlobalLookDeletion(libraryValue, lookId);
    if (plan.decision === 'not-found') return { ...plan, libraryWithTombstone: plan.nextLibrary };
    const libraryWithTombstone = clone(plan.nextLibrary);
    libraryWithTombstone.operations = { ...(libraryWithTombstone.operations || {}), [String(operationId)]: {
        status: 'deleting', phase: 'staged', lookId: plan.look.id, identityId: plan.identityId,
        assetId: plan.look.assetId, url: plan.fileToDelete, sharedReferenceCount: plan.sharedReferenceCount,
    } };
    return { ...plan, libraryWithTombstone };
}

export function finalizeGlobalLookDeletion(libraryValue, operationId) {
    const library = migrateAppearanceLibrary(libraryValue);
    const operation = library.operations?.[String(operationId)];
    if (!operation || operation.status !== 'deleting') return library;
    const identity = library.identities[operation.identityId];
    if (identity) {
        identity.looks = (identity.looks || []).filter((look) => look.id !== operation.lookId);
        if (identity.activeLookId === operation.lookId) identity.activeLookId = null;
    }
    const stillShared = Object.values(library.identities).some((entry) => (entry.looks || []).some((look) => look.assetId === operation.assetId));
    if (!stillShared) delete library.assets[operation.assetId];
    delete library.operations[operationId];
    return library;
}

export function stageLegacyArtifactMigration(libraryValue, { operationId, galleryArtifactId, targetAssetId, targetUrl, mimeType, byteCount } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const legacyAssets = Object.values(library.assets).filter((asset) => asset?.kind !== 'appearance' && String(asset?.source?.galleryId || '') === String(galleryArtifactId || ''));
    if (!legacyAssets.length || !operationId || !targetAssetId || !targetUrl) throw new TypeError('A legacy Gallery artifact and deterministic migration target are required.');
    const sourceAssetIds = legacyAssets.map((asset) => asset.id);
    const mappings = [];
    for (const [identityId, identity] of Object.entries(library.identities)) {
        for (const look of identity.looks || []) if (sourceAssetIds.includes(look.assetId)) mappings.push({ identityId, lookId: look.id, sourceAssetId: look.assetId });
    }
    if (!mappings.length) throw new TypeError('The Gallery artifact has no saved looks to migrate.');
    library.operations = { ...(library.operations || {}), [operationId]: {
        status: 'pending-migration', phase: 'pending', galleryArtifactId: String(galleryArtifactId),
        sourceAssetId: sourceAssetIds[0], sourceAssetIds, targetAssetId: String(targetAssetId), targetUrl: String(targetUrl), mimeType, byteCount, mappings,
    } };
    return { library, operation: library.operations[operationId] };
}

export function listLegacyGalleryMigrationDependencies(libraryValue) {
    const library = migrateAppearanceLibrary(libraryValue);
    const referenced = new Set(Object.values(library.identities).flatMap((identity) => (identity.looks || []).map((look) => look.assetId)));
    const artifactIds = Object.values(library.assets)
        .filter((asset) => asset.kind !== 'appearance' && referenced.has(asset.id) && asset.source?.galleryId)
        .map((asset) => String(asset.source.galleryId));
    return [...new Set(artifactIds)].sort().map((galleryArtifactId) => ({ galleryArtifactId }));
}

export function projectAppearanceLookActionState(libraryValue, lookId, assetAvailable) {
    const library = migrateAppearanceLibrary(libraryValue);
    const deleting = Object.values(library.operations || {}).some((operation) => operation?.status === 'deleting' && operation.lookId === String(lookId));
    return { available: assetAvailable === true && !deleting, deleting };
}

export function finalizeLegacyArtifactMigration(libraryValue, operationId, { mimeType, byteCount, createdAt = Date.now() } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const operation = library.operations?.[String(operationId)];
    if (!operation || operation.status !== 'pending-migration') return library;
    library.assets[operation.targetAssetId] = normalizeAsset({ id: operation.targetAssetId, kind: 'appearance', url: operation.targetUrl, mimeType, byteCount, createdAt }, operation.targetAssetId);
    for (const mapping of operation.mappings || []) {
        const identity = library.identities[mapping.identityId];
        const look = identity?.looks?.find((entry) => entry.id === mapping.lookId);
        if (look && (operation.sourceAssetIds || [operation.sourceAssetId]).includes(look.assetId)) look.assetId = operation.targetAssetId;
    }
    for (const sourceAssetId of operation.sourceAssetIds || [operation.sourceAssetId]) {
        const stillUsed = Object.values(library.identities).some((identity) => (identity.looks || []).some((look) => look.assetId === sourceAssetId));
        if (!stillUsed) delete library.assets[sourceAssetId];
    }
    delete library.operations[operationId];
    library.schema = 2;
    return library;
}

export function trimGalleryToLimit(gallery = [], maxSize = 50, libraryValue = {}) {
    const protectedIds = getProtectedGalleryArtifactIds(libraryValue);
    const kept = [];
    let evictedCount = 0;
    for (const item of gallery) {
        const artifactId = galleryArtifactId(item);
        if (kept.length < maxSize || (artifactId && protectedIds.has(artifactId))) kept.push(item);
        else evictedCount++;
    }
    return { gallery: kept, evictedCount };
}

function galleryById(gallery = []) {
    const result = new Map();
    for (const item of gallery) {
        const artifactId = galleryArtifactId(item);
        if (artifactId) result.set(artifactId, item);
    }
    return result;
}

export function materializeAppearanceAssets(libraryValue, gallery = []) {
    const library = migrateAppearanceLibrary(libraryValue);
    const suppressedAssetIds = new Set(Object.values(library.operations || {}).filter((operation) => operation?.status === 'pending' || (operation?.status === 'deleting' && !(operation.sharedReferenceCount > 0))).map((operation) => operation.assetId));
    const galleryItems = galleryById(gallery);
    const assets = {};
    const unavailable = [];
    for (const [assetId, asset] of Object.entries(library.assets)) {
        if (suppressedAssetIds.has(assetId)) {
            unavailable.push(assetId);
            continue;
        }
        if (asset.kind === 'appearance' && asset.url) {
            assets[assetId] = { id: assetId, url: asset.url, mimeType: asset.mimeType || 'image/png' };
            continue;
        }
        const galleryId = asset.source?.galleryId;
        const item = galleryId ? galleryItems.get(galleryArtifactId({ id: galleryId })) || galleryItems.get(String(galleryId)) : null;
        if (!item || !item.url && !item.imageData) {
            unavailable.push(assetId);
            continue;
        }
        assets[assetId] = {
            id: assetId,
            ...(item.url ? { url: item.url } : { data: item.imageData }),
            mimeType: item.mimeType || asset.mimeType || 'image/png',
        };
    }
    return { assets, unavailable };
}

export function buildAppearanceReferenceCandidates(libraryValue, gallery = [], { currentChatId, allowedIdentityIds = null } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const availableAssets = new Set(Object.keys(materializeAppearanceAssets(library, gallery).assets));
    const allowed = Array.isArray(allowedIdentityIds) ? new Set(allowedIdentityIds.map((id) => String(id || '').trim()).filter(Boolean)) : null;
    const candidates = [];
    for (const identity of Object.values(library.identities)) {
        if (identity.kind === 'npc' && identity.chatId !== currentChatId) continue;
        if (allowed && !allowed.has(String(identity.id || ''))) continue;
        for (const look of identity.looks || []) {
            if (identity.activeLookId && look.id !== identity.activeLookId) continue;
            if (!availableAssets.has(look.assetId)) continue;
            candidates.push({
                id: look.id,
                role: 'identity-look',
                identityId: identity.id,
                assetId: look.assetId,
                label: identity.label,
                aliases: identity.aliases || [],
            });
        }
    }
    return candidates;
}

export function galleryArtifactKey(item) {
    return galleryArtifactId(item);
}

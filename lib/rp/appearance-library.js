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
    delete normalized.url;
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
    const identities = Object.fromEntries(
        Object.entries(base.identities).map(([id, identity]) => [id, normalizeIdentityLooks(identity)]),
    );
    const assets = Object.fromEntries(
        Object.entries(base.assets).map(([id, asset]) => [id, normalizeAsset(asset, id)]),
    );
    return {
        ...base,
        schema: APPEARANCE_SCHEMA,
        identities,
        assets,
    };
}

export function listAppearanceIdentityChoices({ activeCharacter, persona, groupMembers = [], chatIdentities = [], currentChatId, library } = {}) {
    const scoped = (Array.isArray(chatIdentities) ? chatIdentities : Object.values(chatIdentities || {}))
        .filter((identity) => identity?.kind !== 'npc' || identity.chatId === currentChatId);
    const merged = buildIdentityCatalogue({ activeCharacter, persona, groupMembers, chatIdentities: scoped, library });
    return merged.filter((identity) => identity.kind !== 'npc' || identity.chatId === currentChatId);
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
    const galleryItems = galleryById(gallery);
    const assets = {};
    const unavailable = [];
    for (const [assetId, asset] of Object.entries(library.assets)) {
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

export function buildAppearanceReferenceCandidates(libraryValue, gallery = [], { currentChatId } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const availableAssets = new Set(Object.keys(materializeAppearanceAssets(library, gallery).assets));
    const candidates = [];
    for (const identity of Object.values(library.identities)) {
        if (identity.kind === 'npc' && identity.chatId !== currentChatId) continue;
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

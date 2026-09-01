import { migrateAppearanceLibrary } from './appearance-library.js';
import { getChatBinding, migrateChatCanon } from './chat-canon.js';

export const VISIBLE_CANON_MIN_TOUCH_TARGET = 44;

function normalizeAvailableAssetIds(library, availableAssetIds) {
    if (availableAssetIds !== undefined) return new Set(Array.from(availableAssetIds || [], String));
    return new Set(Object.values(library.assets || {})
        .filter((asset) => asset?.url || asset?.data)
        .map((asset) => String(asset.id)));
}

/**
 * Projects the small amount of chat-scoped canon state that belongs beside an
 * inline generated image. This is intentionally read-only; mutations stay in
 * the existing appearance runtime/controllers.
 */
export function projectVisibleCanon({ library: libraryValue, chatState: chatStateValue, identityId, availableAssetIds } = {}) {
    const library = migrateAppearanceLibrary(libraryValue);
    const id = String(identityId || '');
    const identity = library.identities[id] || null;
    const binding = identity ? getChatBinding(chatStateValue, id) : null;
    const available = normalizeAvailableAssetIds(library, availableAssetIds);
    const looks = (identity?.looks || [])
        .filter((look) => available.has(String(look.assetId)))
        .map((look) => ({ id: look.id, label: look.label, assetId: look.assetId }));
    const activeLook = looks.find((look) => look.id === binding?.activeLookId) || null;

    return {
        identityId: id,
        identityLabel: identity?.label || 'Character',
        active: Boolean(activeLook),
        activeLookId: activeLook?.id || null,
        activeLookLabel: activeLook?.label || null,
        locked: activeLook ? binding?.isLocked === true : false,
        looks,
    };
}

export function visibleCanonStatus(projection) {
    if (!projection?.active) return `Identity: ${projection?.identityLabel || 'Character'} · No look active in this chat.`;
    return `Identity: ${projection.identityLabel} · Look: ${projection.activeLookLabel} · ${projection.locked ? 'Locked' : 'Unlocked'}`;
}

export function visibleCanonActionLabels(projection) {
    if (!projection?.active) return ['Remember character look', 'Change look'];
    return [
        'Remember character look',
        'Change look',
        projection.locked ? 'Unlock look' : 'Lock look',
        'Stop using look',
    ];
}

export function resolveVisibleCanonIdentityId({ fallbackIdentityId = '', media, messageId, gallery = [] } = {}) {
    const direct = String(media?.cig_identity_id || '').trim();
    if (direct) return direct;
    const galleryItem = (Array.isArray(gallery) ? gallery : []).find((item) => item?.url === media?.url && String(item?.messageId) === String(messageId));
    const linked = String(galleryItem?.cig_identity_id || galleryItem?.sourceMetadata?.cig_identity_id || '').trim();
    return linked || String(fallbackIdentityId || '');
}

export function linkVisibleCanonGalleryArtifact(item, { identityId, lookId } = {}) {
    const identity = String(identityId || '').trim();
    const look = String(lookId || '').trim();
    if (!item || !identity || !look) return item;
    return { ...item, cig_identity_id: identity, cig_look_id: look };
}

export function visibleCanonKeyActivation({ key } = {}) {
    return key === 'Enter' || key === ' ';
}

export function createVisibleCanonActionController({ actions = {}, refresh = () => {} } = {}) {
    return Object.freeze({
        async run(action, payload) {
            const handler = actions[action];
            if (typeof handler !== 'function') throw new TypeError(`Unknown visible canon action: ${action}`);
            const result = await handler(payload);
            refresh(result);
            return result;
        },
    });
}

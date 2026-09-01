import { migrateAppearanceLibrary } from './appearance-library.js';
import { getChatBinding, migrateChatCanon } from './chat-canon.js';

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
    if (!projection?.active) return 'No character look is active in this chat.';
    return `Active look: ${projection.activeLookLabel}. ${projection.locked ? 'Locked' : 'Unlocked'} for this chat.`;
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

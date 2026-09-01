const PRIOR_SCENE_ROLES = new Set(['legacy-previous', 'prior-scene']);

export function isPriorSceneReference(reference) {
    return PRIOR_SCENE_ROLES.has(String(reference?.role || reference?.sourceType || '').trim())
        || String(reference?.id || '').trim() === 'legacy:previous'
        || String(reference?.assetId || '').trim() === 'asset:previous';
}

/** Enforce the player's reference preference at the final dispatch boundary. */
export function enforcePreviousImagePolicy({ references = [], assets = {}, enabled = false } = {}) {
    if (enabled === true) return { references: [...references], assets: { ...assets } };

    const safeReferences = references.filter((reference) => !isPriorSceneReference(reference));
    const usedAssetIds = new Set(safeReferences.map((reference) => reference?.assetId).filter(Boolean));
    const safeAssets = Object.fromEntries(Object.entries(assets).filter(([assetId]) => (
        assetId !== 'asset:previous' && (usedAssetIds.has(assetId) || !String(assetId).startsWith('asset:scene'))
    )));
    return { references: safeReferences, assets: safeAssets };
}

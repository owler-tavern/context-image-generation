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

function emptyContribution() {
    return { references: [], assets: {}, truths: [], omissions: [], notices: [] };
}

function createOptionalContributor(id, enabled, contribute) {
    return Object.freeze({
        id,
        enabled,
        contribute: typeof contribute === 'function' ? contribute : async () => emptyContribution(),
    });
}

/**
 * Combine optional reference inputs without allowing any one input to become
 * a generation requirement.  The supplied order is preserved deliberately:
 * production composes avatar, previous image, then saved appearance.
 */
export function createReferenceContributorPipeline(contributors = []) {
    const ordered = Array.isArray(contributors) ? [...contributors] : [];
    return Object.freeze({
        async collect(snapshot, request) {
            const combined = emptyContribution();
            const referenceIds = new Set();
            for (const contributor of ordered) {
                if (!contributor) continue;
                if (typeof contributor.enabled === 'function' && contributor.enabled(snapshot, request) === false) continue;
                let value;
                try {
                    value = await contributor.contribute(snapshot, request);
                } catch (error) {
                    combined.notices.push({
                        contributor: contributor.id || 'optional-reference',
                        status: 'unavailable',
                        message: String(error?.message || error),
                    });
                    continue;
                }
                for (const [assetId, asset] of Object.entries(value?.assets || {})) {
                    if (Object.hasOwn(combined.assets, assetId)) throw new Error(`Duplicate reference asset: ${assetId}`);
                    combined.assets[assetId] = clone(asset);
                }
                for (const reference of value?.references || []) {
                    const id = String(reference?.id || '').trim();
                    if (!id || referenceIds.has(id)) throw new Error(`Duplicate or missing reference id: ${id || 'missing'}`);
                    referenceIds.add(id);
                    combined.references.push(clone(reference));
                }
                combined.truths.push(...(value?.truths || []).map(clone));
                combined.omissions.push(...(value?.omissions || []).map(clone));
                combined.notices.push(...(value?.notices || []).map(clone));
            }
            return deepFreeze(combined);
        },
    });
}

export function createAvatarReferenceContributor({ enabled = (snapshot) => snapshot?.referencesEnabled === true && snapshot?.avatarEnabled === true, contribute } = {}) {
    return createOptionalContributor('avatar', enabled, contribute);
}

export function createPreviousImageReferenceContributor({ enabled = (snapshot) => snapshot?.referencesEnabled === true && snapshot?.previousImageEnabled === true, contribute } = {}) {
    return createOptionalContributor('previous-image', enabled, contribute);
}

export function createSavedAppearanceReferenceContributor({ enabled = (snapshot) => snapshot?.savedAppearanceEnabled === true, contribute } = {}) {
    return createOptionalContributor('saved-appearance', enabled, contribute);
}

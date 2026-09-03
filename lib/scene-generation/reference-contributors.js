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

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function avatarReferencesUnavailableError() {
    const error = new Error('The selected avatar references could not be loaded. Check the character or persona avatar and try again.');
    error.code = 'AVATAR_REFERENCES_UNAVAILABLE';
    error.category = 'reference_unavailable';
    error.userMessage = 'The selected avatar references could not be loaded. Check the character or persona avatar and try again.';
    error.blockGeneration = true;
    return error;
}

/**
 * Capture the complete contributor input synchronously. Appearance-owned state
 * is selected only when Appearance Memory is enabled, so disabled appearance
 * storage cannot leak into identities, truth selection, or avatar policy.
 */
export function captureReferenceContributorSnapshot({
    referencesEnabled = false,
    avatarEnabled = false,
    previousImageEnabled = false,
    savedAppearanceEnabled = false,
    host = {},
    previous = {},
    appearance = null,
    sceneCast = [],
    castOverrides = [],
} = {}) {
    const selectedAppearance = savedAppearanceEnabled === true && appearance ? appearance : null;
    const identities = selectedAppearance?.identities ?? host.identities ?? [];
    const truths = selectedAppearance?.truths ?? host.truths ?? [];
    return deepFreeze(clone({
        referencesEnabled: referencesEnabled === true,
        identities,
        avatar: {
            enabled: avatarEnabled === true,
            identities,
            truths,
            activeCharacterAvatar: host.activeCharacterAvatar || '',
            personaAvatar: host.personaAvatar || '',
            groupCharacterAvatars: host.groupCharacterAvatars || [],
            assetSources: host.assetSources || {},
            sourcePreferences: selectedAppearance?.sourcePreferences || {},
            sceneCast: Array.isArray(sceneCast) ? sceneCast : [],
            castOverrides: Array.isArray(castOverrides) ? castOverrides : [],
        },
        previous: {
            enabled: previousImageEnabled === true,
            item: previous.item || null,
            label: previous.label || 'previous image',
        },
        saved: {
            enabled: savedAppearanceEnabled === true,
            input: selectedAppearance?.savedInput || null,
        },
    }));
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
        async collect(snapshot, request, context = {}) {
            const capturedSnapshot = deepFreeze(clone(snapshot || {}));
            const capturedRequest = deepFreeze(clone(request || {}));
            const combined = emptyContribution();
            const referenceIds = new Set();
            context.telemetry?.record('reference', 'started');
            try {
            for (const contributor of ordered) {
                throwIfAborted(context.signal);
                if (!contributor) continue;
                if (typeof contributor.enabled === 'function' && contributor.enabled(capturedSnapshot, capturedRequest) === false) continue;
                let value;
                try {
                    if (contributor.id === 'avatar') context.telemetry?.record('avatar', 'started');
                    value = await contributor.contribute(capturedSnapshot, capturedRequest, context);
                    if (contributor.id === 'avatar') context.telemetry?.record('avatar', 'completed');
                } catch (error) {
                    if (contributor.id === 'avatar') context.telemetry?.record('avatar', error?.name === 'AbortError' ? 'cancelled' : 'failed');
                    if (error?.name === 'AbortError' || context.signal?.aborted) throw error;
                    if (error?.blockGeneration === true) throw error;
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
            context.telemetry?.record('reference', 'completed');
            return deepFreeze(combined);
            } catch (error) {
                context.telemetry?.record('reference', error?.name === 'AbortError' ? 'cancelled' : 'failed');
                throw error;
            }
        },
    });
}

/**
 * Standard production adapters over an already captured snapshot. Dependencies
 * receive only snapshot-owned data; they never need live host or chat globals.
 */
export function createCapturedReferenceContributors({
    resolveAvatarReferences = () => [],
    materializeAvatarAssets = async () => ({}),
    materializePreviousImage = async () => null,
    resolveSavedAppearance = () => ({ references: [], assets: {}, omissions: [] }),
} = {}) {
    return Object.freeze([
        createAvatarReferenceContributor({
            enabled: (snapshot) => snapshot?.referencesEnabled === true && snapshot?.avatar?.enabled === true,
            contribute: async (snapshot, _request, context) => {
                const input = snapshot.avatar || {};
                const references = input.enabled === true ? resolveAvatarReferences(input) : [];
                const assets = await materializeAvatarAssets(input, references, context);
                const intended = references.filter((reference) => reference?.role === 'host-avatar' && reference?.assetId);
                const unavailable = intended.filter((reference) => !assets?.[reference.assetId]);
                if (intended.length > 0 && unavailable.length === intended.length) throw avatarReferencesUnavailableError();
                return {
                    references,
                    assets,
                    truths: input.truths || [],
                    omissions: unavailable.map((reference) => ({ id: reference.id, reason: 'asset-unavailable', contributor: 'avatar' })),
                    notices: unavailable.length ? [{
                        contributor: 'avatar', status: 'partial',
                        message: `${unavailable.length} avatar reference${unavailable.length === 1 ? '' : 's'} could not be loaded and will be omitted.`,
                    }] : [],
                };
            },
        }),
        createPreviousImageReferenceContributor({
            enabled: (snapshot) => snapshot?.referencesEnabled === true && snapshot?.previous?.enabled === true,
            contribute: async (snapshot) => {
                const input = snapshot.previous || {};
                if (!input.item) return emptyContribution();
                const dataUrl = await materializePreviousImage(input.item);
                return {
                    references: [{ id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:previous', label: input.label || 'previous image' }],
                    assets: dataUrl ? { 'asset:previous': { url: dataUrl, mimeType: input.item.mimeType || 'image/png' } } : {},
                    truths: [],
                    omissions: dataUrl ? [] : [{ id: 'legacy:previous', reason: 'asset-unavailable' }],
                    notices: [],
                };
            },
        }),
        createSavedAppearanceReferenceContributor({
            enabled: (snapshot) => snapshot?.referencesEnabled === true && snapshot?.saved?.enabled === true && snapshot?.saved?.input != null,
            contribute: async (snapshot) => {
                const resolved = resolveSavedAppearance(snapshot.saved.input) || {};
                return {
                    references: resolved.references || [],
                    assets: resolved.assets || {},
                    truths: [],
                    omissions: resolved.omissions || [],
                    notices: resolved.notices || [],
                };
            },
        }),
    ]);
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

import { resolveCanonReferenceSnapshot } from './canon-reference-resolver.js';
import { resolveAppearanceTruth } from './appearance-truth.js';

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

export function resolveHostAvatarIdentityReferences({ identities = [], activeCharacterAvatar, personaAvatar, groupCharacterAvatars = [], sourcePreferences = {} } = {}) {
    const preferenceFor = (identity) => typeof sourcePreferences === 'function' ? sourcePreferences(identity) : sourcePreferences?.[identity?.id] || {};
    const isAvatarAllowed = (identity, avatarKey) => resolveAppearanceTruth({
        identity,
        avatar: avatarKey ? { path: avatarKey, characterId: identity?.id } : null,
        sourcePreference: preferenceFor(identity)?.sourceType || preferenceFor(identity)?.sourcePreference || 'auto',
    }).sourceType === 'avatar';
    const characterId = activeCharacterAvatar ? `character:${activeCharacterAvatar}` : '';
    const personaId = personaAvatar ? `user:${personaAvatar}` : 'user:display';
    const character = identities.find((identity) => identity?.kind === 'character' && (identity.id === characterId || identity.hostKey === activeCharacterAvatar));
    const persona = identities.find((identity) => identity?.kind === 'user' && (identity.id === personaId || identity.hostKey === personaAvatar));
    const group = (Array.isArray(groupCharacterAvatars) ? groupCharacterAvatars : [])
        .map((avatar) => identities.find((identity) => identity?.kind === 'character' && identity.hostKey === avatar))
        .filter((identity) => identity && identity.id !== character?.id)
        .map((identity) => ({ id: `host:character:${identity.id}`, role: 'host-avatar', identityId: identity.id, sourceId: identity.id, assetId: `asset:host-character:${identity.id}`, label: identity.label || identity.id }));
    return [
        ...(character && isAvatarAllowed(character, activeCharacterAvatar) ? [{ id: 'host:character', role: 'host-avatar', identityId: character.id, sourceId: character.id, assetId: 'asset:host-character', label: character.label || 'character' }] : []),
        ...(persona && isAvatarAllowed(persona, personaAvatar) ? [{ id: 'host:user', role: 'host-avatar', identityId: persona.id, sourceId: persona.id, assetId: 'asset:host-user', label: persona.label || 'user' }] : []),
        ...group,
    ].filter((reference) => {
        const identity = identities.find((entry) => entry?.id === reference.identityId);
        return reference.role !== 'host-avatar' || isAvatarAllowed(identity, identity?.hostKey || identity?.id?.replace(/^(?:character|user):/u, ''));
    });
}

/**
 * Keep host-avatar selection scoped to the interpreted scene when that cast is
 * confident or an author explicitly corrected it.  Empty/low-confidence
 * inference deliberately retains the v2 character/persona fallback.
 */
export function selectSceneRelevantAvatarReferences({ references = [], sceneCast = [], castOverrides = [] } = {}) {
    const availableReferences = Array.isArray(references) ? references : [];
    const overrides = Array.isArray(castOverrides) ? castOverrides : [];
    const hasExplicitCorrection = overrides.length > 0;
    const hasForcedInclusion = overrides.some((entry) => ['include', 'focus'].includes(entry?.action));
    const confidentCast = (Array.isArray(sceneCast) ? sceneCast : []).filter((entry) => (
        entry?.identityId && ['high', 'medium'].includes(entry.confidence)
    ));
    if (confidentCast.length === 0 && (!hasExplicitCorrection || !hasForcedInclusion)) {
        const excludedIds = new Set(overrides.filter((entry) => entry?.action === 'exclude').map((entry) => entry.identityId));
        return clone(availableReferences.filter((reference) => !excludedIds.has(reference?.identityId)));
    }
    const selectedIds = new Set(confidentCast.map((entry) => entry.identityId));
    for (const override of overrides) {
        if (['include', 'focus'].includes(override?.action)) selectedIds.add(override.identityId);
        if (override?.action === 'exclude') selectedIds.delete(override.identityId);
    }
    return clone(availableReferences.filter((reference) => selectedIds.has(reference?.identityId)));
}

export function isCanonReferenceOmission(omission) {
    return omission?.contributor !== 'avatar';
}

export function captureCanonForGeneration({ library, gallery = [], chatState, identities = [], references = [] } = {}) {
    const canonSnapshot = resolveCanonReferenceSnapshot({ library, gallery, chatState, identities });
    const resolvedIdentityIds = new Set(canonSnapshot.references.map((reference) => reference.identityId));
    const fallbackReferences = (Array.isArray(references) ? references : []).filter((reference) => (
        reference?.role !== 'host-avatar' || !resolvedIdentityIds.has(reference.identityId)
    ));
    return deepFreeze({
        canonSnapshot,
        references: clone(fallbackReferences),
    });
}

export function notifyBrokenCanon(omissions = [], notify = () => {}) {
    if (!omissions.length) return false;
    notify('Saved look unavailable. Using avatar and description.');
    return true;
}

import { resolveCanonReferenceSnapshot } from './canon-reference-resolver.js';

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

export function resolveHostAvatarIdentityReferences({ identities = [], activeCharacterAvatar, personaAvatar, groupCharacterAvatars = [] } = {}) {
    const characterId = activeCharacterAvatar ? `character:${activeCharacterAvatar}` : '';
    const personaId = personaAvatar ? `user:${personaAvatar}` : 'user:display';
    const character = identities.find((identity) => identity?.kind === 'character' && (identity.id === characterId || identity.hostKey === activeCharacterAvatar));
    const persona = identities.find((identity) => identity?.kind === 'user' && (identity.id === personaId || identity.hostKey === personaAvatar));
    const group = (Array.isArray(groupCharacterAvatars) ? groupCharacterAvatars : [])
        .map((avatar) => identities.find((identity) => identity?.kind === 'character' && identity.hostKey === avatar))
        .filter((identity) => identity && identity.id !== character?.id)
        .map((identity) => ({ id: `host:character:${identity.id}`, role: 'host-avatar', identityId: identity.id, assetId: `asset:host-character:${identity.id}`, label: identity.label || identity.id }));
    return [
        ...(character ? [{ id: 'host:character', role: 'host-avatar', identityId: character.id, assetId: 'asset:host-character', label: character.label || 'character' }] : []),
        ...(persona ? [{ id: 'host:user', role: 'host-avatar', identityId: persona.id, assetId: 'asset:host-user', label: persona.label || 'user' }] : []),
        ...group,
    ];
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

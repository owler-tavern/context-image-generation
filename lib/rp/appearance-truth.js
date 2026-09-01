const GENERIC_AVATAR_NAMES = /(?:^|[\/_-])(?:default|generic|placeholder|blank|no[-_ ]?avatar)(?:[\/_\-.]|$)/iu;

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

export function normalizeTrait(value) {
    if (isRecord(value)) {
        const key = String(value.key ?? value.name ?? value.trait ?? '').trim().toLocaleLowerCase('und');
        const text = String(value.text ?? value.description ?? value.value ?? '').trim();
        return key && text ? { key, value: value.value == null ? null : String(value.value).trim(), text } : null;
    }
    const text = String(value ?? '').trim();
    return text ? { key: text.toLocaleLowerCase('und'), value: null, text } : null;
}

function avatarPayload(avatar) {
    if (!isRecord(avatar)) return null;
    const url = String(avatar.url ?? avatar.path ?? '').trim();
    const data = String(avatar.data ?? avatar.imageData ?? '').trim();
    return url || data ? clone(avatar) : null;
}

function avatarIdentityId(avatar) {
    return String(avatar?.identityId ?? avatar?.characterId ?? avatar?.ownerId ?? avatar?.characterKey ?? '').trim();
}

function avatarRejection(avatar, identityId) {
    if (!avatarPayload(avatar)) return { reason: 'missing-avatar' };
    const suppliedIdentityId = avatarIdentityId(avatar);
    if (!suppliedIdentityId) return { reason: 'not-character-specific' };
    if (suppliedIdentityId !== identityId) return { reason: 'different-identity', avatarIdentityId: suppliedIdentityId };
    if (avatar.isDefault === true || avatar.isGeneric === true || avatar.isPlaceholder === true) return { reason: 'generic-avatar' };
    const name = String(avatar.name ?? avatar.filename ?? avatar.url ?? avatar.path ?? '').trim();
    if (GENERIC_AVATAR_NAMES.test(name)) return { reason: 'generic-avatar' };
    return null;
}

function visibleTraitKeys(avatar) {
    const values = avatar?.visibleTraits ?? avatar?.establishedTraits ?? avatar?.traits ?? [];
    const traits = isRecord(values) ? Object.entries(values).map(([key, value]) => ({ key, value, text: value })) : Array.isArray(values) ? values : [values];
    return new Set(traits.map(normalizeTrait).filter(Boolean).map((trait) => trait.key));
}

/**
 * Resolve the non-provider appearance truth for one stable identity.
 * A character-specific, non-placeholder avatar is authoritative. Written text
 * is retained as a fallback and may contribute only unestablished traits.
 */
export function resolveAppearanceTruth({ identity, avatar, description, textTraits = [] } = {}) {
    const identityId = String(identity?.id ?? '').trim();
    const effectiveAvatar = avatar ?? identity?.avatar;
    const effectiveDescription = description ?? identity?.description;
    const avatarRecord = avatarPayload(effectiveAvatar);
    const rejection = avatarRejection(effectiveAvatar, identityId);
    const evidence = [];
    if (!identityId) evidence.push({ source: 'identity', decision: 'rejected', reason: 'missing-identity' });

    if (!rejection && identityId) {
        evidence.push({ source: 'avatar', decision: 'selected', reason: 'character-specific', identityId });
    } else {
        evidence.push({
            source: 'avatar', decision: 'rejected', ...(rejection || { reason: 'missing-identity' }),
            ...(identityId ? { identityId } : {}),
        });
    }

    const descriptionText = String(isRecord(effectiveDescription) ? effectiveDescription.text ?? effectiveDescription.description ?? '' : effectiveDescription ?? '').trim();
    const sourceType = !rejection && identityId ? 'avatar' : descriptionText ? 'description' : 'none';
    if (descriptionText) evidence.push({ source: 'description', decision: sourceType === 'description' ? 'selected-fallback' : 'available-as-fallback' });
    else evidence.push({ source: 'description', decision: 'unavailable' });

    const established = sourceType === 'avatar' ? visibleTraitKeys(avatarRecord) : new Set();
    const textValues = isRecord(textTraits) ? Object.entries(textTraits).map(([key, value]) => ({ key, value, text: value })) : Array.isArray(textTraits) ? textTraits : [textTraits];
    const normalizedTraits = textValues.map(normalizeTrait).filter(Boolean);
    const addedTraits = normalizedTraits.filter((trait) => !established.has(trait.key));
    const omittedTraits = normalizedTraits.filter((trait) => established.has(trait.key));
    for (const trait of addedTraits) evidence.push({ source: 'text', decision: 'trait-added', trait: clone(trait) });
    for (const trait of omittedTraits) evidence.push({ source: 'text', decision: 'trait-omitted-visible', trait: clone(trait) });

    const result = {
        identityId: identityId || null,
        sourceType,
        source: sourceType === 'avatar' ? avatarRecord : sourceType === 'description' ? { text: descriptionText } : null,
        textTraits: addedTraits,
        evidence,
    };
    return freeze(result);
}

export const decideAppearanceTruth = resolveAppearanceTruth;
export const isCharacterSpecificAvatar = (avatar, identityId) => !avatarRejection(avatar, String(identityId ?? '').trim());

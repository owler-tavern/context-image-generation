const IDENTITY_KINDS = new Set(['character', 'user', 'npc']);
const STABLE_ID_PREFIX = /^(?:character|user|persona|npc):/u;

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Host-derived IDs are opaque keys, not display labels. Character/persona
 * avatar filenames may contain spaces; NPC keys may contain chat and name
 * segments (for example npc:chat-42:Captain Mira Vale).
 */
export function isStableIdentityId(value) {
    const id = String(value ?? '').trim();
    const segments = id.split(':').slice(1);
    const hasRequiredSegments = id.startsWith('npc:') ? segments.length >= 2 && segments.slice(0, 2).every((segment) => segment.trim()) : segments.some((segment) => segment.trim());
    return Boolean(id && STABLE_ID_PREFIX.test(id) && !/[\\/\u0000-\u001f\u007f]/u.test(id) && hasRequiredSegments);
}

export function normalizeStableIdentityId(value) {
    const id = String(value ?? '').trim();
    return isStableIdentityId(id) ? id : null;
}

export const isCanonicalIdentityId = isStableIdentityId;

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

export function normalizeAlias(value) {
    return String(value ?? '').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();
}

function identityRecord(record, fallbackId, fallbackKind = 'npc') {
    const source = isRecord(record) ? record : {};
    const id = String(source.id || fallbackId);
    const kind = IDENTITY_KINDS.has(source.kind) ? source.kind : fallbackKind;
    const label = String(source.label || id);
    const aliases = [...new Set([label, ...(Array.isArray(source.aliases) ? source.aliases : [])].map(normalizeAlias).filter(Boolean))];
    return {
        ...clone(source),
        id,
        kind,
        label,
        aliases,
        hostKey: source.hostKey ?? null,
        durable: source.durable !== false,
        activeLookId: source.activeLookId ?? null,
        looks: Array.isArray(source.looks) ? clone(source.looks) : [],
    };
}

export function migrateRpLibrary(value) {
    const source = isRecord(value) ? value : {};
    const identities = isRecord(source.identities) ? Object.fromEntries(
        Object.entries(source.identities).map(([id, record]) => [id, identityRecord(record, id)]),
    ) : {};
    const assets = isRecord(source.assets) ? clone(source.assets) : {};
    const preferences = isRecord(source.preferences) ? clone(source.preferences) : {};
    preferences.sceneContinuity = preferences.sceneContinuity === true;
    return { schema: 1, identities, assets, preferences };
}

function hostIdentity(record, kind, fallbackIndex) {
    const source = isRecord(record) ? record : {};
    const hostKey = source.avatar || source.hostKey || source.id || null;
    const durable = Boolean(hostKey);
    const id = kind === 'user'
        ? `user:${hostKey || 'display'}`
        : `${kind === 'character' ? 'character' : 'npc'}:${hostKey || `display-${fallbackIndex}`}`;
    return identityRecord({
        id,
        kind,
        label: source.name || source.label || id,
        aliases: source.aliases,
        hostKey,
        durable,
    }, id, kind);
}

function mergeIdentity(existing, incoming) {
    if (!existing) return incoming;
    return identityRecord({
        ...existing,
        ...incoming,
        aliases: [...(existing.aliases || []), ...(incoming.aliases || [])],
        looks: existing.looks?.length ? existing.looks : incoming.looks,
        activeLookId: existing.activeLookId ?? incoming.activeLookId,
        durable: existing.durable !== false && incoming.durable !== false,
    }, existing.id, existing.kind);
}

export function buildIdentityCatalogue({
    activeCharacter,
    persona,
    groupMembers = [],
    library,
    chatIdentities = [],
} = {}) {
    const result = new Map();
    const add = (identity) => result.set(identity.id, mergeIdentity(result.get(identity.id), identity));
    if (activeCharacter) add(hostIdentity(activeCharacter, 'character', 0));
    if (persona) add(hostIdentity(persona, 'user', 0));
    for (let index = 0; index < groupMembers.length; index++) add(hostIdentity(groupMembers[index], 'character', index + 1));

    const libraryIdentities = isRecord(library?.identities) ? Object.values(library.identities) : [];
    for (const identity of libraryIdentities) add(identityRecord(identity, identity.id));
    for (const identity of Array.isArray(chatIdentities) ? chatIdentities : Object.values(chatIdentities || {})) {
        if (identity?.id) add(identityRecord(identity, identity.id));
    }
    return [...result.values()];
}

function wordTokens(text) {
    const normalized = normalizeAlias(text);
    if (!normalized) return [];
    if (typeof Intl?.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
        return [...segmenter.segment(normalized)].filter((segment) => segment.isWordLike).map((segment) => segment.segment);
    }
    return normalized.match(/[\p{L}\p{N}]+/gu) || [];
}

function containsPhrase(textTokens, phraseTokens) {
    if (!phraseTokens.length || phraseTokens.length > textTokens.length) return false;
    for (let index = 0; index <= textTokens.length - phraseTokens.length; index++) {
        if (phraseTokens.every((token, offset) => token === textTokens[index + offset])) return true;
    }
    return false;
}

export function findMentionedIdentities(text, identities = []) {
    const textTokens = wordTokens(text);
    if (!textTokens.length) return [];
    const aliasOwners = new Map();
    for (const identity of identities) {
        const aliases = [...new Set([identity.label, ...(identity.aliases || [])].map(normalizeAlias).filter(Boolean))];
        for (const alias of aliases) {
            const owners = aliasOwners.get(alias) || new Set();
            owners.add(identity.id);
            aliasOwners.set(alias, owners);
        }
    }

    const mentionedIds = new Set();
    for (const [alias, owners] of aliasOwners) {
        if (owners.size !== 1 || !containsPhrase(textTokens, wordTokens(alias))) continue;
        mentionedIds.add([...owners][0]);
    }
    return identities.filter((identity) => mentionedIds.has(identity.id));
}

export function resolveIdentityMention(text, identities = []) {
    const matches = findMentionedIdentities(text, identities);
    return matches.length === 1 ? matches[0] : null;
}

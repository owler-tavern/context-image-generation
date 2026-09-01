const ACTIONS = new Set(['auto', 'include', 'focus', 'exclude']);
const MAX_CANDIDATES = 12;
const INELIGIBLE_KINDS = new Set(['narrator', 'gm', 'system', 'assistant']);

function text(value, max = 120) {
    const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return normalized.length <= max ? normalized : normalized.slice(0, max);
}

function identityId(value) {
    const id = text(value?.identityId || value?.id, 160);
    return id || null;
}

function identityLabel(value, fallback = 'Character') {
    return text(value?.label || value?.name || fallback, 120) || fallback;
}

export function validateDirectorCastOverrides(value, { identities = [], cast = [] } = {}) {
    const known = new Set([
        ...(Array.isArray(identities) ? identities : []).map(identityId),
        ...(Array.isArray(cast) ? cast : []).map(identityId),
    ].filter(Boolean));
    const invalidIdentityIds = [...new Set((Array.isArray(value) ? value : [])
        .map(identityId)
        .filter((id) => id && !known.has(id)))].slice(0, 12);
    return {
        valid: invalidIdentityIds.length === 0,
        invalidIdentityIds,
        overrides: normalizeDirectorCastOverrides(value, { allowedIdentityIds: known }),
    };
}

export function normalizeDirectorCastOverrides(value, { allowedIdentityIds = null } = {}) {
    const byId = new Map();
    const allowed = allowedIdentityIds ? new Set([...allowedIdentityIds].map((entry) => String(entry))) : null;
    for (const entry of Array.isArray(value) ? value : []) {
        const id = identityId(entry);
        const action = String(entry?.action || '').trim().toLowerCase();
        if (!id || !ACTIONS.has(action) || (allowed && !allowed.has(id))) continue;
        byId.set(id, { identityId: id, action });
    }
    let focused = null;
    for (const entry of byId.values()) {
        if (entry.action !== 'focus') continue;
        if (focused) focused.action = 'include';
        focused = entry;
    }
    return [...byId.values()].slice(0, 12);
}

export function inferDirectorCast({ interpretation = {}, identities = [] } = {}) {
    const known = (Array.isArray(identities) ? identities : [])
        .map((identity, index) => ({ identity, id: identityId(identity), index, kind: String(identity?.kind || '').toLowerCase() }))
        .filter(({ id, kind }) => id && !INELIGIBLE_KINDS.has(kind));
    const identityById = new Map(known.map(({ id, identity }) => [id, identity]));
    const candidates = new Map();
    for (const entry of Array.isArray(interpretation?.cast) ? interpretation.cast : []) {
        const id = identityId(entry);
        if (!id || !identityById.has(id)) continue;
        const identity = identityById.get(id);
        candidates.set(id, { identityId: id, label: identityLabel(identity, entry.label), kind: text(identity.kind || entry.kind, 40) || 'character', action: 'include', inferredAction: 'include', confidence: text(entry.confidence, 40) || 'medium' });
    }
    for (const entry of Array.isArray(interpretation?.excluded) ? interpretation.excluded : []) {
        const id = identityId(entry);
        if (!id || !identityById.has(id) || candidates.has(id)) continue;
        const identity = identityById.get(id);
        candidates.set(id, { identityId: id, label: identityLabel(identity), kind: text(identity.kind, 40) || 'character', action: 'exclude', inferredAction: 'exclude', confidence: 'medium' });
    }
    const inferred = [...candidates.values()];
    const inferredIds = new Set(inferred.map(({ identityId: id }) => id));
    // Interpretation evidence is always shown first. For the remaining known
    // identities, retain the host catalogue order: it is stable, puts the
    // active character/persona in its normal position, and makes the bounded
    // twelve-candidate overflow deterministic without inventing a cast.
    const remaining = known
        .filter(({ id }) => !inferredIds.has(id))
        .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
        .map(({ id, identity }) => ({
            identityId: id,
            label: identityLabel(identity),
            kind: text(identity.kind, 40) || 'character',
            action: 'auto',
            inferredAction: 'auto',
            confidence: 'low',
        }));
    return [...inferred, ...remaining].slice(0, MAX_CANDIDATES);
}

export function applyDirectorCastOverrides({ cast = [], identities = [], overrides = [] } = {}) {
    const knownIds = new Set([
        ...(Array.isArray(identities) ? identities : []).map(identityId),
        ...(Array.isArray(cast) ? cast : []).map(identityId),
    ].filter(Boolean));
    const normalized = normalizeDirectorCastOverrides(overrides, { allowedIdentityIds: knownIds });
    const identityById = new Map((Array.isArray(identities) ? identities : []).map((identity) => [identityId(identity), identity]));
    const castById = new Map((Array.isArray(cast) ? cast : []).map((entry) => [identityId(entry), entry]).filter(([id]) => id));
    const omitted = [];
    let focusedIdentityId = null;
    for (const override of normalized) {
        if (override.action === 'auto') continue;
        const identity = identityById.get(override.identityId);
        const existing = castById.get(override.identityId);
        const label = identityLabel(identity || existing);
        if (override.action === 'exclude') {
            castById.delete(override.identityId);
            omitted.push({ identityId: override.identityId, label });
        } else {
            castById.set(override.identityId, {
                ...(existing || {}),
                identityId: override.identityId,
                label,
                kind: text(identity?.kind || existing?.kind, 40) || 'character',
            });
            if (override.action === 'focus') focusedIdentityId = override.identityId;
        }
    }
    const focusedLabel = focusedIdentityId ? identityLabel(identityById.get(focusedIdentityId) || castById.get(focusedIdentityId)) : null;
    const omittedLabels = omitted.map((entry) => entry.label).join(', ');
    return {
        cast: [...castById.values()],
        excluded: omitted.map(({ identityId }) => identityId),
        focusedIdentityId,
        overrides: normalized,
        promptLine: [
            omittedLabels ? `Do not depict: ${omittedLabels}.` : '',
            normalized.filter((entry) => entry.action === 'include').map((entry) => identityLabel(identityById.get(entry.identityId) || castById.get(entry.identityId))).length
                ? `Include in cast: ${normalized.filter((entry) => entry.action === 'include').map((entry) => identityLabel(identityById.get(entry.identityId) || castById.get(entry.identityId))).join(', ')}.`
                : '',
            focusedLabel ? `Composition priority: ${focusedLabel}.` : '',
        ].filter(Boolean).join(' '),
    };
}

export function applyDirectorCastToReferences({ references = [], overrides = [] } = {}) {
    const normalized = normalizeDirectorCastOverrides(overrides);
    const excluded = new Set(normalized.filter((entry) => entry.action === 'exclude').map((entry) => entry.identityId));
    const forced = new Map(normalized.filter((entry) => entry.action === 'include' || entry.action === 'focus').map((entry, index) => [entry.identityId, { ...entry, index }]));
    const omitted = [];
    const remaining = [];
    for (const reference of Array.isArray(references) ? references : []) {
        const identity = identityId(reference);
        if (identity && excluded.has(identity)) {
            omitted.push({ ...reference, reason: 'cast-excluded' });
            continue;
        }
        remaining.push(reference);
    }
    remaining.sort((left, right) => {
        const a = forced.get(identityId(left));
        const b = forced.get(identityId(right));
        if (a && b) return (a.action === 'focus' ? 0 : 1) - (b.action === 'focus' ? 0 : 1) || a.index - b.index;
        if (a) return -1;
        if (b) return 1;
        return 0;
    });
    return {
        references: remaining,
        omitted,
        forcedIdentityIds: remaining.filter((reference) => forced.has(identityId(reference))).map((reference) => identityId(reference)),
    };
}

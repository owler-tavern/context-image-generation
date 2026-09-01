const ACTIONS = new Set(['include', 'focus', 'exclude']);

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
    return [...byId.values()];
}

export function inferDirectorCast({ interpretation = {}, identities = [] } = {}) {
    const identityById = new Map((Array.isArray(identities) ? identities : []).map((identity) => [identityId(identity), identity]));
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
    return [...candidates.values()];
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
        promptLine: [
            omittedLabels ? `Explicitly omit: ${omittedLabels}.` : '',
            focusedLabel ? `Composition priority: ${focusedLabel}.` : '',
        ].filter(Boolean).join(' '),
    };
}

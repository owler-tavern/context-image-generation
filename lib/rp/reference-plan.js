const SOURCE_ORDER = { remembered: 0, avatar: 1, description: 2, 'prior-scene': 3 };
const IMAGE_SOURCES = new Set(['remembered', 'avatar', 'prior-scene']);

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function sourceType(value) {
    const normalized = String(value ?? '').trim().toLocaleLowerCase('und').replace(/_/gu, '-');
    if (normalized === 'identity-look' || normalized === 'look' || normalized === 'remembered') return 'remembered';
    if (normalized === 'host-avatar' || normalized === 'avatar') return 'avatar';
    if (normalized === 'description' || normalized === 'written-description') return 'description';
    if (normalized === 'prior-scene' || normalized === 'legacy-previous' || normalized === 'scene') return 'prior-scene';
    return null;
}

function modelMax(value) {
    const raw = typeof value === 'number' ? value : value?.maxReferences ?? value?.maxCount ?? value?.referenceImages?.maxCount;
    return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function countsAgainstImageLimit(candidate) {
    return IMAGE_SOURCES.has(candidate.sourceType);
}

function normalizeCandidate(candidate, index) {
    const source = sourceType(candidate?.sourceType ?? candidate?.role);
    if (!source) return null;
    const id = String(candidate?.id ?? `${source}:${index}`).trim();
    if (!id) return null;
    const identityId = candidate?.identityId == null ? null : String(candidate.identityId).trim() || null;
    const identity = String(candidate?.identityLabel ?? candidate?.label ?? identityId ?? 'Prior scene').trim() || 'Prior scene';
    return { ...clone(candidate), id, identityId, identity, sourceType: source };
}

/**
 * Build the UI-safe, provider-independent view of candidate references. One
 * source is selected per identity; lower-priority alternatives remain visible
 * as omissions so the player can see why they were not sent.
 */
export function buildVisibleReferencePlan({ candidates = [], identities = [], modelLimit, maxReferences } = {}) {
    const identityLabels = new Map((Array.isArray(identities) ? identities : Object.values(identities || {})).map((identity) => [String(identity?.id ?? '').trim(), String(identity?.label ?? identity?.name ?? '').trim()]));
    const seen = new Set();
    const normalized = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
        const enriched = candidate?.identityLabel || !candidate?.identityId ? candidate : { ...candidate, identityLabel: identityLabels.get(String(candidate.identityId).trim()) || candidate.identityLabel };
        return normalizeCandidate(enriched, index);
    }).filter((candidate) => {
        if (!candidate || seen.has(candidate.id)) return false;
        seen.add(candidate.id);
        return true;
    });
    const groups = [];
    const byIdentity = new Map();
    for (const candidate of normalized) {
        const key = candidate.identityId || `scene:${candidate.identity}`;
        if (!byIdentity.has(key)) {
            const group = { key, identityId: candidate.identityId, entries: [] };
            byIdentity.set(key, group);
            groups.push(group);
        }
        byIdentity.get(key).entries.push(candidate);
    }
    groups.sort((left, right) => {
        const leftHasImage = left.identityId && left.entries.some(countsAgainstImageLimit) ? 0 : left.identityId ? 1 : 2;
        const rightHasImage = right.identityId && right.entries.some(countsAgainstImageLimit) ? 0 : right.identityId ? 1 : 2;
        return leftHasImage - rightHasImage;
    });
    const winners = new Set();
    for (const group of groups) {
        const winner = [...group.entries].sort((left, right) => SOURCE_ORDER[left.sourceType] - SOURCE_ORDER[right.sourceType] || left.id.localeCompare(right.id))[0];
        if (winner) winners.add(winner.id);
    }
    const max = modelMax(modelLimit ?? maxReferences);
    let used = 0;
    const rows = [];
    for (const group of groups) {
        for (const candidate of group.entries) {
            const isWinner = winners.has(candidate.id);
            const counts = countsAgainstImageLimit(candidate);
            const selected = isWinner && (!counts || (max !== null && used < max));
            if (selected && counts) used += 1;
            const reason = selected ? null : max === null && counts ? 'model-limit-unknown' : !isWinner ? 'identity-already-represented' : 'model-limit';
            rows.push({ ...candidate, status: selected ? 'selected' : 'omitted', reason });
        }
    }
    const selected = rows.filter((row) => row.status === 'selected');
    const omitted = rows.filter((row) => row.status === 'omitted');
    return {
        rows,
        selected,
        omitted,
        modelLimit: { maxReferences: max, used, remaining: max === null ? null : max - used },
    };
}

export const projectReferencePlan = buildVisibleReferencePlan;
export const createReferencePlan = buildVisibleReferencePlan;

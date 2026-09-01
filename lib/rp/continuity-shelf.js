import { resolveAppearanceTruth } from './appearance-truth.js';
import { migrateOutfitCatalog, migrateChatOutfitState, resolveActiveChatOutfit } from './outfit-lock.js';
import { buildVisibleReferencePlan } from './reference-plan.js';

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function identityId(identity) {
    return String(identity?.id ?? '').trim();
}

function sourceFor(sources, identity) {
    if (typeof sources === 'function') return sources(identity) || {};
    return sources?.[identityId(identity)] || {};
}

/** Resolve one immutable appearance truth per identity for the inline shelf. */
export function buildAppearanceTruths({ identities = [], sources = {} } = {}) {
    return (Array.isArray(identities) ? identities : Object.values(identities || {}))
        .map((identity) => ({ identity, ...resolveAppearanceTruth({ identity, ...sourceFor(sources, identity) }) }))
        .filter((truth) => truth.identityId);
}

/**
 * Combine the captured remembered look, host avatar, and written description
 * into one provider-independent candidate list. Description rows are visible
 * to the player but do not become binary image references.
 */
export function buildContinuityReferenceCandidates({ identities = [], truths = [], remembered = [], avatarReferences = [], priorScene = [], includeDescriptions = true } = {}) {
    const identityById = new Map((Array.isArray(identities) ? identities : Object.values(identities || {})).map((identity) => [identityId(identity), identity]));
    const truthById = new Map((Array.isArray(truths) ? truths : []).map((entry) => [entry.identityId, entry]));
    const candidates = [];
    const seen = new Set();
    const add = (candidate, sourceType) => {
        if (!candidate?.id || seen.has(candidate.id)) return;
        const id = String(candidate.identityId || '').trim();
        if ((!id || !identityById.has(id)) && sourceType !== 'prior-scene') return;
        seen.add(candidate.id);
        const identity = identityById.get(id);
        candidates.push({
            ...clone(candidate),
            identityId: id,
            identityLabel: candidate.identityLabel || candidate.label || identity?.label || id || 'Prior scene',
            sourceType,
        });
    };
    for (const candidate of Array.isArray(remembered) ? remembered : []) add(candidate, 'remembered');
    for (const candidate of Array.isArray(avatarReferences) ? avatarReferences : []) add(candidate, 'avatar');
    for (const candidate of Array.isArray(priorScene) ? priorScene : []) add(candidate, 'prior-scene');
    for (const identity of identityById.values()) {
        if (includeDescriptions !== true) continue;
        const truth = truthById.get(identity.id);
        if (!truth?.description?.text) continue;
        add({
            id: `description:${identity.id}`,
            role: 'description',
            identityId: identity.id,
            identityLabel: identity.label || identity.id,
            text: truth.description.text,
        }, 'description');
    }
    return candidates;
}

function candidateFromFinalEntry(entry, knownById) {
    const candidate = entry?.candidate && typeof entry.candidate === 'object' ? entry.candidate : entry;
    const known = knownById.get(String(candidate?.id || '').trim()) || {};
    const sourceType = candidate?.sourceType || known.sourceType || (
        candidate?.role === 'host-avatar' ? 'avatar' : candidate?.role === 'identity-look' ? 'remembered' : candidate?.role === 'prior-scene' || candidate?.role === 'legacy-previous' ? 'prior-scene' : 'description'
    );
    return {
        ...clone(known),
        ...clone(candidate),
        sourceType,
        status: entry?.status || (entry?.candidate ? 'omitted' : 'selected'),
        reason: entry?.reason ?? (entry?.candidate ? 'provider-cap' : null),
    };
}

/** Replace the provisional shelf rows with the exact immutable plan outcome. */
export function alignContinuityReferencePlan(shelfValue, { selected = [], omitted = [] } = {}) {
    const shelf = clone(shelfValue || {});
    const knownRows = [
        ...(Array.isArray(shelf.selected) ? shelf.selected : []),
        ...(Array.isArray(shelf.omitted) ? shelf.omitted : []),
        ...(Array.isArray(shelf.identities) ? shelf.identities.flatMap((entry) => [...(entry.selected || []), ...(entry.omitted || [])]) : []),
    ];
    const knownById = new Map(knownRows.filter((row) => row?.id).map((row) => [String(row.id), row]));
    const selectedRows = selected.map((entry) => candidateFromFinalEntry(entry, knownById));
    const omittedRows = omitted.map((entry) => candidateFromFinalEntry(entry, knownById));
    const selectedIds = new Set(selectedRows.map((row) => row.id));
    const imageSources = new Set(['remembered', 'avatar', 'prior-scene']);
    const used = selectedRows.filter((row) => imageSources.has(row.sourceType)).length;
    const identities = (Array.isArray(shelf.identities) ? shelf.identities : []).map((identity) => ({
        ...identity,
        selected: selectedRows.filter((row) => row.identityId === identity.identityId),
        omitted: omittedRows.filter((row) => row.identityId === identity.identityId),
        sourceType: selectedRows.find((row) => row.identityId === identity.identityId)?.sourceType || identity.sourceType,
    }));
    return {
        ...shelf,
        selected: selectedRows,
        omitted: omittedRows,
        identities,
        modelLimit: {
            ...(shelf.modelLimit || {}),
            used,
            remaining: shelf.modelLimit?.maxReferences == null ? null : shelf.modelLimit.maxReferences - used,
        },
        referenceIds: [...selectedIds],
    };
}

function thumbnailForTruth(truth) {
    if (truth?.sourceType !== 'avatar') return null;
    return truth.source?.url || truth.source?.path || truth.source?.data || truth.source?.imageData || null;
}

function projectOutfit(outfitResult) {
    if (!outfitResult?.outfit) return null;
    const outfit = outfitResult.outfit;
    return {
        id: outfit.id,
        name: outfit.name,
        items: clone(outfit.items || []),
        description: outfit.description || null,
        isLocked: outfitResult.binding?.isLocked === true,
    };
}

/** Build the compact, read-only data model rendered beside a chat message. */
export function projectContinuityShelf({ identities = [], truths = [], candidates = [], modelLimit, outfitCatalog = {}, outfitState = {} } = {}) {
    const identityList = Array.isArray(identities) ? identities : Object.values(identities || {});
    const truthEntries = Array.isArray(truths) ? truths : [];
    const truthById = new Map(truthEntries.map((entry) => [entry.identityId, entry]));
    const plan = buildVisibleReferencePlan({ candidates, identities: identityList, modelLimit });
    const catalog = migrateOutfitCatalog(outfitCatalog);
    const chatOutfits = migrateChatOutfitState(outfitState);
    return {
        modelLimit: clone(plan.modelLimit),
        selected: clone(plan.selected),
        omitted: clone(plan.omitted),
        identities: identityList.map((identity) => {
            const id = identityId(identity);
            const truth = truthById.get(id) || { identityId: id, sourceType: 'none', source: null, description: null, textTraits: [], evidence: [] };
            const rows = plan.rows.filter((row) => row.identityId === id);
            const sourceRow = rows.find((row) => row.status === 'selected') || rows.find((row) => row.sourceType === truth.sourceType) || rows[0];
            const outfitResult = resolveActiveChatOutfit(chatOutfits, id, catalog);
            return {
                identityId: id,
                identityLabel: identity.label || id,
                sourceType: rows.some((row) => row.status === 'selected') ? sourceRow?.sourceType : truth.sourceType,
                thumbnail: sourceRow?.thumbnail || thumbnailForTruth(truth),
                description: truth.description?.text || null,
                selected: clone(rows.filter((row) => row.status === 'selected')),
                omitted: clone(rows.filter((row) => row.status === 'omitted')),
                activeOutfit: projectOutfit(outfitResult),
                outfits: catalog.outfits.filter((outfit) => outfit.identityId === id).map((outfit) => ({ id: outfit.id, name: outfit.name, items: clone(outfit.items), description: outfit.description })),
            };
        }),
    };
}

export function buildOutfitPrompt(activeOutfits = []) {
    const rows = (Array.isArray(activeOutfits) ? activeOutfits : []).filter((entry) => entry?.outfit);
    if (!rows.length) return '';
    const lines = rows.map(({ identityLabel, outfit }) => {
        const detail = outfit.items?.length ? outfit.items.join(', ') : outfit.description || 'no clothing details';
        return `${identityLabel || outfit.identityId} — ${outfit.name}: ${detail}.`;
    });
    return ['[Active outfits]', ...lines].join('\n');
}

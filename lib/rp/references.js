import { findMentionedIdentities } from './identities.js';

const ROLE_ORDER = {
    'identity-look': 0,
    'host-avatar': 1,
    'prior-scene': 2,
    'legacy-previous': 3,
};

function roleRank(role) {
    return ROLE_ORDER[role] ?? 99;
}

function identityMentionIds(text, candidates) {
    const identities = new Map();
    for (const candidate of candidates) {
        if (!candidate.identityId || identities.has(candidate.identityId)) continue;
        identities.set(candidate.identityId, {
            id: candidate.identityId,
            label: candidate.label || candidate.identityId,
            aliases: candidate.aliases || [],
        });
    }
    return new Set(findMentionedIdentities(text, [...identities.values()]).map((identity) => identity.id));
}

function nearbyMentionIds(messages, candidates) {
    const ids = new Set();
    for (const message of messages || []) {
        for (const id of identityMentionIds(message?.text || message?.mes || '', candidates)) ids.add(id);
    }
    return ids;
}

export function rankReferenceCandidates(candidates = [], context = {}) {
    const focusIds = identityMentionIds(context.focusText, candidates);
    const sourceIds = identityMentionIds(context.sourceMessage, candidates);
    const nearbyIds = nearbyMentionIds(context.nearbyMessages, candidates);
    const groupIds = new Set(context.groupIdentityIds || []);

    return [...candidates].sort((left, right) => {
        const leftScene = left.role === 'prior-scene' || left.role === 'legacy-previous' ? 1 : 0;
        const rightScene = right.role === 'prior-scene' || right.role === 'legacy-previous' ? 1 : 0;
        if (leftScene !== rightScene) return leftScene - rightScene;
        const tier = (candidate) => {
            if (candidate.identityId && focusIds.has(candidate.identityId)) return 5;
            if (candidate.identityId && sourceIds.has(candidate.identityId)) return 4;
            if (candidate.identityId && candidate.identityId === context.speakerIdentityId) return 3;
            if (candidate.identityId && nearbyIds.has(candidate.identityId)) return 2;
            if (candidate.identityId && groupIds.has(candidate.identityId)) return 1;
            return 0;
        };
        return tier(right) - tier(left)
            || roleRank(left.role) - roleRank(right.role)
            || String(left.identityId || '').localeCompare(String(right.identityId || ''))
            || String(left.assetId || '').localeCompare(String(right.assetId || ''))
            || String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function selectReferenceCandidates(candidates = [], context = {}) {
    const ranked = rankReferenceCandidates(candidates, context);
    const maxCount = context.maxCount ?? context.capabilities?.referenceImages?.maxCount;
    let selected;
    let omitted;
    if (Number.isInteger(maxCount) && maxCount >= 0) {
        selected = ranked.slice(0, maxCount);
        omitted = ranked.slice(maxCount).map((candidate) => ({ candidate, reason: 'provider-cap' }));
    } else {
        selected = ranked.filter((candidate) => candidate.role === 'host-avatar' || candidate.role === 'legacy-previous');
        omitted = ranked.filter((candidate) => !selected.includes(candidate)).map((candidate) => ({ candidate, reason: 'unknown-cap' }));
    }
    return { selected, omitted };
}

export function gateReferencesByCapability(candidates = [], capabilities = {}) {
    const maxCount = capabilities?.referenceImages?.maxCount;
    if (Number.isInteger(maxCount) && maxCount >= 0) return candidates.slice(0, maxCount);
    return candidates.filter((candidate) => candidate.role === 'host-avatar' || candidate.role === 'legacy-previous');
}

export function materializeReferences(candidates = [], { assets = {} } = {}) {
    const references = [];
    const omitted = [];
    for (const candidate of candidates) {
        const asset = assets?.[candidate.assetId];
        if (!asset || (!asset.url && !asset.data)) {
            omitted.push({ candidate, reason: 'missing-asset' });
            continue;
        }
        const materialized = { url: asset.url, mimeType: asset.mimeType };
        if (asset.data) materialized.data = asset.data;
        references.push({ ...candidate, asset: materialized });
    }
    return { references, omitted };
}

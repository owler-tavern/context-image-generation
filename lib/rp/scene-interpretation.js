import { normalizeAlias } from './identities.js';
import { reconcileStoryState } from './story-state.js';
import { projectSceneInspection } from './scene-inspection.js';

const MAX_TEXT_LENGTH = 12000;
const EXCLUDED_KINDS = new Set(['narrator', 'gm', 'system', 'assistant']);
const ABSENCE_RE = /\b(?:absent|elsewhere|away|outside|isn't\s+here|aren't\s+here)\b/iu;
const NEGATION_RE = /\b(?:no|without|never|not)\b/iu;
const LOCATION_RE = /\b(?:in|inside|within)\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const AT_LOCATION_RE = /\b(?:is|are|was|were|stands?|waits?|sits?|arrives?)\s+at\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const LEADING_LOCATION_RE = /(?:^|[.!?]\s+)at\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const TRAVEL_LOCATION_RE = /\b(?:returns?\s+to|enters?)\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const OUTFIT_RE = /\b(?:wears?|wearing|dons?|dressed\s+in)\s+(?:a|an|the)\s+([^,.!?;]+?)(?=\s+(?:and|while|as)\b|[,.!?;]|$)/iu;
const OBJECT_RE = /\b(?:holds?|carries?|grips?|wields?|uses?|clutches?|keeps?)\s+(?:a|an|the)\s+([^,.!?;]+?)(?=\s+(?:and|while|as)\b|[,.!?;]|$)/iu;
const INJURY_RE = /\b(?:a|an)\s+(bruise|cut|wound|scar|injury|burn|scratch|bleeding|black\s+eye)(?:\s+(?:on|across|along)\s+(?:the|her|his|their)?\s*([a-z][a-z -]{1,24}))?(?:\s+(?:darkens?|covers?|marks?|runs?\s+down)\s+(?:the|her|his|their)\s+([a-z][a-z -]{1,24}))?/iu;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, max = MAX_TEXT_LENGTH) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return text && text.length <= max ? text : '';
}

function messageText(message) {
    return typeof message === 'string' ? cleanText(message) : cleanText(message?.mes ?? message?.text ?? message?.content);
}

function segmentInput({ selectedPassage, clickedMessage, recentContext }) {
    const selected = cleanText(selectedPassage);
    const clicked = messageText(clickedMessage);
    const recent = (Array.isArray(recentContext) ? recentContext : [])
        .map(messageText)
        .filter(Boolean)
        .slice(-12);
    const segments = [];
    if (selected) segments.push({ source: 'selected-passage', text: selected, rank: 3 });
    if (clicked) segments.push({ source: 'clicked-message', text: clicked, rank: 2, speaker: cleanText(clickedMessage?.name) });
    for (const text of recent) segments.push({ source: 'recent-context', text, rank: 1 });
    return { selected, clicked, recent, segments };
}

function normalizedIdentity(identity, index) {
    if (!isRecord(identity) || EXCLUDED_KINDS.has(String(identity.kind || '').toLowerCase())) return null;
    const id = cleanText(identity.id || `identity:${index}`);
    const label = cleanText(identity.label || identity.name || id);
    const aliases = [...new Set([label, ...(Array.isArray(identity.aliases) ? identity.aliases : [])].map(normalizeAlias).filter(Boolean))];
    return id && label && aliases.length ? { id, kind: cleanText(identity.kind || 'npc').toLowerCase(), label, aliases } : null;
}

function identityIndex(identities) {
    const byAlias = new Map();
    for (const identity of identities) {
        for (const alias of identity.aliases) {
            const owners = byAlias.get(alias) || [];
            owners.push(identity);
            byAlias.set(alias, owners);
        }
    }
    return byAlias;
}

function sentenceParts(text) {
    return text.split(/(?<=[.!?;])\s+/u).filter(Boolean);
}

function aliasRegex(alias) {
    const tokens = alias.split(/\s+/u).map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${tokens.join('\\s+').replace(/\\ /gu, '\\s+')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

function evidenceFor(segment) {
    return [{ source: segment.source, text: segment.text }];
}

function mentionStatus(sentence, alias) {
    const expression = aliasRegex(alias);
    const match = sentence.match(expression);
    if (!match) return 'missing';
    const clauseStart = Math.max(sentence.lastIndexOf(';', match.index), sentence.lastIndexOf(',', match.index));
    const clause = sentence.slice(clauseStart + 1);
    const localIndex = (match.index || 0) - clauseStart - 1;
    const before = clause.slice(0, localIndex);
    const after = clause.slice(localIndex + match[0].length);
    const nearby = `${before.slice(-45)} ${after.slice(0, 45)}`;
    if (/\b(?:not\s+(?:here|present)|isn't\s+here|aren't\s+here)\b/iu.test(nearby)) return 'negated';
    if (ABSENCE_RE.test(nearby)) return 'absent';
    if (NEGATION_RE.test(nearby)) return 'negated';
    return 'present';
}

function identityMentions(segments, identities, index) {
    const cast = new Map();
    const excluded = [];
    const ambiguities = [];
    for (const segment of segments) {
        for (const sentence of sentenceParts(segment.text)) {
            for (const [alias, owners] of index) {
                const status = mentionStatus(sentence, alias);
                if (status === 'missing') continue;
                if (owners.length !== 1) {
                    if (!ambiguities.some((entry) => entry.alias === alias)) ambiguities.push({ alias, candidates: owners.map((owner) => owner.id) });
                    continue;
                }
                const identity = owners[0];
                if (status !== 'present') {
                    if (!excluded.some((entry) => entry.identityId === identity.id && entry.reason === status)) excluded.push({ identityId: identity.id, reason: status, evidence: evidenceFor(segment) });
                    continue;
                }
                const current = cast.get(identity.id);
                if (!current || segment.rank > current.rank) cast.set(identity.id, { identity, rank: segment.rank, evidence: evidenceFor(segment) });
            }
        }
        if (segment.source === 'clicked-message' && segment.speaker) {
            for (const [alias, owners] of index) {
                if (owners.length !== 1 || !aliasRegex(alias).test(segment.speaker)) continue;
                const status = mentionStatus(segment.text, alias);
                if (status !== 'present') continue;
                const identity = owners[0];
                if (!cast.has(identity.id)) cast.set(identity.id, { identity, rank: segment.rank, evidence: evidenceFor(segment) });
            }
        }
    }
    return {
        cast: [...cast.values()].sort((left, right) => left.identity.id.localeCompare(right.identity.id)).map(({ identity, evidence }) => ({ identityId: identity.id, label: identity.label, kind: identity.kind, confidence: evidence[0].source === 'recent-context' ? 'medium' : 'high', evidence })),
        excluded,
        ambiguities,
    };
}

function segmentsWithCue(parts, expression) {
    const matched = parts.segments.filter((segment) => expression.test(segment.text));
    if (!matched.length) return [];
    const highestRank = Math.max(...matched.map((segment) => segment.rank));
    return matched.filter((segment) => segment.rank === highestRank);
}

function extractLocation(parts) {
    const locationExpressions = [LOCATION_RE, AT_LOCATION_RE, LEADING_LOCATION_RE, TRAVEL_LOCATION_RE];
    const segments = parts.segments.filter((segment) => locationExpressions.some((expression) => expression.test(segment.text)));
    if (segments.length) {
        const highestRank = Math.max(...segments.map((segment) => segment.rank));
        segments.splice(0, segments.length, ...segments.filter((segment) => segment.rank === highestRank));
    }
    const candidates = [];
    for (const segment of segments) {
        for (const expression of locationExpressions) {
            const match = segment.text.match(expression);
            if (match?.[1]) candidates.push({ value: cleanText(match[1]).replace(/\s+(?:and|while|as)$/iu, ''), segment });
        }
    }
    const values = [...new Set(candidates.map((candidate) => candidate.value.toLocaleLowerCase('und')))].filter(Boolean);
    if (!values.length) return { value: null, status: 'unknown', confidence: 'low', evidence: [] };
    if (values.length > 1) return { value: null, status: 'ambiguous', confidence: 'low', candidates: candidates.map((candidate) => candidate.value), evidence: candidates.map(({ segment }) => evidenceFor(segment)[0]) };
    const candidate = candidates[candidates.length - 1];
    return { value: candidate.value, status: 'confirmed', confidence: candidate.segment.source === 'recent-context' ? 'medium' : 'high', evidence: evidenceFor(candidate.segment) };
}

function matchingIdentity(sentence, index) {
    const matches = [];
    for (const [alias, owners] of index) if (owners.length === 1 && mentionStatus(sentence, alias) === 'present') matches.push(owners[0]);
    return matches.length === 1 ? matches[0] : null;
}

function extractDetails(parts, index, type) {
    const details = new Map();
    let previousIdentity = null;
    const expression = type === 'outfit' ? OUTFIT_RE : type === 'object' ? OBJECT_RE : INJURY_RE;
    for (const segment of segmentsWithCue(parts, expression)) {
        for (const sentence of sentenceParts(segment.text)) {
            const identity = matchingIdentity(sentence, index) || previousIdentity;
            const match = sentence.match(expression);
            if (!match) {
                const direct = matchingIdentity(sentence, index);
                if (direct) previousIdentity = direct;
                continue;
            }
            const value = type === 'injury'
                ? `${match[1]}${(match[2] || match[3]) ? ` on ${match[2] || match[3]}` : ''}`.replace(/\s+/gu, ' ').trim()
                : cleanText(match[1]).replace(/\s+(?:and|while|as)$/iu, '');
            if (!value) continue;
            const record = type === 'outfit'
                ? { identityId: identity?.id || null, value, confidence: segment.source === 'recent-context' ? 'medium' : 'high', evidence: evidenceFor(segment) }
                : type === 'object'
                    ? { value, ...(identity ? { holderIdentityId: identity.id } : {}), confidence: segment.source === 'recent-context' ? 'medium' : 'high', evidence: evidenceFor(segment) }
                    : { identityId: identity?.id || null, value, confidence: segment.source === 'recent-context' ? 'medium' : 'high', evidence: evidenceFor(segment) };
            if (type !== 'object' && !identity) continue;
            const key = type === 'object' ? `${value}|${identity?.id || ''}` : identity.id;
            details.set(key, record);
            if (identity) previousIdentity = identity;
        }
    }
    return [...details.values()].filter((entry) => entry.identityId !== null || type === 'object');
}

/**
 * Deterministically interprets only explicit, bounded scene cues. It never
 * invokes an LLM/provider and leaves uncertain details as unknown/ambiguous.
 */
export function interpretScene({ selectedPassage, focusText, clickedMessage, sourceMessage, recentContext, identities: suppliedIdentities, priorStoryState } = {}) {
    const parts = segmentInput({ selectedPassage: selectedPassage ?? focusText, clickedMessage: clickedMessage ?? sourceMessage, recentContext });
    const focus = parts.selected
        ? { text: parts.selected, source: 'selected-passage', confidence: 'high', evidence: [{ source: 'selected-passage', text: parts.selected }] }
        : parts.clicked
            ? { text: parts.clicked, source: 'clicked-message', confidence: 'high', evidence: [{ source: 'clicked-message', text: parts.clicked }] }
            : parts.recent[parts.recent.length - 1]
                ? { text: parts.recent[parts.recent.length - 1], source: 'recent-context', confidence: 'medium', evidence: [{ source: 'recent-context', text: parts.recent[parts.recent.length - 1] }] }
                : { text: '', source: 'unknown', confidence: 'low', evidence: [] };
    const identities = (Array.isArray(suppliedIdentities) ? suppliedIdentities : []).map(normalizedIdentity).filter(Boolean);
    const index = identityIndex(identities);
    const mentionResult = identityMentions(parts.segments, identities, index);
    const location = extractLocation(parts);
    const result = {
        schema: 1,
        focusPassage: focus,
        cast: mentionResult.cast,
        excluded: mentionResult.excluded,
        ambiguities: mentionResult.ambiguities,
        location,
        outfits: extractDetails(parts, index, 'outfit'),
        objects: extractDetails(parts, index, 'object'),
        injuries: extractDetails(parts, index, 'injury'),
    };
    result.storyStateDelta = reconcileStoryState(priorStoryState, result);
    result.inspection = projectSceneInspection(result);
    return result;
}

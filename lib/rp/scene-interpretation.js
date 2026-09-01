import { normalizeAlias } from './identities.js';
import { reconcileStoryState } from './story-state.js';
import { projectSceneInspection } from './scene-inspection.js';

const MAX_TEXT_LENGTH = 12000;
const EXCLUDED_KINDS = new Set(['narrator', 'gm', 'system', 'assistant']);
const ABSENCE_RE = /\b(?:absent|elsewhere|away|outside)\b/iu;
const LOCATION_RE = /\b(?:in|inside|within)\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const AT_LOCATION_RE = /\b(?:is|are|was|were|stands?|waits?|sits?|arrives?)\s+at\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const LEADING_LOCATION_RE = /(?:^|[.!?]\s+)at\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const TRAVEL_LOCATION_RE = /\b(?:returns?\s+to|enters?)\s+(?:the\s+)?([a-z][a-z0-9' -]{1,48}?)(?=[,.!?;]|$)/iu;
const KNOWN_PLACE_RE = /\b(?:library|station|tavern|inn|room|hall|kitchen|bedroom|forest|woods|street|road|bridge|castle|office|park|garden|beach|shore|harbor|harbour|market|temple|church|school|city|village|town|house|home|cave|dungeon|tower|alley|doorway|corridor|platform|cabin|ship|boat|train|bar|cafe|café)\b/iu;
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

function messageRole(message) {
    const explicit = String(message?.role || message?.senderRole || '').trim().toLowerCase();
    if (message?.is_system === true || message?.isSystem === true || explicit === 'system') return 'system';
    const name = String(message?.name || message?.sender || '').trim().toLowerCase();
    if (['narrator', 'gm', 'game master'].includes(name)) return name === 'narrator' ? 'narrator' : 'gm';
    if (['narrator', 'gm', 'game-master', 'game master', 'world', 'world-fact', 'world_fact', 'narration'].includes(explicit)) return explicit;
    return explicit || null;
}

function messageSegment(message, source, rank) {
    const text = messageText(message);
    if (!text) return null;
    return {
        source,
        text,
        rank,
        speaker: cleanText(message?.name || message?.sender || message?.speaker),
        role: messageRole(message),
    };
}

function segmentInput({ selectedPassage, clickedMessage, recentContext }) {
    const selectedMessage = isRecord(selectedPassage) ? selectedPassage : selectedPassage;
    const selected = messageText(selectedMessage);
    const clicked = messageText(clickedMessage);
    const recent = (Array.isArray(recentContext) ? recentContext : [])
        .map((message) => messageSegment(message, 'recent-context', 1))
        .filter(Boolean)
        .slice(-12);
    const segments = [];
    const selectedSegment = selected ? messageSegment(selectedMessage, 'selected-passage', 3) : null;
    if (selectedSegment) segments.push(selectedSegment);
    const clickedSegment = messageSegment(clickedMessage, 'clicked-message', 2);
    if (clickedSegment) segments.push(clickedSegment);
    if (clicked && !clickedSegment) segments.push({ source: 'clicked-message', text: clicked, rank: 2, speaker: null, role: null });
    segments.push(...recent);
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
    const evidence = { source: segment.source, text: segment.text };
    if (segment.speaker) evidence.speaker = segment.speaker;
    if (segment.role) evidence.role = segment.role;
    return [evidence];
}

function isExcludedSegment(segment) {
    return ['narrator', 'gm', 'game-master', 'game master', 'system', 'world', 'world-fact', 'world_fact', 'narration'].includes(segment.role);
}

function isQuotedAt(text, offset) {
    const prefix = text.slice(0, offset);
    const quotes = (prefix.match(/["“”]/gu) || []).length;
    return quotes % 2 === 1;
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
    const aliasEnd = (match.index || 0) + match[0].length;
    if (isQuotedAt(sentence, aliasEnd)) return 'quoted';
    if (/\b(?:not\s+(?:here|present)|isn't\s+here|aren't\s+here)\b/iu.test(nearby)) return 'negated';
    if (ABSENCE_RE.test(nearby)) return 'absent';
    if (/(?:^|\s)(?:no|without|not)\s*$/iu.test(before) || /\b(?:no|without|not)\s+(?:the\s+)?/iu.test(before.slice(-20))) return 'negated';
    return 'present';
}

function identityMentions(segments, identities, index) {
    const cast = new Map();
    const excluded = [];
    const ambiguities = [];
    const observations = new Map();
    const usableSegments = segments.filter((segment) => !isExcludedSegment(segment));
    const addObservation = (identity, status, segment, alias = identity.label) => {
        const entries = observations.get(identity.id) || [];
        entries.push({ identity, status, segment, alias });
        observations.set(identity.id, entries);
    };
    for (const segment of usableSegments) {
        for (const sentence of sentenceParts(segment.text)) {
            for (const [alias, owners] of index) {
                const status = mentionStatus(sentence, alias);
                if (status === 'missing') continue;
                if (owners.length !== 1) {
                    if (!ambiguities.some((entry) => entry.alias === alias && entry.reason !== 'quoted')) ambiguities.push({ alias, candidates: owners.map((owner) => owner.id) });
                    if (status === 'quoted' && !ambiguities.some((entry) => entry.alias === alias && entry.reason === 'quoted')) ambiguities.push({ alias, candidates: owners.map((owner) => owner.id), reason: 'quoted' });
                    continue;
                }
                addObservation(owners[0], status, segment, alias);
            }
        }
        if (segment.source === 'clicked-message' && segment.speaker) {
            for (const [alias, owners] of index) {
                if (owners.length !== 1 || !aliasRegex(alias).test(segment.speaker)) continue;
                const status = mentionStatus(segment.text, alias);
                if (status === 'missing') addObservation(owners[0], 'present', segment, alias);
            }
        }
    }
    for (const entries of observations.values()) {
        const highestRank = Math.max(...entries.map((entry) => entry.segment.rank));
        const strongest = entries.filter((entry) => entry.segment.rank === highestRank);
        const identity = strongest[0].identity;
        const statuses = new Set(strongest.map((entry) => entry.status));
        if (statuses.has('quoted')) {
            const quoted = strongest.find((entry) => entry.status === 'quoted');
            const displayAlias = normalizeAlias(identity.label) === quoted.alias ? identity.label : quoted.alias;
            if (!ambiguities.some((entry) => entry.alias === displayAlias && entry.reason === 'quoted')) ambiguities.push({ alias: displayAlias, candidates: [identity.id], reason: 'quoted' });
        } else if (statuses.has('present') && !statuses.has('absent') && !statuses.has('negated')) {
            const selected = strongest.find((entry) => entry.status === 'present');
            cast.set(identity.id, { identity, rank: highestRank, evidence: evidenceFor(selected.segment) });
        } else {
            const excludedEntry = strongest.find((entry) => entry.status !== 'present');
            excluded.push({ identityId: identity.id, reason: excludedEntry.status, evidence: evidenceFor(excludedEntry.segment) });
        }
    }
    return {
        cast: [...cast.values()].sort((left, right) => left.identity.id.localeCompare(right.identity.id)).map(({ identity, evidence }) => ({ identityId: identity.id, label: identity.label, kind: identity.kind, confidence: evidence[0].source === 'recent-context' ? 'medium' : 'high', evidence })),
        excluded,
        ambiguities,
        observed: observations.size > 0,
        removed: observations.size > 0 && [...observations.values()].some((entries) => entries.some((entry) => ['absent', 'negated'].includes(entry.status))),
        highestRank: observations.size ? Math.max(...[...observations.values()].flat().map((entry) => entry.segment.rank)) : 0,
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
    const usable = parts.segments.filter((segment) => !isExcludedSegment(segment));
    const segments = usable.filter((segment) => locationExpressions.some((expression) => expression.test(segment.text)));
    if (segments.length) {
        const highestRank = Math.max(...segments.map((segment) => segment.rank));
        segments.splice(0, segments.length, ...segments.filter((segment) => segment.rank === highestRank));
    }
    const candidates = [];
    for (const segment of segments) {
        for (const expression of locationExpressions) {
            const match = segment.text.match(expression);
            const value = cleanText(match?.[1]).replace(/\s+(?:and|while|as)$/iu, '');
            const locationLike = expression === LOCATION_RE || expression === LEADING_LOCATION_RE;
            if (value && (!locationLike || KNOWN_PLACE_RE.test(value)) && !/\b(?:coat|dress|shirt|blouse|jacket|uniform|robe|sweater|pants|trousers|skirt|shorts|clothes|outfit)\b/iu.test(value)) {
                const offset = match.index + match[0].length;
                if (!isQuotedAt(segment.text, offset)) candidates.push({ value, segment });
            }
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
    for (const segment of segmentsWithCue({ segments: parts.segments.filter((item) => !isExcludedSegment(item)) }, expression)) {
        for (const sentence of sentenceParts(segment.text)) {
            const identity = matchingIdentity(sentence, index) || previousIdentity;
            const match = sentence.match(expression);
            if (!match) {
                const direct = matchingIdentity(sentence, index);
                if (direct) previousIdentity = direct;
                continue;
            }
            if (isQuotedAt(sentence, match.index + match[0].length)) continue;
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

function stateSignal(parts, key) {
    const patterns = {
        location: /\b(?:leaves?|exits?|departs?|moves?\s+away|is\s+gone)\b/iu,
        objects: /\b(?:drops?|discards?|throws?\s+away|sets?\s+down|no\s+longer\s+holds?|isn't\s+holding|aren't\s+holding)\b/iu,
        outfits: /\b(?:no\s+longer\s+wears?|changes?\s+out\s+of|removes?)\s+(?:the\s+)?(?:coat|dress|shirt|blouse|jacket|uniform|robe|sweater|pants|trousers|skirt|shorts|clothes|outfit)\b/iu,
        injuries: /\b(?:heals?|healed|no\s+longer\s+injured)\b/iu,
    };
    const usable = parts.segments.filter((segment) => !isExcludedSegment(segment));
    const matching = usable.filter((segment) => {
        const match = segment.text.match(patterns[key]);
        return match && !isQuotedAt(segment.text, match.index + match[0].length);
    });
    if (!matching.length) return null;
    const highestRank = Math.max(...matching.map((segment) => segment.rank));
    const segment = matching.filter((item) => item.rank === highestRank).at(-1);
    return { clear: true, confidence: segment.rank === 1 ? 'medium' : 'high', evidence: evidenceFor(segment) };
}

/**
 * Deterministically interprets only explicit, bounded scene cues. It never
 * invokes an LLM/provider and leaves uncertain details as unknown/ambiguous.
 */
export function interpretScene({ selectedPassage, focusText, clickedMessage, sourceMessage, recentContext, identities: suppliedIdentities, priorStoryState } = {}) {
    const parts = segmentInput({ selectedPassage: selectedPassage ?? focusText, clickedMessage: clickedMessage ?? sourceMessage, recentContext });
    const selectedSegment = parts.segments.find((segment) => segment.source === 'selected-passage');
    const clickedSegment = parts.segments.find((segment) => segment.source === 'clicked-message');
    const focus = parts.selected
        ? { text: parts.selected, source: 'selected-passage', confidence: 'high', evidence: evidenceFor(selectedSegment) }
        : parts.clicked
            ? { text: parts.clicked, source: 'clicked-message', confidence: 'high', evidence: evidenceFor(clickedSegment) }
            : parts.recent[parts.recent.length - 1]
                ? { text: parts.recent[parts.recent.length - 1].text, source: 'recent-context', confidence: 'medium', evidence: evidenceFor(parts.recent[parts.recent.length - 1]) }
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
        sceneSignals: {
            cast: mentionResult.observed ? {
                observed: true,
                confidence: mentionResult.highestRank === 1 ? 'medium' : 'high',
                ...(mentionResult.cast.length === 0 && mentionResult.removed && mentionResult.highestRank >= 2 ? { clear: true } : {}),
            } : null,
            location: stateSignal(parts, 'location'),
            outfits: stateSignal(parts, 'outfits'),
            objects: stateSignal(parts, 'objects'),
            injuries: stateSignal(parts, 'injuries'),
        },
    };
    result.storyStateDelta = reconcileStoryState(priorStoryState, result);
    result.inspection = projectSceneInspection(result);
    return result;
}

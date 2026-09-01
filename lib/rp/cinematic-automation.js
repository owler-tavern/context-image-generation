/*
 * Provider-independent cinematic automation domain.
 *
 * This module only turns accepted scene deltas into reviewable shot cards. It
 * deliberately has no chat, network, provider, or timer dependencies.
 */

export const CINEMATIC_MODE_THRESHOLDS = Object.freeze({
    conservative: 3,
    balanced: 2,
    frequent: 1,
});

const CHANGE_SCORES = Object.freeze({ location: 3, 'emotional-beat': 3, outfit: 2, cast: 2 });
const CHANGE_ORDER = Object.freeze(['location', 'outfit', 'cast', 'emotional-beat']);

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}

function stableJson(value) {
    return JSON.stringify(canonical(value === undefined ? null : value));
}

// Small, synchronous, browser-safe hash. The input is canonicalized before
// hashing, so object-key order cannot change a public ID.
function hash(value) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (const character of String(value)) {
        const code = character.codePointAt(0);
        first ^= code;
        first = Math.imul(first, 0x01000193);
        second ^= code + 0x9e3779b9 + (second << 6) + (second >>> 2);
        second = Math.imul(second, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function stableId(prefix, value) {
    return `${prefix}:${hash(stableJson(value)).slice(0, 16)}`;
}

function cleanText(value) {
    return String(value ?? '').trim();
}

function validNonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeMode(value) {
    const mode = cleanText(value).toLocaleLowerCase('und');
    return Object.prototype.hasOwnProperty.call(CINEMATIC_MODE_THRESHOLDS, mode) ? mode : 'balanced';
}

function acceptedDelta(value) {
    const candidate = isRecord(value?.acceptedSceneDelta) ? value.acceptedSceneDelta : value;
    return isRecord(candidate) ? candidate : {};
}

function isAmbiguous(delta) {
    return delta.ambiguous === true
        || delta.status === 'ambiguous'
        || delta.location?.status === 'ambiguous'
        || (Array.isArray(delta.ambiguities) && delta.ambiguities.length > 0)
        || (Array.isArray(delta.acceptedAmbiguities) && delta.acceptedAmbiguities.length > 0);
}

function meaningfulLocation(value) {
    if (!isRecord(value)) return null;
    const from = cleanText(value.from);
    const to = cleanText(value.to);
    if (!to || from === to) return null;
    return { from: from || null, to };
}

function normalizeCollectionChange(value) {
    if (Array.isArray(value)) return value.map(clone).filter((item) => item != null);
    if (isRecord(value)) {
        if (Array.isArray(value.changed)) return value.changed.map(clone);
        if (Array.isArray(value.added) || Array.isArray(value.removed)) return {
            added: Array.isArray(value.added) ? value.added.map(clone) : [],
            removed: Array.isArray(value.removed) ? value.removed.map(clone) : [],
        };
        if (value.from !== undefined || value.to !== undefined) return clone(value);
    }
    return null;
}

function hasCollectionChange(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (!isRecord(value)) return false;
    if (Array.isArray(value.changed)) return value.changed.length > 0;
    if (Array.isArray(value.added) || Array.isArray(value.removed)) return Boolean(value.added?.length || value.removed?.length);
    return value.from !== undefined || value.to !== undefined;
}

function changedValue(delta, key) {
    const directKind = cleanText(delta.kind).toLocaleLowerCase('und').replace(/_/gu, '-');
    if (directKind === key || (key === 'outfits' && directKind === 'outfit') || (key === 'cast' && directKind === 'cast')) {
        const compact = delta.change ?? delta.changes ?? delta.value;
        const normalizedCompact = key === 'location' ? meaningfulLocation(compact) : normalizeCollectionChange(compact);
        if (normalizedCompact && (key === 'location' || hasCollectionChange(normalizedCompact))) return normalizedCompact;
    }
    const updated = delta.updatedSceneFacts?.[key];
    const added = delta.addedSceneFacts?.[key];
    const direct = delta[key];
    if (key === 'location') {
        const candidates = [updated, direct];
        const locations = candidates.filter(isRecord).map(meaningfulLocation).filter(Boolean);
        if (locations.length > 1 && stableJson(locations[0]) !== stableJson(locations[1])) return { ambiguous: true };
        if (locations[0]) return locations[0];
        return null;
    }
    const candidates = [updated, added, direct].filter((value) => value !== undefined);
    if (!candidates.length) return null;
    const normalized = candidates.map(normalizeCollectionChange).filter((value) => hasCollectionChange(value));
    if (!normalized.length) return null;
    const first = normalized[0];
    if (normalized.some((value) => stableJson(value) !== stableJson(first))) return { ambiguous: true };
    return first;
}

function normalizeEmotionalBeat(delta) {
    const raw = delta.emotionalBeat ?? delta.emotional_beats ?? delta.emotionalBeats
        ?? (['emotional-beat', 'emotional', 'emotion'].includes(cleanText(delta.kind).toLocaleLowerCase('und').replace(/_/gu, '-'))
            ? (delta.change ?? delta.changes ?? delta.value) : undefined);
    if (Array.isArray(raw)) {
        if (raw.length !== 1) return raw.length ? { ambiguous: true } : null;
        return normalizeEmotionalBeat({ emotionalBeat: raw[0] });
    }
    if (!isRecord(raw)) return null;
    if (raw.ambiguous === true || raw.status === 'ambiguous') return { ambiguous: true };
    const label = cleanText(raw.label || raw.name || raw.type);
    const id = cleanText(raw.id || raw.beatId);
    if (!label && !id) return null;
    return { id: id || null, label: label || id, confidence: cleanText(raw.confidence) || null };
}

function eventFor(delta, revision, kind, change, evidence) {
    const identity = { revision, kind, change };
    const eventId = stableId('event', identity);
    const suppliedBeatId = kind === 'emotional-beat' && cleanText(change.id);
    const beatId = suppliedBeatId || stableId('beat', identity);
    const label = kind === 'emotional-beat' ? 'emotional beat' : kind;
    const reason = `accepted ${label} change`;
    return {
        schema: 1,
        eventId,
        beatId,
        kind,
        score: CHANGE_SCORES[kind],
        revision,
        change: clone(change),
        whyFired: {
            reason,
            text: `Fired because an ${reason} was accepted.`,
            evidence: clone(evidence),
        },
    };
}

/**
 * Derive only from an explicitly accepted scene delta. Message counts,
 * message IDs, timers, and ordinary chat text are intentionally ignored.
 */
export function deriveCinematicEvents(value = {}) {
    const delta = acceptedDelta(value);
    if (delta.accepted !== true || isAmbiguous(delta)) return [];
    const revision = cleanText(delta.revision || delta.sceneRevision || delta.deltaId) || stableId('revision', delta);
    const evidence = Array.isArray(delta.acceptedEvidence)
        ? delta.acceptedEvidence.map(clone)
        : Array.isArray(delta.evidence) ? delta.evidence.map(clone) : [];
    const events = [];
    const location = changedValue(delta, 'location');
    if (location && !location.ambiguous) events.push(eventFor(delta, revision, 'location', location, evidence));
    for (const kind of ['outfit', 'cast']) {
        const key = kind === 'outfit' ? 'outfits' : 'cast';
        const change = changedValue(delta, key);
        if (change && !change.ambiguous) events.push(eventFor(delta, revision, kind, change, evidence));
    }
    const emotionalBeat = normalizeEmotionalBeat(delta);
    if (emotionalBeat && !emotionalBeat.ambiguous) events.push(eventFor(delta, revision, 'emotional-beat', emotionalBeat, evidence));
    return events;
}

function normalizeIds(value) {
    return Array.isArray(value) ? [...new Set(value.map(cleanText).filter(Boolean))] : [];
}

function normalizeMap(value) {
    return isRecord(value) ? clone(value) : {};
}

export function createCinematicSession({
    sessionId = 'session:default',
    mode = 'balanced',
    generationCount = 0,
    costSpent = 0,
    costCeiling,
    generationLimit,
    seenEventIds = [],
    approvedSuggestionIds = [],
    dismissedSuggestionIds = [],
    approvedPlans = {},
    retriggerSuggestions = {},
} = {}) {
    const count = Number.isInteger(generationCount) && generationCount >= 0 ? generationCount : 0;
    const spent = validNonNegativeNumber(costSpent) ?? 0;
    const limit = Number.isInteger(generationLimit) && generationLimit >= 0 ? generationLimit : null;
    return freeze({
        schema: 1,
        sessionId: cleanText(sessionId) || 'session:default',
        mode: normalizeMode(mode),
        generationCount: count,
        generationLimit: limit,
        costSpent: spent,
        costCeiling: validNonNegativeNumber(costCeiling),
        seenEventIds: normalizeIds(seenEventIds),
        approvedSuggestionIds: normalizeIds(approvedSuggestionIds),
        dismissedSuggestionIds: normalizeIds(dismissedSuggestionIds),
        approvedPlans: normalizeMap(approvedPlans),
        retriggerSuggestions: normalizeMap(retriggerSuggestions),
    });
}

function nextTrigger(session, events = [], status = 'waiting') {
    const threshold = CINEMATIC_MODE_THRESHOLDS[session.mode];
    const highest = events.reduce((score, event) => Math.max(score, event.score || 0), 0);
    const missing = Math.max(0, threshold - highest);
    const explanation = status === 'suggested'
        ? `Next cinematic suggestion uses the ${session.mode} threshold (${threshold}); this accepted change reached score ${highest}.`
        : `Next cinematic suggestion fires in ${session.mode} mode at score ${threshold}; current accepted change score is ${highest}${missing ? `, ${missing} more point${missing === 1 ? '' : 's'} needed` : ''}.`;
    return { mode: session.mode, threshold, observedScore: highest, pointsNeeded: missing, explanation };
}

function createSuggestion(session, event, triggerSource = 'accepted-scene-delta', extra = {}) {
    const suggestionId = stableId('suggestion', { sessionId: session.sessionId, eventId: event.eventId, triggerSource, ...extra });
    return freeze({
        schema: 1,
        suggestionId,
        state: 'suggested',
        eventId: event.eventId,
        beatId: event.beatId,
        kind: event.kind,
        triggerSource,
        replayedChatEvent: false,
        whyFired: clone(event.whyFired),
        adjustments: {},
        nextTrigger: {
            mode: session.mode,
            threshold: CINEMATIC_MODE_THRESHOLDS[session.mode],
            explanation: `Next cinematic suggestion fires in ${session.mode} mode at score ${CINEMATIC_MODE_THRESHOLDS[session.mode]}.`,
        },
    });
}

export function evaluateCinematicAutomation({ session: inputSession, acceptedSceneDelta } = {}) {
    const session = createCinematicSession(inputSession || {});
    const events = deriveCinematicEvents(acceptedSceneDelta);
    if (!events.length) {
        const ordinary = acceptedDelta(acceptedSceneDelta).accepted !== true;
        return freeze({ status: ordinary ? 'ordinary-chat' : 'no-change', session, events: [], suggestion: null, nextTrigger: nextTrigger(session) });
    }
    const unseen = events.filter((event) => !session.seenEventIds.includes(event.eventId));
    const seenEventIds = [...new Set([...session.seenEventIds, ...events.map((event) => event.eventId)])];
    const nextSession = createCinematicSession({ ...session, seenEventIds });
    if (!unseen.length) return freeze({ status: 'duplicate-suppressed', session: nextSession, events, suggestion: null, nextTrigger: nextTrigger(nextSession, events) });
    const threshold = CINEMATIC_MODE_THRESHOLDS[nextSession.mode];
    const candidate = [...unseen].sort((left, right) => right.score - left.score || CHANGE_ORDER.indexOf(left.kind) - CHANGE_ORDER.indexOf(right.kind) || left.eventId.localeCompare(right.eventId))[0];
    if (candidate.score < threshold) return freeze({ status: 'below-threshold', session: nextSession, events, suggestion: null, nextTrigger: nextTrigger(nextSession, unseen) });
    const suggestion = createSuggestion(nextSession, candidate);
    return freeze({ status: 'suggested', session: nextSession, events, suggestion, nextTrigger: nextTrigger(nextSession, [candidate], 'suggested') });
}

export function adjustCinematicSuggestion(suggestionValue, adjustments = {}) {
    if (!isRecord(suggestionValue)) return null;
    const suggestion = clone(suggestionValue);
    if (!['suggested', 'adjusted'].includes(suggestion.state)) return freeze(suggestion);
    return freeze({ ...suggestion, state: 'adjusted', adjustments: clone(adjustments) });
}

export function dismissCinematicSuggestion(suggestionValue) {
    if (!isRecord(suggestionValue)) return null;
    if (suggestionValue.state === 'approved') return freeze(clone(suggestionValue));
    return freeze({ ...clone(suggestionValue), state: 'dismissed' });
}

function planFor(session, suggestion, cost) {
    return freeze({
        schema: 1,
        planId: stableId('plan', { sessionId: session.sessionId, suggestionId: suggestion.suggestionId }),
        sessionId: session.sessionId,
        suggestionId: suggestion.suggestionId,
        eventId: suggestion.eventId,
        beatId: suggestion.beatId,
        kind: suggestion.kind,
        triggerSource: suggestion.triggerSource,
        adjustments: clone(suggestion.adjustments),
        estimatedCost: cost,
        dispatch: { allowed: false, network: false, reason: 'approval-plan-only' },
    });
}

export function approveCinematicSuggestion(inputSession, suggestionValue, { estimatedCost } = {}) {
    const session = createCinematicSession(inputSession || {});
    const suggestion = isRecord(suggestionValue) ? suggestionValue : null;
    if (!suggestion?.suggestionId) return { status: 'invalid-suggestion', session, plan: null };
    if (session.approvedSuggestionIds.includes(suggestion.suggestionId)) {
        return freeze({ status: 'already-approved', session, plan: session.approvedPlans[suggestion.suggestionId] || null });
    }
    if (session.dismissedSuggestionIds.includes(suggestion.suggestionId) || suggestion.state === 'dismissed') return freeze({ status: 'dismissed', session, plan: null });
    const cost = validNonNegativeNumber(estimatedCost);
    if (cost === null) return freeze({ status: 'unknown-cost', session, plan: null });
    if (session.costCeiling === null) return freeze({ status: 'unknown-cost-ceiling', session, plan: null });
    if (session.generationLimit !== null && session.generationCount >= session.generationLimit) return freeze({ status: 'generation-limit', session, plan: null });
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(session.costSpent), Math.abs(cost), Math.abs(session.costCeiling)) * 8;
    if (session.costSpent + cost - session.costCeiling > tolerance) return freeze({ status: 'cost-ceiling', session, plan: null });
    const plan = planFor(session, suggestion, cost);
    const approvedPlans = { ...session.approvedPlans, [suggestion.suggestionId]: plan };
    const nextSession = createCinematicSession({
        ...session,
        generationCount: session.generationCount + 1,
        costSpent: session.costSpent + cost,
        approvedSuggestionIds: [...session.approvedSuggestionIds, suggestion.suggestionId],
        approvedPlans,
    });
    return freeze({ status: 'approved', session: nextSession, plan });
}

export function retriggerCinematicBeat({ session: inputSession, beatId, retriggerId = 'manual', reason = 'manual retrigger for missed or failed beat' } = {}) {
    const session = createCinematicSession(inputSession || {});
    const beat = cleanText(beatId);
    const retry = cleanText(retriggerId);
    if (!beat || !retry) return { status: 'invalid-retrigger', session, suggestion: null };
    const key = `${beat}|${retry}`;
    if (session.retriggerSuggestions[key]) return freeze({ status: 'suggested', session, suggestion: session.retriggerSuggestions[key] });
    const event = {
        eventId: stableId('manual-event', { sessionId: session.sessionId, beatId: beat, retriggerId: retry }),
        beatId: beat,
        kind: 'emotional-beat',
        score: CHANGE_SCORES['emotional-beat'],
        whyFired: { reason: 'manual retrigger', text: `Manual retrigger requested: ${cleanText(reason) || 'missed or failed beat'}.`, evidence: [] },
    };
    const suggestion = createSuggestion(session, event, 'manual-retrigger', { beatId: beat, retriggerId: retry });
    const nextSession = createCinematicSession({ ...session, retriggerSuggestions: { ...session.retriggerSuggestions, [key]: suggestion } });
    return freeze({ status: 'suggested', session: nextSession, suggestion });
}

export function resetCinematicSession(inputSession, { sessionId } = {}) {
    const session = createCinematicSession(inputSession || {});
    return createCinematicSession({
        sessionId: cleanText(sessionId) || `${session.sessionId}:reset`,
        mode: session.mode,
        costCeiling: session.costCeiling,
        generationLimit: session.generationLimit,
    });
}

export const deriveStoryChangeEvents = deriveCinematicEvents;
export const projectCinematicAutomation = evaluateCinematicAutomation;
export const manuallyRetriggerCinematicBeat = retriggerCinematicBeat;

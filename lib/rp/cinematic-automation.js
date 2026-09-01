/* Provider-independent cinematic automation domain. */

export const CINEMATIC_MODE_THRESHOLDS = Object.freeze({ conservative: 3, balanced: 2, frequent: 1 });
const CHANGE_SCORES = Object.freeze({ location: 3, 'emotional-beat': 3, outfit: 2, cast: 2 });
const CHANGE_ORDER = Object.freeze(['location', 'outfit', 'cast', 'emotional-beat']);
const COLLECTION_KEYS = Object.freeze(['identityId', 'holderIdentityId', 'label', 'value', 'from', 'to', 'id']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
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
    if (Array.isArray(value)) return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}
function stableJson(value) { return JSON.stringify(canonical(value === undefined ? null : value)); }
function compositeKey(parts) {
    return (Array.isArray(parts) ? parts : [parts]).map((part) => {
        const json = stableJson(part);
        return `${json.length}:${json}`;
    }).join('|');
}
function hash(value) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (const character of String(value)) {
        const code = character.codePointAt(0);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ (code + 0x9e3779b9 + (second << 6) + (second >>> 2)), 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
/** Public IDs hash a length-prefixed composite, avoiding delimiter ambiguity. */
export function createStableCinematicId(prefix, ...parts) { return `${String(prefix)}:${hash(compositeKey(parts)).slice(0, 16)}`; }
function stableId(prefix, value) { return createStableCinematicId(prefix, value); }
function cleanText(value, max = 240) { const text = String(value ?? '').trim(); return text.length <= max ? text : text.slice(0, max); }
function validNonNegativeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function normalizeMode(value) {
    const mode = cleanText(value).toLocaleLowerCase('und');
    return Object.prototype.hasOwnProperty.call(CINEMATIC_MODE_THRESHOLDS, mode) ? mode : 'balanced';
}
function acceptedDelta(value) { const candidate = isRecord(value?.acceptedSceneDelta) ? value.acceptedSceneDelta : value; return isRecord(candidate) ? candidate : {}; }
function isAmbiguous(delta, seen = new Set()) {
    if (!delta || typeof delta !== 'object' || seen.has(delta)) return false;
    seen.add(delta);
    if (delta.ambiguous === true || delta.status === 'ambiguous' || (Array.isArray(delta.ambiguities) && delta.ambiguities.length > 0) || (Array.isArray(delta.acceptedAmbiguities) && delta.acceptedAmbiguities.length > 0)) return true;
    return Object.values(delta).some((value) => isAmbiguous(value, seen));
}
function sanitizeItem(value) {
    if (!isRecord(value)) return typeof value === 'string' ? cleanText(value) : null;
    const result = {};
    for (const key of COLLECTION_KEYS) if (value[key] !== undefined && value[key] !== null) result[key] = cleanText(value[key]);
    return Object.keys(result).length ? result : null;
}
function sanitizeChange(kind, value) {
    if (kind === 'location') {
        if (!isRecord(value)) return null;
        const from = cleanText(value.from); const to = cleanText(value.to);
        return to && from !== to ? { from: from || null, to } : null;
    }
    if (kind === 'emotional-beat') {
        if (!isRecord(value)) return null;
        const id = cleanText(value.id || value.beatId); const label = cleanText(value.label || value.name || value.type || id);
        return label || id ? { id: id || null, label: label || id, confidence: cleanText(value.confidence) || null } : null;
    }
    if (Array.isArray(value)) return value.map(sanitizeItem).filter(Boolean);
    if (isRecord(value) && (Array.isArray(value.added) || Array.isArray(value.removed))) return {
        added: (Array.isArray(value.added) ? value.added : []).map(sanitizeItem).filter(Boolean),
        removed: (Array.isArray(value.removed) ? value.removed : []).map(sanitizeItem).filter(Boolean),
    };
    return isRecord(value) ? sanitizeItem(value) : null;
}
function normalizeCollectionChange(value) {
    if (Array.isArray(value)) return value.map(clone).filter((item) => item != null);
    if (isRecord(value)) {
        if (Array.isArray(value.changed)) return value.changed.map(clone);
        if (Array.isArray(value.added) || Array.isArray(value.removed)) return { added: Array.isArray(value.added) ? value.added.map(clone) : [], removed: Array.isArray(value.removed) ? value.removed.map(clone) : [] };
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
    if (directKind === key || (key === 'outfits' && directKind === 'outfit')) {
        const compact = delta.change ?? delta.changes ?? delta.value;
        const normalizedCompact = key === 'location' ? sanitizeChange('location', compact) : normalizeCollectionChange(compact);
        if (normalizedCompact && (key === 'location' || hasCollectionChange(normalizedCompact))) return normalizedCompact;
    }
    const updated = delta.updatedSceneFacts?.[key]; const added = delta.addedSceneFacts?.[key]; const direct = delta[key];
    if (key === 'location') {
        const locations = [updated, direct].filter(isRecord).map((value) => sanitizeChange('location', value)).filter(Boolean);
        if (locations.length > 1 && stableJson(locations[0]) !== stableJson(locations[1])) return { ambiguous: true };
        return locations[0] || null;
    }
    const normalized = [updated, added, direct].filter((value) => value !== undefined).map(normalizeCollectionChange).filter((value) => hasCollectionChange(value));
    if (!normalized.length) return null;
    return normalized.some((value) => stableJson(value) !== stableJson(normalized[0])) ? { ambiguous: true } : normalized[0];
}
function normalizeEmotionalBeat(delta) {
    const raw = delta.emotionalBeat ?? delta.emotional_beats ?? delta.emotionalBeats
        ?? (['emotional-beat', 'emotional', 'emotion'].includes(cleanText(delta.kind).toLocaleLowerCase('und').replace(/_/gu, '-')) ? (delta.change ?? delta.changes ?? delta.value) : undefined);
    if (Array.isArray(raw)) return raw.length === 1 ? normalizeEmotionalBeat({ emotionalBeat: raw[0] }) : (raw.length ? { ambiguous: true } : null);
    return sanitizeChange('emotional-beat', raw);
}
function eventFor(revision, kind, change, evidence) {
    const sanitizedChange = sanitizeChange(kind, change); const identity = { revision, kind, change: sanitizedChange }; const eventId = stableId('event', identity);
    const suppliedBeatId = kind === 'emotional-beat' && cleanText(sanitizedChange?.id); const beatId = suppliedBeatId || stableId('beat', identity); const label = kind === 'emotional-beat' ? 'emotional beat' : kind; const reason = `accepted ${label} change`;
    return { schema: 1, eventId, beatId, kind, score: CHANGE_SCORES[kind], revision, change: sanitizedChange, whyFired: { reason, text: `Fired because an ${reason} was accepted.`, evidence: (Array.isArray(evidence) ? evidence : []).map((item) => isRecord(item) ? { ...(item.source ? { source: cleanText(item.source) } : {}), ...(item.text ? { text: cleanText(item.text, 1200) } : {}) } : null).filter(Boolean) } };
}
export function deriveCinematicEvents(value = {}) {
    const delta = acceptedDelta(value); if (delta.accepted !== true || isAmbiguous(delta)) return [];
    const revision = cleanText(delta.revision || delta.sceneRevision || delta.deltaId) || stableId('revision', delta); const evidence = Array.isArray(delta.acceptedEvidence) ? delta.acceptedEvidence : delta.evidence; const events = [];
    const location = changedValue(delta, 'location'); if (location && !location.ambiguous) events.push(eventFor(revision, 'location', location, evidence));
    for (const kind of ['outfit', 'cast']) { const change = changedValue(delta, kind === 'outfit' ? 'outfits' : 'cast'); if (change && !change.ambiguous) events.push(eventFor(revision, kind, change, evidence)); }
    const beat = normalizeEmotionalBeat(delta); if (beat && !beat.ambiguous) events.push(eventFor(revision, 'emotional-beat', beat, evidence));
    return events;
}
function normalizeIds(value) { return Array.isArray(value) ? [...new Set(value.map((item) => cleanText(item)).filter(Boolean))].sort() : []; }
function normalizeMap(value) { return isRecord(value) ? clone(value) : {}; }
export function createCinematicSession(options = {}) {
    const { sessionId = 'session:default', mode = 'balanced', generationCount = 0, costSpent = 0, costCeiling, generationLimit, reservedGenerationCount = 0, reservedCost = 0, seenEventIds = [], consumedEventIds = [], eventRegistry = {}, pendingSuggestions = {}, approvedSuggestionIds = [], dismissedSuggestionIds = [], approvedSuggestionRecords = {}, approvedPlans = {}, reservations = {}, settledPlans = {}, retriggerSuggestions = {} } = options;
    return freeze({ schema: 1, sessionId: cleanText(sessionId) || 'session:default', mode: normalizeMode(mode), generationCount: Number.isInteger(generationCount) && generationCount >= 0 ? generationCount : 0, generationLimit: Number.isInteger(generationLimit) && generationLimit >= 0 ? generationLimit : null, costSpent: validNonNegativeNumber(costSpent) ?? 0, costCeiling: validNonNegativeNumber(costCeiling), reservedGenerationCount: Number.isInteger(reservedGenerationCount) && reservedGenerationCount >= 0 ? reservedGenerationCount : 0, reservedCost: validNonNegativeNumber(reservedCost) ?? 0, seenEventIds: normalizeIds(seenEventIds.length ? seenEventIds : Object.keys(eventRegistry)), consumedEventIds: normalizeIds(consumedEventIds), eventRegistry: normalizeMap(eventRegistry), pendingSuggestions: normalizeMap(pendingSuggestions), approvedSuggestionIds: normalizeIds(approvedSuggestionIds), dismissedSuggestionIds: normalizeIds(dismissedSuggestionIds), approvedSuggestionRecords: normalizeMap(approvedSuggestionRecords), approvedPlans: normalizeMap(approvedPlans), reservations: normalizeMap(reservations), settledPlans: normalizeMap(settledPlans), retriggerSuggestions: normalizeMap(retriggerSuggestions) });
}
function unconsumedEvents(session) { const consumed = new Set(session.consumedEventIds); return Object.values(session.eventRegistry).filter((event) => event && !consumed.has(event.eventId)); }
function categories(events) { return [...new Set(events.map((event) => event.kind))].sort((left, right) => CHANGE_ORDER.indexOf(left) - CHANGE_ORDER.indexOf(right)); }
function nextTrigger(session, events = [], status = 'waiting') {
    const threshold = CINEMATIC_MODE_THRESHOLDS[session.mode]; const observedScore = events.reduce((score, event) => score + (event.score || 0), 0); const pointsNeeded = Math.max(0, threshold - observedScore); const awaited = categories(events); const categoryText = awaited.length ? ` awaiting ${awaited.join(', ')} change${awaited.length === 1 ? '' : 's'}` : '';
    const explanation = status === 'suggested' ? `Next cinematic suggestion uses the ${session.mode} threshold (${threshold}); accepted ${awaited.join(', ') || 'scene'} change reached cumulative score ${observedScore}.` : `Next cinematic suggestion fires in ${session.mode} mode at score ${threshold}; cumulative accepted unseen score is ${observedScore}${categoryText}${pointsNeeded ? `, ${pointsNeeded} more point${pointsNeeded === 1 ? '' : 's'} needed` : ''}.`;
    return { mode: session.mode, threshold, observedScore, pointsNeeded, awaitedCategories: awaited, explanation };
}
function createSuggestion(session, event, events, triggerSource = 'accepted-scene-delta', extra = {}) {
    const eventIds = events.map((item) => item.eventId).sort(); const suggestionId = stableId('suggestion', { sessionId: session.sessionId, eventIds, triggerSource, ...extra });
    return freeze({ schema: 1, suggestionId, sessionId: session.sessionId, state: 'suggested', eventId: event.eventId, beatId: event.beatId, eventIds, kind: event.kind, change: clone(event.change), triggerSource, replayedChatEvent: false, whyFired: clone(event.whyFired), adjustments: {}, changeCategories: categories(events), nextTrigger: nextTrigger(session, events, 'suggested') });
}
function samePendingCore(left, right) { return stableJson({ suggestionId: left?.suggestionId, sessionId: left?.sessionId, eventId: left?.eventId, beatId: left?.beatId, eventIds: left?.eventIds, kind: left?.kind, change: left?.change, triggerSource: left?.triggerSource, replayedChatEvent: left?.replayedChatEvent, whyFired: left?.whyFired }) === stableJson({ suggestionId: right?.suggestionId, sessionId: right?.sessionId, eventId: right?.eventId, beatId: right?.beatId, eventIds: right?.eventIds, kind: right?.kind, change: right?.change, triggerSource: right?.triggerSource, replayedChatEvent: right?.replayedChatEvent, whyFired: right?.whyFired }); }
export function evaluateCinematicAutomation({ session: inputSession, acceptedSceneDelta } = {}) {
    const session = createCinematicSession(inputSession || {}); const events = deriveCinematicEvents(acceptedSceneDelta);
    if (!events.length) return freeze({ status: acceptedDelta(acceptedSceneDelta).accepted !== true ? 'ordinary-chat' : 'no-change', session, events: [], suggestion: null, nextTrigger: nextTrigger(session) });
    const eventRegistry = { ...session.eventRegistry }; const fresh = [];
    for (const event of events) { if (!eventRegistry[event.eventId]) fresh.push(event); eventRegistry[event.eventId] = event; }
    const registered = createCinematicSession({ ...session, eventRegistry, seenEventIds: Object.keys(eventRegistry) }); const pending = Object.values(registered.pendingSuggestions)[0] || null;
    if (pending) return freeze({ status: fresh.length ? 'pending-suppressed' : 'duplicate-suppressed', session: registered, events, suggestion: pending, nextTrigger: nextTrigger(registered, unconsumedEvents(registered)) });
    if (!fresh.length) return freeze({ status: 'duplicate-suppressed', session: registered, events, suggestion: null, nextTrigger: nextTrigger(registered, unconsumedEvents(registered)) });
    const candidates = unconsumedEvents(registered); const threshold = CINEMATIC_MODE_THRESHOLDS[registered.mode];
    if (candidates.reduce((score, event) => score + event.score, 0) < threshold) return freeze({ status: 'below-threshold', session: registered, events, suggestion: null, nextTrigger: nextTrigger(registered, candidates) });
    const candidate = [...candidates].sort((left, right) => right.score - left.score || CHANGE_ORDER.indexOf(left.kind) - CHANGE_ORDER.indexOf(right.kind) || left.eventId.localeCompare(right.eventId))[0]; const suggestion = createSuggestion(registered, candidate, candidates); const nextSession = createCinematicSession({ ...registered, pendingSuggestions: { ...registered.pendingSuggestions, [suggestion.suggestionId]: suggestion } });
    return freeze({ status: 'suggested', session: nextSession, events, suggestion, nextTrigger: nextTrigger(nextSession, candidates, 'suggested') });
}

/**
 * Drain accepted events that were observed while another card was pending.
 * Consumption is intentionally unchanged here; approval or dismissal owns
 * consumption, so calling this repeatedly is idempotent.
 */
export function projectNextCinematicSuggestion({ session: inputSession } = {}) {
    const session = createCinematicSession(inputSession || {});
    const pending = Object.values(session.pendingSuggestions)[0] || null;
    if (pending) return freeze({ status: 'duplicate-suppressed', session, suggestion: pending, nextTrigger: nextTrigger(session, unconsumedEvents(session)) });
    const candidates = unconsumedEvents(session);
    if (!candidates.length) return freeze({ status: 'no-pending', session, suggestion: null, nextTrigger: nextTrigger(session) });
    const threshold = CINEMATIC_MODE_THRESHOLDS[session.mode];
    if (candidates.reduce((score, event) => score + event.score, 0) < threshold) return freeze({ status: 'below-threshold', session, suggestion: null, nextTrigger: nextTrigger(session, candidates) });
    const candidate = [...candidates].sort((left, right) => right.score - left.score || CHANGE_ORDER.indexOf(left.kind) - CHANGE_ORDER.indexOf(right.kind) || left.eventId.localeCompare(right.eventId))[0];
    const suggestion = createSuggestion(session, candidate, candidates);
    const nextSession = createCinematicSession({ ...session, pendingSuggestions: { ...session.pendingSuggestions, [suggestion.suggestionId]: suggestion } });
    return freeze({ status: 'suggested', session: nextSession, suggestion, nextTrigger: nextTrigger(nextSession, candidates, 'suggested') });
}
export function adjustCinematicSuggestion(suggestionValue, adjustments = {}) { if (!isRecord(suggestionValue)) return null; const suggestion = clone(suggestionValue); if (!['suggested', 'adjusted'].includes(suggestion.state)) return freeze(suggestion); return freeze({ ...suggestion, state: 'adjusted', adjustments: clone(adjustments) }); }
function dismissCard(suggestionValue) { if (!isRecord(suggestionValue)) return null; if (suggestionValue.state === 'approved') return freeze(clone(suggestionValue)); return freeze({ ...clone(suggestionValue), state: 'dismissed' }); }
export function dismissCinematicSuggestion(input, suggestionValue) {
    if (suggestionValue === undefined) return dismissCard(input); const session = createCinematicSession(input || {}); const suggestion = isRecord(suggestionValue) ? suggestionValue : null;
    if (!suggestion?.suggestionId || suggestion.sessionId !== session.sessionId) return { status: 'invalid-suggestion', session, suggestion: null }; const existing = session.pendingSuggestions[suggestion.suggestionId];
    if (!existing && session.dismissedSuggestionIds.includes(suggestion.suggestionId)) return freeze({ status: 'dismissed', session, suggestion: dismissCard(suggestion) }); if (!existing || !samePendingCore(existing, suggestion)) return { status: 'invalid-suggestion', session, suggestion: null };
    const pendingSuggestions = { ...session.pendingSuggestions }; delete pendingSuggestions[suggestion.suggestionId]; const consumedEventIds = [...new Set([...session.consumedEventIds, ...existing.eventIds])]; const nextSession = createCinematicSession({ ...session, pendingSuggestions, consumedEventIds, dismissedSuggestionIds: [...session.dismissedSuggestionIds, suggestion.suggestionId] });
    return freeze({ status: 'dismissed', session: nextSession, suggestion: dismissCard(existing) });
}
function planFor(session, suggestion, event) { return freeze({ schema: 1, planId: stableId('plan', { sessionId: session.sessionId, suggestionId: suggestion.suggestionId }), sessionId: session.sessionId, suggestionId: suggestion.suggestionId, eventId: suggestion.eventId, eventIds: suggestion.eventIds, beatId: suggestion.beatId, kind: suggestion.kind, triggerSource: suggestion.triggerSource, change: clone(event.change), adjustments: clone(suggestion.adjustments), estimatedCost: null, dispatch: { allowed: false, network: false, reason: 'approval-plan-only' } }); }
export function approveCinematicSuggestion(inputSession, suggestionValue, { estimatedCost } = {}) {
    const session = createCinematicSession(inputSession || {}); const suggestion = isRecord(suggestionValue) ? suggestionValue : null;
    if (!suggestion?.suggestionId || suggestion.sessionId !== session.sessionId) return { status: 'invalid-suggestion', session, plan: null }; if (session.approvedSuggestionIds.includes(suggestion.suggestionId)) { if (session.approvedSuggestionRecords[suggestion.suggestionId] && !samePendingCore(session.approvedSuggestionRecords[suggestion.suggestionId], suggestion)) return { status: 'invalid-suggestion', session, plan: null }; return freeze({ status: 'already-approved', session, plan: session.approvedPlans[suggestion.suggestionId] || null }); }
    const pending = session.pendingSuggestions[suggestion.suggestionId]; const event = pending && session.eventRegistry[pending.eventId]; if (!pending || !event || !samePendingCore(pending, suggestion)) return { status: 'invalid-suggestion', session, plan: null }; if (session.dismissedSuggestionIds.includes(suggestion.suggestionId) || suggestion.state === 'dismissed') return freeze({ status: 'dismissed', session, plan: null });
    const cost = validNonNegativeNumber(estimatedCost); if (cost === null) return freeze({ status: 'unknown-cost', session, plan: null }); if (session.costCeiling === null) return freeze({ status: 'unknown-cost-ceiling', session, plan: null }); if (session.generationLimit !== null && session.generationCount + session.reservedGenerationCount >= session.generationLimit) return freeze({ status: 'generation-limit', session, plan: null }); if (session.costSpent + session.reservedCost + cost > session.costCeiling) return freeze({ status: 'cost-ceiling', session, plan: null });
    const plan = { ...planFor(session, suggestion, event), estimatedCost: cost }; const pendingSuggestions = { ...session.pendingSuggestions }; delete pendingSuggestions[suggestion.suggestionId]; const reservation = { planId: plan.planId, planDigest: stableJson(plan), suggestionId: suggestion.suggestionId, eventIds: suggestion.eventIds, reservedCost: cost, status: 'reserved' }; const consumedEventIds = [...new Set([...session.consumedEventIds, ...suggestion.eventIds])];
    const nextSession = createCinematicSession({ ...session, pendingSuggestions, consumedEventIds, reservedGenerationCount: session.reservedGenerationCount + 1, reservedCost: session.reservedCost + cost, approvedSuggestionIds: [...session.approvedSuggestionIds, suggestion.suggestionId], approvedSuggestionRecords: { ...session.approvedSuggestionRecords, [suggestion.suggestionId]: clone(suggestion) }, approvedPlans: { ...session.approvedPlans, [suggestion.suggestionId]: plan }, reservations: { ...session.reservations, [plan.planId]: reservation } }); return freeze({ status: 'approved', session: nextSession, plan: freeze(plan) });
}
function releaseReservation(session, reservation) { return { ...session, reservedGenerationCount: Math.max(0, session.reservedGenerationCount - 1), reservedCost: Math.max(0, session.reservedCost - reservation.reservedCost) }; }
export function settleCinematicPlan(inputSession, planValue, outcome, { actualCost } = {}) {
    const session = createCinematicSession(inputSession || {}); const plan = isRecord(planValue) ? planValue : null; const reservation = plan?.planId ? session.reservations[plan.planId] : null; if (!plan?.planId || plan.sessionId !== session.sessionId) return { status: 'invalid-plan', session, plan: null }; const storedPlan = plan.suggestionId ? session.approvedPlans[plan.suggestionId] : null; if (!storedPlan || stableJson(plan) !== stableJson(storedPlan) || (reservation?.planDigest && reservation.planDigest !== stableJson(plan))) return { status: 'invalid-plan', session, plan: null }; const priorSettlement = session.settledPlans[plan.planId]; if (priorSettlement) return freeze({ status: priorSettlement.outcome, session, plan: storedPlan }); if (!reservation) return { status: 'invalid-plan', session, plan: null };
    const normalizedOutcome = cleanText(outcome).toLocaleLowerCase('und'); if (!['dispatched', 'completed', 'failed', 'cancelled'].includes(normalizedOutcome)) return { status: 'invalid-outcome', session, plan };
    if (normalizedOutcome === 'dispatched') { if (reservation.status === 'dispatched') return freeze({ status: 'dispatched', session, plan }); const reservations = { ...session.reservations, [plan.planId]: { ...reservation, status: 'dispatched' } }; return freeze({ status: 'dispatched', session: createCinematicSession({ ...session, reservations }), plan }); }
    if (normalizedOutcome === 'completed') { const cost = validNonNegativeNumber(actualCost); if (cost === null) return freeze({ status: 'unknown-cost', session, plan }); const available = session.costCeiling === null ? null : session.costCeiling - session.costSpent - (session.reservedCost - reservation.reservedCost); if (available === null) return freeze({ status: 'unknown-cost-ceiling', session, plan }); if (cost > available) return freeze({ status: 'cost-ceiling', session, plan }); const released = releaseReservation(session, reservation); const reservations = { ...released.reservations }; delete reservations[plan.planId]; const settledPlans = { ...released.settledPlans, [plan.planId]: { outcome: 'completed', actualCost: cost } }; const nextSession = createCinematicSession({ ...released, reservations, settledPlans, generationCount: released.generationCount + 1, costSpent: released.costSpent + cost }); return freeze({ status: 'completed', session: nextSession, plan: session.approvedPlans[plan.suggestionId] || plan }); }
    const released = releaseReservation(session, reservation); const reservations = { ...released.reservations }; delete reservations[plan.planId]; const settledPlans = { ...released.settledPlans, [plan.planId]: { outcome: normalizedOutcome, actualCost: 0 } }; return freeze({ status: normalizedOutcome, session: createCinematicSession({ ...released, reservations, settledPlans }), plan: session.approvedPlans[plan.suggestionId] || plan });
}
export function retriggerCinematicBeat({ session: inputSession, beatId, retriggerId = 'manual', reason = 'manual retrigger for missed or failed beat' } = {}) {
    const session = createCinematicSession(inputSession || {}); const beat = cleanText(beatId); const retry = cleanText(retriggerId); if (!beat || !retry) return { status: 'invalid-retrigger', session, suggestion: null }; const key = `${beat.length}:${beat}|${retry.length}:${retry}`; if (session.retriggerSuggestions[key]) return freeze({ status: 'suggested', session, suggestion: session.retriggerSuggestions[key] }); const existingPending = Object.values(session.pendingSuggestions)[0]; if (existingPending) return freeze({ status: 'pending-suppressed', session, suggestion: existingPending }); const event = { eventId: stableId('manual-event', { sessionId: session.sessionId, beatId: beat, retriggerId: retry }), beatId: beat, kind: 'emotional-beat', score: 3, change: { id: beat, label: beat, confidence: null }, whyFired: { reason: 'manual retrigger', text: `Manual retrigger requested: ${cleanText(reason) || 'missed or failed beat'}.`, evidence: [] } }; const suggestion = createSuggestion(session, event, [event], 'manual-retrigger', { beatId: beat, retriggerId: retry }); const eventRegistry = { ...session.eventRegistry, [event.eventId]: event }; const pendingSuggestions = { ...session.pendingSuggestions, [suggestion.suggestionId]: suggestion }; const nextSession = createCinematicSession({ ...session, eventRegistry, seenEventIds: Object.keys(eventRegistry), pendingSuggestions, retriggerSuggestions: { ...session.retriggerSuggestions, [key]: suggestion } }); return freeze({ status: 'suggested', session: nextSession, suggestion });
}
export function resetCinematicSession(inputSession, { sessionId } = {}) { const session = createCinematicSession(inputSession || {}); return createCinematicSession({ sessionId: cleanText(sessionId) || `${session.sessionId}:reset`, mode: session.mode, costCeiling: session.costCeiling, generationLimit: session.generationLimit }); }
export const deriveStoryChangeEvents = deriveCinematicEvents;
export const projectCinematicAutomation = evaluateCinematicAutomation;
export const drainPendingCinematicSuggestion = projectNextCinematicSuggestion;
export const manuallyRetriggerCinematicBeat = retriggerCinematicBeat;
export const settleCinematicGeneration = settleCinematicPlan;

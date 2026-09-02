import {
    adjustCinematicSuggestion,
    approveCinematicSuggestion,
    createCinematicSession,
    dismissCinematicSuggestion,
    evaluateCinematicAutomation,
    projectNextCinematicSuggestion,
    retriggerCinematicBeat,
    settleCinematicPlan,
} from './cinematic-automation.js';
import { createBoundedRecencyMap } from '../bounded-recency-map.js';

export const CINEMATIC_AUTOMATION_KEY = 'cinematicAutomation';
export const CINEMATIC_RUNTIME_SCHEMA = 1;
export const CINEMATIC_DURABLE_SCHEMA = 1;
const MAX_DURABLE_MAP_ENTRIES = 96;
const MAX_DURABLE_CHARS = 240;

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function text(value, max = 8000) { const result = String(value ?? '').replace(/\s+/gu, ' ').trim(); return result.length <= max ? result : result.slice(0, max); }
function stable(value) { return JSON.stringify(value === undefined ? null : value); }
function messageFingerprint(message) {
    const source = stable({ mes: text(message?.mes ?? message?.text), name: text(message?.name), isUser: message?.is_user === true });
    let hash = 2166136261;
    for (const character of source) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    return `cig-fp:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function stateOrEmpty(value) { return isRecord(value) ? value : { schema: 1, durableIdentityFacts: {}, sceneFacts: {} }; }
function hasChange(delta) {
    return ['updatedSceneFacts', 'addedSceneFacts', 'removedSceneFacts'].some((key) => isRecord(delta?.[key]) && Object.values(delta[key]).some((value) => Array.isArray(value) ? value.length > 0 : isRecord(value) ? Object.keys(value).length > 0 : value != null));
}
function proposedShot(event) {
    const change = event?.change || {};
    if (event?.kind === 'location') return `Wide establishing shot of ${text(change.to || 'the new location', 120)}`;
    if (event?.kind === 'outfit') return 'Medium character shot highlighting the new outfit';
    if (event?.kind === 'cast') return 'Medium group shot introducing the changed cast';
    return 'Cinematic close-up of the emotional beat';
}
function budgetText(session) {
    if (session?.generationLimit !== null && session?.generationLimit !== undefined) return `${session.generationCount} of ${session.generationLimit} generations used`;
    if (session?.costCeiling !== null && session?.costCeiling !== undefined) return `${session.costSpent} of ${session.costCeiling} cost used`;
    return 'No automatic budget configured';
}
function budgetAvailable(session) {
    if (session?.generationLimit !== null && session?.generationLimit !== undefined) return session.generationCount + session.reservedGenerationCount < session.generationLimit;
    if (session?.costCeiling !== null && session?.costCeiling !== undefined) return session.costSpent + session.reservedCost < session.costCeiling;
    return false;
}
function decorateSuggestion(suggestion, session, target) {
    if (!suggestion) return null;
    return Object.freeze({ ...clone(suggestion), target: clone(target || suggestion.target || null), proposedShot: suggestion.proposedShot || proposedShot(suggestion), budgetText: budgetText(session), waitingText: suggestion.nextTrigger?.explanation || 'Waiting for an accepted story change.' });
}
function compactWhy(why) {
    if (!isRecord(why)) return undefined;
    return {
        ...(why.reason ? { reason: text(why.reason, 120) } : {}),
        ...(why.text ? { text: text(why.text, MAX_DURABLE_CHARS) } : {}),
    };
}
function compactEvent(event) {
    if (!isRecord(event)) return event;
    return { ...clone(event), ...(event.whyFired ? { whyFired: compactWhy(event.whyFired) } : {}) };
}
function compactSuggestion(suggestion) {
    if (!isRecord(suggestion)) return suggestion;
    const adjustments = isRecord(suggestion.adjustments) ? {
        ...(suggestion.adjustments.prompt ? { prompt: text(suggestion.adjustments.prompt, 400) } : {}),
    } : {};
    return { ...clone(suggestion), adjustments, ...(suggestion.whyFired ? { whyFired: compactWhy(suggestion.whyFired) } : {}) };
}
function boundedMap(value, mapper, limit = MAX_DURABLE_MAP_ENTRIES) {
    if (!isRecord(value)) return {};
    const entries = Object.entries(value).slice(-limit);
    return Object.fromEntries(entries.map(([key, item]) => [key, mapper(item)]));
}
function protectedEventIds(session) {
    const ids = new Set();
    const protect = (suggestion) => {
        if (!isRecord(suggestion)) return;
        for (const id of [...(Array.isArray(suggestion.eventIds) ? suggestion.eventIds : []), suggestion.eventId]) if (id) ids.add(String(id));
    };
    Object.values(session.pendingSuggestions || {}).forEach(protect);
    for (const reservation of Object.values(session.reservations || {})) {
        const plan = session.approvedPlans?.[reservation?.suggestionId];
        protect(plan);
    }
    return ids;
}
function boundedEventRegistry(session) {
    const entries = Object.entries(session.eventRegistry || {});
    const protectedIds = protectedEventIds(session);
    const protectedEntries = entries.filter(([id]) => protectedIds.has(id));
    const unprotectedEntries = entries.filter(([id]) => !protectedIds.has(id));
    const remaining = Math.max(0, MAX_DURABLE_MAP_ENTRIES - protectedEntries.length);
    return Object.fromEntries([...protectedEntries, ...unprotectedEntries.slice(-remaining)].map(([key, value]) => [key, compactEvent(value)]));
}
function compactSession(session) {
    const value = createCinematicSession(session || {});
    return createCinematicSession({
        ...value,
        seenEventIds: value.seenEventIds.slice(-MAX_DURABLE_MAP_ENTRIES),
        consumedEventIds: value.consumedEventIds.slice(-MAX_DURABLE_MAP_ENTRIES),
        approvedSuggestionIds: value.approvedSuggestionIds.slice(-MAX_DURABLE_MAP_ENTRIES),
        dismissedSuggestionIds: value.dismissedSuggestionIds.slice(-MAX_DURABLE_MAP_ENTRIES),
        eventRegistry: boundedEventRegistry(value),
        pendingSuggestions: boundedMap(value.pendingSuggestions, compactSuggestion, 4),
        approvedSuggestionRecords: boundedMap(value.approvedSuggestionRecords, compactSuggestion),
        approvedPlans: boundedMap(value.approvedPlans, clone),
        reservations: boundedMap(value.reservations, clone),
        settledPlans: boundedMap(value.settledPlans, clone),
        retriggerSuggestions: boundedMap(value.retriggerSuggestions, compactSuggestion, 16),
    });
}
export function compactCinematicRuntimeState(state = {}) {
    const session = compactSession(state.session);
    const queuedEvents = Array.isArray(state.queuedEvents)
        ? state.queuedEvents.slice(-24).map((event) => ({ messageId: event?.messageId, fingerprint: text(event?.fingerprint, 120) }))
        : [];
    const lastResult = isRecord(state.lastResult)
        ? {
            status: text(state.lastResult.status, 48),
            ...(state.lastResult.suggestion ? { suggestion: compactSuggestion(state.lastResult.suggestion) } : {}),
            ...(state.lastResult.nextTrigger ? { nextTrigger: clone(state.lastResult.nextTrigger) } : {}),
        }
        : null;
    return {
        schema: CINEMATIC_RUNTIME_SCHEMA,
        session,
        processedMessageIds: Array.isArray(state.processedMessageIds) ? state.processedMessageIds.slice(-MAX_DURABLE_MAP_ENTRIES).map((value) => text(value, 160)) : [],
        queuedEvents,
        lastResult,
    };
}
function initialState(chatId, settings, persisted) {
    const stored = isRecord(persisted?.[CINEMATIC_AUTOMATION_KEY]) ? persisted[CINEMATIC_AUTOMATION_KEY] : {};
    const session = createCinematicSession({
        ...stored.session,
        sessionId: text(stored.session?.sessionId) || text(chatId) || 'session:default',
        mode: settings && Object.prototype.hasOwnProperty.call(settings, 'mode') ? settings.mode : stored.session?.mode,
        generationLimit: settings && Object.prototype.hasOwnProperty.call(settings, 'generationLimit') ? settings.generationLimit : stored.session?.generationLimit,
        costCeiling: settings && Object.prototype.hasOwnProperty.call(settings, 'costCeiling') ? settings.costCeiling : stored.session?.costCeiling,
    });
    return {
        schema: CINEMATIC_RUNTIME_SCHEMA,
        chatId: text(chatId),
        session,
        storyState: clone(stored.storyState || persisted?.storyState || stateOrEmpty()),
        processedMessageIds: Array.isArray(stored.processedMessageIds) ? [...new Set(stored.processedMessageIds.map(String))] : [],
        queuedEvents: Array.isArray(stored.queuedEvents) ? clone(stored.queuedEvents) : [],
        lastResult: stored.lastResult || null,
    };
}

/** Chat-scoped coordinator for cinematic suggestions. It performs no provider work while observing or editing cards. */
export function createCinematicRuntime({
    settings = {},
    getChatId = () => null,
    getChat = () => [],
    getEpoch = () => 0,
    readState = () => ({}),
    writeState = () => {},
    saveChat = async () => {},
    readDurableState = () => null,
    writeDurableState = () => {},
    saveDurableState = async () => {},
    interpret,
    dispatch = async () => { throw new Error('Cinematic dispatch is unavailable.'); },
    validateRoute = async () => ({ allowed: true }),
    fingerprint = messageFingerprint,
    routeKey = () => null,
} = {}) {
    let current = null;
    // A dispatch can outlive the active chat. Keep immutable snapshots per chat
    // so a late receipt settles the chat that reserved it, never the new UI chat.
    const chatStates = createBoundedRecencyMap({
        maxEntries: 32,
        isProtected: (chatId, state) => activeChat(chatId)
            || (state?.queuedEvents?.length || 0) > 0
            || Object.keys(state?.session?.pendingSuggestions || {}).length > 0
            || Object.keys(state?.session?.reservations || {}).length > 0,
    });
    let operation = Promise.resolve();
    let destroyed = false;
    const enqueue = (task) => { const next = operation.catch(() => {}).then(task); operation = next.catch(() => {}); return next; };
    const currentEnough = ({ chatId, epoch }) => !destroyed && text(getChatId()) === text(chatId) && Number(getEpoch()) === Number(epoch);
    const activeChat = (chatId) => !destroyed && text(getChatId()) === text(chatId);
    const ensureCurrent = ({ chatId, epoch }) => { if (!currentEnough({ chatId, epoch })) return { status: 'stale' }; return null; };
    const remember = (state) => {
        if (state?.chatId) chatStates.set(text(state.chatId), state);
        return state;
    };
    const persist = async (state = current) => {
        if (!state) return;
        remember(state);
        const chatId = text(state.chatId);
        const active = text(getChatId()) === chatId;
        const durable = { schema: CINEMATIC_DURABLE_SCHEMA, session: compactSession(state.session) };
        writeDurableState(durable, { chatId, active });
        await saveDurableState({ chatId, state: durable });
        const stored = { [CINEMATIC_AUTOMATION_KEY]: compactCinematicRuntimeState(state), storyState: clone(state.storyState) };
        delete stored[CINEMATIC_AUTOMATION_KEY].chatId;
        // Never write chat A's metadata into chat B while a deferred approval is
        // settling. The in-memory per-chat state is flushed when A is active again.
        writeState(stored, { chatId, active });
        if (active) await saveChat({ chatId });
    };
    const setResult = (result) => {
        current = { ...current, lastResult: { status: result?.status || 'idle', suggestion: clone(result?.suggestion || null), nextTrigger: clone(result?.nextTrigger || null) } };
        return result;
    };
    const refreshProjection = () => {
        const projected = projectNextCinematicSuggestion({ session: current.session });
        if (projected.status === 'suggested') current = { ...current, session: projected.session };
        return projected;
    };
    function load({ chatId = getChatId(), epoch = getEpoch() } = {}) {
        destroyed = false;
        const key = text(chatId);
        const durable = readDurableState({ chatId: key });
        const persisted = readState({ chatId: key }) || {};
        const merged = durable?.session ? { ...persisted, [CINEMATIC_AUTOMATION_KEY]: { ...(persisted[CINEMATIC_AUTOMATION_KEY] || {}), session: durable.session } } : persisted;
        current = chatStates.get(key) || initialState(chatId, settings, merged);
        const pending = Object.values(current.session.pendingSuggestions || {})[0] || null;
        if (pending?.target && text(pending.target.chatId) === key && Number(pending.target.epoch) !== Number(epoch)) {
            const rebound = { ...pending, target: { ...pending.target, epoch: Number(epoch) } };
            current = { ...current, session: createCinematicSession({ ...current.session, pendingSuggestions: { ...current.session.pendingSuggestions, [pending.suggestionId]: rebound } }) };
        }
        remember(current);
        const loadedPending = Object.values(current.session.pendingSuggestions || {})[0] || null;
        return { status: 'loaded', epoch, chatId: text(chatId), suggestion: decorateSuggestion(loadedPending, current.session, loadedPending?.target), nextTrigger: loadedPending?.nextTrigger || null };
    }
    function getState() {
        if (!current) return null;
        const pending = Object.values(current.session.pendingSuggestions || {})[0] || null;
        return clone({ ...current, suggestion: decorateSuggestion(pending, current.session, pending?.target), budgetText: budgetText(current.session) });
    }
    function observe(input = {}) {
        return enqueue(async () => {
            const stale = ensureCurrent(input); if (stale) return stale;
            if (!current || text(current.chatId) !== text(input.chatId)) load(input);
            if (settings.enabled === false || settings.mode === 'off') return setResult({ status: 'disabled', suggestion: null });
            let source = current;
            const processedKey = `${String(input.messageId)}:${fingerprint(input.message)}`;
            if (source.processedMessageIds.includes(processedKey)) {
                const pending = Object.values(source.session.pendingSuggestions || {})[0] || null;
                return setResult({ status: 'duplicate-suppressed', suggestion: decorateSuggestion(pending, source.session, pending?.target) });
            }
            if (!budgetAvailable(source.session)) {
                current = { ...source, processedMessageIds: [...source.processedMessageIds, processedKey].slice(-256), queuedEvents: source.queuedEvents.slice(1) };
                const stopped = setResult({ status: 'budget-stopped', suggestion: null, nextTrigger: { explanation: 'Automatic suggestions stopped because the session ceiling was reached.' } });
                await persist();
                return stopped;
            }
            source = remember({ ...source, processedMessageIds: [...source.processedMessageIds, processedKey].slice(-256), queuedEvents: [...source.queuedEvents, { messageId: input.messageId, fingerprint: fingerprint(input.message) }] });
            let delta = input.acceptedSceneDelta;
            let interpretation = null;
            if (!delta && typeof interpret === 'function') interpretation = await interpret({ ...input, priorStoryState: source.storyState });
            const interpreted = interpretation?.storyStateDelta ? interpretation : interpretation?.interpretation;
            if (interpreted?.storyStateDelta) {
                const sceneDelta = interpreted.storyStateDelta;
                source = { ...source, storyState: clone(sceneDelta.nextState || interpretation.state || source.storyState) };
                const ambiguous = (interpreted.ambiguities?.length || interpreted.location?.status === 'ambiguous' || interpreted.outfits?.some?.((entry) => entry?.status === 'ambiguous'));
                delta = {
                    accepted: ambiguous !== true && hasChange(sceneDelta),
                    revision: `message:${input.messageId}:${fingerprint(input.message)}`,
                    updatedSceneFacts: sceneDelta.updatedSceneFacts,
                    addedSceneFacts: sceneDelta.addedSceneFacts,
                    removedSceneFacts: sceneDelta.removedSceneFacts,
                    acceptedEvidence: interpreted.focusPassage?.evidence,
                    ...(interpreted.emotionalBeat ? { emotionalBeat: interpreted.emotionalBeat } : {}),
                    ...(ambiguous ? { ambiguous: true } : {}),
                };
            }
            if (!delta) delta = { accepted: false };
            const evaluated = evaluateCinematicAutomation({ session: source.session, acceptedSceneDelta: delta });
            source = { ...source, session: evaluated.session, queuedEvents: source.queuedEvents.slice(1) };
            const target = { chatId: text(input.chatId), messageId: Number(input.messageId), messageFingerprint: fingerprint(input.message), routeKey: clone(routeKey()), epoch: Number(input.epoch) };
            const suggestion = decorateSuggestion(evaluated.suggestion, source.session, target);
            if (suggestion && source.session.pendingSuggestions[suggestion.suggestionId]) {
                source = { ...source, session: createCinematicSession({ ...source.session, pendingSuggestions: { ...source.session.pendingSuggestions, [suggestion.suggestionId]: suggestion } }) };
            }
            const result = { ...evaluated, suggestion };
            const settled = remember({ ...source, lastResult: { status: result.status || 'idle', suggestion: clone(result.suggestion || null), nextTrigger: clone(result.nextTrigger || null) } });
            if (activeChat(settled.chatId)) current = settled;
            await persist(settled);
            return result;
        });
    }
    function adjust(suggestionId, adjustments = {}) {
        return enqueue(async () => {
            const stale = ensureCurrent({ chatId: current?.chatId, epoch: getEpoch() }); if (stale) return stale;
            const existing = current?.session?.pendingSuggestions?.[suggestionId]; if (!existing) return { status: 'invalid-suggestion' };
            const adjusted = adjustCinematicSuggestion(existing, adjustments);
            current = { ...current, session: createCinematicSession({ ...current.session, pendingSuggestions: { ...current.session.pendingSuggestions, [suggestionId]: adjusted } }) };
            await persist();
            return { status: 'adjusted', suggestion: decorateSuggestion(adjusted, current.session, adjusted.target) };
        });
    }
    function dismiss(suggestionId) {
        const requestedState = current;
        const requestedCapture = { chatId: text(getChatId()), epoch: Number(getEpoch()) };
        return enqueue(async () => {
            const source = current && requestedState && text(current.chatId) === text(requestedState.chatId) ? current : requestedState;
            if (!source || text(source.chatId) !== requestedCapture.chatId || !currentEnough(requestedCapture)) return { status: 'stale', reason: 'The chat changed before this cinematic suggestion could be dismissed.' };
            const existing = source.session?.pendingSuggestions?.[suggestionId]; if (!existing) return { status: source.session?.dismissedSuggestionIds?.includes(suggestionId) ? 'dismissed' : 'invalid-suggestion' };
            const dismissed = dismissCinematicSuggestion(source.session, existing);
            current = { ...source, session: dismissed.session };
            // A dismissal is a terminal player choice for this card. Leave any
            // queued beats recorded for a later accepted change instead of
            // replacing the dismissed card during the same UI refresh.
            const next = projectNextCinematicSuggestion({ session: current.session });
            await persist();
            return { ...dismissed, suggestion: null, nextTrigger: next.nextTrigger };
        });
    }
    function stage(suggestionId) {
        const requestedState = current;
        const requestedCapture = { chatId: text(getChatId()), epoch: Number(getEpoch()) };
        return enqueue(async () => {
            const source = current && requestedState && text(current.chatId) === text(requestedState.chatId) ? current : requestedState;
            if (!source || text(source.chatId) !== requestedCapture.chatId || !currentEnough(requestedCapture)) return { status: 'stale', reason: 'The chat changed before this cinematic suggestion could be staged.' };
            const existing = source.session?.pendingSuggestions?.[suggestionId];
            if (!existing) return { status: source.session?.dismissedSuggestionIds?.includes(suggestionId) ? 'staged' : 'invalid-suggestion' };
            const dismissed = dismissCinematicSuggestion(source.session, existing);
            current = { ...source, session: dismissed.session };
            await persist();
            return { status: 'staged', suggestion: clone(existing), nextTrigger: dismissed.nextTrigger };
        });
    }
    function approve(suggestionId) {
        // Capture the source chat synchronously. The provider dispatch is
        // deferred, and a chat switch can happen before the queued task starts.
        const requestedState = current;
        return enqueue(async () => {
            const source = current && requestedState && text(current.chatId) === text(requestedState.chatId) ? current : requestedState;
            const suggestion = source?.session?.pendingSuggestions?.[suggestionId]; if (!suggestion) return { status: 'invalid-suggestion' };
            const target = suggestion.target;
            if (!target || !currentEnough({ chatId: target.chatId, epoch: target.epoch })) return { status: 'stale' };
            if (text(getChatId()) !== text(target.chatId)) return { status: 'stale' };
            if (target.routeKey !== null && stable(target.routeKey) !== stable(routeKey())) return { status: 'route-invalid', reason: 'The image route changed after this suggestion was created.' };
            const route = await validateRoute({ suggestion: clone(suggestion), target: clone(target) });
            if (route?.allowed !== true) return { status: route?.status || 'route-invalid', reason: route?.reason };
            const approved = approveCinematicSuggestion(source.session, suggestion, {});
            if (approved.status !== 'approved') return approved;
            const approvalState = remember({ ...source, session: approved.session });
            current = approvalState;
            let receipt;
            try {
                await persist(approvalState);
                receipt = await dispatch({ plan: approved.plan, suggestion: clone(suggestion), target: clone(target) });
            } catch (error) {
                const failed = settleCinematicPlan(approvalState.session, approved.plan, 'failed');
                const failedState = remember({ ...approvalState, session: failed.session });
                if (activeChat(approvalState.chatId)) current = failedState;
                try { await persist(failedState); } catch { /* the in-memory reservation is already settled */ }
                return { status: 'failed', error, session: failedState.session };
            }
            const settled = settleCinematicPlan(approvalState.session, approved.plan, receipt?.status === 'completed' ? 'completed' : 'failed', { actualCost: receipt?.receipt?.actualCost ?? receipt?.actualCost });
            const settledState = settled.status === 'completed' || settled.status === 'failed'
                ? remember({ ...approvalState, session: settled.session })
                : approvalState;
            if (activeChat(approvalState.chatId)) current = settledState;
            await persist(settledState);
            return { ...settled, receipt, session: settledState.session };
        });
    }
    function retrigger(beatId, retriggerId = 'manual', reason, captured = {}) {
        const invocation = {
            chatId: text(captured?.chatId ?? getChatId()),
            epoch: Number(captured?.epoch ?? getEpoch()),
        };
        return enqueue(async () => {
            const stale = ensureCurrent(invocation);
            if (stale) return { ...stale, reason: 'The chat changed before the cinematic suggestion was created.' };
            if (!current || text(current.chatId) !== invocation.chatId) load(invocation);
            const result = retriggerCinematicBeat({ session: current.session, beatId, retriggerId, reason });
            if (result.suggestion) {
                const chat = getChat();
                const messageId = Array.isArray(chat) && chat.length ? chat.length - 1 : null;
                const target = { chatId: invocation.chatId, messageId, messageFingerprint: messageId === null ? '' : fingerprint(chat[messageId]), routeKey: clone(routeKey()), epoch: invocation.epoch };
                const suggestion = decorateSuggestion(result.suggestion, result.session, target);
                current = { ...current, session: createCinematicSession({ ...result.session, pendingSuggestions: { ...result.session.pendingSuggestions, [suggestion.suggestionId]: suggestion } }) };
                await persist();
                if (!currentEnough(invocation)) return { status: 'stale', reason: 'The chat changed while the cinematic suggestion was being saved.' };
                return { ...result, suggestion };
            }
            return result;
        });
    }
    return {
        load, getState, observe, adjust, dismiss, stage, approve, retrigger,
        updateSettings(next = {}) {
            Object.assign(settings, next);
            for (const [key, state] of [...chatStates.entries()]) {
                const updated = { ...state, session: createCinematicSession({ ...state.session, mode: settings.mode, generationLimit: settings.generationLimit, costCeiling: settings.costCeiling }) };
                chatStates.set(key, updated);
                if (current === state) current = updated;
            }
            return settings;
        },
        destroy() { destroyed = true; current = null; chatStates.clear(); },
    };
}

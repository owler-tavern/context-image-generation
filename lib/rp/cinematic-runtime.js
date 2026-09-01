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

export const CINEMATIC_AUTOMATION_KEY = 'cinematicAutomation';
export const CINEMATIC_RUNTIME_SCHEMA = 1;

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function text(value, max = 8000) { const result = String(value ?? '').replace(/\s+/gu, ' ').trim(); return result.length <= max ? result : result.slice(0, max); }
function stable(value) { return JSON.stringify(value === undefined ? null : value); }
function messageFingerprint(message) { return stable({ mes: text(message?.mes ?? message?.text), name: text(message?.name), isUser: message?.is_user === true }); }
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
    interpret,
    dispatch = async () => { throw new Error('Cinematic dispatch is unavailable.'); },
    validateRoute = async () => ({ allowed: true }),
    fingerprint = messageFingerprint,
    routeKey = () => null,
} = {}) {
    let current = null;
    let operation = Promise.resolve();
    let destroyed = false;
    const enqueue = (task) => { const next = operation.catch(() => {}).then(task); operation = next.catch(() => {}); return next; };
    const currentEnough = ({ chatId, epoch }) => !destroyed && text(getChatId()) === text(chatId) && Number(getEpoch()) === Number(epoch);
    const ensureCurrent = ({ chatId, epoch }) => { if (!currentEnough({ chatId, epoch })) return { status: 'stale' }; return null; };
    const persist = async () => {
        if (!current) return;
        const stored = { [CINEMATIC_AUTOMATION_KEY]: clone(current), storyState: clone(current.storyState) };
        delete stored[CINEMATIC_AUTOMATION_KEY].chatId;
        writeState(stored);
        await saveChat();
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
        current = initialState(chatId, settings, readState());
        const pending = Object.values(current.session.pendingSuggestions || {})[0] || null;
        return { status: 'loaded', epoch, chatId: text(chatId), suggestion: decorateSuggestion(pending, current.session, pending?.target), nextTrigger: pending?.nextTrigger || null };
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
            const processedKey = `${String(input.messageId)}:${fingerprint(input.message)}`;
            if (current.processedMessageIds.includes(processedKey)) {
                const pending = Object.values(current.session.pendingSuggestions || {})[0] || null;
                return setResult({ status: 'duplicate-suppressed', suggestion: decorateSuggestion(pending, current.session, pending?.target) });
            }
            if (!budgetAvailable(current.session)) {
                current = { ...current, processedMessageIds: [...current.processedMessageIds, processedKey].slice(-256), queuedEvents: current.queuedEvents.slice(1) };
                const stopped = setResult({ status: 'budget-stopped', suggestion: null, nextTrigger: { explanation: 'Automatic suggestions stopped because the session ceiling was reached.' } });
                await persist();
                return stopped;
            }
            current = { ...current, processedMessageIds: [...current.processedMessageIds, processedKey].slice(-256), queuedEvents: [...current.queuedEvents, { messageId: input.messageId, fingerprint: fingerprint(input.message) }] };
            let delta = input.acceptedSceneDelta;
            let interpretation = null;
            if (!delta && typeof interpret === 'function') interpretation = await interpret({ ...input, priorStoryState: current.storyState });
            const interpreted = interpretation?.storyStateDelta ? interpretation : interpretation?.interpretation;
            if (interpreted?.storyStateDelta) {
                const sceneDelta = interpreted.storyStateDelta;
                current = { ...current, storyState: clone(sceneDelta.nextState || interpretation.state || current.storyState) };
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
            const evaluated = evaluateCinematicAutomation({ session: current.session, acceptedSceneDelta: delta });
            current = { ...current, session: evaluated.session, queuedEvents: current.queuedEvents.slice(1) };
            const target = { chatId: text(input.chatId), messageId: Number(input.messageId), messageFingerprint: fingerprint(input.message), routeKey: clone(routeKey()), epoch: Number(input.epoch) };
            const suggestion = decorateSuggestion(evaluated.suggestion, current.session, target);
            if (suggestion && current.session.pendingSuggestions[suggestion.suggestionId]) {
                current = { ...current, session: createCinematicSession({ ...current.session, pendingSuggestions: { ...current.session.pendingSuggestions, [suggestion.suggestionId]: suggestion } }) };
            }
            const result = setResult({ ...evaluated, suggestion });
            await persist();
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
        return enqueue(async () => {
            const existing = current?.session?.pendingSuggestions?.[suggestionId]; if (!existing) return { status: current?.session?.dismissedSuggestionIds?.includes(suggestionId) ? 'dismissed' : 'invalid-suggestion' };
            const dismissed = dismissCinematicSuggestion(current.session, existing);
            current = { ...current, session: dismissed.session };
            const next = refreshProjection();
            await persist();
            return { ...dismissed, suggestion: decorateSuggestion(next.suggestion, current.session, next.suggestion?.target), nextTrigger: next.nextTrigger };
        });
    }
    function approve(suggestionId) {
        return enqueue(async () => {
            const suggestion = current?.session?.pendingSuggestions?.[suggestionId]; if (!suggestion) return { status: 'invalid-suggestion' };
            const target = suggestion.target;
            if (!target || !currentEnough({ chatId: target.chatId, epoch: target.epoch })) return { status: 'stale' };
            if (text(getChatId()) !== text(target.chatId)) return { status: 'stale' };
            if (target.routeKey !== null && stable(target.routeKey) !== stable(routeKey())) return { status: 'route-invalid', reason: 'The image route changed after this suggestion was created.' };
            const route = await validateRoute({ suggestion: clone(suggestion), target: clone(target) });
            if (route?.allowed !== true) return { status: route?.status || 'route-invalid', reason: route?.reason };
            const approved = approveCinematicSuggestion(current.session, suggestion, {});
            if (approved.status !== 'approved') return approved;
            current = { ...current, session: approved.session };
            await persist();
            let receipt;
            try {
                receipt = await dispatch({ plan: approved.plan, suggestion: clone(suggestion), target: clone(target) });
            } catch (error) {
                const failed = settleCinematicPlan(current.session, approved.plan, 'failed');
                current = { ...current, session: failed.session };
                await persist();
                return { status: 'failed', error, session: current.session };
            }
            const settled = settleCinematicPlan(current.session, approved.plan, receipt?.status === 'completed' ? 'completed' : 'failed', { actualCost: receipt?.receipt?.actualCost ?? receipt?.actualCost });
            if (settled.status === 'completed' || settled.status === 'failed') current = { ...current, session: settled.session };
            await persist();
            return { ...settled, receipt, session: current.session };
        });
    }
    function retrigger(beatId, retriggerId = 'manual', reason) {
        return enqueue(async () => {
            const result = retriggerCinematicBeat({ session: current.session, beatId, retriggerId, reason });
            if (result.suggestion) {
                const chat = getChat();
                const messageId = Array.isArray(chat) && chat.length ? chat.length - 1 : null;
                const target = { chatId: current.chatId, messageId, messageFingerprint: messageId === null ? '' : fingerprint(chat[messageId]), routeKey: clone(routeKey()), epoch: getEpoch() };
                const suggestion = decorateSuggestion(result.suggestion, result.session, target);
                current = { ...current, session: createCinematicSession({ ...result.session, pendingSuggestions: { ...result.session.pendingSuggestions, [suggestion.suggestionId]: suggestion } }) };
                await persist();
                return { ...result, suggestion };
            }
            return result;
        });
    }
    return {
        load, getState, observe, adjust, dismiss, approve, retrigger,
        updateSettings(next = {}) { Object.assign(settings, next); if (current) current = { ...current, session: createCinematicSession({ ...current.session, mode: settings.mode, generationLimit: settings.generationLimit, costCeiling: settings.costCeiling }) }; return settings; },
        destroy() { destroyed = true; current = null; },
    };
}

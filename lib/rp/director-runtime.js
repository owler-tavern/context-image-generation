import { normalizeDirectorCastOverrides } from './director-cast.js';

export const DIRECTOR_STATE_KEY = 'director';
export const DIRECTOR_RUNTIME_SCHEMA = 1;

const FRAMINGS = new Set(['auto', 'close-up', 'medium', 'wide', 'full-body']);
const CONTINUITY = new Set(['minimal', 'balanced', 'strong']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function text(value, max = 800) {
    const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return normalized.length <= max ? normalized : normalized.slice(0, max);
}
function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) result = Math.imul(result ^ character.codePointAt(0), 16777619);
    return `director-fp:${(result >>> 0).toString(16).padStart(8, '0')}`;
}
function fingerprint(message) { return hash(JSON.stringify([message?.send_date ?? null, message?.name ?? null, message?.is_user === true, message?.mes ?? null])); }
function castCandidates(value) {
    return (Array.isArray(value) ? value : []).slice(0, 12).map((candidate) => ({
        identityId: text(candidate?.identityId || candidate?.id, 160),
        label: text(candidate?.label || candidate?.name, 120) || 'Character',
        kind: text(candidate?.kind, 40) || 'character',
        action: ['include', 'focus', 'exclude'].includes(candidate?.action) ? candidate.action : 'include',
        inferredAction: ['include', 'focus', 'exclude'].includes(candidate?.inferredAction) ? candidate.inferredAction : 'include',
        confidence: text(candidate?.confidence, 40) || 'medium',
    })).filter((candidate) => candidate.identityId);
}
function options(value = {}, allowedIdentityIds = null) {
    return {
        framing: FRAMINGS.has(value.framing) ? value.framing : 'auto',
        continuity: CONTINUITY.has(value.continuity) ? value.continuity : 'balanced',
        visualDirection: text(value.visualDirection, 1000),
        castOverrides: normalizeDirectorCastOverrides(value.castOverrides, { allowedIdentityIds }),
    };
}
function panelFor(panel) {
    if (!isRecord(panel)) return null;
    return {
        ...clone(panel),
        sourceMessage: text(panel.sourceMessage, 1200),
        focusText: panel.focusText ? text(panel.focusText, 1200) : null,
        focusFingerprint: panel.focusFingerprint ? text(panel.focusFingerprint, 120) : null,
        focusNotice: text(panel.focusNotice || (panel.focusFingerprint && !panel.focusText ? 'Selected text is not restored; generation will use the anchored message.' : ''), 240),
        moment: text(panel.moment, 1200),
        inspection: Array.isArray(panel.inspection) ? panel.inspection.slice(0, 8).map((line) => text(line, 240)) : [],
        referenceSummary: text(panel.referenceSummary || 'Reference readiness unavailable.', 600),
        routeSummary: text(panel.routeSummary || 'Current route readiness unavailable.', 600),
        budgetSummary: text(panel.budgetSummary || 'Budget consequence unavailable until generation.', 600),
        previewError: panel.previewError ? text(panel.previewError, 320) : null,
        visualDirection: text(panel.visualDirection, 1000),
        castCandidates: castCandidates(panel.castCandidates),
        castOverrides: normalizeDirectorCastOverrides(panel.castOverrides, { allowedIdentityIds: castCandidates(panel.castCandidates).map((candidate) => candidate.identityId) }),
    };
}
function safePersistState(state) {
    const panel = state?.panel;
    return {
        schema: DIRECTOR_RUNTIME_SCHEMA,
        options: clone(state?.options || options()),
        revision: Number.isInteger(state?.revision) ? state.revision : 0,
        lastStatus: text(state?.lastStatus || 'idle', 80),
        panel: panel ? {
            messageId: Number(panel.messageId),
            target: clone(panel.target),
            framing: panel.framing,
            continuity: panel.continuity,
            visualDirection: text(panel.visualDirection, 1000),
            castCandidates: castCandidates(panel.castCandidates),
            castOverrides: normalizeDirectorCastOverrides(panel.castOverrides, { allowedIdentityIds: castCandidates(panel.castCandidates).map((candidate) => candidate.identityId) }),
            focusFingerprint: text(panel.focusFingerprint, 120),
            referenceSummary: text(panel.referenceSummary, 240),
            routeSummary: text(panel.routeSummary, 240),
            budgetSummary: text(panel.budgetSummary, 240),
            status: text(panel.status || 'open', 40),
        } : null,
    };
}
function initialState(chatId, persisted = {}) {
    const stored = persisted?.[DIRECTOR_STATE_KEY] || persisted || {};
    return {
        schema: DIRECTOR_RUNTIME_SCHEMA,
        chatId: text(chatId, 240),
        options: options(stored.options),
        panel: panelFor(stored.panel),
        revision: Number.isInteger(stored.revision) && stored.revision >= 0 ? stored.revision : 0,
        lastStatus: text(stored.lastStatus || 'idle', 80),
    };
}

/** Local, chat-scoped Director draft. Preview/edit/close never dispatch provider work. */
export function createDirectorRuntime({
    getChatId = () => null,
    getEpoch = () => 0,
    readState = () => ({}),
    writeState = () => {},
    saveChat = async () => {},
    buildPreview = async ({ sourceMessage }) => ({ moment: sourceMessage }),
    dispatch = async () => { throw new Error('Director generation is unavailable.'); },
    validateTarget = () => ({ safe: true }),
    validateRoute = async () => ({ allowed: true }),
    getBudgetSummary = () => 'Budget consequence unavailable until generation.',
    readDurableState = () => null,
    writeDurableState = () => {},
    saveDurableState = async () => {},
} = {}) {
    let current = null;
    let inFlight = false;
    const chatStates = new Map();
    const active = (chatId) => String(getChatId() ?? '') === String(chatId ?? '');
    const currentEnough = ({ chatId, epoch }) => active(chatId) && Number(getEpoch()) === Number(epoch);
    const remember = (state) => { if (state?.chatId) chatStates.set(String(state.chatId), state); return state; };
    const persist = async (state = current) => {
        if (!state) return;
        remember(state);
        const durable = { [DIRECTOR_STATE_KEY]: safePersistState(state) };
        const isActive = active(state.chatId);
        writeDurableState(durable, { chatId: state.chatId, active: isActive });
        await saveDurableState({ chatId: state.chatId, state: durable });
        if (isActive) {
            writeState(durable, { chatId: state.chatId, active: true });
            await saveChat({ chatId: state.chatId });
        }
    };
    function load({ chatId = getChatId(), epoch = getEpoch() } = {}) {
        const key = String(chatId ?? '');
        const persisted = readState({ chatId: key }) || {};
        const durable = readDurableState({ chatId: key });
        const merged = durable?.[DIRECTOR_STATE_KEY] ? { ...persisted, [DIRECTOR_STATE_KEY]: durable[DIRECTOR_STATE_KEY] } : persisted;
        current = chatStates.get(key) || initialState(key, merged);
        if (current.panel?.target && String(current.panel.target.chatId) === key) {
            const valid = validateTarget({ target: clone(current.panel.target) });
            if (valid?.safe === true) {
                current = { ...current, panel: panelFor({ ...current.panel, target: { ...current.panel.target, epoch: Number(epoch) } }) };
            } else if (valid?.safe === false) {
                current = { ...current, panel: panelFor({ ...current.panel, status: 'stale', previewError: `This message is no longer current (${text(valid.reason || 'replaced', 80)}). Reopen Director to choose it again.` }) };
            }
        }
        remember(current);
        return { status: 'loaded', chatId: key, epoch, panel: clone(current.panel), options: clone(current.options) };
    }
    function getState() { return current ? clone(current) : null; }
    function ensureLoaded() { if (!current) load(); return current; }
    async function open(input = {}) {
        const state = ensureLoaded();
        if (inFlight) return { status: 'busy' };
        if (!currentEnough(input)) return { status: 'stale' };
        const sourceMessage = text(input.message?.mes ?? input.message?.text, 1200);
        if (!sourceMessage) return { status: 'invalid-message', reason: 'This message has no scene text to direct.' };
        const target = {
            chatId: String(input.chatId), messageId: Number(input.messageId),
            messageFingerprint: text(input.messageFingerprint || fingerprint(input.message), 120), epoch: Number(input.epoch),
        };
        const focusText = input.selectionText ? text(input.selectionText, 1200) : null;
        const requestedOptions = options({ ...state.options, ...(input.options || {}) });
        let preview;
        try {
            preview = await buildPreview({ sourceMessage, focusText, target: clone(target), options: requestedOptions });
        } catch (error) {
            preview = { moment: focusText || sourceMessage, inspection: [], referenceSummary: 'Reference readiness could not be checked.', routeSummary: 'Current route readiness could not be checked.', previewError: text(error?.message || 'Preview unavailable.', 320) };
        }
        if (!currentEnough(input)) return { status: 'stale' };
        const candidates = castCandidates(preview?.castCandidates);
        const nextOptions = options(requestedOptions, candidates.map((candidate) => candidate.identityId));
        current = remember({ ...state, options: nextOptions, revision: state.revision + 1, lastStatus: 'open', panel: panelFor({
            messageId: target.messageId, target, sourceMessage, focusText, focusFingerprint: focusText ? hash(focusText) : null,
            focusNotice: '', ...nextOptions,
            ...clone(preview), castCandidates: candidates, budgetSummary: preview?.budgetSummary || getBudgetSummary({ options: nextOptions }),
        }) });
        await persist(current);
        return { status: 'open', panel: clone(current.panel) };
    }
    async function update(values = {}) {
        const state = ensureLoaded();
        if (!state.panel) return { status: 'closed' };
        if (inFlight) return { status: 'busy' };
        if (!currentEnough(state.panel.target || { chatId: state.chatId, epoch: getEpoch() })) return { status: 'stale' };
        const input = { ...state.options, ...values };
        const candidateIds = castCandidates(state.panel.castCandidates).map((candidate) => candidate.identityId);
        const nextOptions = options(input, candidateIds);
        let preview = {};
        try {
            preview = await buildPreview({ sourceMessage: state.panel.sourceMessage, focusText: state.panel.focusText, target: clone(state.panel.target), options: nextOptions });
        } catch (error) {
            preview = { previewError: text(error?.message || 'Preview unavailable.', 320) };
        }
        current = remember({ ...state, options: nextOptions, revision: state.revision + 1, lastStatus: 'edited', panel: panelFor({ ...state.panel, ...nextOptions, ...clone(preview), castCandidates: preview?.castCandidates || state.panel.castCandidates, budgetSummary: preview?.budgetSummary || getBudgetSummary({ options: nextOptions }) }) });
        await persist(current);
        return { status: 'updated', panel: clone(current.panel) };
    }
    async function close() {
        if (!current) return { status: 'closed' };
        current = remember({ ...current, panel: null, lastStatus: 'closed' });
        await persist(current);
        return { status: 'closed' };
    }
    async function generate() {
        const state = ensureLoaded();
        const panel = state.panel;
        if (!panel) return { status: 'closed' };
        if (inFlight) return { status: 'busy' };
        const target = panel.target;
        if (!target || !currentEnough(target)) return { status: 'stale' };
        const valid = await validateTarget({ target: clone(target), sourceMessage: panel.sourceMessage });
        if (!valid?.safe) return { status: 'stale', reason: valid?.reason };
        if (inFlight) return { status: 'busy' };
        inFlight = true;
        const route = await validateRoute({ target: clone(target), panel: clone(panel), revision: state.revision });
        if (route?.allowed !== true) { inFlight = false; return { status: route?.status || 'route-invalid', reason: route?.reason }; }
        const revision = state.revision;
        const chatKey = String(state.chatId);
        if (chatStates.get(chatKey)?.revision !== revision || !currentEnough(target)) { inFlight = false; return { status: 'stale', reason: 'draft-changed' }; }
        try {
            const result = await dispatch({
                sourceMessage: panel.sourceMessage, focusText: panel.focusText || null,
                target: clone(target), framing: panel.framing, continuity: panel.continuity,
                visualDirection: panel.visualDirection,
                castOverrides: normalizeDirectorCastOverrides(state.options.castOverrides, { allowedIdentityIds: castCandidates(panel.castCandidates).map((candidate) => candidate.identityId) }),
                revision, panel: clone(panel),
            });
            const settled = remember({ ...state, lastStatus: result?.status === 'completed' ? 'generated' : 'failed', panel: panelFor({ ...panel, status: result?.status || 'failed', previewError: result?.status === 'completed' ? null : text(result?.reason || 'Generation did not complete.', 320) }) });
            if (active(chatKey)) current = settled;
            await persist(settled);
            return { ...result, panel: clone(settled.panel) };
        } catch (error) {
            const settled = remember({ ...state, lastStatus: 'failed', panel: panelFor({ ...panel, status: 'failed', previewError: text(error?.message || 'Generation failed. Draft retained.', 320) }) });
            if (active(chatKey)) current = settled;
            await persist(settled);
            return { status: 'failed', error, panel: clone(settled.panel) };
        } finally { inFlight = false; }
    }
    return { load, getState, open, update, close, generate, destroy() { current = null; chatStates.clear(); inFlight = false; } };
}

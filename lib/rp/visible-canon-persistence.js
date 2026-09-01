export function visibleCanonPendingKey({ chatId, artifactId } = {}) {
    return `${String(chatId || '')}::${String(artifactId || '')}`;
}

function normalizePending(value) {
    const normalized = {};
    for (const entry of Object.values(value || {})) {
        if (!entry?.artifactId || !entry?.chatId) continue;
        normalized[visibleCanonPendingKey(entry)] = { ...entry, artifactId: String(entry.artifactId) };
    }
    return normalized;
}

export function createVisibleCanonPendingState(value = {}) {
    return { schema: 1, pending: normalizePending(value.pending) };
}

export function queueVisibleCanonPending(stateValue, link) {
    if (!link?.artifactId || !link.chatId || link.messageId === undefined || !link.mediaUrl || !link.identityId || !link.lookId || !link.expectedFingerprint || !link.candidate?.revision) return createVisibleCanonPendingState(stateValue);
    const state = createVisibleCanonPendingState(stateValue);
    return { ...state, pending: { ...state.pending, [visibleCanonPendingKey(link)]: { ...link, artifactId: String(link.artifactId) } } };
}

export function applyVisibleCanonPendingResult(stateValue, linkOrKey, result) {
    const state = createVisibleCanonPendingState(stateValue);
    if (result?.status !== 'confirmed') return state;
    const pending = { ...state.pending };
    const key = typeof linkOrKey === 'string' ? linkOrKey : visibleCanonPendingKey(linkOrKey);
    delete pending[key];
    return { ...state, pending };
}

export function splitVisibleCanonPendingByChat(stateValue, chatId) {
    const state = createVisibleCanonPendingState(stateValue);
    const active = {};
    const foreign = {};
    for (const [key, link] of Object.entries(state.pending)) {
        (String(link.chatId) === String(chatId) ? active : foreign)[key] = link;
    }
    return { active, foreign };
}

export function finalizeVisibleCanonPendingReplay({ currentCanon, replayedCanon, activePending } = {}) {
    const candidate = replayedCanon || currentCanon || {};
    return { ...candidate, visibleCanonPending: createVisibleCanonPendingState({ pending: activePending }).pending };
}

export async function resumeVisibleCanonPending(stateValue, reconcile, { isCurrent = () => true } = {}) {
    let state = createVisibleCanonPendingState(stateValue);
    let status = 'confirmed';
    for (const link of Object.values(state.pending)) {
        if (!isCurrent(link)) {
            status = 'stale';
            continue;
        }
        let result;
        try { result = await reconcile(link); }
        catch (error) { result = { status: 'indeterminate', error }; }
        state = applyVisibleCanonPendingResult(state, link, result);
        if (result?.status !== 'confirmed') status = result?.status || 'indeterminate';
    }
    return { status, state };
}

export async function reconcileVisibleCanonPendingLink(link, { save, verify, isCurrent = () => true } = {}) {
    if (typeof save !== 'function' || typeof verify !== 'function') throw new TypeError('Pending link save and verification functions are required.');
    if (!isCurrent(link)) return { status: 'stale' };
    try { await save(link); }
    catch (error) { return { status: 'indeterminate', error }; }
    if (!isCurrent(link)) return { status: 'stale' };
    try { return await verify(link); }
    catch (error) { return { status: 'indeterminate', error }; }
}

function clonePending(value) {
    return { ...(value || {}) };
}

export function createVisibleCanonPendingState(value = {}) {
    return { schema: 1, pending: clonePending(value.pending) };
}

export function queueVisibleCanonPending(stateValue, link) {
    if (!link?.artifactId || !link.chatId || link.messageId === undefined || !link.mediaUrl || !link.identityId || !link.lookId) return createVisibleCanonPendingState(stateValue);
    const state = createVisibleCanonPendingState(stateValue);
    return { ...state, pending: { ...state.pending, [String(link.artifactId)]: { ...link, artifactId: String(link.artifactId) } } };
}

export function applyVisibleCanonPendingResult(stateValue, artifactId, result) {
    const state = createVisibleCanonPendingState(stateValue);
    if (result?.status !== 'confirmed') return state;
    const pending = { ...state.pending };
    delete pending[String(artifactId)];
    return { ...state, pending };
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
        state = applyVisibleCanonPendingResult(state, link.artifactId, result);
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

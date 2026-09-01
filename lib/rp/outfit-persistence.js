function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

export function outfitPendingKey({ chatId, identityId } = {}) {
    return `${String(chatId || '')}::${String(identityId || '')}`;
}

export function createOutfitPendingState(value = {}) {
    const pending = {};
    for (const entry of Object.values(value.pending || {})) {
        if (!entry?.chatId || !entry?.identityId || !entry?.revision || !entry?.state) continue;
        pending[outfitPendingKey(entry)] = clone(entry);
    }
    return { schema: 1, pending };
}

export function queueOutfitPending(stateValue, entry) {
    if (!entry?.chatId || !entry?.identityId || !entry?.revision || !entry?.state) return createOutfitPendingState(stateValue);
    const state = createOutfitPendingState(stateValue);
    return { ...state, pending: { ...state.pending, [outfitPendingKey(entry)]: clone(entry) } };
}

export function removeOutfitPending(stateValue, entryOrKey) {
    const state = createOutfitPendingState(stateValue);
    const key = typeof entryOrKey === 'string' ? entryOrKey : outfitPendingKey(entryOrKey);
    const pending = { ...state.pending };
    delete pending[key];
    return { ...state, pending };
}

export function splitOutfitPendingByChat(stateValue, chatId) {
    const state = createOutfitPendingState(stateValue);
    const active = {};
    const foreign = {};
    for (const [key, entry] of Object.entries(state.pending)) {
        (String(entry.chatId) === String(chatId) ? active : foreign)[key] = entry;
    }
    return { active, foreign };
}

export async function persistTargetedOutfitMutation({ captured, isCurrent = () => true, getState, setState, nextState, save, verify } = {}) {
    if (typeof save !== 'function' || typeof verify !== 'function') throw new TypeError('Targeted outfit save and verification functions are required.');
    if (!isCurrent(captured)) return { status: 'stale' };
    const previous = typeof getState === 'function' ? getState() : undefined;
    if (typeof setState === 'function') setState(nextState);
    let saved;
    try { saved = await save(captured); }
    catch (error) { return { status: 'indeterminate', error }; }
    if (saved?.saved === false) return { status: 'stale', reason: saved.reason || 'target-changed' };
    if (!isCurrent(captured)) return { status: 'stale' };
    let result;
    try { result = await verify(captured, nextState); }
    catch (error) { result = { status: 'indeterminate', error }; }
    if (result?.status === 'confirmed') return { status: 'confirmed', verification: result };
    if (result?.status === 'indeterminate') return { status: 'indeterminate', verification: result };
    if (typeof setState === 'function') setState(previous);
    return { status: result?.status || 'confirmed-absent', verification: result };
}

export async function resumeOutfitPending(stateValue, reconcile, { chatId, isCurrent = () => true } = {}) {
    if (typeof reconcile !== 'function') throw new TypeError('An outfit pending reconcile function is required.');
    let state = createOutfitPendingState(stateValue);
    let status = 'confirmed';
    for (const entry of Object.values(state.pending)) {
        if (chatId !== undefined && String(entry.chatId) !== String(chatId)) continue;
        if (!isCurrent(entry)) { status = 'stale'; continue; }
        let result;
        try { result = await reconcile(entry); }
        catch (error) { result = { status: 'indeterminate', error }; }
        if (result?.status === 'confirmed') state = removeOutfitPending(state, entry);
        else { status = result?.status || 'indeterminate'; }
    }
    return { status, state };
}

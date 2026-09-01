let mutationTail = Promise.resolve();

export function enqueueLibraryMutation(operation) {
    if (typeof operation !== 'function') return Promise.reject(new TypeError('A mutation operation is required.'));
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => undefined);
    return result;
}

async function readJson(fetchImpl, url, getHeaders, body) {
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', headers: getHeaders?.() || {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response?.ok) throw new Error(`Read-back failed (${response?.status || 'network'}).`);
    return response.json();
}

export async function verifyPersistedExtensionLibrary({ expectedRevision, fetchImpl = fetch, getHeaders } = {}) {
    const read = await readPersistedExtensionLibrary({ fetchImpl, getHeaders });
    if (read.status !== 'confirmed') return read;
    return { status: read.library?.revision === expectedRevision ? 'confirmed' : 'confirmed-absent', library: read.library };
}

export async function readPersistedExtensionLibrary({ fetchImpl = fetch, getHeaders } = {}) {
    try {
        const payload = await readJson(fetchImpl, '/api/settings/get', getHeaders, {});
        let settingsPayload = payload;
        if (typeof payload?.settings === 'string') settingsPayload = JSON.parse(payload.settings);
        const library = settingsPayload?.extension_settings?.['context-image-generation']?.rp_library;
        return library ? { status: 'confirmed', library } : { status: 'confirmed-absent', library: null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function verifyPersistedChatBinding({ target, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const endpoint = target?.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const payload = await readJson(fetchImpl, endpoint, getHeaders, target?.requestBody || { chat_id: target?.chatId });
        const header = Array.isArray(payload) ? payload[0] : payload;
        const canon = header?.chat_metadata?.contextImageGeneration ?? header?.metadata?.contextImageGeneration;
        const binding = canon?.bindings?.[target?.identityId];
        const bindingMatches = target?.activeLookId == null ? binding === undefined : binding?.activeLookId === target?.activeLookId;
        const matches = canon?.revision === target?.expectedRevision && bindingMatches;
        return { status: matches ? 'confirmed' : 'confirmed-absent', canon, binding };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function persistVerifiedChatMutation({ captured, isCurrent, getState, setState, nextState, getRevision = (value) => value?.revision, saveMetadata, verify, scheduleReconcile } = {}) {
    const previous = getState();
    const candidateRevision = getRevision(nextState);
    const restoreConditionally = () => {
        if (isCurrent(captured) && getRevision(getState()) === candidateRevision) setState(previous);
    };
    if (!isCurrent(captured)) return { status: 'stale' };
    setState(nextState);
    try {
        await saveMetadata();
    } catch (error) {
        restoreConditionally();
        scheduleReconcile?.();
        return { status: 'indeterminate', verification: { status: 'indeterminate', error } };
    }
    if (!isCurrent(captured)) {
        return { status: 'stale' };
    }
    let result;
    try { result = await verify(); } catch (error) { result = { status: 'indeterminate', error }; }
    if (!isCurrent(captured)) {
        return { status: 'stale' };
    }
    if (result.status === 'confirmed') return { status: 'confirmed', verification: result };
    restoreConditionally();
    if (result.status === 'indeterminate') scheduleReconcile?.();
    return { status: result.status, verification: result };
}

export async function reconcilePendingOperation(operationId, reconcile) {
    if (!operationId || typeof reconcile !== 'function') return { status: 'indeterminate' };
    return enqueueLibraryMutation(() => reconcile(operationId));
}

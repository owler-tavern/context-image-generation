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
    try {
        const payload = await readJson(fetchImpl, '/api/settings/get', getHeaders, {});
        let settingsPayload = payload;
        if (typeof payload?.settings === 'string') settingsPayload = JSON.parse(payload.settings);
        const library = settingsPayload?.extension_settings?.['context-image-generation']?.rp_library;
        return { status: library?.revision === expectedRevision ? 'confirmed' : 'confirmed-absent', library };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function verifyPersistedChatBinding({ target, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const endpoint = target?.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const payload = await readJson(fetchImpl, endpoint, getHeaders, target?.requestBody || { chat_id: target?.chatId });
        const canon = payload?.chat_metadata?.contextImageGeneration ?? payload?.metadata?.contextImageGeneration;
        const binding = canon?.bindings?.[target?.identityId];
        const matches = canon?.revision === target?.expectedRevision && binding?.activeLookId === target?.activeLookId;
        return { status: matches ? 'confirmed' : 'confirmed-absent', canon, binding };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function reconcilePendingOperation(operationId, reconcile) {
    if (!operationId || typeof reconcile !== 'function') return { status: 'indeterminate' };
    return enqueueLibraryMutation(() => reconcile(operationId));
}

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
    const read = await readPersistedExtensionState({ fetchImpl, getHeaders });
    if (read.status !== 'confirmed') return read;
    const library = read.settings?.rp_library;
    return library ? { status: 'confirmed', library } : { status: 'confirmed-absent', library: null };
}

export async function readPersistedExtensionState({ fetchImpl = fetch, getHeaders } = {}) {
    try {
        const payload = await readJson(fetchImpl, '/api/settings/get', getHeaders, {});
        let settingsPayload = payload;
        if (typeof payload?.settings === 'string') settingsPayload = JSON.parse(payload.settings);
        const settings = settingsPayload?.extension_settings?.['context-image-generation'];
        return settings ? { status: 'confirmed', settings } : { status: 'confirmed-absent', settings: null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function verifyPersistedGalleryClear({ expectedRevision, fetchImpl = fetch, getHeaders } = {}) {
    const read = await readPersistedExtensionState({ fetchImpl, getHeaders });
    if (read.status !== 'confirmed') return read;
    const matches = read.settings?.rp_library?.revision === expectedRevision && Array.isArray(read.settings?.gallery) && read.settings.gallery.length === 0;
    return { status: matches ? 'confirmed' : 'confirmed-absent', settings: read.settings };
}

function persistedGalleryArtifactId(item) {
    if (!item || typeof item !== 'object') return null;
    const explicitId = item.id || item.assetId || item.sourceMetadata?.artifactId;
    if (explicitId) return String(explicitId);
    return item.url ? `url:${String(item.url)}` : null;
}

export async function verifyPersistedGalleryArtifact({ artifactId, expectedIdentityId, expectedLookId, fetchImpl = fetch, getHeaders } = {}) {
    const read = await readPersistedExtensionState({ fetchImpl, getHeaders });
    if (read.status !== 'confirmed') return read;
    const targetId = String(artifactId || '');
    const item = (Array.isArray(read.settings?.gallery) ? read.settings.gallery : [])
        .find((entry) => persistedGalleryArtifactId(entry) === targetId);
    const matches = item?.cig_identity_id === expectedIdentityId && item?.cig_look_id === expectedLookId;
    return { status: matches ? 'confirmed' : 'confirmed-absent', item: item || null };
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

function persistedChatEntries(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.chat)) return payload.chat;
    if (Array.isArray(payload?.messages)) return payload.messages;
    return [];
}

export async function verifyPersistedChatMediaLink({ target, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const endpoint = target?.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const payload = await readJson(fetchImpl, endpoint, getHeaders, target?.requestBody || { chat_id: target?.chatId });
        const entries = persistedChatEntries(payload);
        const message = entries[Number(target?.messageId) + 1];
        const media = message?.extra?.media?.find((entry) => (
            entry?.cig_visible_canon?.artifactId === target?.artifactId
            && entry?.url === target?.mediaUrl
        ));
        const link = media?.cig_visible_canon;
        const matches = link?.identityId === target?.identityId && link?.lookId === target?.lookId;
        return { status: matches ? 'confirmed' : 'confirmed-absent', media: media || null, link: link || null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function verifyPersistedVisibleCanonPending({ pending, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const read = await readPersistedExtensionState({ fetchImpl, getHeaders });
        if (read.status !== 'confirmed') return read;
        const stored = read.settings?.visible_canon_pending?.[pending?.artifactId];
        const matches = stored?.chatId === pending?.chatId
            && String(stored?.messageId) === String(pending?.messageId)
            && stored?.mediaUrl === pending?.mediaUrl
            && stored?.identityId === pending?.identityId
            && stored?.lookId === pending?.lookId
            && stored?.expectedFingerprint === pending?.expectedFingerprint
            && stored?.candidate?.revision === pending?.candidate?.revision;
        return { status: matches ? 'confirmed' : 'confirmed-absent', pending: stored || null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function persistVerifiedChatMutation({ captured, isCurrent, getState, setState, nextState, getRevision = (value) => value?.revision, saveMetadata, verify, scheduleReconcile, preservePendingState = false } = {}) {
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
        if (!preservePendingState) restoreConditionally();
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
    if (!preservePendingState) restoreConditionally();
    if (result.status === 'indeterminate') scheduleReconcile?.();
    return { status: result.status, verification: result };
}

export async function reconcilePendingOperation(operationId, reconcile) {
    if (!operationId || typeof reconcile !== 'function') return { status: 'indeterminate' };
    return enqueueLibraryMutation(() => reconcile(operationId));
}

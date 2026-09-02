import { visibleCanonPendingKey } from './visible-canon-persistence.js';
import { CHAT_CANON_KEY } from './chat-canon.js';

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

/** Writes one chat-canon candidate through the production host save boundary. */
export async function persistChatCanonMetadata({ metadata, candidate, groupId = null, chatName, chatData = [], saveOneToOne, saveGroup } = {}) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Chat metadata is required.');
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('A chat canon candidate is required.');
    metadata[CHAT_CANON_KEY] = candidate;
    if (groupId) {
        if (typeof saveGroup !== 'function') throw new TypeError('A group chat save callback is required.');
        await saveGroup(groupId, true);
    } else {
        if (typeof saveOneToOne !== 'function') throw new TypeError('A one-to-one chat save callback is required.');
        await saveOneToOne({ chatName, withMetadata: metadata, chatData });
    }
    return metadata;
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

/** Read back an iteration artifact from the persisted chat media, by immutable ID. */
export async function verifyPersistedIterationArtifact({ target, artifactId, planId, invocationId, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const endpoint = target?.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const payload = await readJson(fetchImpl, endpoint, getHeaders, target?.requestBody || { chat_id: target?.chatId });
        const entries = persistedChatEntries(payload);
        const message = entries.find((entry) => String(entry?.mesid ?? entry?.messageId ?? '') === String(target?.messageId)) || entries[Number(target?.messageId) + 1];
        const media = message?.extra?.media?.find((entry) => entry?.cig_iteration_artifact?.artifactId === String(artifactId));
        const receipt = media?.cig_iteration_persistence;
        const matches = Boolean(media)
            && (!planId || receipt?.planId === planId)
            && (!invocationId || receipt?.invocationId === invocationId);
        return { status: matches ? 'confirmed' : 'confirmed-absent', artifactId: String(artifactId || ''), planId, invocationId, media: media || null };
    } catch (error) { return { status: 'indeterminate', error }; }
}

export async function verifyPersistedVisibleCanonPending({ pending, fetchImpl = fetch, getHeaders } = {}) {
    try {
        const read = await readPersistedExtensionState({ fetchImpl, getHeaders });
        if (read.status !== 'confirmed') return read;
        const stored = read.settings?.visible_canon_pending?.[visibleCanonPendingKey(pending)];
        const stable = (value) => {
            if (Array.isArray(value)) return value.map(stable);
            if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
            return value;
        };
        const exact = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
        const matches = exact(stored, pending)
            && exact(stored?.candidate, pending?.candidate)
            && stored?.candidate?.schema === pending?.candidate?.schema
            && stored?.candidate?.revision === pending?.candidate?.revision
            && stored?.expectedFingerprint === pending?.expectedFingerprint;
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

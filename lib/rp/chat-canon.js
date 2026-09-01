export const CHAT_CANON_KEY = 'contextImageGeneration';
const MAX_UNKNOWN_JSON_BYTES = 8192;

function isRecord(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function safeClone(value) {
    try {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || encoded.length > MAX_UNKNOWN_JSON_BYTES) return undefined;
        return JSON.parse(encoded);
    } catch { return undefined; }
}
function requiredId(value, label) {
    const id = String(value || '').trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}
function normalizeBinding(value) {
    if (!isRecord(value)) return null;
    const activeLookId = String(value.activeLookId || '').trim();
    const expectedAssetId = String(value.expectedAssetId || '').trim();
    if (!activeLookId || !expectedAssetId) return null;
    return { activeLookId, expectedAssetId, isLocked: value.isLocked === true, selectedAt: Number.isFinite(value.selectedAt) ? value.selectedAt : Date.now() };
}

export function migrateChatCanon(value) {
    const source = isRecord(value) ? value : {};
    if (Number(source.schema || 1) > 1) return { status: 'unsupported-schema', raw: safeClone(source) };
    const state = { schema: 1, bindings: {} };
    for (const [key, item] of Object.entries(isRecord(source.bindings) ? source.bindings : {})) {
        const binding = normalizeBinding(item);
        if (key.trim() && binding) state.bindings[key] = binding;
    }
    let unknownBytes = 0;
    for (const [key, item] of Object.entries(source)) {
        if (key === 'schema' || key === 'bindings') continue;
        const cloned = safeClone(item);
        const bytes = cloned === undefined ? Infinity : JSON.stringify(cloned).length;
        if (cloned !== undefined && unknownBytes + bytes <= MAX_UNKNOWN_JSON_BYTES) {
            state[key] = cloned;
            unknownBytes += bytes;
        }
    }
    return state;
}

export function chatCanonRevisionFingerprint(stateValue, identityId) {
    const state = migrateChatCanon(stateValue);
    const source = JSON.stringify([state.status || 'supported', state.revision || null, state.bindings?.[String(identityId)] || null]);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return `canon-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getChatBinding(stateValue, identityId) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') return null;
    return state.bindings[requiredId(identityId, 'Identity ID')] || null;
}

export function setChatBinding(stateValue, identityId, bindingValue) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const binding = normalizeBinding(bindingValue);
    if (!binding) throw new TypeError('A look ID and expected asset ID are required.');
    return { ...state, bindings: { ...state.bindings, [requiredId(identityId, 'Identity ID')]: binding } };
}

export function setChatLock(stateValue, identityId, isLocked) {
    const id = requiredId(identityId, 'Identity ID');
    const current = getChatBinding(stateValue, id);
    if (!current) throw new TypeError('Select a look before changing its lock.');
    return setChatBinding(stateValue, id, { ...current, isLocked: isLocked === true });
}

export function selectLookForChat(stateValue, identityId, { activeLookId, expectedAssetId, selectedAt = Date.now(), confirmed = false, expectedLookId } = {}) {
    const current = getChatBinding(stateValue, identityId);
    if (current?.isLocked && current.activeLookId !== activeLookId && !confirmed) return { status: 'confirmation-required', state: stateValue };
    if (expectedLookId !== undefined && current?.activeLookId !== expectedLookId) return { status: 'stale', state: stateValue };
    return { status: 'selected', state: setChatBinding(stateValue, identityId, { activeLookId, expectedAssetId, selectedAt, isLocked: current?.isLocked === true }) };
}

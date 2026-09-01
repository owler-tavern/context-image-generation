import { normalizeStableIdentityId } from './identities.js';

export const CHAT_CANON_KEY = 'contextImageGeneration';
const MAX_UNKNOWN_JSON_BYTES = 8192;
const MAX_APPEARANCE_SOURCES = 24;
const APPEARANCE_SOURCE_TYPES = new Set(['auto', 'avatar', 'description']);
const FRAMINGS = new Set(['auto', 'close-up', 'medium', 'wide', 'full-body']);
const CONTINUITY = new Set(['minimal', 'balanced', 'strong']);

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

function normalizeAppearanceSource(value, fallbackIdentityId = '') {
    if (!isRecord(value)) return null;
    const identityId = normalizeStableIdentityId(value.identityId || fallbackIdentityId);
    const sourceType = String(value.sourceType || '').trim().toLocaleLowerCase('und');
    const sourceId = normalizeStableIdentityId(value.sourceId || identityId);
    if (!identityId || !sourceId || !APPEARANCE_SOURCE_TYPES.has(sourceType)) return null;
    const role = String(value.role || '').trim().toLocaleLowerCase('und');
    return {
        identityId,
        sourceType,
        sourceId,
        ...(role ? { role: role.slice(0, 24) } : {}),
        selectedAt: Number.isFinite(value.selectedAt) ? value.selectedAt : Date.now(),
    };
}

function normalizeWandPreferences(value) {
    if (!isRecord(value)) return null;
    const framing = FRAMINGS.has(value.framing) ? value.framing : 'auto';
    const continuity = CONTINUITY.has(value.continuity) ? value.continuity : 'balanced';
    const visualDirection = String(value.visualDirection || '').replace(/\s+/gu, ' ').trim().slice(0, 1000);
    return { framing, continuity, visualDirection };
}

export function migrateChatCanon(value) {
    const source = isRecord(value) ? value : {};
    if (Number(source.schema || 1) > 1) return { status: 'unsupported-schema', raw: safeClone(source) };
    const state = { schema: 1, bindings: {} };
    for (const [key, item] of Object.entries(isRecord(source.bindings) ? source.bindings : {})) {
        const binding = normalizeBinding(item);
        if (key.trim() && binding) state.bindings[key] = binding;
    }
    const appearanceSources = {};
    for (const [key, item] of Object.entries(isRecord(source.appearanceSources) ? source.appearanceSources : {})) {
        const sourceBinding = normalizeAppearanceSource(item, key);
        if (sourceBinding && Object.keys(appearanceSources).length < MAX_APPEARANCE_SOURCES) appearanceSources[sourceBinding.identityId] = sourceBinding;
    }
    if (Object.keys(appearanceSources).length) state.appearanceSources = appearanceSources;
    const wandPreferences = normalizeWandPreferences(source.wandPreferences);
    if (wandPreferences) state.wandPreferences = wandPreferences;
    let unknownBytes = 0;
    for (const [key, item] of Object.entries(source)) {
        if (key === 'schema' || key === 'bindings' || key === 'appearanceSources' || key === 'wandPreferences') continue;
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

export function getChatAppearanceSource(stateValue, identityId, role = '') {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') return null;
    const id = normalizeStableIdentityId(identityId);
    if (!id) return null;
    const exact = state.appearanceSources?.[id];
    const normalizedRole = String(role || '').trim().toLocaleLowerCase('und');
    if (exact && (!normalizedRole || exact.role === normalizedRole)) return exact;
    if (!normalizedRole || normalizedRole !== 'persona') return exact || null;
    return Object.values(state.appearanceSources || {}).find((entry) => entry.role === normalizedRole) || null;
}

export function setChatAppearanceSource(stateValue, identityId, sourceValue = {}) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const id = requiredId(identityId, 'Identity ID');
    const source = normalizeAppearanceSource({ ...sourceValue, identityId: sourceValue.identityId || id }, id);
    if (!source) throw new TypeError('A stable identity ID, source ID, and valid appearance source are required.');
    const appearanceSources = { ...(state.appearanceSources || {}), [source.identityId]: source };
    const keys = Object.keys(appearanceSources);
    for (const staleKey of keys.slice(0, Math.max(0, keys.length - MAX_APPEARANCE_SOURCES))) delete appearanceSources[staleKey];
    return { ...state, appearanceSources };
}

export function clearChatAppearanceSource(stateValue, identityId) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const id = requiredId(identityId, 'Identity ID');
    const appearanceSources = { ...(state.appearanceSources || {}) };
    delete appearanceSources[id];
    return { ...state, appearanceSources };
}

export function getChatWandPreferences(stateValue) {
    return migrateChatCanon(stateValue).wandPreferences || null;
}

export function setChatWandPreferences(stateValue, values = {}) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const next = normalizeWandPreferences({ ...(state.wandPreferences || {}), ...values });
    return { ...state, wandPreferences: next };
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

export function clearChatBinding(stateValue, identityId) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const id = requiredId(identityId, 'Identity ID');
    const bindings = { ...state.bindings };
    delete bindings[id];
    return { ...state, bindings };
}

export function selectLookForChat(stateValue, identityId, { activeLookId, expectedAssetId, selectedAt = Date.now(), confirmed = false, expectedLookId } = {}) {
    const current = getChatBinding(stateValue, identityId);
    if (current?.isLocked && current.activeLookId !== activeLookId && !confirmed) return { status: 'confirmation-required', state: stateValue };
    if (expectedLookId !== undefined && current?.activeLookId !== expectedLookId) return { status: 'stale', state: stateValue };
    return { status: 'selected', state: setChatBinding(stateValue, identityId, { activeLookId, expectedAssetId, selectedAt, isLocked: current?.isLocked === true }) };
}

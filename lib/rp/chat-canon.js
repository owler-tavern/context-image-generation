import { normalizeStableIdentityId } from './identities.js';

export const CHAT_CANON_KEY = 'contextImageGeneration';
const MAX_UNKNOWN_JSON_BYTES = 8192;
const MAX_APPEARANCE_SOURCES = 24;
const MAX_IDENTITY_PINS = 24;
const APPEARANCE_SOURCE_TYPES = new Set(['auto', 'avatar', 'description']);
const FRAMINGS = new Set(['auto', 'close-up', 'medium', 'wide', 'full-body']);
const CONTINUITY = new Set(['minimal', 'balanced', 'strong']);
const CAST_ACTIONS = new Set(['auto', 'include', 'focus', 'exclude']);
const MAX_CAST_OVERRIDES = 24;

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

function normalizeIdentityPin(value, fallbackIdentityId = '') {
    if (!isRecord(value)) return null;
    const identityId = normalizeStableIdentityId(value.identityId || fallbackIdentityId);
    const sourceId = normalizeStableIdentityId(value.sourceId || identityId);
    const role = String(value.role || '').trim().toLocaleLowerCase('und');
    if (!identityId || !sourceId) return null;
    return { identityId, sourceId, ...(role ? { role: role.slice(0, 24) } : {}) };
}

function normalizeWandPreferences(value) {
    if (!isRecord(value)) return null;
    const framing = FRAMINGS.has(value.framing) ? value.framing : 'auto';
    const continuity = CONTINUITY.has(value.continuity) ? value.continuity : 'balanced';
    const visualDirection = String(value.visualDirection || '').replace(/\s+/gu, ' ').trim().slice(0, 1000);
    const staged = isRecord(value.stagedSuggestion) ? {
        suggestionId: String(value.stagedSuggestion.suggestionId || '').trim().slice(0, 160),
        shot: String(value.stagedSuggestion.shot || '').replace(/\s+/gu, ' ').trim().slice(0, 400),
        kind: String(value.stagedSuggestion.kind || '').trim().slice(0, 40),
    } : null;
    const castOverrides = normalizeCastOverrides(value.castOverrides);
    return { framing, continuity, visualDirection, ...(castOverrides.length ? { castOverrides } : {}), ...(staged?.suggestionId && staged.shot ? { stagedSuggestion: staged } : {}) };
}

function normalizeCastOverrides(value) {
    const byId = new Map();
    for (const entry of Array.isArray(value) ? value : []) {
        const identityId = normalizeStableIdentityId(entry?.identityId || entry?.id);
        const action = String(entry?.action || '').trim().toLocaleLowerCase('und');
        if (!identityId || !CAST_ACTIONS.has(action)) continue;
        if (action === 'auto') {
            byId.delete(identityId);
            continue;
        }
        for (const [id, current] of byId) if (current.action === 'focus' && action === 'focus') byId.set(id, { ...current, action: 'include' });
        byId.set(identityId, { identityId, action });
    }
    return [...byId.values()].slice(0, MAX_CAST_OVERRIDES);
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
    const identityPins = {};
    for (const [key, item] of Object.entries(isRecord(source.identityPins) ? source.identityPins : {})) {
        const pin = normalizeIdentityPin(item, key);
        if (pin && Object.keys(identityPins).length < MAX_IDENTITY_PINS) identityPins[pin.identityId] = pin;
    }
    if (Object.keys(identityPins).length) state.identityPins = identityPins;
    const wandPreferences = normalizeWandPreferences(source.wandPreferences);
    if (wandPreferences) state.wandPreferences = wandPreferences;
    let unknownBytes = 0;
    for (const [key, item] of Object.entries(source)) {
        if (key === 'schema' || key === 'bindings' || key === 'appearanceSources' || key === 'identityPins' || key === 'wandPreferences') continue;
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
    return exact || null;
}

export function getChatIdentityPin(stateValue, identityId, role = '') {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') return null;
    const id = normalizeStableIdentityId(identityId);
    const pin = id ? state.identityPins?.[id] : null;
    const normalizedRole = String(role || '').trim().toLocaleLowerCase('und');
    return pin && (!normalizedRole || pin.role === normalizedRole) ? pin : null;
}

export function setChatIdentityPin(stateValue, identityId, pinValue = {}) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const id = requiredId(identityId, 'Identity ID');
    const pin = normalizeIdentityPin({ ...pinValue, identityId: pinValue.identityId || id }, id);
    if (!pin) throw new TypeError('A stable identity and source ID are required.');
    const identityPins = { ...(state.identityPins || {}), [pin.identityId]: pin };
    const keys = Object.keys(identityPins);
    for (const staleKey of keys.slice(0, Math.max(0, keys.length - MAX_IDENTITY_PINS))) delete identityPins[staleKey];
    return { ...state, identityPins };
}

export function clearChatIdentityPin(stateValue, identityId) {
    const state = migrateChatCanon(stateValue);
    if (state.status === 'unsupported-schema') throw new TypeError('This chat canon was created by a newer extension version.');
    const id = requiredId(identityId, 'Identity ID');
    const identityPins = { ...(state.identityPins || {}) };
    delete identityPins[id];
    return { ...state, identityPins };
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

export function getChatCastOverrides(stateValue) {
    return normalizeCastOverrides(getChatWandPreferences(stateValue)?.castOverrides);
}

export function setChatCastOverride(stateValue, identityId, action) {
    const id = normalizeStableIdentityId(identityId);
    const normalizedAction = String(action || '').trim().toLocaleLowerCase('und');
    if (!id || !CAST_ACTIONS.has(normalizedAction)) throw new TypeError('A stable identity and valid cast correction are required.');
    let current = getChatCastOverrides(stateValue);
    if (normalizedAction === 'focus') current = current.map((entry) => entry.action === 'focus' ? { ...entry, action: 'include' } : entry);
    const existingIndex = current.findIndex((entry) => entry.identityId === id);
    if (normalizedAction === 'auto') current = current.filter((entry) => entry.identityId !== id);
    else if (existingIndex >= 0) current[existingIndex] = { identityId: id, action: normalizedAction };
    else current.push({ identityId: id, action: normalizedAction });
    return setChatWandPreferences(stateValue, { castOverrides: normalizeCastOverrides(current) });
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

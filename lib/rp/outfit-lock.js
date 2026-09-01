import { isStableIdentityId } from './identities.js';

const OUTFIT_SCHEMA = 1;

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function stableIdentityId(value) {
    const id = String(value ?? '').trim();
    return isStableIdentityId(id) ? id : null;
}

function outfitId(value) {
    const id = String(value ?? '').trim();
    return id || null;
}

export function normalizeOutfit(value, fallbackId) {
    if (!isRecord(value)) return null;
    const id = outfitId(value.id || fallbackId);
    const identityId = stableIdentityId(value.identityId);
    const name = String(value.name ?? value.label ?? '').trim();
    const items = Array.isArray(value.items) ? value.items.map(clone).filter((item) => (typeof item === 'string' ? item.trim() : isRecord(item))) : [];
    const description = String(value.description ?? '').trim() || null;
    if (!id || !identityId || !name || (!items.length && !description) || value.complete === false) return null;
    return { id, identityId, name, items, description };
}

export function createOutfit({ id, identityId, name, items = [], description = null, complete = true } = {}) {
    const outfit = normalizeOutfit({ id, identityId, name, items, description, complete }, id);
    return outfit ? { status: 'created', outfit } : { status: 'invalid', reason: 'named-complete-outfit-required' };
}

export function migrateOutfitCatalog(value) {
    const source = isRecord(value) ? value : {};
    const entries = Array.isArray(source.outfits) ? source.outfits : isRecord(source.outfits) ? Object.values(source.outfits) : [];
    const outfits = [];
    const seen = new Set();
    for (const [index, entry] of entries.entries()) {
        const fallbackId = !Array.isArray(source.outfits) ? Object.keys(source.outfits)[index] : undefined;
        const outfit = normalizeOutfit(entry, fallbackId);
        if (outfit && !seen.has(outfit.id)) {
            seen.add(outfit.id);
            outfits.push(outfit);
        }
    }
    return { schema: OUTFIT_SCHEMA, outfits };
}

function normalizeBinding(value) {
    if (!isRecord(value)) return null;
    const activeOutfitId = outfitId(value.activeOutfitId);
    return activeOutfitId ? { activeOutfitId, isLocked: value.isLocked === true } : null;
}

export function migrateChatOutfitState(value) {
    const source = isRecord(value) ? value : {};
    const identities = {};
    const raw = isRecord(source.identities) ? source.identities : {};
    for (const [key, value] of Object.entries(raw)) {
        const identityId = stableIdentityId(key);
        const binding = normalizeBinding(value);
        if (identityId && binding) identities[identityId] = binding;
    }
    return { schema: OUTFIT_SCHEMA, identities, ...(typeof source.revision === 'string' ? { revision: source.revision } : {}) };
}

export function getChatOutfitBinding(state, identityId) {
    const id = stableIdentityId(identityId);
    if (!id) return null;
    return migrateChatOutfitState(state).identities[id] || null;
}

function catalogOutfits(catalog) {
    if (Array.isArray(catalog)) return catalog;
    return migrateOutfitCatalog(catalog).outfits;
}

export function selectChatOutfit(stateValue, identityId, requestedOutfitId, { catalog, confirmed = false, explicitChange = false, lock, expectedOutfitId } = {}) {
    const identity = stableIdentityId(identityId);
    const state = migrateChatOutfitState(stateValue);
    if (!identity) return { status: 'invalid-identity', state };
    const id = outfitId(requestedOutfitId);
    const outfit = catalogOutfits(catalog).find((entry) => entry?.id === id && entry?.identityId === identity);
    if (!outfit) return { status: 'outfit-not-found', state };
    const current = state.identities[identity] || null;
    if (expectedOutfitId !== undefined && current?.activeOutfitId !== outfitId(expectedOutfitId)) return { status: 'stale', state };
    if (current?.isLocked && current.activeOutfitId !== id && !confirmed && !explicitChange) return { status: 'confirmation-required', state };
    const binding = { activeOutfitId: id, isLocked: current ? current.isLocked : lock === true };
    return { status: 'selected', state: { ...state, identities: { ...state.identities, [identity]: binding } }, outfit };
}

export function setChatOutfitLock(stateValue, identityId, isLocked) {
    const state = migrateChatOutfitState(stateValue);
    const identity = stableIdentityId(identityId);
    const current = identity ? state.identities[identity] : null;
    if (!current) return state;
    return { ...state, identities: { ...state.identities, [identity]: { ...current, isLocked: isLocked === true } } };
}

export function clearChatOutfitBinding(stateValue, identityId) {
    const state = migrateChatOutfitState(stateValue);
    const identity = stableIdentityId(identityId);
    if (!identity || !state.identities[identity]) return state;
    const identities = { ...state.identities };
    delete identities[identity];
    return { ...state, identities };
}

export function resolveActiveChatOutfit(stateValue, identityId, catalog) {
    const binding = getChatOutfitBinding(stateValue, identityId);
    if (!binding) return { status: 'none', outfit: null, binding: null };
    const outfit = catalogOutfits(catalog).find((entry) => entry?.id === binding.activeOutfitId && entry?.identityId === identityId);
    return outfit ? { status: 'resolved', outfit, binding } : { status: 'broken', outfit: null, binding, reason: 'outfit-not-found' };
}

export function listActiveChatOutfits(stateValue, catalog) {
    const state = migrateChatOutfitState(stateValue);
    return Object.keys(state.identities).sort().map((identityId) => ({ identityId, ...resolveActiveChatOutfit(state, identityId, catalog) }));
}

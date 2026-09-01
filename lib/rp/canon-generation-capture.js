import { resolveCanonReferenceSnapshot } from './canon-reference-resolver.js';

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

export function captureCanonForGeneration({ library, gallery = [], chatState, identities = [], references = [] } = {}) {
    const canonSnapshot = resolveCanonReferenceSnapshot({ library, gallery, chatState, identities });
    return deepFreeze({
        canonSnapshot,
        references: clone(Array.isArray(references) ? references : []),
    });
}

export function notifyBrokenCanon(omissions = [], notify = () => {}) {
    if (!omissions.length) return false;
    notify('Saved look unavailable. Using avatar and description.');
    return true;
}

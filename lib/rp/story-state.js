const SCENE_KEYS = ['cast', 'location', 'outfits', 'objects', 'injuries'];

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}

function stableJson(value) {
    return JSON.stringify(value === undefined ? null : value);
}

function sceneValue(interpretation, key) {
    if (key === 'location') {
        const location = interpretation.location;
        if (!isRecord(location) || location.status === 'unknown' || location.status === 'ambiguous') return undefined;
        const value = String(location.value || '').trim();
        return value || undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(interpretation, key)) return undefined;
    if (!Array.isArray(interpretation[key])) return undefined;
    return interpretation[key].map((item) => {
        if (!isRecord(item)) return clone(item);
        const fact = { ...item };
        delete fact.confidence;
        delete fact.evidence;
        return clone(fact);
    });
}

function comparableItem(item) {
    if (!isRecord(item)) return stableJson(item);
    const copy = { ...item };
    delete copy.confidence;
    delete copy.evidence;
    return stableJson(copy);
}

function diffItems(previous, next) {
    const before = Array.isArray(previous) ? previous : [];
    const after = Array.isArray(next) ? next : [];
    const nextByIdentity = new Map();
    for (const item of after) {
        const key = isRecord(item) && item.identityId ? `identity:${item.identityId}` : `value:${comparableItem(item)}`;
        nextByIdentity.set(key, item);
    }
    const updates = [];
    for (const oldItem of before) {
        if (!isRecord(oldItem) || !oldItem.identityId) continue;
        const current = nextByIdentity.get(`identity:${oldItem.identityId}`);
        if (!current || comparableItem(oldItem) === comparableItem(current)) continue;
        if ('value' in oldItem && 'value' in current) updates.push({ identityId: oldItem.identityId, from: oldItem.value, to: current.value });
    }
    return updates;
}

/**
 * Replaces only the scene-scoped portion of story state. Durable identity
 * facts are copied through unchanged; unknown/ambiguous scene values clear
 * the stale scene value but never affect durable facts.
 */
export function reconcileStoryState(priorValue, interpretationValue = {}) {
    const prior = isRecord(priorValue) ? priorValue : {};
    const interpretation = isRecord(interpretationValue) ? interpretationValue : {};
    const previousScene = isRecord(prior.sceneFacts) ? prior.sceneFacts : {};
    const nextScene = {};
    const addedSceneFacts = {};
    const updatedSceneFacts = {};
    const removedSceneFacts = {};

    for (const key of SCENE_KEYS) {
        const supplied = key === 'location'
            ? Object.prototype.hasOwnProperty.call(interpretation, key)
            : Object.prototype.hasOwnProperty.call(interpretation, key);
        if (!supplied) {
            if (Object.prototype.hasOwnProperty.call(previousScene, key)) nextScene[key] = clone(previousScene[key]);
            continue;
        }
        const current = sceneValue(interpretation, key);
        if (current !== undefined) nextScene[key] = current;
        const previous = previousScene[key];
        if (stableJson(previous) === stableJson(current)) continue;
        if (Object.prototype.hasOwnProperty.call(previousScene, key)) removedSceneFacts[key] = clone(previous);
        if (current !== undefined) {
            if (!Object.prototype.hasOwnProperty.call(previousScene, key) && (!Array.isArray(current) || current.length)) addedSceneFacts[key] = clone(current);
            else if (key === 'location') updatedSceneFacts[key] = { from: previous, to: current };
            else {
                const itemUpdates = diffItems(previous, current);
                if (itemUpdates.length) updatedSceneFacts[key] = itemUpdates;
            }
        }
    }

    const durableFacts = isRecord(prior.durableIdentityFacts)
        ? prior.durableIdentityFacts
        : isRecord(prior.identityFacts)
            ? prior.identityFacts
            : prior.durableFacts;
    const nextState = {
        schema: 1,
        durableIdentityFacts: clone(isRecord(durableFacts) ? durableFacts : {}),
        sceneFacts: nextScene,
    };
    return {
        schema: 1,
        nextState,
        addedSceneFacts,
        updatedSceneFacts,
        removedSceneFacts,
    };
}

const SCENE_KEYS = ['cast', 'location', 'objects', 'injuries'];

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

function isHighConfidenceClear(signal) {
    return isRecord(signal) && signal.clear === true && signal.confidence === 'high';
}

function itemKey(item) {
    if (!isRecord(item)) return `value:${stableJson(item)}`;
    if (item.identityId) return `identity:${item.identityId}`;
    if (item.holderIdentityId) return `holder:${item.holderIdentityId}|value:${stableJson(item.value)}`;
    return `value:${stableJson(item)}`;
}

function mergeCollection(previous, current) {
    const result = Array.isArray(previous) ? previous.map(clone) : [];
    for (const item of current || []) {
        const key = itemKey(item);
        const index = result.findIndex((existing) => itemKey(existing) === key);
        if (index === -1) result.push(clone(item));
        else result[index] = clone(item);
    }
    return result;
}

function matchesRemoval(item, target) {
    if (typeof target === 'string') return item?.identityId === target;
    if (!isRecord(item) || !isRecord(target)) return false;
    if (target.value !== undefined && item.value !== target.value) return false;
    if (target.identityId !== undefined && item.identityId !== undefined && item.identityId !== target.identityId) return false;
    if (target.holderIdentityId !== undefined && item.holderIdentityId !== undefined && item.holderIdentityId !== target.holderIdentityId) return false;
    return ['identityId', 'holderIdentityId', 'value'].some((field) => target[field] !== undefined);
}

function applyTargetedRemovals(value, signal) {
    if (!Array.isArray(value) || !Array.isArray(signal?.remove)) return value;
    return value.filter((item) => !signal.remove.some((target) => matchesRemoval(item, target)));
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
        const key = itemKey(item);
        nextByIdentity.set(key, item);
    }
    const updates = [];
    for (const oldItem of before) {
        if (!isRecord(oldItem) || !oldItem.identityId) continue;
        const current = nextByIdentity.get(itemKey(oldItem));
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
    // v2.5 no longer interprets outfit state, but existing chats may still
    // carry arbitrary legacy payloads here. Preserve that value opaquely so a
    // successful scene-state save cannot become a destructive migration.
    if (Object.prototype.hasOwnProperty.call(previousScene, 'outfits')) nextScene.outfits = clone(previousScene.outfits);
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
        const signal = interpretation.sceneSignals?.[key];
        const shouldClear = isHighConfidenceClear(signal);
        let effectiveCurrent;
        if (Array.isArray(current)) {
            if (shouldClear) effectiveCurrent = undefined;
            else effectiveCurrent = applyTargetedRemovals(mergeCollection(previousScene[key], current), signal);
        } else {
            effectiveCurrent = current === undefined ? (shouldClear ? undefined : previousScene[key]) : current;
        }
        if (effectiveCurrent !== undefined) nextScene[key] = effectiveCurrent;
        const previous = previousScene[key];
        if (stableJson(previous) === stableJson(effectiveCurrent)) continue;
        if (Object.prototype.hasOwnProperty.call(previousScene, key)) {
            if (Array.isArray(previous) && Array.isArray(effectiveCurrent)) {
                const removed = previous.filter((item) => !effectiveCurrent.some((currentItem) => comparableItem(item) === comparableItem(currentItem)));
                if (removed.length) removedSceneFacts[key] = clone(removed);
            } else removedSceneFacts[key] = clone(previous);
        }
        if (effectiveCurrent !== undefined) {
            if (!Object.prototype.hasOwnProperty.call(previousScene, key) && (!Array.isArray(effectiveCurrent) || effectiveCurrent.length)) addedSceneFacts[key] = clone(effectiveCurrent);
            else if (key === 'location') updatedSceneFacts[key] = { from: previous, to: effectiveCurrent };
            else {
                const itemUpdates = diffItems(previous, effectiveCurrent);
                if (itemUpdates.length) updatedSceneFacts[key] = itemUpdates;
            }
        } else if (Array.isArray(previous) && shouldClear) {
            removedSceneFacts[key] = clone(previous);
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

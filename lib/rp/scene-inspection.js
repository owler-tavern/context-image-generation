function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function labelFor(identityId, cast) {
    return cast.find((entry) => entry.identityId === identityId)?.label || identityId || 'unknown identity';
}

function overallConfidence(value) {
    const ranks = { low: 0, medium: 1, high: 2 };
    const confidence = [value?.focusPassage?.confidence, value?.location?.confidence, ...(value?.cast || []).map((entry) => entry.confidence)]
        .filter((entry) => entry in ranks);
    if (!confidence.length) return 'low';
    return confidence.reduce((best, current) => ranks[current] < ranks[best] ? current : best, 'high');
}

function locationLine(location) {
    if (typeof location === 'string' && location.trim()) return `Location: ${location.trim()}.`;
    if (!location || location.status === 'unknown' || !location.value) return location?.status === 'ambiguous' ? `Location: ambiguous (${(location.candidates || []).join(', ')}).` : 'Location: unknown.';
    if (location.status === 'ambiguous') return `Location: ambiguous (${(location.candidates || []).join(', ')}).`;
    return `Location: ${location.value}.`;
}

function changeLine(delta) {
    const removed = Object.keys(delta?.removedSceneFacts || {});
    const updated = Object.keys(delta?.updatedSceneFacts || {});
    const added = Object.keys(delta?.addedSceneFacts || {});
    if (!removed.length && !updated.length && !added.length) return 'State changes: none recorded.';
    const parts = [];
    if (added.length) parts.push(`added ${added.join(', ')}`);
    if (updated.length) parts.push(`updated ${updated.join(', ')}`);
    if (removed.length) parts.push(`removed ${removed.join(', ')}`);
    return `State changes: ${parts.join('; ')}.`;
}

function hasFact(value, key) {
    if (key === 'location') {
        if (typeof value?.location === 'string') return Boolean(value.location.trim());
        return Boolean(value?.location?.value) && value.location.status !== 'unknown' && value.location.status !== 'ambiguous';
    }
    return Array.isArray(value?.[key]) && value[key].length > 0;
}

function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (!isRecord(value)) return value;
    const copy = { ...value };
    delete copy.confidence;
    delete copy.evidence;
    return Object.fromEntries(Object.entries(copy).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, comparable(item)]));
}

function comparableEqual(left, right) {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function factStatus(value, effective, key, delta) {
    if (delta?.updatedSceneFacts?.[key] || delta?.addedSceneFacts?.[key] || delta?.removedSceneFacts?.[key]) return 'changed';
    if (!hasFact(effective, key)) return 'unknown';
    if (!hasFact(value, key)) return 'retained';
    if (key !== 'location' && !comparableEqual(value[key], effective[key])) return 'changed';
    const entries = key === 'location' ? [value.location] : value[key];
    if (entries.some((entry) => entry?.confidence === 'medium' || entry?.evidence?.some((evidence) => evidence.source === 'recent-context'))) return 'inferred';
    return 'observed';
}

function suffix(status) {
    return ['observed', 'unknown'].includes(status) ? '' : ` (${status})`;
}

/** Returns a UI-safe, human-readable projection without exposing raw evidence. */
export function projectSceneInspection(value = {}) {
    const delta = value.storyStateDelta || null;
    const effective = delta?.nextState?.sceneFacts || value;
    const statuses = Object.fromEntries(['cast', 'location', 'objects', 'injuries'].map((key) => [key, factStatus(value, effective, key, delta)]));
    const cast = Array.isArray(effective.cast) ? effective.cast : [];
    const focus = value.focusPassage?.text ? value.focusPassage.text.replace(/[.!?]+$/u, '') : 'unavailable';
    const observedCastIds = new Set((value.cast || []).map((entry) => entry.identityId));
    const retainedCast = cast.filter((entry) => !observedCastIds.has(entry.identityId)).map((entry) => entry.label || entry.identityId);
    const present = cast.length ? `${cast.map((entry) => entry.label || entry.identityId).join(', ')}${retainedCast.length ? ` (retained: ${retainedCast.join(', ')})` : ''}` : 'unknown';
    const objects = (effective.objects || []).map((entry) => entry.holderIdentityId ? `${entry.value} (held by ${labelFor(entry.holderIdentityId, cast)})` : entry.value).join('; ');
    const injuries = (effective.injuries || []).map((entry) => `${labelFor(entry.identityId, cast)} — ${entry.value}`).join('; ');
    const warnings = [];
    for (const ambiguity of value.ambiguities || []) {
        warnings.push(ambiguity.reason === 'quoted'
            ? `The quoted mention "${ambiguity.alias}" was not treated as a present identity.`
            : `The alias "${ambiguity.alias}" matched more than one identity.`);
    }
    if ((value.excluded || []).some((entry) => ['negated', 'absent'].includes(entry.reason))) warnings.push('One or more mentions were excluded because they were negated or absent.');
    if (value.location?.status === 'ambiguous') warnings.push('Location is ambiguous and was not committed as a single scene fact.');
    return {
        title: 'Scene interpretation',
        confidence: overallConfidence(value),
        lines: [
            `Focus: ${focus}.`,
            `Present: ${present}${suffix(statuses.cast)}.`,
            `${locationLine(effective.location).replace(/\.$/u, '')}${suffix(statuses.location)}.`,
            `Objects: ${objects || (statuses.objects === 'unknown' ? 'unknown' : 'none recorded')}${suffix(statuses.objects)}.`,
            `Injuries: ${injuries || (statuses.injuries === 'unknown' ? 'unknown' : 'none recorded')}${suffix(statuses.injuries)}.`,
            changeLine(value.storyStateDelta),
        ],
        statuses,
        warnings: [...new Set(warnings)],
    };
}

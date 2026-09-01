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

/** Returns a UI-safe, human-readable projection without exposing raw evidence. */
export function projectSceneInspection(value = {}) {
    const cast = Array.isArray(value.cast) ? value.cast : [];
    const focus = value.focusPassage?.text ? value.focusPassage.text.replace(/[.!?]+$/u, '') : 'unavailable';
    const present = cast.length ? cast.map((entry) => entry.label || entry.identityId).join(', ') : 'none confidently identified';
    const outfits = (value.outfits || []).map((entry) => `${labelFor(entry.identityId, cast)} — ${entry.value}`).join('; ');
    const objects = (value.objects || []).map((entry) => entry.holderIdentityId ? `${entry.value} (held by ${labelFor(entry.holderIdentityId, cast)})` : entry.value).join('; ');
    const injuries = (value.injuries || []).map((entry) => `${labelFor(entry.identityId, cast)} — ${entry.value}`).join('; ');
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
            `Present: ${present}.`,
            locationLine(value.location),
            `Outfits: ${outfits || 'none recorded'}.`,
            `Objects: ${objects || 'none recorded'}.`,
            `Injuries: ${injuries || 'none recorded'}.`,
            changeLine(value.storyStateDelta),
        ],
        warnings: [...new Set(warnings)],
    };
}

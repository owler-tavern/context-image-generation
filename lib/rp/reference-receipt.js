const MAX_ENTRIES = 24;

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 120) {
    const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim();
    return normalized.length <= max ? normalized : normalized.slice(0, max);
}
function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
}
function sourceLabel(reference) {
    const source = text(reference?.sourceType || reference?.role, 40).toLocaleLowerCase('und').replace(/_/gu, '-');
    if (source === 'remembered' || source === 'identity-look' || source === 'look') return 'saved look';
    if (source === 'avatar' || source === 'host-avatar') return 'avatar';
    if (source === 'description' || source === 'written-description') return 'description';
    if (source === 'prior-scene' || source === 'legacy-previous') return 'previous image';
    return 'visual source';
}
function referenceLabel(reference) {
    return text(reference?.identityLabel || reference?.label || reference?.identity || reference?.character || reference?.identityId || 'Selected source');
}
function reasonLabel(reason, modelMax) {
    switch (text(reason, 60).toLocaleLowerCase('und')) {
        case 'model-limit':
        case 'provider-cap':
        case 'planner-cap':
        case 'unknown-cap': return Number.isInteger(modelMax) ? `this model accepts ${modelMax} image references` : 'the model reference limit was reached';
        case 'model-limit-unknown': return 'the model image-reference limit is not known';
        case 'identity-already-represented': return 'another source already represents this character';
        case 'cast-excluded': return 'this identity was excluded for the scene';
        case 'asset-unavailable':
        case 'missing-asset': return 'that source is unavailable';
        default: return 'it was not selected for this image';
    }
}
function natural(items) {
    if (items.length < 2) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/** Keep only player-readable source decisions from the final immutable plan. */
export function projectReferenceReceipt(plan = {}) {
    const modelMax = Number.isInteger(plan?.referencePlan?.modelLimit?.maxReferences) && plan.referencePlan.modelLimit.maxReferences >= 0
        ? plan.referencePlan.modelLimit.maxReferences
        : Number.isInteger(plan?.resolved?.capabilities?.referenceImages?.maxCount) && plan.resolved.capabilities.referenceImages.maxCount >= 0
            ? plan.resolved.capabilities.referenceImages.maxCount
            : null;
    const identityLabels = new Map((Array.isArray(plan?.identities) ? plan.identities : [])
        .map((identity) => [text(identity?.id, 180), text(identity?.label || identity?.name, 120)])
        .filter(([id, label]) => id && label));
    const labelReference = (reference) => reference?.identityLabel || reference?.label || identityLabels.get(text(reference?.identityId, 180)) || reference?.identity || reference?.character || reference?.identityId || 'Selected source';
    const references = Array.isArray(plan?.references) ? plan.references : [];
    const used = references.slice(0, MAX_ENTRIES).map((reference) => ({ label: text(labelReference(reference)), source: sourceLabel(reference) }));
    const omissions = [
        ...(Array.isArray(plan?.referenceOmissions) ? plan.referenceOmissions : []),
        ...(Array.isArray(plan?.referencePlan?.omitted) ? plan.referencePlan.omitted : []),
    ];
    const seen = new Set();
    const omitted = [];
    for (const entry of omissions) {
        const candidate = isRecord(entry?.candidate) ? entry.candidate : entry;
        const id = text(candidate?.id || candidate?.identityId, 180);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        omitted.push({ label: text(labelReference(candidate)), source: sourceLabel(candidate), reason: reasonLabel(entry?.reason || candidate?.reason, modelMax) });
        if (omitted.length >= MAX_ENTRIES) break;
    }
    return { schema: 1, used, omitted, modelMax };
}

export function renderReferenceReceipt(value = {}) {
    const receipt = isRecord(value) ? value : {};
    const used = Array.isArray(receipt.used) ? receipt.used : [];
    const omitted = Array.isArray(receipt.omitted) ? receipt.omitted : [];
    if (!used.length && !omitted.length) return '';
    const escape = (value) => String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const usedText = used.length ? `Used ${natural(used.map((entry) => `${escape(entry.label)}'s ${escape(entry.source)}`))}.` : '';
    const omittedText = omitted.map((entry) => `Did not use ${escape(entry.label)}'s ${escape(entry.source)} because ${escape(entry.reason)}.`).join(' ');
    return `<section class="cig-reference-receipt" aria-label="Reference receipt"><h4>Reference receipt</h4><p>${usedText}${usedText && omittedText ? ' ' : ''}${omittedText}</p></section>`;
}

export function compactReferenceReceipt(value = {}) {
    const receipt = Array.isArray(value?.used) || Array.isArray(value?.omitted)
        ? {
            schema: 1,
            used: Array.isArray(value.used) ? value.used : [],
            omitted: Array.isArray(value.omitted) ? value.omitted : [],
            modelMax: Number.isInteger(value.modelMax) && value.modelMax >= 0 ? value.modelMax : null,
        }
        : projectReferenceReceipt(value);
    return {
        schema: 1,
        used: receipt.used.slice(0, MAX_ENTRIES).map((entry) => ({ label: text(entry.label), source: text(entry.source, 60) })),
        omitted: receipt.omitted.slice(0, MAX_ENTRIES).map((entry) => ({ label: text(entry.label), source: text(entry.source, 60), reason: text(entry.reason, 180) })),
        modelMax: receipt.modelMax,
    };
}

export const REFERENCE_RECEIPT_CSS = `.cig-reference-receipt{margin-top:.75rem;padding:.65rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent)}.cig-reference-receipt p{margin:.25rem 0;overflow-wrap:anywhere}`;

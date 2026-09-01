const SOURCE_LABELS = Object.freeze({ remembered: 'saved look', avatar: 'avatar', description: 'description' });
const SOURCE_ORDER = Object.freeze(['remembered', 'avatar', 'description']);

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
function sourceType(value) {
    const normalized = text(value, 40).toLocaleLowerCase('und').replace(/_/gu, '-');
    if (normalized === 'identity-look' || normalized === 'look' || normalized === 'remembered') return 'remembered';
    if (normalized === 'host-avatar' || normalized === 'avatar') return 'avatar';
    if (normalized === 'description' || normalized === 'written-description') return 'description';
    return null;
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

/** Project only local availability facts; it never predicts the final clicked-message plan. */
export function projectReferenceReadiness({ identities = [], truths = [], candidates = [], modelMax = null, stagedPreviousImage = null, previousImageEnabled = false, allowAvatars = true, allowDescriptions = true, sourcePreferences = {} } = {}) {
    const identityList = (Array.isArray(identities) ? identities : []).slice(0, 12).filter((identity) => text(identity?.id, 160));
    const truthById = new Map((Array.isArray(truths) ? truths : []).map((truth) => [text(truth?.identityId, 160), truth]));
    const candidateList = Array.isArray(candidates) ? candidates : [];
    const rows = identityList.map((identity) => {
        const id = text(identity.id, 160);
        const truth = truthById.get(id) || {};
        const preference = sourcePreferences?.[id]?.sourceType || sourcePreferences?.[id]?.sourcePreference || 'auto';
        const available = new Set();
        for (const candidate of candidateList) {
            if (text(candidate?.identityId, 160) !== id) continue;
            const type = sourceType(candidate?.sourceType || candidate?.role);
            if (type === 'avatar' && allowAvatars !== true) continue;
            if (type === 'description' && allowDescriptions !== true) continue;
            if (type) available.add(type);
        }
        const truthType = sourceType(truth.sourceType);
        if (truthType && !(truthType === 'avatar' && allowAvatars !== true) && !(truthType === 'description' && allowDescriptions !== true)) available.add(truthType);
        if (truth.description?.text && allowDescriptions === true) available.add('description');
        const selectedType = sourceType(preference);
        if (selectedType && !(selectedType === 'avatar' && allowAvatars !== true) && !(selectedType === 'description' && allowDescriptions !== true)) {
            // An explicit choice describes the effective source, while the
            // remaining enabled sources stay visible as available options.
            available.add(selectedType);
        }
        const ordered = SOURCE_ORDER.filter((type) => available.has(type));
        return {
            identityId: id,
            label: text(identity.label || identity.name || id),
            availableSources: ordered.map((type) => SOURCE_LABELS[type]),
            effectiveSource: SOURCE_LABELS[selectedType] || SOURCE_LABELS[truthType] || 'automatic choice',
        };
    }).filter((row) => row.availableSources.length);
    const normalizedModelMax = Number.isInteger(modelMax) && modelMax >= 0 ? modelMax : null;
    const previousImage = previousImageEnabled === true && isRecord(stagedPreviousImage) && text(stagedPreviousImage.artifactId, 180)
        ? { artifactId: text(stagedPreviousImage.artifactId, 180), title: text(stagedPreviousImage.title || 'Selected Story Memory scene', 160) }
        : null;
    if (!rows.length && normalizedModelMax === null && !previousImage) return null;
    return {
        schema: 1,
        modelMax: normalizedModelMax,
        identities: rows,
        previousImage,
        summary: rows.length
            ? 'Available sources may be used for the next wand. The clicked message or highlighted passage determines the final selection.'
            : 'No character image source is ready yet; the clicked message or highlighted passage still determines the scene.',
    };
}

export function renderReferenceReadiness(value = {}) {
    const readiness = isRecord(value) ? value : null;
    if (!readiness) return '';
    const rows = (Array.isArray(readiness.identities) ? readiness.identities : []).slice(0, 12)
        .map((row) => `<li><strong>${escapeHtml(row.label || row.identityId)}</strong>: ${escapeHtml((Array.isArray(row.availableSources) ? row.availableSources : []).join(', '))} available</li>`)
        .join('');
    const model = Number.isInteger(readiness.modelMax) && readiness.modelMax >= 0
        ? `This model accepts up to ${readiness.modelMax} image references.`
        : 'This model\'s image-reference limit is not known.';
    const previous = readiness.previousImage
        ? `<li>Selected Story Memory image may be used: ${escapeHtml(readiness.previousImage.title)}.</li>`
        : '';
    const details = rows || previous ? `<details class="cig-reference-readiness-details"><summary>See available sources</summary><ul>${rows}${previous}</ul><p>${escapeHtml(model)}</p></details>` : `<p>${escapeHtml(model)}</p>`;
    return `<details class="cig-reference-readiness"><summary>Reference readiness for this chat</summary><p class="cig-setting-help" role="status">${escapeHtml(readiness.summary || 'Available sources may be used for the next wand; the clicked message or highlighted passage determines the final selection.')}</p>${details}</details>`;
}

export const REFERENCE_READINESS_CSS = `.cig-reference-readiness{margin-top:.75rem;width:100%}.cig-reference-readiness summary,.cig-reference-readiness-details summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}.cig-reference-readiness ul{margin:.5rem 0;padding-left:1.25rem}.cig-reference-readiness-details{margin-top:.5rem}.cig-reference-readiness summary:focus-visible,.cig-reference-readiness-details summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}@media(max-width:480px){.cig-reference-readiness{max-width:100%;overflow-wrap:anywhere}}`;

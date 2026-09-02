import { inferDirectorCast, normalizeDirectorCastOverrides } from './cast-policy.js';

const ACTIONS = Object.freeze([
    ['auto', 'Automatic (recommended)'],
    ['include', 'Include'],
    ['focus', 'Focus'],
    ['exclude', 'Exclude'],
]);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function projectCastCorrectionChoices({ identities = [], overrides = [] } = {}) {
    const candidates = inferDirectorCast({ identities });
    const validIds = new Set(candidates.map((candidate) => candidate.identityId));
    const normalized = normalizeDirectorCastOverrides(overrides, { allowedIdentityIds: validIds });
    const actions = new Map(normalized.map((entry) => [entry.identityId, entry.action]));
    return candidates.map((candidate) => ({
        identityId: candidate.identityId,
        label: candidate.label,
        kind: candidate.kind,
        action: actions.get(candidate.identityId) || 'auto',
        inferredAction: candidate.inferredAction || 'auto',
    }));
}

export function renderCastCorrectionControls({ identities = [], overrides = [] } = {}) {
    const choices = projectCastCorrectionChoices({ identities, overrides });
    const active = choices.filter((choice) => choice.action !== 'auto');
    const summary = active.length
        ? `Cast corrections active: ${active.map((choice) => `${choice.label} ${choice.action === 'focus' ? 'focused' : `${choice.action}d`}`).join('; ')}.`
        : 'Automatic cast inference is active.';
    const rows = choices.length
        ? choices.map((choice) => `<div class="cig_chat_cast_row" data-cig-chat-cast-identity="${escapeHtml(choice.identityId)}"><label for="cig_chat_cast_${escapeHtml(choice.identityId).replace(/[^A-Za-z0-9_-]/gu, '_')}">${escapeHtml(choice.label)}</label><select id="cig_chat_cast_${escapeHtml(choice.identityId).replace(/[^A-Za-z0-9_-]/gu, '_')}" class="cig-setting cig_chat_cast_select" style="min-height:44px" data-cig-chat-cast-action="${escapeHtml(choice.identityId)}" aria-label="Cast choice for ${escapeHtml(choice.label)}">${ACTIONS.map(([value, label]) => `<option value="${value}"${choice.action === value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>`).join('')
        : '<p class="cig-setting-help">No current character or persona identity is available for cast choices.</p>';
    return `<details class="cig_chat_cast_corrections"><summary>Current cast: Correct who appears</summary><p class="cig-setting-help">The wand uses automatic cast inference unless you make a correction. Include adds someone, Focus gives one person composition priority while keeping included people, and Exclude removes someone.</p><p class="cig_chat_cast_summary" role="status" aria-live="polite">${escapeHtml(summary)}</p><div class="cig_chat_cast_rows">${rows}</div></details>`;
}

export const CAST_CORRECTION_SETTINGS_CSS = `
.cig_chat_cast_corrections { margin-top: .75rem; width: 100%; }
.cig_chat_cast_corrections summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 600; }
.cig_chat_cast_rows { display: grid; gap: .5rem; }
.cig_chat_cast_row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; min-width: 0; }
.cig_chat_cast_row label { overflow-wrap: anywhere; }
.cig_chat_cast_select { min-height: 44px; max-width: 11rem; }
@media (max-width: 480px) { .cig_chat_cast_row { align-items: stretch; flex-direction: column; } .cig_chat_cast_select { max-width: none; width: 100%; } }
`;

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

const optionMarkup = (values, selected) => values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');

export const DIRECTOR_UI_CSS = `
.cig_director_panel { box-sizing:border-box; width:100%; max-width:100%; min-width:0; margin:.5rem 0; padding:.75rem; border:1px solid var(--SmartThemeBorderColor,#777); border-radius:.5rem; overflow-wrap:anywhere; }
.cig_director_panel * { box-sizing:border-box; max-width:100%; }
.cig_director_panel label { display:block; margin:.5rem 0 .25rem; font-weight:600; }
.cig_director_panel select, .cig_director_panel textarea, .cig_director_panel button { width:100%; min-height:44px; font:inherit; }
.cig_director_panel textarea { min-height:88px; resize:vertical; }
.cig_director_panel select, .cig_director_panel textarea { padding:.5rem; }
.cig_director_panel button { padding:.5rem .75rem; cursor:pointer; }
.cig_director_panel button:focus-visible, .cig_director_panel select:focus-visible, .cig_director_panel textarea:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.cig_message_director_inline { display:block; width:100%; min-height:44px; margin:.5rem 0 0; padding:.5rem .75rem; text-align:left; overflow-wrap:anywhere; }
.cig_message_director_inline:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.cig_director_actions { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.75rem; }
.cig_director_actions button { flex:1 1 12rem; }
@media (max-width:480px) { .cig_director_panel { padding:.625rem; } .cig_director_actions { display:grid; grid-template-columns:1fr; } }
`;

export function renderDirectorPanel(panel = {}) {
    const messageId = escapeHtml(panel.messageId ?? panel.target?.messageId ?? '');
    const inspection = Array.isArray(panel.inspection) && panel.inspection.length
        ? `<ul>${panel.inspection.slice(0, 8).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
        : '<p>No additional scene cues were found. You can add visual direction below.</p>';
    const recoveryText = panel.previewError || (panel.status === 'stale'
        ? 'This Director draft is stale. Close and reopen Director to choose the current message before generating.'
        : panel.status === 'failed' ? 'Generation did not complete. Your draft is still here.' : '');
    const status = recoveryText ? `<p role="alert">${escapeHtml(recoveryText)}</p>` : '';
    const busy = panel.status === 'generating' ? ' aria-busy="true"' : '';
    const generateDisabled = panel.status === 'generating' || panel.status === 'stale' ? ' disabled' : '';
    return `<section class="cig_director_panel" role="region" aria-label="Direct this scene" data-message-id="${messageId}"${busy}>
<h3>Direct this scene</h3>
<p><strong>No image is made until Generate.</strong></p>
<p><strong>Target:</strong> message ${messageId || 'this message'}${panel.focusText ? ' (selected passage)' : ''}</p>${panel.focusNotice ? `<p role="status">${escapeHtml(panel.focusNotice)}</p>` : ''}
<div class="cig_director_preview"><h4>Story moment</h4><p>${escapeHtml(panel.moment || panel.sourceMessage || 'Scene preview unavailable.')}</p><h4>Scene cues</h4>${inspection}</div>
<label for="cig_director_framing_${messageId}">Framing</label>
<select id="cig_director_framing_${messageId}" data-director-field="framing">${optionMarkup(['auto', 'close-up', 'medium', 'wide', 'full-body'], panel.framing || 'auto')}</select>
<label for="cig_director_continuity_${messageId}">Continuity strength</label>
<select id="cig_director_continuity_${messageId}" data-director-field="continuity">${optionMarkup(['minimal', 'balanced', 'strong'], panel.continuity || 'balanced')}</select>
<label for="cig_director_direction_${messageId}">Visual direction (optional)</label>
<textarea id="cig_director_direction_${messageId}" data-director-field="visualDirection" maxlength="1000" placeholder="Add a concise visual intention">${escapeHtml(panel.visualDirection || '')}</textarea>
<div class="cig_director_status" aria-live="polite"><p><strong>Character references:</strong> ${escapeHtml(panel.referenceSummary || 'Reference readiness unavailable.')}</p><p><strong>Current route:</strong> ${escapeHtml(panel.routeSummary || 'Current route readiness unavailable.')}</p><p><strong>Budget:</strong> ${escapeHtml(panel.budgetSummary || 'Exact consequence unavailable until generation.')}</p></div>
${status}<div class="cig_director_actions"><button type="button" style="min-height:44px" data-director-action="generate"${generateDisabled}>Generate directed image</button><button type="button" style="min-height:44px" data-director-action="close">Close Director</button></div>
</section>`;
}

export function createDirectorUiController({ open, update, close, generate, render = () => {} } = {}) {
    const action = async (name, payload) => {
        let result;
        if (name === 'open') result = await open?.(payload);
        else if (name === 'update') result = await update?.(payload);
        else if (name === 'close' || name === 'dismiss') result = await close?.(payload);
        else if (name === 'generate') result = await generate?.(payload);
        else return { status: 'unknown-action' };
        render(result);
        return result;
    };
    return { action, open: (payload) => action('open', payload), update: (payload) => action('update', payload), close: (payload) => action('close', payload), dismiss: (payload) => action('dismiss', payload), generate: (payload) => action('generate', payload) };
}

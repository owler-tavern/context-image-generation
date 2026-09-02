export const CINEMATIC_UI_CSS = `
.cig_cinematic_suggestion { border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; padding: 10px; margin-top: 8px; background: var(--SmartThemeBlurTintColor); overflow-wrap: anywhere; }
.cig_cinematic_suggestion :is(button,input,textarea) { min-height: 44px; }
.cig_cinematic_suggestion_actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.cig_cinematic_suggestion_actions button { flex: 1 1 120px; }
.cig_cinematic_suggestion_adjust { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.cig_cinematic_suggestion_adjust input { flex: 1 1 220px; min-width: 0; }
@media (max-width: 480px) { .cig_cinematic_suggestion_actions button, .cig_cinematic_suggestion_adjust input { width: 100%; flex-basis: 100%; } }
@media (prefers-reduced-motion: reduce) { .cig_cinematic_suggestion { transition: none; } }
`;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function isVisible(element, documentLike) {
    if (!element || element.hidden === true) return false;
    const style = documentLike?.defaultView?.getComputedStyle?.(element) || element.style || {};
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function activate(element, documentLike) {
    if (!element) return false;
    if (typeof element.click === 'function') {
        element.click();
        return true;
    }
    if (typeof element.dispatchEvent === 'function') {
        const EventCtor = documentLike?.defaultView?.Event || globalThis.Event;
        element.dispatchEvent(typeof EventCtor === 'function' ? new EventCtor('click', { bubbles: true }) : { type: 'click', bubbles: true });
        return true;
    }
    return false;
}

export function renderCinematicSuggestionCard(suggestion) {
    if (!suggestion?.suggestionId) return '';
    const id = escapeHtml(suggestion.suggestionId);
    const why = escapeHtml(suggestion.whyFired?.text || 'An accepted story change made this moment eligible.');
    const shot = escapeHtml(suggestion.adjustments?.prompt || suggestion.proposedShot || 'Cinematic story moment');
    const budget = escapeHtml(suggestion.budgetText || 'Budget status unavailable.');
    const waiting = escapeHtml(suggestion.waitingText || suggestion.nextTrigger?.explanation || 'Waiting for an accepted story change.');
    return `<section class="cig_cinematic_suggestion" data-cig-cinematic-card="${id}" aria-label="Cinematic image suggestion"><strong>Cinematic suggestion</strong><p class="cig_cinematic_suggestion_why">${why}</p><p class="cig_cinematic_suggestion_shot"><strong>Proposed shot:</strong> ${shot}</p><p class="cig_cinematic_suggestion_budget" role="status" aria-live="polite"><strong>Budget:</strong> ${budget}</p><p class="cig_cinematic_suggestion_waiting"><strong>Next:</strong> ${waiting}</p><p class="cig_cinematic_suggestion_help">No image is made here. Use for next wand stages this shot in the current chat.</p><div class="cig_cinematic_suggestion_adjust"><label for="cig_cinematic_adjust_${id}">Adjust shot</label><input id="cig_cinematic_adjust_${id}" data-cig-cinematic-adjust-input type="text" value="${shot}" maxlength="800" /></div><div class="cig_cinematic_suggestion_actions"><button type="button" class="menu_button" data-cig-cinematic-action="stage" data-cig-cinematic-id="${id}">Use for next wand</button><button type="button" class="menu_button" data-cig-cinematic-action="adjust" data-cig-cinematic-id="${id}">Adjust</button><button type="button" class="menu_button" data-cig-cinematic-action="dismiss" data-cig-cinematic-id="${id}">Dismiss</button></div></section>`;
}

/** Close the host extension overlay only after a suggestion card is mounted, then place focus on it. */
export function focusCinematicSuggestionCard({ documentLike = globalThis.document, suggestionId } = {}) {
    if (!documentLike?.querySelectorAll || !suggestionId) return { status: 'unavailable' };
    const card = [...documentLike.querySelectorAll('.cig_cinematic_suggestion[data-cig-cinematic-card]')]
        .find((node) => node.getAttribute?.('data-cig-cinematic-card') === String(suggestionId));
    if (!card) return { status: 'unavailable' };
    const hostDrawer = documentLike.querySelector('#rm_extensions_block');
    const hostToggle = documentLike.querySelector('#extensions-settings-button > .drawer-toggle');
    const hostWasOpen = Boolean(hostDrawer && isVisible(hostDrawer, documentLike));
    if (hostWasOpen) activate(hostToggle, documentLike);
    card.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const focusTarget = card.querySelector?.('[data-cig-cinematic-action="stage"]') || card;
    focusTarget.setAttribute?.('tabindex', focusTarget === card ? '-1' : focusTarget.getAttribute?.('tabindex') || '0');
    focusTarget.focus?.({ preventScroll: true });
    return { status: 'focused', hostClosed: hostWasOpen };
}

export function createCinematicUiController({ getSuggestion = () => null, stage, adjust, dismiss, render = () => {} } = {}) {
    async function action(actionName, value, suggestionIdOverride = null) {
        const suggestion = getSuggestion();
        const suggestionId = suggestionIdOverride || suggestion?.suggestionId;
        if (!suggestionId) return { status: 'no-suggestion' };
        if (actionName === 'stage' && typeof stage === 'function') return stage(suggestionId, value);
        if (actionName === 'adjust' && typeof adjust === 'function') return adjust(suggestionId, { prompt: String(value ?? '').trim() || suggestion?.proposedShot || '' });
        if (actionName === 'dismiss' && typeof dismiss === 'function') return dismiss(suggestionId);
        return { status: 'unknown-action' };
    }
    return { action, render };
}

export function installCinematicStyles(documentLike = globalThis.document) {
    if (!documentLike?.head || !documentLike?.createElement) return null;
    const id = 'cig-cinematic-suggestion-style-v1';
    const existing = documentLike.getElementById?.(id);
    if (existing) return existing;
    const style = documentLike.createElement('style'); style.id = id; style.textContent = CINEMATIC_UI_CSS; documentLike.head.appendChild(style); return style;
}

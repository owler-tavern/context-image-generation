const escapeHtml = (value) => String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

export const VISUAL_STORY_UI_CSS = `
.cig_visual_story_surface { box-sizing:border-box; width:100%; max-width:100%; min-width:0; margin:0 0 1rem; padding:.75rem; border:1px solid var(--SmartThemeBorderColor,#777); border-radius:.5rem; overflow-wrap:anywhere; }
.cig_visual_story_surface * { box-sizing:border-box; max-width:100%; }
.cig_visual_story_surface h2, .cig_visual_story_surface h3 { margin-top:0; }
.cig_visual_story_surface button { width:100%; min-height:44px; padding:.5rem .75rem; font:inherit; cursor:pointer; }
.cig_visual_story_surface button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.cig_visual_story_sections { display:grid; gap:.75rem; }
.cig_visual_story_section { margin:0; padding:.625rem; border:1px solid var(--SmartThemeBorderColor,#777); border-radius:.375rem; }
.cig_message_visual_story_inline { display:block; width:100%; min-height:44px; margin:.5rem 0 0; padding:.5rem .75rem; text-align:left; overflow-wrap:anywhere; }
.cig_message_visual_story_inline:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
@media (max-width:480px) { .cig_visual_story_surface { padding:.625rem; } }
`;

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

export function renderVisualStorySurface({ memoryState = {}, appearanceSummary = 'Character appearance readiness is unavailable.', cinematicEnabled = false } = {}) {
    const momentCount = Array.isArray(memoryState.timeline) ? memoryState.timeline.length : 0;
    const memoryCopy = momentCount > 0
        ? `${momentCount} generated ${momentCount === 1 ? 'moment is' : 'moments are'} ready in this chat.`
        : 'No generated moments yet. Use the wand or Direct this scene on an RP message to create the first visual story moment.';
    const cinematicCopy = cinematicEnabled
        ? 'On · suggestions wait for an accepted story change and never generate until you approve.'
        : 'Off · turn this on when you want provider-free shot suggestions after accepted story changes.';
    const cinematicAction = cinematicEnabled ? 'Configure cinematic suggestions' : 'Turn on cinematic suggestions';
    return `<section class="cig_visual_story_surface" aria-labelledby="cig_visual_story_heading">
<h2 id="cig_visual_story_heading" tabindex="-1">Visual Story</h2>
<p>Keep the visual thread of this chat in one place. Opening this view makes no image or provider request.</p>
<div class="cig_visual_story_sections">
<section class="cig_visual_story_section" aria-labelledby="cig_visual_story_memory_heading"><h3 id="cig_visual_story_memory_heading">Visual Story Memory</h3><p>${escapeHtml(memoryCopy)}</p><button type="button" class="menu_button" data-cig-visual-story-action="open-memory">Open Story Memory</button></section>
<section class="cig_visual_story_section" aria-labelledby="cig_visual_story_continuity_heading"><h3 id="cig_visual_story_continuity_heading">Character continuity</h3><p>${escapeHtml(appearanceSummary)}</p><button type="button" class="menu_button" data-cig-visual-story-action="open-appearance">Open appearance controls</button></section>
<section class="cig_visual_story_section" aria-labelledby="cig_visual_story_cinematic_heading"><h3 id="cig_visual_story_cinematic_heading">Cinematic suggestions</h3><p><strong>${cinematicEnabled ? 'On' : 'Off'}</strong> · ${escapeHtml(cinematicCopy.replace(/^(On|Off) · /u, ''))}</p><button type="button" class="menu_button" data-cig-visual-story-action="configure-cinematic">${cinematicAction}</button></section>
</div>
</section>`;
}

export function focusVisualStorySurface({ documentLike = globalThis.document } = {}) {
    const surface = documentLike?.querySelector?.('#cig_visual_story_surface');
    if (!surface) return { status: 'unavailable' };
    surface.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const heading = surface.querySelector?.('h2') || surface;
    if (heading === surface) heading.setAttribute?.('tabindex', '-1');
    heading.focus?.({ preventScroll: true });
    return { status: 'focused' };
}

/** Reveal the existing host and extension drawers, then the chat-scoped overview. */
export function revealVisualStorySurface({ documentLike = globalThis.document, activateTab, tab = 'images-cast' } = {}) {
    if (!documentLike?.querySelector) return { status: 'unavailable' };
    const hostDrawer = documentLike.querySelector('#rm_extensions_block');
    const hostWasClosed = Boolean(hostDrawer && !isVisible(hostDrawer, documentLike));
    if (hostWasClosed) activate(documentLike.querySelector('#extensions-settings-button > .drawer-toggle'), documentLike);
    const extension = documentLike.querySelector('#cig_settings');
    const content = extension?.querySelector('.inline-drawer-content');
    const extensionWasClosed = Boolean(content && !isVisible(content, documentLike));
    if (extensionWasClosed) activate(extension.querySelector('.inline-drawer-toggle'), documentLike);
    activateTab?.(tab);
    const focused = focusVisualStorySurface({ documentLike });
    return { status: focused.status === 'focused' ? 'revealed' : 'unavailable', hostOpened: hostWasClosed, extensionOpened: extensionWasClosed };
}

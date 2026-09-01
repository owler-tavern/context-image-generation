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

/** Reveal the host and extension drawers before focusing a chat-scoped memory entry. */
export function revealStoryMemoryEntry({ documentLike = globalThis.document, activateTab, selectArtifact, messageId } = {}) {
    if (!documentLike?.querySelector) return { status: 'unavailable' };
    const hostDrawer = documentLike.querySelector('#rm_extensions_block');
    const hostWasClosed = Boolean(hostDrawer && !isVisible(hostDrawer, documentLike));
    if (hostWasClosed) {
        activate(documentLike.querySelector('#extensions-settings-button > .drawer-toggle'), documentLike);
    }
    const extension = documentLike.querySelector('#cig_settings');
    const content = extension?.querySelector('.inline-drawer-content');
    const extensionWasClosed = Boolean(content && !isVisible(content, documentLike));
    if (extensionWasClosed) {
        activate(extension.querySelector('.inline-drawer-toggle'), documentLike);
    }
    activateTab?.('images-cast');
    selectArtifact?.(messageId);
    const surface = documentLike.querySelector('#cig_story_memory_surface');
    surface?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const heading = surface?.querySelector?.('h2') || documentLike.querySelector('#cig_story_memory > h2');
    if (heading) {
        heading.setAttribute?.('tabindex', '-1');
        heading.focus?.({ preventScroll: true });
    }
    return { status: 'revealed', hostOpened: hostWasClosed, extensionOpened: extensionWasClosed };
}

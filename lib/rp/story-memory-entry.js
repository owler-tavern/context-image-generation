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

export async function selectStoryMemoryEntryWhenReady({ loadPromise, isCurrent = () => true, getTimeline = () => [], messageId, mediaUrl, selectArtifact, focusSelected } = {}) {
    let loaded;
    try {
        loaded = await loadPromise;
    } catch (error) {
        if (!isCurrent()) return { status: 'stale', reason: 'The chat changed before Story Memory finished loading.' };
        return { status: 'error', reason: error?.message || 'Story Memory could not be loaded.' };
    }
    if (!isCurrent()) return { status: 'stale', reason: 'The chat changed before this Story Memory entry could be selected.' };
    if (loaded?.stale || loaded?.status === 'error') return { status: 'unavailable', reason: 'Story Memory is not current yet. Please open it again in this chat.' };
    if (!mediaUrl) return { status: 'unavailable', reason: 'This image is not available as a Story Memory entry.' };
    const entry = (Array.isArray(getTimeline()) ? getTimeline() : []).find((item) => Number(item?.messageId) === Number(messageId) && String(item?.url ?? '') === String(mediaUrl ?? ''));
    if (!entry?.id) return { status: 'unavailable', reason: 'This image is not in Story Memory yet.' };
    selectArtifact?.(entry.id);
    focusSelected?.(entry);
    return { status: 'selected', artifactId: entry.id };
}

/** Focus the selected artifact's visible Details control after its state-driven render. */
export function focusStoryMemoryArtifact({ documentLike = globalThis.document, artifactId } = {}) {
    if (!documentLike?.querySelectorAll || !artifactId) return { status: 'unavailable' };
    const card = [...documentLike.querySelectorAll('#cig_story_memory_surface [data-story-artifact-id]')]
        .find((node) => node.getAttribute?.('data-story-artifact-id') === String(artifactId));
    if (!card) return { status: 'unavailable' };
    card.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const focusTarget = card.querySelector?.('[data-story-action="select-details"]') || card;
    focusTarget.setAttribute?.('tabindex', focusTarget === card ? '-1' : focusTarget.getAttribute?.('tabindex') || '0');
    focusTarget.focus?.({ preventScroll: true });
    return { status: 'focused', artifactId: String(artifactId) };
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

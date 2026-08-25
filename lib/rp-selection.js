export const MAX_FOCUS_TEXT_LENGTH = 600;

export function normalizeFocusText(text, { maxLength = MAX_FOCUS_TEXT_LENGTH } = {}) {
    const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim();
    if (!normalized || normalized.length > maxLength) return null;
    return normalized;
}

export function isEligibleMessageSelection({ selection, clickedMessageElement }) {
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return false;
    const messageTextElement = clickedMessageElement?.querySelector?.('.mes_text');
    if (!messageTextElement) return false;

    const range = selection.getRangeAt(0);
    const start = range?.startContainer;
    const end = range?.endContainer;
    if (!start || !end) return false;
    if (isHiddenOrAriaHidden(start, clickedMessageElement) || isHiddenOrAriaHidden(end, clickedMessageElement)) return false;
    if (!clickedMessageElement.contains(start) || !clickedMessageElement.contains(end)) return false;
    if (!messageTextElement.contains(start) || !messageTextElement.contains(end)) return false;
    return normalizeFocusText(selection.toString()) !== null;
}

function isHiddenOrAriaHidden(node, boundary) {
    let current = node;
    while (current) {
        if (current.hidden === true || current.getAttribute?.('aria-hidden') === 'true') return true;
        if (current === boundary) break;
        current = current.parentElement || current.parentNode || null;
    }
    return false;
}

export function buildFocusedMessageContent({ sourceMessage, focusText, sender, storyContext }) {
    const normalizedFocus = normalizeFocusText(focusText);
    if (!normalizedFocus) {
        return storyContext ?? (sender ? `[Message from ${sender}]: ${sourceMessage}` : sourceMessage);
    }

    const supportingContext = storyContext ?? (sender ? `[Message from ${sender}]: ${sourceMessage}` : sourceMessage);
    return `[Primary visual moment - focus on this selected passage]: ${normalizedFocus}\n\n[Supporting message context]: ${supportingContext}`;
}

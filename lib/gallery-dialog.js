function getFocusableElements(dialog) {
    if (!dialog?.querySelectorAll) return [];
    return [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.disabled && !element.hidden && element.isConnected !== false);
}

export function createAccessibleDialogController({ dialog, opener, onDismiss } = {}) {
    let dismissed = false;

    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        dialog?.removeEventListener?.('keydown', handleKeydown);
        onDismiss?.();
        if (opener?.isConnected !== false && typeof opener?.focus === 'function') opener.focus();
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(dialog);
        if (!focusable.length) return;
        const activeIndex = focusable.indexOf(dialog?.ownerDocument?.activeElement);
        const next = event.shiftKey
            ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
            : activeIndex === -1 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
        event.preventDefault();
        focusable[next].focus();
    }

    return {
        open() {
            dialog?.addEventListener?.('keydown', handleKeydown);
            getFocusableElements(dialog)[0]?.focus();
        },
        dismiss,
        handleKeydown,
    };
}

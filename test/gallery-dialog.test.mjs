import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessibleDialogController } from '../lib/gallery-dialog.js';

function event(key, { shiftKey = false } = {}) {
    return { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
}

function focusable(name, document) {
    return { name, disabled: false, hidden: false, isConnected: true, focusCount: 0, ownerDocument: document, focus() { this.focusCount++; document.activeElement = this; } };
}

test('accessible gallery dialog transfers focus, traps Tab, dismisses on Escape, and restores its opener', () => {
    const document = { activeElement: null };
    const close = focusable('close', document);
    const other = focusable('other', document);
    const opener = focusable('opener', document);
    const dialog = {
        ownerDocument: document,
        isConnected: true,
        listeners: new Map(),
        querySelectorAll() { return [close, other]; },
        addEventListener(type, handler) { this.listeners.set(type, handler); },
        removeEventListener(type) { this.listeners.delete(type); },
    };
    let dismissals = 0;
    const controller = createAccessibleDialogController({ dialog, opener, onDismiss: () => { dismissals++; } });

    controller.open();
    assert.equal(close.focusCount, 1, 'focus starts on the close control');

    other.focus();
    const tab = event('Tab');
    controller.handleKeydown(tab);
    assert.equal(tab.prevented, true);
    assert.equal(close.focusCount, 2, 'Tab wraps to the first control');

    const reverseTab = event('Tab', { shiftKey: true });
    controller.handleKeydown(reverseTab);
    assert.equal(reverseTab.prevented, true);
    assert.equal(other.focusCount, 2, 'Shift+Tab wraps to the final control');

    const escape = event('Escape');
    controller.handleKeydown(escape);
    assert.equal(escape.prevented, true);
    assert.equal(dismissals, 1);
    assert.equal(opener.focusCount, 1, 'Escape returns focus to the gallery opener');
    assert.equal(dialog.listeners.has('keydown'), false, 'dismissal removes the keyboard listener');
});

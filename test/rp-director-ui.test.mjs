import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorUiController, focusDirectorPanel, renderDirectorPanel, restoreDirectorTriggerFocus } from '../lib/rp/director-ui.js';

test('Director panel exposes story preview, framing, continuity, readiness, and accessible actions', () => {
    const html = renderDirectorPanel({ messageId: 3, moment: 'Ava enters the library.', inspection: ['Location: library.'], referenceSummary: 'Ava: description fallback ready.', framing: 'auto', continuity: 'balanced', visualDirection: '' });
    for (const text of ['Story moment', 'Framing', 'Continuity strength', 'Visual direction', 'description fallback ready', 'Generate directed image', 'Close Director']) assert.match(html, new RegExp(text));
    for (const value of ['auto', 'close-up', 'medium', 'wide', 'full-body', 'minimal', 'balanced', 'strong']) assert.match(html, new RegExp(`value="${value}"`));
    assert.match(html, /min-height:\s*44px/);
});

test('Director UI routes open/edit/close/generate actions explicitly', async () => {
    const calls = [];
    const controller = createDirectorUiController({ open: (id) => calls.push(['open', id]), update: (values) => calls.push(['update', values]), close: () => calls.push(['close']), generate: () => calls.push(['generate']) });
    await controller.action('open', { messageId: 2 });
    await controller.action('update', { framing: 'wide' });
    await controller.action('close');
    await controller.action('generate');
    assert.deepEqual(calls, [['open', { messageId: 2 }], ['update', { framing: 'wide' }], ['close'], ['generate']]);
});

test('Director restored stale panel shows recovery explanation and disables Generate', () => {
    const html = renderDirectorPanel({
        messageId: 8,
        status: 'stale',
        previewError: 'This message is no longer current. Reopen Director to choose it again.',
        moment: 'A stale scene preview.',
    });
    assert.match(html, /This message is no longer current\. Reopen Director to choose it again\./);
    assert.match(html, /data-director-action="generate"[^>]* disabled/);
});

test('Director disclosure focus enters framing first and restores the exact connected opener', () => {
    const calls = [];
    const framing = { focus(options) { calls.push(['framing', options]); } };
    const panel = {
        querySelector(selector) {
            assert.equal(selector, '[data-director-field="framing"]');
            return framing;
        },
    };
    const documentLike = {
        querySelector(selector) {
            assert.equal(selector, '.cig_director_panel[data-message-id="7"]');
            return panel;
        },
    };
    const entered = focusDirectorPanel({ documentLike, messageId: 7 });
    assert.equal(entered.status, 'focused');
    assert.deepEqual(calls, [['framing', { preventScroll: true }]]);

    const opener = { isConnected: true, disabled: false, focus(options) { calls.push(['opener', options]); } };
    const restored = restoreDirectorTriggerFocus({ trigger: opener, isCurrent: () => true });
    assert.equal(restored.status, 'restored');
    assert.deepEqual(calls.at(-1), ['opener', { preventScroll: true }]);
});

test('Director focus restoration fails closed for stale or disconnected cross-chat openers', () => {
    const calls = [];
    const opener = { isConnected: true, focus() { calls.push('focused'); } };
    assert.equal(restoreDirectorTriggerFocus({ trigger: opener, isCurrent: () => false }).status, 'not-restored');
    opener.isConnected = false;
    assert.equal(restoreDirectorTriggerFocus({ trigger: opener }).status, 'not-restored');
    assert.deepEqual(calls, []);
});

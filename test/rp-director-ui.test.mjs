import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorUiController, renderDirectorPanel } from '../lib/rp/director-ui.js';

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

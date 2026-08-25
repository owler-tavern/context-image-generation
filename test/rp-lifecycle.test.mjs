import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatLifecycleEpoch } from '../lib/rp-lifecycle.js';
import * as lifecycleModule from '../lib/rp-lifecycle.js';

test('epoch changes invalidate a save even when the user switches away and back', () => {
    const lifecycle = createChatLifecycleEpoch();
    const captured = lifecycle.capture();
    lifecycle.advance();
    lifecycle.advance();
    assert.equal(lifecycle.isCurrent(captured), false);
    assert.equal(lifecycle.isCurrent(lifecycle.capture()), true);
});

test('binds Appearance memory refresh to both chat replacement and creation', () => {
    assert.equal(typeof lifecycleModule.bindAppearanceRerenderOnChatLifecycle, 'function');
    const handlers = new Map();
    const eventSource = { on(type, handler) { handlers.set(type, handler); } };
    const eventTypes = { CHAT_CHANGED: 'chat-changed', CHAT_CREATED: 'chat-created' };
    let refreshes = 0;

    lifecycleModule.bindAppearanceRerenderOnChatLifecycle(eventSource, eventTypes, () => { refreshes++; });
    handlers.get('chat-changed')();
    handlers.get('chat-created')();

    assert.equal(refreshes, 2);
});

test('settings runtime delegates Appearance rerendering to the chat lifecycle binder', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /import \{[^}]*bindAppearanceRerenderOnChatLifecycle[^}]*createChatLifecycleEpoch[^}]*\} from '\.\/lib\/rp-lifecycle\.js';/);
    assert.match(index, /bindAppearanceRerenderOnChatLifecycle\(eventSource, event_types, renderAppearanceList\)/);
});

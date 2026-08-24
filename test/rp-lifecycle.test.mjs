import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatLifecycleEpoch } from '../lib/rp-lifecycle.js';

test('epoch changes invalidate a save even when the user switches away and back', () => {
    const lifecycle = createChatLifecycleEpoch();
    const captured = lifecycle.capture();
    lifecycle.advance();
    lifecycle.advance();
    assert.equal(lifecycle.isCurrent(captured), false);
    assert.equal(lifecycle.isCurrent(lifecycle.capture()), true);
});

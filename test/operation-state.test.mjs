import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationState } from '../lib/operation-state.js';

test('new operations supersede stale results without needing a second UI state', () => {
    const state = createOperationState();
    const first = state.begin();
    const second = state.begin();
    assert.equal(state.isCurrent(first), false);
    assert.equal(state.isCurrent(second), true);
    state.finish(first);
    assert.equal(state.isCurrent(second), true);
    state.finish(second);
    assert.equal(state.isCurrent(second), false);
});

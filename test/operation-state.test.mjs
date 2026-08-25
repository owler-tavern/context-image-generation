import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationState } from '../lib/operation-state.js';

test('duplicate operations are rejected while the current operation is active', () => {
    const state = createOperationState();
    const first = state.begin();
    const second = state.begin();
    assert.equal(typeof first, 'number');
    assert.equal(second, null);
    assert.equal(state.isCurrent(first), true);
    state.finish(first);
    const next = state.begin();
    assert.notEqual(next, first);
    assert.equal(state.isCurrent(next), true);
    state.finish(next);
    assert.equal(state.isCurrent(next), false);
});

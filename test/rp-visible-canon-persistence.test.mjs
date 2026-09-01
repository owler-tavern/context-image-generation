import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyVisibleCanonPendingResult,
    createVisibleCanonPendingState,
    queueVisibleCanonPending,
    resumeVisibleCanonPending,
} from '../lib/rp/visible-canon-persistence.js';

const pendingLink = {
    artifactId: 'message:4:url:/sam.png',
    chatId: 'chat-a',
    messageId: 4,
    mediaUrl: '/sam.png',
    identityId: 'user:persona.png',
    lookId: 'look:sam',
    epoch: 2,
};

test('pending visible canon links survive indeterminate results and confirmed-absent read-back', () => {
    let state = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'indeterminate' });
    assert.deepEqual(state.pending[pendingLink.artifactId], pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'confirmed-absent' });
    assert.deepEqual(state.pending[pendingLink.artifactId], pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'confirmed' });
    assert.equal(state.pending[pendingLink.artifactId], undefined);
});

test('pending visible canon links resume after reload and retain repeated indeterminate work', async () => {
    const reloaded = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    const calls = [];
    const result = await resumeVisibleCanonPending(reloaded, async (link) => {
        calls.push(link.artifactId);
        return { status: calls.length < 3 ? 'indeterminate' : 'confirmed' };
    });
    assert.deepEqual(calls, [pendingLink.artifactId]);
    assert.deepEqual(result.state.pending[pendingLink.artifactId], pendingLink);
    assert.equal(result.status, 'indeterminate');
    const retried = await resumeVisibleCanonPending(result.state, async () => ({ status: 'indeterminate' }));
    assert.deepEqual(retried.state.pending[pendingLink.artifactId], pendingLink);
});

test('stale pending media replacement cannot overwrite a newer artifact target', async () => {
    const newer = { ...pendingLink, mediaUrl: '/new.png', artifactId: 'message:4:url:/new.png', epoch: 3 };
    const state = queueVisibleCanonPending(queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink), newer);
    const result = await resumeVisibleCanonPending(state, async (link) => ({ status: link.epoch === 2 ? 'confirmed' : 'indeterminate' }));
    assert.equal(result.state.pending[pendingLink.artifactId], undefined);
    assert.deepEqual(result.state.pending[newer.artifactId], newer);
});

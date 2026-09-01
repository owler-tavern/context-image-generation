import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyVisibleCanonPendingResult,
    createVisibleCanonPendingState,
    finalizeVisibleCanonPendingReplay,
    queueVisibleCanonPending,
    reconcileVisibleCanonPendingLink,
    resumeVisibleCanonPending,
    splitVisibleCanonPendingByChat,
    visibleCanonPendingKey,
} from '../lib/rp/visible-canon-persistence.js';

const pendingLink = {
    artifactId: 'message:4:url:/sam.png',
    chatId: 'chat-a',
    messageId: 4,
    mediaUrl: '/sam.png',
    identityId: 'user:persona.png',
    lookId: 'look:sam',
    epoch: 2,
    expectedFingerprint: 'canon-v1-abc',
    candidate: { schema: 1, revision: 'chat-canon:next', bindings: { 'user:persona.png': { activeLookId: 'look:sam', expectedAssetId: 'asset:sam', isLocked: false, selectedAt: 3 } } },
};

test('pending visible canon links survive indeterminate results and confirmed-absent read-back', () => {
    let state = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    const key = visibleCanonPendingKey(pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'indeterminate' });
    assert.deepEqual(state.pending[key], pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'confirmed-absent' });
    assert.deepEqual(state.pending[key], pendingLink);
    state = applyVisibleCanonPendingResult(state, pendingLink.artifactId, { status: 'confirmed' });
    assert.deepEqual(state.pending[key], pendingLink);
    state = applyVisibleCanonPendingResult(state, key, { status: 'confirmed' });
    assert.equal(state.pending[key], undefined);
});

test('pending visible canon links resume after reload and retain repeated indeterminate work', async () => {
    const reloaded = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    const calls = [];
    const result = await resumeVisibleCanonPending(reloaded, async (link) => {
        calls.push(link.artifactId);
        return { status: calls.length < 3 ? 'indeterminate' : 'confirmed' };
    });
    assert.deepEqual(calls, [pendingLink.artifactId]);
    assert.deepEqual(result.state.pending[visibleCanonPendingKey(pendingLink)], pendingLink);
    assert.equal(result.status, 'indeterminate');
    const retried = await resumeVisibleCanonPending(result.state, async () => ({ status: 'indeterminate' }));
    assert.deepEqual(retried.state.pending[visibleCanonPendingKey(pendingLink)], pendingLink);
});

test('stale pending media replacement cannot overwrite a newer artifact target', async () => {
    const newer = { ...pendingLink, mediaUrl: '/new.png', artifactId: 'message:4:url:/new.png', epoch: 3 };
    const state = queueVisibleCanonPending(queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink), newer);
    const result = await resumeVisibleCanonPending(state, async (link) => ({ status: link.epoch === 2 ? 'confirmed' : 'indeterminate' }));
    assert.equal(result.state.pending[visibleCanonPendingKey(pendingLink)], undefined);
    assert.deepEqual(result.state.pending[visibleCanonPendingKey(newer)], newer);
});

test('pending reconciliation retries a failed full-chat save without trimming later messages, then verifies read-back', async () => {
    const chat = [{ mes: 'image', extra: { media: [] } }, { mes: 'later message' }];
    let persisted;
    let attempts = 0;
    const save = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        persisted = structuredClone(chat);
    };
    const verify = async () => ({ status: persisted?.length === 2 ? 'confirmed' : 'confirmed-absent' });
    const first = await reconcileVisibleCanonPendingLink(pendingLink, { save, verify });
    assert.equal(first.status, 'indeterminate');
    const second = await reconcileVisibleCanonPendingLink(pendingLink, { save, verify });
    assert.equal(second.status, 'confirmed');
    assert.equal(persisted.length, 2);
});

test('pending reconciliation rejects a stale media target before or after save', async () => {
    let saves = 0;
    const stale = await reconcileVisibleCanonPendingLink(pendingLink, { isCurrent: () => false, save: async () => { saves++; }, verify: async () => ({ status: 'confirmed' }) });
    assert.equal(stale.status, 'stale');
    assert.equal(saves, 0);
    let current = true;
    const switched = await reconcileVisibleCanonPendingLink(pendingLink, { isCurrent: () => current, save: async () => { current = false; }, verify: async () => ({ status: 'confirmed' }) });
    assert.equal(switched.status, 'stale');
});

test('pending operation retains the complete candidate canon needed for reload replay', () => {
    const state = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    assert.deepEqual(state.pending[visibleCanonPendingKey(pendingLink)].candidate, pendingLink.candidate);
    assert.equal(state.pending[visibleCanonPendingKey(pendingLink)].expectedFingerprint, pendingLink.expectedFingerprint);
});

test('reload replay retries repeated save failures and verifies the exact candidate binding', async () => {
    const initial = queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink);
    let attempts = 0;
    let persisted = null;
    const reconcile = async (link) => reconcileVisibleCanonPendingLink(link, {
        save: async (candidate) => {
            attempts++;
            if (attempts < 3) throw new Error('offline');
            persisted = candidate;
        },
        verify: async (candidate) => ({ status: persisted?.candidate?.revision === candidate.candidate.revision ? 'confirmed' : 'confirmed-absent' }),
    });
    const first = await resumeVisibleCanonPending(initial, reconcile);
    assert.equal(first.status, 'indeterminate');
    const second = await resumeVisibleCanonPending(first.state, reconcile);
    assert.equal(second.status, 'indeterminate');
    const third = await resumeVisibleCanonPending(second.state, reconcile);
    assert.equal(third.status, 'confirmed');
    assert.equal(third.state.pending[visibleCanonPendingKey(pendingLink)], undefined);
});

test('composite pending keys isolate the same artifact across chats', () => {
    const otherChat = { ...pendingLink, chatId: 'chat-b' };
    const state = queueVisibleCanonPending(queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink), otherChat);
    assert.equal(Object.keys(state.pending).length, 2);
    assert.deepEqual(state.pending[visibleCanonPendingKey(pendingLink)], pendingLink);
    assert.deepEqual(state.pending[visibleCanonPendingKey(otherChat)], otherChat);
});

test('active-chat split keeps foreign recovery global and out of local replay', () => {
    const foreign = { ...pendingLink, chatId: 'chat-b' };
    const state = queueVisibleCanonPending(queueVisibleCanonPending(createVisibleCanonPendingState(), pendingLink), foreign);
    const split = splitVisibleCanonPendingByChat(state, 'chat-a');
    assert.deepEqual(Object.keys(split.active), [visibleCanonPendingKey(pendingLink)]);
    assert.deepEqual(Object.keys(split.foreign), [visibleCanonPendingKey(foreign)]);
});

test('global-only replay cleanup keeps the candidate binding and clears pending once', () => {
    const candidate = { schema: 1, revision: 'chat-canon:next', bindings: { npc: { activeLookId: 'look:npc' } } };
    const pending = queueVisibleCanonPending(createVisibleCanonPendingState(), { ...pendingLink, candidate });
    const replayed = { ...candidate, visibleCanonPending: pending.pending };
    const finalized = finalizeVisibleCanonPendingReplay({ currentCanon: { schema: 1, revision: 'old', bindings: {} }, replayedCanon: replayed, activePending: {} });
    assert.equal(finalized.revision, candidate.revision);
    assert.deepEqual(finalized.bindings, candidate.bindings);
    assert.deepEqual(finalized.visibleCanonPending, {});
});

test('chat-local replay cleanup does not fall back to the pre-replay canon', () => {
    const candidate = { schema: 1, revision: 'chat-canon:local', bindings: { persona: { activeLookId: 'look:local' } } };
    const finalized = finalizeVisibleCanonPendingReplay({
        currentCanon: { schema: 1, revision: 'chat-canon:old', bindings: { persona: { activeLookId: 'look:old' } } },
        replayedCanon: { ...candidate, visibleCanonPending: { local: pendingLink } },
        activePending: {},
    });
    assert.equal(finalized.revision, candidate.revision);
    assert.equal(finalized.bindings.persona.activeLookId, 'look:local');
    assert.deepEqual(finalized.visibleCanonPending, {});
});

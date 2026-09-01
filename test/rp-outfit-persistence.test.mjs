import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createOutfitPendingState,
    queueOutfitPending,
    splitOutfitPendingByChat,
    persistTargetedOutfitMutation,
    resumeOutfitPending,
} from '../lib/rp/outfit-persistence.js';

test('outfit pending state is durable and split by captured chat target', () => {
    const pending = queueOutfitPending(createOutfitPendingState(), {
        chatId: 'chat-a', identityId: 'character:ava', revision: 'outfit:1', state: { identities: {} },
    });
    const split = splitOutfitPendingByChat(pending, 'chat-b');
    assert.equal(Object.keys(split.active).length, 0);
    assert.equal(Object.keys(split.foreign).length, 1);
    assert.equal(Object.values(split.foreign)[0].chatId, 'chat-a');
});

test('targeted outfit save never starts after switch and marks an in-flight switch stale', async () => {
    let current = { chatId: 'chat-a', epoch: 1 };
    let saves = 0;
    let verifies = 0;
    const captured = { chatId: 'chat-a', epoch: 1 };
    const isCurrent = (target) => target.chatId === current.chatId && target.epoch === current.epoch;
    current = { chatId: 'chat-b', epoch: 2 };
    const skipped = await persistTargetedOutfitMutation({ captured, isCurrent, save: async () => { saves += 1; }, verify: async () => ({ status: 'confirmed' }) });
    assert.equal(skipped.status, 'stale');
    assert.equal(saves, 0);

    current = { chatId: 'chat-a', epoch: 1 };
    const inFlight = persistTargetedOutfitMutation({
        captured,
        isCurrent,
        save: async (target) => { assert.equal(target.chatId, 'chat-a'); saves += 1; current = { chatId: 'chat-b', epoch: 2 }; },
        verify: async () => { verifies += 1; return { status: 'confirmed' }; },
    });
    const result = await inFlight;
    assert.equal(result.status, 'stale');
    assert.equal(saves, 1);
    assert.equal(verifies, 0);
});

test('indeterminate outfit pending resumes against its original target and clears only after confirmation', async () => {
    const pending = queueOutfitPending(createOutfitPendingState(), {
        chatId: 'chat-a', identityId: 'character:ava', revision: 'outfit:2', state: { identities: {} },
    });
    let attempts = 0;
    const resumed = await resumeOutfitPending(pending, async (entry) => {
        attempts += 1;
        return attempts === 1 ? { status: 'indeterminate' } : { status: 'confirmed' };
    }, { chatId: 'chat-a' });
    assert.equal(resumed.status, 'indeterminate');
    assert.equal(Object.keys(resumed.state.pending).length, 1);
    const confirmed = await resumeOutfitPending(resumed.state, async () => ({ status: 'confirmed' }), { chatId: 'chat-a' });
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(Object.keys(confirmed.state.pending).length, 0);
});

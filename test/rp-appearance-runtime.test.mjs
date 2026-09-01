import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCanonAction, CANON_OUTCOMES } from '../lib/rp/appearance-runtime.js';

test('production canon action orders target check, candidate build, persistence, and exact Remember outcome', async () => {
    const events = [];
    const result = await executeCanonAction({ action: 'remember', captured: { id: 'chat-a' }, baselineFingerprint: 'a1', isCurrent: () => { events.push('target'); return true; }, getFingerprint: () => 'a1', buildCandidate: () => { events.push('candidate'); return { revision: 'r2' }; }, persist: async () => { events.push('persist'); return { status: 'confirmed' }; } });
    assert.deepEqual(events, ['target', 'candidate', 'persist']);
    assert.equal(result.message, 'Saved and active in this chat.');
});

test('Use Lock and Unlock expose exact verified, absent, indeterminate, and stale outcomes', async () => {
    for (const action of ['use', 'lock', 'unlock']) {
        for (const status of ['confirmed', 'confirmed-absent', 'indeterminate']) {
            const result = await executeCanonAction({ action, captured: {}, baselineFingerprint: 'same', isCurrent: () => true, getFingerprint: () => 'same', buildCandidate: () => ({ revision: 'next' }), persist: async () => ({ status }) });
            assert.equal(result.status, status);
            assert.equal(result.message, CANON_OUTCOMES[action][status]);
        }
        const switched = await executeCanonAction({ action, captured: {}, baselineFingerprint: 'same', isCurrent: () => false, getFingerprint: () => 'same', buildCandidate: () => { throw new Error('must not build'); }, persist: async () => { throw new Error('must not persist'); } });
        assert.equal(switched.status, 'stale');
        const raced = await executeCanonAction({ action, captured: {}, baselineFingerprint: 'old', isCurrent: () => true, getFingerprint: () => 'new', buildCandidate: () => { throw new Error('must not build'); }, persist: async () => { throw new Error('must not persist'); } });
        assert.equal(raced.status, 'stale');
    }
});

test('canon orchestration never invokes an image provider tripwire', async () => {
    let providerCalls = 0;
    const providerRequest = () => { providerCalls++; throw new Error('provider request forbidden'); };
    await executeCanonAction({ action: 'use', captured: {}, baselineFingerprint: 'x', isCurrent: () => true, getFingerprint: () => 'x', buildCandidate: () => ({ revision: 'y' }), persist: async () => ({ status: 'confirmed' }), providerRequest });
    assert.equal(providerCalls, 0);
});

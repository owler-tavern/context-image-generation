import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppearanceFeatureController, executeCanonAction, CANON_OUTCOMES } from '../lib/rp/appearance-runtime.js';

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

test('production feature controller persists the appearance before chat metadata and blocks provider endpoints', async () => {
    const events = [];
    const allowed = new Set(['/api/settings/save', '/api/settings/get', '/api/chats/save', '/api/chats/get', '/api/images/upload']);
    const request = async (path) => { if (!allowed.has(path)) throw new Error(`provider request forbidden: ${path}`); events.push(path); };
    const controller = createAppearanceFeatureController({
        isCurrent: () => true, getFingerprint: () => 'base',
        promoteLook: async () => { await request('/api/images/upload'); return { look: { id: 'look' } }; },
        persistLibrary: async () => { await request('/api/settings/save'); await request('/api/settings/get'); return { status: 'confirmed' }; },
        persistChat: async () => { await request('/api/chats/save'); await request('/api/chats/get'); return { status: 'confirmed' }; },
    });
    const result = await controller.remember({ captured: {}, identityId: 'character', baselineFingerprint: 'base', buildCandidate: () => ({ revision: 'chat-r2' }) });
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(events, ['/api/images/upload', '/api/settings/save', '/api/settings/get', '/api/chats/save', '/api/chats/get']);
    await assert.rejects(request('/api/backends/chat-completions/generate'), /provider request forbidden/);
});

test('production feature controller stops Remember across lifecycle and revision races', async () => {
    let current = true;
    let fingerprint = 'base';
    let chatWrites = 0;
    const controller = createAppearanceFeatureController({ isCurrent: () => current, getFingerprint: () => fingerprint, promoteLook: async () => { current = false; return {}; }, persistLibrary: async () => { throw new Error('must not save'); }, persistChat: async () => { chatWrites++; return { status: 'confirmed' }; } });
    assert.equal((await controller.remember({ captured: {}, identityId: 'x', baselineFingerprint: 'base', buildCandidate: () => ({}) })).status, 'stale');
    current = true;
    const use = createAppearanceFeatureController({ isCurrent: () => true, getFingerprint: () => 'new', persistChat: async () => { chatWrites++; }, promoteLook: async () => {}, persistLibrary: async () => ({}) });
    assert.equal((await use.use({ captured: {}, identityId: 'x', baselineFingerprint: 'old', buildCandidate: () => ({}) })).status, 'stale');
    assert.equal(chatWrites, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppearanceFeatureController, executeCanonAction, CANON_OUTCOMES, runRememberAppearance } from '../lib/rp/appearance-runtime.js';

function rememberFixture(overrides = {}) {
    const events = [];
    let current = true;
    const request = async (path) => {
        const allowed = ['/api/images/upload', '/api/images/delete', '/api/settings/save', '/api/settings/get', '/api/chats/save', '/api/chats/get'];
        if (!allowed.includes(path)) throw new Error(`provider request forbidden: ${path}`);
        events.push(path);
    };
    const uuids = ['123e4567-e89b-42d3-a456-426614174000', '223e4567-e89b-42d3-a456-426614174000', '323e4567-e89b-42d3-a456-426614174000', '423e4567-e89b-42d3-a456-426614174000', '523e4567-e89b-42d3-a456-426614174000'];
    let uuidIndex = 0;
    let currentLibrary = { schema: 2, revision: 'r0', identities: {}, assets: {}, operations: {} };
    const io = {
        isCurrent: () => current,
        readLibrary: async () => ({ status: 'confirmed', library: currentLibrary }),
        readDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=',
        saveBase64: async (_data, _folder, filename, extension) => { await request('/api/images/upload'); return `/user/images/context-image-generation-appearances/${filename}.${extension}`; },
        saveLibrary: async (library) => { await request('/api/settings/save'); currentLibrary = library; },
        verifyLibrary: async () => { await request('/api/settings/get'); return { status: 'confirmed' }; },
        deleteAppearanceFile: async () => { await request('/api/images/delete'); },
        persistOrphanCleanup: async () => {},
        scheduleLibraryReconciliation: () => events.push('schedule-library'),
        getChatCanon: () => ({ schema: 1, bindings: {} }),
        persistChat: async () => { await request('/api/chats/save'); await request('/api/chats/get'); return { status: 'confirmed' }; },
        uuid: () => uuids[uuidIndex++],
        now: () => 10,
        ...overrides,
    };
    return { io, events, setCurrent: (value) => { current = value; }, request };
}

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

test('runRememberAppearance owns the real upload, settings, and chat sequence without a provider request', async () => {
    const fixture = rememberFixture();
    const result = await runRememberAppearance({ captured: { chatId: 'chat-a', epoch: 1 }, identity: { id: 'character:a' }, label: 'A', item: { id: 'gallery:a' }, io: fixture.io });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.message, 'Saved and active in this chat.');
    assert.deepEqual(fixture.events, ['/api/images/upload', '/api/settings/save', '/api/settings/get', '/api/settings/save', '/api/settings/get', '/api/chats/save', '/api/chats/get']);
    await assert.rejects(fixture.request('/api/backends/chat-completions/generate'), /provider request forbidden/);
});

test('runRememberAppearance distinguishes absent and indeterminate settings verification', async () => {
    const absent = rememberFixture({ verifyLibrary: async () => ({ status: 'confirmed-absent' }) });
    assert.equal((await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: absent.io })).status, 'confirmed-absent');
    assert.deepEqual(absent.events, ['/api/images/upload', '/api/settings/save', '/api/images/delete']);

    const uncertain = rememberFixture({ verifyLibrary: async () => ({ status: 'indeterminate' }) });
    assert.equal((await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: uncertain.io })).status, 'indeterminate');
    assert.deepEqual(uncertain.events, ['/api/images/upload', '/api/settings/save', 'schedule-library']);
});

test('runRememberAppearance returns exact chat read-back outcomes', async () => {
    for (const status of ['confirmed-absent', 'indeterminate']) {
        const fixture = rememberFixture({ persistChat: async () => ({ status }) });
        const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: fixture.io });
        assert.equal(result.status, status);
        assert.equal(result.message, status === 'confirmed-absent' ? 'Saved to the appearance library, but it was not activated in this chat.' : 'Saved look verification pending. It will be reconciled before use.');
    }
});

test('runRememberAppearance treats thrown post-upload persistence as indeterminate and schedules recovery', async () => {
    const fixture = rememberFixture({ saveLibrary: async () => { throw new Error('host save swallowed/failed'); } });
    const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: fixture.io });
    assert.equal(result.status, 'indeterminate');
    assert.deepEqual(fixture.events, ['/api/images/upload', 'schedule-library']);
});

test('runRememberAppearance schedules recovery when confirmed-absent cleanup throws', async () => {
    const fixture = rememberFixture({ verifyLibrary: async () => ({ status: 'confirmed-absent' }), deleteAppearanceFile: async () => { throw new Error('delete failed'); }, persistOrphanCleanup: async () => { throw new Error('recovery save failed'); } });
    const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: fixture.io });
    assert.equal(result.status, 'confirmed-absent');
    assert.deepEqual(fixture.events.slice(-1), ['schedule-library']);
});

test('runRememberAppearance saves a locked replacement as an alternate without a chat write', async () => {
    const fixture = rememberFixture({ getChatCanon: () => ({ schema: 1, bindings: { x: { activeLookId: 'look:locked', expectedAssetId: 'asset:locked', isLocked: true, selectedAt: 1 } } }), persistChat: async () => { throw new Error('must not bind'); } });
    const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: fixture.io });
    assert.equal(result.status, 'alternate');
    assert.equal(result.message, 'Saved as an alternate; your locked look was not changed.');
});

test('runRememberAppearance revalidates the captured chat after every awaited stage', async () => {
    for (const [stage, occurrence] of [['readLibrary', 1], ['readDataUrl', 1], ['saveBase64', 1], ['saveLibrary', 1], ['verifyLibrary', 1], ['saveLibrary', 2], ['verifyLibrary', 2], ['persistChat', 1]]) {
        let calls = 0;
        const base = rememberFixture();
        const original = base.io[stage];
        base.io[stage] = async (...args) => { const value = await original(...args); calls++; if (calls === occurrence) base.setCurrent(false); return value; };
        const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: base.io });
        assert.equal(result.status, 'stale', `${stage} ${occurrence}`);
        assert.match(result.message, /chat changed/, `${stage} ${occurrence}`);
    }
});

test('runRememberAppearance preserves dedupe and recovery callbacks from the production pipeline', async () => {
    const existingUuid = '123e4567-e89b-42d3-a456-426614174000';
    const existing = { schema: 2, revision: 'r0', assets: { [`asset:${existingUuid}`]: { id: `asset:${existingUuid}`, kind: 'appearance', url: `/user/images/context-image-generation-appearances/cig-appearance-${existingUuid}.png`, mimeType: 'image/png', byteCount: 8 } }, identities: { x: { id: 'x', label: 'X', looks: [{ id: `look:${existingUuid}`, assetId: `asset:${existingUuid}`, source: { identityId: 'x', galleryArtifactId: 'gallery:a' } }] } }, operations: {} };
    let saves = 0;
    const fixture = rememberFixture({ readLibrary: async () => ({ status: 'confirmed', library: existing }), readDataUrl: async () => { throw new Error('dedupe must not read'); }, saveBase64: async () => { throw new Error('dedupe must not upload'); }, saveLibrary: async () => { saves++; }, verifyLibrary: async () => saves === 1 ? { status: 'confirmed' } : { status: 'indeterminate' } });
    const result = await runRememberAppearance({ captured: {}, identity: { id: 'x' }, item: { id: 'gallery:a' }, io: fixture.io });
    assert.equal(result.status, 'indeterminate');
    assert.equal(result.promoted.deduplicated, true);
    assert.equal(saves, 3);
    assert.deepEqual(fixture.events.slice(-1), ['schedule-library']);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveCanonReferenceSnapshot,
    resolveEffectiveLook,
} from '../lib/rp/canon-reference-resolver.js';

const library = {
    schema: 2,
    identities: {
        'character:ava.png': {
            id: 'character:ava.png', kind: 'character', label: 'Ava', aliases: ['ava'], activeLookId: 'look:legacy',
            looks: [
                { id: 'look:legacy', assetId: 'asset:legacy', label: 'Legacy' },
                { id: 'look:one', assetId: 'asset:one', label: 'Look one' },
                { id: 'look:two', assetId: 'asset:two', label: 'Look two' },
            ],
        },
    },
    assets: {
        'asset:legacy': { id: 'asset:legacy', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-11111111-1111-4111-8111-111111111111.png', mimeType: 'image/png' },
        'asset:one': { id: 'asset:one', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-22222222-2222-4222-8222-222222222222.png', mimeType: 'image/png' },
        'asset:two': { id: 'asset:two', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-33333333-3333-4333-8333-333333333333.png', mimeType: 'image/png' },
    },
};

const identity = { id: 'character:ava.png', kind: 'character', label: 'Ava', aliases: ['ava'] };
const bind = (look, asset) => ({ schema: 1, bindings: { [identity.id]: { activeLookId: look, expectedAssetId: asset, isLocked: true, selectedAt: 1 } } });

test('two chats resolve different exact looks for the same character and switching back restores the first', () => {
    const chatA = resolveCanonReferenceSnapshot({ library, chatState: bind('look:one', 'asset:one'), identities: [identity] });
    const chatB = resolveCanonReferenceSnapshot({ library, chatState: bind('look:two', 'asset:two'), identities: [identity] });
    const chatAReturned = resolveCanonReferenceSnapshot({ library, chatState: bind('look:one', 'asset:one'), identities: [identity] });
    assert.deepEqual(chatA.references.map(({ id, assetId }) => [id, assetId]), [['look:one', 'asset:one']]);
    assert.deepEqual(chatB.references.map(({ id, assetId }) => [id, assetId]), [['look:two', 'asset:two']]);
    assert.deepEqual(chatAReturned, chatA);
    assert.equal(chatA.assets['asset:one'].url, library.assets['asset:one'].url);
    assert.equal(chatB.assets['asset:two'].url, library.assets['asset:two'].url);
});

test('a chat without an explicit binding inherits only the frozen legacy default', () => {
    const result = resolveEffectiveLook({ library, chatState: {}, identityId: identity.id });
    assert.equal(result.status, 'resolved');
    assert.equal(result.source, 'legacy-default');
    assert.equal(result.look.id, 'look:legacy');
});

test('broken explicit bindings never substitute the valid legacy look', () => {
    for (const [state, reason] of [
        [bind('look:missing', 'asset:one'), 'missing-look'],
        [bind('look:one', 'asset:two'), 'asset-mismatch'],
        [bind('look:one', 'asset:missing'), 'asset-mismatch'],
    ]) {
        const result = resolveCanonReferenceSnapshot({ library, chatState: state, identities: [identity] });
        assert.deepEqual(result.references, []);
        assert.equal(result.omissions[0].reason, reason);
        assert.equal(result.omissions[0].identityId, identity.id);
    }
});

test('pending and deleting assets are unavailable and produce one deterministic omission', () => {
    for (const status of ['pending', 'deleting']) {
        const guarded = { ...library, operations: { operation: { status, assetId: 'asset:one' } } };
        const result = resolveCanonReferenceSnapshot({ library: guarded, chatState: bind('look:one', 'asset:one'), identities: [identity] });
        assert.deepEqual(result.references, []);
        assert.deepEqual(result.omissions, [{ identityId: identity.id, lookId: 'look:one', assetId: 'asset:one', reason: status === 'pending' ? 'pending-operation' : 'deleting' }]);
    }
});

test('snapshot contains no duplicate identity/look candidates and is deeply immutable', () => {
    const result = resolveCanonReferenceSnapshot({ library, chatState: bind('look:one', 'asset:one'), identities: [identity, identity] });
    assert.equal(result.references.length, 1);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.references), true);
    assert.equal(Object.isFrozen(result.assets['asset:one']), true);
    assert.throws(() => { result.references[0].id = 'changed'; }, TypeError);
});

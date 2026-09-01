import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStoryState } from '../lib/rp/story-state.js';

test('reconciles scene facts while preserving durable identity facts', () => {
    const prior = {
        schema: 1,
        durableIdentityFacts: {
            'character:ava': ['Ava is left-handed.'],
        },
        sceneFacts: {
            location: 'station',
            outfits: [{ identityId: 'character:ava', value: 'red coat' }],
            objects: [{ value: 'map', holderIdentityId: 'character:ava' }],
            injuries: [{ identityId: 'character:ava', value: 'cut on hand' }],
        },
    };

    const result = reconcileStoryState(prior, {
        location: { value: 'library' },
        cast: [{ identityId: 'character:ava' }],
        outfits: [{ identityId: 'character:ava', value: 'wet blue coat' }],
        objects: [{ value: 'silver lantern', holderIdentityId: 'character:ava' }],
        injuries: [],
    });

    assert.deepEqual(result.nextState.durableIdentityFacts, prior.durableIdentityFacts);
    assert.equal(result.nextState.sceneFacts.location, 'library');
    assert.deepEqual(result.nextState.sceneFacts.outfits, [{ identityId: 'character:ava', value: 'wet blue coat' }]);
    assert.deepEqual(result.removedSceneFacts, {
        location: 'station',
        outfits: [{ identityId: 'character:ava', value: 'red coat' }],
        objects: [{ value: 'map', holderIdentityId: 'character:ava' }],
        injuries: [{ identityId: 'character:ava', value: 'cut on hand' }],
    });
    assert.deepEqual(result.updatedSceneFacts, {
        location: { from: 'station', to: 'library' },
        outfits: [{ identityId: 'character:ava', from: 'red coat', to: 'wet blue coat' }],
    });
});

test('does not erase durable facts when the new scene has unknown or partial facts', () => {
    const prior = {
        schema: 1,
        durableIdentityFacts: { 'character:ava': ['Ava is left-handed.'] },
        sceneFacts: { location: 'station', outfits: [{ identityId: 'character:ava', value: 'red coat' }] },
    };
    const result = reconcileStoryState(prior, { location: { status: 'unknown' }, outfits: [] });

    assert.deepEqual(result.nextState.durableIdentityFacts, prior.durableIdentityFacts);
    assert.equal('location' in result.nextState.sceneFacts, false);
    assert.deepEqual(result.nextState.sceneFacts.outfits, []);
    assert.equal(result.removedSceneFacts.location, 'station');
});

test('accepts only bounded, serializable state and returns immutable-by-convention clones', () => {
    const prior = { durableIdentityFacts: { 'npc:x': ['is patient'] }, sceneFacts: {} };
    const result = reconcileStoryState(prior, { location: { value: null } });
    assert.equal(result.schema, 1);
    assert.notEqual(result.nextState, prior);
    assert.deepEqual(prior, { durableIdentityFacts: { 'npc:x': ['is patient'] }, sceneFacts: {} });
});

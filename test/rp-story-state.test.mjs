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
        sceneSignals: { injuries: { clear: true, confidence: 'high' } },
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

test('does not erase durable or unobserved scene facts when the new scene is unknown or partial', () => {
    const prior = {
        schema: 1,
        durableIdentityFacts: { 'character:ava': ['Ava is left-handed.'] },
        sceneFacts: { location: 'station', outfits: [{ identityId: 'character:ava', value: 'red coat' }] },
    };
    const result = reconcileStoryState(prior, { location: { status: 'unknown' }, outfits: [] });

    assert.deepEqual(result.nextState.durableIdentityFacts, prior.durableIdentityFacts);
    assert.equal(result.nextState.sceneFacts.location, 'station');
    assert.deepEqual(result.nextState.sceneFacts.outfits, [{ identityId: 'character:ava', value: 'red coat' }]);
    assert.deepEqual(result.removedSceneFacts, {});
});

test('clears a prior scene fact only on explicit high-confidence removal evidence', () => {
    const prior = { durableIdentityFacts: { 'character:ava': ['left-handed'] }, sceneFacts: { location: 'station', objects: [{ value: 'map' }] } };
    const result = reconcileStoryState(prior, {
        location: { status: 'unknown', value: null },
        objects: [],
        sceneSignals: { location: { clear: true, confidence: 'high' }, objects: { clear: true, confidence: 'high' } },
    });
    assert.equal('location' in result.nextState.sceneFacts, false);
    assert.equal('objects' in result.nextState.sceneFacts, false);
    assert.deepEqual(result.removedSceneFacts, { location: 'station', objects: [{ value: 'map' }] });
    assert.deepEqual(result.nextState.durableIdentityFacts, prior.durableIdentityFacts);
});

test('sequential scene reconciliation replaces observed facts and preserves unobserved facts', () => {
    const first = reconcileStoryState({ sceneFacts: {} }, {
        location: { status: 'confirmed', value: 'station' },
        outfits: [{ identityId: 'character:ava', value: 'red coat' }],
    });
    const second = reconcileStoryState(first.nextState, {
        location: { status: 'unknown', value: null },
        outfits: [{ identityId: 'character:ava', value: 'blue coat' }],
    });
    assert.equal(second.nextState.sceneFacts.location, 'station');
    assert.deepEqual(second.nextState.sceneFacts.outfits, [{ identityId: 'character:ava', value: 'blue coat' }]);
    const third = reconcileStoryState(second.nextState, {
        location: { status: 'unknown', value: null },
        sceneSignals: { location: { clear: true, confidence: 'high' } },
    });
    assert.equal('location' in third.nextState.sceneFacts, false);
    assert.deepEqual(third.nextState.sceneFacts.outfits, [{ identityId: 'character:ava', value: 'blue coat' }]);
});

test('accepts only bounded, serializable state and returns immutable-by-convention clones', () => {
    const prior = { durableIdentityFacts: { 'npc:x': ['is patient'] }, sceneFacts: {} };
    const result = reconcileStoryState(prior, { location: { value: null } });
    assert.equal(result.schema, 1);
    assert.notEqual(result.nextState, prior);
    assert.deepEqual(prior, { durableIdentityFacts: { 'npc:x': ['is patient'] }, sceneFacts: {} });
});

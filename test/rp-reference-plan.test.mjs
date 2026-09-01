import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisibleReferencePlan } from '../lib/rp/reference-plan.js';

const candidates = [
    { id: 'ava:remembered', identityId: 'character:ava', identityLabel: 'Ava', sourceType: 'remembered', assetId: 'asset:ava-look' },
    { id: 'ava:avatar', identityId: 'character:ava', identityLabel: 'Ava', sourceType: 'avatar', assetId: 'asset:ava-avatar' },
    { id: 'ava:description', identityId: 'character:ava', identityLabel: 'Ava', sourceType: 'description', text: 'red coat' },
    { id: 'leo:avatar', identityId: 'character:leo', identityLabel: 'Leo', sourceType: 'avatar', assetId: 'asset:leo-avatar' },
    { id: 'scene:prior', identityId: null, identityLabel: 'Prior scene', sourceType: 'prior-scene', assetId: 'asset:scene' },
];

test('projection exposes identity, source type, selection, and omission reason under model limit', () => {
    const plan = buildVisibleReferencePlan({ candidates, modelLimit: 2 });
    assert.deepEqual(plan.rows.map(({ id, identity, sourceType, status, reason }) => [id, identity, sourceType, status, reason]), [
        ['ava:remembered', 'Ava', 'remembered', 'selected', null],
        ['ava:avatar', 'Ava', 'avatar', 'omitted', 'identity-already-represented'],
        ['ava:description', 'Ava', 'description', 'omitted', 'identity-already-represented'],
        ['leo:avatar', 'Leo', 'avatar', 'selected', null],
        ['scene:prior', 'Prior scene', 'prior-scene', 'omitted', 'model-limit'],
    ]);
    assert.deepEqual(plan.modelLimit, { maxReferences: 2, used: 2, remaining: 0 });
});

test('description is the visible fallback when an identity has no remembered or avatar reference', () => {
    const plan = buildVisibleReferencePlan({
        candidates: [
            { id: 'ava:description', identityId: 'character:ava', identityLabel: 'Ava', sourceType: 'description', text: 'red coat' },
            { id: 'scene:prior', identityId: null, identityLabel: 'Prior scene', sourceType: 'prior-scene', assetId: 'asset:scene' },
        ],
        modelLimit: 1,
    });
    assert.deepEqual(plan.rows.map(({ id, status, reason }) => [id, status, reason]), [
        ['ava:description', 'selected', null],
        ['scene:prior', 'omitted', 'model-limit'],
    ]);
});

test('projection is deterministic, duplicate-safe, and reports unknown model limits without selecting', () => {
    const input = { candidates: [...candidates, candidates[0]], modelLimit: undefined };
    const first = buildVisibleReferencePlan(input);
    const second = buildVisibleReferencePlan(input);
    assert.deepEqual(first, second);
    assert.equal(first.rows.filter(({ id }) => id === 'ava:remembered').length, 1);
    assert.equal(first.rows.every(({ status, reason }) => status === 'omitted' && reason === 'model-limit-unknown'), true);
    assert.deepEqual(first.modelLimit, { maxReferences: null, used: 0, remaining: null });
});

test('identity labels and provider capability limits are projected without changing candidate identity', () => {
    const plan = buildVisibleReferencePlan({
        identities: [{ id: 'character:ava', label: 'Ava' }, { id: 'character:leo', label: 'Leo' }],
        candidates: [
            { id: 'ava:avatar', identityId: 'character:ava', sourceType: 'avatar', assetId: 'asset:ava' },
            { id: 'leo:avatar', identityId: 'character:leo', sourceType: 'avatar', assetId: 'asset:leo' },
        ],
        modelLimit: { referenceImages: { maxCount: 1 } },
    });
    assert.equal(plan.rows[0].identity, 'Ava');
    assert.equal(plan.rows[1].identity, 'Leo');
    assert.equal(plan.rows[1].reason, 'model-limit');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReferenceReceipt, renderReferenceReceipt } from '../lib/rp/reference-receipt.js';

test('reference receipt uses the final plan selection and plain omission reasons', () => {
    const receipt = projectReferenceReceipt({
        references: [
            { id: 'look:ava', identityId: 'character:ava', identityLabel: 'Ava', sourceType: 'remembered', assetId: 'asset:private' },
            { id: 'avatar:rowan', identityId: 'user:rowan', label: 'Rowan', role: 'host-avatar', assetId: 'asset:private-2' },
        ],
        referencePlan: { modelLimit: { maxReferences: 2 } },
        referenceOmissions: [{ id: 'avatar:sam', identityId: 'user:sam', label: 'Sam', role: 'host-avatar', reason: 'model-limit', assetId: 'asset:secret' }],
    });
    assert.deepEqual(receipt.used, [
        { label: 'Ava', source: 'saved look' },
        { label: 'Rowan', source: 'avatar' },
    ]);
    assert.deepEqual(receipt.omitted, [{ label: 'Sam', source: 'avatar', reason: 'this model accepts 2 image references' }]);
    const html = renderReferenceReceipt(receipt);
    assert.match(html, /Used Ava's saved look and Rowan's avatar/u);
    assert.match(html, /Did not use Sam's avatar because this model accepts 2 image references/u);
    assert.doesNotMatch(html, /asset:private|PRIVATE|https?:/u);
});

test('reference receipt deduplicates final omissions and remains empty without a final plan', () => {
    const receipt = projectReferenceReceipt({ references: [], referenceOmissions: [] });
    assert.deepEqual(receipt, { schema: 1, used: [], omitted: [], modelMax: null });
    assert.equal(renderReferenceReceipt(receipt), '');
});

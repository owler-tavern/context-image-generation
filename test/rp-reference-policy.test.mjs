import test from 'node:test';
import assert from 'node:assert/strict';
import { enforcePreviousImagePolicy } from '../lib/rp/reference-policy.js';
import { buildReferenceMessageParts } from '../lib/rp/reference-message-parts.js';

test('previous-image off strips every prior-scene reference and its assets at dispatch', () => {
    const result = enforcePreviousImagePolicy({
        enabled: false,
        references: [
            { id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:previous' },
            { id: 'scene:stale', role: 'prior-scene', assetId: 'asset:scene:stale' },
            { id: 'avatar:daphne', role: 'host-avatar', assetId: 'asset:avatar:daphne' },
        ],
        assets: {
            'asset:previous': { url: 'data:image/png;base64,old' },
            'asset:scene:stale': { url: 'data:image/png;base64,stale' },
            'asset:avatar:daphne': { url: 'data:image/png;base64,avatar' },
        },
    });

    assert.deepEqual(result.references.map((reference) => reference.id), ['avatar:daphne']);
    assert.deepEqual(Object.keys(result.assets), ['asset:avatar:daphne']);
});

test('previous-image on preserves selected prior-scene references', () => {
    const references = [{ id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:previous' }];
    const assets = { 'asset:previous': { url: 'data:image/png;base64,old' } };
    assert.deepEqual(enforcePreviousImagePolicy({ enabled: true, references, assets }), { references, assets });
});

test('previous-image off leaves no prior bytes or image parts at the provider message boundary', () => {
    const policy = enforcePreviousImagePolicy({
        enabled: false,
        references: [{ id: 'legacy:previous', role: 'legacy-previous', assetId: 'asset:previous' }],
        assets: { 'asset:previous': { data: 'PRIVATE_PRIOR_IMAGE_BYTES', mimeType: 'image/png' } },
    });
    const parts = buildReferenceMessageParts({ references: policy.references }, policy.assets);
    assert.deepEqual(parts, []);
    assert.equal(JSON.stringify(parts).includes('PRIVATE_PRIOR_IMAGE_BYTES'), false);
    assert.equal(Object.hasOwn(policy.assets, 'asset:previous'), false);
});

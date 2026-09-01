import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enforcePreviousImagePolicy, projectSelectedReferenceAssets } from '../lib/rp/reference-policy.js';
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

test('final selected-reference projection removes excluded identity assets and keeps only selected reference bytes', () => {
    const result = projectSelectedReferenceAssets({
        references: [
            { id: 'look:ava', identityId: 'character:ava', assetId: 'asset:ava', label: 'Ava' },
            { id: 'look:rowan', identityId: 'character:rowan', assetId: 'asset:rowan', label: 'Rowan' },
            { id: 'host:user', identityId: 'user:adam', assetId: 'asset:user', label: 'Adam' },
        ],
        excludedIdentityIds: ['character:ava'],
        assets: {
            'asset:ava': { data: 'PRIVATE_AVA_BYTES' },
            'asset:rowan': { data: 'ROWAN_BYTES' },
            'asset:user': { data: 'USER_BYTES' },
            'asset:unused': { data: 'UNUSED_BYTES' },
        },
    });
    assert.deepEqual(result.references.map((reference) => reference.id), ['look:rowan', 'host:user']);
    assert.deepEqual(Object.keys(result.assets), ['asset:rowan', 'asset:user']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_AVA_BYTES|UNUSED_BYTES/u);
    assert.match(JSON.stringify(result), /ROWAN_BYTES|USER_BYTES/u);
});

test('production dispatch projects selected references and assets together before messages and final plan', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /projectSelectedReferenceAssets\(\{\s*references: plan\.references,\s*assets\s*\}\)/u);
    assert.match(index, /buildMessages\([\s\S]*?selectedProjection\.assets\)/u);
    assert.match(index, /canonSnapshot: dispatchCanonSnapshot/u);
    assert.match(index, /availableReferenceIds: selectedProjection\.references\.map/u);
});

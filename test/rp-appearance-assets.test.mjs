import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteGalleryArtifact, validateAppearanceAssetUrl, deleteAppearanceAssetFile } from '../lib/rp/appearance-assets.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const png = 'iVBORw0KGgo=';

test('promotion creates a distinct owned appearance file and UUID records', async () => {
    const saves = [];
    const result = await promoteGalleryArtifact({
        item: { id: 'gallery:one', url: '/gallery.png', prompt: 'Evening look' }, identityId: 'character:ava',
        library: {}, uuid: () => uuid,
        readDataUrl: async () => `data:image/png;base64,${png}`,
        saveBase64: async (...args) => { saves.push(args); return `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`; },
    });
    assert.equal(saves.length, 1);
    assert.equal(saves[0][1], 'context-image-generation-appearances');
    assert.notEqual(result.asset.url, '/gallery.png');
    assert.equal(result.asset.id, `asset:${uuid}`);
    assert.equal(result.look.id, `look:${uuid}`);
    assert.equal('data' in result.asset, false);
    assert.equal(result.asset.byteCount, 8);
});

test('dedupe avoids another read or upload for the same identity and artifact', async () => {
    let calls = 0;
    const existing = { schema: 2, assets: { [`asset:${uuid}`]: { id: `asset:${uuid}`, kind: 'appearance', url: `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`, byteCount: 8 } }, identities: { 'character:ava': { id: 'character:ava', looks: [{ id: `look:${uuid}`, assetId: `asset:${uuid}`, source: { identityId: 'character:ava', galleryArtifactId: 'gallery:one' } }] } } };
    const result = await promoteGalleryArtifact({ item: { id: 'gallery:one', url: '/gallery.png' }, identityId: 'character:ava', library: existing, readDataUrl: async () => { calls++; }, saveBase64: async () => { calls++; } });
    assert.equal(result.deduplicated, true);
    assert.equal(calls, 0);
});

test('owned paths are exact and reject traversal, other folders, query strings and malformed IDs', () => {
    assert.equal(validateAppearanceAssetUrl(`/user/images/context-image-generation-appearances/cig-appearance-${uuid}.webp`), true);
    for (const value of [`/user/images/other/cig-appearance-${uuid}.png`, `/user/images/context-image-generation-appearances/../x.png`, `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png?x=1`, `https://host/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`]) assert.equal(validateAppearanceAssetUrl(value), false);
});

test('promotion rejects invalid image data and quota excess before upload', async () => {
    let uploads = 0;
    await assert.rejects(() => promoteGalleryArtifact({ item: { id: 'g', url: '/g' }, identityId: 'character:ava', library: {}, uuid: () => uuid, readDataUrl: async () => 'data:text/plain;base64,SGk=', saveBase64: async () => { uploads++; } }), /image/i);
    const assets = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`asset:${i}`, { kind: 'appearance', byteCount: 1 }]));
    await assert.rejects(() => promoteGalleryArtifact({ item: { id: 'g', url: '/g' }, identityId: 'character:ava', library: { assets }, uuid: () => uuid, readDataUrl: async () => `data:image/png;base64,${png}`, saveBase64: async () => { uploads++; } }), /100 appearance assets/i);
    assert.equal(uploads, 0);
});

test('confirmed-absent cleanup deletes only the exact owned path', async () => {
    const calls = [];
    const url = `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`;
    assert.equal(await deleteAppearanceAssetFile(url, async (...args) => { calls.push(args); return { ok: true, status: 200 }; }, () => ({ csrf: 'x' })), true);
    assert.equal(calls[0][0], '/api/images/delete');
    assert.deepEqual(JSON.parse(calls[0][1].body), { path: url });
    await assert.rejects(() => deleteAppearanceAssetFile('/user/images/other/a.png', async () => ({ ok: true })), /unsafe/i);
});

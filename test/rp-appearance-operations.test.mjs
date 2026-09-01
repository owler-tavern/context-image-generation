import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAppearanceOperations, runRebasedLibraryMutation } from '../lib/rp/appearance-operations.js';
import { materializeAppearanceAssets } from '../lib/rp/appearance-library.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
function pendingLibrary() { return { schema: 2, revision: 'pending-r', assets: { [`asset:${id}`]: { id: `asset:${id}`, kind: 'appearance', url: `/user/images/context-image-generation-appearances/cig-appearance-${id}.png` } }, identities: { who: { id: 'who', looks: [{ id: `look:${id}`, assetId: `asset:${id}` }] } }, operations: { op: { status: 'pending', assetId: `asset:${id}`, lookId: `look:${id}` } } }; }

test('confirmed pending retry transitions through a verified save and becomes usable', async () => {
    let saved;
    const result = await reconcileAppearanceOperations({ library: pendingLibrary(), verifyRevision: async () => ({ status: 'confirmed' }), saveLibrary: async (value) => { saved = value; }, verifySaved: async () => ({ status: 'confirmed' }), uuid: () => 'accepted' });
    assert.equal(result.status, 'reconciled');
    assert.equal(saved.operations.op, undefined);
    assert.ok(materializeAppearanceAssets(result.library).assets[`asset:${id}`]);
});

test('reload resume scans and completes pending and orphan-cleanup operations', async () => {
    const library = pendingLibrary();
    library.operations.orphan = { status: 'orphan-cleanup', url: `/user/images/context-image-generation-appearances/cig-appearance-${id}.png` };
    const deleted = [];
    const result = await reconcileAppearanceOperations({ library, verifyRevision: async () => ({ status: 'confirmed' }), saveLibrary: async () => {}, verifySaved: async () => ({ status: 'confirmed' }), deleteFile: async (url) => deleted.push(url), uuid: () => 'reload' });
    assert.equal(result.status, 'reconciled');
    assert.equal(Object.keys(result.library.operations).length, 0);
    assert.equal(deleted.length, 1);
});

test('production rebase seam serializes Remember Remember, Remember Delete, and migration Remember', async () => {
    let server = { revision: 0, events: [] };
    const run = (name) => runRebasedLibraryMutation({ readLatest: async () => structuredClone(server), mutate: async (latest) => ({ ...latest, events: [...latest.events, name], revision: latest.revision + 1 }), saveLibrary: async (next) => { server = next; }, verifySaved: async () => ({ status: 'confirmed' }) });
    await Promise.all([run('remember-1'), run('remember-2'), run('delete'), run('migration'), run('remember-3')]);
    assert.deepEqual(server.events, ['remember-1', 'remember-2', 'delete', 'migration', 'remember-3']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runClearGalleryPreservingLooks } from '../lib/rp/appearance-migration.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const targetUrl = `/user/images/context-image-generation-appearances/cig-appearance-${uuid}.png`;
const gallery = [{ id: 'gallery:one', imageData: 'iVBORw0KGgo=', mimeType: 'image/png', prompt: 'Legacy' }];

function legacyLibrary() {
    return { schema: 1, revision: 'r0', identities: {
        'character:ava': { id: 'character:ava', looks: [{ id: 'look:old-a', assetId: 'asset:legacy' }] },
        'user:sam': { id: 'user:sam', looks: [{ id: 'look:old-b', assetId: 'asset:legacy' }] },
    }, assets: { 'asset:legacy': { id: 'asset:legacy', kind: 'gallery', source: { galleryId: 'gallery:one' } } }, operations: {} };
}

function harness({ targetStates = ['confirmed-absent', 'confirmed-present'], failSaveAt = 0, verificationStatuses = [] } = {}) {
    let library = legacyLibrary();
    let visibleGallery = structuredClone(gallery);
    const events = [];
    let saveCount = 0;
    const io = {
        runExclusive: (fn) => fn(),
        readLibrary: async () => ({ status: 'confirmed', library: structuredClone(library) }),
        saveLibrary: async (candidate) => { saveCount++; if (failSaveAt === saveCount) throw new Error('save failed'); library = structuredClone(candidate); events.push(candidate.operations?.['migration:gallery:one'] ? 'pending-save' : 'promoted-save'); },
        verifyLibrary: async () => ({ status: verificationStatuses.shift() || 'confirmed' }),
        readDataUrl: async (item) => `data:${item.mimeType};base64,${item.imageData}`,
        saveBase64: async () => { events.push('upload'); return targetUrl; },
        targetExists: async () => ({ status: targetStates.shift() || 'confirmed-present' }),
        saveClearedState: async ({ library: next, gallery: nextGallery }) => { library = structuredClone(next); visibleGallery = structuredClone(nextGallery); events.push('clear-save'); },
        verifyClearedState: async () => ({ status: 'confirmed' }),
        setLocalState: ({ library: next, gallery: nextGallery }) => { library = structuredClone(next); visibleGallery = structuredClone(nextGallery); },
        uuid: () => uuid,
    };
    return { io, events, state: () => ({ library, gallery: visibleGallery }) };
}

test('Clear Gallery migrates all looks sharing one artifact before clearing history', async () => {
    const h = harness();
    const result = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(result.status, 'confirmed');
    assert.deepEqual(h.events, ['pending-save', 'upload', 'promoted-save', 'clear-save']);
    assert.deepEqual(h.state().gallery, []);
    assert.equal(h.state().library.identities['character:ava'].looks[0].assetId, `asset:${uuid}`);
    assert.equal(h.state().library.identities['user:sam'].looks[0].assetId, `asset:${uuid}`);
});

test('pending verification blocks clear and retains every legacy look and Gallery entry', async () => {
    const h = harness({ verificationStatuses: ['indeterminate'] });
    const result = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(h.state().gallery, gallery);
    assert.equal(h.state().library.identities['character:ava'].looks[0].assetId, 'asset:legacy');
    assert.equal(h.events.includes('upload'), false);
});

test('reload resumes exact pending target and never uploads a second file', async () => {
    const h = harness({ targetStates: ['confirmed-absent', 'indeterminate'] });
    const first = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(first.status, 'blocked');
    assert.equal(h.events.filter((item) => item === 'upload').length, 1);
    h.io.targetExists = async () => ({ status: 'confirmed-present' });
    const second = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(second.status, 'confirmed');
    assert.equal(h.events.filter((item) => item === 'upload').length, 1);
    assert.equal(second.migrations[0].targetUrl, targetUrl);
});

test('failure after upload but before promoted verification retains pending operation and Gallery', async () => {
    const h = harness({ verificationStatuses: ['confirmed', 'indeterminate'] });
    const result = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(h.state().gallery, gallery);
    assert.equal(h.state().library.operations['migration:gallery:one'].targetUrl, targetUrl);
});

test('crash after verified pending state but before upload remains reload-resumable without clearing', async () => {
    const h = harness({ targetStates: ['indeterminate'] });
    const result = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(result.reason, 'target-unverified');
    assert.deepEqual(h.state().gallery, gallery);
    assert.equal(h.events.includes('upload'), false);
    assert.equal(h.state().library.operations['migration:gallery:one'].targetUrl, targetUrl);
});

test('pending-save failure blocks before upload and preserves original legacy authority', async () => {
    const h = harness({ failSaveAt: 1 });
    const result = await runClearGalleryPreservingLooks({ gallery, io: h.io });
    assert.equal(result.reason, 'pending-unverified');
    assert.equal(h.events.includes('upload'), false);
    assert.deepEqual(h.state().gallery, gallery);
    assert.equal(h.state().library.identities['character:ava'].looks[0].assetId, 'asset:legacy');
});

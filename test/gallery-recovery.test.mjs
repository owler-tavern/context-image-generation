import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production host seam with storage/UI dependencies substituted.
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function addToGallery('), source.indexOf('function createGalleryTile('));
function fixture(saveSettings = async () => {}) {
    const settings = { gallery: [] };
    const preview = {};
    const factory = new Function('extension_settings', 'extensionName', 'extraStoryToolEnabled', 'saveSettings',
        'saveSettingsDebounced', 'saveBase64AsFile', 'getContext', 'trimGalleryToLimit', 'MAX_GALLERY_SIZE',
        'canIncrementallyPrependGalleryItem', 'galleryRenderState', '$', `${body}; return addToGallery;`);
    const add = factory({ cig: settings }, 'cig', () => false, saveSettings,
        () => {}, async () => '/saved.png', () => ({ chatId: 'new-chat' }), gallery => ({ gallery }), 50,
        () => false, { markDirty() {}, refresh() {} }, () => ({ attr(key, value) { preview[key] = value; return this; }, prop() {} }));
    return { settings, preview, add };
}

test('recovery bypasses disabled optional tools and awaits durable settings save', async () => {
    let release;
    const persisted = new Promise(resolve => { release = resolve; });
    const { settings, add } = fixture(() => persisted);
    let completed = false;
    const recovery = add('bytes', 'scene', 3, '/saved.png', { attachmentStatus: 'not-attached', chatId: 'original-chat' })
        .then(result => { completed = true; return result; });
    await Promise.resolve();
    assert.equal(completed, false);
    release();
    const item = await recovery;
    assert.equal(item.url, '/saved.png');
    assert.equal(item.chatId, 'original-chat');
    assert.equal(settings.gallery.length, 1);
});

test('ordinary images still respect disabled optional Gallery storage', async () => {
    const { settings, add } = fixture();
    assert.equal(await add('bytes', 'scene', 3, '/saved.png'), undefined);
    assert.equal(settings.gallery.length, 0);
});

test('recovery persistence errors retain a preview and reject instead of claiming success', async () => {
    const { add, preview } = fixture(async () => { throw new Error('disk failure'); });
    await assert.rejects(add('bytes', 'scene', 3, '/saved.png', { attachmentStatus: 'not-attached' }), /disk failure/);
    assert.equal(preview.src, '/saved.png');
});

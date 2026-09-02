import assert from 'node:assert/strict';
import test from 'node:test';
import { canIncrementallyPrependGalleryItem, createGalleryRenderState, reindexGalleryTileActionTargets } from '../lib/gallery-render-state.js';
import { trimGalleryToLimit } from '../lib/rp/appearance-library.js';

test('hidden mutation stays dirty without rebuilding Gallery tiles', () => {
    let visible = false;
    let renders = 0;
    const state = createGalleryRenderState({
        isVisible: () => visible,
        renderAll: () => { renders++; },
        prependOne: () => {},
    });

    state.markDirty();

    assert.equal(renders, 0);
    assert.equal(state.isDirty(), true);
    assert.equal(state.refresh(), false);
    assert.equal(renders, 0);
});

test('one refresh after Gallery becomes visible consumes dirty state', () => {
    let visible = false;
    let renders = 0;
    const state = createGalleryRenderState({
        isVisible: () => visible,
        renderAll: () => { renders++; },
        prependOne: () => {},
    });

    state.markDirty();
    visible = true;

    assert.equal(state.refresh(), true);
    assert.equal(state.refresh(), false);
    assert.equal(renders, 1);
    assert.equal(state.isDirty(), false);
});

test('failed Gallery refresh remains dirty for a later retry', () => {
    let visible = true;
    let attempts = 0;
    const state = createGalleryRenderState({
        isVisible: () => visible,
        renderAll: () => {
            attempts++;
            if (attempts === 1) throw new Error('temporary DOM failure');
        },
        prependOne: () => {},
    });

    state.markDirty();
    assert.throws(() => state.refresh(), /temporary DOM failure/u);
    assert.equal(state.isDirty(), true);
    assert.equal(state.refresh(), true);
    assert.equal(attempts, 2);
    assert.equal(state.isDirty(), false);
});

test('new Gallery item prepends only while visible and clean', () => {
    let visible = true;
    const prepended = [];
    const state = createGalleryRenderState({
        isVisible: () => visible,
        renderAll: () => {},
        prependOne: (item) => { prepended.push(item); },
    });
    const first = { id: 'first' };
    const second = { id: 'second' };

    state.refresh();
    state.add(first);
    visible = false;
    state.add(second);

    assert.deepEqual(prepended, [first]);
    assert.equal(state.isDirty(), true);
});

test('trimmed Gallery additions require a full refresh instead of leaving an evicted tile', () => {
    const previouslyRendered = Array.from({ length: 50 }, (_, index) => ({ id: `item:${index}` }));
    const inserted = { id: 'inserted' };
    const trimmedGallery = trimGalleryToLimit([inserted, ...previouslyRendered], 50, {}).gallery;

    assert.equal(trimmedGallery.length, 50);
    assert.equal(trimmedGallery.at(-1).id, 'item:48');
    assert.equal(canIncrementallyPrependGalleryItem({ previouslyRendered, gallery: trimmedGallery, insertedItem: inserted }), false);
});

function tile(id) {
    return {
        tile: { id: `tile:${id}` },
        actions: [
            { id: `preview:${id}` },
            { id: `remember:${id}` },
            { id: `delete:${id}` },
        ],
    };
}

function actionIndices(tiles) {
    return tiles.map(({ tile, actions }) => ({
        tile: tile.index,
        preview: actions[0].index,
        remember: actions[1].index,
        delete: actions[2].index,
    }));
}

test('Gallery prepend reindexes preview, remember, and delete action targets', () => {
    const tiles = [tile('current'), tile('oldest')];
    tiles.unshift(tile('new'));

    reindexGalleryTileActionTargets(tiles, (target, index) => { target.index = index; });

    assert.deepEqual(actionIndices(tiles), [
        { tile: 0, preview: 0, remember: 0, delete: 0 },
        { tile: 1, preview: 1, remember: 1, delete: 1 },
        { tile: 2, preview: 2, remember: 2, delete: 2 },
    ]);
});

test('Gallery deletion reindexes preview, remember, and delete action targets', () => {
    const tiles = [tile('new'), tile('removed'), tile('oldest')];
    tiles.splice(1, 1);

    reindexGalleryTileActionTargets(tiles, (target, index) => { target.index = index; });

    assert.deepEqual(actionIndices(tiles), [
        { tile: 0, preview: 0, remember: 0, delete: 0 },
        { tile: 1, preview: 1, remember: 1, delete: 1 },
    ]);
});

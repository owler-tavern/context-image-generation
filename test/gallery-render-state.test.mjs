import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryRenderState } from '../lib/gallery-render-state.js';

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

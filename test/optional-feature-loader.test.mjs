import assert from 'node:assert/strict';
import test from 'node:test';

import { createOptionalFeatureLoader } from '../lib/optional-feature-loader.js';

test('concurrent loads invoke one feature loader once and reuse its module', async () => {
    let calls = 0;
    const module = { name: 'iteration' };
    const loader = createOptionalFeatureLoader({
        iteration: async () => {
            calls += 1;
            return module;
        },
    });

    const first = loader.load('iteration');
    const second = loader.load('iteration');

    assert.strictEqual(first, second);
    assert.strictEqual(await first, module);
    assert.strictEqual(await loader.load('iteration'), module);
    assert.equal(calls, 1);
    assert.strictEqual(loader.peek('iteration'), first);
});

test('unknown feature names reject without invoking a loader', async () => {
    const loader = createOptionalFeatureLoader({});

    await assert.rejects(loader.load('unknown'), /Unknown optional feature: unknown/u);
});

test('rejected feature loads clear only their cached promise and retry', async () => {
    let calls = 0;
    const module = { name: 'director' };
    const loader = createOptionalFeatureLoader({
        director: async () => {
            calls += 1;
            if (calls === 1) throw new Error('first load failed');
            return module;
        },
    });

    await assert.rejects(loader.load('director'), /first load failed/u);
    assert.equal(loader.peek('director'), undefined);
    assert.strictEqual(await loader.load('director'), module);
    assert.equal(calls, 2);
    loader.clear('director');
    assert.equal(loader.peek('director'), undefined);
});

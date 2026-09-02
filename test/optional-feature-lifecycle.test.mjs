import assert from 'node:assert/strict';
import test from 'node:test';

import { createOptionalFeatureLifecycle } from '../lib/optional-feature-lifecycle.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
}

test('disable during a pending load prevents setup and resolves the stale enable safely', async () => {
    const pending = deferred();
    let setups = 0;
    const lifecycle = createOptionalFeatureLifecycle({
        load: () => pending.promise,
        setup: () => { setups += 1; },
    });

    const enabling = lifecycle.enable();
    const disabling = lifecycle.disable();
    pending.resolve({ name: 'iteration' });

    assert.deepEqual(await enabling, { status: 'disabled' });
    await disabling;
    assert.equal(setups, 0);
});

test('overlapping enable and event paths share one load and one setup before invoking the event', async () => {
    const pending = deferred();
    let loads = 0;
    let setups = 0;
    let events = 0;
    const lifecycle = createOptionalFeatureLifecycle({
        load: () => { loads += 1; return pending.promise; },
        setup: () => { setups += 1; },
    });

    const first = lifecycle.enable();
    const second = lifecycle.run(() => { events += 1; });
    pending.resolve({ name: 'cinematic' });

    assert.deepEqual(await first, { status: 'ready' });
    assert.deepEqual(await second, { status: 'completed' });
    assert.equal(loads, 1);
    assert.equal(setups, 1);
    assert.equal(events, 1);
});

test('a rejected load is reported, does not escape callers, and can retry', async () => {
    let loads = 0;
    const reported = [];
    const lifecycle = createOptionalFeatureLifecycle({
        load: async () => {
            loads += 1;
            if (loads === 1) throw new Error('load failed');
            return { name: 'storyMemory' };
        },
        setup: () => {},
        onError: (error) => reported.push(error.message),
    });

    assert.deepEqual(await lifecycle.enable(), { status: 'failed' });
    assert.deepEqual(await lifecycle.enable(), { status: 'ready' });
    assert.deepEqual(reported, ['load failed']);
    assert.equal(loads, 2);
});

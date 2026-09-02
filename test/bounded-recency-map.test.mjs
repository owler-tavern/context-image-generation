import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedRecencyMap } from '../lib/bounded-recency-map.js';

test('get refreshes recency before set evicts the oldest entry', () => {
    const map = createBoundedRecencyMap({ maxEntries: 2, isProtected: () => false });
    map.set('first', 1);
    map.set('second', 2);
    assert.equal(map.get('first'), 1);
    map.set('third', 3);
    assert.equal(map.has('first'), true);
    assert.equal(map.has('second'), false);
    assert.equal(map.get('third'), 3);
});

test('set evicts the oldest unprotected entry', () => {
    const protectedKeys = new Set(['first']);
    const map = createBoundedRecencyMap({ maxEntries: 2, isProtected: (key) => protectedKeys.has(key) });
    map.set('first', 1);
    map.set('second', 2);
    map.set('third', 3);
    assert.equal(map.has('first'), true);
    assert.equal(map.has('second'), false);
    assert.equal(map.has('third'), true);
});

test('active and in-flight entries stay protected while inactive entries are evicted', () => {
    const protectedKeys = new Set(['active', 'in-flight']);
    const map = createBoundedRecencyMap({ maxEntries: 2, isProtected: (key) => protectedKeys.has(key) });
    map.set('active', 1);
    map.set('in-flight', 2);
    map.set('inactive', 3);
    assert.equal(map.has('active'), true);
    assert.equal(map.has('in-flight'), true);
    assert.equal(map.has('inactive'), false);
});

test('temporarily overflows when every entry is protected then compacts on the next operation', () => {
    const protectedKeys = new Set(['first', 'second', 'third']);
    const map = createBoundedRecencyMap({ maxEntries: 2, isProtected: (key) => protectedKeys.has(key) });
    map.set('first', 1);
    map.set('second', 2);
    map.set('third', 3);
    assert.equal(map.size, 3);
    protectedKeys.delete('first');
    protectedKeys.delete('second');
    map.has('third');
    assert.equal(map.size, 2);
    assert.equal(map.has('first'), false);
    assert.equal(map.has('second'), true);
    assert.equal(map.has('third'), true);
});

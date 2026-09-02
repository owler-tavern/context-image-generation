import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_DESTINATIONS,
  GENERATION_SOURCES,
  normalizeGenerationRequest,
} from '../lib/scene-generation/contracts.js';

test('ADR-002 permits only wand and slash generation sources', () => {
  assert.deepEqual(GENERATION_SOURCES, ['wand', 'slash']);
});

test('delivery is explicit for each allowed source', () => {
  assert.deepEqual(DELIVERY_DESTINATIONS, ['message', 'preview-gallery']);
  assert.equal(normalizeGenerationRequest({ source: 'wand', destination: 'message', prompt: 'scene' }).source, 'wand');
  assert.equal(normalizeGenerationRequest({ source: 'slash', destination: 'preview-gallery', prompt: 'castle' }).source, 'slash');
});

for (const source of ['settings', 'swipe', 'automation', 'iteration', 'cinematic', 'director']) {
  test(`rejects ${source} as a generation source`, () => {
    assert.throws(() => normalizeGenerationRequest({ source, destination: 'message', prompt: 'x' }), /Unsupported generation source/);
  });
}

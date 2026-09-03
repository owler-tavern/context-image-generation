import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appearanceLibraryEquivalent,
    extraStoryToolsEquivalent,
    outfitCatalogEquivalent,
    outfitPendingStateEquivalent,
    providerSettingsEquivalent,
    removeRetiredGenerationDeadline,
    replaceWhenChanged,
} from '../lib/settings-migration-change.js';

test('replaceWhenChanged retains the original reference when a stable migration is equivalent without serializing', () => {
    const current = { schema: 1, pending: {} };
    const originalStringify = JSON.stringify;
    JSON.stringify = () => { throw new Error('migration change detection must not serialize settings'); };
    try {
        const result = replaceWhenChanged(
            current,
            () => ({ schema: 1, pending: {} }),
            outfitPendingStateEquivalent,
        );
        assert.equal(result.changed, false);
        assert.strictEqual(result.value, current);
    } finally {
        JSON.stringify = originalStringify;
    }
});

test('replaceWhenChanged returns the migrated value when focused equivalence detects a change', () => {
    const current = { schema: 1, outfits: [] };
    const migrated = { schema: 1, outfits: [{ id: 'outfit:casual' }] };
    const result = replaceWhenChanged(current, () => migrated, outfitCatalogEquivalent);

    assert.equal(result.changed, true);
    assert.strictEqual(result.value, migrated);
});

test('removes the retired generation deadline from persisted settings before saving', () => {
    const settings = { provider: 'linkapi', generation_deadline_ms: 120000 };

    assert.equal(removeRetiredGenerationDeadline(settings), true);
    assert.equal(Object.hasOwn(settings, 'generation_deadline_ms'), false);
    assert.equal(removeRetiredGenerationDeadline(settings), false);
});

test('provider migration equivalence treats a reordered persisted record as changed to preserve save behavior', () => {
    const current = { provider_contracts_version: 1, first: 'one', second: 'two' };
    const migrated = { provider_contracts_version: 1, second: 'two', first: 'one' };
    const result = replaceWhenChanged(current, () => migrated, providerSettingsEquivalent);

    assert.equal(result.changed, true);
    assert.strictEqual(result.value, migrated);
});

test('focused migration equivalence covers the five settings domains without serializing', () => {
    const originalStringify = JSON.stringify;
    JSON.stringify = () => { throw new Error('focused equivalence must not serialize settings'); };
    try {
        assert.equal(providerSettingsEquivalent({ provider_contracts_version: 1, nested: { enabled: true } }, { provider_contracts_version: 1, nested: { enabled: true } }), true);
        assert.equal(extraStoryToolsEquivalent(
            { enabled: true, storyMemory: false, appearanceMemory: true, cinematic: false, iteration: false, gallery: false },
            { enabled: true, storyMemory: false, appearanceMemory: true, cinematic: false, iteration: false, gallery: false },
        ), true);
        assert.equal(appearanceLibraryEquivalent(
            { schema: 1, identities: {}, assets: {}, preferences: { sceneContinuity: false } },
            { schema: 1, identities: {}, assets: {}, preferences: { sceneContinuity: false } },
        ), true);
        assert.equal(outfitCatalogEquivalent({ schema: 1, outfits: [] }, { schema: 1, outfits: [] }), true);
        assert.equal(outfitPendingStateEquivalent({ schema: 1, pending: {} }, { schema: 1, pending: {} }), true);
    } finally {
        JSON.stringify = originalStringify;
    }
});

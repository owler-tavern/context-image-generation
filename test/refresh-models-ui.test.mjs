import test from 'node:test';
import assert from 'node:assert/strict';
import { getDiscoveryRefreshMessage } from '../lib/providers/model-manager.js';
import * as providerUi from '../lib/providers/ui-projection.js';

test('keeps accepted refreshed models in the primary Setup selector while Advanced filters Manage Models', () => {
    assert.equal(typeof providerUi.projectModelSelectorLists, 'function');
    assert.deepEqual(providerUi.projectModelSelectorLists({
        models: [
            { id: 'curated-image', label: 'Curated image' },
            { id: 'fresh-image', label: 'Fresh image' },
            { id: 'other-image', label: 'Other image' },
        ],
        managedSearch: 'fresh',
    }), {
        setup: [
            { id: 'curated-image', label: 'Curated image' },
            { id: 'fresh-image', label: 'Fresh image' },
            { id: 'other-image', label: 'Other image' },
        ],
        managed: [{ id: 'fresh-image', label: 'Fresh image' }],
    });
});

test('tells users to choose accepted refreshed models from Setup Model without claiming generation was verified', () => {
    assert.deepEqual(getDiscoveryRefreshMessage({
        evidence: { acceptedCount: 2, returnedCount: 2 },
    }), {
        level: 'success',
        message: 'Refreshed 2 discovered image models in Setup → Model. Choose one from that dropdown; discovery does not verify image generation.',
    });
});

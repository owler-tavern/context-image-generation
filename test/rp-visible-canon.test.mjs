import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    projectVisibleCanon,
    visibleCanonActionLabels,
    visibleCanonStatus,
} from '../lib/rp/visible-canon.js';

const identity = {
    id: 'character:ava.png',
    kind: 'character',
    label: 'Ava',
    activeLookId: null,
    looks: [
        { id: 'look:day', assetId: 'asset:day', label: 'Day outfit' },
        { id: 'look:night', assetId: 'asset:night', label: 'Night outfit' },
    ],
};
const library = {
    schema: 2,
    identities: { [identity.id]: identity },
    assets: {
        'asset:day': { id: 'asset:day', kind: 'appearance', url: '/day.png', mimeType: 'image/png' },
        'asset:night': { id: 'asset:night', kind: 'appearance', url: '/night.png', mimeType: 'image/png' },
    },
};

test('unactivated inline canon projection exposes Remember and saved-look choices', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: { schema: 1, bindings: {} },
        identityId: identity.id,
    });

    assert.equal(projection.identityLabel, 'Ava');
    assert.equal(projection.active, false);
    assert.equal(projection.locked, false);
    assert.deepEqual(projection.looks.map((look) => look.id), ['look:day', 'look:night']);
    assert.deepEqual(visibleCanonActionLabels(projection), [
        'Remember character look',
        'Change look',
    ]);
    assert.equal(visibleCanonStatus(projection), 'No character look is active in this chat.');
});

test('activated inline canon projection states the active lock and keeps every chat action available', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: {
            schema: 1,
            bindings: {
                [identity.id]: {
                    activeLookId: 'look:day',
                    expectedAssetId: 'asset:day',
                    isLocked: true,
                    selectedAt: 1,
                },
            },
        },
        identityId: identity.id,
    });

    assert.equal(projection.active, true);
    assert.equal(projection.activeLookLabel, 'Day outfit');
    assert.equal(projection.locked, true);
    assert.deepEqual(visibleCanonActionLabels(projection), [
        'Remember character look',
        'Change look',
        'Unlock look',
        'Stop using look',
    ]);
    assert.equal(visibleCanonStatus(projection), 'Active look: Day outfit. Locked for this chat.');
});

test('unlocked active look is explicit and unavailable saved files are not offered', () => {
    const projection = projectVisibleCanon({
        library,
        chatState: {
            schema: 1,
            bindings: {
                [identity.id]: {
                    activeLookId: 'look:night',
                    expectedAssetId: 'asset:night',
                    isLocked: false,
                    selectedAt: 1,
                },
            },
        },
        identityId: identity.id,
        availableAssetIds: ['asset:night'],
    });

    assert.deepEqual(projection.looks.map((look) => look.id), ['look:night']);
    assert.equal(visibleCanonStatus(projection), 'Active look: Night outfit. Unlocked for this chat.');
    assert.ok(visibleCanonActionLabels(projection).includes('Lock look'));
});

test('production message wiring projects visible canon without entering provider dispatch', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');

    assert.match(index, /import \{ projectVisibleCanon, visibleCanonStatus \} from '\.\/lib\/rp\/visible-canon\.js'/);
    assert.match(index, /renderVisibleCanonControls\(messageElement\)/);
    assert.match(index, /renderVisibleCanonControls\(currentMessageElement, currentMessage\)/);
    assert.match(index, /Remember character look/);
    assert.match(index, /cig_visible_canon_change/);
    assert.match(index, /cig_visible_canon_lock/);
    assert.match(index, /cig_visible_canon_stop/);
    assert.match(index, /refreshVisibleCanonControls\(\)/);
    assert.match(index, /runRememberAppearance/);
    assert.match(index, /appearanceFeatureController\(\)\.use/);
    assert.doesNotMatch(index, /cig_visible_canon[^\n]*dispatchProviderRoute/);
    assert.match(style, /\.cig_visible_canon button,[\s\S]*?min-width:\s*44px/);
    assert.match(style, /\.cig_visible_canon button,[\s\S]*?min-height:\s*44px/);
    assert.match(style, /@media \(max-width: 600px\)/);
});

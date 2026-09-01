import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReferenceReadiness, renderReferenceReadiness } from '../lib/rp/reference-readiness.js';

const identities = [
    { id: 'character:ava', label: 'Ava', kind: 'character' },
    { id: 'user:rowan', label: 'Rowan', kind: 'user' },
];

test('reference readiness is a collapsed, provider-free availability summary for the current chat', () => {
    const readiness = projectReferenceReadiness({
        identities,
        truths: [
            { identityId: 'character:ava', sourceType: 'avatar', description: { text: 'Ava description' } },
            { identityId: 'user:rowan', sourceType: 'description', description: { text: 'Rowan description' } },
        ],
        candidates: [{ identityId: 'character:ava', sourceType: 'remembered', identityLabel: 'Ava' }],
        modelMax: 2,
        stagedPreviousImage: { artifactId: 'story:lake', title: 'Lakeside overlook' },
        previousImageEnabled: true,
    });

    assert.equal(readiness.modelMax, 2);
    assert.deepEqual(readiness.identities[0].availableSources, ['saved look', 'avatar', 'description']);
    assert.deepEqual(readiness.identities[1].availableSources, ['description']);
    assert.equal(readiness.previousImage.artifactId, 'story:lake');
    const html = renderReferenceReadiness(readiness);
    assert.match(html, /Reference readiness for this chat/u);
    assert.match(html, /may be used/u);
    assert.match(html, /<strong>Ava<\/strong>: saved look, avatar, description available/u);
    assert.match(html, /<strong>Rowan<\/strong>: description available/u);
    assert.match(html, /up to 2 image references/u);
    assert.match(html, /Lakeside overlook/u);
    assert.match(html, /<details class="cig-reference-readiness-details">/u);
});

test('reference readiness hides staged Story Memory source when previous-image opt-in is off', () => {
    const readiness = projectReferenceReadiness({
        identities,
        truths: [{ identityId: 'character:ava', sourceType: 'description', description: { text: 'Ava description' } }],
        modelMax: null,
        stagedPreviousImage: { artifactId: 'story:private', title: 'Private source must stay hidden' },
        previousImageEnabled: false,
    });
    assert.equal(readiness.previousImage, null);
    const html = renderReferenceReadiness(readiness);
    assert.doesNotMatch(html, /Private source must stay hidden/u);
    assert.match(html, /reference limit is not known/u);
});

test('reference readiness honors global source switches and each identity choice', () => {
    const readiness = projectReferenceReadiness({
        identities: [{ id: 'character:ava', label: 'Ava' }],
        truths: [{ identityId: 'character:ava', sourceType: 'avatar', description: { text: 'Ava description' } }],
        candidates: [
            { id: 'look:ava', identityId: 'character:ava', sourceType: 'remembered' },
            { id: 'avatar:ava', identityId: 'character:ava', sourceType: 'avatar' },
            { id: 'description:character:ava', identityId: 'character:ava', sourceType: 'description' },
        ],
        sourcePreferences: { 'character:ava': { sourceType: 'description' } },
        allowAvatars: false,
        allowDescriptions: true,
        modelMax: 2,
    });
    assert.deepEqual(readiness.identities[0].availableSources, ['saved look', 'description']);
    assert.equal(readiness.identities[0].effectiveSource, 'description');
    assert.doesNotMatch(renderReferenceReadiness(readiness), /avatar/u);
});

test('reference readiness is empty when no availability or model information is meaningful', () => {
    assert.equal(projectReferenceReadiness({ identities: [], truths: [], modelMax: null }), null);
});

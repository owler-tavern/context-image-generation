import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCanonForGeneration, notifyBrokenCanon } from '../lib/rp/canon-generation-capture.js';
import { createGenerationPlan } from '../lib/generation-plan.js';

const assetUrl = '/user/images/context-image-generation-appearances/cig-appearance-44444444-4444-4444-8444-444444444444.png';
const identity = { id: 'character:ava.png', kind: 'character', label: 'Ava', aliases: ['ava'] };
const library = {
    schema: 2,
    identities: { [identity.id]: { ...identity, activeLookId: null, looks: [{ id: 'look:chat', assetId: 'asset:chat' }] } },
    assets: { 'asset:chat': { id: 'asset:chat', kind: 'appearance', url: assetUrl, mimeType: 'image/png' } },
};
const chatState = { schema: 1, bindings: { [identity.id]: { activeLookId: 'look:chat', expectedAssetId: 'asset:chat', isLocked: true, selectedAt: 1 } } };
const provider = { providerId: 'makersuite', modelId: 'gemini-image', transport: 'sillyTavernGeminiProxy', capabilities: { referenceImages: { maxCount: 1 } } };

test('production capture freezes the current chat look before later chat/library changes', () => {
    const mutableLibrary = structuredClone(library);
    const mutableChatState = structuredClone(chatState);
    const captured = captureCanonForGeneration({
        library: mutableLibrary, chatState: mutableChatState, identities: [identity],
        references: [{ id: 'host:character', role: 'host-avatar', identityId: identity.id, assetId: 'asset:avatar' }],
    });
    mutableChatState.bindings[identity.id].activeLookId = 'look:later';
    mutableLibrary.assets['asset:chat'].url = '/changed.png';
    assert.equal(captured.canonSnapshot.references[0].id, 'look:chat');
    assert.equal(captured.canonSnapshot.assets['asset:chat'].url, assetUrl);
    assert.equal(Object.isFrozen(captured), true);
    assert.equal(Object.isFrozen(captured.canonSnapshot), true);
});

test('ordinary wand and automatic plans consume the same captured canon and respect the provider cap', () => {
    const captured = captureCanonForGeneration({
        library, chatState, identities: [identity],
        references: [{ id: 'host:character', role: 'host-avatar', identityId: identity.id, assetId: 'asset:avatar' }],
    });
    const make = (invocation) => createGenerationPlan({
        id: `plan:${invocation}`, invocation, provider, prompt: { sourceMessage: 'Ava enters.' },
        canonSnapshot: captured.canonSnapshot, references: captured.references,
    });
    assert.deepEqual(make('wand').references.map((entry) => entry.id), ['look:chat']);
    assert.deepEqual(make('automation').references.map((entry) => entry.id), ['look:chat']);
});

test('broken selection warns once without blocking avatar/description fallback or making a provider request', () => {
    let warningCount = 0;
    let providerRequests = 0;
    const captured = captureCanonForGeneration({
        library,
        chatState: { schema: 1, bindings: { [identity.id]: { activeLookId: 'look:gone', expectedAssetId: 'asset:gone', isLocked: true, selectedAt: 1 } } },
        identities: [identity],
        references: [{ id: 'host:character', role: 'host-avatar', identityId: identity.id, assetId: 'asset:avatar' }],
    });
    notifyBrokenCanon(captured.canonSnapshot.omissions, () => { warningCount++; });
    const plan = createGenerationPlan({
        id: 'plan:broken', invocation: 'wand', provider,
        prompt: { sourceMessage: 'Ava enters.', descriptionText: 'Ava has dark hair.' },
        canonSnapshot: captured.canonSnapshot, references: captured.references,
    });
    assert.equal(warningCount, 1);
    assert.equal(providerRequests, 0);
    assert.deepEqual(plan.references.map((entry) => entry.id), ['host:character']);
    assert.match(plan.prompt.descriptionText, /dark hair/);
    assert.equal(plan.referenceOmissions.filter((entry) => entry.reason === 'missing-look').length, 1);
});

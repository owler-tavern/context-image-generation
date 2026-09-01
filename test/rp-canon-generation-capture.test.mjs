import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCanonForGeneration, notifyBrokenCanon, resolveHostAvatarIdentityReferences } from '../lib/rp/canon-generation-capture.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { buildReferenceMessageParts } from '../lib/rp/reference-message-parts.js';

const assetUrl = '/user/images/context-image-generation-appearances/cig-appearance-44444444-4444-4444-8444-444444444444.png';
const identity = { id: 'character:ava.png', kind: 'character', label: 'Ava', aliases: ['ava'] };
const library = {
    schema: 2,
    identities: { [identity.id]: { ...identity, activeLookId: null, looks: [{ id: 'look:chat', assetId: 'asset:chat' }] } },
    assets: { 'asset:chat': { id: 'asset:chat', kind: 'appearance', url: assetUrl, mimeType: 'image/png' } },
};
const chatState = { schema: 1, bindings: { [identity.id]: { activeLookId: 'look:chat', expectedAssetId: 'asset:chat', isLocked: true, selectedAt: 1 } } };
const provider = { providerId: 'makersuite', modelId: 'gemini-image', transport: 'sillyTavernGeminiProxy', capabilities: { referenceImages: { maxCount: 1 } } };

test('production host candidate projection uses the character and persona stable logical IDs', () => {
    assert.deepEqual(resolveHostAvatarIdentityReferences({
        identities: [identity, { id: 'user:persona.png', kind: 'user', label: 'Sam', hostKey: 'persona.png' }],
        activeCharacterAvatar: 'ava.png',
        personaAvatar: 'persona.png',
    }).map(({ id, identityId }) => [id, identityId]), [
        ['host:character', 'character:ava.png'],
        ['host:user', 'user:persona.png'],
    ]);
});

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

test('production-shaped character and persona capture sends only valid canon looks even when the provider cap has room for avatars', () => {
    const persona = { id: 'user:persona.png', kind: 'user', label: 'Sam', aliases: ['sam'] };
    const bothLibrary = structuredClone(library);
    bothLibrary.identities[persona.id] = { ...persona, activeLookId: null, looks: [{ id: 'look:persona', assetId: 'asset:persona' }] };
    bothLibrary.assets['asset:persona'] = { id: 'asset:persona', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-55555555-5555-4555-8555-555555555555.png', mimeType: 'image/png' };
    const bothChat = structuredClone(chatState);
    bothChat.bindings[persona.id] = { activeLookId: 'look:persona', expectedAssetId: 'asset:persona', isLocked: true, selectedAt: 1 };
    const captured = captureCanonForGeneration({
        library: bothLibrary, chatState: bothChat, identities: [identity, persona],
        references: [
            { id: 'host:character', role: 'host-avatar', identityId: 'character:ava.png', assetId: 'asset:avatar-character' },
            { id: 'host:user', role: 'host-avatar', identityId: 'user:persona.png', assetId: 'asset:avatar-user' },
        ],
    });
    const plan = createGenerationPlan({
        id: 'plan:both', invocation: 'wand',
        provider: { ...provider, capabilities: { referenceImages: { maxCount: 4 } } },
        prompt: { sourceMessage: 'Ava meets Sam.', descriptionText: 'Ava and Sam retain their written descriptions.' },
        canonSnapshot: captured.canonSnapshot, references: captured.references,
    });
    const parts = buildReferenceMessageParts(plan, {
        ...plan.referenceAssets,
        'asset:avatar-character': { data: 'wrong-character-avatar', mimeType: 'image/png' },
        'asset:avatar-user': { data: 'wrong-persona-avatar', mimeType: 'image/png' },
    });
    assert.deepEqual(plan.references.map((entry) => entry.id), ['look:chat', 'look:persona']);
    assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), [assetUrl, bothLibrary.assets['asset:persona'].url]);
    assert.match(plan.prompt.descriptionText, /written descriptions/);
});

test('broken character canon retains its stable matching avatar while valid persona canon suppresses only the persona avatar for wand and automation', () => {
    const persona = { id: 'user:persona.png', kind: 'user', label: 'Sam', aliases: ['sam'] };
    const bothLibrary = structuredClone(library);
    bothLibrary.identities[persona.id] = { ...persona, activeLookId: null, looks: [{ id: 'look:persona', assetId: 'asset:persona' }] };
    bothLibrary.assets['asset:persona'] = { id: 'asset:persona', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-66666666-6666-4666-8666-666666666666.png', mimeType: 'image/png' };
    const brokenChat = { schema: 1, bindings: {
        [identity.id]: { activeLookId: 'look:gone', expectedAssetId: 'asset:gone', isLocked: true, selectedAt: 1 },
        [persona.id]: { activeLookId: 'look:persona', expectedAssetId: 'asset:persona', isLocked: true, selectedAt: 1 },
    } };
    const captured = captureCanonForGeneration({
        library: bothLibrary, chatState: brokenChat, identities: [identity, persona],
        references: [
            { id: 'host:character', role: 'host-avatar', identityId: identity.id, assetId: 'asset:avatar-character' },
            { id: 'host:user', role: 'host-avatar', identityId: persona.id, assetId: 'asset:avatar-user' },
        ],
    });
    for (const invocation of ['wand', 'automation']) {
        const plan = createGenerationPlan({
            id: `plan:broken:${invocation}`, invocation,
            provider: { ...provider, capabilities: { referenceImages: { maxCount: 4 } } },
            prompt: { sourceMessage: 'Ava meets Sam.', descriptionText: 'Ava has dark hair. Sam wears blue.' },
            canonSnapshot: captured.canonSnapshot, references: captured.references,
        });
        assert.deepEqual(plan.references.map((entry) => entry.id), ['look:persona', 'host:character']);
        assert.doesNotMatch(JSON.stringify(plan.references), /host:user/);
        assert.match(plan.prompt.descriptionText, /dark hair/);
    }
    let warnings = 0;
    notifyBrokenCanon(captured.canonSnapshot.omissions, () => { warnings++; });
    assert.equal(warnings, 1);
});

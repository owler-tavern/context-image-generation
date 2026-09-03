import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCanonForGeneration, isCanonReferenceOmission, notifyBrokenCanon, resolveHostAvatarIdentityReferences, selectSceneRelevantAvatarReferences } from '../lib/rp/canon-generation-capture.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { buildReferenceMessageParts, materializeHostAvatarReferenceAssets } from '../lib/rp/reference-message-parts.js';

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

test('scene cast selection keeps only interpreted or explicitly overridden identities while low-confidence absence preserves v2 fallback references', () => {
    const identities = [
        { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        { id: 'character:leo.png', kind: 'character', label: 'Leo', hostKey: 'leo.png' },
        { id: 'user:sam.png', kind: 'user', label: 'Sam', hostKey: 'sam.png' },
    ];
    const references = resolveHostAvatarIdentityReferences({
        identities, activeCharacterAvatar: 'ava.png', personaAvatar: 'sam.png', groupCharacterAvatars: ['ava.png', 'leo.png'],
    });

    assert.deepEqual(selectSceneRelevantAvatarReferences({
        references,
        sceneCast: [{ identityId: 'character:leo.png', confidence: 'high' }],
    }).map((reference) => reference.identityId), ['character:leo.png']);
    assert.deepEqual(selectSceneRelevantAvatarReferences({
        references,
        sceneCast: [],
        castOverrides: [{ identityId: 'user:sam.png', action: 'focus' }],
    }).map((reference) => reference.identityId), ['user:sam.png']);
    assert.deepEqual(selectSceneRelevantAvatarReferences({ references, sceneCast: [] }).map((reference) => reference.identityId), [
        'character:ava.png', 'user:sam.png', 'character:leo.png',
    ]);
});

test('explicit include and focus add only their identity to the confident current cast', () => {
    const identities = [
        { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        { id: 'character:leo.png', kind: 'character', label: 'Leo', hostKey: 'leo.png' },
        { id: 'user:sam.png', kind: 'user', label: 'Sam', hostKey: 'sam.png' },
    ];
    const references = resolveHostAvatarIdentityReferences({
        identities, activeCharacterAvatar: 'ava.png', personaAvatar: 'sam.png', groupCharacterAvatars: ['ava.png', 'leo.png'],
    });
    const productionAvatarCast = [
        { identityId: 'character:ava.png', label: 'Ava', kind: 'character', confidence: 'high' },
        { identityId: 'character:leo.png', label: 'Leo', kind: 'character' },
    ];

    for (const action of ['include', 'focus']) {
        assert.deepEqual(selectSceneRelevantAvatarReferences({
            references,
            sceneCast: productionAvatarCast,
            castOverrides: [{ identityId: 'user:sam.png', action }],
        }).map((reference) => reference.identityId), ['character:ava.png', 'user:sam.png']);
    }
});

test('exclude-only correction removes its identity from the v2 fallback when cast confidence is absent or low', () => {
    const identities = [
        { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        { id: 'character:leo.png', kind: 'character', label: 'Leo', hostKey: 'leo.png' },
        { id: 'user:sam.png', kind: 'user', label: 'Sam', hostKey: 'sam.png' },
    ];
    const references = resolveHostAvatarIdentityReferences({
        identities, activeCharacterAvatar: 'ava.png', personaAvatar: 'sam.png', groupCharacterAvatars: ['ava.png', 'leo.png'],
    });

    for (const sceneCast of [[], [{ identityId: 'character:leo.png', confidence: 'low' }]]) {
        assert.deepEqual(selectSceneRelevantAvatarReferences({
            references,
            sceneCast,
            castOverrides: [{ identityId: 'user:sam.png', action: 'exclude' }],
        }).map((reference) => reference.identityId), ['character:ava.png', 'character:leo.png']);
    }
});

test('avatar transport failures are not routed to the saved-look warning while canon omissions remain eligible', () => {
    assert.equal(isCanonReferenceOmission({ id: 'host:character', reason: 'asset-unavailable', contributor: 'avatar' }), false);
    assert.equal(isCanonReferenceOmission({ id: 'look:gone', reason: 'missing-look' }), true);
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

test('persona-only broken canon independently materializes the production user-avatar fallback with description and one warning', async () => {
    const persona = { id: 'user:persona.png', kind: 'user', label: 'Sam', hostKey: 'persona.png', aliases: ['sam'] };
    const personaLibrary = {
        schema: 2,
        identities: { [persona.id]: { ...persona, activeLookId: null, looks: [] } },
        assets: {},
    };
    const personaChat = { schema: 1, bindings: {
        [persona.id]: { activeLookId: 'look:gone', expectedAssetId: 'asset:gone', isLocked: true, selectedAt: 1 },
    } };
    const hostReferences = resolveHostAvatarIdentityReferences({ identities: [persona], personaAvatar: 'persona.png' });
    const captured = captureCanonForGeneration({ library: personaLibrary, chatState: personaChat, identities: [persona], references: hostReferences });
    let characterReads = 0;
    let userReads = 0;
    const assets = await materializeHostAvatarReferenceAssets({
        references: [...captured.canonSnapshot.references, ...captured.references],
        getCharacterAvatar: async () => { characterReads++; return { data: 'character-data', mimeType: 'image/png' }; },
        getUserAvatar: async () => { userReads++; return { data: 'persona-data', mimeType: 'image/png' }; },
    });
    const plan = createGenerationPlan({
        id: 'plan:persona-only-broken', invocation: 'wand',
        provider: { ...provider, capabilities: { referenceImages: { maxCount: 4 } } },
        prompt: { sourceMessage: 'Sam enters the group scene.', descriptionText: 'Sam has silver hair.' },
        canonSnapshot: captured.canonSnapshot, references: captured.references,
    });
    const parts = buildReferenceMessageParts(plan, assets);
    let warnings = 0;
    notifyBrokenCanon(captured.canonSnapshot.omissions, () => { warnings++; });
    assert.equal(characterReads, 0);
    assert.equal(userReads, 1);
    assert.deepEqual(plan.references.map((reference) => reference.id), ['host:user']);
    assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), ['data:image/png;base64,persona-data']);
    assert.match(plan.prompt.descriptionText, /silver hair/);
    assert.equal(warnings, 1);
});

test('persona-only valid canon suppresses user-avatar materialization', async () => {
    const persona = { id: 'user:persona.png', kind: 'user', label: 'Sam', hostKey: 'persona.png' };
    const personaLibrary = {
        schema: 2,
        identities: { [persona.id]: { ...persona, activeLookId: null, looks: [{ id: 'look:persona', assetId: 'asset:persona' }] } },
        assets: { 'asset:persona': { id: 'asset:persona', kind: 'appearance', url: '/user/images/context-image-generation-appearances/cig-appearance-77777777-7777-4777-8777-777777777777.png', mimeType: 'image/png' } },
    };
    const personaChat = { schema: 1, bindings: { [persona.id]: { activeLookId: 'look:persona', expectedAssetId: 'asset:persona', isLocked: true, selectedAt: 1 } } };
    const captured = captureCanonForGeneration({
        library: personaLibrary, chatState: personaChat, identities: [persona],
        references: resolveHostAvatarIdentityReferences({ identities: [persona], personaAvatar: 'persona.png' }),
    });
    let userReads = 0;
    const assets = await materializeHostAvatarReferenceAssets({
        references: [...captured.canonSnapshot.references, ...captured.references],
        getUserAvatar: async () => { userReads++; return { data: 'wrong-avatar', mimeType: 'image/png' }; },
    });
    assert.equal(userReads, 0);
    assert.deepEqual(captured.references, []);
    assert.deepEqual(assets, {});
});

test('group character references stay distinct and materialize through identity-aware avatar reads', async () => {
    const identities = [
        { id: 'character:ava.png', kind: 'character', label: 'Ava', hostKey: 'ava.png' },
        { id: 'character:leo.png', kind: 'character', label: 'Leo', hostKey: 'leo.png' },
    ];
    const references = resolveHostAvatarIdentityReferences({ identities, activeCharacterAvatar: 'ava.png', groupCharacterAvatars: ['ava.png', 'leo.png'] });
    assert.deepEqual(references.map(({ id, identityId }) => [id, identityId]), [
        ['host:character', 'character:ava.png'],
        ['host:character:character:leo.png', 'character:leo.png'],
    ]);
    const assets = await materializeHostAvatarReferenceAssets({
        references,
        getCharacterAvatar: async (identityId) => ({ data: identityId, mimeType: 'image/png' }),
    });
    assert.deepEqual(Object.keys(assets), ['asset:host-character', 'asset:host-character:character:leo.png']);
    assert.equal(assets['asset:host-character:character:leo.png'].data, 'character:leo.png');
});

test('description source choice suppresses the host avatar reference without changing identity', () => {
    const persona = { id: 'user:persona-b.png', kind: 'user', label: 'Persona B', hostKey: 'persona-b.png' };
    const references = resolveHostAvatarIdentityReferences({
        identities: [persona],
        personaAvatar: 'persona-b.png',
        sourcePreferences: { [persona.id]: { sourceType: 'description' } },
    });
    assert.deepEqual(references, []);
});

test('description choice keeps the stable identity in the provider plan while using written appearance and no avatar asset', () => {
    const persona = { id: 'user:persona-b.png', kind: 'user', label: 'Persona B', hostKey: 'persona-b.png' };
    const captured = captureCanonForGeneration({
        library: { schema: 2, identities: { [persona.id]: { ...persona, looks: [] } }, assets: {} },
        chatState: { schema: 1, appearanceSources: { [persona.id]: { identityId: persona.id, sourceId: persona.id, sourceType: 'description', role: 'persona' } } },
        identities: [persona],
        references: resolveHostAvatarIdentityReferences({ identities: [persona], personaAvatar: persona.hostKey, sourcePreferences: { [persona.id]: { sourceType: 'description' } } }),
    });
    const plan = createGenerationPlan({
        id: 'plan:description-source', invocation: 'director', provider: { ...provider, capabilities: { referenceImages: { maxCount: 4 } } },
        prompt: { sourceMessage: 'Persona B enters.', descriptionText: 'Persona B has short dark hair and a blue jacket.' },
        canonSnapshot: captured.canonSnapshot, references: captured.references, identities: [persona],
    });
    assert.deepEqual(plan.references, []);
    assert.match(plan.prompt.descriptionText, /short dark hair and a blue jacket/);
    assert.equal(plan.identities[0].id, persona.id);
});

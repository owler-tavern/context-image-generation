import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';

const baseInput = {
    id: 'plan-1',
    invocation: 'wand',
    target: { chatId: 'chat.jsonl', messageId: 2, messageFingerprint: 'v1-abcd' },
    provider: {
        providerId: 'makersuite',
        modelId: 'gemini-image',
        transport: 'sillyTavernGeminiProxy',
        capabilities: { referenceImages: { maxCount: 2 } },
    },
    prompt: {
        sourceMessage: 'Ava enters the room.',
        focusText: 'enters the room',
        nearbyMessages: [{ text: 'The rain falls.', speaker: 'Sam' }],
        intent: 'scene',
    },
    identities: [{ id: 'character:ava.png', label: 'Ava', kind: 'character', matchedBy: 'focus' }],
    references: [
        { id: 'look:ava', role: 'identity-look', identityId: 'character:ava.png', assetId: 'asset:ava' },
        { id: 'avatar:ava', role: 'host-avatar', identityId: 'character:ava.png', assetId: 'asset:avatar' },
        { id: 'scene:old', role: 'prior-scene', identityId: null, assetId: 'asset:scene' },
    ],
    options: { aspectRatio: '1:1', imageSize: '1K', systemInstruction: 'Draw the scene.' },
    policy: { source: 'manual', idempotencyKey: 'manual:plan-1' },
};

test('creates an immutable plan snapshot and trims only to a known positive reference cap', () => {
    const plan = createGenerationPlan(baseInput);
    baseInput.prompt.sourceMessage = 'mutated';
    baseInput.options.aspectRatio = '16:9';
    assert.equal(plan.prompt.sourceMessage, 'Ava enters the room.');
    assert.equal(plan.options.aspectRatio, '1:1');
    assert.equal(plan.references.length, 2);
    assert.equal(plan.references[0].id, 'look:ava');
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.prompt), true);
    assert.throws(() => { plan.prompt.focusText = 'changed'; }, TypeError);
});

test('captures an immutable complete route snapshot', () => {
    const modelDefinition = {
        id: 'image-model', providerId: 'fixture', connectionId: 'fixture:primary', transportId: 'openAiImages', endpointClass: 'fixture-openai-images',
        source: { kind: 'manual' },
        routeEvidence: { state: 'verified', source: 'official-docs', observedAt: '2026-08-30T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
    };
    const plan = createGenerationPlan({
        ...baseInput,
        id: 'route-snapshot',
        resolved: {
            connectionId: 'fixture:primary', providerId: 'fixture', modelId: 'image-model', transportId: 'openAiImages',
            endpoint: 'https://fixture.example/v1', endpointClass: 'fixture-openai-images', modelDefinition,
        },
    });

    modelDefinition.connectionId = 'fixture:mutated';
    modelDefinition.endpointClass = 'mutated';
    modelDefinition.routeEvidence.state = 'unverified';
    assert.equal(plan.resolved.connectionId, 'fixture:primary');
    assert.equal(plan.resolved.endpoint, 'https://fixture.example/v1');
    assert.equal(plan.resolved.endpointClass, 'fixture-openai-images');
    assert.equal(plan.resolved.modelDefinition.connectionId, 'fixture:primary');
    assert.equal(plan.resolved.modelDefinition.endpointClass, 'fixture-openai-images');
    assert.equal(plan.resolved.modelDefinition.routeEvidence.state, 'verified');
});

test('captures route confirmation as a generation policy decision', () => {
    const plan = createGenerationPlan({
        ...baseInput,
        id: 'configured-route-confirmation',
        policy: { routeConfirmationAccepted: true },
    });
    assert.equal(plan.policy.routeConfirmationAccepted, true);
});

test('copies direct resolved route evidence into the immutable route snapshot', () => {
    const routeEvidence = { state: 'configured', source: 'user-configured-protocol', observedAt: '2026-08-30T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' };
    const plan = createGenerationPlan({
        ...baseInput,
        id: 'direct-route-evidence',
        resolved: { connectionId: 'fixture:primary', providerId: 'fixture', modelId: 'image-model', transportId: 'openAiImages', routeEvidence },
    });
    routeEvidence.state = 'unverified';
    assert.equal(plan.resolved.routeEvidence.state, 'configured');
    assert.equal(Object.isFrozen(plan.resolved.routeEvidence), true);
});

test('unknown caps admit no references and preserve omission reasons', () => {
    const plan = createGenerationPlan({
        ...baseInput,
        provider: { ...baseInput.provider, capabilities: { referenceImages: {} } },
    });
    assert.deepEqual(plan.references, []);
    assert.deepEqual(plan.referenceOmissions.map((item) => [item.candidate.id, item.reason]), [
        ['look:ava', 'unknown-cap'],
        ['avatar:ava', 'unknown-cap'],
        ['scene:old', 'unknown-cap'],
    ]);
});

test('plan creation ranks candidates before applying the provider cap', () => {
    const plan = createGenerationPlan({
        ...baseInput,
        references: [
            baseInput.references[2],
            baseInput.references[1],
            baseInput.references[0],
        ],
    });
    assert.deepEqual(plan.references.map((reference) => reference.id), ['look:ava', 'avatar:ava']);
    assert.deepEqual(plan.referenceOmissions.map((item) => [item.candidate.id, item.reason]), [
        ['scene:old', 'provider-cap'],
    ]);
});

test('zero-capability routes receive no references and retain provider-agnostic plan fields', () => {
    const plan = createGenerationPlan({
        ...baseInput,
        provider: { ...baseInput.provider, capabilities: { referenceImages: { maxCount: 0 } } },
    });
    assert.deepEqual(plan.references, []);
    assert.equal(plan.invocation, 'wand');
    assert.equal(plan.policy.idempotencyKey, 'manual:plan-1');
});

test('saved appearance references enter the plan only for a positively capped reference route', () => {
    const appearanceLibrary = {
        identities: {
            'character:ava.png': {
                id: 'character:ava.png',
                kind: 'character',
                label: 'Ava',
                looks: [{ id: 'look:gallery:ava', assetId: 'asset:gallery:ava', label: 'Window look' }],
            },
        },
        assets: { 'asset:gallery:ava': { id: 'asset:gallery:ava', source: { galleryId: 'gallery:ava' } } },
    };
    const gallery = [{ id: 'gallery:ava', url: '/images/ava.png' }];
    const capped = createGenerationPlan({
        ...baseInput,
        references: [],
        appearanceLibrary,
        gallery,
        provider: { ...baseInput.provider, capabilities: { referenceImages: { maxCount: 1 } } },
    });
    assert.deepEqual(capped.references.map((reference) => reference.id), ['look:gallery:ava']);

    const unknown = createGenerationPlan({
        ...baseInput,
        references: [],
        appearanceLibrary,
        gallery,
        provider: { ...baseInput.provider, capabilities: { referenceImages: {} } },
    });
    assert.deepEqual(unknown.references, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDirectorCastOverrides, applyDirectorCastToReferences, inferDirectorCast, normalizeDirectorCastOverrides, validateDirectorCastOverrides } from '../lib/rp/director-cast.js';
import { buildSceneGenerationSnapshot } from '../lib/rp/scene-generation.js';
import { createGenerationPlan } from '../lib/generation-plan.js';

const identities = [
    { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
    { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
    { id: 'user:me', label: 'Me', kind: 'user', aliases: ['Me'] },
];

test('Director cast inference exposes only unambiguous interpreted identities with honest defaults', () => {
    const candidates = inferDirectorCast({
        identities,
        interpretation: {
            cast: [{ identityId: 'character:ava', label: 'Ava', kind: 'character', confidence: 'high' }],
            excluded: [{ identityId: 'character:rowan', reason: 'absent' }],
            ambiguities: [{ alias: 'Me', candidates: ['user:me', 'character:ava'] }],
        },
    });
    assert.deepEqual(candidates.map(({ identityId, action }) => [identityId, action]), [
        ['character:ava', 'include'],
        ['character:rowan', 'exclude'],
        ['user:me', 'auto'],
    ]);
});

test('Director cast candidates retain known current-chat identities missed by interpretation as Auto', () => {
    const candidates = inferDirectorCast({
        identities: [
            { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
            { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
            { id: 'user:me', label: 'Me', kind: 'persona', aliases: ['Me'] },
        ],
        interpretation: {
            cast: [{ identityId: 'character:ava', label: 'Ava', confidence: 'high' }],
            excluded: [],
        },
    });
    assert.deepEqual(candidates.map(({ identityId, action, inferredAction }) => [identityId, action, inferredAction]), [
        ['character:ava', 'include', 'include'],
        ['character:rowan', 'auto', 'auto'],
        ['user:me', 'auto', 'auto'],
    ]);
});

test('including an interpreted-missed known identity changes the provider prompt, scene cast, and reference priority', () => {
    const currentChatIdentities = [
        { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
        { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
    ];
    const candidates = inferDirectorCast({
        identities: currentChatIdentities,
        interpretation: { cast: [{ identityId: 'character:ava', confidence: 'high' }], excluded: [] },
    });
    const rowan = candidates.find(({ identityId }) => identityId === 'character:rowan');
    assert.equal(rowan.action, 'auto');

    const snapshot = buildSceneGenerationSnapshot({
        selectedPassage: 'Ava enters the library.',
        clickedMessage: { mes: 'Ava enters the library.' },
        identities: currentChatIdentities,
        castOverrides: [{ identityId: rowan.identityId, action: 'include' }],
    });
    assert.deepEqual(snapshot.state.sceneFacts.cast.map(({ identityId }) => identityId), ['character:ava', 'character:rowan']);
    assert.match(snapshot.prompt, /Include in cast: Rowan\./);

    const plan = createGenerationPlan({
        id: 'director-missed-rowan',
        invocation: 'director',
        target: { chatId: 'chat-a', messageId: 2, messageFingerprint: 'fp-a' },
        provider: { providerId: 'fixture', modelId: 'image', transport: 'fixture', capabilities: { referenceImages: { maxCount: 1 } } },
        prompt: { sourceMessage: snapshot.sourcePassage, focusText: null, intent: 'scene' },
        scene: snapshot,
        identities: currentChatIdentities,
        references: [
            { id: 'look:ava', identityId: 'character:ava', label: 'Ava' },
            { id: 'look:rowan', identityId: 'character:rowan', label: 'Rowan' },
        ],
        options: { castOverrides: [{ identityId: rowan.identityId, action: 'include' }] },
        policy: { source: 'manual', preflightAccepted: true, routeConfirmationAccepted: true },
    });
    assert.equal(plan.references[0].identityId, 'character:rowan');
    assert.deepEqual(plan.options.castOverrides, [{ identityId: 'character:rowan', action: 'include' }]);
    assert.deepEqual(plan.scene.state.sceneFacts.cast.map(({ identityId }) => identityId), ['character:ava', 'character:rowan']);
});

test('Director cast overrides normalize to bounded actions with at most one focus', () => {
    const overrides = normalizeDirectorCastOverrides([
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
        { identityId: 'user:me', action: 'focus' },
        { identityId: 'unknown', action: 'include' },
    ], { allowedIdentityIds: identities.map(({ id }) => id) });
    assert.deepEqual(overrides, [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'include' },
        { identityId: 'user:me', action: 'focus' },
    ]);
});

test('Director auto cast action is explicit but preserves inferred behavior', () => {
    const overrides = normalizeDirectorCastOverrides([{ identityId: 'character:ava', action: 'auto' }], { allowedIdentityIds: ['character:ava'] });
    assert.deepEqual(overrides, [{ identityId: 'character:ava', action: 'auto' }]);
    const applied = applyDirectorCastOverrides({ cast: [{ identityId: 'character:ava', label: 'Ava' }], identities, overrides });
    assert.deepEqual(applied.cast.map(({ identityId }) => identityId), ['character:ava']);
    assert.equal(applied.promptLine, '');
});

test('Director cast overrides explicitly omit excluded people and prioritize one focused identity in scene state', () => {
    const result = applyDirectorCastOverrides({
        cast: [{ identityId: 'character:ava', label: 'Ava', kind: 'character' }, { identityId: 'character:rowan', label: 'Rowan', kind: 'character' }],
        identities,
        overrides: [
            { identityId: 'character:ava', action: 'exclude' },
            { identityId: 'character:rowan', action: 'focus' },
            { identityId: 'user:me', action: 'include' },
        ],
    });
    assert.deepEqual(result.cast.map(({ identityId }) => identityId), ['character:rowan', 'user:me']);
    assert.deepEqual(result.excluded, ['character:ava']);
    assert.equal(result.focusedIdentityId, 'character:rowan');
    assert.match(result.promptLine, /Composition priority: Rowan/);
    assert.match(result.promptLine, /Do not depict: Ava/);
});

test('Director cast reference policy forces included identities, removes excluded identities, and prioritizes focus', () => {
    const result = applyDirectorCastToReferences({
        references: [
            { id: 'look:ava', identityId: 'character:ava', label: 'Ava' },
            { id: 'look:rowan', identityId: 'character:rowan', label: 'Rowan' },
            { id: 'look:lee', identityId: 'character:lee', label: 'Lee' },
        ],
        overrides: [
            { identityId: 'character:ava', action: 'exclude' },
            { identityId: 'character:rowan', action: 'focus' },
        ],
    });
    assert.deepEqual(result.references.map((reference) => reference.id), ['look:rowan', 'look:lee']);
    assert.deepEqual(result.omitted.map((entry) => [entry.id, entry.reason]), [['look:ava', 'cast-excluded']]);
    assert.deepEqual(result.forcedIdentityIds, ['character:rowan']);
});

test('Director cast overrides fail closed when an identity is no longer valid', () => {
    const result = validateDirectorCastOverrides([{ identityId: 'character:missing', action: 'include' }], {
        identities: [{ id: 'character:ava', label: 'Ava' }],
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.invalidIdentityIds, ['character:missing']);
});

test('Director cast overrides alter the provider-facing scene snapshot without changing the selected passage', () => {
    const snapshot = buildSceneGenerationSnapshot({
        selectedPassage: 'Ava and Rowan meet.',
        clickedMessage: { mes: 'Ava and Rowan meet.' },
        identities: [
            { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
            { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
        ],
        castOverrides: [
            { identityId: 'character:ava', action: 'exclude' },
            { identityId: 'character:rowan', action: 'focus' },
        ],
    });
    assert.equal(snapshot.sourcePassage, 'Ava and Rowan meet.');
    assert.deepEqual(snapshot.state.sceneFacts.cast.map((entry) => entry.identityId), ['character:rowan']);
    assert.match(snapshot.prompt, /Do not depict: Ava/);
    assert.match(snapshot.prompt, /Composition priority: Rowan/);
    assert.deepEqual(snapshot.inspection.castOverrides, [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
    ]);
});

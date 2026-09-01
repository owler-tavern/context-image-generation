import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createIterationArtifact,
    createStableArtifactId,
    createIterationInvocationId,
    chooseTwoUpArtifact,
    planIterationAction as rawPlanIterationAction,
    repairPromptDraft,
} from '../lib/rp/iteration-domain.js';

const source = createIterationArtifact({
    artifactId: 'artifact:original',
    sourcePassage: { text: 'Ava waits in the station.', messageId: 'm-1' },
    effectivePrompt: 'Ava waits in the station.',
    references: [
        { id: 'ref:ava-look', role: 'active-look', identityId: 'character:ava', assetId: 'asset:ava-look' },
        { id: 'ref:station', role: 'prior-scene', assetId: 'asset:station' },
    ],
    model: { providerId: 'linkapi', modelId: 'image-model' },
    route: { providerId: 'linkapi', connectionId: 'route:verified' },
    options: { aspectRatio: '16:9', seed: 7 },
    canonSnapshot: {
        activeLook: { identityId: 'character:ava', lookId: 'look:ava' },
        priorScene: { location: 'station', cast: ['character:ava'] },
        chatBackground: 'rainy mystery',
        durableIdentityFacts: { 'character:ava': ['left-handed'] },
    },
});

const verifiedRoute = {
    status: 'verified',
    resolved: true,
    providerId: 'linkapi',
    modelId: 'image-model',
    capabilities: { imageGeneration: true },
};
const reserveInvocation = () => true;
function planIterationAction(input) {
    return rawPlanIterationAction({
        ...input,
        reserveInvocation,
        resolvedRoute: verifiedRoute,
        invocationId: input.invocationId || input.actionId || 'test-invocation',
        paidConsent: input.paidConsent ? { costUnavailableAcknowledged: true, ...input.paidConsent } : input.paidConsent,
    });
}

test('artifact recipes freeze nested provenance and copy caller input', () => {
    const input = { text: 'Ava waits in the station.', messageId: 'm-1' };
    const artifact = createIterationArtifact({
        sourcePassage: input,
        effectivePrompt: 'Ava waits in the station.',
        references: [{ id: 'ref:ava', role: 'active-look', identityId: 'character:ava' }],
        model: { providerId: 'p', modelId: 'm' },
        route: { providerId: 'p', connectionId: 'r' },
        options: { size: 'square' },
        canonSnapshot: { activeLook: { lookId: 'look:a' } },
    });

    input.text = 'changed';
    assert.equal(artifact.sourcePassage.text, 'Ava waits in the station.');
    assert.equal(Object.isFrozen(artifact), true);
    assert.equal(Object.isFrozen(artifact.references), true);
    assert.equal(Object.isFrozen(artifact.provenance.canonSnapshot.activeLook), true);
    assert.throws(() => { artifact.options.size = 'portrait'; }, TypeError);
});

test('every planned action retains the original and creates a distinct artifact', () => {
    const plan = planIterationAction({
        action: 'reuse-recipe',
        sourceArtifact: source,
        actionId: 'reuse-1',
        paidConsent: { approved: true, outputCount: 1 },
    });

    assert.equal(plan.sourceArtifactId, source.artifactId);
    assert.equal(plan.artifacts.length, 1);
    assert.notEqual(plan.artifacts[0].artifactId, source.artifactId);
    assert.equal(plan.artifacts[0].parentArtifactId, source.artifactId);
    assert.deepEqual(source.recipe.options, { aspectRatio: '16:9', seed: 7 });
    assert.equal(plan.dispatch.allowed, true);
    assert.equal(plan.dispatch.network, false);
});

test('vary shot preserves identity and story canon while changing only composition controls', () => {
    const plan = planIterationAction({
        action: 'vary-shot',
        sourceArtifact: source,
        actionId: 'vary-1',
        changes: { composition: { camera: 'low-angle', framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 1 },
    });
    const artifact = plan.artifacts[0];

    assert.deepEqual(artifact.references, source.references);
    assert.deepEqual(artifact.canonSnapshot, source.canonSnapshot);
    assert.deepEqual(artifact.options.composition, { camera: 'low-angle', framing: 'wide' });
    assert.equal(plan.stateRules.includes('preserve-identity-facts'), true);
    assert.equal(plan.stateRules.includes('preserve-story-facts'), true);
});

test('keep characters/change scene retains identity refs but drops obsolete scene state', () => {
    const plan = planIterationAction({
        action: 'keep-characters-change-scene',
        sourceArtifact: source,
        actionId: 'scene-1',
        changes: {
            sourcePassage: { text: 'Ava enters the library.', messageId: 'm-2' },
            prompt: 'Ava enters the library.',
            scene: { location: 'library', cast: ['character:ava'] },
        },
        paidConsent: { approved: true, outputCount: 1 },
    });
    const artifact = plan.artifacts[0];

    assert.deepEqual(artifact.references, [source.references[0]]);
    assert.deepEqual(artifact.canonSnapshot.activeLook, source.canonSnapshot.activeLook);
    assert.equal(artifact.canonSnapshot.chatBackground, null);
    assert.deepEqual(artifact.canonSnapshot.priorScene, { location: 'library', cast: ['character:ava'] });
    assert.equal(plan.stateRules.includes('drop-obsolete-scene-state'), true);
});

test('edit and reuse actions have stable seams and edit only the requested recipe field', () => {
    const edited = planIterationAction({
        action: 'edit-regenerate',
        sourceArtifact: source,
        actionId: 'edit-1',
        changes: { prompt: 'Ava runs through the library.' },
        paidConsent: { approved: true, outputCount: 1 },
    });
    assert.equal(edited.artifacts[0].effectivePrompt, 'Ava runs through the library.');
    assert.deepEqual(edited.artifacts[0].references, source.references);

    const first = planIterationAction({ action: 'reuse-recipe', sourceArtifact: source, actionId: 'same', paidConsent: { approved: true, outputCount: 1 } });
    const second = planIterationAction({ action: 'reuse-recipe', sourceArtifact: source, actionId: 'same', paidConsent: { approved: true, outputCount: 1 } });
    assert.equal(first.artifacts[0].artifactId, second.artifacts[0].artifactId);
});

test('missing explicit paid consent blocks dispatch and two-up records count and unknown cost', () => {
    const blocked = planIterationAction({ action: 'vary-shot', sourceArtifact: source, actionId: 'blocked', changes: { composition: { framing: 'close' } } });
    assert.equal(blocked.status, 'consent-required');
    assert.equal(blocked.dispatch.allowed, false);
    assert.equal(blocked.consent.required, true);

    const twoUp = planIterationAction({
        action: 'vary-shot',
        sourceArtifact: source,
        actionId: 'two-up',
        twoUp: true,
        changes: { composition: { framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 2 },
    });
    assert.equal(twoUp.artifacts.length, 2);
    assert.equal(twoUp.consent.outputCount, 2);
    assert.equal(twoUp.consent.cost, null);
    assert.equal(twoUp.consent.costDisclosure, 'unknown');
    assert.notEqual(twoUp.artifacts[0].artifactId, twoUp.artifacts[1].artifactId);
});

test('retry with repaired prompt returns a reviewable draft and never permits automatic paid dispatch', () => {
    const draft = repairPromptDraft('Ava enters the library (holding a lantern');
    assert.equal(draft.status, 'repaired');
    assert.equal(draft.dispatchAllowed, false);
    assert.match(draft.repairedPrompt, /\)$/u);

    const plan = planIterationAction({
        action: 'retry-repaired-prompt',
        sourceArtifact: source,
        actionId: 'retry-1',
        changes: { prompt: 'Ava enters the library (holding a lantern' },
        paidConsent: { approved: true, outputCount: 1 },
    });
    assert.equal(plan.status, 'draft-review');
    assert.equal(plan.dispatch.allowed, false);
    assert.equal(plan.dispatch.reason, 'manual-confirmation-required');
    assert.equal(plan.artifacts[0].effectivePrompt, draft.repairedPrompt);
});

test('making canonical roles updates only selected active look, prior scene, or chat background', () => {
    const plan = planIterationAction({
        action: 'make-canonical-roles',
        sourceArtifact: source,
        actionId: 'canon-1',
        changes: {
            roles: {
                activeLook: { identityId: 'character:ava', lookId: 'look:new' },
                priorScene: { location: 'library' },
                chatBackground: 'quiet gothic suspense',
            },
        },
    });
    assert.equal(plan.artifacts[0].artifactId, source.artifactId);
    assert.deepEqual(plan.mutation.roles, {
        activeLook: { identityId: 'character:ava', lookId: 'look:new' },
        priorScene: { location: 'library' },
        chatBackground: 'quiet gothic suspense',
    });
    assert.equal(plan.dispatch.allowed, false);
    assert.equal(plan.dispatch.reason, 'canon-update-only');
});

test('stable artifact ids depend on action identity and output index', () => {
    const first = createStableArtifactId({ sourceArtifactId: source.artifactId, action: 'vary-shot', actionId: 'a', outputIndex: 0 });
    const second = createStableArtifactId({ sourceArtifactId: source.artifactId, action: 'vary-shot', actionId: 'a', outputIndex: 0 });
    const other = createStableArtifactId({ sourceArtifactId: source.artifactId, action: 'vary-shot', actionId: 'a', outputIndex: 1 });
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.match(first, /^artifact:[a-f0-9]{16}$/u);
});

test('stable ID construction has no implicit invocation default and UUID helper accepts an injected generator', () => {
    assert.throws(() => createStableArtifactId({ sourceArtifactId: 'artifact:a', action: 'reuse-recipe' }), /invocationId/u);
    assert.equal(createIterationInvocationId({ randomUUID: () => 'uuid-123' }), 'uuid-123');
});

test('UI action labels normalize to one stable domain action without freezing caller state', () => {
    const mutableSource = {
        artifactId: 'artifact:mutable',
        effectivePrompt: 'Ava waits.',
        references: [],
        model: {}, route: {}, options: {}, canonSnapshot: {},
    };
    const plan = planIterationAction({
        action: 'edit-and-regenerate',
        sourceArtifact: mutableSource,
        actionId: 'alias',
        changes: { prompt: 'Ava runs.' },
        paidConsent: { approved: true, outputCount: 1 },
    });
    assert.equal(plan.action, 'edit-regenerate');
    assert.equal(plan.artifacts[0].effectivePrompt, 'Ava runs.');
    assert.equal(Object.isFrozen(mutableSource), false);
});

test('canonical role planning accepts one role/value pair as well as a role map', () => {
    const plan = planIterationAction({
        action: 'make-canonical',
        sourceArtifact: source,
        actionId: 'canon-single',
        changes: { role: 'chat-background', value: 'quiet suspense' },
    });
    assert.equal(plan.action, 'make-canonical-roles');
    assert.equal(plan.mutation.roles.chatBackground, 'quiet suspense');
});

test('planning remains provider-independent even when network access would fail', () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('provider/network must not be called'); };
    try {
        const plan = planIterationAction({ action: 'reuse-recipe', sourceArtifact: source });
        assert.equal(plan.dispatch.network, false);
        assert.equal(plan.artifacts.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('two-up consent preserves caller claims and requires exact count plus cost acknowledgement', () => {
    const mismatch = rawPlanIterationAction({
        action: 'vary-shot', sourceArtifact: source, invocationId: 'two-up-mismatch', twoUp: true,
        resolvedRoute: verifiedRoute, reserveInvocation,
        changes: { composition: { framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 1, cost: 0.04 },
    });
    assert.equal(mismatch.status, 'consent-required');
    assert.equal(mismatch.consent.outputCount, 1);
    const noCost = rawPlanIterationAction({
        action: 'vary-shot', sourceArtifact: source, invocationId: 'two-up-no-cost', twoUp: true,
        resolvedRoute: verifiedRoute, reserveInvocation,
        changes: { composition: { framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 2 },
    });
    assert.equal(noCost.status, 'consent-required');
    const ready = rawPlanIterationAction({
        action: 'vary-shot', sourceArtifact: source, invocationId: 'two-up-cost', twoUp: true,
        resolvedRoute: verifiedRoute, reserveInvocation,
        changes: { composition: { framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 2, cost: 0.08 },
    });
    assert.equal(ready.status, 'ready');
});

test('missing or reused invocation IDs are rejected by the injected reservation seam', () => {
    assert.throws(() => rawPlanIterationAction({ action: 'reuse-recipe', sourceArtifact: source, reserveInvocation }), /invocationId/u);
    assert.throws(() => rawPlanIterationAction({
        action: 'reuse-recipe', sourceArtifact: source, invocationId: 'already-used', resolvedRoute: verifiedRoute,
        reserveInvocation: () => false,
    }), /already reserved/u);
});

test('generation dispatch remains unavailable without verified route and image capability evidence', () => {
    const plan = rawPlanIterationAction({ action: 'reuse-recipe', sourceArtifact: source, invocationId: 'no-route', reserveInvocation, paidConsent: { approved: true, outputCount: 1, cost: 0.01 } });
    assert.equal(plan.dispatch.allowed, false);
    assert.equal(plan.dispatch.reason, 'verified-route-and-capability-required');
});

test('a separately injected verified capability tripwire can complete a resolved route', () => {
    const plan = rawPlanIterationAction({
        action: 'reuse-recipe', sourceArtifact: source, invocationId: 'separate-capability', reserveInvocation,
        resolvedRoute: { status: 'verified', resolved: true, providerId: 'linkapi', modelId: 'image-model' },
        capabilityTripwire: true,
        paidConsent: { approved: true, outputCount: 1, cost: 0.01 },
    });
    assert.equal(plan.dispatch.allowed, true);
});

test('change-scene requires fresh source passage, prompt, and current state and removes old scene context', () => {
    const plan = rawPlanIterationAction({
        action: 'keep-characters-change-scene', sourceArtifact: source, invocationId: 'fresh-scene',
        reserveInvocation, resolvedRoute: verifiedRoute,
        changes: {
            sourcePassage: { text: 'Ava enters the library.', messageId: 'm-2' },
            prompt: 'Ava enters the library.',
            scene: { location: 'library', cast: ['character:ava'] },
        },
        paidConsent: { approved: true, outputCount: 1, cost: 0.01 },
    });
    assert.deepEqual(plan.artifacts[0].sourcePassage, { text: 'Ava enters the library.', messageId: 'm-2' });
    assert.equal(plan.artifacts[0].effectivePrompt, 'Ava enters the library.');
    assert.equal(plan.artifacts[0].canonSnapshot.priorScene.location, 'library');
    assert.equal(plan.artifacts[0].canonSnapshot.chatBackground, null);
    assert.deepEqual(plan.artifacts[0].canonSnapshot.activeLook, source.canonSnapshot.activeLook);
    assert.throws(() => rawPlanIterationAction({
        action: 'keep-characters-change-scene', sourceArtifact: source, invocationId: 'stale-scene', reserveInvocation,
        resolvedRoute: verifiedRoute, changes: { sourcePassage: { text: 'old' }, prompt: 'Ava waits at the station.', scene: { location: 'library' } },
    }), /stale scene/u);
});

test('edit rejects an empty prompt and vary-shot merges controls into the effective prompt', () => {
    assert.throws(() => rawPlanIterationAction({ action: 'edit-regenerate', sourceArtifact: source, invocationId: 'empty-edit', reserveInvocation, changes: { prompt: '   ' } }), /prompt/u);
    const plan = rawPlanIterationAction({
        action: 'vary-shot', sourceArtifact: source, invocationId: 'vary-controls', reserveInvocation,
        resolvedRoute: verifiedRoute, changes: { composition: { camera: 'low-angle' } },
        paidConsent: { approved: true, outputCount: 1, costUnavailableAcknowledged: true },
    });
    assert.match(plan.artifacts[0].effectivePrompt, /camera=low-angle/u);
    assert.equal(plan.artifacts[0].options.composition.camera, 'low-angle');
});

test('make-canonical validates exact non-empty roles and plans persistence against the selected artifact', () => {
    const plan = rawPlanIterationAction({
        action: 'make-canonical-roles', sourceArtifact: source, invocationId: 'canon-mutation', reserveInvocation,
        changes: { roles: { chatBackground: 'quiet suspense' } },
    });
    assert.equal(plan.artifacts[0].artifactId, source.artifactId);
    assert.deepEqual(plan.mutation, { operation: 'update-canonical-roles', targetArtifactId: source.artifactId, roles: { chatBackground: 'quiet suspense' } });
    assert.throws(() => rawPlanIterationAction({ action: 'make-canonical-roles', sourceArtifact: source, invocationId: 'canon-unknown', reserveInvocation, changes: { roles: { unknown: 'x' } } }), /unknown canonical role/u);
    assert.throws(() => rawPlanIterationAction({ action: 'make-canonical-roles', sourceArtifact: source, invocationId: 'canon-empty', reserveInvocation, changes: { roles: { chatBackground: ' ' } } }), /empty/u);
});

test('two-up retention stays awaiting selection until one output is explicitly chosen', () => {
    const plan = planIterationAction({
        action: 'vary-shot', sourceArtifact: source, actionId: 'choose-two-up', twoUp: true,
        changes: { composition: { framing: 'wide' } },
        paidConsent: { approved: true, outputCount: 2, costUnavailableAcknowledged: true },
    });
    const selected = chooseTwoUpArtifact(plan, plan.artifacts[1].artifactId);
    assert.equal(plan.retention.status, 'awaiting-selection');
    assert.equal(selected.retention.status, 'selected');
    assert.equal(selected.retention.chosenArtifactId, plan.artifacts[1].artifactId);
    assert.deepEqual(selected.retention.discardArtifactIds, [plan.artifacts[0].artifactId]);
});

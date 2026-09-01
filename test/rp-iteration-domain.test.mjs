import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createIterationArtifact,
    createStableArtifactId,
    planIterationAction,
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
        changes: { scene: { location: 'library', cast: ['character:ava'] } },
        paidConsent: { approved: true, outputCount: 1 },
    });
    const artifact = plan.artifacts[0];

    assert.deepEqual(artifact.references, [source.references[0]]);
    assert.deepEqual(artifact.canonSnapshot.activeLook, source.canonSnapshot.activeLook);
    assert.deepEqual(artifact.canonSnapshot.chatBackground, source.canonSnapshot.chatBackground);
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
    const blocked = planIterationAction({ action: 'vary-shot', sourceArtifact: source, actionId: 'blocked' });
    assert.equal(blocked.status, 'consent-required');
    assert.equal(blocked.dispatch.allowed, false);
    assert.equal(blocked.consent.required, true);

    const twoUp = planIterationAction({
        action: 'vary-shot',
        sourceArtifact: source,
        actionId: 'two-up',
        twoUp: true,
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
    assert.deepEqual(plan.artifacts[0].canonSnapshot, {
        activeLook: { identityId: 'character:ava', lookId: 'look:new' },
        priorScene: { location: 'library' },
        chatBackground: 'quiet gothic suspense',
        durableIdentityFacts: source.canonSnapshot.durableIdentityFacts,
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
    assert.equal(plan.artifacts[0].canonSnapshot.chatBackground, 'quiet suspense');
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

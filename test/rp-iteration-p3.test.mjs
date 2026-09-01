import test from 'node:test';
import assert from 'node:assert/strict';
import { createIterationArtifact, planIterationAction, sanitizeIterationArtifactForStorage } from '../lib/rp/iteration-domain.js';
import { createIterationSurfaceController } from '../lib/rp/iteration-ui.js';

const source = createIterationArtifact({
    artifactId: 'artifact:p3-source',
    sourcePassage: { text: 'Ava waits.', messageId: 'm-1' },
    effectivePrompt: 'Ava waits.',
    references: [{ id: 'look:ava', role: 'identity-look', identityId: 'ava', assetId: 'asset:ava' }],
    model: { providerId: 'p', modelId: 'm', transportId: 't' },
    route: { providerId: 'p', modelId: 'm', transportId: 't', connectionId: 'c' },
    options: { aspectRatio: '1:1' },
    canonSnapshot: {},
});
const generationPlan = { planId: 'registry:p3', revision: 'r1', capabilities: { imageGeneration: true } };
const common = {
    sourceArtifact: source,
    generationPlan,
    reserveInvocation: () => true,
    verifyGenerationPlan: ({ planId, revision }) => ({ status: 'verified', planId, revision, authorityToken: 'a', routeResolved: true, capabilities: { imageGeneration: true } }),
};

test('production single-output submit dispatches without a paid quote', async () => {
    const calls = [];
    const controller = createIterationSurfaceController({
        ...common,
        allowUnquotedSingle: true,
        dispatchCoordinator: async (plan) => {
            calls.push(plan);
            return { status: 'completed', planId: plan.planId, invocationId: plan.invocationId, outputCount: 1, artifacts: plan.artifacts };
        },
        persistArtifact: async () => ({ status: 'saved' }),
        readbackArtifact: async ({ artifact, plan }) => ({ status: 'confirmed', artifactId: artifact.artifactId, planId: plan.planId, invocationId: plan.invocationId }),
        readbackOriginalArtifact: async ({ originalArtifact, plan }) => ({ status: 'confirmed', artifactId: originalArtifact.artifactId, planId: plan.planId, invocationId: plan.invocationId }),
    });
    const result = await controller.submit({ action: 'reuse-recipe', invocationId: 'p3-single' });
    assert.equal(result.status, 'completed');
    assert.equal(calls.length, 1);
});

test('production two-up is unavailable even when a caller supplies a finite quote', async () => {
    const controller = createIterationSurfaceController({ ...common, twoUpAvailable: false, estimateCost: async () => ({ quoteId: 'q', amount: 0.08, currency: 'USD', expiresAt: '2999-01-01' }) });
    const result = await controller.submit({ action: 'reuse-recipe', twoUp: true, invocationId: 'p3-two-up', consent: { approved: true, outputCount: 2, quoteId: 'q', amount: 0.08, currency: 'USD', expiresAt: '2999-01-01' } });
    assert.equal(result.status, 'error');
    assert.match(result.error, /two-up.*unavailable/i);
});

test('repaired prompt confirmation blocks edit and regenerate', async () => {
    const calls = [];
    const controller = createIterationSurfaceController({
        ...common,
        estimateCost: async () => { throw new Error('single output must not quote'); },
        dispatchCoordinator: () => ({ status: 'completed', planId: 'plan', invocationId: 'p3-edit', outputCount: 1, artifacts: [] }),
        persistArtifact: async () => ({ status: 'confirmed' }),
        readbackArtifact: async () => ({ status: 'confirmed' }),
        readbackOriginalArtifact: async () => ({ status: 'confirmed' }),
    });
    controller.preparePrompt('Ava (waits');
    const blocked = await controller.submit({ action: 'edit-regenerate', invocationId: 'p3-edit' });
    assert.equal(blocked.status, 'draft-review');
    assert.equal(calls.length, 0);
});

test('persisted iteration metadata omits provider messages, assets, URLs, and secrets', () => {
    const stored = sanitizeIterationArtifactForStorage({
        ...source,
        effectivePrompt: 'Ava waits.',
        providerMessages: [{ role: 'user', content: 'secret context' }],
        imageData: 'AAAA',
        generationPlan: { planId: 'p', revision: 'r', messages: [{ content: 'raw' }], referenceAssets: { 'asset:1': { data: 'AAAA' } } },
        references: [{ id: 'r', role: 'identity-look', assetId: 'asset:1', data: 'AAAA', url: 'data:image/png;base64,AAAA' }],
        options: { systemInstruction: 'secret', style: 'cinematic' },
        recipe: { ...source.recipe, effectivePrompt: 'Ava waits.', references: [{ id: 'r', role: 'identity-look', assetId: 'asset:1', data: 'AAAA', url: 'data:image/png;base64,AAAA' }], options: { systemInstruction: 'secret', style: 'cinematic' } },
    });
    const serialized = JSON.stringify(stored);
    assert.doesNotMatch(serialized, /AAAA|data:image|providerMessages|secret context|systemInstruction|messages|referenceAssets/u);
    assert.equal(stored.references[0].assetId, 'asset:1');
});

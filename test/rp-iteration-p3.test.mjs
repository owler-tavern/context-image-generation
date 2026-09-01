import test from 'node:test';
import assert from 'node:assert/strict';
import { createIterationArtifact, planIterationAction, sanitizeIterationArtifactForStorage } from '../lib/rp/iteration-domain.js';
import { createIterationSurfaceController } from '../lib/rp/iteration-ui.js';
import { attachGeneratedImageSafely } from '../lib/rp-attachment.js';

const source = createIterationArtifact({
    artifactId: 'artifact:p3-source',
    sourcePassage: { text: 'Ava waits.', messageId: 'm-1', userVisible: true },
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

test('save/reload persistence sanitizes both chat media and Gallery iteration recipes', async () => {
    const artifact = {
        ...source,
        generationPlan: {
            planId: 'plan:p3',
            revision: 'route:r1',
            messages: [{ role: 'user', content: 'raw provider context' }],
            referenceAssets: { 'asset:ava': { data: 'AAAA', url: 'data:image/png;base64,AAAA' } },
        },
        providerMessages: [{ role: 'user', content: 'raw provider context' }],
        imageData: 'AAAA',
    };
    const message = { extra: { media: [] } };
    let chatJson;
    let galleryJson;
    const attached = await attachGeneratedImageSafely({
        target: { chatId: 'chat:p3', messageId: 1 },
        prompt: 'Ava waits.',
        generate: async () => ({ imageData: 'AAAA', __cigIterationArtifact: artifact }),
        saveImage: async () => 'context-image-generation/cig.png',
        getCurrentTarget: () => ({ safe: true, message }),
        appendMedia: ({ storedIterationArtifact }) => {
            message.extra.media.push({ cig_iteration_artifact: storedIterationArtifact });
            chatJson = JSON.stringify(message.extra.media.at(-1));
        },
        saveChat: async () => ({ saved: true }),
        addToGallery: async (_image, _prompt, _messageId, _path, metadata) => {
            galleryJson = JSON.stringify(metadata?.iterationArtifact || null);
        },
        notify: () => {},
    });
    assert.equal(attached, true);
    assert.equal(JSON.parse(chatJson).cig_iteration_artifact.recipeAvailable, true);
    assert.equal(JSON.parse(chatJson).cig_iteration_artifact.sourcePassage.text, 'Ava waits.');
    assert.deepEqual(JSON.parse(galleryJson), JSON.parse(chatJson).cig_iteration_artifact);
    assert.doesNotMatch(`${chatJson}${galleryJson}`, /raw provider context|AAAA|data:image|referenceAssets|providerMessages/u);

    const reloaded = JSON.parse(chatJson).cig_iteration_artifact;
    assert.equal(reloaded.sourcePassage.text, 'Ava waits.');
    assert.equal(reloaded.recipeAvailable, true);
    const reused = planIterationAction({
        action: 'reuse-recipe',
        sourceArtifact: reloaded,
        invocationId: 'reload-reuse',
        reserveInvocation: () => true,
        allowUnquotedSingle: true,
        generationPlan: { planId: 'plan:p3', revision: 'route:r1', capabilities: { imageGeneration: true } },
        verifyGenerationPlan: ({ planId, revision }) => ({ status: 'verified', planId, revision, authorityToken: 'a', routeResolved: true, capabilities: { imageGeneration: true } }),
    });
    assert.equal(reused.artifacts[0].sourcePassage.text, 'Ava waits.');
});

test('persisted recipe without explicitly user-visible source text is unavailable', () => {
    const hiddenSourcePassage = { text: 'hidden context', messageId: 'm-1' };
    const stored = sanitizeIterationArtifactForStorage({ ...source, sourcePassage: hiddenSourcePassage, recipe: { ...source.recipe, sourcePassage: hiddenSourcePassage } });
    assert.equal(stored.recipeAvailable, false);
    assert.equal(Object.hasOwn(stored.sourcePassage, 'text'), false);
});

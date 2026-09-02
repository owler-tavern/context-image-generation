import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createSlashEntryAdapter,
    createWandEntryAdapter,
} from '../lib/scene-generation/delivery.js';
import { normalizeGenerationRequest } from '../lib/scene-generation/contracts.js';
import { handleImageArrowNavigation } from '../lib/rp/image-navigation.js';
import { createCinematicUiController } from '../lib/rp/cinematic-ui.js';
import { sanitizeIterationArtifactForStorage } from '../lib/rp/iteration-domain.js';

function createAuthorityHarness(fakeKernel) {
    const fakeMessageDelivery = { deliver: async () => true };
    const fakePreviewDelivery = { deliver: async ({ artifact }) => `data:${artifact.mimeType};base64,${artifact.imageData}` };
    const wand = createWandEntryAdapter({ kernel: fakeKernel, delivery: fakeMessageDelivery });
    const slash = createSlashEntryAdapter({ kernel: fakeKernel, delivery: fakePreviewDelivery });
    const staged = [];
    const cinematic = createCinematicUiController({
        getSuggestion: () => ({ suggestionId: 'suggestion:1', proposedShot: 'Moonlit courtyard' }),
        stage: async (id) => (staged.push(id), { status: 'staged' }),
    });
    const historical = {
        artifactId: 'artifact:old',
        action: 'vary-shot',
        sourcePassage: { text: 'An old scene', userVisible: true },
        effectivePrompt: 'An old prompt',
        route: { providerId: 'legacy', modelId: 'legacy-model', transportId: 'legacy-route', connectionId: 'legacy:default' },
    };

    return {
        clickWand: () => wand.generate({ prompt: 'current scene', sender: 'Mira', messageId: 2, focusText: null, target: { chatId: 'chat', messageId: 2, messageFingerprint: 'fp' } }),
        runSlash: (prompt) => slash.generate(prompt),
        openSettings: async () => ({ configured: true }),
        navigatePastLastImage: async () => handleImageArrowNavigation({ owned: true, direction: 'next', currentIndex: 1, mediaLength: 2 }),
        renderMessageWithAutoPreviouslyEnabled: async () => ({ auto_generate: 'all', dispatched: false }),
        stageCinematicSuggestion: async () => cinematic.action('stage'),
        openHistoricalIterationArtifact: async () => sanitizeIterationArtifactForStorage(historical),
        staged,
    };
}

test('only wand and slash actions reach the injected generation authority', async () => {
    const dispatched = [];
    const fakeArtifact = { imageData: 'AA==', mimeType: 'image/png' };
    const fakeKernel = { generate: async request => (dispatched.push(request.source), { artifact: fakeArtifact, plan: {}, request }) };
    const harness = createAuthorityHarness(fakeKernel);

    await harness.clickWand();
    await harness.runSlash('a moonlit castle');
    await harness.openSettings();
    await harness.navigatePastLastImage();
    await harness.renderMessageWithAutoPreviouslyEnabled();
    await harness.stageCinematicSuggestion();
    const historical = await harness.openHistoricalIterationArtifact();

    assert.deepEqual(dispatched, ['wand', 'slash']);
    assert.deepEqual(harness.staged, ['suggestion:1']);
    assert.equal(historical.artifactId, 'artifact:old');
    assert.equal(historical.recipeAvailable, true);
});

test('wand and slash each reach the fake kernel exactly once', async () => {
    const counts = { wand: 0, slash: 0 };
    const fakeKernel = {
        generate: async (request) => {
            counts[request.source] += 1;
            return { artifact: { imageData: 'AA==', mimeType: 'image/png' }, plan: {}, request };
        },
    };
    const harness = createAuthorityHarness(fakeKernel);

    await harness.clickWand();
    await harness.runSlash('castle');

    assert.deepEqual(counts, { wand: 1, slash: 1 });
});

test('rejected source values never reach a provider dispatcher', async () => {
    let dispatches = 0;
    const fakeDispatcher = async () => { dispatches += 1; };

    for (const source of ['settings', 'swipe', 'automation', 'iteration', 'cinematic', 'director']) {
        await assert.rejects(async () => {
            const request = normalizeGenerationRequest({ source, destination: 'message', prompt: 'x' });
            await fakeDispatcher(request);
        }, /Unsupported generation source/u);
    }

    assert.equal(dispatches, 0);
});

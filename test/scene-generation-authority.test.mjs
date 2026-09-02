import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    createProductionGenerationEntrypoints,
    registerProductionGenerationEntrypoints,
} from '../lib/scene-generation/production-entrypoints.js';
import { normalizeGenerationRequest } from '../lib/scene-generation/contracts.js';
import { handleImageArrowNavigation } from '../lib/rp/image-navigation.js';
import { createCinematicUiController } from '../lib/rp/cinematic-ui.js';
import { sanitizeIterationArtifactForStorage } from '../lib/rp/iteration-domain.js';

const productionGenerationAuthorityCall = /productionGenerationEntrypoints\s*\.\s*generateFrom(?:Wand|Slash)\s*\(/u;

function createAuthorityHarness(fakeKernel) {
    const fakeMessageDelivery = { deliver: async () => true };
    const fakePreviewDelivery = { deliver: async ({ artifact }) => `data:${artifact.mimeType};base64,${artifact.imageData}` };
    const rendered = [];
    const handlers = {};
    const entrypoints = createProductionGenerationEntrypoints({
        kernel: fakeKernel,
        messageDelivery: fakeMessageDelivery,
        previewGalleryDelivery: fakePreviewDelivery,
        onMessageRendered: async (messageId) => { rendered.push(messageId); },
    });
    registerProductionGenerationEntrypoints(entrypoints, {
        registerWand: (handler) => { handlers.wand = handler; },
        registerSlash: (handler) => { handlers.slash = handler; },
        registerCharacterMessageRendered: (handler) => { handlers.characterRendered = handler; },
        registerUserMessageRendered: (handler) => { handlers.userRendered = handler; },
    });
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
        clickWand: () => handlers.wand({ prompt: 'current scene', sender: 'Mira', messageId: 2, focusText: null, target: { chatId: 'chat', messageId: 2, messageFingerprint: 'fp' } }),
        runSlash: (prompt) => handlers.slash(prompt),
        navigatePastLastImage: async () => handleImageArrowNavigation({ owned: true, direction: 'next', currentIndex: 1, mediaLength: 2 }),
        renderMessageWithAutoPreviouslyEnabled: async () => {
            await handlers.characterRendered(7);
            await handlers.userRendered(8);
            return { auto_generate: 'all', dispatched: false };
        },
        stageCinematicSuggestion: async () => cinematic.action('stage'),
        openHistoricalIterationArtifact: async () => sanitizeIterationArtifactForStorage(historical),
        staged,
        rendered,
    };
}

test('only wand and slash actions reach the injected generation authority', async () => {
    const dispatched = [];
    const fakeArtifact = { imageData: 'AA==', mimeType: 'image/png' };
    const fakeKernel = { generate: async request => (dispatched.push(request.source), { artifact: fakeArtifact, plan: {}, request }) };
    const harness = createAuthorityHarness(fakeKernel);
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const renderedMessageBody = index.match(/async function onCigMessageRendered\(messageId\) \{[\s\S]*?\n\}\n\njQuery/u)?.[0] || '';
    const settingsBody = index.match(/async function loadSettings\(\) \{[\s\S]*?selectInitialSettingsTab\(cigSettings\);\r?\n\}/u)?.[0] || '';

    await harness.clickWand();
    await harness.runSlash('a moonlit castle');
    await harness.navigatePastLastImage();
    await harness.renderMessageWithAutoPreviouslyEnabled();
    await harness.stageCinematicSuggestion();
    const historical = await harness.openHistoricalIterationArtifact();

    assert.deepEqual(dispatched, ['wand', 'slash']);
    assert.deepEqual(harness.rendered, [7, 8]);
    assert.deepEqual(harness.staged, ['suggestion:1']);
    assert.equal(historical.artifactId, 'artifact:old');
    assert.equal(historical.recipeAvailable, true);

    // Guard the real production bodies rather than a harness stand-in: rendered
    // messages may add a wand and cinematic context, while Settings may configure
    // preferences, but neither may acquire generation authority.
    assert.match(index, /onMessageRendered: onCigMessageRendered/u);
    assert.match(renderedMessageBody, /injectMessageButton\(messageId\)/u);
    assert.match(settingsBody, /\$\('#cig_provider'\)/u);
    assert.match(settingsBody, /\$\('#cig_use_previous_image'\)/u);
    // The real authority is exposed as source-specific methods, so the guard
    // must reject those calls even though they do not use the generic
    // `.generate(` spelling used by the injected kernel.
    for (const body of [renderedMessageBody, settingsBody]) {
        assert.doesNotMatch(body, /sceneGenerationKernel|dispatchProviderRoute|createProductionGenerationEntrypoints|cigMessageButton|\.generate\(/u);
        assert.doesNotMatch(body, productionGenerationAuthorityCall);
    }
});

test('production authority blacklist catches both source-specific entrypoint calls', () => {
    assert.match('productionGenerationEntrypoints.generateFromWand(request)', productionGenerationAuthorityCall);
    assert.match('productionGenerationEntrypoints . generateFromSlash(request)', productionGenerationAuthorityCall);
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

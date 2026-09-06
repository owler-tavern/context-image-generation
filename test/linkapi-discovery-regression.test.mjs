import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProviderModels } from '../lib/providers/model-discovery.js';
import { mergeDiscoveryModelRecords } from '../lib/providers/model-manager.js';
import { projectProviderUi } from '../lib/providers/ui-projection.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { experimentalModelPreflightKey, hasExperimentalModelPreflightConsent } from '../lib/providers/preflight.js';

test('LinkAPI fetch retains catalog IDs beyond the four built-in suggestions through reload and dropdown projection', async () => {
    const ids = ['gpt-image-2', 'new-image-route', 'gpt-4.1'];
    const result = await discoverProviderModels({
        providerId: 'linkapi', apiKey: 'fixture',
        fetchImpl: async () => new Response(JSON.stringify({ data: ids.map(id => ({ id })) })),
    });
    assert.equal(result.warning, undefined);
    assert.deepEqual(result.models.map(model => model.id).sort(), [...ids].sort());
    const saved = JSON.parse(JSON.stringify(mergeDiscoveryModelRecords([], result, 'linkapi')));
    const ui = projectProviderUi('linkapi', 'gpt-image-2', { localEntries: saved });
    for (const id of ids) assert.ok(ui.models.some(model => model.id === id), id);
    const documented = saved.find(model => model.id === 'gpt-image-2');
    assert.equal(documented.transportId, 'openAiImages');
    assert.equal(documented.routeEvidence.source, 'official-docs');
    assert.equal(documented.capabilities.referenceImages.state, 'unknown');
    const consent = { [experimentalModelPreflightKey({ providerId: 'linkapi', modelId: documented.id, transportId: documented.transportId })]: true };
    const plan = createGenerationPlan({
        id: 'linkapi-discovered-route', invocation: 'wand',
        resolved: {
            providerId: 'linkapi', modelId: documented.id, connectionId: 'linkapi:default',
            transportId: 'openai-images', endpoint: 'https://linkapi.ai/v1',
            modelDefinition: documented, routeEvidence: documented.routeEvidence,
            capabilities: documented.capabilities,
        },
        prompt: { sourceMessage: 'A blue ceramic cup' },
        policy: { preflightAccepted: hasExperimentalModelPreflightConsent(consent, { providerId: 'linkapi', modelId: documented.id, transportId: 'openAiImages' }) },
    });
    let dispatched = false;
    await dispatchProviderRoute({
        plan, connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { apiKey: 'fixture', requestOpenAiImages: async () => {
            dispatched = true;
            return { imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', mimeType: 'image/png' };
        } },
    });
    assert.equal(dispatched, true);
    for (const id of ids.slice(1)) {
        const model = saved.find(model => model.id === id);
        assert.equal(model.transportId, null);
        assert.equal(model.routeEvidence.state, 'unverified');
        assert.equal(model.capabilities.imageGeneration.state, 'unknown');
    }
});

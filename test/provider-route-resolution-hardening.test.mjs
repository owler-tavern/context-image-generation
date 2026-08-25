import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function nanoPlan(overrides = {}) {
    return createGenerationPlan({
        id: 'nano-route-hardening',
        invocation: 'wand',
        resolved: {
            connectionId: 'nanogpt:default',
            providerId: 'nanogpt',
            modelId: 'discovered-nano-image',
            transportId: 'openai-images',
            endpoint: 'https://nano-gpt.com/v1',
            modelDefinition: {
                id: 'discovered-nano-image',
                providerId: 'nanogpt',
                transportId: 'openAiImages',
                source: { kind: 'fetched', discoveredAt: '2026-08-25T12:00:00.000Z', sourceLabel: 'NanoGPT detailed catalog' },
                capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic' } },
            },
            capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic' } },
            ...overrides,
        },
        prompt: { sourceMessage: 'a quiet forest' },
    });
}

test('dispatch accepts a captured fetched NanoGPT model definition without requiring a built-in model', async () => {
    let request;
    const result = await dispatchProviderRoute({
        plan: nanoPlan(),
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: {
            requestOpenAiImages: async (value) => { request = value; return { imageData: PNG, mimeType: 'image/png' }; },
        },
    });
    assert.equal(result.imageData, PNG);
    assert.equal(request.model, 'discovered-nano-image');
});

test('dispatch accepts a captured manual NanoGPT model definition with conservative evidence', async () => {
    const plan = nanoPlan({ modelDefinition: {
        id: 'manual-nano-image',
        providerId: 'nanogpt',
        transportId: 'openAiImages',
        source: { kind: 'manual' },
        capabilities: {},
    }, modelId: 'manual-nano-image' });
    const result = await dispatchProviderRoute({
        plan,
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestOpenAiImages: async () => ({ imageData: PNG, mimeType: 'image/png' }) },
    });
    assert.equal(result.imageData, PNG);
    assert.equal(plan.resolved.modelDefinition.source.kind, 'manual');
    assert.equal(plan.resolved.modelDefinition.capabilities.imageGeneration.state, 'unknown');
});

test('dispatch rejects a forged NanoGPT endpoint before any provider request', async () => {
    let called = false;
    await assert.rejects(dispatchProviderRoute({
        plan: nanoPlan({ endpoint: 'https://attacker.example/v1' }),
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestOpenAiImages: async () => { called = true; return { imageData: PNG, mimeType: 'image/png' }; } },
    }), /endpoint|curated|route/i);
    assert.equal(called, false);
});

test('dispatch rejects a missing NanoGPT endpoint snapshot instead of trusting connection endpoint state', async () => {
    let called = false;
    await assert.rejects(dispatchProviderRoute({
        plan: nanoPlan({ endpoint: undefined }),
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', endpoint: 'https://attacker.example/v1', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestOpenAiImages: async () => { called = true; return { imageData: PNG, mimeType: 'image/png' }; } },
    }), /endpoint|curated|route/i);
    assert.equal(called, false);
});

test('dispatch rejects a forged NanoGPT transport before any provider request', async () => {
    let called = false;
    await assert.rejects(dispatchProviderRoute({
        plan: nanoPlan({ transportId: 'host-chat-image' }),
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestOpenAiImages: async () => { called = true; return { imageData: PNG, mimeType: 'image/png' }; } },
    }), /transport|route/i);
    assert.equal(called, false);
});

test('dispatch rejects a model definition forged for a different provider', async () => {
    await assert.rejects(dispatchProviderRoute({
        plan: nanoPlan({ modelId: 'flux', modelDefinition: {
            id: 'flux',
            providerId: 'openai',
            transportId: 'openAiImages',
            source: { kind: 'fetched' },
            capabilities: {},
        } }),
        connection: { id: 'nanogpt:default', providerId: 'nanogpt', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { requestOpenAiImages: async () => ({ imageData: PNG, mimeType: 'image/png' }) },
    }), /forged|provider|route/i);
});

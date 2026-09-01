import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { createTransportRegistry, dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';
import { normalizeProviderError } from '../lib/providers/errors.js';
import { getModelDefinition } from '../lib/providers/registry.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

function experimentalPlan({ source = 'manual', preflightAccepted = false, providerId = 'fixture', modelId = 'experimental-image', transportId = 'fixture-transport', connectionId = 'fixture:default' } = {}) {
    return createGenerationPlan({
        id: `preflight:${source}:${modelId}`,
        invocation: 'wand',
        resolved: {
            connectionId,
            providerId,
            modelId,
            transportId,
            endpoint: 'https://fixture.example/v1',
            modelDefinition: {
                id: modelId,
                providerId,
                transportId,
                source: { kind: source },
                capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic' } },
            },
            capabilities: { imageGeneration: { state: 'unknown', source: 'heuristic' } },
        },
        prompt: { sourceMessage: 'a quiet forest' },
        policy: { preflightAccepted },
    });
}

function transport(calls) {
    return createTransportRegistry({
        'fixture-transport': {
            id: 'fixture-transport',
            generate: async () => {
                calls.push('request');
                return { imageData: PNG, mimeType: 'image/png' };
            },
        },
    });
}

test('dispatch rejects a connection provider mismatch before secret resolution or adapter execution', async () => {
    const calls = [];
    let resolvedSecret = false;
    await assert.rejects(dispatchProviderRoute({
        plan: experimentalPlan({ preflightAccepted: true }),
        connection: { id: 'fixture:default', providerId: 'other-provider', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: transport(calls), resolveSecret: () => { resolvedSecret = true; return 'secret'; } },
    }), /connection|provider|mismatch/i);
    assert.equal(resolvedSecret, false);
    assert.deepEqual(calls, []);
});

test('dispatch rejects a connection id mismatch before secret resolution or adapter execution', async () => {
    const calls = [];
    let resolvedSecret = false;
    await assert.rejects(dispatchProviderRoute({
        plan: experimentalPlan({ preflightAccepted: true }),
        connection: { id: 'fixture:other', providerId: 'fixture', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: transport(calls), resolveSecret: () => { resolvedSecret = true; return 'secret'; } },
    }), /connection|id|mismatch/i);
    assert.equal(resolvedSecret, false);
    assert.deepEqual(calls, []);
});

test('unknown manual and fetched image models require explicit experimental preflight', async () => {
    for (const source of ['manual', 'fetched']) {
        const calls = [];
        await assert.rejects(dispatchProviderRoute({
            plan: experimentalPlan({ source }),
            connection: { id: 'fixture:default', providerId: 'fixture', enabled: true },
            signal: new AbortController().signal,
            transportContext: { transports: transport(calls) },
        }), /experimental|preflight|confirmation/i);
        assert.deepEqual(calls, [], source);
    }
});

test('explicit experimental preflight does not substitute for verified route evidence', async () => {
    const calls = [];
    await assert.rejects(dispatchProviderRoute({
        plan: experimentalPlan({ source: 'fetched', preflightAccepted: true }),
        connection: { id: 'fixture:default', providerId: 'fixture', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: transport(calls) },
    }), /route evidence|unverified/i);
    assert.deepEqual(calls, []);
});

test('curated built-in image-generation models remain dispatchable without experimental preflight', async () => {
    let called = false;
    const model = getModelDefinition('openai', 'gpt-image-1');
    const result = await dispatchProviderRoute({
        plan: createGenerationPlan({
            id: 'preflight:built-in',
            invocation: 'wand',
            resolved: {
                connectionId: 'openai:default',
                providerId: 'openai',
                modelId: 'gpt-image-1',
                transportId: 'openai-images',
                endpoint: 'https://api.openai.com/v1',
                modelDefinition: model,
                routeEvidence: model.routeEvidence,
            },
            prompt: { sourceMessage: 'a quiet forest' },
        }),
        connection: { id: 'openai:default', providerId: 'openai', enabled: true },
        signal: new AbortController().signal,
        transportContext: {
            requestOpenAiImages: async () => { called = true; return { imageData: PNG, mimeType: 'image/png' }; },
        },
    });
    assert.equal(result.imageData, PNG);
    assert.equal(called, true);
});

test('migration keeps only exact non-secret experimental preflight route keys', () => {
    const migrated = migrateProviderSettings({
        experimental_model_preflight: {
            '["nanogpt","manual-nano-image","openAiImages"]': true,
            '["nanogpt","manual-nano-image","host-chat-image"]': false,
            '["other-provider","model","openAiImages"]': true,
            'not-a-route-key': true,
            '["nanogpt","manual-nano-image","openAiImages"]-secret': 'secret',
        },
    });
    assert.deepEqual(migrated.experimental_model_preflight, {
        '["nanogpt","manual-nano-image","openAiImages"]': true,
        '["nanogpt","manual-nano-image","host-chat-image"]': false,
        '["other-provider","model","openAiImages"]': true,
    });
    assert.doesNotMatch(JSON.stringify(migrated.experimental_model_preflight), /secret/i);
});

test('Manage Models exposes the explicit experimental text-only confirmation and snapshot wiring', async () => {
    const [settings, index, guide] = await Promise.all([
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../DEVELOPER_GUIDE.md', import.meta.url), 'utf8'),
    ]);
    assert.match(settings, /id="cig_experimental_preflight"/);
    assert.match(settings, /Allow experimental text-only generation/);
    assert.match(settings, /endpoint\/model is unverified/i);
    assert.match(index, /experimental_model_preflight/);
    assert.match(index, /preflightAccepted/);
    assert.match(index, /cig_experimental_preflight/);
    assert.match(index, /clearExperimentalPreflightForRoute/);
    assert.match(index, /clearExperimentalPreflightForProvider/);
    assert.match(guide, /experimental text-only generation/i);
});

test('preflight rejection produces a safe Advanced-directed toast message', () => {
    const normalized = normalizeProviderError(new Error('Experimental model route requires explicit preflight confirmation before generation.'), { providerId: 'nanogpt', modelId: 'manual-image' });
    assert.equal(normalized.category, 'preflight_required');
    assert.match(normalized.userMessage, /Advanced.*Manage models.*experimental text-only generation/i);
});

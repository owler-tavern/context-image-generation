import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { createTransportRegistry, dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';
import { normalizeProviderError } from '../lib/providers/errors.js';
import { getModelDefinition } from '../lib/providers/registry.js';
import { experimentalModelPreflightKey, hasExperimentalModelPreflightConsent } from '../lib/providers/preflight.js';
import * as preflight from '../lib/providers/preflight.js';

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

test('unknown manual and fetched image models still require a resolved route', async () => {
    for (const source of ['manual', 'fetched']) {
        const calls = [];
        await assert.rejects(dispatchProviderRoute({
            plan: experimentalPlan({ source }),
            connection: { id: 'fixture:default', providerId: 'fixture', enabled: true },
            signal: new AbortController().signal,
            transportContext: { transports: transport(calls) },
        }), /route evidence|unverified/i);
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

test('Setup replaces experimental consent with an explicit model method and normal generation intent', async () => {
    const [settings, index, guide] = await Promise.all([
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../DEVELOPER_GUIDE.md', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(settings, /cig_experimental_preflight|Allow experimental text-only generation/);
    assert.match(settings, /id="cig_model_method"/);
    assert.match(index, /experimental_model_preflight/);
    assert.match(index, /preflightAccepted/);
    assert.doesNotMatch(index, /cig_experimental_preflight|clearExperimentalPreflightForRoute|clearExperimentalPreflightForProvider/);
});

test('experimental consent survives legacy and canonical OpenAI transport aliases after reload', () => {
    const legacy = { providerId: 'linkapi', modelId: 'gpt-image-2-c', transportId: 'openAiImages' };
    const canonical = { ...legacy, transportId: 'openai-images' };
    const reloadedLegacyConsent = JSON.parse(JSON.stringify({ [JSON.stringify(['linkapi', 'gpt-image-2-c', 'openAiImages'])]: true }));
    const reloadedCanonicalConsent = JSON.parse(JSON.stringify({ [JSON.stringify(['linkapi', 'gpt-image-2-c', 'openai-images'])]: true }));

    assert.equal(experimentalModelPreflightKey(legacy), experimentalModelPreflightKey(canonical));
    assert.equal(hasExperimentalModelPreflightConsent(reloadedLegacyConsent, canonical), true);
    assert.equal(hasExperimentalModelPreflightConsent(reloadedCanonicalConsent, legacy), true);
    assert.equal(hasExperimentalModelPreflightConsent(reloadedCanonicalConsent, { ...legacy, modelId: 'different-image' }), false);
    assert.equal(hasExperimentalModelPreflightConsent(reloadedCanonicalConsent, { ...legacy, providerId: 'other-provider' }), false);
});

test('experimental consent survives legacy and canonical custom Gemini transport aliases after reload', () => {
    const legacy = { providerId: 'connection:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', modelId: 'gemini-image', transportId: 'sillyTavernGeminiProxy' };
    const canonical = { ...legacy, transportId: 'sillytavern-gemini-proxy' };
    const reloadedLegacyConsent = JSON.parse(JSON.stringify({ [JSON.stringify([legacy.providerId, legacy.modelId, legacy.transportId])]: true }));
    const reloadedCanonicalConsent = JSON.parse(JSON.stringify({ [JSON.stringify([canonical.providerId, canonical.modelId, canonical.transportId])]: true }));

    assert.equal(experimentalModelPreflightKey(legacy), experimentalModelPreflightKey(canonical));
    assert.equal(hasExperimentalModelPreflightConsent(reloadedLegacyConsent, canonical), true);
    assert.equal(hasExperimentalModelPreflightConsent(reloadedCanonicalConsent, legacy), true);
});

test('revoking experimental consent clears legacy transport aliases without touching another route', () => {
    const route = { providerId: 'linkapi', modelId: 'gpt-image-2-c', transportId: 'openai-images' };
    const consents = {
        [JSON.stringify(['linkapi', 'gpt-image-2-c', 'openAiImages'])]: true,
        [JSON.stringify(['linkapi', 'different-image', 'openAiImages'])]: true,
    };

    assert.equal(typeof preflight.clearExperimentalModelPreflightConsent, 'function');
    preflight.clearExperimentalModelPreflightConsent(consents, route);

    assert.equal(hasExperimentalModelPreflightConsent(consents, route), false);
    assert.equal(hasExperimentalModelPreflightConsent(consents, { ...route, modelId: 'different-image', transportId: 'openAiImages' }), true);
});

test('preflight rejection produces a safe Advanced-directed toast message', () => {
    const normalized = normalizeProviderError(new Error('Experimental model route requires explicit preflight confirmation before generation.'), { providerId: 'nanogpt', modelId: 'manual-image' });
    assert.equal(normalized.category, 'preflight_required');
    assert.match(normalized.userMessage, /Advanced.*Manage models.*experimental text-only generation/i);
});

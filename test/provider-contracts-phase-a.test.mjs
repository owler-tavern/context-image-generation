import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCapabilityEvidence,
    normalizeModelDefinition,
    normalizeProviderConnection,
    normalizeProviderDefinition,
    capabilityIsSupported,
    unknownCapabilities,
} from '../lib/providers/contracts.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';
import { normalizeModelRecords } from '../lib/providers/model-manager.js';
import { projectCapability } from '../lib/providers/ui-projection.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { readFile } from 'node:fs/promises';

test('normalizes capability evidence and fails closed for unknown claims', () => {
    const unknown = normalizeCapabilityEvidence();
    assert.deepEqual(unknown, { state: 'unknown', source: 'heuristic', confidence: 'low' });
    assert.equal(capabilityIsSupported(unknown), false);
    assert.equal(projectCapability(unknown).enabled, false);

    const supported = normalizeCapabilityEvidence({
        state: 'supported', source: 'curated-fixture', confidence: 'high', observedAt: '2026-08-24T00:00:00.000Z',
    });
    assert.equal(capabilityIsSupported(supported), true);
    assert.equal(projectCapability(supported).enabled, true);
});

test('normalizes provider, connection, and model definitions without secret material', () => {
    const provider = normalizeProviderDefinition({
        id: 'fixture', label: 'Fixture', apiKey: 'must-not-survive', models: [{ id: 'fixture-image', transport: 'openAiImages' }],
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
    });
    assert.equal(provider.id, 'fixture');
    assert.deepEqual(provider.transportIds, ['openAiImages']);
    assert.equal(provider.builtInModels[0].source.kind, 'built-in');
    assert.equal(provider.discovery.kind, 'unsupported');
    assert.equal('apiKey' in provider, false);
    assert.equal(provider.builtInModels[0].posture, 'experimental');

    const connection = normalizeProviderConnection({
        id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', secretRef: 'provider_keys.fixture', enabled: true,
        apiKey: 'must-not-survive',
    }, provider);
    assert.equal(connection.secretRef, 'provider_keys.fixture');
    assert.equal('apiKey' in connection, false);

    const model = normalizeModelDefinition({ id: 'manual', providerId: 'fixture', transport: 'openAiImages', source: 'manual' }, provider);
    assert.equal(model.source.kind, 'manual');
    assert.equal(model.capabilities.imageGeneration.state, 'unknown');
    assert.deepEqual(unknownCapabilities().imageGeneration.state, 'unknown');
});

test('migrates legacy settings additively and idempotently', () => {
    const legacy = {
        provider: 'linkapi', model: 'custom-image', linkapi_key: 'secret',
        provider_keys: { linkapi: 'secret' },
        provider_models: { linkapi: [{ id: 'custom-image', source: 'manual', transport: 'openAiImages' }] },
        aspect_ratio: '1:1', image_size: '1K', thinking_level: 'auto', use_google_search: false,
    };
    const migrated = migrateProviderSettings(legacy);
    assert.equal(migrated.provider, 'linkapi');
    assert.equal(migrated.linkapi_key, 'secret');
    assert.equal(migrated.provider_models.linkapi[0].id, 'custom-image');
    assert.equal(migrated.connections['linkapi:default'].secretRef, 'provider_keys.linkapi');
    assert.equal(migrated.connections['linkapi:default'].secretRef.includes('secret'), false);
    assert.equal(migrated.model_records.linkapi[0].source.kind, 'manual');
    assert.equal(migrated.generation_presets.active.modelId, 'custom-image');
    assert.deepEqual(migrateProviderSettings(migrated), migrated);
});

test('retains fetched discovery timestamp and evidence source on structured records', () => {
    const records = normalizeModelRecords('fixture', [{
        id: 'fetched-image', source: 'fetched', discoveredAt: '2026-08-24T01:02:03.000Z', sourceLabel: 'fixture /models',
    }], { id: 'fixture', transportIds: ['openAiImages'] });
    assert.equal(records[0].source.kind, 'fetched');
    assert.equal(records[0].source.discoveredAt, '2026-08-24T01:02:03.000Z');
    assert.equal(records[0].source.sourceLabel, 'fixture /models');
    assert.equal(records[0].capabilities.imageGeneration.state, 'unknown');
});

test('restores the LinkAPI compatibility mirror when only provider_keys is present', () => {
    const migrated = migrateProviderSettings({ provider_keys: { linkapi: 'legacy-secret' } });
    assert.equal(migrated.linkapi_key, 'legacy-secret');
    assert.equal(migrated.connections['linkapi:default'].secretRef, 'provider_keys.linkapi');
});

test('creates schema 2 resolved snapshot while preserving schema 1 provider callers', () => {
    const plan = createGenerationPlan({
        id: 'plan-v2', invocation: 'wand',
        provider: { providerId: 'linkapi', modelId: 'custom-image', transport: 'openAiImages', capabilities: { referenceImages: {} } },
        prompt: { sourceMessage: 'scene' },
        options: { aspectRatio: '1:1' },
    });
    assert.equal(plan.schema, 2);
    assert.deepEqual(plan.resolved, {
        connectionId: 'linkapi:default', providerId: 'linkapi', modelId: 'custom-image', transportId: 'openAiImages',
        capabilities: plan.resolved.capabilities,
    });
    assert.equal(plan.provider.transport, 'openAiImages');
    assert.equal(plan.idempotencyKey, 'plan-v2');
    assert.equal(plan.policy.preflightAccepted, false);
});

test('accepts a resolved schema-2 input and keeps options immutable', () => {
    const plan = createGenerationPlan({
        id: 'resolved-plan', invocation: 'settings',
        resolved: {
            connectionId: 'fixture:default', providerId: 'fixture', modelId: 'image', transportId: 'openAiImages',
            capabilities: { imageGeneration: { state: 'supported', source: 'live-sanitized', confidence: 'high', observedAt: '2026-08-24T00:00:00.000Z' }, referenceImages: {} },
        },
        prompt: { sourceMessage: 'scene' }, options: { useGoogleSearch: true, thinkingLevel: 'high' },
        policy: { preflightAccepted: true },
    });
    assert.equal(plan.resolved.connectionId, 'fixture:default');
    assert.equal(plan.resolved.transportId, 'openAiImages');
    assert.equal(plan.policy.preflightAccepted, true);
    assert.equal(plan.options.useGoogleSearch, true);
    assert.equal(plan.options.thinkingLevel, 'high');
});

test('loads the additive provider migration at the existing settings boundary', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /migrateProviderSettings/);
    assert.match(source, /migratedProviderSettings\s*=\s*migrateProviderSettings\(existingProviderSettings\)/);
});

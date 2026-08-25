import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCapabilityEvidence,
    normalizeModelDefinition,
    normalizeProviderConnection,
    isSafeSecretRef,
    normalizeProviderDefinition,
    capabilityIsSupported,
    unknownCapabilities,
} from '../lib/providers/contracts.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';
import { normalizeModelRecords, updateModelRecords, toLegacyModelEntries } from '../lib/providers/model-manager.js';
import { projectCapability } from '../lib/providers/ui-projection.js';
import { projectProviderUi } from '../lib/providers/ui-projection.js';
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

    assert.equal(normalizeCapabilityEvidence({ state: 'supported', source: 'live-sanitized', confidence: 'high' }).state, 'unknown');
    assert.equal(normalizeCapabilityEvidence({ state: 'supported', source: 'manual-user', confidence: 'high', observedAt: '2026-08-24T00:00:00.000Z' }).state, 'unknown');
    assert.equal(capabilityIsSupported({ state: 'supported', source: 'live-sanitized' }), false);
});

test('normalizes provider, connection, and model definitions without secret material', () => {
    const provider = normalizeProviderDefinition({
        id: 'fixture', label: 'Fixture', credentialKey: 'fixture', apiKey: 'must-not-survive', models: [{ id: 'fixture-image', transport: 'openAiImages' }],
        ui: { providerInfo: 'safe', nested: { token: 'must-not-survive' } },
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1', headers: { Authorization: 'secret' }, deep: { one: { two: { three: { four: { apiKey: 'secret', safe: 'drop-at-boundary' } } } } } } },
    });
    assert.equal(provider.id, 'fixture');
    assert.deepEqual(provider.transportIds, ['openAiImages']);
    assert.equal(provider.builtInModels[0].source.kind, 'built-in');
    assert.equal(provider.discovery.kind, 'unsupported');
    assert.equal('apiKey' in provider, false);
    assert.equal(provider.builtInModels[0].posture, 'experimental');
    assert.equal('models' in provider, false);
    assert.equal('unknown' in provider, false);
    assert.equal('nested' in provider.ui, false);
    assert.equal('headers' in provider.transports.openAiImages, false);
    assert.equal(provider.transports.openAiImages.deep?.one?.two?.three?.four, undefined);

    const connection = normalizeProviderConnection({
        id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', secretRef: 'provider_keys.fixture', enabled: true,
        apiKey: 'must-not-survive',
    }, provider);
    assert.equal(connection.secretRef, 'provider_keys.fixture');
    assert.equal('apiKey' in connection, false);
    assert.equal(isSafeSecretRef('provider_keys.fixture', 'browser-api-key', provider), true);
    assert.equal(isSafeSecretRef('raw-secret', 'browser-api-key', provider), false);
    assert.equal(isSafeSecretRef('linkapi_key', 'browser-api-key', provider), false);
    assert.equal(isSafeSecretRef('server-secrets.fixture:default', 'server-adapter', provider), true);
    assert.equal(isSafeSecretRef('provider_keys.fixture', 'server-adapter', provider), false);

    const model = normalizeModelDefinition({ id: 'manual', providerId: 'fixture', transport: 'openAiImages', source: 'manual' }, provider);
    assert.equal(model.source.kind, 'manual');
    assert.equal(model.capabilities.imageGeneration.state, 'unknown');
    assert.deepEqual(unknownCapabilities().imageGeneration.state, 'unknown');
});

test('sanitizes pre-existing contract additions and quarantines malformed records', () => {
    const migrated = migrateProviderSettings({
        connections: {
            'linkapi:default': { providerId: 'linkapi', kind: 'browser-api-key', secretRef: 'provider_keys.linkapi', headers: { Authorization: 'Bearer secret' }, apiKey: 'secret' },
            bad: { providerId: 'not-registered', token: 'secret' },
        },
        model_records: {
            linkapi: [
                { id: 'safe', source: { kind: 'manual' }, transportId: 'openAiImages', headers: { token: 'secret' } },
                { id: '', apiKey: 'secret' },
            ],
        },
    });
    assert.deepEqual(migrated.connections['linkapi:default'], {
        id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', secretRef: 'provider_keys.linkapi', enabled: true,
    });
    assert.equal(migrated.model_records.linkapi[0].id, 'safe');
    assert.equal('headers' in migrated.model_records.linkapi[0], false);
    assert.equal(migrated.provider_contracts_quarantine.connections.length > 0, true);
    assert.equal(migrated.provider_contracts_quarantine.modelRecords.length > 0, true);
    assert.doesNotMatch(JSON.stringify(migrated), /Bearer secret/);
});

test('drops raw or wrong-provider secret references during connection migration', () => {
    const migrated = migrateProviderSettings({
        connections: {
            'linkapi:default': { providerId: 'linkapi', kind: 'browser-api-key', secretRef: 'raw-linkapi-secret' },
            'tokenreply:default': { providerId: 'tokenreply', kind: 'browser-api-key', secretRef: 'provider_keys.linkapi' },
        },
    });
    assert.equal(migrated.connections['linkapi:default'].secretRef, 'provider_keys.linkapi');
    assert.equal(migrated.connections['tokenreply:default'].secretRef, 'provider_keys.tokenreply');
    assert.equal(migrated.provider_contracts_quarantine.connections.length >= 2, true);
    assert.doesNotMatch(JSON.stringify(migrated), /raw-linkapi-secret/);
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

test('sanitizes prior raw model discovery state into an allowlisted idempotent record', () => {
    const migrated = migrateProviderSettings({
        model_discovery: {
            tokenreply: {
                evidence: {
                    kind: 'openai-list',
                    observedAt: '2026-08-25T12:00:00.000Z',
                    source: 'provider /models endpoint',
                    retryCount: 2,
                    prompt: 'draw this scene',
                    authorization: 'Bearer sk-live-123456789',
                },
                warning: {
                    code: 'DISCOVERY_AUTH_FAILED',
                    userMessage: 'Bearer sk-live-123456789 draw this prompt data:image/png;base64,AAAA',
                    nested: { token: 'secret' },
                },
                rawBody: 'secret body',
            },
            'unknown-provider': {
                evidence: { kind: 'native', source: 'https://evil.example?token=secret' },
                warning: { code: 'DISCOVERY_FAILED', userMessage: 'raw' },
            },
        },
    });

    assert.deepEqual(migrated.model_discovery, {
        tokenreply: {
            evidence: {
                kind: 'openai-list',
                observedAt: '2026-08-25T12:00:00.000Z',
                source: 'provider /models endpoint',
                retryCount: 2,
            },
            warning: { code: 'DISCOVERY_AUTH_FAILED' },
        },
    });
    assert.doesNotMatch(JSON.stringify(migrated), /sk-live|Bearer|draw this prompt|base64|evil\.example|raw body/i);
    assert.deepEqual(migrateProviderSettings(migrated).model_discovery, migrated.model_discovery);
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

test('projects controls from structured model evidence instead of legacy booleans', () => {
    const ui = projectProviderUi('tokenreply', 'structured-image', {
        localEntries: [{
            id: 'structured-image', providerId: 'tokenreply', transportId: 'openAiImages',
            source: { kind: 'fetched', discoveredAt: '2026-08-24T01:02:03.000Z', sourceLabel: 'provider /models' },
            capabilities: {
                imageGeneration: { state: 'supported', source: 'curated-fixture', confidence: 'high' },
                referenceImages: { state: 'supported', source: 'live-sanitized', confidence: 'high', observedAt: '2026-08-24T01:03:03.000Z' },
                sizes: { state: 'unsupported', source: 'curated-fixture', confidence: 'high' },
                maxReferenceImages: 2,
            },
        }],
    });
    assert.equal(ui.supportsReferenceImages, true);
    assert.equal(ui.referenceImageMaxCount, 2);
    assert.deepEqual(ui.imageSizeOptions, []);
});

test('model manager writes structured authority and a minimal legacy mirror', () => {
    const records = updateModelRecords([], { type: 'upsert', id: 'manual-image', source: 'manual', transportId: 'openAiImages', supportsReferenceImages: true }, 'tokenreply');
    assert.equal(records[0].source.kind, 'manual');
    assert.equal(records[0].capabilities.referenceImages.state, 'unknown');
    assert.deepEqual(toLegacyModelEntries(records), [{ id: 'manual-image', source: 'manual', transport: 'openAiImages' }]);
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
    assert.match(source, /settings\.model_records/);
    assert.match(source, /mergeFetchedModelRecords/);
    assert.match(source, /setProviderModelRecords/);
});

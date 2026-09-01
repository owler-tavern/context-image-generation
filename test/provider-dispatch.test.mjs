import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, resolveProviderRoute } from '../lib/providers/registry.js';
import { DEFAULT_TRANSPORTS, dispatchProviderRoute, promoteCustomConnectionEvidence, promoteCustomModelEvidence } from '../lib/providers/dispatch.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { connectionRevision, migrateCustomConnections } from '../lib/providers/custom-connections.js';
import { experimentalModelPreflightKey, hasExperimentalModelPreflightConsent } from '../lib/providers/preflight.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('dispatches a declarative fixture OpenAI Images provider through its configured URL', async () => {
    PROVIDERS.fixture = {
        id: 'fixture',
        credentialKey: 'fixture',
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
        models: [{ id: 'fixture-image', transport: 'openAiImages', routeEvidence: { state: 'verified', source: 'built-in', observedAt: '2026-08-31T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' }, supportsReferenceImages: false, supportsSize: true, status: 'fixture' }],
    };

    const calls = [];
    try {
        await dispatchProviderRoute({
            route: resolveProviderRoute('fixture', 'fixture-image'),
            modelId: 'fixture-image',
            messages: [],
            prompt: 'fixture scene',
            apiKey: 'fixture-key',
            aspectRatio: '16:9',
            mapAspectRatioToSize: () => '1536x1024',
            requestOpenAiImages: async (request) => { calls.push(request); return { imageData: PNG, mimeType: 'image/png' }; },
            requestSillyTavernImage: async () => { throw new Error('unexpected Gemini dispatch'); },
        });
    } finally {
        delete PROVIDERS.fixture;
    }

    assert.deepEqual(calls, [{
        apiKey: 'fixture-key',
        model: 'fixture-image',
        prompt: 'fixture scene',
        size: '1536x1024',
        baseUrl: 'https://fixture.example/v1',
        providerId: 'fixture',
    }]);
});

test('legacy dispatch rejects a route without verified evidence before a request', async () => {
    PROVIDERS.fixture = {
        id: 'fixture', credentialKey: 'fixture',
        transports: { openAiImages: { baseUrl: 'https://fixture.example/v1' } },
        models: [{ id: 'fixture-image', transport: 'openAiImages' }],
    };
    let requestCalls = 0;
    try {
        await assert.rejects(dispatchProviderRoute({
            route: resolveProviderRoute('fixture', 'fixture-image'), modelId: 'fixture-image', prompt: 'fixture scene', apiKey: 'fixture-key',
            requestOpenAiImages: async () => { requestCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; },
        }), /route evidence/i);
    } finally {
        delete PROVIDERS.fixture;
    }
    assert.equal(requestCalls, 0);
});

test('rejects an unverified fetched route before invoking an adapter', async () => {
    let adapterCalls = 0;
    const plan = createGenerationPlan({
        id: 'unverified-route', invocation: 'wand',
        resolved: {
            connectionId: 'fixture:default', providerId: 'fixture', modelId: 'discovered-image', transportId: 'fixture-adapter',
            endpoint: 'https://fixture.example/v1',
            modelDefinition: { id: 'discovered-image', providerId: 'fixture', transportId: 'fixture-adapter', source: 'fetched' },
        },
        prompt: { sourceMessage: 'A silent field' },
        policy: { preflightAccepted: true },
    });
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { get: () => ({ generate: async () => { adapterCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; } }) } },
    }), /route evidence/i);
    assert.equal(adapterCalls, 0);
});

test('rejects an unlisted LinkAPI gpt-image catalog record before invoking an adapter', async () => {
    let adapterCalls = 0;
    const plan = createGenerationPlan({
        id: 'unlisted-linkapi-route', invocation: 'wand',
        resolved: {
            connectionId: 'linkapi:default', providerId: 'linkapi', modelId: 'gpt-image-unlisted', transportId: 'openai-images',
            endpoint: 'https://linkapi.ai/v1',
            modelDefinition: {
                id: 'gpt-image-unlisted', providerId: 'linkapi', transportId: 'openAiImages', source: 'fetched',
                routeEvidence: { state: 'verified', source: 'built-in', observedAt: '2026-08-30T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
            },
        },
        prompt: { sourceMessage: 'A silent field' }, policy: { preflightAccepted: true },
    });
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { has: () => true, get: () => ({ generate: async () => { adapterCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; } }) } },
    }), /route evidence|unresolved|curated/i);
    assert.equal(adapterCalls, 0);
});

test('rejects a built-in route without verified evidence before invoking an adapter', async () => {
    let adapterCalls = 0;
    const plan = createGenerationPlan({
        id: 'unverified-built-in-route', invocation: 'wand',
        resolved: {
            connectionId: 'linkapi:default', providerId: 'linkapi', modelId: 'gpt-image-2-c', transportId: 'openai-images',
            endpoint: 'https://linkapi.ai/v1',
            modelDefinition: { id: 'gpt-image-2-c', providerId: 'linkapi', transportId: 'openAiImages', source: 'built-in' },
        },
        prompt: { sourceMessage: 'A silent field' },
    });
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { has: () => true, get: () => ({ generate: async () => { adapterCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; } }) } },
    }), /route evidence/i);
    assert.equal(adapterCalls, 0);
});

test('blocks configured routes from automated generation even after manual confirmation', async () => {
    let adapterCalls = 0;
    const plan = createGenerationPlan({
        id: 'configured-automation-route', invocation: 'automation',
        resolved: {
            connectionId: 'fixture:default', providerId: 'fixture', modelId: 'configured-image', transportId: 'fixture-adapter',
            endpoint: 'https://fixture.example/v1',
            modelDefinition: {
                id: 'configured-image', providerId: 'fixture', transportId: 'fixture-adapter', source: 'manual',
                routeEvidence: { state: 'verified', source: 'user-configured-protocol', observedAt: '2026-08-30T00:00:00.000Z', protocol: 'openai-images', requestShapeRevision: 'openai-images-v1' },
            },
        },
        prompt: { sourceMessage: 'A silent field' },
        policy: { source: 'automation', preflightAccepted: true, routeConfirmationAccepted: true },
    });
    await assert.rejects(dispatchProviderRoute({
        plan,
        connection: { id: 'fixture:default', providerId: 'fixture', kind: 'browser-api-key', enabled: true },
        signal: new AbortController().signal,
        transportContext: { transports: { get: () => ({ generate: async () => { adapterCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; } }) } },
    }), /configured route|manual/i);
    assert.equal(adapterCalls, 0);
});

const customConnection = {
    schema: 1,
    id: 'connection:123e4567-e89b-42d3-a456-426614174000',
    label: 'Private Gateway',
    protocol: 'openai-images',
    baseUrl: 'https://gateway.example',
    modelsPath: '/catalog/models',
    generationPath: '/api/images/create',
    credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174000',
    enabled: true,
};

function configuredCustomPlan({ invocation = 'settings', revision = connectionRevision(customConnection), confirmation = true } = {}) {
    return {
        schema: 2,
        id: 'custom-generation',
        idempotencyKey: 'custom-generation',
        invocation,
        resolved: {
            connectionId: customConnection.id,
            providerId: customConnection.id,
            modelId: 'gpt-image-custom',
            transportId: 'openai-images',
            endpointClass: 'custom-openai-images',
            endpoint: 'https://gateway.example/api/images/create',
            routeEvidence: {
                state: 'configured', source: 'user-configured-protocol', observedAt: '2026-08-31T14:00:00.000Z',
                protocol: 'openai-images', requestShapeRevision: 'openai-images-v1', revision,
            },
            capabilities: {},
            modelDefinition: { id: 'gpt-image-custom', providerId: customConnection.id, source: { kind: 'fetched' } },
        },
        prompt: { sourceMessage: 'A quiet lighthouse' },
        messages: [],
        options: {},
        policy: { source: 'manual', routeConfirmationAccepted: confirmation },
    };
}

test('confirmed configured custom route POSTs only the exact generation endpoint and decodes b64_json', async () => {
    const calls = [];
    const revision = connectionRevision(customConnection);
    const result = await dispatchProviderRoute({
        plan: configuredCustomPlan(),
        connection: { ...customConnection, providerId: customConnection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'sk-test-secret',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
            },
        },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gateway.example/api/images/create');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-secret');
    assert.equal(result.mimeType, 'image/png');
    assert.ok(result.imageData);
});

test('custom bearer generation fails closed before any request when its credential cannot be resolved', async () => {
    const revision = connectionRevision(customConnection);
    let fetchCalls = 0;
    let alternateCalls = 0;
    await assert.rejects(dispatchProviderRoute({
        plan: configuredCustomPlan(),
        connection: { ...customConnection, providerId: customConnection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: '',
            fetchImpl: async () => { fetchCalls += 1; throw new Error('must not fetch'); },
            requestOpenAiImages: async () => { alternateCalls += 1; throw new Error('must not use alternate request owner'); },
        },
    }), /credential|key/i);
    assert.equal(fetchCalls, 0);
    assert.equal(alternateCalls, 0);
});

test('the custom OpenAI adapter independently fails closed on an unresolved bearer credential', async () => {
    let fetchCalls = 0;
    await assert.rejects(DEFAULT_TRANSPORTS['openai-images'].generate({
        plan: configuredCustomPlan(),
        connection: customConnection,
        signal: new AbortController().signal,
        transportContext: { fetchImpl: async () => { fetchCalls += 1; throw new Error('must not fetch'); } },
    }), /credential|key/i);
    assert.equal(fetchCalls, 0);
});

test('custom generation keeps the exact-endpoint fetch owner and cannot bypass redirect refusal through the built-in seam', async () => {
    const revision = connectionRevision(customConnection);
    const fetchCalls = [];
    let alternateCalls = 0;
    let injectedAdapterCalls = 0;
    await assert.rejects(dispatchProviderRoute({
        plan: configuredCustomPlan(),
        connection: { ...customConnection, providerId: customConnection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'sk-test-secret',
            requestOpenAiImages: async () => { alternateCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; },
            transports: { get: () => ({ generate: async () => { injectedAdapterCalls += 1; return { imageData: PNG, mimeType: 'image/png' }; } }) },
            fetchImpl: async (url, init) => {
                fetchCalls.push({ url, init });
                return { ok: true, status: 200, redirected: true, url: 'https://evil.example/generate', json: async () => ({ data: [{ b64_json: PNG }] }) };
            },
        },
    }), /redirect/i);
    assert.equal(alternateCalls, 0);
    assert.equal(injectedAdapterCalls, 0);
    assert.deepEqual(fetchCalls.map(({ url }) => url), ['https://gateway.example/api/images/create']);
    assert.equal(fetchCalls[0].init.redirect, 'error');
});

test('custom no-auth generation omits Authorization', async () => {
    const connection = { ...customConnection, credentialRef: null };
    const revision = connectionRevision(connection);
    const plan = configuredCustomPlan({ revision });
    plan.resolved.routeEvidence.revision = revision;
    const calls = [];
    await dispatchProviderRoute({
        plan,
        connection: { ...connection, providerId: connection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }); },
        },
    });
    assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
});

test('a directly downloaded custom URL artifact is decoded before exact-revision promotion', async () => {
    const revision = connectionRevision(customConnection);
    const calls = [];
    const decoded = await dispatchProviderRoute({
        plan: configuredCustomPlan(),
        connection: { ...customConnection, providerId: customConnection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'credential-fixture',
            fetchImpl: async (url, init) => {
                calls.push({ url, init });
                if (url === 'https://gateway.example/api/images/create') {
                    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/image.png' }] }), { status: 200 });
                }
                return new Response(Uint8Array.from(Buffer.from(PNG, 'base64')), { status: 200, headers: { 'content-type': 'image/png' } });
            },
        },
    });
    const promoted = promoteCustomConnectionEvidence({
        connection: customConnection,
        evidence: { state: 'configured', revision, observedAt: '2026-08-31T14:00:00.000Z' },
        decodedResult: decoded,
        now: () => '2026-08-31T14:05:00.000Z',
    });
    assert.deepEqual(calls.map(({ url }) => url), ['https://gateway.example/api/images/create', 'https://cdn.example/image.png']);
    assert.equal(promoted.state, 'verified');
    assert.equal(promoted.revision, revision);
});

test('configured custom routes block automation, swipe, background, missing confirmation, and stale revisions before POST', async () => {
    const revision = connectionRevision(customConnection);
    const cases = [
        ['automation', configuredCustomPlan({ invocation: 'automation' }), revision],
        ['swipe', configuredCustomPlan({ invocation: 'swipe' }), revision],
        ['background', configuredCustomPlan({ invocation: 'background' }), revision],
        ['missing confirmation', configuredCustomPlan({ confirmation: false }), revision],
        ['stale confirmation', configuredCustomPlan(), 'connection-revision:0000000000000000'],
        ['stale route evidence', configuredCustomPlan({ revision: 'connection-revision:0000000000000000' }), revision],
    ];
    for (const [name, plan, confirmedRevision] of cases) {
        let calls = 0;
        await assert.rejects(dispatchProviderRoute({
            plan,
            connection: { ...customConnection, providerId: customConnection.id, confirmedRevision },
            signal: new AbortController().signal,
            transportContext: { fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); } },
        }), /configured route|revision|manual|confirmation/i, name);
        assert.equal(calls, 0, name);
    }
});

test('custom generation rejects redirects and does not produce a promotable result', async () => {
    const revision = connectionRevision(customConnection);
    await assert.rejects(dispatchProviderRoute({
        plan: configuredCustomPlan(),
        connection: { ...customConnection, providerId: customConnection.id, confirmedRevision: revision },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'sk-test-secret',
            fetchImpl: async () => ({ ok: true, status: 200, redirected: true, url: 'https://evil.example/generate', json: async () => ({ data: [{ b64_json: PNG }] }) }),
        },
    }), /redirect/i);
});

test('decoded image success promotes only the exact custom connection revision', () => {
    const revision = connectionRevision(customConnection);
    const evidence = { state: 'configured', revision, observedAt: '2026-08-31T14:00:00.000Z' };
    const promoted = promoteCustomConnectionEvidence({
        connection: customConnection,
        evidence,
        decodedResult: { imageData: PNG, mimeType: 'image/png' },
        now: () => '2026-08-31T14:05:00.000Z',
    });
    assert.deepEqual(promoted, { state: 'verified', revision, observedAt: '2026-08-31T14:05:00.000Z' });

    assert.deepEqual(promoteCustomConnectionEvidence({
        connection: { ...customConnection, generationPath: '/edited' },
        evidence,
        decodedResult: { imageData: PNG, mimeType: 'image/png' },
    }), { state: 'configured', revision: connectionRevision({ ...customConnection, generationPath: '/edited' }), observedAt: undefined });
    assert.equal(promoteCustomConnectionEvidence({ connection: customConnection, evidence, decodedResult: { mimeType: 'image/png' } }), evidence);
});

test('decoded success promotes only the exact custom model and cannot automate an unknown catalog peer', async () => {
    const revision = connectionRevision(customConnection);
    const promotedModel = promoteCustomModelEvidence({
        connection: customConnection,
        modelId: 'image-success',
        decodedResult: { imageData: PNG, mimeType: 'image/png' },
        now: () => '2026-08-31T14:05:00.000Z',
    });
    assert.deepEqual(promotedModel, {
        state: 'supported', revision, observedAt: '2026-08-31T14:05:00.000Z',
    });
    assert.equal(promoteCustomModelEvidence({
        connection: customConnection,
        modelId: 'text-only-peer',
        decodedResult: { mimeType: 'image/png' },
    }), undefined);

    const store = migrateCustomConnections({
        connections: { [customConnection.id]: customConnection },
        models: { [customConnection.id]: [{ id: 'image-success' }, { id: 'text-only-peer' }] },
        evidence: {
            [customConnection.id]: { state: 'verified', revision, observedAt: '2026-08-31T14:05:00.000Z' },
        },
        modelEvidence: { [customConnection.id]: { 'image-success': promotedModel } },
    });
    const succeeded = store.models[customConnection.id].find(({ id }) => id === 'image-success');
    const peer = store.models[customConnection.id].find(({ id }) => id === 'text-only-peer');
    assert.equal(succeeded.capabilities.imageGeneration.state, 'supported');
    assert.equal(peer.capabilities.imageGeneration.state, 'unknown');

    const peerPlan = configuredCustomPlan({ invocation: 'automation' });
    peerPlan.resolved.modelId = 'text-only-peer';
    peerPlan.resolved.routeEvidence = peer.routeEvidence;
    peerPlan.resolved.capabilities = peer.capabilities;
    peerPlan.resolved.modelDefinition = peer;
    peerPlan.policy.preflightAccepted = false;
    let calls = 0;
    await assert.rejects(dispatchProviderRoute({
        plan: peerPlan,
        connection: { ...customConnection, providerId: customConnection.id },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'sk-test-secret',
            fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); },
        },
    }), /experimental model route requires explicit preflight confirmation/i);
    assert.equal(calls, 0);

    const consentedPeerPlan = structuredClone(peerPlan);
    consentedPeerPlan.invocation = 'settings';
    consentedPeerPlan.policy = { ...consentedPeerPlan.policy, source: 'manual', preflightAccepted: true };
    await dispatchProviderRoute({
        plan: consentedPeerPlan,
        connection: { ...customConnection, providerId: customConnection.id },
        signal: new AbortController().signal,
        transportContext: {
            apiKey: 'sk-test-secret',
            fetchImpl: async () => {
                calls += 1;
                return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
            },
        },
    });
    assert.equal(calls, 1);
});

test('experimental consent is scoped to the exact custom model route', () => {
    const imageRoute = { providerId: customConnection.id, modelId: 'image-success', transportId: 'openai-images' };
    const peerRoute = { ...imageRoute, modelId: 'text-only-peer' };
    const consents = { [experimentalModelPreflightKey(imageRoute)]: true };

    assert.equal(hasExperimentalModelPreflightConsent(consents, imageRoute), true);
    assert.equal(hasExperimentalModelPreflightConsent(consents, peerRoute), false);
    assert.notEqual(experimentalModelPreflightKey(imageRoute), experimentalModelPreflightKey(peerRoute));
});

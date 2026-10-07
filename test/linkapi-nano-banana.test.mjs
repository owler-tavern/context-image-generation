import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelDefinition, getProviderDefinition, resolveTransport } from '../lib/providers/registry.js';
import { discoverProviderModels } from '../lib/providers/model-discovery.js';
import { mergeDiscoveryModelRecords, mergeProviderModels } from '../lib/providers/model-manager.js';
import { migrateProviderSettings } from '../lib/providers/settings-migration.js';
import { projectProviderUi } from '../lib/providers/ui-projection.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { buildGenerationMessages, FINAL_SCENE_CONSTRAINT } from '../lib/rp/reference-message-parts.js';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { buildLinkApiNanoRequest, parseLinkApiNanoResponse } from '../lib/providers/linkapi-gemini-native.js';
import { readProviderResponseBytes } from '../lib/providers/native-hosted.js';

const MODEL = 'gemini-nano-banana-2.1';
const TRANSPORT = 'linkapi-gemini-native';
const ENDPOINT = 'https://linkapi.ai/v1beta/models/gemini-nano-banana-2.1:generateContent';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const connection = { id: 'linkapi:default', providerId: 'linkapi', kind: 'browser-api-key', enabled: true };
const imageResponse = () => ({ candidates: [{ content: { parts: [{ text: 'Here is your scene.' }, { inlineData: { mimeType: 'image/png', data: PNG } }] } }] });

function nanoPlan({ resolved = {}, options = {}, ...rest } = {}) {
    return createGenerationPlan({
        id: 'nano-route', invocation: 'wand',
        resolved: {
            providerId: 'linkapi', modelId: MODEL, connectionId: connection.id,
            transportId: TRANSPORT, endpoint: ENDPOINT, modelDefinition: getModelDefinition('linkapi', MODEL),
            ...resolved,
        },
        prompt: { sourceMessage: 'A blue ceramic cup.' },
        options, ...rest,
    });
}

async function dispatch(fetchImpl, { plan = nanoPlan(), signal = new AbortController().signal, apiKey = 'fixture-key' } = {}) {
    return dispatchProviderRoute({ plan, connection, signal, transportContext: { apiKey, fetchImpl,
        requestSillyTavernImage: () => assert.fail('Native model must not call the host proxy'),
        requestOpenAiImages: () => assert.fail('Native model must not call the Images API'),
    } });
}

test('new LinkAPI model is selectable with the previous Nano Banana 2 controls', () => {
    const previous = projectProviderUi('linkapi', 'gemini-3.1-flash-image-preview');
    const ui = projectProviderUi('linkapi', MODEL);
    assert.ok(ui.models.some(model => model.id === MODEL && /Nano Banana 2\.1/u.test(model.label)));
    for (const key of ['supportsReferenceImages', 'referenceImageMaxCount', 'imageSizeOptions', 'supportsThinking', 'supportsGoogleSearch']) {
        assert.deepEqual(ui[key], previous[key], key);
    }
    assert.equal(resolveTransport('linkapi', MODEL), TRANSPORT);
    assert.equal(getModelDefinition('makersuite', MODEL), undefined);
    assert.equal(getProviderDefinition('linkapi').transports.sillyTavernGeminiProxy.baseUrl, 'https://api.linkapi.ai');
    assert.equal(resolveTransport('linkapi', 'gemini-3.1-flash-image-preview'), 'sillyTavernGeminiProxy');
    assert.equal(resolveTransport('linkapi', 'gpt-image-2-c'), 'openAiImages');
});

test('LinkAPI discovery and reload preserve the exact native model route without remapping saved selections', async () => {
    const result = await discoverProviderModels({ providerId: 'linkapi', apiKey: 'fixture-key',
        fetchImpl: async (url, request) => {
            assert.equal(url, 'https://linkapi.ai/v1/models');
            assert.equal(request.method, 'GET');
            return Response.json({ data: [{ id: MODEL }] });
        },
    });
    assert.equal(result.warning, undefined);
    assert.equal(result.models[0].id, MODEL);
    assert.equal(result.models[0].transportId, TRANSPORT);
    const saved = JSON.parse(JSON.stringify(mergeDiscoveryModelRecords([], result, 'linkapi')));
    // A fetched copy cannot claim built-in evidence. Reload selects the curated
    // preset rather than promoting catalog presence to generation evidence.
    assert.equal(saved[0].routeEvidence.state, 'unverified');
    const selectedModel = mergeProviderModels('linkapi', saved).find(model => model.id === MODEL);
    assert.equal(selectedModel.routeEvidence.protocol, 'gemini-native');
    assert.equal(selectedModel.routeEvidence.state, 'verified');
    const resultAfterReload = await dispatch(async () => Response.json(imageResponse()), {
        plan: nanoPlan({ resolved: { modelDefinition: selectedModel } }),
    });
    assert.equal(resultAfterReload.imageData, PNG);
    const ui = projectProviderUi('linkapi', MODEL, { localEntries: saved });
    assert.equal(ui.models.filter(model => model.id === MODEL).length, 1);
    assert.equal(ui.supportsReferenceImages, true);
    for (const model of [MODEL, 'gemini-3.1-flash-image-preview']) {
        assert.equal(migrateProviderSettings({ provider: 'linkapi', model }).model, model);
    }
});

test('native request preserves instruction, exact avatar/previous-image bytes, full scene, and final constraint through dispatch', async () => {
    const source = `Ava walks through rain. ${'Long scene context. '.repeat(1000)}`;
    const options = { systemInstruction: 'Keep Ava recognizable.', aspectRatio: '16:9', imageSize: '2K', thinkingLevel: 'low', useGoogleSearch: true };
    const messages = buildGenerationMessages({ options,
        references: [
            { id: 'host:character', role: 'host-avatar', identityId: 'character:ava', assetId: 'ava', label: 'Ava' },
            { id: 'previous', role: 'previous-image', assetId: 'previous', label: 'Previous scene' },
        ],
        prompt: { descriptionText: 'Ava wears a red coat.', messageContent: source },
    }, { ava: { data: PNG, mimeType: 'image/png' }, previous: { data: 'R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', mimeType: 'image/gif' } });
    const body = buildLinkApiNanoRequest({ messages, options });
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents[0].parts[0].text, options.systemInstruction);
    assert.deepEqual(body.contents[0].parts.filter(part => part.inlineData), [
        { inlineData: { mimeType: 'image/png', data: PNG } },
        { inlineData: { mimeType: 'image/gif', data: 'R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=' } },
    ]);
    assert.ok(body.contents[0].parts.at(-1).text.includes(source));
    assert.ok(body.contents[0].parts.at(-1).text.includes(FINAL_SCENE_CONSTRAINT));
    assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' }, thinkingConfig: { thinkingLevel: 'LOW' } });
    assert.deepEqual(body.tools, [{ googleSearch: {} }]);
    assert.doesNotMatch(JSON.stringify(body), /image_url|reverse_proxy|proxy_password|reasoning_effort/);
    const result = await dispatch(async (url, request) => {
        assert.equal(url, ENDPOINT);
        assert.deepEqual(JSON.parse(request.body), body);
        return Response.json(imageResponse());
    }, { plan: nanoPlan({ messages, options }) });
    assert.equal(result.imageData, PNG);
});

test('native dispatch posts the exact endpoint and decodes a real image-shaped fixture once', async () => {
    let calls = 0;
    const result = await dispatch(async (url, request) => {
        calls++;
        assert.equal(url, ENDPOINT);
        assert.equal(request.method, 'POST');
        assert.equal(request.redirect, 'error');
        assert.equal(request.headers['x-goog-api-key'], 'fixture-key');
        assert.equal(new URL(url).search, '');
        assert.deepEqual(JSON.parse(request.body).contents, [{ role: 'user', parts: [{ text: 'A blue ceramic cup.' }] }]);
        assert.equal(JSON.parse(request.body).model, undefined);
        return Response.json(imageResponse());
    });
    assert.equal(calls, 1);
    assert.equal(result.imageData, PNG);
    assert.equal(result.mimeType, 'image/png');
});

test('all existing image sizes and thinking choices reach native Gemini fields; Auto and disabled search are omitted', () => {
    for (const imageSize of ['512', '1K', '2K', '4K']) {
        for (const thinkingLevel of ['minimal', 'low', 'medium', 'high', 'auto']) {
            const body = buildLinkApiNanoRequest(nanoPlan({ options: { aspectRatio: '9:16', imageSize, thinkingLevel, useGoogleSearch: false } }));
            assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '9:16', imageSize });
            assert.deepEqual(body.generationConfig.thinkingConfig, thinkingLevel === 'auto' ? undefined : { thinkingLevel: thinkingLevel.toUpperCase() });
            assert.equal(body.tools, undefined);
        }
    }
});

test('four materialized references are supported and unsupported/remote/excess parts fail before dispatch', async () => {
    const image = { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } };
    assert.equal(buildLinkApiNanoRequest({ messages: [{ content: [image, image, image, image] }] }).contents[0].parts.length, 4);
    for (const content of [[{ type: 'image_url', image_url: { url: 'https://example.com/avatar.png' } }], Array(5).fill(image), [{ type: 'audio' }]]) {
        let called = false;
        await assert.rejects(dispatch(() => { called = true; }, { plan: nanoPlan({ messages: [{ role: 'user', content }] }) }), /reference|message part/i);
        assert.equal(called, false);
    }
});

test('native responses accept snake_case inline data and skip thought images', () => {
    const json = { candidates: [{ content: { parts: [
        { thought: true, inlineData: { mimeType: 'image/png', data: 'THOUGHT' } },
        { inline_data: { mime_type: 'image/png', data: PNG } },
    ] } }] };
    assert.equal(parseLinkApiNanoResponse(json).inlineData.data, PNG);
});

for (const [status, message, category] of [[401, 'Invalid key', 'authentication'], [429, 'Busy', 'rate_limit'], [500, 'Upstream failure', 'provider'], [400, 'Unknown parameter image size', 'unsupported_capability']]) {
    test(`native HTTP ${status} errors retain attribution, redact the exact credential, and never retry`, async () => {
        let calls = 0;
        await assert.rejects(dispatch(async () => { calls++; return Response.json({ error: { message: `${message}: fixture-key` } }, { status }); }), error => {
            assert.equal(error.category, category);
            assert.equal(error.providerId, 'linkapi');
            assert.equal(error.modelId, MODEL);
            assert.doesNotMatch(error.message + error.userMessage, /fixture-key/);
            return true;
        });
        assert.equal(calls, 1);
    });
}

test('HTTP-200 error envelopes preserve the provider reason without exposing arbitrary keys', async () => {
    await assert.rejects(dispatch(async () => Response.json({ error: { message: 'Upstream route failed: fixture-key' } })), error => {
        assert.equal(error.category, 'provider_response');
        assert.match(error.userMessage, /Upstream route failed/);
        assert.doesNotMatch(error.message + error.userMessage, /fixture-key/);
        return true;
    });
});

test('blocked, text-only, malformed JSON, and invalid image responses fail explicitly', async () => {
    for (const [json, category] of [
        [{ promptFeedback: { blockReason: 'SAFETY' } }, 'content_policy'],
        [{ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, 'content_policy'],
        [{ candidates: [{ content: { parts: [{ text: 'No image.' }] } }] }, 'empty_result'],
    ]) {
        await assert.rejects(dispatch(async () => Response.json(json)), error => error.category === category);
    }
    await assert.rejects(dispatch(async () => new Response('<html>gateway error</html>')), /invalid Gemini JSON/);
    await assert.rejects(dispatch(async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }] })), /magic bytes/);
});

test('empty credentials, aborted requests, forged endpoints, and wrong models cannot send a native request', async () => {
    let calls = 0;
    const fetchImpl = () => { calls++; return Response.json(imageResponse()); };
    await assert.rejects(dispatch(fetchImpl, { apiKey: '' }), /API key/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(dispatch(fetchImpl, { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(dispatch(fetchImpl, { plan: nanoPlan({ resolved: { endpoint: 'https://attacker.example/' } }) }), /curated/);
    await assert.rejects(dispatch(fetchImpl, { plan: nanoPlan({ resolved: { modelId: 'other-model' } }) }), /curated/);
    assert.equal(calls, 0);
});

test('cancellation during response reading remains an AbortError; redirected responses are rejected', async () => {
    const controller = new AbortController();
    await assert.rejects(dispatch(async () => new Response(new ReadableStream({ start() { controller.abort(); } })), { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(dispatch(async () => ({ redirected: true, ok: true })), /redirects/);
});

test('shared native response reader rejects oversized responses without accumulating the full body', async () => {
    await assert.rejects(readProviderResponseBytes(new Response('12345'), 4, new AbortController().signal), /size limit/);
});

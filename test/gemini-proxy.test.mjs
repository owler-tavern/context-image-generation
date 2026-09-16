import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiProxyRequest } from '../lib/providers/gemini-proxy.js';
import { buildGenerationMessages, FINAL_SCENE_CONSTRAINT } from '../lib/rp/reference-message-parts.js';

test('builds the current LinkAPI Gemini proxy request', () => {
    const body = buildGeminiProxyRequest({
        model: 'gemini-3.1-flash-image-preview',
        messages: [{ role: 'user', content: 'scene' }],
        apiKey: 'test-key',
        baseUrl: 'https://api.linkapi.ai',
        aspectRatio: '1:1',
        imageSize: '2K',
        isFlash2: true,
        thinkingLevel: 'low',
        useGoogleSearch: true,
    });

    assert.equal(body.chat_completion_source, 'makersuite');
    assert.equal(body.reverse_proxy, 'https://api.linkapi.ai');
    assert.equal(body.proxy_password, 'test-key');
    assert.equal(body.request_images, true);
    assert.equal(body.request_image_aspect_ratio, '1:1');
    assert.equal(body.request_image_resolution, '2K');
    assert.equal(body.stream, false);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.enable_web_search, true);
});

test('LinkAPI preserves the configured generation instruction and exact selected avatar bytes, with the authoritative scene constraint last', () => {
    const messages = buildGenerationMessages({
        options: { systemInstruction: 'Keep Ava recognizable.', aspectRatio: '16:9' },
        references: [{ id: 'host:character', role: 'host-avatar', identityId: 'character:ava', assetId: 'asset:ava', label: 'Ava' }],
        prompt: { descriptionText: 'Ava has a red coat.', messageContent: 'Ava walks through rain.' },
    }, {
        'asset:ava': { data: 'EXACT_AVATAR_BYTES', mimeType: 'image/png' },
        'asset:leo': { data: 'UNRELATED_GROUP_BYTES', mimeType: 'image/png' },
    });
    const body = buildGeminiProxyRequest({
        model: 'gemini-3.1-flash-image-preview', messages, apiKey: 'test-key', baseUrl: 'https://api.linkapi.ai',
    });
    const parts = body.messages[0].content;

    assert.equal(body.model, 'gemini-3.1-flash-image-preview');
    assert.equal(parts[0].text, 'Keep Ava recognizable.');
    assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), ['data:image/png;base64,EXACT_AVATAR_BYTES']);
    assert.doesNotMatch(JSON.stringify(parts), /UNRELATED_GROUP_BYTES/);
    assert.match(parts.at(-1).text, /Ava walks through rain\./);
    assert.match(parts.at(-1).text, /Render the final image in 16:9 aspect ratio\. This image shape is required\./);
    assert.match(parts.at(-1).text, new RegExp(FINAL_SCENE_CONSTRAINT.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
});

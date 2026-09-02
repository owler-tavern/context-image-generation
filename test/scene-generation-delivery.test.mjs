import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createMessageDeliveryAdapter,
    createPreviewGalleryDeliveryAdapter,
    createSlashEntryAdapter,
    createSlashGenerationRequest,
    createWandEntryAdapter,
    createWandGenerationRequest,
} from '../lib/scene-generation/delivery.js';

const target = Object.freeze({ chatId: 'mira-chat.jsonl', messageId: 2, messageFingerprint: 'v1-9d8aac7b' });
const artifact = Object.freeze({ imageData: 'abc', mimeType: 'image/png' });
const plan = Object.freeze({ id: 'plan:scene' });

function messageResult() {
    return { artifact, plan, request: createWandGenerationRequest({ prompt: 'The candle burns low.', sender: '{{char}} (Mira)', messageId: 2, focusText: 'candle', target }) };
}

function messageDependencies(validation = { safe: true, message: { mes: 'The candle burns low.', extra: {} } }) {
    const calls = [];
    return {
        calls,
        dependencies: {
            saveImage: async () => (calls.push('save-image'), 'gallery/cig_1.png'),
            getCurrentTarget: () => (calls.push('validate'), validation),
            appendMedia: () => calls.push('attach'),
            saveChat: async () => calls.push('save-chat'),
            addToGallery: async (_data, _prompt, _messageId, path, metadata) => calls.push({ gallery: path, metadata }),
            notify: (text) => calls.push({ notify: text }),
        },
    };
}

test('message delivery validates the captured target, saves once, attaches once, then records Gallery provenance', async () => {
    const { calls, dependencies } = messageDependencies();
    const delivered = await createMessageDeliveryAdapter(dependencies).deliver(messageResult());

    assert.equal(delivered, true);
    assert.deepEqual(calls, ['save-image', 'validate', 'attach', 'validate', 'save-chat', {
        gallery: 'gallery/cig_1.png', metadata: undefined,
    }]);
});

test('message delivery rejects a stale chat/message without attaching it', async () => {
    const { calls, dependencies } = messageDependencies({ safe: false, reason: 'chat-changed' });
    const delivered = await createMessageDeliveryAdapter(dependencies).deliver(messageResult());

    assert.equal(delivered, false);
    assert.equal(calls.includes('attach'), false);
    assert.equal(calls.includes('save-chat'), false);
    assert.deepEqual(calls.at(-2), {
        gallery: 'gallery/cig_1.png', metadata: {
            source: 'message', chatId: 'mira-chat.jsonl', messageId: 2, messageFingerprint: 'v1-9d8aac7b',
            attachmentStatus: 'not-attached', reason: 'chat-changed',
        },
    });
});

test('slash delivery saves to Gallery, previews the saved URL, and never attaches a message', async () => {
    const calls = [];
    const url = await createPreviewGalleryDeliveryAdapter({
        addToGallery: async (receivedArtifact, receivedPlan) => {
            calls.push({ gallery: receivedArtifact, plan: receivedPlan });
            return { url: '/user/images/cig_gallery_1.png' };
        },
        showPreview: (value) => calls.push({ preview: value }),
    }).deliver({ artifact, plan });

    assert.equal(url, '/user/images/cig_gallery_1.png');
    assert.deepEqual(calls, [
        { gallery: artifact, plan },
        { preview: '/user/images/cig_gallery_1.png' },
    ]);
});

test('wand and slash factories construct the ADR-002 request shapes', () => {
    assert.deepEqual(createWandGenerationRequest({ prompt: 'scene', sender: '{{char}} (Mira)', messageId: 4, focusText: 'harbour', target }), {
        source: 'wand', destination: 'message', prompt: 'scene', sender: '{{char}} (Mira)', messageId: 4, focusText: 'harbour', target,
    });
    assert.deepEqual(createSlashGenerationRequest('  castle at dusk  '), {
        source: 'slash', destination: 'preview-gallery', prompt: 'castle at dusk',
    });
});

test('wand and slash entry adapters select their matching delivery after the fake kernel', async () => {
    const calls = [];
    const kernel = { generate: async (request) => (calls.push({ kernel: request }), { artifact, plan, request }) };
    const wand = createWandEntryAdapter({ kernel, delivery: { deliver: async (result) => (calls.push({ wand: result.request.destination }), true) } });
    const slash = createSlashEntryAdapter({ kernel, delivery: { deliver: async (result) => (calls.push({ slash: result.request.destination }), '/preview.png') } });

    assert.equal(await wand.generate({ prompt: 'scene', sender: 'Mira', messageId: 2, focusText: null, target }), true);
    assert.equal(await slash.generate('  castle  '), '/preview.png');
    assert.deepEqual(calls, [
        { kernel: { source: 'wand', destination: 'message', prompt: 'scene', sender: 'Mira', messageId: 2, focusText: null, target } },
        { wand: 'message' },
        { kernel: { source: 'slash', destination: 'preview-gallery', prompt: 'castle' } },
        { slash: 'preview-gallery' },
    ]);
});

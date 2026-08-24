import test from 'node:test';
import assert from 'node:assert/strict';
import { attachGeneratedImageSafely } from '../lib/rp-attachment.js';

const message = { mes: 'The candle burns low.', extra: {} };
const target = {
    chatId: 'mira-chat.jsonl',
    messageId: 2,
    messageFingerprint: 'v1-9d8aac7b',
};

function dependencies(validation) {
    const calls = [];
    return {
        calls,
        options: {
            target,
            prompt: message.mes,
            sender: '{{char}} (Mira)',
            generate: async () => ({ imageData: 'abc', mimeType: 'image/png' }),
            saveImage: async () => 'gallery/cig_1.png',
            getCurrentTarget: () => validation,
            appendMedia: () => calls.push('append'),
            saveChat: async () => calls.push('save'),
            addToGallery: async (_data, _prompt, _id, path, metadata) => calls.push({ gallery: path, metadata }),
            notify: (message) => calls.push({ notify: message }),
        },
    };
}

test('safe target appends media, saves the active chat, and records the artifact', async () => {
    const { calls, options } = dependencies({ safe: true, message });
    assert.equal(await attachGeneratedImageSafely(options), true);
    assert.deepEqual(calls, [
        'append',
        'save',
        { gallery: 'gallery/cig_1.png', metadata: undefined },
    ]);
});

test('stale target keeps the artifact in the gallery without touching the active chat', async () => {
    const { calls, options } = dependencies({ safe: false, reason: 'chat-changed' });
    assert.equal(await attachGeneratedImageSafely(options), false);
    assert.deepEqual(calls, [
        { gallery: 'gallery/cig_1.png', metadata: {
            source: 'message',
            chatId: 'mira-chat.jsonl',
            messageId: 2,
            messageFingerprint: 'v1-9d8aac7b',
            attachmentStatus: 'not-attached',
            reason: 'chat-changed',
        } },
        { notify: 'Image kept in the gallery because the original message is no longer active.' },
    ]);
});

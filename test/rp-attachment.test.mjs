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

test('safe attachment can be finalized inside the coordinator execution', async () => {
    let persisted = 0;
    const result = await attachGeneratedImageSafely({
        target: { chatId: 'chat', messageId: 1, messageFingerprint: 'fp' },
        prompt: 'scene',
        generate: async ({ finalize }) => finalize({ imageData: 'image', mimeType: 'image/png' }),
        saveImage: async () => 'saved.png',
        getCurrentTarget: () => ({ safe: true, message: {} }),
        appendMedia: () => { persisted += 1; },
        saveChat: async () => ({ saved: true }),
        addToGallery: async () => {},
        notify: () => {},
    });
    assert.equal(result, true);
    assert.equal(persisted, 1);
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

test('revalidates immediately before save and rolls back an unsafe append', async () => {
    const { calls, options } = dependencies({ safe: true, message });
    let checks = 0;
    options.getCurrentTarget = () => {
        checks += 1;
        return checks === 1 ? { safe: true, message } : { safe: false, reason: 'chat-changed' };
    };
    options.rollbackMedia = () => calls.push('rollback');
    assert.equal(await attachGeneratedImageSafely(options), false);
    assert.deepEqual(calls, [
        'append',
        'rollback',
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

test('does not save when the save gate reports a target change', async () => {
    const { calls, options } = dependencies({ safe: true, message });
    options.saveChat = async () => ({ saved: false, reason: 'chat-changed' });
    options.rollbackMedia = () => calls.push('rollback');
    assert.equal(await attachGeneratedImageSafely(options), false);
    assert.deepEqual(calls, [
        'append',
        'rollback',
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

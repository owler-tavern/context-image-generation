import test from 'node:test';
import assert from 'node:assert/strict';
import { attachGeneratedImageSafely } from '../lib/rp-attachment.js';
import { createMessageDeliveryAdapter } from '../lib/scene-generation/delivery.js';

const message = { mes: 'The candle burns low.', extra: {} };
const target = {
    chatId: 'mira-chat.jsonl',
    messageId: 2,
    messageFingerprint: 'v1-9d8aac7b',
};

test('a rejected chat save preserves the generated artifact before reporting failure', async () => {
    const { calls, options } = dependencies({ safe: true, message });
    options.saveChat = async () => { throw new Error('disk unavailable'); };
    options.rollbackMedia = async () => calls.push('rollback');
    await assert.rejects(attachGeneratedImageSafely(options), /disk unavailable/);
    assert.ok(calls.includes('rollback'));
    const recovered = calls.find(call => call?.gallery);
    assert.equal(recovered.gallery, 'gallery/cig_1.png');
    assert.equal(recovered.metadata.reason, 'chat-save-failed');
    assert.ok(calls.some(call => /available in the gallery/.test(call?.notify || '')));
});

test('a missing recovery receipt never announces Gallery success', async () => {
    const { calls, options } = dependencies({ safe: false, reason: 'chat-changed' });
    options.addToGallery = async () => undefined;
    await assert.rejects(attachGeneratedImageSafely(options), /recovery entry/);
    assert.equal(calls.some(call => call?.notify), false);
});

test('a failed recovery save never announces Gallery success', async () => {
    const { calls, options } = dependencies({ safe: false, reason: 'chat-changed' });
    options.addToGallery = async () => { throw new Error('settings unavailable'); };
    await assert.rejects(attachGeneratedImageSafely(options), /settings unavailable/);
    assert.equal(calls.some(call => call?.notify), false);
});

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

test('message delivery persists a pre-generated kernel artifact exactly once', async () => {
    let persisted = 0;
    const delivery = createMessageDeliveryAdapter({
        saveImage: async () => 'saved.png',
        getCurrentTarget: () => ({ safe: true, message: {} }),
        appendMedia: () => { persisted += 1; },
        saveChat: async () => ({ saved: true }),
        addToGallery: async () => {},
        notify: () => {},
    });
    const result = await delivery.deliver({
        artifact: { imageData: 'image', mimeType: 'image/png' },
        request: { target: { chatId: 'chat', messageId: 1, messageFingerprint: 'fp' }, prompt: 'scene' },
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

test('rolls back when the production save gate reports safe false', async () => {
    const { calls, options } = dependencies({ safe: true, message });
    options.saveChat = async () => ({ safe: false, reason: 'chat-changed' });
    options.rollbackMedia = () => calls.push('rollback');
    assert.equal(await attachGeneratedImageSafely(options), false);
    assert.equal(calls.includes('rollback'), true);
    assert.equal(calls.some((entry) => entry?.gallery && entry.metadata?.reason === 'chat-changed'), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGenerationKey,
    captureMessageTarget,
    getMessageFingerprint,
    validateMessageTarget,
} from '../lib/rp-target.js';

const unchanged = {
    name: 'Mira',
    mes: 'The candle burns low.',
    send_date: 1710000000,
    is_user: false,
    is_system: false,
};

test('accepts an unchanged message in the same stable chat', () => {
    const target = captureMessageTarget({ chatId: 'mira-chat.jsonl', messageId: 3, message: unchanged });
    assert.deepEqual(validateMessageTarget({
        target,
        currentChatId: 'mira-chat.jsonl',
        currentChat: [null, null, null, unchanged],
    }), { safe: true, message: unchanged });
});

test('rejects changed chat, deleted message, and replacement at the same index', () => {
    const target = captureMessageTarget({ chatId: 'mira-chat.jsonl', messageId: 3, message: unchanged });
    assert.equal(validateMessageTarget({ target, currentChatId: 'other-chat.jsonl', currentChat: [null, null, null, unchanged] }).reason, 'chat-changed');
    assert.equal(validateMessageTarget({ target, currentChatId: 'mira-chat.jsonl', currentChat: [] }).reason, 'deleted');
    assert.equal(validateMessageTarget({
        target,
        currentChatId: 'mira-chat.jsonl',
        currentChat: [null, null, null, { ...unchanged, mes: 'A replacement message.' }],
    }).reason, 'replaced');
});

test('does not treat an undefined chat ID or invalid message index as safe', () => {
    const target = captureMessageTarget({ chatId: undefined, messageId: 0, message: unchanged });
    assert.equal(validateMessageTarget({ target, currentChatId: undefined, currentChat: [unchanged] }).reason, 'unavailable');
    const validTarget = captureMessageTarget({ chatId: 'chat', messageId: 4, message: unchanged });
    assert.equal(validateMessageTarget({ target: validTarget, currentChatId: 'chat', currentChat: [unchanged] }).reason, 'deleted');
});

test('generation keys include chat identity for message work but preserve prompt keys', () => {
    assert.equal(buildGenerationKey({ chatId: 'a', messageId: 2, prompt: 'scene' }), 'message:a:2');
    assert.equal(buildGenerationKey({ chatId: 'b', messageId: 2, prompt: 'scene' }), 'message:b:2');
    assert.equal(buildGenerationKey({ chatId: null, messageId: null, prompt: ' scene ' }), 'prompt:scene');
    assert.notEqual(getMessageFingerprint(unchanged), getMessageFingerprint({ ...unchanged, mes: 'Changed.' }));
});

test('message fingerprints do not persist the source message text', () => {
    const fingerprint = getMessageFingerprint(unchanged);
    assert.match(fingerprint, /^v1-[0-9a-f]+$/);
    assert.doesNotMatch(fingerprint, /candle|Mira/i);
});

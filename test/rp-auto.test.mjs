import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAutoGenerationInput, validateAutoGenerationInput } from '../lib/rp-auto.js';

const message = {
    name: 'Mira',
    mes: 'The candle burns low.',
    send_date: 1710000000,
    is_user: false,
    is_system: false,
};

test('captures the chat and message fingerprint before the delayed auto run', () => {
    const input = captureAutoGenerationInput({
        context: { chatId: 'mira-chat.jsonl', chat: [message] },
        messageId: 0,
    });
    assert.equal(input.target.chatId, 'mira-chat.jsonl');
    assert.equal(input.target.messageId, 0);
    assert.equal(input.message, message);
});

test('rejects a delayed auto run after switching chats or replacing the message', () => {
    const input = captureAutoGenerationInput({
        context: { chatId: 'mira-chat.jsonl', chat: [message] },
        messageId: 0,
    });
    assert.equal(validateAutoGenerationInput({
        input,
        context: { chatId: 'other-chat.jsonl', chat: [message] },
    }).reason, 'chat-changed');
    assert.equal(validateAutoGenerationInput({
        input,
        context: { chatId: 'mira-chat.jsonl', chat: [{ ...message, mes: 'Replacement.' }] },
    }).reason, 'replaced');
});

test('never captures an invalid or system message', () => {
    assert.equal(captureAutoGenerationInput({ context: { chatId: 'chat', chat: [] }, messageId: 0 }), null);
    assert.equal(captureAutoGenerationInput({
        context: { chatId: 'chat', chat: [{ ...message, is_system: true }] },
        messageId: 0,
    }), null);
});

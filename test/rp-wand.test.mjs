import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWandGenerationInput } from '../lib/rp-wand.js';

function selection(text, insideText = true) {
    const start = { insideText };
    const end = { insideText };
    return {
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => ({ startContainer: start, endContainer: end }),
        toString: () => text,
    };
}

const messageElement = {
    querySelector: () => ({ contains: (node) => node.insideText === true }),
    contains: () => true,
};

const message = {
    name: 'Mira',
    mes: 'Mira raises a candle in the dark.',
    send_date: 1710000000,
    is_user: false,
    is_system: false,
};

test('wand capture includes selected focus and target metadata synchronously', () => {
    assert.deepEqual(captureWandGenerationInput({
        chatId: 'mira-chat.jsonl',
        messageId: 4,
        message,
        messageElement,
        selection: selection('raises a candle'),
        sender: '{{char}} (Mira)',
    }), {
        sourceMessage: 'Mira raises a candle in the dark.',
        focusText: 'raises a candle',
        sender: '{{char}} (Mira)',
        target: {
            chatId: 'mira-chat.jsonl',
            messageId: 4,
            messageFingerprint: 'v1-0812dd91',
        },
    });
});

test('wand capture rejects an unrelated selection and disables focus for automatic generation', () => {
    const unrelated = captureWandGenerationInput({
        chatId: 'mira-chat.jsonl',
        messageId: 4,
        message,
        messageElement,
        selection: selection('other message', false),
        sender: '{{char}} (Mira)',
    });
    assert.equal(unrelated.focusText, null);

    const automatic = captureWandGenerationInput({
        chatId: 'mira-chat.jsonl',
        messageId: 4,
        message,
        messageElement,
        selection: selection('raises a candle'),
        sender: '{{char}} (Mira)',
        captureSelection: false,
    });
    assert.equal(automatic.focusText, null);
});

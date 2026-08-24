import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFocusedMessageContent,
    isEligibleMessageSelection,
    normalizeFocusText,
} from '../lib/rp-selection.js';

function makeSelection({ text = 'selected passage', startInsideText = true, endInsideText = true, collapsed = false } = {}) {
    const start = { insideText: startInsideText };
    const end = { insideText: endInsideText };
    return {
        rangeCount: 1,
        isCollapsed: collapsed,
        getRangeAt: () => ({ startContainer: start, endContainer: end }),
        toString: () => text,
    };
}

function makeMessageElement() {
    const textElement = { contains: (node) => node.insideText === true };
    return {
        querySelector: (selector) => selector === '.mes_text' ? textElement : null,
        contains: (node) => node.insideMessage === true || node.insideText === true,
    };
}

test('normalizes selected plain text and rejects empty or over-limit focus', () => {
    assert.equal(normalizeFocusText('  A\n\t focused   moment  '), 'A focused moment');
    assert.equal(normalizeFocusText('  \n\t '), null);
    assert.equal(normalizeFocusText('123456', { maxLength: 5 }), null);
});

test('accepts only a non-collapsed range wholly inside the clicked message text', () => {
    const clickedMessageElement = makeMessageElement();
    assert.equal(isEligibleMessageSelection({
        selection: makeSelection(),
        clickedMessageElement,
    }), true);
    assert.equal(isEligibleMessageSelection({
        selection: makeSelection({ startInsideText: true, endInsideText: false }),
        clickedMessageElement,
    }), false);
    assert.equal(isEligibleMessageSelection({
        selection: makeSelection({ collapsed: true }),
        clickedMessageElement,
    }), false);
});

test('focused content makes the selection primary and preserves supporting story context', () => {
    assert.equal(
        buildFocusedMessageContent({
            sourceMessage: 'A full roleplay message.',
            focusText: 'the candle flame',
            sender: '{{char}} (Mira)',
            storyContext: '[Story Context]: A full roleplay message.',
        }),
        '[Primary visual moment - focus on this selected passage]: the candle flame\n\n[Supporting message context]: [Story Context]: A full roleplay message.',
    );
});

test('null focus preserves the existing whole-message content', () => {
    assert.equal(
        buildFocusedMessageContent({
            sourceMessage: 'A full roleplay message.',
            focusText: null,
            sender: '{{char}} (Mira)',
            storyContext: '[Story Context]: A full roleplay message.',
        }),
        '[Story Context]: A full roleplay message.',
    );
    assert.equal(
        buildFocusedMessageContent({ sourceMessage: 'Prompt', focusText: null, sender: '{{user}} (Sam)' }),
        '[Message from {{user}} (Sam)]: Prompt',
    );
});

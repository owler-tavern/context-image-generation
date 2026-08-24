import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('shared generation path builds one plan and labels invocation sources', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /createGenerationPlan\(/);
    assert.match(index, /materializeReferences\(/);
    assert.match(index, /buildMessages\(prompt, sender, messageId, focusText, invocation\)/);
    assert.match(index, /invocation: 'automation'/);
    assert.match(index, /'slash'\)/);
    assert.match(index, /'swipe'\);/);
});


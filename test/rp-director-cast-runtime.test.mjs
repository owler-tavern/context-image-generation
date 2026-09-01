import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorRuntime } from '../lib/rp/director-runtime.js';

const identities = [
    { id: 'character:ava', label: 'Ava', kind: 'character', aliases: ['Ava'] },
    { id: 'character:rowan', label: 'Rowan', kind: 'character', aliases: ['Rowan'] },
];

test('Director runtime persists cast candidates and dispatches the selected correction without provider work on edit', async () => {
    let dispatched = null;
    let persisted = {};
    const runtime = createDirectorRuntime({
        getChatId: () => 'chat-a',
        getEpoch: () => 1,
        buildPreview: async () => ({
            moment: 'Ava and Rowan enter the library.',
            castCandidates: [
                { identityId: 'character:ava', label: 'Ava', action: 'include' },
                { identityId: 'character:rowan', label: 'Rowan', action: 'include' },
            ],
        }),
        dispatch: async (input) => { dispatched = input; return { status: 'completed' }; },
        validateTarget: () => ({ safe: true }),
        saveChat: async () => {},
        writeState: (value) => { persisted = value; },
        writeDurableState: () => {},
        saveDurableState: async () => {},
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 3, message: { mes: 'Ava and Rowan enter the library.' } });
    assert.equal(runtime.getState().panel.castCandidates.length, 2);
    await runtime.update({ castOverrides: [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
    ] });
    assert.equal(runtime.getState().options.castOverrides[1].action, 'focus');
    assert.deepEqual(persisted.director.panel.castOverrides, [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
    ]);
    assert.equal((await runtime.generate()).status, 'completed');
    assert.deepEqual(dispatched.castOverrides, [
        { identityId: 'character:ava', action: 'exclude' },
        { identityId: 'character:rowan', action: 'focus' },
    ]);
});

test('Director runtime accepts an Auto candidate missed by interpretation and carries Include into dispatch', async () => {
    let dispatched = null;
    let previewCalls = 0;
    const runtime = createDirectorRuntime({
        getChatId: () => 'chat-a',
        getEpoch: () => 1,
        buildPreview: async () => {
            previewCalls += 1;
            return {
                moment: 'Ava enters the library.',
                castCandidates: [
                    { identityId: 'character:ava', label: 'Ava', action: 'include', inferredAction: 'include' },
                    { identityId: 'character:rowan', label: 'Rowan', action: 'auto', inferredAction: 'auto' },
                ],
            };
        },
        dispatch: async (input) => { dispatched = input; return { status: 'completed' }; },
        validateTarget: () => ({ safe: true }),
        saveChat: async () => {},
        writeState: () => {},
        writeDurableState: () => {},
        saveDurableState: async () => {},
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 4, message: { mes: 'Ava enters the library.' } });
    assert.equal(runtime.getState().panel.castCandidates.find(({ identityId }) => identityId === 'character:rowan').action, 'auto');
    const beforeEdit = previewCalls;
    await runtime.update({ castOverrides: [{ identityId: 'character:rowan', action: 'include' }] });
    assert.equal(previewCalls, beforeEdit + 1);
    assert.deepEqual(runtime.getState().options.castOverrides, [{ identityId: 'character:rowan', action: 'include' }]);
    await runtime.generate();
    assert.deepEqual(dispatched.castOverrides, [{ identityId: 'character:rowan', action: 'include' }]);
});

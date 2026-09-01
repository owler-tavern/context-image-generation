import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorRuntime } from '../lib/rp/director-runtime.js';

function setup(overrides = {}) {
    const states = new Map();
    const durable = new Map();
    const calls = { preview: 0, dispatch: 0, save: 0 };
    let chatId = 'chat-a';
    let epoch = 1;
    const runtime = createDirectorRuntime({
        getChatId: () => chatId,
        getEpoch: () => epoch,
        readState: ({ chatId: requested } = {}) => states.get(requested || chatId) || {},
        writeState: (value, { chatId: requested } = {}) => states.set(requested || chatId, structuredClone(value)),
        readDurableState: ({ chatId: requested } = {}) => durable.get(requested || chatId) || null,
        writeDurableState: (value, { chatId: requested } = {}) => durable.set(requested || chatId, structuredClone(value)),
        saveChat: async () => { calls.save += 1; },
        buildPreview: async (input) => { calls.preview += 1; return { moment: input.focusText || input.sourceMessage, inspection: ['Location: library.'], referenceSummary: 'Ava: remembered look ready.' }; },
        dispatch: async (input) => { calls.dispatch += 1; return { status: 'completed', input }; },
        ...overrides,
    });
    return { runtime, calls, states, durable, switchChat(next) { chatId = next; epoch += 1; }, get chatId() { return chatId; }, get epoch() { return epoch; } };
}

test('Director opens with bounded story preview and captured selection without dispatching', async () => {
    const { runtime, calls } = setup();
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 3, message: { mes: 'Ava enters the library.' }, selectionText: 'Ava enters the library.' });
    assert.equal(result.status, 'open');
    assert.equal(result.panel.focusText, 'Ava enters the library.');
    assert.equal(result.panel.framing, 'auto');
    assert.equal(result.panel.continuity, 'balanced');
    assert.equal(calls.dispatch, 0);
    assert.equal(calls.preview, 1);
});

test('Director editing and closing persist per chat without provider calls', async () => {
    const { runtime, calls, switchChat } = setup();
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 2, message: { mes: 'Ava waits.' } });
    await runtime.update({ framing: 'wide', continuity: 'strong', visualDirection: 'rainy blue hour' });
    assert.equal(runtime.getState().options.framing, 'wide');
    assert.equal(runtime.getState().options.continuity, 'strong');
    await runtime.close();
    assert.equal(runtime.getState().panel, null);
    assert.equal(calls.dispatch, 0);
    switchChat('chat-b');
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    assert.equal(runtime.getState().options.framing, 'auto');
    switchChat('chat-a');
    runtime.load({ chatId: 'chat-a', epoch: 3 });
    assert.equal(runtime.getState().options.framing, 'wide');
    assert.equal(runtime.getState().options.continuity, 'strong');
});

test('Director generation is the only dispatch action and selection wins over the anchored message', async () => {
    const { runtime, calls } = setup();
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 4, message: { mes: 'Full anchored message.' }, selectionText: 'Selected passage.' });
    const result = await runtime.generate();
    assert.equal(result.status, 'completed');
    assert.equal(result.input.focusText, 'Selected passage.');
    assert.equal(result.input.sourceMessage, 'Full anchored message.');
    assert.equal(calls.dispatch, 1);
});

test('Director generation rejects stale or replaced anchored messages before dispatch', async () => {
    let message = { mes: 'Original.' };
    let replaced = false;
    const { runtime, calls, switchChat } = setup({ getChatId: () => 'chat-a', validateTarget: () => replaced ? { safe: false, reason: 'replaced' } : { safe: true, message } });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 1, message, messageFingerprint: 'original' });
    message = { mes: 'Replaced.' };
    replaced = true;
    assert.equal((await runtime.generate()).status, 'stale');
    assert.equal(calls.dispatch, 0);
    switchChat('chat-b');
    assert.equal((await runtime.generate()).status, 'stale');
    assert.equal(calls.dispatch, 0);
});

test('Director persistence is bounded and provider-free while retaining an executable target', async () => {
    const { runtime, states } = setup();
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 5, message: { mes: 'PRIVATE_CINEMATIC_CHAT_TEXT_123' }, selectionText: 'PRIVATE_CINEMATIC_SELECTION_456' });
    const serialized = JSON.stringify(states.get('chat-a'));
    assert.doesNotMatch(serialized, /PRIVATE_CINEMATIC/);
    assert.ok(serialized.length < 5000);
    assert.equal(states.get('chat-a').director.panel.target.messageId, 5);
});

test('Director deferred settlement remains scoped to the approved chat after switching chats', async () => {
    let resolveDispatch;
    const { runtime, states, durable, switchChat } = setup({
        dispatch: () => new Promise((resolve) => { resolveDispatch = resolve; }),
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 6, message: { mes: 'A scene.' } });
    const pending = runtime.generate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    switchChat('chat-b');
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    resolveDispatch({ status: 'completed' });
    const result = await pending;
    assert.equal(result.status, 'completed');
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(durable.get('chat-a').director.lastStatus, 'generated');
    assert.equal(runtime.getState().panel, null);
});

test('Director rapid activation has one dispatch in flight', async () => {
    let resolveDispatch;
    let dispatchCount = 0;
    const { runtime } = setup({ dispatch: () => { dispatchCount += 1; return new Promise((resolve) => { resolveDispatch = resolve; }); } });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    await runtime.open({ chatId: 'chat-a', epoch: 1, messageId: 7, message: { mes: 'One shot.' } });
    const first = runtime.generate();
    const second = runtime.generate();
    assert.equal((await second).status, 'busy');
    await new Promise((resolve) => setTimeout(resolve, 10));
    resolveDispatch({ status: 'completed' });
    assert.equal((await first).status, 'completed');
    assert.equal(dispatchCount, 1);
});

test('Director reload rebinds only an exact target and recovers selection without raw persistence', async () => {
    const persisted = {
        director: {
            schema: 1,
            options: { framing: 'wide', continuity: 'strong', visualDirection: 'blue hour' },
            revision: 4,
            panel: { messageId: 8, target: { chatId: 'chat-a', messageId: 8, messageFingerprint: 'exact', epoch: 1 }, framing: 'wide', continuity: 'strong', visualDirection: 'blue hour', focusFingerprint: 'director-fp:selection', referenceSummary: 'ready', routeSummary: 'ready', budgetSummary: 'Exact provider cost unavailable.' },
        },
    };
    let epoch = 4;
    let targetSafe = true;
    const runtime = createDirectorRuntime({
        getChatId: () => 'chat-a', getEpoch: () => epoch,
        readState: () => persisted,
        validateTarget: () => targetSafe ? { safe: true } : { safe: false, reason: 'replaced' },
    });
    const loaded = runtime.load({ chatId: 'chat-a', epoch });
    assert.equal(loaded.panel.target.epoch, 4);
    assert.equal(loaded.panel.focusText, null);
    assert.match(loaded.panel.focusNotice, /anchored message|selection/i);
    targetSafe = false;
    epoch = 5;
    const staleRuntime = createDirectorRuntime({ getChatId: () => 'chat-a', getEpoch: () => epoch, readState: () => persisted, validateTarget: () => ({ safe: false, reason: 'replaced' }) });
    const stale = staleRuntime.load({ chatId: 'chat-a', epoch });
    assert.equal(stale.panel.target.epoch, 1);
    assert.match(stale.panel.previewError, /replaced|current/i);
});

test('Director settles inactive chat through durable state and keeps active chat untouched', async () => {
    const durable = new Map();
    let resolveDispatch;
    let activeChat = 'chat-a';
    let epoch = 1;
    const runtime = createDirectorRuntime({
        getChatId: () => activeChat, getEpoch: () => epoch,
        readState: ({ chatId } = {}) => durable.get(chatId) || {},
        readDurableState: ({ chatId } = {}) => durable.get(chatId) || null,
        writeDurableState: (value, { chatId } = {}) => durable.set(chatId, structuredClone(value)),
        saveDurableState: async () => {},
        buildPreview: async () => ({ moment: 'A scene.' }),
        dispatch: () => new Promise((resolve) => { resolveDispatch = resolve; }),
    });
    runtime.load({ chatId: 'chat-a', epoch });
    await runtime.open({ chatId: 'chat-a', epoch, messageId: 2, message: { mes: 'A private scene.' } });
    const pending = runtime.generate();
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeChat = 'chat-b'; epoch = 2; runtime.load({ chatId: 'chat-b', epoch });
    resolveDispatch({ status: 'completed' });
    await pending;
    const recovered = createDirectorRuntime({ getChatId: () => 'chat-a', getEpoch: () => 9, readState: () => ({}), readDurableState: ({ chatId } = {}) => durable.get(chatId) || null, validateTarget: () => ({ safe: true }) });
    recovered.load({ chatId: 'chat-a', epoch: 9 });
    assert.equal(recovered.getState().lastStatus, 'generated');
    assert.equal(recovered.getState().panel.status, 'completed');
});

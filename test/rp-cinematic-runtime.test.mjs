import test from 'node:test';
import assert from 'node:assert/strict';
import { createCinematicRuntime } from '../lib/rp/cinematic-runtime.js';
import { buildSceneGenerationSnapshot } from '../lib/rp/scene-generation.js';

function interpretationDelta({ location = null, outfits = null, cast = null } = {}) {
    return {
        accepted: true,
        revision: `revision:${location || outfits || cast || 'scene'}`,
        updatedSceneFacts: {
            ...(location ? { location: { from: 'station', to: location } } : {}),
            ...(outfits ? { outfits } : {}),
            ...(cast ? { cast } : {}),
        },
        acceptedEvidence: [{ source: 'clicked-message', text: 'accepted story change' }],
    };
}

function setup(overrides = {}) {
    const persisted = { cinematicAutomation: null, storyState: { schema: 1, sceneFacts: {} } };
    const calls = { save: 0, dispatch: 0, settle: [] };
    let currentChatId = 'chat-a';
    let epoch = 1;
    const runtime = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 2 },
        getChatId: () => currentChatId,
        getEpoch: () => epoch,
        readState: () => persisted,
        writeState: (value) => Object.assign(persisted, structuredClone(value)),
        saveChat: async () => { calls.save += 1; },
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => { calls.dispatch += 1; return { status: 'completed', receipt: { generationCount: 1 } }; },
        ...overrides,
    });
    return { runtime, persisted, calls, switchChat(id) { currentChatId = id; epoch += 1; } };
}

test('runtime observes accepted story deltas, persists a card, and ignores ordinary message count', async () => {
    const { runtime, persisted, calls } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 4, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    assert.equal(result.status, 'suggested');
    assert.equal(result.suggestion.target.messageId, 4);
    assert.equal(result.suggestion.proposedShot, 'Wide establishing shot of library');
    assert.equal(persisted.cinematicAutomation.session.sessionId, 'chat-a');
    assert.equal(calls.save, 1);
});

test('adjust and dismiss never dispatch, while approve dispatches once and settles count budget from receipt', async () => {
    const { runtime, calls } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 1, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    await runtime.adjust(result.suggestion.suggestionId, { prompt: 'quiet library' });
    await runtime.dismiss(result.suggestion.suggestionId);
    assert.equal(calls.dispatch, 0);
    const second = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 2, message: { mes: 'Ava changes clothes.' }, acceptedSceneDelta: interpretationDelta({ outfits: [{ identityId: 'ava', from: 'red coat', to: 'blue dress' }] }) });
    const approved = await runtime.approve(second.suggestion.suggestionId);
    assert.equal(approved.status, 'completed');
    assert.equal(calls.dispatch, 1);
    assert.equal(runtime.getState().session.generationCount, 1);
    assert.equal(runtime.getState().session.costSpent, 0);
});

test('dismiss removes the current card and does not immediately resurrect queued work after reload', async () => {
    const { runtime, persisted } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const first = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 1, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    const queued = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 2, message: { mes: 'Ava feels hopeful.' }, acceptedSceneDelta: { ...interpretationDelta(), revision: 'revision:queued', updatedSceneFacts: {}, emotionalBeat: { id: 'hope', label: 'hope' } } });
    assert.equal(queued.status, 'pending-suppressed');
    const dismissed = await runtime.dismiss(first.suggestion.suggestionId);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.suggestion, null);
    assert.equal(runtime.getState().suggestion, null);
    const restarted = setup();
    restarted.persisted.cinematicAutomation = persisted.cinematicAutomation;
    await restarted.runtime.load({ chatId: 'chat-a', epoch: 1 });
    assert.equal(restarted.runtime.getState().suggestion, null);
});

test('dismiss refuses a card after the active chat changes without mutating the source session', async () => {
    const { runtime, switchChat } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const first = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 1, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    switchChat('chat-b');
    const result = await runtime.dismiss(first.suggestion.suggestionId);
    assert.equal(result.status, 'stale');
    assert.notEqual(runtime.getState().session.dismissedSuggestionIds.includes(first.suggestion.suggestionId), true);
});

test('dismiss refuses an old card after A to B to A even when the chat id returns', async () => {
    const { runtime, switchChat } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const first = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 1, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    const dismissal = runtime.dismiss(first.suggestion.suggestionId);
    switchChat('chat-b');
    switchChat('chat-a');
    const result = await dismissal;
    assert.equal(result.status, 'stale');
    assert.equal(runtime.getState().session.pendingSuggestions[first.suggestion.suggestionId].suggestionId, first.suggestion.suggestionId);
});

test('duplicate accepted event is idempotent and stale approval cannot dispatch after chat switch', async () => {
    const { runtime, calls, switchChat } = setup();
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const input = { chatId: 'chat-a', epoch: 1, messageId: 3, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) };
    const first = await runtime.observe(input);
    const duplicate = await runtime.observe(input);
    assert.equal(duplicate.status, 'duplicate-suppressed');
    assert.equal(calls.save, 1);
    switchChat('chat-b');
    assert.equal((await runtime.approve(first.suggestion.suggestionId)).status, 'stale');
    assert.equal(calls.dispatch, 0);
});

test('approval blocks when the captured route changes after the card was created', async () => {
    let route = 'provider-a/model-a';
    const { runtime, calls } = setup({ routeKey: () => route });
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 5, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    route = 'provider-b/model-b';
    const blocked = await runtime.approve(result.suggestion.suggestionId);
    assert.equal(blocked.status, 'route-invalid');
    assert.equal(calls.dispatch, 0);
});

test('manual retrigger is explicit provenance and does not replay a chat event', async () => {
    const { runtime, calls } = setup({ getChat: () => [{ mes: 'Ava enters the library.', name: 'Ava' }] });
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.retrigger('beat:missed', 'retry-1', 'missed beat');
    assert.equal(result.suggestion.triggerSource, 'manual-retrigger');
    assert.equal(result.suggestion.replayedChatEvent, false);
    assert.equal(result.suggestion.target.messageId, 0);
    assert.equal(calls.dispatch, 0);
});

test('manual retrigger captures chat identity before queued execution', async () => {
    let releaseInterpretation;
    let interpretationStarted;
    const interpretation = new Promise((resolve) => { releaseInterpretation = resolve; });
    const started = new Promise((resolve) => { interpretationStarted = resolve; });
    const { runtime, switchChat } = setup({
        interpret: async () => {
            interpretationStarted();
            return interpretation;
        },
        getChat: () => [{ mes: 'Ava enters the library.', name: 'Ava' }],
    });
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const observing = runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 0, message: { mes: 'Ava enters the library.' } });
    await interpretationStarted;
    const retrigger = runtime.retrigger('beat:missed', 'retry-before-queue', 'missed beat');
    switchChat('chat-b');
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    releaseInterpretation({ accepted: false });
    await observing;
    const result = await retrigger;
    assert.equal(result.status, 'stale');
    assert.match(result.reason, /chat changed/i);
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().suggestion, null);
});

test('manual retrigger does not refresh an active chat after persistence crosses a chat switch', async () => {
    let activeChat = 'chat-a';
    let activeEpoch = 1;
    let releaseSave;
    let saveStarted;
    const saveGate = new Promise((resolve) => { releaseSave = resolve; });
    const started = new Promise((resolve) => { saveStarted = resolve; });
    const durable = new Map();
    const runtime = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 2 },
        getChatId: () => activeChat,
        getChat: () => [{ mes: `${activeChat} latest message` }],
        getEpoch: () => activeEpoch,
        readState: ({ chatId } = {}) => durable.get(chatId || activeChat) || { storyState: { schema: 1, sceneFacts: {} } },
        writeState: (value, { chatId } = {}) => durable.set(chatId || activeChat, structuredClone(value)),
        saveDurableState: async () => { saveStarted(); await saveGate; },
        saveChat: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => ({ status: 'completed' }),
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const retrigger = runtime.retrigger('beat:missed', 'retry-during-save', 'missed beat');
    await started;
    activeChat = 'chat-b';
    activeEpoch = 2;
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    releaseSave();
    const result = await retrigger;
    assert.equal(result.status, 'stale');
    assert.match(result.reason, /chat changed/i);
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().suggestion, null);
    assert.ok(durable.get('chat-a')?.cinematicAutomation?.session?.pendingSuggestions);
});

test('generation-count ceiling stops later suggestions after a completed receipt', async () => {
    const { runtime } = setup({ settings: { enabled: true, mode: 'frequent', generationLimit: 1 } });
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const first = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 1, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    assert.equal((await runtime.approve(first.suggestion.suggestionId)).status, 'completed');
    const stopped = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 2, message: { mes: 'Ava enters the station.' }, acceptedSceneDelta: interpretationDelta({ location: 'station' }) });
    assert.equal(stopped.status, 'budget-stopped');
    assert.equal(runtime.getState().suggestion, null);
});

test('non-attached, stale, or gallery-only dispatch releases the reservation without spending a generation', async () => {
    for (const receipt of [false, { status: 'stale' }, { status: 'failed', attachmentStatus: 'not-attached' }]) {
        const { runtime, calls } = setup({ dispatch: async () => { calls.dispatch += 1; return receipt; } });
        await runtime.load({ chatId: 'chat-a', epoch: 1 });
        const suggestion = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 11, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
        const result = await runtime.approve(suggestion.suggestion.suggestionId);
        assert.equal(result.status, 'failed');
        assert.equal(runtime.getState().session.generationCount, 0);
        assert.equal(runtime.getState().session.reservedGenerationCount, 0);
        assert.equal(runtime.getState().session.settledPlans[result.receipt?.planId || Object.keys(runtime.getState().session.settledPlans)[0]]?.outcome, 'failed');
        assert.equal(calls.dispatch, 1);
    }
});

test('approval settlement stays with chat A while chat B is active, then restores A on return', async () => {
    let resolveDispatch;
    const pending = new Promise((resolve) => { resolveDispatch = resolve; });
    let dispatchStarted;
    const started = new Promise((resolve) => { dispatchStarted = resolve; });
    const states = new Map();
    let activeChat = 'chat-a';
    let activeEpoch = 1;
    const runtime = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 2 },
        getChatId: () => activeChat,
        getEpoch: () => activeEpoch,
        readState: ({ chatId } = {}) => states.get(chatId || activeChat) || { storyState: { schema: 1, sceneFacts: {} } },
        writeState: (value, { chatId } = {}) => states.set(chatId || activeChat, structuredClone(value)),
        saveChat: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => { dispatchStarted(); return pending; },
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const card = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 12, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    const approval = runtime.approve(card.suggestion.suggestionId);
    await started;
    activeChat = 'chat-b';
    activeEpoch = 2;
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().session.generationCount, 0);
    resolveDispatch({ status: 'completed', receipt: { actualCost: null } });
    const result = await approval;
    assert.equal(result.status, 'completed');
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().session.generationCount, 0);
    activeChat = 'chat-a';
    activeEpoch = 3;
    const restored = runtime.load({ chatId: 'chat-a', epoch: 3 });
    assert.equal(restored.chatId, 'chat-a');
    assert.equal(runtime.getState().session.generationCount, 1);
    assert.equal(runtime.getState().session.reservedGenerationCount, 0);
});

test('late failed approval releases chat A reservation without changing chat B', async () => {
    let rejectDispatch;
    const pending = new Promise((_resolve, reject) => { rejectDispatch = reject; });
    let dispatchStarted;
    const started = new Promise((resolve) => { dispatchStarted = resolve; });
    let activeChat = 'chat-a';
    let activeEpoch = 1;
    const runtime = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 2 },
        getChatId: () => activeChat,
        getEpoch: () => activeEpoch,
        readState: () => ({ storyState: { schema: 1, sceneFacts: {} } }),
        writeState: () => {},
        saveChat: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => { dispatchStarted(); return pending; },
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const card = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 13, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    const approval = runtime.approve(card.suggestion.suggestionId);
    await started;
    activeChat = 'chat-b';
    activeEpoch = 2;
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    rejectDispatch(new Error('provider failed'));
    const result = await approval;
    assert.equal(result.status, 'failed');
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().session.generationCount, 0);
    activeChat = 'chat-a';
    activeEpoch = 3;
    runtime.load({ chatId: 'chat-a', epoch: 3 });
    assert.equal(runtime.getState().session.generationCount, 0);
    assert.equal(runtime.getState().session.reservedGenerationCount, 0);
});

test('inactive settlement is durable across a runtime restart without overwriting chat B metadata', async () => {
    let resolveDispatch;
    const pending = new Promise((resolve) => { resolveDispatch = resolve; });
    let dispatchStarted;
    const started = new Promise((resolve) => { dispatchStarted = resolve; });
    let activeChat = 'chat-a';
    let activeEpoch = 1;
    const chatMetadata = new Map();
    const durable = new Map();
    const makeRuntime = (dispatch = async () => ({ status: 'completed' })) => createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 2 },
        getChatId: () => activeChat,
        getEpoch: () => activeEpoch,
        readState: ({ chatId } = {}) => chatMetadata.get(chatId || activeChat) || { storyState: { schema: 1, sceneFacts: {} } },
        writeState: (value, { chatId } = {}) => { if (!chatId || chatId === activeChat) chatMetadata.set(chatId || activeChat, structuredClone(value)); },
        readDurableState: ({ chatId } = {}) => durable.get(chatId || activeChat) || null,
        writeDurableState: (value, { chatId } = {}) => durable.set(chatId || activeChat, structuredClone(value)),
        saveDurableState: async () => {},
        saveChat: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch,
    });
    const runtime = makeRuntime(async () => { dispatchStarted(); return pending; });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const card = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 14, message: { mes: 'Ava enters the library.' }, acceptedSceneDelta: interpretationDelta({ location: 'library' }) });
    const approval = runtime.approve(card.suggestion.suggestionId);
    await started;
    activeChat = 'chat-b';
    activeEpoch = 2;
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    const bBefore = runtime.getState();
    resolveDispatch({ status: 'completed', receipt: { actualCost: null } });
    assert.equal((await approval).status, 'completed');
    assert.equal(runtime.getState().chatId, 'chat-b');
    assert.equal(runtime.getState().session.generationCount, bBefore.session.generationCount);
    assert.equal(chatMetadata.get('chat-a').cinematicAutomation.session.reservedGenerationCount, 1);
    assert.equal(durable.get('chat-a').session.reservedGenerationCount, 0);
    assert.doesNotMatch(JSON.stringify(durable.get('chat-a')), /Ava enters the library/);

    activeChat = 'chat-a';
    activeEpoch = 3;
    const restarted = makeRuntime();
    restarted.load({ chatId: 'chat-a', epoch: 3 });
    assert.equal(restarted.getState().session.generationCount, 1);
    assert.equal(restarted.getState().session.reservedGenerationCount, 0);
    activeChat = 'chat-b';
    activeEpoch = 4;
    restarted.load({ chatId: 'chat-b', epoch: 4 });
    assert.equal(restarted.getState().session.generationCount, bBefore.session.generationCount);
});

test('settings updates propagate to every remembered chat session', async () => {
    const { runtime, switchChat } = setup();
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    switchChat('chat-b');
    runtime.load({ chatId: 'chat-b', epoch: 2 });
    runtime.updateSettings({ mode: 'conservative', generationLimit: 7, costCeiling: null });
    switchChat('chat-a');
    runtime.load({ chatId: 'chat-a', epoch: 3 });
    assert.equal(runtime.getState().session.mode, 'conservative');
    assert.equal(runtime.getState().session.generationLimit, 7);
    assert.equal(runtime.getState().session.costCeiling, null);
});

test('active chat persistence uses a bounded provider-free projection and reloads a pending card', async () => {
    let latestChatMetadata = null;
    const runtime = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 150 },
        getChatId: () => 'chat-a',
        getEpoch: () => 1,
        readState: () => latestChatMetadata || { storyState: { schema: 1, sceneFacts: {} } },
        writeState: (value) => { latestChatMetadata = structuredClone(value); },
        saveChat: async () => {},
        saveDurableState: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => ({ status: 'completed', receipt: { actualCost: null } }),
    });
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    for (let index = 0; index < 110; index += 1) {
        const delta = interpretationDelta({ location: `location-${index}` });
        delta.acceptedEvidence = [{ source: 'private', text: 'PRIVATE_CINEMATIC_CHAT_TEXT_123' }];
        const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: index, message: { mes: `Private scene ${index}` }, acceptedSceneDelta: delta });
        if (result.suggestion) await runtime.approve(result.suggestion.suggestionId);
    }
    const pending = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 111, message: { mes: 'Private final scene' }, acceptedSceneDelta: interpretationDelta({ location: 'final-location' }) });
    assert.equal(pending.status, 'suggested');
    const serialized = JSON.stringify(latestChatMetadata);
    assert.doesNotMatch(serialized, /PRIVATE_CINEMATIC_CHAT_TEXT_123/);
    assert.doesNotMatch(serialized, /Private scene/);
    const persistedSession = latestChatMetadata.cinematicAutomation.session;
    assert.ok(Object.keys(persistedSession.eventRegistry).length <= 96);
    assert.ok(Object.keys(persistedSession.approvedSuggestionRecords).length <= 96);
    assert.ok(Object.keys(persistedSession.settledPlans).length <= 96);
    assert.ok(latestChatMetadata.cinematicAutomation.processedMessageIds.length <= 96);
    assert.ok(latestChatMetadata.cinematicAutomation.queuedEvents.length <= 24);

    const restarted = createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 150 },
        getChatId: () => 'chat-a',
        getEpoch: () => 2,
        readState: () => latestChatMetadata,
        writeState: (value) => { latestChatMetadata = structuredClone(value); },
        saveChat: async () => {},
        saveDurableState: async () => {},
        dispatch: async () => ({ status: 'completed', receipt: { actualCost: null } }),
    });
    const loaded = restarted.load({ chatId: 'chat-a', epoch: 2 });
    assert.equal(loaded.suggestion?.suggestionId, pending.suggestion.suggestionId);
    assert.equal((await restarted.approve(pending.suggestion.suggestionId)).status, 'completed');
    assert.equal(restarted.getState().session.reservedGenerationCount, 0);
});

test('bounded compaction protects an old pending event behind more than 110 queued changes', async () => {
    let latestChatMetadata = null;
    const makeRuntime = (epoch) => createCinematicRuntime({
        settings: { enabled: true, mode: 'frequent', generationLimit: 150 },
        getChatId: () => 'chat-a',
        getEpoch: () => epoch,
        readState: () => latestChatMetadata || { storyState: { schema: 1, sceneFacts: {} } },
        writeState: (value) => { latestChatMetadata = structuredClone(value); },
        saveChat: async () => {},
        saveDurableState: async () => {},
        interpret: ({ acceptedSceneDelta }) => acceptedSceneDelta,
        dispatch: async () => ({ status: 'completed', receipt: { actualCost: null } }),
    });
    const runtime = makeRuntime(1);
    runtime.load({ chatId: 'chat-a', epoch: 1 });
    const first = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 0, message: { mes: 'First location' }, acceptedSceneDelta: interpretationDelta({ location: 'first-location' }) });
    assert.equal(first.status, 'suggested');
    for (let index = 1; index <= 110; index += 1) {
        const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: index, message: { mes: `Queued location ${index}` }, acceptedSceneDelta: interpretationDelta({ location: `queued-location-${index}` }) });
        assert.equal(result.status, 'pending-suppressed');
    }
    const persisted = latestChatMetadata.cinematicAutomation.session;
    assert.ok(Object.keys(persisted.eventRegistry).length <= 96);
    assert.ok(Object.hasOwn(persisted.eventRegistry, first.suggestion.eventId));
    const restarted = makeRuntime(2);
    const loaded = restarted.load({ chatId: 'chat-a', epoch: 2 });
    assert.equal(loaded.suggestion?.suggestionId, first.suggestion.suggestionId);
    assert.equal((await restarted.approve(first.suggestion.suggestionId)).status, 'completed');
    assert.equal(restarted.getState().session.reservedGenerationCount, 0);
});

test('runtime accepts the real scene interpretation delta, not a message counter', async () => {
    const { runtime } = setup({
        interpret: ({ message, priorStoryState }) => buildSceneGenerationSnapshot({
            clickedMessage: message,
            identities: [{ id: 'character:ava', kind: 'character', label: 'Ava', aliases: ['Ava'] }],
            priorStoryState,
        }),
    });
    await runtime.load({ chatId: 'chat-a', epoch: 1 });
    const result = await runtime.observe({ chatId: 'chat-a', epoch: 1, messageId: 9, message: { name: 'Ava', mes: 'Ava enters the library.' } });
    assert.equal(result.status, 'suggested');
    assert.equal(result.suggestion.kind, 'location');
    assert.match(result.suggestion.whyFired.text, /accepted location change/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CINEMATIC_MODE_THRESHOLDS,
    createCinematicSession,
    deriveCinematicEvents,
    evaluateCinematicAutomation,
    approveCinematicSuggestion,
    dismissCinematicSuggestion,
    adjustCinematicSuggestion,
    retriggerCinematicBeat,
    resetCinematicSession,
} from '../lib/rp/cinematic-automation.js';

const delta = (overrides = {}) => ({
    accepted: true,
    revision: 'scene:12',
    updatedSceneFacts: { location: { from: 'station', to: 'library' } },
    acceptedEvidence: [{ source: 'selected-passage', text: 'Ava enters the library.' }],
    ...overrides,
});

test('accepted location, outfit, cast, and emotional beat deltas produce stable evidence-bearing events', () => {
    const input = delta({
        updatedSceneFacts: {
            location: { from: 'station', to: 'library' },
            outfits: [{ identityId: 'character:ava', from: 'red coat', to: 'blue dress' }],
            cast: { added: [{ identityId: 'npc:guide', label: 'Guide' }], removed: [] },
        },
        emotionalBeat: { id: 'beat:reunion', label: 'reunion', confidence: 'high' },
    });
    const first = deriveCinematicEvents(input);
    const second = deriveCinematicEvents(structuredClone(input));

    assert.deepEqual(first, second);
    assert.deepEqual(first.map((event) => event.kind), ['location', 'outfit', 'cast', 'emotional-beat']);
    assert.ok(first.every((event) => /^event:[a-f0-9]{16}$/u.test(event.eventId)));
    assert.ok(first.every((event) => /^beat:/u.test(event.beatId)));
    assert.equal(first[0].whyFired.reason, 'accepted location change');
    assert.deepEqual(first[0].whyFired.evidence, input.acceptedEvidence);
});

test('ordinary or ambiguous chat deltas are suppressed without becoming blocked chat', () => {
    assert.deepEqual(deriveCinematicEvents({ accepted: false, revision: 'message:1', messageCount: 999 }), []);
    assert.deepEqual(deriveCinematicEvents(delta({ ambiguous: true })), []);
    assert.deepEqual(deriveCinematicEvents(delta({
        updatedSceneFacts: { location: { from: 'station', to: 'library' } },
        location: { from: 'station', to: 'tavern' },
    })), []);
});

test('mode thresholds are explicit and do not depend on message count', () => {
    assert.deepEqual(CINEMATIC_MODE_THRESHOLDS, { conservative: 3, balanced: 2, frequent: 1 });
    const conservative = createCinematicSession({ sessionId: 's', mode: 'conservative', costCeiling: 1 });
    const outfit = evaluateCinematicAutomation({
        session: conservative,
        acceptedSceneDelta: delta({
            revision: 'scene:outfit',
            updatedSceneFacts: { outfits: [{ identityId: 'character:ava', from: 'red coat', to: 'blue dress' }] },
            messageCount: 100000,
        }),
    });
    assert.equal(outfit.status, 'below-threshold');
    const location = evaluateCinematicAutomation({ session: conservative, acceptedSceneDelta: delta() });
    assert.equal(location.status, 'suggested');
    assert.match(location.nextTrigger.explanation, /location|conservative/i);
    assert.match(location.suggestion.whyFired.text, /accepted location change/i);
});

test('duplicate accepted events are idempotently suppressed after the first suggestion', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const first = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const duplicate = evaluateCinematicAutomation({ session: first.session, acceptedSceneDelta: structuredClone(delta()) });
    assert.equal(first.status, 'suggested');
    assert.equal(duplicate.status, 'duplicate-suppressed');
    assert.equal(duplicate.suggestion, null);
    assert.deepEqual(duplicate.session, first.session);
});

test('approval, adjustment, and dismissal are explicit suggestion card states', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 0.25 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const adjusted = adjustCinematicSuggestion(suggested.suggestion, { prompt: 'A quiet wide shot of the library.' });
    assert.equal(adjusted.state, 'adjusted');
    assert.equal(adjusted.adjustments.prompt, 'A quiet wide shot of the library.');
    const dismissed = dismissCinematicSuggestion(adjusted);
    assert.equal(dismissed.state, 'dismissed');
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.25 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.session.generationCount, 1);
    assert.equal(approved.session.costSpent, 0.25);
    assert.equal(approved.plan.dispatch.allowed, false);
    assert.equal(approved.plan.dispatch.network, false);
    assert.equal(approved.plan.dispatch.reason, 'approval-plan-only');
    assert.equal(approveCinematicSuggestion(approved.session, suggested.suggestion, { estimatedCost: 0.25 }).status, 'already-approved');
});

test('unknown cost and over-ceiling cost fail closed while the exact boundary is allowed', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 0.1 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    assert.equal(approveCinematicSuggestion(suggested.session, suggested.suggestion, {}).status, 'unknown-cost');
    assert.equal(approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.1001 }).status, 'cost-ceiling');
    assert.equal(approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.1 }).status, 'approved');
    const unknownCeiling = createCinematicSession({ sessionId: 'unknown', mode: 'frequent' });
    const unknownSuggestion = evaluateCinematicAutomation({ session: unknownCeiling, acceptedSceneDelta: delta() });
    assert.equal(approveCinematicSuggestion(unknownSuggestion.session, unknownSuggestion.suggestion, { estimatedCost: 0 }).status, 'unknown-cost-ceiling');
});

test('manual retrigger creates a new plan candidate without replaying a chat event', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'balanced', costCeiling: 1 });
    const first = retriggerCinematicBeat({ session, beatId: 'beat:missed', retriggerId: 'retry:1', reason: 'missed beat' });
    const repeat = retriggerCinematicBeat({ session: first.session, beatId: 'beat:missed', retriggerId: 'retry:1', reason: 'missed beat' });
    assert.equal(first.status, 'suggested');
    assert.equal(first.suggestion.triggerSource, 'manual-retrigger');
    assert.equal(first.suggestion.replayedChatEvent, false);
    assert.equal(first.suggestion.beatId, 'beat:missed');
    assert.deepEqual(repeat, first);
});

test('session reset clears counters and seen events while preserving deterministic new session identity', () => {
    const session = createCinematicSession({ sessionId: 'old', mode: 'frequent', generationCount: 2, costSpent: 0.2, costCeiling: 1 });
    const reset = resetCinematicSession(session, { sessionId: 'new' });
    assert.equal(reset.sessionId, 'new');
    assert.equal(reset.generationCount, 0);
    assert.equal(reset.costSpent, 0);
    assert.deepEqual(reset.seenEventIds, []);
    assert.equal(reset.mode, 'frequent');
});

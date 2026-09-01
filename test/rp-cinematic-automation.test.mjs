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
    settleCinematicPlan,
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
    assert.deepEqual(duplicate.suggestion, first.suggestion);
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
    assert.equal(approved.session.generationCount, 0);
    assert.equal(approved.session.costSpent, 0);
    assert.equal(approved.session.reservedGenerationCount, 1);
    assert.equal(approved.session.reservedCost, 0.25);
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

test('approval reserves budget without charging, and settlement is idempotent with exact refund or release', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 0.25 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.2 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.session.generationCount, 0);
    assert.equal(approved.session.costSpent, 0);
    assert.equal(approved.session.reservedGenerationCount, 1);
    assert.equal(approved.session.reservedCost, 0.2);

    const dispatched = settleCinematicPlan(approved.session, approved.plan, 'dispatched');
    assert.equal(dispatched.status, 'dispatched');
    assert.equal(dispatched.session.costSpent, 0);
    const completed = settleCinematicPlan(dispatched.session, approved.plan, 'completed', { actualCost: 0.15 });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.session.generationCount, 1);
    assert.equal(completed.session.costSpent, 0.15);
    assert.equal(completed.session.reservedGenerationCount, 0);
    assert.equal(completed.session.reservedCost, 0);
    assert.deepEqual(settleCinematicPlan(completed.session, approved.plan, 'completed', { actualCost: 0.15 }), completed);

    const second = evaluateCinematicAutomation({ session: completed.session, acceptedSceneDelta: delta({ revision: 'scene:13' }) });
    const secondApproval = approveCinematicSuggestion(second.session, second.suggestion, { estimatedCost: 0.1 });
    const cancelled = settleCinematicPlan(secondApproval.session, secondApproval.plan, 'cancelled');
    assert.equal(cancelled.session.costSpent, 0.15);
    assert.equal(cancelled.session.generationCount, 1);
    assert.equal(cancelled.session.reservedCost, 0);
    assert.deepEqual(settleCinematicPlan(cancelled.session, secondApproval.plan, 'cancelled'), cancelled);
});

test('settlement failure releases reservation and unknown or over-ceiling actual cost fails closed', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 0.2 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.2 });
    assert.equal(settleCinematicPlan(approved.session, approved.plan, 'completed').status, 'unknown-cost');
    assert.equal(settleCinematicPlan(approved.session, approved.plan, 'completed', { actualCost: 0.2001 }).status, 'cost-ceiling');
    const failed = settleCinematicPlan(approved.session, approved.plan, 'failed', { actualCost: 0.2 });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.session.costSpent, 0);
    assert.equal(failed.session.reservedCost, 0);
});

test('approval accepts only a pending suggestion from the same session and event registry', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const forged = { ...suggested.suggestion, whyFired: { text: 'forged' } };
    assert.equal(approveCinematicSuggestion(suggested.session, forged, { estimatedCost: 0.1 }).status, 'invalid-suggestion');
    const other = createCinematicSession({ sessionId: 'other', mode: 'frequent', costCeiling: 1 });
    assert.equal(approveCinematicSuggestion(other, suggested.suggestion, { estimatedCost: 0.1 }).status, 'invalid-suggestion');
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.1 });
    assert.equal(approveCinematicSuggestion(approved.session, suggested.suggestion, { estimatedCost: 0.1 }).status, 'already-approved');
    assert.equal(approveCinematicSuggestion(approved.session, { ...suggested.suggestion, whyFired: { text: 'forged after approval' } }, { estimatedCost: 0.1 }).status, 'invalid-suggestion');
});

test('set-like event arrays have order-independent IDs and cards expose only sanitized event changes', () => {
    const first = deriveCinematicEvents(delta({
        revision: 'scene:set',
        updatedSceneFacts: { cast: { added: [{ identityId: 'a', label: 'A' }, { identityId: 'b', label: 'B' }], removed: [] } },
        evidence: [{ text: 'ignore me' }],
    }));
    const second = deriveCinematicEvents(delta({
        revision: 'scene:set',
        updatedSceneFacts: { cast: { added: [{ identityId: 'b', label: 'B' }, { identityId: 'a', label: 'A' }], removed: [] } },
        evidence: [{ text: 'different evidence' }],
    }));
    assert.equal(first[0].eventId, second[0].eventId);
    const result = evaluateCinematicAutomation({ session: createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 }), acceptedSceneDelta: delta({
        updatedSceneFacts: { location: { from: 'station', to: 'library', prompt: 'drop me' } },
        prompt: 'drop me',
    }) });
    assert.deepEqual(result.suggestion.change, { from: 'station', to: 'library' });
});

test('conservative and balanced thresholds accumulate accepted unconsumed beats, and dismissal consumes idempotently', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'conservative', costCeiling: 1 });
    const outfit = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta({ revision: 'scene:o', updatedSceneFacts: { outfits: [{ identityId: 'a', from: 'red', to: 'blue' }] } }) });
    assert.equal(outfit.status, 'below-threshold');
    const cast = evaluateCinematicAutomation({ session: outfit.session, acceptedSceneDelta: delta({ revision: 'scene:c', updatedSceneFacts: { cast: { added: [{ identityId: 'b' }], removed: [] } } }) });
    assert.equal(cast.status, 'suggested');
    assert.match(cast.nextTrigger.explanation, /outfit|cast/i);
    const dismissed = dismissCinematicSuggestion(cast.session, cast.suggestion);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.session.consumedEventIds.length, 2);
    assert.deepEqual(dismissCinematicSuggestion(dismissed.session, cast.suggestion), dismissed);
});

test('any nested ambiguity in an accepted delta suppresses the entire automation decision', () => {
    assert.deepEqual(deriveCinematicEvents(delta({
        updatedSceneFacts: { location: { from: 'station', to: 'library', status: 'confirmed' }, outfits: { ambiguous: true, added: [{ identityId: 'a' }] } },
    })), []);
});

test('new accepted events do not create an overlapping card while one suggestion is pending', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const first = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta({ revision: 'scene:first' }) });
    const second = evaluateCinematicAutomation({ session: first.session, acceptedSceneDelta: delta({
        revision: 'scene:second',
        updatedSceneFacts: {},
        emotionalBeat: { id: 'beat:tension', label: 'tension' },
    }) });
    assert.equal(second.status, 'pending-suppressed');
    assert.equal(Object.keys(second.session.pendingSuggestions).length, 1);
    assert.deepEqual(second.suggestion, first.suggestion);
    assert.equal(second.session.pendingSuggestions[first.suggestion.suggestionId].eventIds.includes(second.events[0].eventId), false);
});

test('manual retriggers register pending provenance and can use every card action without replaying chat', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const retry = retriggerCinematicBeat({ session, beatId: 'beat:missed', retriggerId: 'retry:registered' });
    assert.ok(retry.session.eventRegistry[retry.suggestion.eventId]);
    assert.ok(retry.session.pendingSuggestions[retry.suggestion.suggestionId]);
    const approved = approveCinematicSuggestion(retry.session, retry.suggestion, { estimatedCost: 0.1 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.plan.triggerSource, 'manual-retrigger');
    assert.equal(approved.plan.dispatch.network, false);
});

test('settlement verifies the complete stored plan identity before changing budget state', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.2 });
    const forged = { ...approved.plan, eventId: 'event:forged' };
    const result = settleCinematicPlan(approved.session, forged, 'completed', { actualCost: 0.2 });
    assert.equal(result.status, 'invalid-plan');
    assert.equal(result.session.reservedCost, 0.2);
});

test('manual retrigger respects the single pending-card invariant', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const first = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const retry = retriggerCinematicBeat({ session: first.session, beatId: 'beat:missed', retriggerId: 'retry:while-pending' });
    assert.equal(retry.status, 'pending-suppressed');
    assert.deepEqual(retry.suggestion, first.suggestion);
    assert.equal(Object.keys(retry.session.pendingSuggestions).length, 1);
});

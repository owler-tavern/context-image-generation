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
    resetCinematicSession,
    settleCinematicPlan,
    projectNextCinematicSuggestion,
} from '../lib/rp/cinematic-automation.js';

const delta = (overrides = {}) => ({
    accepted: true,
    revision: 'scene:12',
    updatedSceneFacts: { location: { from: 'station', to: 'library' } },
    acceptedEvidence: [{ source: 'selected-passage', text: 'Ava enters the library.' }],
    ...overrides,
});

test('accepted location, cast, and emotional beat deltas produce stable evidence-bearing events while outfits stay inert', () => {
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
    assert.deepEqual(first.map((event) => event.kind), ['location', 'cast', 'emotional-beat']);
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
    const cast = evaluateCinematicAutomation({
        session: conservative,
        acceptedSceneDelta: delta({
            revision: 'scene:cast',
            updatedSceneFacts: { cast: { added: [{ identityId: 'character:ava' }], removed: [] } },
            messageCount: 100000,
        }),
    });
    assert.equal(cast.status, 'below-threshold');
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
    const firstCast = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta({ revision: 'scene:a', updatedSceneFacts: { cast: { added: [{ identityId: 'a' }], removed: [] } } }) });
    assert.equal(firstCast.status, 'below-threshold');
    const secondCast = evaluateCinematicAutomation({ session: firstCast.session, acceptedSceneDelta: delta({ revision: 'scene:b', updatedSceneFacts: { cast: { added: [{ identityId: 'b' }], removed: [] } } }) });
    assert.equal(secondCast.status, 'suggested');
    assert.match(secondCast.nextTrigger.explanation, /cast/i);
    const dismissed = dismissCinematicSuggestion(secondCast.session, secondCast.suggestion);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.session.consumedEventIds.length, 2);
    assert.deepEqual(dismissCinematicSuggestion(dismissed.session, secondCast.suggestion), dismissed);
});

test('retired outfit ambiguity cannot suppress an accepted non-outfit event', () => {
    assert.deepEqual(deriveCinematicEvents(delta({
        updatedSceneFacts: { location: { from: 'station', to: 'library', status: 'confirmed' }, outfits: { ambiguous: true, added: [{ identityId: 'a' }] } },
    })).map((event) => event.kind), ['location']);
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

test('settlement verifies the complete stored plan identity before changing budget state', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const suggested = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta() });
    const approved = approveCinematicSuggestion(suggested.session, suggested.suggestion, { estimatedCost: 0.2 });
    const forged = { ...approved.plan, eventId: 'event:forged' };
    const result = settleCinematicPlan(approved.session, forged, 'completed', { actualCost: 0.2 });
    assert.equal(result.status, 'invalid-plan');
    assert.equal(result.session.reservedCost, 0.2);
});

test('queued events drain into the next card exactly once after the current card is used or dismissed', () => {
    const session = createCinematicSession({ sessionId: 's', mode: 'frequent', costCeiling: 1 });
    const first = evaluateCinematicAutomation({ session, acceptedSceneDelta: delta({ revision: 'scene:first' }) });
    const queued = evaluateCinematicAutomation({ session: first.session, acceptedSceneDelta: delta({
        revision: 'scene:queued', updatedSceneFacts: {}, emotionalBeat: { id: 'beat:queued', label: 'queued beat' },
    }) });
    assert.equal(queued.status, 'pending-suppressed');
    const dismissed = dismissCinematicSuggestion(queued.session, first.suggestion);
    const next = projectNextCinematicSuggestion({ session: dismissed.session });
    assert.equal(next.status, 'suggested');
    assert.equal(next.suggestion.eventId, queued.events[0].eventId);
    assert.equal(next.session.consumedEventIds.includes(queued.events[0].eventId), false);
    const repeated = projectNextCinematicSuggestion({ session: next.session });
    assert.equal(repeated.status, 'duplicate-suppressed');
    assert.deepEqual(repeated.suggestion, next.suggestion);

    const queuedForApproval = evaluateCinematicAutomation({ session: first.session, acceptedSceneDelta: delta({
        revision: 'scene:queued-approval', updatedSceneFacts: {}, emotionalBeat: { id: 'beat:queued-approval', label: 'queued beat' },
    }) });
    const approvedFirst = approveCinematicSuggestion(queuedForApproval.session, first.suggestion, { estimatedCost: 0.1 });
    const afterApproval = projectNextCinematicSuggestion({ session: approvedFirst.session });
    assert.equal(afterApproval.status, 'suggested');
});

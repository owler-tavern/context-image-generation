import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretScene } from '../lib/rp/scene-interpretation.js';

const identities = [
    { id: 'character:ava', kind: 'character', label: 'Ava', aliases: ['Ava Stone'] },
    { id: 'user:sam', kind: 'user', label: 'Sam', aliases: ['Sam'] },
    { id: 'npc:guard', kind: 'npc', label: 'The Guard', aliases: ['guard'] },
    { id: 'npc:scribe', kind: 'npc', label: 'The Scribe', aliases: ['scribe'] },
];

test('selected passage is the highest-priority focus and carries source evidence', () => {
    const result = interpretScene({
        selectedPassage: 'Ava raises the silver lantern.',
        clickedMessage: { name: 'Ava', mes: 'Ava raises the silver lantern in the library.' },
        recentContext: [{ name: 'Sam', mes: 'Sam waits outside.' }],
        identities,
    });

    assert.deepEqual(result.focusPassage, {
        text: 'Ava raises the silver lantern.',
        source: 'selected-passage',
        confidence: 'high',
        evidence: [{ source: 'selected-passage', text: 'Ava raises the silver lantern.' }],
    });
    assert.equal(result.cast[0].identityId, 'character:ava');
    assert.equal(result.cast.some((entry) => entry.identityId === 'user:sam'), false);
});

test('cast excludes narrator, absent mentions, and negated mentions while preserving ambiguity', () => {
    const result = interpretScene({
        clickedMessage: { name: 'Ava', mes: 'Ava watches the doorway. Sam is not here; the guard is absent. Guide waits nearby.' },
        recentContext: [{ name: 'GM', mes: 'The narrator says the scribe is elsewhere.' }],
        identities: [
            ...identities,
            { id: 'npc:guide', kind: 'npc', label: 'Guide', aliases: ['guide'] },
            { id: 'npc:guide-2', kind: 'npc', label: 'Guide Two', aliases: ['guide'] },
        ],
    });

    assert.deepEqual(result.cast.map((entry) => entry.identityId), ['character:ava']);
    assert.ok(result.excluded.some((entry) => entry.identityId === 'user:sam' && entry.reason === 'negated'));
    assert.ok(result.excluded.some((entry) => entry.identityId === 'npc:guard' && entry.reason === 'absent'));
    assert.ok(result.ambiguities.some((entry) => entry.alias === 'guide'));
});

test('location and non-outfit scene details are conservative, current, and evidence-bearing', () => {
    const result = interpretScene({
        selectedPassage: 'In the library, Ava wears a wet blue coat and holds a silver lantern. A bruise darkens her cheek.',
        clickedMessage: { name: 'Ava', mes: 'Ava leaves the station.' },
        identities,
    });

    assert.equal(result.location.value, 'library');
    assert.equal(result.location.confidence, 'high');
    assert.equal(Object.hasOwn(result, 'outfits'), false);
    assert.deepEqual(result.objects, [{
        value: 'silver lantern', holderIdentityId: 'character:ava', confidence: 'high',
        evidence: [{ source: 'selected-passage', text: 'In the library, Ava wears a wet blue coat and holds a silver lantern. A bruise darkens her cheek.' }],
    }]);
    assert.deepEqual(result.injuries, [{
        identityId: 'character:ava', value: 'bruise on cheek', confidence: 'high',
        evidence: [{ source: 'selected-passage', text: 'In the library, Ava wears a wet blue coat and holds a silver lantern. A bruise darkens her cheek.' }],
    }]);
});

test('no selected passage falls back to the clicked message and reports unknown details safely', () => {
    const result = interpretScene({
        clickedMessage: { name: 'Ava', mes: 'Ava pauses.' },
        identities,
    });

    assert.equal(result.focusPassage.source, 'clicked-message');
    assert.equal(result.location.status, 'unknown');
    assert.equal(Object.hasOwn(result, 'outfits'), false);
    assert.deepEqual(result.objects, []);
    assert.deepEqual(result.injuries, []);
});

test('future or malformed inputs do not trigger network/provider calls', () => {
    const result = interpretScene({ selectedPassage: null, recentContext: null, identities: null });
    assert.equal(result.schema, 1);
    assert.equal(result.focusPassage.source, 'unknown');
    assert.equal(result.focusPassage.confidence, 'low');
    assert.deepEqual(result.cast, []);
});

test('preserves segment speaker and role while excluding GM and narrator assertions', () => {
    const result = interpretScene({
        clickedMessage: { name: 'GM', role: 'gm', mes: 'Ava is at the library.' },
        recentContext: [{ name: 'Narrator', role: 'narrator', mes: 'Sam enters the station.' }],
        identities,
    });

    assert.deepEqual(result.cast, []);
    assert.equal(result.location.status, 'unknown');

    const character = interpretScene({
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava waits.' },
        identities,
    });
    assert.deepEqual(character.cast[0].evidence[0], {
        source: 'clicked-message', text: 'Ava waits.', speaker: 'Ava', role: 'character',
    });
});

test('higher-rank selected absence suppresses lower-rank presence and predicate negation does not negate identity', () => {
    const absent = interpretScene({
        selectedPassage: 'Sam is absent.',
        clickedMessage: { name: 'Sam', role: 'character', mes: 'Sam enters the library.' },
        identities,
    });
    assert.equal(absent.cast.some((entry) => entry.identityId === 'user:sam'), false);
    assert.ok(absent.excluded.some((entry) => entry.identityId === 'user:sam' && entry.reason === 'absent'));

    const predicate = interpretScene({
        selectedPassage: 'Ava is not holding a map.',
        identities,
    });
    assert.equal(predicate.cast[0].identityId, 'character:ava');
    assert.deepEqual(predicate.objects, []);
});

test('quoted identity mentions remain unresolved and clothing is not a location', () => {
    const result = interpretScene({
        selectedPassage: 'Ava says, "Sam is here." Ava is in a red coat.',
        identities,
    });
    assert.deepEqual(result.cast.map((entry) => entry.identityId), ['character:ava']);
    assert.ok(result.ambiguities.some((entry) => entry.alias === 'Sam' && entry.reason === 'quoted'));
    assert.equal(result.location.status, 'unknown');
});

test('explicit departure is carried as high-confidence state evidence', () => {
    const result = interpretScene({
        clickedMessage: { name: 'Ava', mes: 'Ava leaves the station.' },
        priorStoryState: { sceneFacts: { location: 'station' } },
        identities,
    });
    assert.equal(result.location.status, 'unknown');
    assert.equal(result.sceneSignals.location.clear, true);
    assert.equal(result.sceneSignals.location.confidence, 'high');
    assert.equal(result.storyStateDelta.nextState.sceneFacts.location, undefined);
    assert.equal(result.storyStateDelta.removedSceneFacts.location, 'station');
});

test('explicit object removal clears only the obsolete object fact', () => {
    const result = interpretScene({
        clickedMessage: { name: 'Ava', mes: 'Ava drops the map.' },
        priorStoryState: { sceneFacts: { objects: [{ value: 'map' }], outfits: [{ identityId: 'character:ava', value: 'red coat' }] } },
        identities,
    });
    assert.deepEqual(result.sceneSignals.objects.remove, [{ value: 'map', identityId: 'character:ava', holderIdentityId: 'character:ava' }]);
    assert.deepEqual(result.storyStateDelta.nextState.sceneFacts.objects, []);
    assert.equal(Object.hasOwn(result.storyStateDelta.nextState.sceneFacts, 'outfits'), false);
});

test('low-confidence recent departure is evidence but does not clear prior location', () => {
    const result = interpretScene({
        recentContext: [{ name: 'Ava', role: 'character', mes: 'Ava leaves the station.' }],
        priorStoryState: { sceneFacts: { location: 'station' } },
        identities,
    });
    assert.equal(result.sceneSignals.location.confidence, 'medium');
    assert.equal(result.storyStateDelta.nextState.sceneFacts.location, 'station');
    assert.deepEqual(result.storyStateDelta.removedSceneFacts, {});
});

test('scopes identity negation to presence predicates instead of unrelated actions', () => {
    const result = interpretScene({ selectedPassage: 'No one sees Ava smile.', identities });
    assert.deepEqual(result.cast.map((entry) => entry.identityId), ['character:ava']);
});

test('keeps ASCII and curly single or double quoted aliases unresolved', () => {
    const texts = [
        'Ava says, "Sam is here."',
        'Ava says, “Sam is here.”',
        "Ava says, 'Sam is here.'",
        'Ava says, ‘Sam is here.’',
    ];
    for (const selectedPassage of texts) {
        const result = interpretScene({ selectedPassage, identities });
        assert.equal(result.cast.some((entry) => entry.identityId === 'user:sam'), false, selectedPassage);
        assert.ok(result.ambiguities.some((entry) => entry.alias === 'Sam' && entry.reason === 'quoted'), selectedPassage);
    }
});

test('an absent identity blocks its lower-rank object facts while attire remains ordinary text', () => {
    const result = interpretScene({
        selectedPassage: 'Sam is absent.',
        clickedMessage: { name: 'Sam', role: 'character', mes: 'Sam wears a red coat and holds a map.' },
        identities,
    });
    assert.equal(Object.hasOwn(result, 'outfits'), false);
    assert.deepEqual(result.objects, []);
});

test('selected absence suppresses lower-rank location facts attributable only to that identity', () => {
    const result = interpretScene({
        selectedPassage: 'Sam is absent.',
        clickedMessage: { name: 'Sam', role: 'character', mes: 'Sam waits at the station.' },
        identities,
    });
    assert.equal(result.location.status, 'unknown');
});

test('selected absence does not suppress lower-rank object facts for another identity', () => {
    const result = interpretScene({
        selectedPassage: 'Sam is absent.',
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava holds a lantern.' },
        identities,
    });
    assert.deepEqual(result.objects, [{ value: 'lantern', holderIdentityId: 'character:ava', confidence: 'high', evidence: [{ source: 'clicked-message', text: 'Ava holds a lantern.', speaker: 'Ava', role: 'character' }] }]);
});

test('targeted absence removes only that identity from retained cast', () => {
    const result = interpretScene({
        selectedPassage: 'Sam is absent.',
        clickedMessage: { name: 'Ava', role: 'character', mes: 'Ava is here.' },
        priorStoryState: { sceneFacts: { cast: [{ identityId: 'user:sam', label: 'Sam' }, { identityId: 'character:ava', label: 'Ava' }] } },
        identities,
    });
    assert.deepEqual(result.storyStateDelta.nextState.sceneFacts.cast.map((entry) => entry.identityId), ['character:ava']);
});

test('removal signals target one object rather than clearing a collection', () => {
    const objectResult = interpretScene({
        clickedMessage: { name: 'Ava', mes: 'Ava drops the map.' },
        priorStoryState: { sceneFacts: { objects: [{ value: 'map', holderIdentityId: 'character:ava' }, { value: 'lantern', holderIdentityId: 'character:ava' }] } },
        identities,
    });
    assert.deepEqual(objectResult.storyStateDelta.nextState.sceneFacts.objects, [{ value: 'lantern', holderIdentityId: 'character:ava' }]);

});

test('new observations preserve unmentioned cast while attire remains ordinary text', () => {
    const result = interpretScene({
        selectedPassage: 'Ava wears a blue coat.',
        priorStoryState: { sceneFacts: { cast: [{ identityId: 'user:sam', label: 'Sam' }], outfits: [{ identityId: 'user:sam', value: 'blue shirt' }] } },
        identities,
    });
    assert.deepEqual(result.storyStateDelta.nextState.sceneFacts.cast.map((entry) => entry.identityId).sort(), ['user:sam', 'character:ava'].sort());
    assert.equal(Object.hasOwn(result.storyStateDelta.nextState.sceneFacts, 'outfits'), false);
    assert.deepEqual(result.storyStateDelta.removedSceneFacts, {});
});

test('new object observations preserve other objects held by the same identity', () => {
    const result = interpretScene({
        selectedPassage: 'Ava holds a lantern.',
        priorStoryState: { sceneFacts: { objects: [{ value: 'map', holderIdentityId: 'character:ava' }] } },
        identities,
    });
    assert.deepEqual(result.storyStateDelta.nextState.sceneFacts.objects, [
        { value: 'map', holderIdentityId: 'character:ava' },
        { value: 'lantern', holderIdentityId: 'character:ava' },
    ]);
});

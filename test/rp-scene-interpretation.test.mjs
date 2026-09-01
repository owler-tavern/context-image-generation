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

test('location and scene details are conservative, current, and evidence-bearing', () => {
    const result = interpretScene({
        selectedPassage: 'In the library, Ava wears a wet blue coat and holds a silver lantern. A bruise darkens her cheek.',
        clickedMessage: { name: 'Ava', mes: 'Ava leaves the station.' },
        identities,
    });

    assert.equal(result.location.value, 'library');
    assert.equal(result.location.confidence, 'high');
    assert.deepEqual(result.outfits, [{
        identityId: 'character:ava', value: 'wet blue coat', confidence: 'high',
        evidence: [{ source: 'selected-passage', text: 'In the library, Ava wears a wet blue coat and holds a silver lantern. A bruise darkens her cheek.' }],
    }]);
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
    assert.deepEqual(result.outfits, []);
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

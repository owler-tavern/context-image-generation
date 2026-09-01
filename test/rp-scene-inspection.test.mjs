import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSceneInspection } from '../lib/rp/scene-inspection.js';

test('projects an interpretation into a stable, human-readable inspection view', () => {
    const view = projectSceneInspection({
        focusPassage: { text: 'Ava raises the lantern.', source: 'selected-passage', confidence: 'high' },
        cast: [{ identityId: 'character:ava', label: 'Ava', kind: 'character', confidence: 'high' }],
        location: { value: 'library', status: 'confirmed', confidence: 'high' },
        outfits: [{ identityId: 'character:ava', value: 'wet blue coat', confidence: 'high' }],
        objects: [{ value: 'silver lantern', holderIdentityId: 'character:ava', confidence: 'high' }],
        injuries: [],
        storyStateDelta: { removedSceneFacts: {}, updatedSceneFacts: {} },
    });

    assert.deepEqual(view, {
        title: 'Scene interpretation',
        confidence: 'high',
        lines: [
            'Focus: Ava raises the lantern.',
            'Present: Ava.',
            'Location: library.',
            'Outfits: Ava — wet blue coat.',
            'Objects: silver lantern (held by Ava).',
            'Injuries: none recorded.',
            'State changes: none recorded.',
        ],
        warnings: [],
    });
});

test('inspection makes uncertainty and omissions visible instead of inventing details', () => {
    const view = projectSceneInspection({
        focusPassage: { text: '', source: 'unknown', confidence: 'low' },
        cast: [],
        location: { value: null, status: 'ambiguous', confidence: 'low', candidates: ['station', 'library'] },
        outfits: [],
        objects: [],
        injuries: [],
        ambiguities: [{ alias: 'Guide', candidates: ['npc:a', 'npc:b'] }],
        excluded: [{ identityId: 'npc:c', reason: 'negated' }],
    });

    assert.equal(view.lines[0], 'Focus: unavailable.');
    assert.equal(view.lines[1], 'Present: none confidently identified.');
    assert.equal(view.lines[2], 'Location: ambiguous (station, library).');
    assert.ok(view.warnings.includes('The alias "Guide" matched more than one identity.'));
    assert.ok(view.warnings.includes('One or more mentions were excluded because they were negated or absent.'));
});

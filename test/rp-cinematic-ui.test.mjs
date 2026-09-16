import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCinematicSuggestionCard, CINEMATIC_UI_CSS, createCinematicUiController } from '../lib/rp/cinematic-ui.js';

const suggestion = {
    suggestionId: 'suggestion:test', state: 'suggested', kind: 'location',
    whyFired: { text: 'Fired because an accepted location change was accepted.' },
    proposedShot: 'Wide establishing shot of library',
    nextTrigger: { explanation: 'Next cinematic suggestion fires in frequent mode.' },
    budgetText: '1 of 2 generations used',
};

test('suggestion card renders why, proposed shot, budget, and wand staging action', () => {
    const html = renderCinematicSuggestionCard(suggestion);
    assert.match(html, /data-cig-cinematic-card="suggestion:test"/);
    assert.match(html, /accepted location change/i);
    assert.match(html, /Wide establishing shot of library/);
    assert.match(html, /1 of 2 generations used/);
    for (const action of ['stage', 'adjust', 'dismiss']) assert.match(html, new RegExp(`data-cig-cinematic-action="${action}"`));
    assert.doesNotMatch(html, /data-cig-cinematic-action="approve"/);
    assert.match(html, /Use for next wand/);
    assert.match(CINEMATIC_UI_CSS, /min-height:\s*44px/);
});

test('UI controller routes card actions without hidden network calls', async () => {
    const calls = [];
    const controller = createCinematicUiController({
        getSuggestion: () => suggestion,
        adjust: async (id) => calls.push(['adjust', id]),
        dismiss: async (id) => calls.push(['dismiss', id]),
        stage: async (id) => calls.push(['stage', id]),
        render: () => {},
    });
    await controller.action('adjust');
    await controller.action('dismiss');
    await controller.action('stage');
    assert.deepEqual(calls, [['adjust', 'suggestion:test'], ['dismiss', 'suggestion:test'], ['stage', 'suggestion:test']]);
});

test('legacy approve actions are inert and cannot reach a retained callback', async () => {
    let approvals = 0;
    const controller = createCinematicUiController({
        getSuggestion: () => suggestion,
        approve: async () => { approvals += 1; },
    });

    assert.deepEqual(await controller.action('approve'), { status: 'unknown-action' });
    assert.equal(approvals, 0);
});

test('UI controller honors the clicked card identity for stale-safe dismissal', async () => {
    const calls = [];
    const controller = createCinematicUiController({
        getSuggestion: () => suggestion,
        dismiss: async (id) => calls.push(id),
    });
    await controller.action('dismiss', '', 'suggestion:clicked-card');
    assert.deepEqual(calls, ['suggestion:clicked-card']);
});

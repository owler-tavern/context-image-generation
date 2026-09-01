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

test('suggestion card renders why, proposed shot, budget, and accessible actions', () => {
    const html = renderCinematicSuggestionCard(suggestion);
    assert.match(html, /data-cig-cinematic-card="suggestion:test"/);
    assert.match(html, /accepted location change/i);
    assert.match(html, /Wide establishing shot of library/);
    assert.match(html, /1 of 2 generations used/);
    for (const action of ['approve', 'adjust', 'dismiss']) assert.match(html, new RegExp(`data-cig-cinematic-action="${action}"`));
    assert.match(CINEMATIC_UI_CSS, /min-height:\s*44px/);
});

test('UI controller routes card actions without hidden network calls', async () => {
    const calls = [];
    const controller = createCinematicUiController({
        getSuggestion: () => suggestion,
        adjust: async (id) => calls.push(['adjust', id]),
        dismiss: async (id) => calls.push(['dismiss', id]),
        approve: async (id) => calls.push(['approve', id]),
        render: () => {},
    });
    await controller.action('adjust');
    await controller.action('dismiss');
    await controller.action('approve');
    assert.deepEqual(calls, [['adjust', 'suggestion:test'], ['dismiss', 'suggestion:test'], ['approve', 'suggestion:test']]);
});


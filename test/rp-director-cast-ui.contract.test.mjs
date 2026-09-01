import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDirectorPanel } from '../lib/rp/director-ui.js';

test('Director renders an accessible cast correction section with clear current states and empty state', () => {
    const html = renderDirectorPanel({
        messageId: 4,
        castCandidates: [
            { identityId: 'character:ava', label: 'Ava', action: 'include' },
            { identityId: 'character:rowan', label: 'Rowan', action: 'exclude' },
        ],
    });
    assert.match(html, /Cast correction/);
    assert.match(html, /Ava/);
    assert.match(html, /Rowan/);
    assert.match(html, /Include Ava/);
    assert.match(html, /Focus Ava/);
    assert.match(html, /Exclude Ava/);
    assert.match(html, /Current: included/);
    assert.match(html, /Current: excluded/);
    assert.match(html, /min-height:44px/);

    const empty = renderDirectorPanel({ messageId: 4, castCandidates: [] });
    assert.match(empty, /No confident cast candidates were found/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCastCorrectionControls } from '../lib/rp/cast-settings-ui.js';

const identities = [
    { id: 'character:ava.png', label: 'Ava', kind: 'character' },
    { id: 'user:adam.png', label: 'Adam', kind: 'user' },
    { id: 'npc:chat-42:rowan', label: 'Rowan', kind: 'npc' },
];

test('cast settings are progressively disclosed, plain-language, and keyboard-safe', () => {
    const html = renderCastCorrectionControls({ identities });
    assert.match(html, /Current cast/u);
    assert.match(html, /Correct who appears/u);
    assert.match(html, /Automatic \(recommended\)/u);
    assert.match(html, /Include/u);
    assert.match(html, /Focus/u);
    assert.match(html, /Exclude/u);
    assert.match(html, /data-cig-chat-cast-action="character:ava\.png"/u);
    assert.match(html, /data-cig-chat-cast-action="user:adam\.png"/u);
    assert.match(html, /data-cig-chat-cast-action="npc:chat-42:rowan"/u);
    assert.match(html, /min-height:44px/u);
});

test('cast settings can correct a current-chat NPC without exposing global identities', () => {
    const html = renderCastCorrectionControls({
        identities: [{ id: 'npc:chat-42:rowan', label: 'Rowan', kind: 'npc' }],
        overrides: [{ identityId: 'npc:chat-42:rowan', action: 'exclude' }],
    });
    assert.match(html, /Rowan/u);
    assert.match(html, /value="exclude"[^>]*selected/u);
    assert.doesNotMatch(html, /global-npc/u);
});

test('active cast corrections show a concise summary without raw story text', () => {
    const html = renderCastCorrectionControls({
        identities,
        overrides: [{ identityId: 'character:ava.png', action: 'include' }, { identityId: 'user:adam.png', action: 'focus' }],
    });
    assert.match(html, /Cast corrections active/u);
    assert.match(html, /Ava included/u);
    assert.match(html, /Adam focused/u);
    assert.doesNotMatch(html, /private scene text/u);
});

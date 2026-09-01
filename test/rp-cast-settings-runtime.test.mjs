import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production mounts cast corrections in Current chat characters and persists only chat canon', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);
    assert.match(settings, /id="cig_chat_cast_corrections"/u);
    assert.match(index, /renderCastCorrectionControls/u);
    assert.match(index, /data-cig-chat-cast-action/u);
    assert.match(index, /chooseChatCastOverride/u);
    assert.match(index, /setChatCastOverride/u);
    assert.match(index, /getChatCastOverrides/u);
    assert.match(index, /chat_metadata\[CHAT_CANON_KEY\]/u);
    assert.match(index, /saveChatConditional/u);
    assert.match(index, /const effectiveCastOverrides =/u);
    assert.match(index, /castOverrides: effectiveCastOverrides/u);
    assert.match(index, /\['character', 'user', 'npc'\]/u);
    assert.match(index, /currentChatId/u);
    assert.doesNotMatch(index, /chooseChatCastOverride[\s\S]{0,900}generateImage/u);
});

test('cast settings remain provider-free and the host wand remains the only generation action', async () => {
    const [index, settings] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    ]);
    const handler = index.match(/\$\(document\)\.on\('change', '\[data-cig-chat-cast-action\]'[\s\S]*?\n\s*\}\);/u)?.[0] || '';
    assert.match(handler, /chooseChatCastOverride/u);
    assert.doesNotMatch(handler, /fetch|dispatchProviderRoute|attachGeneratedImage|generateImage/u);
    assert.doesNotMatch(settings, /id="cig_chat_cast_corrections"[\s\S]*?Generate directed image/u);
});

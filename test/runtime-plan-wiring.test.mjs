import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Remember promotes a distinct asset and binds only the captured current chat', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const runtime = await readFile(new URL('../lib/rp/appearance-runtime.js', import.meta.url), 'utf8');
    assert.match(source, /promoteGalleryArtifact/);
    assert.match(source, /createAppearanceFeatureController/);
    assert.match(runtime, /Saved and active in this chat\./);
    assert.match(source, /Saved as an alternate; your locked look was not changed\./);
    assert.match(runtime, /Saved to the appearance library, but the chat changed before it could be activated\./);
    assert.match(source, /chatLifecycleEpoch\.isCurrent/);
    assert.match(source, /saveMetadata/);
});

test('Appearance UI exposes per-chat use and lock actions', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /Active in this chat/);
    assert.match(source, /Locked for this chat/);
    assert.match(source, /Use in this chat/);
    assert.match(source, /Lock for this chat/);
    assert.match(source, /Replace the locked look for this chat\?/);
});

test('shared generation path builds one plan and labels invocation sources', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(index, /createGenerationPlan\(/);
    assert.match(index, /materializeReferences\(/);
    assert.match(index, /buildMessages\(prompt, sender, messageId, focusText, invocation\)/);
    assert.match(index, /invocation: 'automation'/);
    assert.match(index, /'slash'\)/);
    assert.match(index, /await attachGeneratedImage\(\s*navigation\.message,\s*navigation\.messageElement,\s*navigation\.message\.mes,\s*sender,\s*navigation\.messageId,\s*null,\s*null,\s*'swipe',\s*\);/);
});

test('runtime dispatch does not reference a removed SillyTavern request callback', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(index, /\brequestSillyTavernImage\b/u);
});

test('runtime snapshots resolve adapter IDs through the shared route contract', async () => {
    const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const snapshot = index.slice(index.indexOf('function captureGenerationSnapshot'), index.indexOf('async function materializeSnapshotAssets'));
    assert.match(snapshot, /resolveAdapterId\(legacyTransport\)/);
    assert.doesNotMatch(snapshot, /openAiImages:\s*'openai-images'/);
});

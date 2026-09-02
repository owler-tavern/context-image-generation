import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    clearChatBinding,
    clearChatIdentityPin,
    migrateChatCanon,
    setChatAppearanceSource,
    setChatBinding,
    setChatCastOverride,
    setChatIdentityPin,
    setChatLock,
    setChatWandPreferences,
} from '../lib/rp/chat-canon.js';
import { createGenerationPlan } from '../lib/generation-plan.js';

const legacySettings = {
    rp_outfits: { schema: 1, outfits: [{ id: 'outfit:1', identityId: 'char:1', name: 'Evening', description: 'blue coat' }] },
    outfit_pending: { schema: 1, pending: { 'chat:1\u0000char:1': { chatId: 'chat:1', identityId: 'char:1' } } },
};
const legacyOutfitState = { schema: 1, bindings: { 'char:1': { activeOutfitId: 'outfit:1', isLocked: true } } };
const [index, settings] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
]);

test('unrelated extension-settings saves preserve legacy outfit records without migration or replay', () => {
    const saved = { ...structuredClone(legacySettings), use_avatars: true };
    assert.deepEqual(saved.rp_outfits, legacySettings.rp_outfits);
    assert.deepEqual(saved.outfit_pending, legacySettings.outfit_pending);
    assert.doesNotMatch(index, /replaceWhenChanged\(cigSettings\.rp_outfits|replaceWhenChanged\(cigSettings\.outfit_pending|resumePendingOutfitState|scheduleOutfitPendingRetry/);
});

test('every ordinary chat-canon writer preserves an unknown legacy outfit state for one-to-one and group metadata', () => {
    const writers = [
        (state) => setChatBinding(state, 'character:ava', { activeLookId: 'look:1', expectedAssetId: 'asset:1', selectedAt: 1 }),
        (state) => setChatLock({ ...state, bindings: { 'character:ava': { activeLookId: 'look:1', expectedAssetId: 'asset:1', isLocked: false, selectedAt: 1 } } }, 'character:ava', true),
        (state) => clearChatBinding(state, 'character:ava'),
        (state) => setChatAppearanceSource(state, 'character:ava', { sourceType: 'avatar', sourceId: 'character:ava', role: 'character', selectedAt: 1 }),
        (state) => setChatWandPreferences(state, { framing: 'wide', continuity: 'strong', visualDirection: 'night rain' }),
        (state) => setChatIdentityPin(state, 'character:ava', { sourceId: 'character:ava', role: 'character' }),
        (state) => clearChatIdentityPin(state, 'character:ava'),
        (state) => setChatCastOverride(state, 'character:ava', 'include'),
    ];
    for (const metadata of [{ contextImageGeneration: { outfitState: legacyOutfitState } }, { contextImageGeneration: { outfitState: legacyOutfitState } }]) {
        for (const write of writers) {
            const next = write(metadata.contextImageGeneration);
            assert.deepEqual(next.outfitState, legacyOutfitState);
        }
    }
    assert.deepEqual(migrateChatCanon({ outfitState: legacyOutfitState }).outfitState, legacyOutfitState);
});

test('new generation plans ignore retired outfit inputs while historical activeOutfits remain readable metadata', () => {
    const plan = createGenerationPlan({
        id: 'outfit-retirement', invocation: 'wand',
        provider: { providerId: 'openai', modelId: 'gpt-image-1', capabilities: {} },
        prompt: { sourceMessage: 'Ava wears a blue coat.', outfitText: '[Active outfits] Ava' },
        activeOutfits: [{ identityId: 'char:1', outfit: { name: 'Evening' } }],
    });
    assert.equal('outfitText' in plan.prompt, false);
    assert.equal('activeOutfits' in plan, false);
    const historicalArtifact = { cig_continuity_snapshot: { activeOutfits: [{ identityId: 'char:1', outfit: { name: 'Evening' } }] } };
    assert.deepEqual(historicalArtifact.cig_continuity_snapshot.activeOutfits[0].outfit, { name: 'Evening' });
});

test('production code has no outfit controls, prompt projection, persistence imports, or new outfit provenance', () => {
    assert.doesNotMatch(settings, /cig_chat_outfit_controls|outfit controls/i);
    assert.doesNotMatch(index, /from '\.\/lib\/rp\/outfit-(?:lock|persistence)\.js'/);
    assert.doesNotMatch(index, /renderChatOutfitControls|buildOutfitPrompt|outfitStateSnapshot|outfitText|activeOutfits/);
    assert.doesNotMatch(index, /createOutfit\(|selectChatOutfit\(|setChatOutfitLock\(|persistChatOutfitState\(/);
});

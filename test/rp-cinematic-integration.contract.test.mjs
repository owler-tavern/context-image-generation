import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, settings, style] = await Promise.all([
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../settings.html', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

test('cinematic automation is mounted into real chat lifecycle hooks and uses story interpretation', () => {
    assert.match(index, /createCinematicRuntime/);
    assert.match(index, /createCinematicSurface\(\)/);
    assert.match(index, /eventSource\.on\(event_types\.CHARACTER_MESSAGE_RENDERED/);
    assert.match(index, /eventSource\.on\(event_types\.USER_MESSAGE_RENDERED/);
    assert.match(index, /observeCinematicMessage\(messageId\)/);
    assert.match(index, /buildSceneGenerationSnapshot\(/);
    assert.match(index, /getMessageFingerprint/);
    assert.match(index, /attachGeneratedImage\(message, element, prompt/);
    assert.match(index, /if \(result !== true\).*attachmentStatus: 'not-attached'/s);
    assert.match(index, /writeState: \(value, \{ chatId \} = \{\}\)/);
    assert.match(index, /readDurableState: \(\{ chatId \} = \{\}\)/);
    assert.match(index, /writeDurableState: \(value, \{ chatId \} = \{\}\)/);
    assert.match(index, /saveDurableState: async \(\) => \{ await saveSettings\(\); \}/);
    assert.match(index, /compactCinematicRuntimeState\(value\.cinematicAutomation\)/);
    assert.match(index, /cinematicRuntime\.approve/);
});

test('settings expose explicit cinematic controls and honest cost fallback', () => {
    for (const id of ['cig_cinematic_enabled', 'cig_cinematic_mode', 'cig_cinematic_budget_type', 'cig_cinematic_generation_limit', 'cig_cinematic_cost_ceiling', 'cig_cinematic_retrigger_beat', 'cig_cinematic_retrigger', 'cig_cinematic_status']) assert.match(settings, new RegExp(`id="${id}"`));
    assert.match(settings, /Suggestions never call a provider until you approve them/);
    assert.match(settings, /No currency is invented/);
    assert.match(index, /cinematic_automation/);
    assert.match(index, /cinematic_automation_sessions/);
    assert.match(index, /cinematicRuntime\?\.retrigger/);
});

test('suggestion actions and narrow-safe controls are accessible', () => {
    assert.match(index, /data-cig-cinematic-action/);
    assert.match(index, /data-cig-cinematic-adjust-input/);
    assert.match(style, /\.cig_cinematic_suggestion[\s\S]*min-height:\s*44px/);
    assert.match(style, /@media \(max-width: 480px\)[\s\S]*cig_cinematic_suggestion_actions/);
});

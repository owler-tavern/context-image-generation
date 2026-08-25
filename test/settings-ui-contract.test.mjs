import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const requiredBoundIds = [
    'cig_provider', 'cig_provider_api_key', 'cig_linkapi_use_legacy_routing',
    'cig_model', 'cig_model_refresh', 'cig_model_search', 'cig_managed_model_list',
    'cig_managed_model_id', 'cig_managed_model_transport', 'cig_add_model',
    'cig_save_model', 'cig_remove_model', 'cig_cancel_generation', 'cig_show_preflight',
    'cig_export_diagnostics', 'cig_aspect_ratio', 'cig_image_size', 'cig_thinking_level',
    'cig_use_google_search', 'cig_message_depth', 'cig_use_avatars',
    'cig_include_descriptions', 'cig_use_previous_image', 'cig_regenerate_on_swipe',
    'cig_auto_generate', 'cig_system_instruction', 'cig_generate_btn',
    'cig_gallery_container', 'cig_clear_gallery', 'cig_appearance_list',
];

function attributes(markup) {
    return Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

test('settings shell owns exactly three labelled tabs and matching panels', () => {
    const tablists = [...settings.matchAll(/<[^>]+role="tablist"[^>]*>/g)];
    assert.equal(tablists.length, 1);
    assert.ok(attributes(tablists[0][0])['aria-label']);

    const tabs = [...settings.matchAll(/<button\b[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g)];
    assert.equal(tabs.length, 3);
    const tabByValue = new Map(tabs.map((tab) => {
        const attrs = attributes(tab[0]);
        return [attrs.value, attrs];
    }));
    assert.deepEqual([...tabByValue.keys()].sort(), ['images-cast', 'preferences', 'setup']);

    const panels = [...settings.matchAll(/<section\b[^>]*role="tabpanel"[^>]*>/g)].map((match) => attributes(match[0]));
    assert.equal(panels.length, 3);
    for (const [value, tab] of tabByValue) {
        assert.equal(tab.type, 'button');
        assert.equal(tab['aria-controls'], `cig_settings_panel_${value.replace('-', '_')}`);
        const panel = panels.find((candidate) => candidate.id === tab['aria-controls']);
        assert.ok(panel, `missing panel for ${value}`);
        assert.equal(panel['aria-labelledby'], tab.id);
    }
});

test('settings keeps one non-nested Advanced disclosure and no Advanced tab', () => {
    const details = [...settings.matchAll(/<details\b[^>]*>/g)];
    assert.equal(details.length, 1);
    assert.equal(attributes(details[0][0]).id, 'cig_advanced_setup');
    assert.doesNotMatch(settings, /role="tab"[^>]*(?:value="advanced"|>\s*Advanced\s*<)/i);

    const advanced = settings.slice(details[0].index);
    for (const id of [
        'cig_provider_advanced_container', 'cig_linkapi_use_legacy_routing', 'cig_model_manager',
        'cig_managed_model_list', 'cig_show_preflight', 'cig_export_diagnostics',
    ]) assert.match(advanced, new RegExp(`id="${id}"`));
});

test('all existing bound settings controls remain unique', () => {
    for (const id of requiredBoundIds) {
        assert.equal((settings.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must occur exactly once`);
    }
});

test('settings navigation activates, persists, and supports keyboard roving focus', () => {
    assert.match(index, /function activateSettingsTab\(tabId, \{ persist = true \} = \{\}\)/);
    assert.match(index, /attr\('aria-selected', isActive\.toString\(\)\)/);
    assert.match(index, /attr\('tabindex', isActive \? '0' : '-1'\)/);
    assert.match(index, /prop\('hidden', !isActive\)/);
    assert.match(index, /settings\.ui_last_settings_tab = selectedTab/);
    assert.match(index, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
    assert.match(index, /resolveInitialSettingsTab\(/);
    assert.match(index, /deriveSetupReadiness\(/);
});

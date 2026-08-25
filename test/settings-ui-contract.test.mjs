import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');

// This ID is intentionally created by the appearance dialog at runtime, not by settings.html.
const DYNAMIC_OR_NON_SETTINGS_IDS = new Set(['cig_appearance_identity']);

function attributes(markup) {
    return Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

function advancedMarkup() {
    const opening = settings.match(/<details\b[^>]*id="cig_advanced_setup"[^>]*>/);
    assert.ok(opening, 'missing #cig_advanced_setup opening tag');
    const closingIndex = settings.indexOf('</details>', opening.index);
    assert.notEqual(closingIndex, -1, 'missing #cig_advanced_setup closing tag');
    return settings.slice(opening.index, closingIndex + '</details>'.length);
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
        assert.equal(tab['data-cig-tab'], value);
        assert.equal(tab['aria-controls'], `cig_settings_panel_${value.replace('-', '_')}`);
        const panel = panels.find((candidate) => candidate.id === tab['aria-controls']);
        assert.ok(panel, `missing panel for ${value}`);
        assert.equal(panel['aria-labelledby'], tab.id);
        assert.equal(panel['data-cig-panel'], value);
    }
});

test('settings keeps one non-nested Advanced disclosure and no Advanced tab', () => {
    const details = [...settings.matchAll(/<details\b[^>]*>/g)];
    assert.equal(details.length, 1);
    assert.equal(attributes(details[0][0]).id, 'cig_advanced_setup');
    assert.doesNotMatch(settings, /role="tab"[^>]*(?:value="advanced"|>\s*Advanced\s*<)/i);

    const advanced = advancedMarkup();
    for (const id of [
        'cig_provider_advanced_container', 'cig_linkapi_use_legacy_routing', 'cig_model_manager',
        'cig_managed_model_list', 'cig_show_preflight', 'cig_export_diagnostics',
    ]) assert.match(advanced, new RegExp(`id="${id}"`));
});

test('all index-bound settings controls remain unique in settings markup', () => {
    const boundIds = new Set([...index.matchAll(/#(cig_[\w-]+)/g)].map((match) => match[1]));
    for (const id of boundIds) {
        if (DYNAMIC_OR_NON_SETTINGS_IDS.has(id)) continue;
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
    assert.match(index, /\[data-cig-tab\]/);
    assert.match(index, /\[data-cig-panel\]/);
    assert.match(index, /resolveInitialSettingsTab\(/);
    assert.match(index, /deriveSetupReadiness\(/);
});

test('shared settings focus visibility covers standard form controls', () => {
    assert.match(style, /#cig_settings :is\(button, input, select, textarea, \[role="tab"\]\):focus-visible/);
});

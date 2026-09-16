import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');

function setupMarkup() {
    const opening = settings.match(/<section\b[^>]*id="cig_settings_panel_setup"[^>]*>/);
    assert.ok(opening, 'missing Setup panel');
    const closing = settings.indexOf('<section id="cig_settings_panel_preferences"', opening.index);
    assert.notEqual(closing, -1, 'missing Setup panel closing boundary');
    return settings.slice(opening.index, closing);
}

function troubleshootingMarkup() {
    const opening = settings.match(/<details\b[^>]*id="cig_advanced_setup"[^>]*>/);
    assert.ok(opening, 'missing Troubleshooting disclosure');
    const closing = settings.indexOf('</details>', opening.index);
    assert.notEqual(closing, -1, 'missing Troubleshooting closing tag');
    return settings.slice(opening.index, closing + '</details>'.length);
}

test('Setup keeps connection editing beside the active connection and model selection before readiness', () => {
    const setup = setupMarkup();
    const ids = ['cig_provider', 'cig_edit_connection', 'cig_add_connection', 'cig_connection_editor', 'cig_model', 'cig_model_search', 'cig_model_method_container', 'cig_setup_status', 'cig_setup_issue'];
    const positions = ids.map((id) => setup.indexOf(`id="${id}"`));
    assert.ok(positions.every((position) => position >= 0), 'Setup exposes the active connection, model, status, and editor controls');
    assert.ok(positions.every((position, i) => i === 0 || position > positions[i - 1]), 'Setup follows connection, connection details, model, then readiness');
    assert.match(setup, /<label for="cig_provider">Generate images with<\/label>/);
    for (const id of ['cig_setup_status', 'cig_setup_issue']) {
        const element = setup.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] || '';
        assert.match(element, /role="status"/);
        assert.match(element, /aria-live="polite"/);
    }
    assert.match(setup, /Use the wand in chat to generate an image\./);
});

test('Setup keeps credentials inside the focused connection editor and model routing explicit', () => {
    const setup = setupMarkup();
    const editorStart = setup.indexOf('<section id="cig_connection_editor"');
    const troubleshootingStart = setup.indexOf('<details id="cig_advanced_setup"', editorStart);
    const editor = setup.slice(editorStart, troubleshootingStart);
    assert.match(editor, /id="cig_builtin_connection_fields"[\s\S]*id="cig_provider_key_container"/);
    const keyField = editor.match(/<input[^>]*id="cig_provider_api_key"[^>]*>/)?.[0] || '';
    assert.match(keyField, /placeholder="Enter API key"/);
    assert.doesNotMatch(keyField, /sk-|Bearer/i);
    for (const id of ['cig_connection_preset', 'cig_connection_editing_status', 'cig_builtin_connection_save', 'cig_builtin_connection_use', 'cig_connection_editor_cancel']) assert.match(editor, new RegExp(`id="${id}"`));
    assert.match(editor, /<h2 id="cig_connection_editor_heading">Connection details<\/h2>/);
    for (const id of ['cig_show_all_models', 'cig_model_method', 'cig_model_method_note']) assert.match(setup, new RegExp(`id="${id}"`));
});

test('manual model entry is deliberately separate from the one selected model', () => {
    const setup = setupMarkup();
    assert.equal((setup.match(/id="cig_model"/g) || []).length, 1);
    assert.match(setup, /<details id="cig_model_manager"[\s\S]*?<summary>Enter a model ID<\/summary>/);
    assert.match(setup, /<label for="cig_managed_model_id">Model ID<\/label>/);
    assert.match(setup, /id="cig_add_model"[^>]*value="Use model ID"/);
    assert.doesNotMatch(setup, /id="cig_managed_model_list"|id="cig_managed_model_transport"|id="cig_save_model"|id="cig_remove_model"/);
});

test('Troubleshooting contains diagnostics while connection editing remains separate', () => {
    const troubleshooting = troubleshootingMarkup();
    assert.match(troubleshooting, /<summary>Troubleshooting<\/summary>/);
    for (const id of ['cig_provider_advanced_container', 'cig_show_preflight', 'cig_cancel_generation', 'cig_export_diagnostics', 'cig_preflight_summary']) assert.match(troubleshooting, new RegExp(`id="${id}"`));
    assert.doesNotMatch(troubleshooting, /id="cig_custom_connection_editor"|id="cig_provider_api_key"/);
});

test('readiness rendering uses a safe local configuration message and reports method gaps', () => {
    assert.match(index, /function renderSetupReadiness\(settings\)/);
    assert.match(index, /function renderSetupRuntimeIssue\(\)/);
    assert.match(index, /let setupRuntimeIssue\s*=/);
    assert.match(index, /deriveSetupReadiness\(\{/);
    assert.match(index, /#cig_setup_status/);
    assert.match(index, /#cig_setup_issue/);
    assert.doesNotMatch(index, /cig_setup_status[^\n]{0,180}(?:Connected|Online)/i);
});

test('Setup tab has an accessible incomplete or issue status without changing the selected tab', () => {
    const setupTab = settings.match(/<button\b[^>]*id="cig_settings_tab_setup"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    assert.match(setupTab, /id="cig_setup_tab_status"/);
    assert.match(index, /function renderSetupTabStatus\(readiness\)/);
    assert.match(index, /projectSetupTabStatus\(readiness, setupRuntimeIssue\)/);
    assert.match(index, /\.attr\('aria-label', status\.accessibleLabel\)/);
    assert.doesNotMatch(index, /renderSetupTabStatus[\s\S]{0,800}activateSettingsTab\(/);
});

test('hidden Setup tab status has an authoritative display-none rule', () => {
    const hiddenRule = style.match(/\.cig-setup-tab-status\[hidden\]\s*\{[^}]*\}/)?.[0] || '';
    assert.match(hiddenRule, /display:\s*none\s*!important\s*;/);
});

test('connection actions reveal a focused top-of-setup editor and hidden readiness actions never render blank', () => {
    assert.match(index, /function openConnectionEditor\(providerId = ''\)/);
    assert.match(index, /#cig_connection_editor'\)\.prop\('hidden', false\)/);
    assert.match(index, /#cig_connection_preset'\)\.trigger\('focus'\)/);
    assert.match(index, /#cig_connection_editor_cancel'\)\.on\('click', \(\) => \$\('#cig_connection_editor'\)\.prop\('hidden', true\)\)/);
    assert.match(style, /#cig_setup_fix\[hidden\][\s\S]*display:\s*none\s*!important/);
});

test('host compatibility warnings are advisory, selection-guarded, and cached in Setup', () => {
    assert.match(settings, /id="cig_host_compatibility_note"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
    assert.match(index, /readHostImageModelCompatibility/);
    assert.match(index, /const hostCompatibilityCache = new Map\(\)/);
    assert.match(index, /if \(hostCompatibilityCache\.has\(requestKey\)\)/);
    assert.match(index, /hostCompatibilityCache\.set\(requestKey, compatibility\)/);
    assert.match(index, /compatibility\.state !== 'advisory'/);
    assert.match(index, /hostCompatibilityRequest\?\.controller\.abort\(\)/);
});

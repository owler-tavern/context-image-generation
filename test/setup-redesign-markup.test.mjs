import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');

function setupMarkup() {
    const opening = settings.match(/<section\b[^>]*id="cig_settings_panel_setup"[^>]*>/);
    assert.ok(opening, 'missing Setup panel');
    const closing = settings.indexOf('<section id="cig_settings_panel_preferences"', opening.index);
    assert.notEqual(closing, -1, 'missing Setup panel closing tag');
    return settings.slice(opening.index, closing);
}

test('Setup makes one active connection and model selection visible before connection editing', () => {
    const setup = setupMarkup();
    for (const id of ['cig_provider', 'cig_edit_connection', 'cig_add_connection', 'cig_model_search', 'cig_model', 'cig_model_refresh', 'cig_show_all_models', 'cig_model_method_container', 'cig_model_method', 'cig_model_method_note', 'cig_connection_editor']) {
        assert.match(setup, new RegExp(`id="${id}"`), `missing ${id}`);
    }
    assert.match(setup, /<label for="cig_provider">Generate images with<\/label>/);
    assert.ok(setup.indexOf('id="cig_provider"') < setup.indexOf('id="cig_connection_editor"'));
    assert.ok(setup.indexOf('id="cig_model"') < setup.indexOf('id="cig_connection_editor"'));
    assert.match(setup, /Use the wand in chat to generate an image\./);
});

test('Setup keeps one model chooser and an accessible manual model entry', () => {
    const setup = setupMarkup();
    assert.equal((setup.match(/id="cig_model"/g) || []).length, 1);
    assert.doesNotMatch(setup, /id="cig_managed_model_list"/);
    assert.doesNotMatch(setup, /id="cig_save_model"|id="cig_remove_model"|id="cig_managed_model_transport"/);
    assert.doesNotMatch(setup, /id="cig_experimental_preflight(?:_checkbox|_warning)?"/);
    assert.match(setup, /<details id="cig_model_manager"[\s\S]*?<summary>Enter a model ID<\/summary>/);
    assert.match(setup, /<label for="cig_managed_model_id">Model ID<\/label>/);
    assert.match(setup, /id="cig_add_model"[^>]*value="Use model ID"/);
});

test('connection editor separates built-in credentials, custom routes, and troubleshooting', () => {
    const setup = setupMarkup();
    const editorStart = setup.indexOf('<details id="cig_connection_editor"');
    const editorEnd = setup.indexOf('<details id="cig_advanced_setup"', editorStart);
    const editor = setup.slice(editorStart, editorEnd);
    assert.match(editor, /<summary>Connection settings<\/summary>/);
    assert.match(editor, /id="cig_connection_preset"/);
    assert.match(editor, /<option value="">Choose provider<\/option>/);
    assert.match(editor, /id="cig_builtin_connection_fields"[\s\S]*id="cig_provider_key_container"/);
    for (const id of ['cig_connection_editing_status', 'cig_builtin_connection_save', 'cig_builtin_connection_use', 'cig_connection_editor_cancel']) assert.match(editor, new RegExp(`id="${id}"`));
    assert.match(editor, /id="cig_custom_connection_editor"/);
    for (const id of ['cig_custom_connection_list', 'cig_custom_connection_label', 'cig_custom_connection_protocol', 'cig_custom_connection_base_url', 'cig_custom_connection_models_path', 'cig_custom_connection_generation_path', 'cig_custom_connection_auth', 'cig_custom_connection_key', 'cig_custom_connection_enabled', 'cig_custom_connection_save', 'cig_custom_connection_test', 'cig_custom_connection_delete', 'cig_custom_connection_use', 'cig_custom_connection_dual', 'cig_custom_connection_gemini_url', 'cig_custom_connection_images_url']) {
        assert.match(editor, new RegExp(`id="${id}"`), `missing ${id}`);
    }
    assert.match(editor, /<label for="cig_custom_connection_list">Editing connection<\/label>/);
    assert.match(editor, /<label for="cig_custom_connection_base_url">API address\/catalog root<\/label>/);
    assert.match(editor, /<label for="cig_custom_connection_protocol">Default generation method<\/label>/);
    assert.match(editor, /<details class="cig-custom-connection-advanced"/);

    const troubleshooting = setup.match(/<details id="cig_advanced_setup"[\s\S]*?<\/details>/)?.[0] || '';
    for (const id of ['cig_show_preflight', 'cig_export_diagnostics', 'cig_preflight_summary', 'cig_cancel_generation', 'cig_provider_advanced_container']) {
        assert.match(troubleshooting, new RegExp(`id="${id}"`), `missing troubleshooting control ${id}`);
    }
});

test('Setup styles keep actions touch-sized and fields usable at narrow widths', () => {
    assert.match(style, /#cig_settings_panel_setup[\s\S]*\.menu_button[\s\S]*min-height:\s*44px/);
    assert.match(style, /@media \(max-width: 480px\)[\s\S]*\.cig-connection-actions[\s\S]*flex-direction:\s*column/);
    assert.match(style, /\.cig-setup-model-row[\s\S]*flex-wrap:\s*wrap/);
});

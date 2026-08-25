import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function setupMarkup() {
    const opening = settings.match(/<section\b[^>]*id="cig_settings_panel_setup"[^>]*>/);
    assert.ok(opening, 'missing Setup panel');
    const closing = settings.indexOf('</section>', opening.index);
    assert.notEqual(closing, -1, 'missing Setup panel closing tag');
    return settings.slice(opening.index, closing + '</section>'.length);
}

function advancedMarkup() {
    const opening = settings.match(/<details\b[^>]*id="cig_advanced_setup"[^>]*>/);
    assert.ok(opening, 'missing Advanced setup disclosure');
    const closing = settings.indexOf('</details>', opening.index);
    assert.notEqual(closing, -1, 'missing Advanced setup closing tag');
    return settings.slice(opening.index, closing + '</details>'.length);
}

test('Setup keeps provider, conditional credentials, model, and distinct status regions in order', () => {
    const setup = setupMarkup();
    const ids = ['cig_provider', 'cig_provider_key_container', 'cig_model', 'cig_setup_status', 'cig_setup_issue', 'cig_advanced_setup'];
    const positions = ids.map((id) => setup.indexOf(`id="${id}"`));
    assert.ok(positions.every((position) => position >= 0), 'Setup must expose every readiness control and region');
    assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]), 'Setup must lead users through provider, credentials, model, local status, then runtime issue');
    for (const id of ['cig_setup_status', 'cig_setup_issue']) {
        const element = setup.match(new RegExp(`<[^>]+id="${id}"[^>]*>`));
        assert.ok(element, `missing ${id}`);
        assert.match(element[0], /role="status"/);
        assert.match(element[0], /aria-live="polite"/);
    }
});

test('Setup keeps only contextual setup controls outside its sole Advanced disclosure', () => {
    const setup = setupMarkup();
    const advanced = advancedMarkup();
    assert.equal((settings.match(/<details\b/g) || []).length, 1, 'Advanced setup is the sole disclosure');
    for (const id of ['cig_model_manager', 'cig_provider_advanced_container', 'cig_experimental_preflight', 'cig_show_preflight', 'cig_cancel_generation', 'cig_export_diagnostics']) {
        assert.match(advanced, new RegExp(`id="${id}"`), `${id} belongs in Advanced setup`);
    }
    assert.doesNotMatch(setup.slice(0, setup.indexOf('<details')), /Gemini proxy URL|Actual model IDs|experimental text-only|Inspect last plan|Export diagnostics/i);
});

test('readiness and runtime issue rendering preserve a local-only readiness message', () => {
    assert.match(index, /function renderSetupReadiness\(settings\)/);
    assert.match(index, /function renderSetupRuntimeIssue\(\)/);
    assert.match(index, /let setupRuntimeIssue\s*=/);
    assert.match(index, /deriveSetupReadiness\(\{/);
    assert.match(index, /#cig_setup_status/);
    assert.match(index, /#cig_setup_issue/);
    assert.doesNotMatch(index, /cig_setup_status[^\n]{0,180}(?:Connected|Online|Verified)/i);
});

test('provider projection controls credential copy and refresh visibility without disabled dead ends', () => {
    const setup = setupMarkup();
    const keyField = setup.match(/<input[^>]+id="cig_provider_api_key"[^>]*>/)?.[0] || '';
    const refresh = setup.match(/<input[^>]+id="cig_model_refresh"[^>]*>/)?.[0] || '';
    assert.match(keyField, /placeholder="Enter API key"/);
    assert.doesNotMatch(keyField, /sk-|Bearer/i);
    assert.match(refresh, /aria-describedby="cig_model_refresh_hint"/);
    assert.ok(setup.indexOf('id="cig_provider_info"') < setup.indexOf('id="cig_model"'));
});

test('Setup keeps technical provider diagnostics inside Advanced and wires updates to the separate issue region', () => {
    const setup = setupMarkup();
    const advanced = advancedMarkup();
    const setupBeforeAdvanced = setup.slice(0, setup.indexOf('<details'));
    assert.match(advanced, /id="cig_provider_advanced_info"/);
    assert.doesNotMatch(setupBeforeAdvanced, /api\.linkapi\.ai|grok-imagine-image|OpenAI-compatible|curated CogView/i);
    assert.match(index, /if \(result\.warning\) \{[\s\S]{0,300}setSetupRuntimeIssue\(result\.warning, 'Provider model discovery'\)/);
    assert.match(index, /#cig_provider_api_key[\s\S]{0,500}setProviderApiKey[\s\S]{0,500}renderSetupReadiness\(settings\)/);
    assert.match(index, /#cig_experimental_preflight_checkbox[\s\S]{0,700}setExperimentalPreflight[\s\S]{0,300}clearSetupRuntimeIssue\(\)/);
});

test('Advanced provider diagnostics do not expose LinkAPI recovery for other providers', () => {
    const advanced = advancedMarkup();
    assert.match(advanced, /id="cig_linkapi_legacy_routing_container"/);
    assert.match(index, /#cig_linkapi_legacy_routing_container'\)\.toggle\(ui\.showsLegacyRecovery\)/);
});

test('configuration changes clear runtime issues while failures capture their latest safe message', () => {
    assert.match(index, /setSetupRuntimeIssue\(normalized, operation\)/);
    assert.match(index, /setSetupRuntimeIssue\(result\.warning, 'Provider model discovery'\)/);
    assert.match(index, /setProviderApiKey\(settings, provider, \$\(this\)\.val\(\)\);\s*clearSetupRuntimeIssue\(\);\s*renderSetupReadiness\(settings\)/);
    assert.match(index, /setExperimentalPreflight\(settings, route, \$\(this\)\.prop\('checked'\)\);\s*clearSetupRuntimeIssue\(\);\s*renderSetupReadiness\(settings\)/);
});

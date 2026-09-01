import test from 'node:test';
import assert from 'node:assert/strict';

test('appearance settings explain durable per-chat memory and lock controls', async () => {
    const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(html, /reusable character appearance/i);
    assert.match(html, /Remember latest generated image/i);
    assert.match(html, /lock/i);
});

test('appearance memory exposes distinct local stop and explicit global deletion actions', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /Stop using in this chat/);
    assert.match(source, /Delete saved look everywhere…/);
    assert.match(source, /Delete this saved look everywhere\? Other chats may use it\. Affected chats will fall back to their avatar or description\. This cannot be undone\./);
    assert.doesNotMatch(source, />Remove</);
});

test('production Gallery clear uses verified legacy migration and every look action rechecks tombstone availability', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /runClearGalleryPreservingLooks\(\{ gallery: settings\.gallery/);
    assert.match(source, /\['pending-migration', 'pending-clear'\]/);
    assert.ok((source.match(/projectAppearanceLookActionState\(/g) || []).length >= 5);
    assert.match(source, /Saved look deletion in progress/);
});
import { readFile } from 'node:fs/promises';
import { getCustomCatalogRefreshMessage, projectCustomConnectionEditor, projectRouteDiagnostics, projectProviderOptions } from '../lib/providers/ui-projection.js';
import { connectionRevision } from '../lib/providers/custom-connections.js';

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
        const opening = tab[0].match(/^<button\b[^>]*>/)?.[0] || '';
        const attrs = attributes(opening);
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
        'cig_provider_advanced_container', 'cig_model_manager',
        'cig_managed_model_list', 'cig_show_preflight', 'cig_export_diagnostics',
    ]) assert.match(advanced, new RegExp(`id="${id}"`));
});

test('Setup exposes separate polite readiness and runtime issue status regions before Advanced', () => {
    const setupStart = settings.indexOf('id="cig_settings_panel_setup"');
    const setupEnd = settings.indexOf('</section>', setupStart);
    const setup = settings.slice(setupStart, setupEnd);
    const status = setup.match(/<[^>]+id="cig_setup_status"[^>]*>/);
    const issue = setup.match(/<[^>]+id="cig_setup_issue"[^>]*>/);
    assert.ok(status);
    assert.ok(issue);
    for (const element of [status[0], issue[0]]) {
        assert.match(element, /role="status"/);
        assert.match(element, /aria-live="polite"/);
    }
    assert.ok(setup.indexOf('id="cig_model"') < setup.indexOf('id="cig_setup_status"'));
    assert.ok(setup.indexOf('id="cig_setup_issue"') < setup.indexOf('id="cig_advanced_setup"'));
});

test('all index-bound settings controls remain unique in settings markup', () => {
    const boundIds = new Set([...index.matchAll(/#(cig_[\w-]+)/g)].map((match) => match[1]));
    assert.doesNotMatch(settings, /id="cig_generate_btn"/);
    for (const id of boundIds) {
        if (DYNAMIC_OR_NON_SETTINGS_IDS.has(id) || id === 'cig_generate_btn') continue;
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

test('Refresh Models reports route-aware outcomes and keeps existing models on empty or failed refreshes', () => {
    assert.match(index, /getDiscoveryRefreshMessage\(result\)/);
    assert.match(index, /Your current model list was kept\./);
});

const customConnection = {
    schema: 1,
    id: 'connection:123e4567-e89b-42d3-a456-426614174000',
    label: 'Private Gateway',
    protocol: 'openai-images',
    baseUrl: 'https://gateway.example',
    modelsPath: '/v1/models',
    generationPath: '/custom/images',
    credentialRef: 'custom:123e4567-e89b-42d3-a456-426614174000',
    enabled: true,
};

test('custom connection editor projection is registry-shaped, redacted, and revision-aware', () => {
    const revision = connectionRevision(customConnection);
    const projection = projectCustomConnectionEditor(customConnection, {
        credentialConfigured: true,
        evidence: { state: 'configured', revision, observedAt: '2026-08-31T14:00:00.000Z' },
    });

    assert.equal(projection.protocol.value, 'openai-images');
    assert.equal(projection.protocol.fixed, false);
    assert.deepEqual(projection.authPresets.map(({ value }) => value), ['bearer', 'none']);
    assert.deepEqual(projection.credential, {
        preset: 'bearer',
        configured: true,
        maskedValue: '••••••••',
        browserSideWarning: 'This key is stored in browser-side SillyTavern extension settings.',
    });
    assert.equal(projection.status.state, 'configured');
    assert.equal(projection.status.firstRequestWarning, 'First request will test this endpoint');
    assert.deepEqual(projection.routePreview.generation, { method: 'POST', url: 'https://gateway.example/custom/images' });
    assert.equal(JSON.stringify(projection).includes(customConnection.credentialRef), false);

    const localProjection = projectCustomConnectionEditor({ ...customConnection, baseUrl: 'http://localhost:8080' }, {
        credentialConfigured: true,
        evidence: {
            state: 'configured',
            revision: connectionRevision({ ...customConnection, baseUrl: 'http://localhost:8080' }),
            observedAt: '2026-08-31T14:00:00.000Z',
        },
    });
    assert.equal(localProjection.localInsecure, true);
    assert.equal(localProjection.status.firstRequestWarning, 'First request will test this endpoint');
});

test('provider option projection includes enabled custom connections without provider-name branching', () => {
    const options = projectProviderOptions({ customConnections: [customConnection] });
    const projected = options.find((option) => option.id === customConnection.id);
    assert.deepEqual(projected, {
        id: customConnection.id,
        label: 'Private Gateway',
        status: 'configured',
        connectionId: customConnection.id,
        protocol: 'openai-images',
    });
});

test('Advanced setup exposes explicit masked custom image protocols with separate save and test actions', () => {
    const advanced = advancedMarkup();
    for (const id of [
        'cig_custom_connection_list', 'cig_custom_connection_add', 'cig_custom_connection_label',
        'cig_custom_connection_protocol', 'cig_custom_connection_base_url', 'cig_custom_connection_models_path',
        'cig_custom_connection_generation_path', 'cig_custom_connection_auth', 'cig_custom_connection_key',
        'cig_custom_connection_enabled', 'cig_custom_connection_save', 'cig_custom_connection_test',
        'cig_custom_connection_delete',
        'cig_custom_connection_status', 'cig_custom_connection_preview', 'cig_custom_connection_local_warning',
        'cig_custom_connection_first_request_warning', 'cig_custom_connection_key_warning',
    ]) assert.match(advanced, new RegExp(`id="${id}"`));
    assert.match(advanced, /option value="openai-images">OpenAI Images/);
    assert.match(advanced, /option value="gemini-compatible">Gemini-compatible/);
    assert.doesNotMatch(advanced, /id="cig_custom_connection_protocol"[^>]*disabled/);
    assert.match(advanced, /id="cig_custom_connection_key"[^>]*type="password"[^>]*aria-describedby="cig_custom_connection_key_warning"[^>]*autocomplete="off"/);
    assert.match(advanced, /value="Test and fetch models"/);
    assert.match(settings, /browser-side SillyTavern extension settings/);
    assert.match(index, /#cig_custom_connection_save/);
    assert.match(index, /#cig_custom_connection_test/);
    assert.match(index, /#cig_custom_connection_delete/);
    assert.match(index, /confirmDestructiveAction\([^)]*Delete connection/);
    assert.match(index, /#cig_custom_connection_local_warning[^\n]+editor\?\.localInsecure/);
    assert.match(index, /#cig_custom_connection_first_request_warning[^\n]+firstRequestWarning/);
    assert.doesNotMatch(index, /providerId\s*===\s*['"]custom-openai/i);
});

test('runtime wiring confirms the exact configured revision and persists verified promotion after decoded success', () => {
    assert.match(index, /confirmCustomConnectionRoute/);
    assert.match(index, /confirmedRevision/);
    assert.match(index, /routeConfirmationAccepted/);
    assert.match(index, /promoteCustomConnectionEvidence/);
    assert.match(index, /promoted\?\.state\s*===\s*'verified'/);
});

test('custom catalog refresh copy does not claim raw catalog entries are usable image models', () => {
    assert.equal(getCustomCatalogRefreshMessage([{ id: 'chat-model' }, { id: 'image-looking-name' }]),
        'Received 2 catalog model IDs. Catalog presence does not verify image generation.');
    assert.equal(getCustomCatalogRefreshMessage([]), 'Connection reached; it returned no model IDs.');
    assert.doesNotMatch(index, /usable image models/i);
    assert.match(index, /getCustomCatalogRefreshMessage\(result\.models\)/);
});

test('route diagnostics are complete, honest, and redact secret-bearing inputs', () => {
    const diagnostics = projectRouteDiagnostics({
        label: 'Private Gateway',
        protocol: 'openai-images',
        transportId: 'openai-images',
        endpointClass: 'custom-openai-images',
        originClass: 'secure-remote',
        modelId: 'gpt-image-1', imageCapability: { state: 'unknown' },
        routeEvidence: {
            state: 'configured', source: 'user-configured-protocol',
            observedAt: '2026-08-31T14:00:00.000Z',
        },
        discoveryEvidence: { returnedCount: 7, acceptedCount: 2, unresolvedCount: 4, rejectedCount: 1 },
        credential: 'sk-live-never-render',
        authorization: 'Bearer never-render',
        rawResponse: '{"prompt":"never render"}',
        baseUrl: 'https://gateway.example/secret-path', modelsPath: '/secret-token/models',
    });
    assert.deepEqual(diagnostics, {
        label: 'Private Gateway', protocol: 'openai-images', transport: 'openai-images',
        endpointClass: 'custom-openai-images', originClass: 'secure-remote', evidence: {
            state: 'configured', source: 'user-configured-protocol', observedAt: '2026-08-31T14:00:00.000Z',
        },
        model: { id: 'gpt-image-1', imageCapability: 'unknown' },
        catalog: { returned: 7, accepted: 2, unresolved: 4, rejected: 1 },
    });
    assert.doesNotMatch(JSON.stringify(diagnostics), /sk-live|Bearer|prompt|rawResponse|gateway\.example|secret-path|secret-token/i);
    assert.equal(projectRouteDiagnostics({ imageCapability: { state: 'supported' } }).model.imageCapability, 'supported');
    assert.equal(projectRouteDiagnostics({ imageCapability: { state: 'unsupported' } }).model.imageCapability, 'unsupported');
    assert.equal(projectRouteDiagnostics({ imageCapability: { state: 'unknown' } }).model.imageCapability, 'unknown');
});

test('custom route preview is labelled text with a polite status region', () => {
    const advanced = advancedMarkup();
    assert.match(advanced, /id="cig_custom_connection_route_summary"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(advanced, /id="cig_custom_connection_preview"[^>]*aria-label="Sanitized route preview"/);
    assert.match(index, /projectRouteDiagnostics\(/);
    assert.doesNotMatch(index, /JSON\.stringify\(editor\.routePreview/);
    assert.doesNotMatch(index, /editor\.routePreview\.(?:catalog|generation)\.(?:url|upstreamProxyRoot)/);
    assert.match(index, /Model: \$\{diagnostics\.model\.id\}/);
    assert.match(index, /Image capability: \$\{diagnostics\.model\.imageCapability\}/);
});

test('custom discovery preserves exact catalog counts in settings state', () => {
    assert.match(index, /returnedCount:\s*result\.evidence\.returnedCount/);
    assert.match(index, /acceptedCount:\s*result\.evidence\.acceptedCount/);
    assert.match(index, /unresolvedCount:\s*result\.evidence\.unresolvedCount/);
    assert.match(index, /rejectedCount:\s*result\.evidence\.rejectedCount/);
    assert.match(index, /projectCurrentCustomDiscoveryState\(/);
    assert.match(index, /connectionId:\s*result\.evidence\.connectionId/);
    assert.match(index, /revision:\s*result\.evidence\.revision/);
});

test('custom connection layout remains usable at narrow widths with accessible touch targets', () => {
    assert.match(style, /@media \(max-width: 480px\)[\s\S]*\.cig-custom-connection-actions[\s\S]*flex-direction:\s*column/);
    assert.match(style, /\.cig-custom-connection-actions\s*>\s*\.menu_button[\s\S]*min-height:\s*44px/);
    assert.match(style, /#cig_custom_connection_preview[\s\S]*overflow-wrap:\s*anywhere/);
});

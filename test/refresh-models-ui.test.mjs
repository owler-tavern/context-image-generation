import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectionRevision } from '../lib/providers/custom-connections.js';
import { discoverCustomConnectionModels } from '../lib/providers/model-discovery.js';
import { getDiscoveryRefreshMessage } from '../lib/providers/model-manager.js';
import { projectCustomConnectionProviderUi } from '../lib/providers/ui-projection.js';

const CONNECTION_ID = 'connection:123e4567-e89b-42d3-a456-426614174000';
const connection = {
    schema: 1,
    id: CONNECTION_ID,
    label: 'Private Gateway',
    protocol: 'openai-images',
    baseUrl: 'https://gateway.example',
    modelsPath: '/v1/models',
    generationPath: '/v1/images/generations',
    credentialRef: null,
    enabled: true,
};

function createFakeJQuery() {
    class Element {
        constructor() {
            this.length = 1;
            this.value = '';
            this.options = [];
            this.handlers = new Map();
            this.attributes = new Map();
            this.properties = new Map();
            this.classes = new Set();
        }

        empty() { this.options = []; return this; }
        append(option) { this.options.push(option); return this; }
        val(value) {
            if (arguments.length === 0) return this.value;
            this.value = value == null ? '' : String(value);
            return this;
        }
        text(value) { this.textValue = String(value); return this; }
        attr(name, value) {
            if (typeof name === 'object') {
                for (const [key, item] of Object.entries(name)) this.attributes.set(key, String(item));
                return this;
            }
            if (arguments.length === 1) return this.attributes.get(name);
            this.attributes.set(name, String(value));
            return this;
        }
        removeAttr(name) { this.attributes.delete(name); return this; }
        prop(name, value) {
            if (arguments.length === 1) return this.properties.get(name);
            this.properties.set(name, value);
            return this;
        }
        addClass(name) { this.classes.add(name); return this; }
        removeClass(name) { this.classes.delete(name); return this; }
        on(eventName, handler) { this.handlers.set(eventName, handler); return this; }
        async trigger(eventName) {
            const handler = this.handlers.get(eventName);
            if (handler) await handler.call(this, { type: eventName });
            return this;
        }
    }

    const elements = new Map();
    const $ = (value) => {
        if (value instanceof Element) return value;
        if (value === '<option>') return new Element();
        if (!elements.has(value)) elements.set(value, new Element());
        return elements.get(value);
    };
    return $;
}

test('provider-switch cancellation clears Refresh Models busy and accessibility state even without a tracked request', async () => {
    const selectorUi = await import('../lib/providers/model-selector-ui.js');
    assert.equal(typeof selectorUi.setControlBusyState, 'function');
    assert.equal(typeof selectorUi.cancelModelRefreshUi, 'function');
    const $ = createFakeJQuery();
    const control = $('#cig_model_refresh').attr('title', 'Refresh available models');
    selectorUi.setControlBusyState($, control, true, { busyTitle: 'Refreshing models…' });
    let cancelledProviderId = null;

    const cancelled = selectorUi.cancelModelRefreshUi($, {
        providerId: CONNECTION_ID,
        cancelDiscovery: (providerId) => { cancelledProviderId = providerId; return false; },
    });

    assert.equal(cancelled, false);
    assert.equal(cancelledProviderId, CONNECTION_ID);
    assert.equal(control.classes.has('generating'), false);
    assert.equal(control.attr('aria-busy'), 'false');
    assert.equal(control.attr('aria-disabled'), 'false');
    assert.equal(control.prop('disabled'), false);
    assert.equal(control.attr('title'), 'Refresh available models');
    assert.equal(control.attr('data-cig-idle-title'), undefined);
});

test('ignores a custom discovery completion after the same connection ID changes revision', async () => {
    const customConnections = await import('../lib/providers/custom-connections.js');
    assert.equal(typeof customConnections.isCurrentCustomDiscoveryCompletion, 'function');

    const capturedRevision = connectionRevision(connection);
    const result = await discoverCustomConnectionModels({
        connection,
        authPreset: 'none',
        credential: '',
        now: () => '2026-09-02T20:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'fresh-image' }] }), { status: 200 }),
    });
    const editedConnection = { ...connection, baseUrl: 'https://new-gateway.example' };

    assert.equal(customConnections.isCurrentCustomDiscoveryCompletion({
        providerId: CONNECTION_ID,
        capturedRevision,
        result,
        currentProviderId: CONNECTION_ID,
        currentConnection: connection,
    }), true);
    assert.equal(customConnections.isCurrentCustomDiscoveryCompletion({
        providerId: CONNECTION_ID,
        capturedRevision,
        result,
        currentProviderId: CONNECTION_ID,
        currentConnection: editedConnection,
    }), false);
});

test('successful custom refresh keeps manual records and replaces the previous fetched snapshot', async () => {
    const modelManager = await import('../lib/providers/model-manager.js');
    assert.equal(typeof modelManager.mergeCustomDiscoveryModelRecords, 'function');

    const result = await discoverCustomConnectionModels({
        connection,
        authPreset: 'none',
        credential: '',
        now: () => '2026-09-02T20:00:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({
            data: [{ id: 'manual-image' }, { id: 'fresh-image' }],
        }), { status: 200 }),
    });
    const merged = modelManager.mergeCustomDiscoveryModelRecords([
        { id: 'manual-image', source: { kind: 'manual' }, connectionId: CONNECTION_ID },
        { id: 'old-fetched-image', source: { kind: 'fetched' }, connectionId: CONNECTION_ID },
    ], result, connection);

    assert.deepEqual(merged.map((entry) => [entry.id, entry.source.kind]), [
        ['manual-image', 'manual'],
        ['fresh-image', 'fetched'],
    ]);

    const collisionOnlyResult = await discoverCustomConnectionModels({
        connection,
        authPreset: 'none',
        credential: '',
        now: () => '2026-09-02T20:01:00.000Z',
        fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'manual-image' }] }), { status: 200 }),
    });
    const collisionOnly = modelManager.mergeCustomDiscoveryModelRecords([
        { id: 'manual-image', source: { kind: 'manual' }, connectionId: CONNECTION_ID },
        { id: 'old-fetched-image', source: { kind: 'fetched' }, connectionId: CONNECTION_ID },
    ], collisionOnlyResult, connection);
    assert.deepEqual(collisionOnly.map((entry) => [entry.id, entry.source.kind]), [
        ['manual-image', 'manual'],
    ]);
});

test('production controller carries parsed custom records through persistence into unfiltered Setup selection effects', async () => {
    const modelManager = await import('../lib/providers/model-manager.js');
    const recordStore = await import('../lib/providers/model-record-store.js');
    const selectorUi = await import('../lib/providers/model-selector-ui.js');
    assert.equal(typeof modelManager.mergeCustomDiscoveryModelRecords, 'function');
    assert.equal(typeof recordStore.setProviderModelRecords, 'function');
    assert.equal(typeof selectorUi.createModelSelectorController, 'function');

    const settings = {
        provider: CONNECTION_ID,
        model: 'manual-image',
        use_avatars: true,
        custom_connections: {
            schema: 1,
            connections: { [CONNECTION_ID]: connection },
            models: {
                [CONNECTION_ID]: [
                    { id: 'manual-image', source: { kind: 'manual' } },
                    { id: 'old-fetched-image', source: { kind: 'fetched' } },
                ],
            },
            evidence: {}, modelEvidence: {}, confirmations: {},
        },
    };
    const $ = createFakeJQuery();
    const selectionEffects = [];
    const getProjection = () => {
        const records = recordStore.getProviderModelRecords(settings, CONNECTION_ID);
        return projectCustomConnectionProviderUi(connection, settings.model, { localEntries: records });
    };
    const renderManaged = () => {
        const ui = getProjection();
        selectorUi.renderManagedModelSelector($, {
            models: ui.models,
            selectedModelId: settings.model,
            search: $('#cig_model_search').val(),
        });
    };
    const controller = selectorUi.createModelSelectorController($, {
        getSettings: () => settings,
        getModelContext: () => {
            const ui = getProjection();
            return { providerId: CONNECTION_ID, models: ui.models, selectedModelId: ui.selectedModelId };
        },
        getSelectedRoute: () => ({ providerId: CONNECTION_ID, modelId: settings.model }),
        cancelDiscovery: (providerId) => selectionEffects.push(['cancel', providerId]),
        clearPreflight: (route) => selectionEffects.push(['preflight', route.modelId]),
        clearRuntimeIssue: () => selectionEffects.push(['issue', settings.model]),
        renderCapabilityUi: () => selectionEffects.push(['capability', settings.model]),
        renderReadinessUi: () => selectionEffects.push(['readiness', settings.model]),
        renderModelManagerUi: () => { selectionEffects.push(['manager', settings.model]); renderManaged(); },
        renderAppearanceUi: () => selectionEffects.push(['appearance', settings.model]),
        persistSettings: () => selectionEffects.push(['persist', settings.model]),
    });

    controller.bind({
        onRefresh: async () => {
            const result = await discoverCustomConnectionModels({
                connection,
                authPreset: 'none',
                credential: '',
                now: () => '2026-09-02T20:00:00.000Z',
                fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'fresh-image' }] }), { status: 200 }),
            });
            const current = recordStore.getProviderModelRecords(settings, CONNECTION_ID);
            const merged = modelManager.mergeCustomDiscoveryModelRecords(current, result, connection);
            recordStore.setProviderModelRecords(settings, CONNECTION_ID, merged);
            controller.updateModelDropdown();
        },
    });

    $('#cig_model_search').val('fresh');
    await $('#cig_model_refresh').trigger('click');
    assert.deepEqual($('#cig_model').options.map((option) => option.value), ['', 'manual-image', 'fresh-image']);

    await $('#cig_model_search').trigger('input');
    assert.deepEqual($('#cig_managed_model_list').options.map((option) => option.value), ['fresh-image']);
    assert.deepEqual($('#cig_model').options.map((option) => option.value), ['', 'manual-image', 'fresh-image']);

    selectionEffects.length = 0;
    $('#cig_model').val('fresh-image');
    await $('#cig_model').trigger('change');
    assert.equal(settings.model, 'fresh-image');
    assert.equal(settings.use_avatars, true, 'changing a model never clears the saved avatar preference');
    assert.equal(getProjection().selectedModelId, 'fresh-image');
    assert.deepEqual(selectionEffects, [
        ['cancel', CONNECTION_ID],
        ['preflight', 'manual-image'],
        ['issue', 'fresh-image'],
        ['capability', 'fresh-image'],
        ['readiness', 'fresh-image'],
        ['manager', 'fresh-image'],
        ['appearance', 'fresh-image'],
        ['persist', 'fresh-image'],
    ]);
});

test('index delegates Refresh, Advanced search, and Setup selection to the tested production controller', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(source, /createModelSelectorController\(\$,\s*\{/u);
    assert.match(source, /modelSelectorController\.bind\(\{/u);
    assert.match(source, /modelSelectorController\.updateModelDropdown\(\)/u);
    assert.match(source, /modelSelectorController\.selectSetupModel\(modelId\)/u);
    assert.match(source, /cancelModelRefreshUi\(\$,[\s\S]*?cancelDiscovery:[\s\S]*?modelDiscoveryCoordinator\.cancel/u);
    assert.doesNotMatch(source, /\$\('#cig_(?:model_refresh|model_search|model)'\)\.on\(/u);
});

test('production commits a custom refresh only after token, provider, and captured revision checks', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const refresh = source.slice(
        source.indexOf('async function fetchManagedProviderModels'),
        source.indexOf('// Dev aid:', source.indexOf('async function fetchManagedProviderModels')),
    );
    const captureAt = refresh.indexOf('const capturedCustomRevision =');
    const awaitAt = refresh.indexOf('await modelDiscoveryCoordinator.refreshCustom');
    const persistAt = refresh.indexOf('setProviderDiscoveryState');
    assert.ok(captureAt >= 0 && captureAt < awaitAt);
    assert.ok(awaitAt < persistAt);
    assert.match(refresh, /refreshToken !== modelDiscoveryUiSequence/u);
    assert.match(refresh, /isCurrentCustomDiscoveryCompletion\(\{/u);
});

test('saving the same custom connection invalidates in-flight Refresh and Test completions', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const saveStart = source.indexOf('function saveCustomConnectionFromEditor');
    const save = source.slice(saveStart, source.indexOf('async function testCustomConnectionFromEditor', saveStart));
    const testStart = source.indexOf('async function testCustomConnectionFromEditor');
    const testConnection = source.slice(testStart, source.indexOf('async function deleteSelectedCustomConnection', testStart));
    assert.match(save, /cancelModelDiscovery\(validation\.connection\.id\)/u);
    assert.match(testConnection, /const testToken = \+\+modelDiscoveryUiSequence/u);
    assert.match(testConnection, /testToken !== modelDiscoveryUiSequence/u);
});

test('tells users to choose accepted refreshed models from Setup Model without claiming generation was verified', () => {
    assert.deepEqual(getDiscoveryRefreshMessage({
        evidence: { acceptedCount: 2, returnedCount: 2 },
    }), {
        level: 'success',
        message: 'Refreshed 2 discovered image models in Setup → Model. Choose one from that dropdown; discovery does not verify image generation.',
    });
});

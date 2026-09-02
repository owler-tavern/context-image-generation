import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTION_LABELS,
    createIterationSurfaceController,
    installIterationSurfaceStyles,
    mountIterationSurface,
    renderIterationSurface,
    uninstallIterationSurfaceStyles,
} from '../lib/rp/iteration-ui.js';

const sourceArtifact = Object.freeze({
    artifactId: 'artifact:original',
    sourcePassage: { text: 'Ava waits in the station.' },
    effectivePrompt: 'Ava waits in the station.',
    references: [{ id: 'ref:ava', role: 'active-look', identityId: 'ava' }],
    model: { providerId: 'test', modelId: 'image-model' },
    route: { providerId: 'test', connectionId: 'verified' },
    options: { aspectRatio: '16:9' },
    canonSnapshot: { activeLook: { identityId: 'ava', lookId: 'look:1' } },
});

function dependencies(overrides = {}) {
    const calls = { dispatch: [], persist: [], readback: [], canonical: [], canonicalReadback: [], discard: [], quote: [], originalReadback: [] };
    const deps = {
        sourceArtifact,
        generationPlan: { planId: 'registry:plan', revision: 'revision:1', capabilities: { imageGeneration: true } },
        verifyGenerationPlan: () => ({
            status: 'verified', planId: 'registry:plan', revision: 'revision:1',
            authorityToken: 'authority', routeResolved: true, capabilities: { imageGeneration: true },
        }),
        verifyCanonicalEligibility: ({ artifactId }) => ({ status: 'eligible', artifactId, authorityToken: 'canon' }),
        reserveInvocation: () => true,
        releaseInvocation: () => {},
        estimateCost: ({ outputCount, action }) => {
            calls.quote.push({ outputCount, action });
            return { quoteId: `quote:${action}:${outputCount}:${calls.quote.length}`, amount: outputCount * 0.04, currency: 'USD', expiresAt: '2999-01-01T00:00:00.000Z' };
        },
        dispatchCoordinator: async (plan) => {
            calls.dispatch.push(plan);
            return { status: 'completed', planId: plan.planId, invocationId: plan.invocationId, outputCount: plan.artifacts.length, artifacts: plan.artifacts };
        },
        persistArtifact: async (input) => { calls.persist.push(input); return { status: 'saved' }; },
        readbackArtifact: async (input) => { calls.readback.push(input); return { status: 'confirmed', artifactId: input.artifact.artifactId, planId: input.plan.planId, invocationId: input.plan.invocationId }; },
        readbackOriginalArtifact: async (input) => { calls.originalReadback.push(input); return { status: 'confirmed', artifactId: input.originalArtifact.artifactId, planId: input.plan.planId, invocationId: input.plan.invocationId }; },
        mutateCanonical: async (input) => { calls.canonical.push(input); return { status: 'mutated' }; },
        readbackCanonical: async (input) => { calls.canonicalReadback.push(input); return { status: 'confirmed', planId: input.plan.planId, invocationId: input.plan.invocationId, mutation: input.mutation }; },
        discardArtifact: async ({ artifactId, plan }) => { calls.discard.push(artifactId); return { status: 'confirmed', artifactId, planId: plan.planId, invocationId: plan.invocationId }; },
        invocationId: 'ui-test-invocation',
        ...overrides,
    };
    return { deps, calls };
}

test('surface projects the five visible actions, compact editors, status, and keyboard-safe controls', () => {
    const html = renderIterationSurface({
        status: 'idle',
        action: 'vary-shot',
        prompt: 'Ava waits',
        composition: { framing: 'wide', camera: 'eye level' },
        twoUp: true,
        originalArtifact: sourceArtifact,
    });
    const promptHtml = renderIterationSurface({
        status: 'idle',
        action: 'edit-regenerate',
        prompt: 'Ava waits',
        composition: { framing: 'wide', camera: 'eye level' },
        twoUp: true,
        originalArtifact: sourceArtifact,
    });

    for (const label of Object.values(ACTION_LABELS).filter((label) => label !== 'Retry repaired prompt')) assert.match(html, new RegExp(label.replace(/[&]/gu, '&amp;')));
    assert.match(promptHtml, /textarea[^>]+aria-label="Prompt"/u);
    assert.match(html, /name="framing"/u);
    assert.match(html, /name="camera"/u);
    assert.match(html, /type="checkbox"[^>]+name="twoUp"/u);
    assert.match(html, /role="status"/u);
    assert.match(html, /min-height:44px/u);
    assert.match(html, /data-iteration-action="vary-shot"/u);
    assert.match(html, /Original retention pending/u);
});

test('surface projects action-specific editors, repaired retry, and exact canonical roles', () => {
    const vary = renderIterationSurface({ action: 'vary-shot', originalArtifact: sourceArtifact });
    assert.match(vary, /data-editor-kind="composition"/u);
    assert.doesNotMatch(vary, /name="sourcePassage"/u);
    const scene = renderIterationSurface({ action: 'keep-characters-change-scene', originalArtifact: sourceArtifact });
    assert.match(scene, /data-editor-kind="scene"/u);
    assert.match(scene, /name="sourcePassage"/u);
    assert.match(scene, /name="scene.location"/u);
    const canonical = renderIterationSurface({ action: 'make-canonical', originalArtifact: sourceArtifact });
    assert.match(canonical, /data-editor-kind="canonical"/u);
    assert.match(canonical, /name="activeLook.identityId"/u);
    assert.match(canonical, /name="activeLook.lookId"/u);
    assert.match(canonical, /name="priorScene"/u);
    assert.match(canonical, /name="chatBackground"/u);
    const repair = renderIterationSurface({ action: 'retry-repaired-prompt', originalArtifact: sourceArtifact, repairedPrompt: { status: 'repaired', repairedPrompt: 'Ava waits.' }, repairedPromptConfirmed: true });
    assert.match(repair, /Retry repaired prompt/u);
});

test('action controls select an editor and expose a separate explicit submit control', () => {
    const html = renderIterationSurface({ action: 'keep-characters-change-scene', originalArtifact: sourceArtifact });
    assert.match(html, /data-iteration-action="keep-characters-change-scene"/u);
    assert.match(html, /data-iteration-submit="true"/u);
    assert.match(html, /Keep characters\/change scene/u);
    assert.match(html, /Generate/u);
});

test('mounted action click selects without dispatching and renders the selected editor', () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const host = { innerHTML: '', addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener() {} };
    mountIterationSurface(host, controller);
    const target = { getAttribute(name) { return name === 'data-iteration-action' ? 'keep-characters-change-scene' : name === 'data-iteration-select' ? 'true' : null; }, closest() { return target; } };
    listeners.get('click')({ target, preventDefault() {} });
    assert.equal(controller.getState().action, 'keep-characters-change-scene');
    assert.match(host.innerHTML, /data-editor-kind="scene"/u);
    assert.equal(calls.dispatch.length, 0);
});

test('mounted scene submit uses the selected action and sends the complete scene payload', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const fields = new Map([
        ['[name="twoUp"]', { checked: false }],
        ['[name="paidConsent"]', { checked: true }],
        ['[name="sourcePassage"]', { value: 'Ava enters the observatory.' }],
        ['[name="prompt"]', { value: 'Ava enters beneath a clear dome.' }],
        ['[name="scene.location"]', { value: 'Observatory' }],
        ['[name="scene.cast"]', { value: 'Ava, Rowan' }],
    ]);
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener() {},
        querySelector(selector) { return fields.get(selector) || null; },
    };
    mountIterationSurface(host, controller);
    const selectScene = { getAttribute(name) { return name === 'data-iteration-action' ? 'keep-characters-change-scene' : name === 'data-iteration-select' ? 'true' : null; }, closest() { return selectScene; } };
    listeners.get('click')({ target: selectScene, preventDefault() {} });
    await controller.quote({ action: 'keep-characters-change-scene', changes: { sourcePassage: fields.get('[name="sourcePassage"]').value, prompt: fields.get('[name="prompt"]').value, scene: { location: 'Observatory', cast: 'Ava, Rowan' } } });
    const submit = { getAttribute(name) { return name === 'data-iteration-submit' ? 'true' : null; }, closest() { return submit; } };
    listeners.get('click')({ target: submit, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.getState().status, 'completed');
    assert.equal(calls.dispatch.length, 1);
    const output = calls.dispatch[0].artifacts[0];
    assert.equal(output.sourcePassage.text, 'Ava enters the observatory.');
    assert.equal(output.effectivePrompt, 'Ava enters beneath a clear dome.');
    assert.deepEqual(output.canonSnapshot.priorScene, { location: 'Observatory', cast: 'Ava, Rowan' });
});

test('mounted canonical submit uses the selected action and sends exact role payload', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const fields = new Map([
        ['[name="twoUp"]', { checked: false }],
        ['[name="activeLook.identityId"]', { value: 'ava' }],
        ['[name="activeLook.lookId"]', { value: 'look:2' }],
        ['[name="priorScene"]', { value: 'Observatory' }],
        ['[name="chatBackground"]', { value: 'Quiet suspense' }],
    ]);
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener() {},
        querySelector(selector) { return fields.get(selector) || null; },
    };
    mountIterationSurface(host, controller);
    const selectCanonical = { getAttribute(name) { return name === 'data-iteration-action' ? 'make-canonical' : name === 'data-iteration-select' ? 'true' : null; }, closest() { return selectCanonical; } };
    listeners.get('click')({ target: selectCanonical, preventDefault() {} });
    const submit = { getAttribute(name) { return name === 'data-iteration-submit' ? 'true' : null; }, closest() { return submit; } };
    listeners.get('click')({ target: submit, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.getState().status, 'completed');
    assert.equal(calls.dispatch.length, 0);
    assert.equal(calls.canonical.length, 1);
    assert.deepEqual(calls.canonical[0].mutation.roles, {
        activeLook: { identityId: 'ava', lookId: 'look:2' },
        priorScene: 'Observatory',
        chatBackground: 'Quiet suspense',
    });
});

test('controller quotes finite two-up cost and requires matching explicit consent before dispatch', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'vary-shot', twoUp: true, changes: { composition: { framing: 'wide' } } });
    assert.equal(quote.outputCount, 2);
    assert.equal(quote.amount, 0.08);
    assert.equal(quote.currency, 'USD');
    assert.equal(Object.isFrozen(quote), true);

    const blocked = await controller.submit({ action: 'vary-shot', twoUp: true, changes: { composition: { framing: 'wide' } } });
    assert.equal(blocked.status, 'consent-required');
    assert.equal(calls.dispatch.length, 0);

    const ready = await controller.submit({
        action: 'vary-shot', twoUp: true,
        changes: { composition: { framing: 'wide' } },
        consent: { approved: true, outputCount: 2, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt },
    });
    assert.equal(ready.status, 'awaiting-selection');
    assert.equal(ready.artifacts.length, 2);
    assert.equal(ready.originalArtifact.artifactId, sourceArtifact.artifactId);
    assert.equal(calls.dispatch.length, 1);
});

test('consent binds the exact displayed quote and dispatch does not re-quote', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe' });
    const quoteCount = calls.quote.length;
    const mismatch = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1, quoteId: 'quote:forged', amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(mismatch.status, 'consent-required');
    assert.equal(calls.dispatch.length, 0);
    const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(result.status, 'completed');
    assert.equal(calls.quote.length, quoteCount);
});

test('two-up chooser persists only the chosen output and keeps the original artifact', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe', twoUp: true });
    await controller.submit({
        action: 'reuse-recipe', twoUp: true,
        consent: { approved: true, outputCount: 2, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt },
    });
    const chosenId = controller.getState().artifacts[1].artifactId;
    const result = await controller.chooseArtifact(chosenId);
    assert.equal(result.status, 'completed');
    assert.equal(calls.persist.length, 1);
    assert.equal(calls.persist[0].artifact.artifactId, chosenId);
    assert.equal(calls.readback.length, 1);
    assert.equal(calls.discard.length, 1);
    assert.equal(result.originalArtifact.artifactId, sourceArtifact.artifactId);
    assert.equal(result.originalRetention.status, 'confirmed');
});

test('two-up cleanup indeterminate leaves chosen output and cleanup-pending state', async () => {
    const { deps } = dependencies({ discardArtifact: async ({ artifactId, plan }) => ({ status: 'indeterminate', artifactId, planId: plan.planId, invocationId: plan.invocationId }) });
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe', twoUp: true });
    await controller.submit({ action: 'reuse-recipe', twoUp: true, consent: { approved: true, outputCount: 2, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    const chosenId = controller.getState().artifacts[0].artifactId;
    const result = await controller.chooseArtifact(chosenId);
    assert.equal(result.status, 'cleanup-pending');
    assert.equal(result.chosenArtifactId, chosenId);
    assert.equal(result.originalArtifact.artifactId, sourceArtifact.artifactId);
});

test('incomplete dispatcher receipts fail closed without phantom artifacts or persistence', async () => {
    const { deps, calls } = dependencies({ dispatchCoordinator: async () => ({ status: 'completed', planId: 'wrong', invocationId: 'wrong', outputCount: 2, artifacts: [] }) });
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe' });
    const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(result.status, 'error');
    assert.equal(calls.persist.length, 0);
});

test('a non-terminal dispatched receipt is rejected even when identities match', async () => {
    const { deps, calls } = dependencies({ dispatchCoordinator: async (plan) => ({ status: 'dispatched', planId: plan.planId, invocationId: plan.invocationId, outputCount: 1, artifacts: plan.artifacts }) });
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe' });
    const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(result.status, 'error');
    assert.equal(calls.persist.length, 0);
});

test('repaired prompt is shown for confirmation and cannot dispatch before confirmation', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const draft = controller.preparePrompt('Ava (waits');
    assert.equal(draft.status, 'repaired');
    assert.equal(controller.getState().status, 'draft-review');
    const blocked = await controller.submit({ action: 'retry-repaired-prompt', consent: { approved: true, outputCount: 1 } });
    assert.equal(blocked.status, 'draft-review');
    assert.equal(calls.dispatch.length, 0);
    controller.confirmRepairedPrompt();
    const quote = await controller.quote({ action: 'edit-regenerate' });
    const completed = await controller.submit({ action: 'retry-repaired-prompt', consent: { approved: true, outputCount: 1, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(completed.status, 'completed');
});

test('input and change events feed prompt repair through the mount seam', () => {
    const { deps } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const fields = new Map();
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
        querySelector(selector) { return fields.get(selector); },
    };
    const mounted = mountIterationSurface(host, controller);
    const promptField = { name: 'prompt', value: 'Ava (waits' };
    fields.set('[name="prompt"]', promptField);
    const initialMarkup = host.innerHTML;
    for (const eventName of ['input', 'change']) listeners.get(eventName)({ target: { name: 'prompt', value: promptField.value } });
    assert.equal(controller.getState().status, 'draft-review');
    assert.equal(host.innerHTML, initialMarkup, 'draft updates must not replace the host markup');
    mounted.destroy();
});

test('repaired preview is targeted and restores focused prompt selection', () => {
    const { deps } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const prompt = { name: 'prompt', value: 'Ava (waits', selectionStart: 5, selectionEnd: 5, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
    const repairRegion = { innerHTML: '' };
    const status = { textContent: '' };
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener() {},
        querySelector(selector) { return selector === '[name="prompt"]' ? prompt : selector === '[data-repair-region]' ? repairRegion : selector === '.cig-rp-status' ? status : null; },
        contains(node) { return node === prompt; },
        ownerDocument: { get activeElement() { return prompt; } },
    };
    mountIterationSurface(host, controller);
    listeners.get('input')({ target: prompt });
    assert.match(repairRegion.innerHTML, /Confirm repaired prompt/u);
    assert.equal(prompt.selectionStart, 5);
    assert.equal(prompt.selectionEnd, 5);
    assert.match(status.textContent, /Review the repaired prompt/u);
});

test('discard exceptions preserve chosen/original state and expose cleanup reconciliation', async () => {
    const { deps } = dependencies({ discardArtifact: async () => { throw new Error('delete transport unavailable'); } });
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe', twoUp: true });
    await controller.submit({ action: 'reuse-recipe', twoUp: true, consent: { approved: true, outputCount: 2, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    const chosenId = controller.getState().artifacts[1].artifactId;
    const result = await controller.chooseArtifact(chosenId);
    assert.equal(result.status, 'cleanup-pending');
    assert.equal(result.chosenArtifactId, chosenId);
    assert.match(result.reconciliation.reason, /delete transport unavailable/u);
});

test('missing authoritative dependencies fail closed without dispatch', async () => {
    for (const missing of ['verifyGenerationPlan', 'estimateCost', 'reserveInvocation', 'releaseInvocation', 'dispatchCoordinator', 'persistArtifact', 'readbackArtifact', 'readbackOriginalArtifact']) {
        const { deps, calls } = dependencies({ [missing]: undefined });
        const controller = createIterationSurfaceController(deps);
        const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1 } });
        assert.equal(result.status, 'error', missing);
        assert.match(result.error, new RegExp(missing), missing);
        assert.equal(calls.dispatch.length, 0, missing);
    }
});

test('canonical action uses injected mutation and readback, never generation dispatch', async () => {
    const { deps, calls } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const result = await controller.submit({ action: 'make-canonical', changes: { roles: { chatBackground: 'quiet suspense' } } });
    assert.equal(result.status, 'completed');
    assert.equal(calls.dispatch.length, 0);
    assert.equal(calls.canonical.length, 1);
    assert.equal(calls.canonicalReadback.length, 1);
});

test('persistence readback must match exact artifact, plan, and invocation identities', async () => {
    const { deps, calls } = dependencies({ readbackArtifact: async (input) => { calls.readback.push(input); return { status: 'confirmed', artifactId: 'artifact:other', planId: input.plan.planId, invocationId: input.plan.invocationId }; } });
    const controller = createIterationSurfaceController(deps);
    const quote = await controller.quote({ action: 'reuse-recipe' });
    const result = await controller.submit({ action: 'reuse-recipe', consent: { approved: true, outputCount: 1, quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, expiresAt: quote.expiresAt } });
    assert.equal(result.status, 'error');
    assert.match(result.error, /read-back/u);
});

test('stylesheet install and uninstall are explicit and idempotent', () => {
    const nodes = new Map();
    const documentLike = {
        head: { appendChild(node) { nodes.set(node.id, node); }, removeChild(node) { nodes.delete(node.id); } },
        createElement() { return { id: '', textContent: '' }; },
        getElementById(id) { return nodes.get(id) || null; },
    };
    assert.equal(installIterationSurfaceStyles(documentLike), true);
    assert.equal(installIterationSurfaceStyles(documentLike), true);
    assert.equal(uninstallIterationSurfaceStyles(documentLike), true);
    assert.equal(uninstallIterationSurfaceStyles(documentLike), false);
});

test('mount exposes a stable render seam and cleans up event listeners', () => {
    const { deps } = dependencies();
    const controller = createIterationSurfaceController(deps);
    const listeners = new Map();
    const host = {
        innerHTML: '',
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    };
    const mounted = mountIterationSurface(host, controller);
    assert.match(host.innerHTML, /data-cig-rp-iteration-surface/u);
    assert.equal(typeof mounted.render, 'function');
    assert.equal(listeners.has('click'), true);
    assert.equal(listeners.has('input'), true);
    assert.equal(listeners.has('change'), true);
    mounted.destroy();
    assert.equal(listeners.size, 0);
});
